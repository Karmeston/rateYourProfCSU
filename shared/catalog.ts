import type { ElectiveDetails, ElectiveType, ElectiveTypeFilter } from './electives.ts';
import type { CourseMaterial } from './course-materials.ts';

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
export type CourseCategoryFilter = CourseCategory | 'unknown' | '';
export type CourseSort = 'default' | 'rating' | 'reviews' | 'name';
export type Course = {
  id: number;
  code: string | null;
  name: string;
  department: string;
  category: CourseCategory | null;
  electiveType: ElectiveType | null;
  departmentSourceYear: number | null;
};
export type CourseDetail = Course & {
  elective: ElectiveDetails | null;
  materials: CourseMaterial[];
};
export type CourseSummary = Course & {
  average: number | null;
  reviewCount: number;
  planRecords?: (Pick<CourseMaterial, 'program' | 'credits' | 'requirement'> & {
    sourceYear: number | null;
  })[];
};
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
  program: string;
  planYear: string;
  sort: CourseSort;
  facets: {
    departments: { name: string; count: number }[];
    programs: { name: string; years: (number | null)[] }[];
  };
  stats: { courseCount: number; reviewCount: number; reviewedCourseCount: number };
};
export const courseCategories = { major: '专业课', elective: '公选课' } as const;
export const courseCategoryFilters = { ...courseCategories, unknown: '类别待核实' } as const;
export function planVersionLabel(year: string | number | null) {
  return year === null || year === 'unknown' ? '版本未标注' : `${year}版`;
}
export const courseSorts = {
  default: '默认顺序',
  rating: '评分优先',
  reviews: '评价最多',
  name: '课程名称',
} as const;
