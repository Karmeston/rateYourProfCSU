function edgeCache() {
  return (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
}

// Only use this for public data with a canonical key; keep personalized reads uncached.
export async function readPublicCache<T>(key: string): Promise<T | undefined> {
  try {
    const response = await edgeCache()?.match(key);
    return response ? await response.json<T>() : undefined;
  } catch {
    return undefined;
  }
}

export async function writePublicCache<T>(key: string, data: T, seconds: number) {
  try {
    await edgeCache()?.put(key, Response.json(data, {
      headers: { 'Cache-Control': `public, max-age=${seconds}` },
    }));
  } catch {
    // A cache outage must not break a successful database read.
  }
}
