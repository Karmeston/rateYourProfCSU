import { useEffect, useState } from 'react';

// 页面切换时取消旧请求，避免慢请求把新页面的数据覆盖。
export function useData<T>(url: string | null, cache: RequestCache = 'no-store') {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ url?: string; data?: T; error?: string; status?: number }>(
    {},
  );
  useEffect(() => {
    if (url === null) {
      setState({});
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    setState({});
    void (async () => {
      let status: number | undefined;
      try {
        const response = await fetch(url, {
          cache,
          signal: controller.signal,
          credentials: 'same-origin',
        });
        status = response.status;
        if (!response.ok) {
          if (status === 503 || status === 429) {
            const payload = await response.json().catch(() => null);
            if (
              ['D1_DAILY_LIMIT', 'SERVICE_DAILY_BUDGET', 'REQUEST_RATE_LIMIT'].includes(payload?.code) &&
              typeof payload.error === 'string'
            )
              throw new Error(payload.error);
          }
          throw new Error(
            response.status === 404 ? '没有找到这条记录。' : '暂时无法加载，请稍后重试。',
          );
        }
        const data = (await response.json()) as T;
        if (active && !controller.signal.aborted) setState({ url, data });
      } catch (error) {
        if (active && timedOut) setState({ url, error: '连接超时，请重试。' });
        else if (active && !controller.signal.aborted)
          setState({
            url,
            status,
            error: error instanceof Error ? error.message : '网络连接失败，请重试。',
          });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [url, attempt, cache]);
  return { ...(state.url === url ? state : {}), retry: () => setAttempt((value) => value + 1) };
}
