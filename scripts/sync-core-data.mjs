import { copyFile, mkdir } from 'node:fs/promises';

const sourceDirectory = new URL('../data/', import.meta.url);
const targetDirectory = new URL('../packages/core/data/', import.meta.url);

await mkdir(targetDirectory, { recursive: true });
await Promise.all([
  copyFile(
    new URL('skill-aliases.json', sourceDirectory),
    new URL('skill-aliases.json', targetDirectory),
  ),
  copyFile(
    new URL('skill-relationships.json', sourceDirectory),
    new URL('skill-relationships.json', targetDirectory),
  ),
]);
