export const moderationKinds = {
  supplement: '课程资料',
  course_review: '课程评价',
  teacher_review: '教师评价',
  course_reply: '课程回复',
  teacher_reply: '教师回复',
  report: '举报',
} as const;
export type ModerationKind = keyof typeof moderationKinds;
export const actionLabels = {
  approve: '通过审核',
  reject: '不通过',
  hide: '隐藏',
  restore: '恢复公开',
  resolve: '标记已处理',
  dismiss: '不采纳',
} as const;
export const statusLabels: Record<string, string> = {
  pending: '待审核',
  published: '已发布',
  rejected: '未通过或已隐藏',
  open: '待处理',
  resolved: '已处理',
  dismissed: '不采纳',
};
export type AdminItem = {
  id: string;
  kind: ModerationKind;
  status: string;
  revision: number;
  body: string;
  created_at: string;
  name: string | null;
  resourceId: number | null;
  resourceKind: 'courses' | 'teachers' | null;
  withdrawn_at: string | null;
  rating?: number;
  supplementKind?: 'assessment' | 'materials' | 'correction' | 'other';
  sourceUrl?: string | null;
  actions: (keyof typeof actionLabels)[];
  term?: string | null;
  teacherName?: string | null;
  target_kind?: ModerationKind;
  target_id?: string;
  reason?: string;
};
export type AdminQueue = { items: AdminItem[]; total: number; hasMore: boolean; offset: number };
export type AdminOverview = {
  days: number;
  today: string;
  views: number;
  todayViews: number;
  firstDay: string | null;
  daily: { day: string; views: number }[];
  pages: { page: string; views: number }[];
  popularCourses: { id: number; name: string; views: number }[];
  content: {
    courses: number;
    reviews: number;
    pendingReviews: number;
    pendingSupplements: number;
    openReports: number;
  };
};
export type ModerationLog = {
  id: string;
  target_kind: ModerationKind;
  target_id: string;
  action: keyof typeof actionLabels;
  reason: string;
  actor: 'cli' | 'admin';
  target_revision: number | null;
  created_at: string;
};
