import { Icon } from './icons';

const principles = [
  {
    title: '写下真实、具体的体验',
    body: '课程讲什么，节奏如何，作业和考核是什么样？具体的课堂经历比一句“好课”更能帮助别人。',
  },
  {
    title: '给不同选择留一点空间',
    body: '每个人的兴趣、基础和期待都不同。分享你为什么喜欢或不喜欢，也尊重同学的不同感受。',
  },
  {
    title: '把评分和内容一起看',
    body: '分数来自已发布评价的平均值。评价数量少时尤其需要结合文字内容，课程体验也可能随学期变化。',
  },
];

export function Guide() {
  return (
    <div className="guide-page">
      <a className="back-link" href="#/">
        ← 返回课程广场
      </a>
      <p className="eyebrow">A LITTLE HELP</p>
      <h1>让每条体验都有参考价值。</h1>
      <p className="guide-intro">
        这里由同学的真实经历慢慢搭建。我们希望你更容易做出适合自己的选择。
      </p>
      <div className="guide-grid">
        {principles.map((principle, index) => (
          <section className="sidebar-panel" key={principle.title}>
            <span className="guide-number">0{index + 1}</span>
            <h2>{principle.title}</h2>
            <p>{principle.body}</p>
          </section>
        ))}
      </div>
      <section className="guide-storage sidebar-panel">
        <Icon name="bookmark" size={28} />
        <div>
          <h2>留一份自己的选课清单</h2>
          <p>
            点击课程上的收藏图标即可保存。收藏留在当前浏览器，不需要登录；更换设备或清除浏览器数据后不会自动恢复。未提交的评价草稿保存在当前标签页，提交成功后会清除。
          </p>
        </div>
        <a className="secondary-button" href="#/saved">
          查看我的收藏 <Icon name="arrow" size={16} />
        </a>
      </section>
      <section className="guide-faq">
        <h2>你可能还想知道</h2>
        <details>
          <summary>评价会显示我的姓名吗？</summary>
          <p>页面以匿名同学展示评价。请不要在正文中填写手机号、学号等个人信息。</p>
        </details>
        <details>
          <summary>为什么有些课程资料显示“待补充”？</summary>
          <p>
            尚未核实的学分、适用专业和考核方式会保留明确占位。课程是否在本学期开设，请以学校通知为准。
          </p>
        </details>
        <details>
          <summary>点赞会改变课程评分吗？</summary>
          <p>不会。赞同与不赞同用于表达对某条评价的看法，课程评分仅由已发布评价的星级计算。</p>
        </details>
      </section>
    </div>
  );
}
