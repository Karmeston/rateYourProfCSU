import { validTerm, validTeacher, type ReviewContext } from '../shared/community.ts';
export type ReviewDraft = { id: string; rating: number; body: string } & Partial<ReviewContext>;
export function readDraft(value: string | null): ReviewDraft | null {
  try {
    const draft = JSON.parse(value ?? 'null') as ReviewDraft | null;
    return draft &&
      typeof draft.id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.id) &&
      Number.isInteger(draft.rating) &&
      draft.rating >= 0 &&
      draft.rating <= 5 &&
      typeof draft.body === 'string' &&
      draft.body.length <= 2000 &&
      !draft.body.includes('\0') &&
      validTerm(draft.term ?? null) &&
      validTeacher(draft.teacherName ?? null)
      ? {
          id: draft.id,
          rating: draft.rating,
          body: draft.body,
          ...(draft.term !== undefined ? { term: draft.term } : {}),
          ...(draft.teacherName !== undefined ? { teacherName: draft.teacherName } : {}),
        }
      : null;
  } catch {
    return null;
  }
}
