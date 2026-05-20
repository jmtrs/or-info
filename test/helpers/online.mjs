import { spawn } from 'node:child_process';
import { CLI } from './runtime.mjs';

export const ONLINE_TIMEOUT = 45_000;

export function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON:\n${raw.slice(0, 300)}`);
  }
}

export function parseToolResult(result) {
  return parseJson(result.content[0].text);
}

export function isTransientNetworkMessage(message) {
  const lower = String(message ?? '').toLowerCase();
  return [
    'request failed',
    'fetch failed',
    'network',
    'timed out',
    'timeout',
    '429',
    '502',
    '503',
    '504',
    'socket hang up',
    'econnreset',
  ].some((token) => lower.includes(token));
}

export function runCli(args, { env = process.env, expectExit = 0, timeoutMs = ONLINE_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CLI timeout (${timeoutMs}ms): or-info ${args.join(' ')}`)),
      timeoutMs
    );
    const proc = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== expectExit) {
        reject(new Error(`Exit ${code} (expected ${expectExit}). stderr: ${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

export class McpClient {
  constructor(proc, timeoutMs = ONLINE_TIMEOUT) {
    this._proc = proc;
    this._timeoutMs = timeoutMs;
    this._pending = new Map();
    this._buffer = '';
    this._nextId = 1;

    proc.stdout.on('data', (chunk) => {
      this._buffer += chunk.toString();
      const lines = this._buffer.split('\n');
      this._buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id == null) continue;
        const pending = this._pending.get(message.id);
        if (!pending) continue;

        this._pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });

    proc.on('close', (code) => {
      for (const { reject } of this._pending.values()) {
        reject(new Error(`MCP process exited with code ${code}`));
      }
      this._pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this._timeoutMs);

      this._pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this._proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    this._proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async initialize() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'or-info-test', version: '1.0.0' },
    });
    this.notify('notifications/initialized');
  }

  callTool(name, args = {}) {
    return this.send('tools/call', { name, arguments: args });
  }

  kill() {
    this._proc.kill('SIGTERM');
  }
}

export async function callToolWithRetry(client, name, args = {}, retries = 1) {
  let attempt = 0;

  while (true) {
    const result = await client.callTool(name, args);
    if (!result.isError) return result;

    const message = result.content?.[0]?.text ?? '';
    if (attempt >= retries || !isTransientNetworkMessage(message)) return result;

    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
}

export async function startMcpClient({
  env = process.env,
  timeoutMs = ONLINE_TIMEOUT,
  startDelayMs = 600,
} = {}) {
  const proc = spawn(process.execPath, [CLI, '--mcp'], { env });
  proc.stderr.on('data', () => {});

  const client = new McpClient(proc, timeoutMs);
  await new Promise((resolve) => setTimeout(resolve, startDelayMs));
  await client.initialize();
  return client;
}
