import type { Route } from './routing';

export function recordPageView(route: Route) {
  if (navigator.doNotTrack === '1') return;
  const page =
    route.page === 'catalog'
      ? 'catalog'
      : route.page === 'guide'
        ? 'guide'
        : route.page === 'teachers'
          ? 'teacher_catalog'
          : route.page === 'detail'
            ? route.kind === 'courses'
              ? 'course'
              : 'teacher'
            : null;
  if (!page) return;
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    page,
    targetId: route.page === 'detail' ? Number(route.id) : 0,
  });
  const payload = new Blob([body], { type: 'application/json' });
  let sent = false;
  try {
    sent = navigator.sendBeacon?.('/api/traffic', payload) ?? false;
  } catch {
    // A blocked beacon must not interrupt navigation.
  }
  if (!sent) {
    void fetch('/api/traffic', {
      method: 'POST',
      body: payload,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {});
  }
}
