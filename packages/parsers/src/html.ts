import { parse, parseFragment } from 'parse5';

interface HtmlAttribute {
  name: string;
  value: string;
}

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  value?: string;
}

const BLOCK_TAGS = new Set([
  'article',
  'blockquote',
  'br',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'p',
  'section',
  'table',
  'tr',
  'ul',
  'ol',
]);

const EXCLUDED_TAGS = new Set([
  'aside',
  'canvas',
  'footer',
  'nav',
  'noscript',
  'script',
  'style',
  'svg',
  'template',
]);

const FORM_CONTROL_TAGS = new Set([
  'button',
  'fieldset',
  'input',
  'label',
  'option',
  'select',
  'textarea',
]);

function children(node: HtmlNode): HtmlNode[] {
  return node.childNodes ?? [];
}

function attribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((candidate) => candidate.name.toLocaleLowerCase('en-US') === name)?.value;
}

function hasClass(node: HtmlNode, name: string): boolean {
  return (attribute(node, 'class') ?? '').split(/\s+/u).includes(name);
}

function findElement(
  node: HtmlNode,
  accepts: (candidate: HtmlNode) => boolean,
): HtmlNode | undefined {
  if (node.tagName !== undefined && accepts(node)) return node;
  for (const child of children(node)) {
    const found = findElement(child, accepts);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findElements(node: HtmlNode, accepts: (candidate: HtmlNode) => boolean): HtmlNode[] {
  const values: HtmlNode[] = [];
  if (node.tagName !== undefined && accepts(node)) values.push(node);
  for (const child of children(node)) values.push(...findElements(child, accepts));
  return values;
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function textFromNode(node: HtmlNode, skipForms: boolean): string {
  if (node.nodeName === '#text') return node.value ?? '';
  const tag = node.tagName?.toLocaleLowerCase('en-US');
  if (tag !== undefined) {
    if (EXCLUDED_TAGS.has(tag) || FORM_CONTROL_TAGS.has(tag) || (skipForms && tag === 'form')) {
      return '';
    }
  }

  const content = children(node)
    .map((child) => textFromNode(child, skipForms))
    .join(' ');
  return tag !== undefined && BLOCK_TAGS.has(tag) ? `\n${content}\n` : content;
}

function descriptionElement(document: HtmlNode, url: string): HtmlNode | undefined {
  const hostname = new URL(url).hostname.toLocaleLowerCase('en-US');
  const greenhouse = hostname === 'greenhouse.io' || hostname.endsWith('.greenhouse.io');
  const common = (node: HtmlNode): boolean => {
    const id = attribute(node, 'id')?.toLocaleLowerCase('en-US');
    const qa =
      attribute(node, 'data-qa')?.toLocaleLowerCase('en-US') ??
      attribute(node, 'data-testid')?.toLocaleLowerCase('en-US');
    return (
      qa === 'job-description' ||
      attribute(node, 'itemprop')?.toLocaleLowerCase('en-US') === 'description' ||
      id === 'job-description' ||
      id === 'job_description' ||
      hasClass(node, 'job-description') ||
      hasClass(node, 'job__description') ||
      hasClass(node, 'posting-description') ||
      hasClass(node, 'job-posting-description')
    );
  };
  return findElement(document, (node) => {
    const id = attribute(node, 'id')?.toLocaleLowerCase('en-US');
    return common(node) || (greenhouse && id === 'content');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJobPosting(value: Record<string, unknown>): boolean {
  const type = value['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function collectJobPostings(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectJobPostings);
  if (!isRecord(value)) return [];
  return [
    ...(isJobPosting(value) ? [value] : []),
    ...Object.values(value).flatMap(collectJobPostings),
  ];
}

function canonicalUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

function postingUrls(posting: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (typeof posting.url === 'string') values.push(posting.url);
  const mainEntity = posting.mainEntityOfPage;
  if (typeof mainEntity === 'string') values.push(mainEntity);
  if (isRecord(mainEntity) && typeof mainEntity['@id'] === 'string') values.push(mainEntity['@id']);
  return values;
}

function identifierValues(posting: Record<string, unknown>): string[] {
  const identifier = posting.identifier;
  if (typeof identifier === 'string') return [identifier];
  if (!isRecord(identifier)) return [];
  return [identifier.value, identifier.name, identifier['@id']].filter(
    (value): value is string => typeof value === 'string',
  );
}

function requestedIdentifier(url: string): string | undefined {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function selectJobPosting(
  postings: Record<string, unknown>[],
  url: string,
): Record<string, unknown> | undefined {
  const withDescriptions = postings.filter(
    (posting) => typeof posting.description === 'string' && posting.description.trim().length > 0,
  );
  const targetUrl = canonicalUrl(url);
  const urlMatches = withDescriptions.filter((posting) =>
    postingUrls(posting).some((candidate) => canonicalUrl(candidate) === targetUrl),
  );
  if (urlMatches.length === 1) return urlMatches[0];

  const targetIdentifier = requestedIdentifier(url);
  const identifierMatches = withDescriptions.filter(
    (posting) =>
      targetIdentifier !== undefined && identifierValues(posting).includes(targetIdentifier),
  );
  if (identifierMatches.length === 1) return identifierMatches[0];
  return withDescriptions.length === 1 ? withDescriptions[0] : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function salaryText(posting: Record<string, unknown>): string | undefined {
  const baseSalary = posting.baseSalary;
  if (!isRecord(baseSalary)) return undefined;
  const currency = typeof baseSalary.currency === 'string' ? baseSalary.currency : 'USD';
  const value = baseSalary.value;
  if (!isRecord(value)) return undefined;
  const minimum = numberValue(value.minValue) ?? numberValue(value.value);
  const maximum = numberValue(value.maxValue) ?? numberValue(value.value);
  if (minimum === undefined || maximum === undefined) return undefined;
  const unit = typeof value.unitText === 'string' ? value.unitText.toLocaleUpperCase('en-US') : '';
  const period = unit === 'YEAR' || unit === 'ANNUAL' ? ' annually' : '';
  return `Salary: ${currency} ${minimum}-${maximum}${period}.`;
}

function locationNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(locationNames);
  if (!isRecord(value)) return [];
  const names = typeof value.name === 'string' ? [value.name] : [];
  const address = value.address;
  if (!isRecord(address)) return names;
  return [
    ...names,
    ...[address.addressLocality, address.addressRegion, address.addressCountry].filter(
      (candidate): candidate is string => typeof candidate === 'string',
    ),
  ];
}

function locationText(posting: Record<string, unknown>): string | undefined {
  const values = [
    ...(posting.jobLocationType === 'TELECOMMUTE' ? ['Remote'] : []),
    ...locationNames(posting.applicantLocationRequirements),
    ...locationNames(posting.jobLocation),
  ];
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length === 0 ? undefined : `Location: ${unique.join(' - ')}.`;
}

function jsonLdText(document: HtmlNode, url: string): string | undefined {
  const postings: Record<string, unknown>[] = [];
  for (const script of findElements(
    document,
    (node) =>
      node.tagName === 'script' &&
      attribute(node, 'type')?.toLocaleLowerCase('en-US') === 'application/ld+json',
  )) {
    try {
      postings.push(
        ...collectJobPostings(
          JSON.parse(
            children(script)
              .map((child) => child.value ?? '')
              .join(''),
          ),
        ),
      );
    } catch {
      continue;
    }
  }
  const posting = selectJobPosting(postings, url);
  if (posting === undefined || typeof posting.description !== 'string') return undefined;
  const title = typeof posting.title === 'string' ? posting.title.trim() : '';
  return normalizeText(
    [title, extractHtmlText(posting.description), salaryText(posting), locationText(posting)]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join('\n'),
  );
}

function parseDocument(html: string): HtmlNode {
  return parse(html) as unknown as HtmlNode;
}

export function extractHtmlText(html: string): string {
  const fragment = parseFragment(html) as unknown as HtmlNode;
  return normalizeText(textFromNode(fragment, false));
}

export function extractJobPageText(html: string, url: string): string {
  const document = parseDocument(html);
  const structured = jsonLdText(document, url);
  if (structured !== undefined) return structured;

  const selected =
    descriptionElement(document, url) ??
    findElement(document, (node) => node.tagName === 'main') ??
    findElement(document, (node) => node.tagName === 'article') ??
    document;
  return normalizeText(textFromNode(selected, true));
}
