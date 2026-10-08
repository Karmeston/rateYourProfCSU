# 课程浏览与评价体验改造

## 视觉方向与参考

保留原有深蓝页头、浅灰背景、白色卡片和蓝色交互色。通过紧凑导航、清楚的标题层级、统一卡片与间距，让搜索、比较和评价成为连贯流程。使用系统字体和内联 SVG，不引入 UI 组件库或外部图片。

- [Linear 的设计更新](https://linear.app/now/behind-the-latest-design-refresh)：参考导航一致性、安静的表面和清晰层级。
- [Linear 搜索](https://linear.app/docs/search) 与 [筛选](https://linear.app/docs/filters)：参考明确的操作入口、键盘快捷方式和筛选状态。
- [NN/g 的筛选建议](https://www.nngroup.com/articles/applying-filters/)：参考组合筛选、已选条件可见、清除条件保留上下文。

这些页面提供交互与层级参考；本站布局、组件和图标为本项目实现。

## 已实现

课程广场提供名称/代码搜索、专业课/公选课与学院组合筛选、结果数量、四种排序、分页、网格/列表切换。查询条件保存在 URL，进入详情再返回保留原列表条件。收藏按 ID 从可见目录查询，支持相同筛选流程。

详情提供收藏、复制链接及复制失败时的手动链接；完整评价区提供平均分、可点击的星级分布、按星级筛选和最新/赞同最多排序。星级筛选只改变评价列表，总评分始终使用全部公开评价。

投稿使用原生 dialog：键盘焦点、Esc 关闭、必填星级、字数限制、发送状态与成功反馈。未提交草稿按对象留在当前标签页，关闭后可恢复；保留提交 UUID 避免原样重试重复发布。已发布草稿清除。原有匿名评价、赞同/不赞同和单层回复保留并整理为可读组件。

收藏和布局偏好保存在当前浏览器，无登录、跨设备同步或账号入口。存储失败时给出反馈。资料占位包含培养方案、学分、适用专业、考核方式及大纲，不把缺失数据显示成事实，也不设置无法使用的按钮。学校官网采集数据仍保存在 `data/course-data/`，本次不自动导入。

页面覆盖加载、空收藏、无结果、超出页码、请求失败与非法链接。移动端重排导航、筛选和卡片，详情侧栏移至评价区后；提供可见键盘焦点、主要内容跳转和减少动画支持。

## 代码结构

`web/main.tsx` 仅负责站点框架、导航与页面选择。目录、详情、指南、收藏、通用状态、路由、评价和互动分为独立模块。`shared/catalog.ts` 统一前后端课程结构与枚举，`src/course-catalog.ts` 管理查询。排序使用固定白名单，SQL 外部输入均参数绑定。沿用原数据库结构，不修改已执行迁移。

测试覆盖组合筛选、分页与统计、排序与无评分、隐藏课程隔离、收藏去重、非法参数、评价星级筛选与赞同排序、返回路由与草稿恢复。已有评价提交去重、投票与回复、迁移约束测试继续保留。

## 本地演示与验收

以下命令只操作 `tmp/ui-preview-d1` 内的独立本地数据库。`seeds/preview.sql` 是明确标注的虚构课程/评价，不能用于远程数据库：

```sh
npm run build:client
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to tmp/ui-preview-d1
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to tmp/ui-preview-d1 --file seeds/preview.sql
node node_modules/wrangler/bin/wrangler.js dev --local --persist-to tmp/ui-preview-d1 --port 8787
```

打开 `http://127.0.0.1:8787`。修改前端后重新执行 `npm run build:client` 并刷新浏览器。

2026-10-08 浏览器人工验收：名称/代码搜索、类型与学院组合、排序、收藏与刷新恢复、列表切换、详情返回原查询、链接复制、星级筛选、草稿关闭恢复、评价发布、赞同和回复。移动端使用 390px 与 320px 宽度检查布局、横向溢出及投稿弹窗；演示写入仅发生在上述独立本地数据库。

最终检查：`npm run typecheck`、`npm test`（39 项通过）、`npm run build` 均通过。build 包含 Worker dry-run，不发布。界面截图：[桌面首页](screenshots/course-home-desktop.jpg)、[手机首页](screenshots/course-home-mobile.jpg)。截图使用明确标注的本地虚构数据。

## Git 与回退

分支：`codex/course-experience`。

改造前的课程采集成果已单独提交为 `b53f56d`，并标记 `codex/ui-baseline-20261008`。接口增强提交为 `083a0e6`，界面改造另行提交，最终预览标记为 `codex/ui-preview-20261008`。没有部署，也没有远程迁移或生产数据库写入。

查看改造前版本可创建独立 worktree，保留当前工作：

```sh
git worktree add ../rateProf-ui-baseline codex/ui-baseline-20261008
```

需要撤销本轮提交时，先确认工作区干净，再使用 `git log --oneline codex/ui-baseline-20261008..HEAD` 查看本轮提交，依次从最新到最旧执行 `git revert <提交号>`。这会新增回退提交，保留历史与先前采集成果。截图和本地演示数据库不代表线上数据。
