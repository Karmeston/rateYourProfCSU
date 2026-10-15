export const supplementKinds = {
  assessment: '考核与作业',
  materials: '试卷与学习资料',
  correction: '课程信息纠错',
  other: '其他补充',
} as const;
export const reportReasons = {
  spam: '广告或重复内容',
  abuse: '辱骂或攻击',
  personal_info: '泄露个人信息',
  inaccurate: '信息有误',
  other: '其他问题',
} as const;
export type ReviewContext = { term: string | null; teacherName: string | null };
export type SupplementContent = ReviewContext & {
  kind: keyof typeof supplementKinds;
  body: string;
  sourceUrl: string | null;
};
export type Supplement = SupplementContent & {
  id: string;
  created_at: string;
  updated_at: string | null;
};
export type OwnSupplement = Supplement & {
  status: 'published' | 'pending' | 'rejected';
  revision: number;
  withdrawn_at: string | null;
};
export type SupplementPage = {
  supplements: Supplement[];
  mine: OwnSupplement[];
  offset: number;
  mineOffset: number;
  hasMore: boolean;
  hasMoreMine: boolean;
};
export type OwnReview = ReviewContext & {
  id: string;
  rating: number;
  body: string;
  status: 'published' | 'pending' | 'rejected';
  revision: number;
  withdrawn_at: string | null;
};
export function termLabel(term: string) {
  const year = Number(term.slice(0, 4));
  return `${year}—${year + 1}学年${term.endsWith('1') ? '第一' : '第二'}学期`;
}
export function validTerm(value: unknown) {
  return value === null || (typeof value === 'string' && /^20\d{2}-[12]$/.test(value));
}
export function validTeacher(value: unknown) {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 80 &&
      !value.includes('\0'))
  );
}
