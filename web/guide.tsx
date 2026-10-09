import { electivePlans } from '../shared/electives';

const githubProjectUrl = 'https://github.com/Karmeston/rateYourProfCSU';

export function Guide() {
  return (
    <div className="guide-page">
      <h1>使用指南</h1>
      <section className="guide-faq">
        <details>
          <summary>公选课具体需要修多少学分？</summary>
          <p>文化素质类选修的要求按专业和培养方案版本核对。目前已核实以下版本，课程详情可选择对应方案：</p>
          <ul className="guide-credit-plans">
            {electivePlans.map((plan) => (
              <li key={plan.id}>
                {plan.name}：至少 {plan.total} 学分（艺术类 {plan.modules.art}、其他学科门类 {plan.modules.cross_discipline}）。{' '}
                <a href={plan.sourceUrl} target="_blank" rel="noopener noreferrer" title={plan.sourceLocator}>官方依据 ↗</a>
              </li>
            ))}
          </ul>
          <p>方案版本不一定等于入学年份；强基等专项方案须单独核对。单门课程的学分见详情，是否满足某模块仍需课程认定依据。</p>
        </details>
        <details>
          <summary>公选课类别能说明是否计入培养方案吗？</summary>
          <p>类别用于查找课程。艺术体育类不一定满足艺术学分要求，同学院开课也不能直接判为不计学分。课程详情可选择已收录的培养方案，分模块查看认定依据；未核实的规则显示“待核实”。</p>
        </details>
        <details>
          <summary>评价草稿保存在哪里？</summary>
          <p>评价草稿保存在当前标签页，关闭表单后可恢复，发布成功后清除。</p>
        </details>
        <details>
          <summary>评价会显示我的姓名吗？</summary>
          <p>评价以匿名同学展示，请不要在正文中填写手机号、学号等个人信息。</p>
        </details>
        <details>
          <summary>课程评分如何计算？</summary>
          <p>评分是全部已发布评价的星级平均值。筛选、排序和赞同操作不改变总评分。</p>
        </details>
        <details>
          <summary>课程资料显示“待补充”是什么意思？</summary>
          <p>资料尚未核实。学分、考核方式和当期开课信息请以学校通知与培养方案为准。</p>
        </details>
      </section>
      <section className="guide-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">反馈与支持</h2>
        <p>
          课程资料有误、学分规则需要补充，或使用时遇到问题，欢迎通过{' '}
          <a href={`${githubProjectUrl}/issues`} target="_blank" rel="noopener noreferrer">
            GitHub Issue
          </a>{' '}
          反馈。请附课程名称或代码、适用专业与培养方案版本、问题描述和公开资料链接，方便核对。
        </p>
        <p>
          GitHub 项目：{' '}
          <a href={githubProjectUrl} target="_blank" rel="noopener noreferrer">
            Karmeston/rateYourProfCSU ↗
          </a>
        </p>
        <p>如果这个项目对你有帮助，欢迎在 GitHub 点一个 Star，支持持续维护。</p>
      </section>
    </div>
  );
}
