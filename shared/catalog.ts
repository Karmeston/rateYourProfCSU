import type { ElectiveDetails, ElectiveType, ElectiveTypeFilter } from './electives.ts';

export type Teacher = { id: number; name: string; department: string; profile_url: string | null };
export type TeacherCatalog = {
  teachers: Teacher[];
  limit: number;
  offset: number;
  q: string;
  category: string;
  hasMore: boolean;
};

export type CourseCategory = 'major' | 'elective';
export type CourseSort = 'default' | 'rating' | 'reviews' | 'name';
export type Course = {
  id: number;
  code: string | null;
  name: string;
  department: string;
  category: CourseCategory | null;
  electiveType: ElectiveType | null;
};
export type CourseDetail = Course & { elective: ElectiveDetails | null };
export type CourseSummary = Course & { average: number | null; reviewCount: number };
export type CourseCatalog = {
  courses: CourseSummary[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  q: string;
  category: string;
  electiveType: ElectiveTypeFilter;
  department: string;
  sort: CourseSort;
  facets: { departments: { name: string; count: number }[] };
  stats: { courseCount: number; reviewCount: number; reviewedCourseCount: number };
};
export const courseCategories = { major: '专业课', elective: '公选课' } as const;
export const courseSorts = {
  default: '默认顺序',
  rating: '评分优先',
  reviews: '评价最多',
  name: '课程名称',
} as const;
