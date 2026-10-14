import {
  supplementKinds,
  validTerm,
  validTeacher,
  type SupplementContent,
} from '../shared/community.ts';

export type SupplementDraft = Omit<SupplementContent, 'sourceUrl'> & {
  id: string;
  sourceUrl: string;
};

export function readSupplementDraft(value: string | null): SupplementDraft | null {
  try {
    const draft = JSON.parse(value ?? 'null') as SupplementDraft | null;
    if (
      !draft ||
      typeof draft.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.id) ||
      typeof draft.kind !== 'string' ||
      !Object.hasOwn(supplementKinds, draft.kind) ||
      typeof draft.body !== 'string' ||
      draft.body.length > 2000 ||
      draft.body.includes('\0') ||
      typeof draft.sourceUrl !== 'string' ||
      draft.sourceUrl.length > 2048 ||
      draft.sourceUrl.includes('\0') ||
      !validTerm(draft.term) ||
      !validTeacher(draft.teacherName)
    )
      return null;
    // A draft may contain an incomplete URL; server validation still applies at submission.
    return {
      id: draft.id,
      kind: draft.kind,
      body: draft.body,
      sourceUrl: draft.sourceUrl,
      term: draft.term,
      teacherName: draft.teacherName,
    };
  } catch {
    return null;
  }
}
