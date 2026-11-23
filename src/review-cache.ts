import type { Context, MiddlewareHandler } from 'hono';
import { deletePublicCache, readPublicCache } from './public-cache.ts';
import { readVisitor, type AppEnv } from './visitor.ts';
import { isResourceId } from './validation.ts';

export type ReviewQuery = {
  id: number;
  offset: number;
  sort: 'latest' | 'helpful';
  rating: number | null;
};
export const reviewCacheSeconds = 60;
const listPath = /^\/api\/(courses|teachers)\/([^/]+)\/reviews$/;
const writePath = /^\/api\/(courses|teachers)\/([^/]+)\/reviews(?:\/|$)/;

export function parseReviewQuery(rawId: string, query: Record<string, string[]>): ReviewQuery | null {
  const offset = query.offset?.[0] ?? '0';
  const sort = query.sort?.[0] ?? 'latest';
  const rating = query.rating?.[0] ?? '';
  if (
    !isResourceId(rawId) ||
    Object.entries(query).some(
      ([key, values]) => !['offset', 'sort', 'rating'].includes(key) || values.length !== 1,
    ) ||
    (sort !== 'latest' && sort !== 'helpful') ||
    (query.rating && !/^[1-5]$/.test(rating)) ||
    !/^(0|[1-9]\d*)$/.test(offset) ||
    Number(offset) > 100000
  )
    return null;
  return { id: Number(rawId), offset: Number(offset), sort, rating: rating ? Number(rating) : null };
}

// Only the anonymous view is cached: it has no myReview, isMine or myVote for anyone.
export function reviewCacheKey(c: Context<AppEnv>, kind: string, query: ReviewQuery) {
  const params = new URLSearchParams({
    v: '1',
    offset: String(query.offset),
    sort: query.sort,
    rating: query.rating === null ? '' : String(query.rating),
  });
  return new URL(`/api/${kind}/${query.id}/reviews?${params}`, c.req.url).href;
}

// Serves anonymous review pages before rate and budget checks, so cache hits never reach D1.
// A successful write under a review path clears that object's first pages in this location.
export const serveCachedReviews: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === 'GET') {
    const match = listPath.exec(c.req.path);
    const query = match && parseReviewQuery(match[2], c.req.queries());
    if (match && query && !(await readVisitor(c))) {
      const cached = await readPublicCache<unknown>(reviewCacheKey(c, match[1], query));
      if (cached) {
        c.header('Cache-Control', 'no-store');
        return c.json(cached);
      }
    }
    return next();
  }
  await next();
  const match = writePath.exec(c.req.path);
  if (!match || !isResourceId(match[2]) || c.res.status >= 300) return;
  const id = Number(match[2]);
  const keys = (['latest', 'helpful'] as const).flatMap((sort) =>
    [null, 1, 2, 3, 4, 5].map((rating) => reviewCacheKey(c, match[1], { id, offset: 0, sort, rating })),
  );
  await Promise.all(keys.map(deletePublicCache));
};
