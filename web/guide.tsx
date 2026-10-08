export function Guide() {
  return (
    <div className="guide-page">
      <h1>使用指南</h1>
      <section className="guide-faq">
        <details>
          <summary>收藏与草稿保存在哪里？</summary>
          <p>
            收藏保存在当前浏览器，更换设备或清除浏览器数据后不会自动恢复。评价草稿保存在当前标签页，发布成功后清除。
          </p>
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
    </div>
  );
}
