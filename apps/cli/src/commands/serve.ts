import { createLocalWebApp, DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from '@roleproof/web';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import type { CliOutput } from '../program.js';

interface ServeOptions {
  host?: string;
  port?: string;
}

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_SERVE_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new CliError(2, 'Serve port must be an integer between 0 and 65535.');
  }
  return port;
};

export function registerServeCommand(program: Command, output: CliOutput): void {
  program
    .command('serve')
    .description('Start the local RoleProof web UI')
    .addHelpText(
      'after',
      `\nDefault URL: http://${DEFAULT_SERVE_HOST}:${String(DEFAULT_SERVE_PORT)}\n`,
    )
    .option('--host <host>', 'Host to bind the local web server', DEFAULT_SERVE_HOST)
    .option('--port <port>', 'Port to bind the local web server', String(DEFAULT_SERVE_PORT))
    .action(async (options: ServeOptions) => {
      const host = options.host ?? DEFAULT_SERVE_HOST;
      const port = parsePort(options.port);
      const app = createLocalWebApp();

      try {
        await app.listen({ host, port });
      } catch (error) {
        await app.close();
        throw error instanceof CliError
          ? error
          : new CliError(5, 'Unable to start the local web server. Check host and port options.');
      }

      const address = app.server.address();
      const actualPort = typeof address === 'object' && address !== null ? address.port : port;
      output.writeErr(`RoleProof web UI: http://${host}:${String(actualPort)}\n`);
    });
}
