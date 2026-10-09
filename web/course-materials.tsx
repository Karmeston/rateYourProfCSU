import type { CourseDetail } from '../shared/catalog';
import { EvidenceLink } from './source-link';

export function CourseMaterials({ course }: { course: CourseDetail }) {
  const curricula = course.materials.filter((source) => source.kind === 'curriculum');
  const syllabi = course.materials.filter((source) => source.kind === 'syllabus');
  return (
    <details className="course-info course-materials">
      <summary>培养方案与课程资料 <span className="fine-print">{curricula.length} 条方案记录</span></summary>
      <p className="fine-print">以下为有来源的方案课程表记录，可能包含辅修表。学分与必选修属性按对应原表核对；不代表本学期开课或适用于其他方案版本。</p>
      <ul>
        {curricula.map((source, index) => (
          <li key={`${source.sourceUrl}-${index}`}>
            <strong>{source.program}方案 · {source.sourceYear}版</strong>
            <p>{source.department} · {source.requirement ?? '属性待核实'} · {source.credits === null ? '学分待核实' : `${source.credits} 学分`} · <EvidenceLink evidence={source} label="官方原文" /></p>
            <p className="fine-print">{source.sourceLocator}</p>
          </li>
        ))}
      </ul>
      {syllabi.map((source, index) => (
        <p className="fine-print" key={`${source.sourceUrl}-${index}`}>
          {source.sourceYear}版大纲 · {source.department} · <EvidenceLink evidence={source} label="官方原文" />
        </p>
      ))}
    </details>
  );
}
