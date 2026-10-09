export const electiveTypes = {
  natural_science: '自然科学',
  humanities: '人文社科',
  economics: '经济管理',
  arts_sports: '艺术体育',
} as const;
export type ElectiveType = keyof typeof electiveTypes;
export type ElectiveTypeFilter = ElectiveType | 'unknown' | '';
export function isElectiveTypeFilter(value: string): value is ElectiveTypeFilter {
  return value === '' || value === 'unknown' || Object.hasOwn(electiveTypes, value);
}

export type Evidence = { sourceUrl: string; sourceLabel: string; sourceLocator: string };
export type CreditModule = 'art' | 'cross_discipline';
export type CreditRule = Evidence & {
  planId: string;
  module: CreditModule;
  outcome: 'counts' | 'not_counts';
  reason: string;
};
export type ElectiveOffering = Evidence & {
  startYear: number;
  semester: 1 | 2;
  mode: 'mooc' | 'classroom';
  platform: string | null;
  originUniversity: string | null;
};
export type ElectiveDetails = {
  facts: (Evidence & {
    electiveType: ElectiveType | null;
    credits: number | null;
    applicablePrograms: string | null;
  }) | null;
  offerings: ElectiveOffering[];
  creditRules: CreditRule[];
};

// Reviewed requirements are scoped to a named plan version, never inferred from the college.
export const electivePlans = [
  {
    id: 'electrical-2025',
    name: '电气工程及其自动化 · 2025版',
    total: 6,
    modules: { art: 2, cross_discipline: 4 },
    sourceUrl: 'https://see.csu.edu.cn/info/1126/1308.htm',
    sourceLabel: '电气工程及其自动化2025版培养方案',
    sourceLocator: '七、课程体系；文化素质类选修要求',
  },
  {
    id: 'bioengineering-2023',
    name: '生物工程 · 2023版',
    total: 6,
    modules: { art: 2, cross_discipline: 4 },
    sourceUrl: 'https://mpb.csu.edu.cn/__local/6/F3/53/9130454FC207AFD31EBCA5B6B1E_FAF76F09_DF087.pdf',
    sourceLabel: '生物工程2023版培养方案',
    sourceLocator: 'PDF第8–9页，文化素质类选修要求',
  },
  {
    id: 'biotechnology-2023',
    name: '生物技术 · 2023版',
    total: 6,
    modules: { art: 2, cross_discipline: 4 },
    sourceUrl: 'https://mpb.csu.edu.cn/__local/B/F4/F2/FF0DC62CE36406F193B02B69039_690435BF_DDFB9.pdf',
    sourceLabel: '生物技术2023版培养方案',
    sourceLocator: 'PDF第8–9页，文化素质类选修要求',
  },
  {
    id: 'environmental-2023',
    name: '环境工程 · 2023版',
    total: 6,
    modules: { art: 2, cross_discipline: 4 },
    sourceUrl: 'https://smse.csu.edu.cn/__local/3/3C/9B/2A71B139E5C84370965CC3B9AE5_91E09011_44B55.pdf',
    sourceLabel: '环境工程2023版培养方案',
    sourceLocator: 'PDF第7页，文化素质类选修要求',
  },
  {
    id: 'mathematics-strong-2024',
    name: '数学与应用数学（强基计划）· 2024版',
    total: 6,
    modules: { art: 2, cross_discipline: 4 },
    sourceUrl: 'https://math.csu.edu.cn/__local/1/14/72/C1DDB9BD00FB45D721DA51C8FA7_005556E3_735FC.pdf',
    sourceLabel: '数学与应用数学强基计划2024版培养方案',
    sourceLocator: 'PDF第7页，文化素质类选修要求',
  },
] as const;
export type ElectivePlan = (typeof electivePlans)[number];
export function findElectivePlan(id: string) {
  return electivePlans.find((plan) => plan.id === id) ?? null;
}

export function assessCreditModule(
  planId: string,
  module: CreditModule,
  rules: CreditRule[],
): { outcome: 'counts' | 'not_counts' | 'unknown' | 'conflict'; evidence: CreditRule[] } {
  if (!findElectivePlan(planId)) return { outcome: 'unknown', evidence: [] };
  const evidence = rules.filter((rule) => rule.planId === planId && rule.module === module);
  const outcomes = new Set(evidence.map((rule) => rule.outcome));
  return {
    outcome: outcomes.size > 1 ? 'conflict' : evidence[0]?.outcome ?? 'unknown',
    evidence,
  };
}

const moocAnnualRule: Evidence & { maxCourses: number } = {
  maxCourses: 1,
  sourceUrl: 'https://oa.csu.edu.cn/con/PDFPage?JLNM=C2A7465AF8944A2D8B8BBD47419A99D1&YWMC=ZNDX_ZHBG_GGTZ',
  sourceLabel: '2026—2027学年第一学期网上MOOC学习指南',
  sourceLocator: '第二部分第3条；正文第2页',
};
export function getMoocAnnualRule(offering: ElectiveOffering) {
  return offering.mode === 'mooc' && offering.startYear === 2026 && offering.semester === 1
    ? moocAnnualRule
    : null;
}

export function academicYear(startYear: number) {
  return `${startYear}—${startYear + 1}学年`;
}
