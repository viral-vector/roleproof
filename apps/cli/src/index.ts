#!/usr/bin/env node

import { runCli } from './program.js';

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    writeOut(message) {
      process.stdout.write(message);
    },
    writeErr(message) {
      process.stderr.write(message);
    },
  });
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown command failure';
  process.stderr.write(`roleproof: ${message}\n`);
  process.exitCode = 1;
}
