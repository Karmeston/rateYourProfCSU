import { useEffect, useState } from 'react';

// 页面切换时取消旧请求，避免慢请求把新页面的数据覆盖。
export function useData<T>(url: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (url === null) { setState({}); return; }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    setState({});
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? '没有找到这条记录。' : '暂时无法加载，请稍后重试。');
        const data = await response.json() as T;
        if (!controller.signal.aborted) setState({ data });
      } catch (error) {
        if (timedOut) setState({ error: '连接超时，请重试。' });
        else if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : '网络连接失败，请重试。' });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [url, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
