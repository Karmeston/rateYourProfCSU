export type ReviewDraft = { id: string; rating: number; body: string };
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
      !draft.body.includes('\0')
      ? draft
      : null;
  } catch {
    return null;
  }
}
