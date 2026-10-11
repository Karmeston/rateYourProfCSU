import { validTerm, validTeacher, type ReviewContext } from '../shared/community.ts';
export function objectInput(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function textInput(value: unknown, max: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !value.includes('\0')
  );
}
export function contextInput(data: Record<string, unknown>): ReviewContext | null {
  const term = data.term ?? null;
  const teacherName = data.teacherName ?? null;
  return validTerm(term) && validTeacher(teacherName)
    ? {
        term: term as string | null,
        teacherName: typeof teacherName === 'string' ? teacherName.trim() : null,
      }
    : null;
}
export function sourceUrl(value: unknown): string | null | false {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : false;
  } catch {
    return false;
  }
}
