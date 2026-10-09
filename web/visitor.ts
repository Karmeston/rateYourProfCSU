let establishing: Promise<void> | undefined;

export class SubmissionError extends Error {}

async function failure(response: Response) {
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  return new SubmissionError(data?.error ?? '提交失败，请重试。');
}

function ensureVisitor() {
  // Share only in-flight setup. Each later action checks that the Cookie still exists.
  if (!establishing) {
    establishing = (async () => {
      const response = await fetch('/api/visitor', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw await failure(response);
    })().finally(() => {
      establishing = undefined;
    });
  }
  return establishing;
}

export async function send<T>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
  signal: AbortSignal = AbortSignal.timeout(20000),
): Promise<T> {
  signal.throwIfAborted();
  await ensureVisitor();
  signal.throwIfAborted();
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  // Do not issue repeatedly if the browser blocks Cookie storage. Keep the original draft ID.
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}
