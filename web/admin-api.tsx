export class AdminRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function adminRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AdminRequestError(data?.error ?? '操作失败，请重试', response.status);
  }
  return response.status === 204 ? ({} as T) : (response.json() as Promise<T>);
}
export function AdminFailure({
  error,
  status,
  retry,
  relogin,
}: {
  error: string;
  status?: number;
  retry: () => void;
  relogin: () => void;
}) {
  return (
    <p className="form-error" role="alert">
      {status === 401 ? '管理会话已过期，请重新登录。' : error}{' '}
      <button onClick={status === 401 ? relogin : retry}>
        {status === 401 ? '重新登录' : '重试'}
      </button>
    </p>
  );
}
