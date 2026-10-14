# 专业筛选与匿名社区维护

更新日期：2026-10-14。资料补充现支持本人修改、撤回与重新提交；实际线上版本、数据与回退见[部署记录](deployment-20261012.md)。

## 按方案找课

课程广场新增培养方案专业和版本筛选，名称沿用正式材料中的专业/班型名称，不把普通班和强基、卓越等专项方案合并。选择专业时限定专业课；切换全部课程或公选课会清除方案筛选。搜索、学院、排序、分页和返回链接继续组合使用。

API使用`program`与`planYear`，版本需同时指定专业。采用方案资料表的精确匹配和EXISTS查询，多个来源不会让课程计数重复；选中的原表学分、必选修属性分别显示。下拉选项只来自可见课程的已收录方案。未收录版本保留在筛选条件中，返回空结果，不偷偷切换到其他版本。结果可能包含辅修表，不代表当期开课或个人选课资格。

## 一条评价的归属与生命周期

新评价关联服务端验证的匿名访客Cookie。前端不能指定访客ID，公共和本人接口均不返回访客标识；本人信息由当前Cookie推导。已有未关联访客的评价保留，无法根据公开UUID、正文、localStorage或旧请求头认领。

数据库对每个课程/教师和非空访客ID建立唯一索引，覆盖所有审核及撤回状态。同一访客不能通过换提交UUID、换学期、撤回后另发一条来重复计分。不同浏览器仍可能是不同访客，这不是实名身份或跨设备去重；Cookie清除、180天有效期结束或更换浏览器后不能恢复旧评价的管理权限。

评价可选填学年学期和任课教师，展示为同学自述，不改变官方开课信息。整体评分仍只有1–5星一项。

| 操作 | 结果 |
| --- | --- |
| 首次发表 | 保存一条关联访客的公开评价 |
| 同提交编号、同内容重试 | 返回成功，不增加评价或评分 |
| 新编号再次评分 | 返回409，提示修改原评价 |
| 修改 | 更新原记录和评分，显示修改日期，不生成第二票 |
| 撤回 | 保存撤回时间，不公开、不计入平均分与数量，相关互动入口关闭 |
| 重新提交撤回的评价 | 沿用原记录；正常公开状态可重新计入，隐藏状态须审核 |
| 管理工具隐藏后由作者修改 | 转为待审核，不自动恢复公开 |
| 管理工具恢复已撤回记录 | 仍保持撤回，不覆盖作者决定 |

修改和撤回携带`revision`。过期版本返回409；成功操作的原样网络重试可识别，不反复增加版本。管理操作也更新版本，避免作者和维护者操作互相覆盖。草稿继续存于sessionStorage，编辑草稿按评价ID及版本隔离；清除后不保留新草稿。

## 资料补充与举报

课程详情“同学补充资料”支持考核/作业、公开学习资料、信息纠错和其他补充，接受正文、可选HTTPS来源、学期和教师，不接收文件上传。默认待审核，仅提交者可看到自己的待审核/未通过内容。审核通过后单独展示为同学补充，不直接写入官方方案表、公选课事实或学分认定规则。

“管理我的补充资料”包含本人的所有状态，包括已发布和已撤回记录，独立分页。本人可修改原记录，修改或重新提交一律转为待审核；撤回保留内容和审核历史，不再公开、不能举报，也不进入待审队列。管理工具恢复或批准不清除作者撤回时间。归属只由签名Cookie判定，清除Cookie或更换浏览器不能认领旧资料。

修改和撤回携带`revision`，与审核共享版本检查；成功结果的原样重试不重复操作。编辑草稿按记录ID和版本隔离，取消时返回原按钮，保存后的刷新会替换旧记录，焦点返回稳定的补充入口。

评价、回复和已审核补充资料均支持举报。每个访客对同一内容只记录一条举报；不公开举报人或举报详情，不因举报数量自动隐藏内容。维护者检查内容后操作相应记录，再将举报标为已处理或不采纳。举报和补充使用现有匿名Cookie、跨站写入检查、请求体限制、访客与网络频率限制。

## 最小管理工具

`scripts/moderate.mjs`默认通过`--persist-to`操作项目内本地D1；只有显式指定`--remote`才通过已登录的Wrangler维护配置中的线上DB。线上使用现有Cloudflare账户权限，没有公开管理API、管理Cookie或学生登录。SQLite负责安全展开绑定参数；状态变更与日志在一次事务请求中提交，写入结果不确定时不自动重试，应先inspect查看当前版本。

```powershell
# 线上队列：需要先登录具有本项目D1写入权限的Cloudflare账户
node --env-file-if-exists=.env.deploy --require ./scripts/cloudflare-network.cjs scripts/moderate.mjs --remote queue

# 本地查看举报、待审核资料及待审核评价（每类最多50条，处理后再次查看）
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 queue

# 将实际UUID与revision从queue/inspect复制，下面的字符串是占位
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 inspect course_review '评价UUID'
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 hide course_review '评价UUID' 0 '核对后的隐藏理由'
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 restore course_review '评价UUID' 1 '核对后的恢复理由'
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 approve supplement '资料UUID' 0 '公开来源已检查'
node scripts/moderate.mjs --persist-to tmp/ui-preview-d1 resolve report '举报UUID' 0 '已处理对应内容'
```

| 类型 | 操作 |
| --- | --- |
| course_review / teacher_review | hide、restore、approve |
| course_reply / teacher_reply | hide、restore |
| supplement | approve、reject、hide、restore |
| report | resolve、dismiss |

每次操作必须填写处理理由、提供当前版本。状态变更和处理日志在同一个原子batch中写入，唯一操作标记确保过期或竞争失败的操作不会留下成功日志。工具输出不包含访客ID。记录保留，可以恢复；工具不删除评价、资料或举报。处理举报不会自动改动被举报内容。

## 接口与模块

- `GET /api/courses?program=...&planYear=2023`返回方案筛选、专业/版本选项和所选原表记录。
- `GET /api/{courses|teachers}/:id/reviews`增加`myReview`、自述背景、本人标记和修改日期。本人记录不受公开列表星级与分页限制。
- `POST`原评价路径增加可选`term`（例如`2025-1`）、`teacherName`。
- `PUT /api/{courses|teachers}/:id/reviews/:reviewId`接收`revision`、`rating`、`body`与可选背景。
- `DELETE`同一路径接收JSON`{"revision":0}`，仅标记撤回。
- `GET /api/courses/:id/supplements?offset=0&mineOffset=0`返回`supplements`和`mine`，各自每页20条、使用独立的`hasMore`/`hasMoreMine`。没有有效Cookie时不查询本人列表。公开列表只含已发布且未撤回资料，本人列表包含全部状态。
- 同路径`POST`提交待审核资料；`PUT /api/courses/:id/supplements/:supplementId`接收`revision`与补充内容，`DELETE`同一路径接收JSON`{"revision":0}`标记撤回。
- 内容路径后追加`/reports`提交举报：评价、`/replies/:replyId`、`/supplements/:supplementId`。JSON包含`id`、`reason`、`details`。

共用类型与背景输入在`shared/community.ts`、`src/community-input.ts`。`src/community.ts`装配路由并验证访客，资料生命周期在`src/course-supplements.ts`，举报接收在`src/content-reports.ts`；评分查询和归属在`src/reviews.ts`。前端补充表单、本人操作和公开列表分别维护，不增加通用服务层或新依赖。

## 验证与回退

生产迁移`0008_community.sql`已应用于本地与线上，旧迁移未修改。`npm run check`通过：77项测试、前后端类型检查、Vite构建及Worker dry-run。API回归测试覆盖专业/班型与版本筛选、分页及隐藏资料、并发重复评分、旧记录拒绝认领、不同访客越权、修改/撤回重试、评分更新、隐藏后重新审核、待审核队列、补充审核、举报去重和回复隐藏/恢复。本地及线上管理队列命令执行成功；新增发行SQL重放、冲突回滚、线上维护参数展开与不盲目重试的回归测试。

2026-10-14增量验证：新增`0009_supplement_ownership.sql`，保留已有资料、审核版本和日志关联，增加修改/撤回时间及本人分页索引。86项测试覆盖越权、并发修改与审核、修改后重新审核、撤回与管理恢复、独立分页、重试、迁移保留和隐藏课程。隔离预览已实际走通资料投稿、草稿恢复、已发布资料修改、撤回和重新提交，以及评价发布、修改与撤回。320/390/768/1280像素视口检查通过；修复320像素评价弹窗的横向溢出、加载时误标版本未收录和嵌套折叠事件。测试使用桌面浏览器视口，手机实机软键盘尚未验收。

本轮代码基线为`codex/supplement-ownership-baseline-20261014`（`f029490`），本地迁移前备份为`tmp/supplement-ownership-baseline-20261014`。已产生撤回资料后，旧Worker不识别`withdrawn_at`，不能直接将旧代码发布为回退；兼容回退仍须保留公开列表、举报及审核队列的撤回过滤。保留当前数据，不倒退迁移或覆盖后续用户写入。

基线提交`dbe751d`，标签`codex/community-features-baseline-20261011`。应用迁移前，已确认预览服务停止并完整复制本地数据库至`tmp/community-features-baseline-20261011`。代码回退使用独立工作树；精确恢复旧预览时用该备份的副本运行，保留当前数据库和后续评价。Git回退不自动恢复数据库；不要修改或倒退已应用迁移。
