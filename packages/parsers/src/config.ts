import { ParserConfigSchema, type ParserConfig } from '@roleproof/shared';

export const DEFAULT_PARSER_CONFIG: Readonly<ParserConfig> = Object.freeze(
  ParserConfigSchema.parse({
    maxTextBytes: 1_000_000,
    maxPdfBytes: 10_000_000,
    pdfTimeoutMs: 10_000,
    maxPdfPages: 50,
    maxImagePixels: 16_777_216,
  }),
);
