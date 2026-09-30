import { fetch } from 'expo/fetch';

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  details?: { parameter_size?: string };
}

/** Normalise what the user typed: add http:// and the default port, drop trailing slashes. */
export function normaliseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  // Bare host with no port -> Ollama's default port.
  if (!/:\d+$/.test(url.replace(/^https?:\/\//i, '')) && url.startsWith('http://')) {
    url = `${url}:11434`;
  }
  return url;
}

const UNREACHABLE =
  'Can’t reach the server. Check the address, that Ollama is running, and that your phone is on the same Wi-Fi or Tailscale.';

/** fetch, but with a clear message when the server can't be reached at all. */
async function request(url: string, init?: Parameters<typeof fetch>[1]) {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new Error(UNREACHABLE);
  }
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`No answer after ${ms / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Lists the models installed on the Ollama server. Also works as a connection test. */
export async function listModels(baseUrl: string): Promise<OllamaModel[]> {
  return withTimeout(8000, async (signal) => {
    const res = await request(`${baseUrl}/api/tags`, { signal });
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    const data = (await res.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  });
}

/**
 * Sends the conversation to Ollama and streams the reply.
 * `onToken` is called with each new piece of text as it arrives.
 */
export async function streamChat(opts: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onToken: (text: string) => void;
}): Promise<void> {
  const res = await request(`${opts.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let detail = `Server replied ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) detail = err.error;
    } catch {}
    throw new Error(detail);
  }

  // Ollama streams newline-delimited JSON: one object per chunk of the reply.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
    if (chunk.error) throw new Error(chunk.error);
    if (chunk.message?.content) opts.onToken(chunk.message.content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  handleLine(buffer + decoder.decode());
}

export function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
