import type { Evidence } from './electives.ts';

export type CourseMaterial = Evidence & {
  kind: 'syllabus' | 'curriculum';
  sourceYear: number;
  department: string;
  program: string | null;
  credits: number | null;
  requirement: '必修' | '选修' | null;
};
