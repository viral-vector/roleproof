function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/giu, (_, code: string) => {
      const parsed = Number(code);
      return Number.isInteger(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&#x([\da-f]+);/giu, (_, code: string) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isInteger(parsed) ? String.fromCodePoint(parsed) : _;
    });
}

export function extractHtmlText(html: string): string {
  let value = html;
  value = value.replace(/<!--[\s\S]*?-->/gu, ' ');
  value = value.replace(/<\/(?:p|div|li|tr|section|article|header|footer|h[1-6]|br|hr)>/giu, '\n');
  value = value.replace(
    /<(?:p|div|li|tr|section|article|header|footer|h[1-6]|br|hr)\b[^>]*>/giu,
    '\n',
  );
  value = value.replace(
    /<(script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/\1>/giu,
    ' ',
  );
  value = value.replace(/<[^>]+>/gu, ' ');
  value = decodeEntities(value);
  value = value.replace(/\r\n?/gu, '\n');
  value = value.replace(/[\t ]+/gu, ' ');
  value = value.replace(/ *\n */gu, '\n');
  value = value.replace(/\n{3,}/gu, '\n\n');
  return value.trim();
}
