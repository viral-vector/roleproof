import { analyzeText } from '@roleproof/plugin-api';
import type { Command } from 'commander';

import { CliError } from '../errors.js';
import type { CliOutput, CliState } from '../program.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface ToolCallParams {
  name: string;
  arguments?: unknown;
}

interface AnalyzeToolArguments {
  resumeText: string;
  jobText: string;
  format?: 'json' | 'markdown';
}

async function readStdin(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of input) {
    chunks.push(
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((part) => Buffer.from(part))));
}

function response(id: JsonRpcRequest['id'], result: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result })}\n`;
}

function errorResponse(id: JsonRpcRequest['id'], code: number, message: string): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })}\n`;
}

function parseAnalyzeArguments(value: unknown): AnalyzeToolArguments {
  if (typeof value !== 'object' || value === null) {
    throw new CliError(2, 'MCP tool arguments must be an object.');
  }
  const args = value as Record<string, unknown>;
  if (typeof args.resumeText !== 'string' || typeof args.jobText !== 'string') {
    throw new CliError(2, 'MCP analysis requires resumeText and jobText string arguments.');
  }
  if (args.format !== undefined && args.format !== 'json' && args.format !== 'markdown') {
    throw new CliError(2, 'MCP analysis format must be json or markdown.');
  }
  return {
    resumeText: args.resumeText,
    jobText: args.jobText,
    format: args.format ?? 'json',
  };
}

function handleRequest(request: JsonRpcRequest): string {
  if (request.method === 'initialize') {
    return response(request.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'roleproof', version: '1.0' },
      capabilities: { tools: {} },
    });
  }
  if (request.method === 'tools/list') {
    return response(request.id, {
      tools: [
        {
          name: 'roleproof_analyze',
          description:
            'Run deterministic RoleProof analysis for supplied plaintext resume and job text.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['resumeText', 'jobText'],
            properties: {
              resumeText: { type: 'string' },
              jobText: { type: 'string' },
              format: { enum: ['json', 'markdown'] },
            },
          },
        },
      ],
    });
  }
  if (request.method === 'tools/call') {
    const params = request.params as ToolCallParams;
    if (params?.name !== 'roleproof_analyze') {
      return errorResponse(request.id, -32602, 'Unknown RoleProof MCP tool.');
    }
    const args = parseAnalyzeArguments(params.arguments);
    const result = analyzeText({ resumeText: args.resumeText, jobText: args.jobText });
    const text = args.format === 'json' ? result.reports.json : result.reports.markdown;
    return response(request.id, { content: [{ type: 'text', text }] });
  }
  return errorResponse(request.id, -32601, 'Unsupported MCP method.');
}

export function registerMcpCommand(
  program: Command,
  output: CliOutput,
  state: CliState,
  stdin: NodeJS.ReadableStream,
): void {
  program
    .command('mcp')
    .description('Run a local MCP-compatible JSON-RPC server over stdio')
    .action(async () => {
      const content = await readStdin(stdin);
      const lines = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          output.writeOut(errorResponse(null, -32700, 'Invalid JSON-RPC request.'));
          state.exitCode = 2;
          continue;
        }
        try {
          output.writeOut(handleRequest(request));
        } catch (error) {
          output.writeOut(
            errorResponse(
              request.id,
              -32602,
              error instanceof CliError ? error.message : 'RoleProof MCP tool failed.',
            ),
          );
          state.exitCode = 1;
        }
      }
    });
}
