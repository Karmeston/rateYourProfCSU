import { electivePlans } from '../shared/electives';

const githubProjectUrl = 'https://github.com/Karmeston/rateYourProfCSU';

export function Guide() {
  return (
    <div className="guide-page">
      <h1>使用指南</h1>
      <section className="guide-faq">
        <details>
          <summary>怎么按自己的专业找课？</summary>
          <p>
            在课程广场选择“培养方案专业”和方案版本。普通班、强基或卓越等专项方案分别保留。结果来自已收录的方案记录，可能包含辅修课程，不代表本学期开课或个人选课资格。
          </p>
        </details>
        <details>
          <summary>能修改或撤回自己的评价吗？</summary>
          <p>
            同一匿名访客对同一课程保留一条评价，可在原浏览器修改或撤回；撤回后不再公开，也不计入评分。重新发布沿用原记录，不会多计一票。被隐藏的评价修改后须重新审核。
          </p>
          <p>
            身份由本站匿名Cookie识别。清除Cookie、Cookie过期或更换浏览器后，无法认领之前的评价；早期未关联访客的评价也不能自动认领。此限制按浏览器访客执行，不等于实名去重。
          </p>
        </details>
        <details>
          <summary>如何补充课程资料或举报内容？</summary>
          <p>
            课程详情的“学习资料”面向往年试卷、复习笔记、作业参考等学习材料，支持分享资料链接，也可补充考核经验和纠错信息。提交后须审核，目前不支持直接上传文件。评价、回复和补充资料均可举报，重复举报不会自动下架内容。
          </p>
          <p>
            在原浏览器展开“管理我的补充资料”，可修改或撤回自己的提交；修改或重新提交须再次审核。撤回后不再公开，管理员恢复不会覆盖作者的撤回。清除Cookie或更换浏览器后，无法管理原来的资料。
          </p>
        </details>
        <details>
          <summary>公选课具体需要修多少学分？</summary>
          <p>
            文化素质类选修的要求按专业和培养方案版本核对。目前已核实以下版本，课程详情可选择对应方案：
          </p>
          <ul className="guide-credit-plans">
            {electivePlans.map((plan) => (
              <li key={plan.id}>
                {plan.name}：至少 {plan.total} 学分（艺术类 {plan.modules.art}、其他学科门类{' '}
                {plan.modules.cross_discipline}）。{' '}
                <a
                  href={plan.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={plan.sourceLocator}
                >
                  官方依据 ↗
                </a>
              </li>
            ))}
          </ul>
          <p>
            方案版本不一定等于入学年份；强基等专项方案须单独核对。单门课程的学分见详情，是否满足某模块仍需课程认定依据。
          </p>
        </details>
        <details>
          <summary>公选课类别能说明是否计入培养方案吗？</summary>
          <p>
            类别用于查找课程。艺术体育类不一定满足艺术学分要求，同学院开课也不能直接判为不计学分。课程详情可选择已收录的培养方案，分模块查看认定依据；未核实的规则显示“待核实”。
          </p>
        </details>
        <details>
          <summary>评价和补充资料的草稿保存在哪里？</summary>
          <p>
            草稿保存在当前标签页，关闭表单后可恢复，提交成功后清除；修改草稿按原记录和版本分别保存。
          </p>
        </details>
        <details>
          <summary>评价会显示我的姓名吗？</summary>
          <p>评价以匿名同学展示，请不要在正文中填写手机号、学号等个人信息。</p>
        </details>
        <details>
          <summary>课程评分如何计算？</summary>
          <p>
            评分是全部已发布且未撤回评价的星级平均值。修改会更新原评分，撤回或隐藏后不计入评分。筛选、排序和赞同操作不改变总评分。
          </p>
        </details>
        <details>
          <summary>为什么有的课程没有学习资料？</summary>
          <p>
            该课程尚无审核通过的同学投稿。培养方案和课程大纲不作为学习资料展示；往年试卷、复习笔记等需要同学分享真实资料链接。
          </p>
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
