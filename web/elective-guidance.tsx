import { useState } from 'react';
import type { CourseDetail } from '../shared/catalog';
import {
  academicYear,
  assessCreditModule,
  electivePlans,
  electiveTypes,
  findElectivePlan,
  getMoocAnnualRule,
  type CreditModule,
  type ElectiveOffering,
  type Evidence,
} from '../shared/electives';

function EvidenceLink({ evidence, demo = false }: { evidence: Evidence; demo?: boolean }) {
  if (demo) return <span className="fine-print">虚构演示资料</span>;
  try {
    const url = new URL(evidence.sourceUrl);
    if (url.protocol !== 'https:') return <span className="pending">来源待核实</span>;
    return (
      <a href={url.href} target="_blank" rel="noopener noreferrer" title={evidence.sourceLocator}>
        {evidence.sourceLabel} ↗
      </a>
    );
  } catch {
    return <span className="pending">来源待核实</span>;
  }
}

function MoocNotice({ offering }: { offering: ElectiveOffering }) {
  const rule = getMoocAnnualRule(offering);
  const [alreadyTaking, setAlreadyTaking] = useState('');
  if (!rule) return null;
  return (
    <details className="mooc-notice">
      <summary>{academicYear(offering.startYear)}：网上MOOC公选课每学年限1门</summary>
      <p>超出限选数量的课程成绩无效。此限制针对网上MOOC公选课。</p>
      <label className="elective-choice">
        <span>这个学年是否已修读其他网上MOOC公选课？</span>
        <select value={alreadyTaking} onChange={(event) => setAlreadyTaking(event.target.value)}>
          <option value="">未填写 / 不确定</option>
          <option value="yes">是，已修读其他课程</option>
          <option value="no">否</option>
        </select>
      </label>
      <p role="status" className={alreadyTaking === 'yes' ? 'credit-warning' : 'fine-print'}>
        {alreadyTaking === 'yes'
          ? '再修这门课可能超出年度限选数量；超额课程成绩无效。'
          : '这里只按你的填写提醒，实际修读记录与选课安排请核对教务系统。'}
      </p>
      <EvidenceLink evidence={rule} />
    </details>
  );
}

const moduleLabels: Record<CreditModule, string> = {
  art: '艺术类学分',
  cross_discipline: '其他学科门类学分',
};
const outcomeLabels = {
  counts: '可计入此模块',
  not_counts: '不计入此模块',
  unknown: '待核实',
  conflict: '依据冲突，待核实',
};
const planStorageKey = 'csu-elective-plan';
function readPlanChoice() {
  try {
    const value = localStorage.getItem(planStorageKey) ?? '';
    return value === 'unlisted' || findElectivePlan(value) ? value : '';
  } catch {
    return '';
  }
}

export function ElectiveGuidance({ course }: { course: CourseDetail }) {
  const [planId, setPlanId] = useState(readPlanChoice);
  const plan = findElectivePlan(planId);
  const { facts, offerings, creditRules } = course.elective ?? {
    facts: null,
    offerings: [],
    creditRules: [],
  };
  const demo = course.id < 0;
  function choosePlan(value: string) {
    setPlanId(value);
    try {
      if (value) localStorage.setItem(planStorageKey, value);
      else localStorage.removeItem(planStorageKey);
    } catch {
      /* 当前页面仍可选择方案。 */
    }
  }
  return (
    <section className="elective-guidance" aria-label="公选课资料与学分">
      <dl className="elective-facts">
        <div>
          <dt>公选课类别</dt>
          <dd>{course.electiveType ? electiveTypes[course.electiveType] : '待核实'}</dd>
        </div>
        <div>
          <dt>课程学分</dt>
          <dd>{facts?.credits != null ? `${facts.credits} 学分` : '待补充'}</dd>
        </div>
        <div>
          <dt>适用专业</dt>
          <dd>{facts?.applicablePrograms ?? '待核实'}</dd>
        </div>
      </dl>
      {facts && <p className="elective-source">资料来源：<EvidenceLink evidence={facts} demo={demo} /></p>}
      {offerings.length ? offerings.map((offering) => (
        <div className="elective-offering" key={`${offering.startYear}-${offering.semester}`}>
          <p>
            {academicYear(offering.startYear)}第{offering.semester === 1 ? '一' : '二'}学期 ·{' '}
            {offering.mode === 'mooc' ? '网上MOOC' : '面授'}
            {offering.platform && ` · ${offering.platform}`}
            {offering.originUniversity && ` · ${offering.originUniversity}`}
            {(offering.sourceUrl !== facts?.sourceUrl || offering.sourceLocator !== facts?.sourceLocator) && (
              <><br /><EvidenceLink evidence={offering} demo={demo} /></>
            )}
          </p>
          {!demo && <MoocNotice offering={offering} />}
        </div>
      )) : <p className="fine-print">开课学期与学习方式待核实。</p>}
      <details className="credit-guidance">
        <summary>查看培养方案学分认定</summary>
        <label className="elective-choice">
          <span>培养方案（可选）</span>
          <select value={planId} onChange={(event) => choosePlan(event.target.value)}>
            <option value="">请选择与你适用版本一致的方案</option>
            {electivePlans.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
            <option value="unlisted">我的方案尚未收录</option>
          </select>
        </label>
        {plan ? <>
          <p>
            本方案文化素质类选修至少 {plan.total} 学分，其中艺术类 {plan.modules.art} 学分、
            其他学科门类 {plan.modules.cross_discipline} 学分。 <EvidenceLink evidence={plan} />
          </p>
          <dl className="credit-results" aria-live="polite">
            {(Object.keys(moduleLabels) as CreditModule[]).map((module) => {
              const assessment = assessCreditModule(plan.id, module, demo ? [] : creditRules);
              return (
                <div key={module}>
                  <dt>{moduleLabels[module]}</dt>
                  <dd>
                    <strong className={`credit-${assessment.outcome}`}>{outcomeLabels[assessment.outcome]}</strong>
                    {assessment.evidence.length ? assessment.evidence.map((rule, index) => (
                      <p key={index}>{rule.reason} <EvidenceLink evidence={rule} /></p>
                    )) : <p className="fine-print">尚缺这门课适用于此方案的认定依据。</p>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </> : <p className="fine-print" role="status">{planId === 'unlisted'
          ? '此方案尚未收录，暂时无法判断本课程可计入哪些学分模块。'
          : '按专业与培养方案版本核对学分；这里只收录已有官方依据的方案版本。'}</p>}
        <p className="fine-print">艺术体育类别不等于艺术学分资格；同学院开课也不能直接判为不计学分。模块认定与选课许可分别核实。</p>
      </details>
    </section>
  );
}
