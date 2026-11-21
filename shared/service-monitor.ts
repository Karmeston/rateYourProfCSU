export const serviceGroups = {
  catalog: '目录查询',
  course: '课程详情',
  reviews: '评价读取',
  interaction: '评价与互动提交',
  visitor: '匿名访客',
  traffic: '浏览量上报',
  admin: '后台管理',
  other: '其他接口',
} as const;

export const serviceEvents = {
  rate_limit: '短时限流',
  d1_limit: '数据库日额度耗尽',
  server_error: '服务异常',
} as const;

export const quotaOperations = {
  catalog: '目录查询',
  program: '专业查课',
  facets: '筛选选项',
  content: '详情与评价读取',
  interaction: '评价与互动提交',
  traffic: '浏览量上报',
} as const;

export type ServiceEvent = keyof typeof serviceEvents;
export type ServiceGroup = keyof typeof serviceGroups;
export type ServiceStatus = {
  days: number;
  today: string;
  firstDay: string | null;
  operations: {
    operation: keyof typeof quotaOperations;
    allowed: number;
    networkLimited: number;
    budgetLimited: number;
    used: number;
    budget: number;
  }[];
  signals: { group: ServiceGroup; event: ServiceEvent; count: number }[];
};
