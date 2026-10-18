# rateMyProfCSU

面向中南大学学生的课程评价平台。保留深蓝导航、灰白背景和蓝色交互色，以课程广场和使用指南作为主要入口。

课程支持名称/代码搜索、类型与学院组合筛选、培养方案专业与版本筛选、评分/评价数量/名称排序、网格与列表切换。详情可复制分享链接、保留筛选返回列表；评价支持星级筛选、最新评论/赞同最多排序、匿名投稿、草稿恢复、赞同与单层回复，以及选填学期、任课教师。同一匿名访客对同一课程保留一条评价，可修改或撤回；用户可补充课程资料并管理自己的提交，修改或重新提交后须审核，撤回后不公开，评价、回复和补充均支持举报。没有评价时不显示零分。

教师页面当前由 `web/features.ts` 的开关关闭，旧教师页面链接返回课程广场；独立教师 API 继续保留。开启后提供教师搜索、详情与评价。当前发行目录可见864门课程（专业课846、公选课18），保留原有目录和评价。核对数据集包含840门专业/学科课程；线上有一条无代码同名记录等待核对，因此未强行合并。列表每页24门，桌面三列、平板两列排满，卡片不显示大纲年份及逐版本方案段落；筛选与回退见[列表改造说明](docs/catalog-layout-20261015.md)。

设计依据、验收记录与回退方式见 [界面改造说明](docs/ui-improvements.md)。

公选课支持细分类筛选，详情提供培养方案选择、分模块认定提示与已核实学年的MOOC限选提醒。课程分类与学分认定分别核实，缺少证据时显示待核实。规则依据见 [公选课认定调研](docs/elective-credit-research.md)，实现与回退方式见 [公选课功能说明](docs/elective-guidance.md)。

课程详情的“学习资料”面向往年试卷、复习笔记、作业参考等真实学习材料，支持同学分享资料链接及考核经验，审核后展示，目前不支持直接上传文件。官方大纲、培养方案记录及成排的待补充字段不再作为学习资料展示；后台保留这些课程元数据，用于目录、专业筛选及公选课学分说明。学院可能沿用来源版本的历史单位，不能据此认定当前开课单位。课程收录标准和复现见[专业课目录说明](docs/major-catalog.md)。

管理后台支持流量概况、资料/评价/回复审核、举报原文处理和操作日志；使用独立管理员口令，学生仍无需账号。入口与初始化见[后台说明](docs/admin.md)。显式线上命令行维护继续使用Wrangler Cloudflare账户认证，两种入口共用审核逻辑。归属规则见[匿名社区功能说明](docs/community-features.md)。线上地址：[课程广场](https://rate-your-prof-csu.karmeston.workers.dev/#/courses)。隔离预览已完成320/390/768/1280像素视口与主要社区表单流程验收，手机实机软键盘尚待验收。发行、数据和回退记录见[部署记录](docs/deployment-20261012.md)。

## 技术与目录

TypeScript、React、Vite、Hono、Cloudflare Workers、D1；不依赖常驻进程或线上本地磁盘。

- `web/`：前端页面、系统字体样式、静态资源缓存。
- `src/index.ts`：路由挂载、健康检查和统一错误处理。
- `src/course-catalog.ts`、`src/teacher-catalog.ts`：对应目录的查询、参数验证与详情。
- `shared/`：前后端共用的目录类型、筛选枚举和有来源的公选课规则。
- `src/reviews.ts`：评价列表、本人归属、星级统计、投稿、修改与撤回；隐藏后修改须重新审核。
- `src/community.ts`、`src/community-input.ts`：社区路由装配与共用输入验证；资料生命周期在`src/course-supplements.ts`，举报接收在`src/content-reports.ts`；审核工具位于`scripts/moderate.mjs`。
- `web/review-form.tsx`、`web/own-review-actions.tsx`、`web/course-supplements.tsx`：独立表单、本人操作与资料补充组件。
- `src/review-interactions.ts`：投票与回复；`src/review-targets.ts`固定评价相关表名。
- `src/admin*.ts`、`web/admin*.tsx`：独立管理认证、内容查询、概况和按需加载的后台界面；网页与命令行共用`src/moderation.ts`。
- `src/traffic.ts`、`web/traffic.ts`：仅页面分类及公开对象编号的PV统计、幂等上报与定时清理。
- `src/validation.ts`、`src/request-body.ts`：基础ID校验和有大小限制的JSON读取。
- `migrations/`：按顺序执行的迁移，已应用文件不修改。
- `seeds/local.sql`：虚构演示资料，仅用于本地。
- `seeds/preview.sql`：课程界面验收专用的虚构课程与评价，配合独立本地数据库使用。
- `tests/`：临时 D1 API 测试及 SQLite 约束和迁移测试，公共初始化位于`tests/helpers/`。
- `data/`：已整理的官网来源资料，不自动导入数据库。
- `scripts/cloudflare-network.cjs`：部署 CLI 的本机网络兼容配置。

模块职责、维护约定和回退基线见 [项目维护说明](docs/project-maintenance.md)。`HANDOVER.md`保留早期接手快照，当前功能与命令以本README为准。

## 本地运行

使用 Node.js 24（至少 22.18）：

```sh
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

打开终端显示的地址，通常为 http://localhost:8787。演示数据可选，负数 ID 会显示演示标记。修改前端后重新运行 dev 构建。

```sh
npm run check
```

check依次执行类型检查、完整测试和构建；也可单独运行`typecheck`、`test`和`build`。类型检查拒绝未使用的局部声明与参数。build仅打包和dry-run，不发布。测试不修改开发数据库。生成的类型、构建产物、依赖和本地配置不提交Git。

GitHub Actions的`Project checks`在推送和Pull Request时运行同一检查命令，使用Node.js 24，不执行部署。

## API

| GET 接口 | 返回 |
| --- | --- |
| `/api/teachers` | teachers、limit、offset、q、hasMore |
| `/api/courses` | courses、limit、offset、q、category、electiveType、department、program、planYear、sort、total、hasMore、facets、stats |
| `/api/teachers/:id` | teacher |
| `/api/courses/:id` | course |
| `/api/health` | status，仅检查服务响应 |

列表支持 limit（1–100，默认20）、offset（0–100000，默认0）、q（最多100字符），默认按 ID 升序。教师按名称搜索；课程按名称或代码搜索，ASCII 英文不区分大小写。搜索字面匹配，百分号和下划线不是通配符。详情不接受查询参数。重复、未知或非法参数返回400，不存在的详情返回404，数据库故障返回通用500，详细错误仅记服务端日志。

课程列表另支持 category（major/elective/unknown）、department（学院或教学单位精确匹配）、sort（default/rating/reviews/name）。unknown只返回分类为空的课程，不根据编号、理论/实验或必选修属性猜测课程大类。total 为筛选后的总数；facets.departments 为整个可见目录的教学单位及数量；stats 为整个可见目录的课程数、已发布评价数和已评价课程数。评分排序将未评分课程放在最后，并以 ID 保证稳定顺序。URL 保留搜索、类型、教学单位、排序及分页，详情返回时恢复原条件。

专业方案筛选使用`program`（原文专业/班型名）与`planYear`（需同时指定专业），限定专业课。下拉选项来自可见课程的方案记录，版本与专业精确匹配，多个证据不重复计数；列表所选原表资料返回`planRecords`。未标明版本的方案年份为空，下拉显示“版本未标注”，查询参数为`planYear=unknown`。结果不代表当期开课或个人选课资格。新教务目录的离线整理与来源存储见[接入说明](docs/academic-catalog-integration-20261018.md)。

公选课细分类参数 electiveType 接受 natural_science、humanities、economics、arts_sports、unknown；使用时限定公选课，不能与 category=major 组合。unknown 只包含细分类未知的可见公选课。列表课程增加可空 electiveType，详情增加 elective（facts、offerings、creditRules；非公选课为 null）。开课记录包含明确学年学期，不等于每学期持续开设。

课程列表和详情新增可空`departmentSourceYear`，标明学院字段对应的大纲版本；为空时沿用既有学院信息。详情新增`materials`数组，分别保存大纲及方案记录（kind、sourceYear、department、program、credits、requirement和来源定位），单门课程的多个版本不合并为一个学分值。隐藏课程不能读取这些资料。

旧的 `/api/courses/:id/offerings` 已移除。

## 星级评论

`GET /api/teachers/:id/reviews` 与 `GET /api/courses/:id/reviews` 返回 reviews、summary、total、offset、limit、sort、rating、hasMore。接受 offset（0–100000，默认0）、rating（1–5，可省略）与 sort（latest/helpful，默认 latest），每页20条。latest 按 created_at、id 降序；helpful 按赞同数降序、不赞同数升序，再按时间和 ID 降序。total 为匹配星级的评价数量。summary 始终包含所有已公开评价的 count、average 和五星分布，不随筛选或分页变化。没有公开评价时 average 为 null。

相同路径支持 POST JSON：`{ "id": "客户端生成的 UUID v4", "rating": 5, "body": "评论正文" }`，可选`term`（例如`2025-1`）与`teacherName`。新评价关联服务端验证的匿名访客；同访客同对象不能通过换UUID或学期重复评分。列表增加`myReview`及自述背景，但不返回访客标识。星级为1–5整数，正文1–2000个 UTF-16 代码单元，请求体最多8192字节。服务器不接受审核状态或其他字段。原样重试相同 ID 返回202，不重复写入；同 ID 改写内容返回409。本人修改使用`PUT /api/{courses|teachers}/:id/reviews/:reviewId`，携带`revision`及新评分、正文和可选背景。同路径`DELETE`接收JSON`{"revision":0}`标记撤回。评分只统计公开且未撤回的记录；管理恢复不能覆盖作者撤回。

验证阶段的新投稿直接写为 published，提交后刷新评论和评分。公开列表及星级统计只使用 published 且未撤回的记录，既有 pending 和 rejected 不自动公开。被隐藏的评价修改后转为 pending 等待重新审核。用户不能通过 API 指定审核状态；最小本地管理工具负责审核、隐藏、恢复及记录理由。

评论按纯文本渲染，不执行 HTML。前端不收集姓名、学号或联系方式；公开作者统一显示匿名同学。这不代表网络服务商不保留访问日志。当前采用服务端签发的匿名访客 Cookie 和基础频率限制，没有账号登录或 Turnstile。Cookie清除、过期或更换浏览器后无法认领旧评价；历史无归属记录不自动认领。提交去重用于网络重试。

评价草稿按对象保存在 sessionStorage，可关闭表单后恢复；重开草稿保留提交 UUID，原样重试不会重复写入。新投稿改变内容产生新的提交 UUID；编辑保持原评价ID，按ID及版本隔离草稿。成功保存后清除草稿。布局偏好保存在 localStorage；无需账号。收藏功能已移除，旧收藏链接回到课程广场，原收藏存储不再读取或写入。

## 评价互动

每条教师或课程评价包含 likes、dislikes、myVote、replyCount。服务器只认可签名有效且未过期的匿名访客 Cookie；`X-Browser-ID` 不再参与身份判断。公开列表无需 Cookie，携带有效 Cookie 时返回自己的 myVote。旧投票计数保留，旧 localStorage ID 不迁移为可信身份。

以下路径前缀为 `/api/teachers/:id/reviews/:reviewId` 或 `/api/courses/:id/reviews/:reviewId`：

| 方法及后缀 | 用途 |
| --- | --- |
| `PUT /vote` | JSON `{ "value": 1 }` 点赞，-1 点踩，0 取消；必须携带有效访客 Cookie |
| `GET /replies` | 按时间正序返回单层回复，支持 offset，每页20条 |
| `POST /replies` | JSON `{ "id": "UUID v4", "body": "回复" }`，正文1–1000个 UTF-16 代码单元 |

投票按“评价 + 服务端验证的访客 ID”唯一存储，重复请求不会累加。回复使用客户端 ID 避免网络重试重复写入，验证阶段直接公开，保留状态字段。互动只开放给可浏览对象的已公开评价，不计入对象的星级和评价总数。回复区点击后才加载，纯文本显示。

## 匿名访客

浏览课程不建立会话。首次评价、回复或投票前，前端调用 `POST /api/visitor`，提交 JSON `{}`。成功返回204；新访客通过 Set-Cookie 建立身份，有效旧 Cookie 保持不变；响应不暴露访客 ID。并发互动共用一次正在建立的会话。Cookie 被禁用时写入返回401，页面显示允许 Cookie 的提示，草稿保留，不反复签发。

Cookie 使用 Hono 的 HMAC-SHA256 签名，包含版本、随机 UUID 和签发时间，有效期180天，服务端同时检查有效期。HTTPS 使用 `__Host-csu-visitor`，设置 HttpOnly、Secure、SameSite=Strict、Path=/ 且无 Domain；本地回环 HTTP 使用 `csu-visitor`，仅本地省略 Secure。其他 HTTP 地址不能建立访客。所有写入要求 JSON，并拒绝异站 Origin 和 Sec-Fetch-Site=cross-site。

Cloudflare 原生限流绑定配置在 wrangler.jsonc：

| 操作 | 计数范围 | 每60秒额度 |
| --- | --- | --- |
| 新 Cookie 签发 | 网络地址 | 60 |
| 发布评价与回复 | 访客，两类合计 | 8 |
| 投票 | 访客 | 60 |
| 所有互动写入 | 网络地址，合计 | 120 |

网络计数只使用 Cloudflare 设置的 CF-Connecting-IP，密钥加盐哈希后作为计数键，不使用 X-Forwarded-For。额度按有效请求尝试计数，重试也计数。超限返回429和 Retry-After:60；缺失密钥、必需绑定或生产网络地址时写入返回503，浏览继续可用。网络额度用于抑制清 Cookie 后重新签发的滥用，共享校园网络也会共享该额度，可根据实际使用调整。

这只识别同一浏览器访客，不能证明一人一票或中南大学身份；清 Cookie、过期或换浏览器会建立新访客。原生限流按 Cloudflare 节点计数且为最终一致，不能当作严格全局配额。[Cookie 签名说明](https://hono.dev/docs/helpers/cookie)、[限流范围说明](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

`npm run dev` 会在缺少本地密钥时生成随机的 `.dev.vars`，已有文件和密钥保留，文件被 Git 忽略；单独启动 Wrangler 时先运行 `node scripts/setup-local-visitor.mjs`。不要将本地密钥用于线上。没有新数据库迁移。

## 数据模型

`teachers` 与 `courses` 各自独立，创建和浏览不依赖授课关系或学期。
教师可同名，以 ID 区分；官网链接可为空，前端仅允许 HTTPS。
课程代码可为空，已知代码唯一。

课程 category 为 major（专业课）、elective（公选课），未知时为空。课程列表可用 category 参数筛选，两类可与名称搜索组合；教师接口不接受该参数。is_listed=0 的课程不会出现在列表、搜索、详情或评论接口中。初始目录的7门数学统计课程归入专业课，3门思政课程退出课程目录。公选课按官方名单导入，细分类另行核实，不凭教师学院或课程名称自动分类。

初版的 `terms`、`course_offerings` 表及其数据暂时保留，避免破坏已应用迁移；当前页面与 API 不再使用它们。`teacher_reviews` 与 `course_reviews` 分别关联教师或课程，不关联授课记录，也不强制填写学期。

## 部署

`wrangler.jsonc` 已绑定本项目 D1。首次部署需登录相应 Cloudflare 账户。发布匿名访客功能前，生成独立的高强度随机密钥（至少32字符，建议32随机字节的 base64url），通过下列命令的交互输入配置，不能写入仓库或公开环境变量：

```sh
node --env-file-if-exists=.env.deploy --require ./scripts/cloudflare-network.cjs ./node_modules/wrangler/bin/wrangler.js secret put VISITOR_SECRET
```

后续部署保持此密钥稳定；更换密钥会使已有 Cookie 失效。生产 Cookie 需要 HTTPS；无需为匿名访客建立账号表。新增迁移先应用，再发布：

```sh
node --env-file-if-exists=.env.deploy --require ./scripts/cloudflare-network.cjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote
npm run deploy
```

远程迁移会修改线上数据库，不要导入本地演示数据。迁移应在发布依赖新字段的 Worker 前执行。

部署命令禁用 HTTP 持久连接和 TLS 会话复用，HTTPS 证书校验保持开启。此配置仅影响 CLI。需要代理时，在被 Git 忽略的 `.env.deploy` 中设置 `CSU_DEPLOY_PROXY=http://127.0.0.1:你的代理端口`；未配置时使用 HTTP(S) 代理环境变量或直连。不要提交凭据、token 或 secret。

## 性能

使用系统字体、内联 SVG 图标，无远程字体、图片或 UI 组件库。搜索点击提交后请求。带哈希的 JS/CSS 缓存一年，HTML 重新验证；目录 API 保留 private/max-age=60 供其他调用方使用，页面请求使用 no-store 避免发布评价后显示旧分数；评论接口使用 no-store。请求20秒超时，可重试，切页取消旧请求且不显示前一查询结果。页面提供加载骨架、错误重试、空结果、键盘搜索快捷键 `/`、跳到主要内容、可访问表单和减少动画设置。
