# rateMyProfCSU

面向中南大学学生的课程评价平台。保留深蓝导航、灰白背景和蓝色交互色，以课程广场、我的收藏和使用指南作为主要入口。

课程支持名称/代码搜索、类型与学院组合筛选、评分/评价数量/名称排序、网格与列表切换。详情可收藏、复制分享链接、保留筛选返回列表；评价支持星级筛选、最新评论/赞同最多排序、匿名投稿、草稿恢复、赞同与单层回复。没有评价时不显示零分。

教师页面当前由 `web/features.ts` 的开关关闭，旧教师页面链接返回课程广场；独立教师 API 继续保留。开启后提供教师搜索、详情与评价。未核实的培养方案、学分与考核资料显示明确占位，尚未导入已采集数据。

设计依据、验收记录与回退方式见 [界面改造说明](docs/ui-improvements.md)。

## 技术与目录

TypeScript、React、Vite、Hono、Cloudflare Workers、D1；不依赖常驻进程或线上本地磁盘。

- `web/`：前端页面、系统字体样式、静态资源缓存。
- `src/index.ts`：只读 API、服务端输入验证、参数化 SQL。
- `src/course-catalog.ts`：课程搜索、组合筛选、排序、收藏 ID 查询、目录统计。
- `shared/catalog.ts`：前后端共用的课程类型与筛选枚举。
- `src/reviews.ts`：评价列表、星级统计及投稿（验证阶段直接发布）。
- `migrations/`：按顺序执行的迁移，已应用文件不修改。
- `seeds/local.sql`：虚构演示资料，仅用于本地。
- `seeds/preview.sql`：课程界面验收专用的虚构课程与评价，配合独立本地数据库使用。
- `tests/`：临时 D1 API 测试及 SQLite 约束和迁移测试。
- `data/`：已整理的官网来源资料，不自动导入数据库。
- `scripts/cloudflare-network.cjs`：部署 CLI 的本机网络兼容配置。

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
npm run typecheck
npm run build
npm test
```

build 仅打包和 dry-run，不发布。测试不修改开发数据库。生成的类型、构建产物、依赖和本地配置不提交 Git。

## API

| GET 接口 | 返回 |
| --- | --- |
| `/api/teachers` | teachers、limit、offset、q、hasMore |
| `/api/courses` | courses、limit、offset、q、category、department、sort、total、hasMore、facets、stats |
| `/api/teachers/:id` | teacher |
| `/api/courses/:id` | course |
| `/api/health` | status，仅检查服务响应 |

列表支持 limit（1–100，默认20）、offset（0–100000，默认0）、q（最多100字符），默认按 ID 升序。教师按名称搜索；课程按名称或代码搜索，ASCII 英文不区分大小写。搜索字面匹配，百分号和下划线不是通配符。详情不接受查询参数。重复、未知或非法参数返回400，不存在的详情返回404，数据库故障返回通用500，详细错误仅记服务端日志。

课程列表另支持 category（major/elective）、department（学院名精确匹配）、sort（default/rating/reviews/name）及 ids（最多100个逗号分隔的非零安全整数，用于本地收藏查询）。ids 自动去重，不能读取隐藏课程。total 为筛选后的总数；facets.departments 为整个可见目录的学院及数量；stats 为整个可见目录的课程数、已发布评价数和已评价课程数。评分排序将未评分课程放在最后，并以 ID 保证稳定顺序。URL 保留搜索、类型、学院、排序及分页，详情返回时恢复原条件。

旧的 `/api/courses/:id/offerings` 已移除。

## 星级评论

`GET /api/teachers/:id/reviews` 与 `GET /api/courses/:id/reviews` 返回 reviews、summary、total、offset、limit、sort、rating、hasMore。接受 offset（0–100000，默认0）、rating（1–5，可省略）与 sort（latest/helpful，默认 latest），每页20条。latest 按 created_at、id 降序；helpful 按赞同数降序、不赞同数升序，再按时间和 ID 降序。total 为匹配星级的评价数量。summary 始终包含所有已公开评价的 count、average 和五星分布，不随筛选或分页变化。没有公开评价时 average 为 null。

相同路径支持 POST JSON：`{ "id": "客户端生成的 UUID v4", "rating": 5, "body": "评论正文" }`。星级为1–5整数，正文1–2000个 UTF-16 代码单元，请求体最多8192字节。服务器不接受审核状态或其他字段。原样重试相同 ID 返回202，不重复写入；同 ID 改写内容返回409。

验证阶段的新投稿直接写为 published，提交后刷新评论和评分。公开列表及星级统计仍只使用 published，既有 pending 和 rejected 不自动公开。状态字段保留，用户不能通过 API 指定状态；以后需要时再恢复审核流程。

评论按纯文本渲染，不执行 HTML。前端不收集姓名、学号或联系方式；公开作者统一显示匿名同学。这不代表网络服务商不保留访问日志。初始化阶段尚未接入登录、Turnstile 或频率限制；提交去重只用于网络重试，不等于防刷。

评价草稿按对象保存在 sessionStorage，可关闭表单后恢复；重开草稿保留提交 UUID，原样重试不会重复写入。改变内容产生新的提交 UUID，成功发布后清除草稿。收藏与布局偏好保存在 localStorage；最多收藏100门课程，无账号及跨设备同步。存储不可用时界面提供说明，收藏在本次浏览中仍可使用。

## 评价互动

每条教师或课程评价包含 likes、dislikes、myVote、replyCount。请求头 `X-Browser-ID` 使用浏览器本地保存的随机 UUID v4；它只标记投票，不是登录凭据。清除存储或更换浏览器会产生新标识，目前不保证一人一票，也不具备防刷能力。

以下路径前缀为 `/api/teachers/:id/reviews/:reviewId` 或 `/api/courses/:id/reviews/:reviewId`：

| 方法及后缀 | 用途 |
| --- | --- |
| `PUT /vote` | JSON `{ "value": 1 }` 点赞，-1 点踩，0 取消；必须携带浏览器标识 |
| `GET /replies` | 按时间正序返回单层回复，支持 offset，每页20条 |
| `POST /replies` | JSON `{ "id": "UUID v4", "body": "回复" }`，正文1–1000个 UTF-16 代码单元 |

投票按“评价 + 浏览器标识”唯一存储，重复请求不会累加。回复使用客户端 ID 避免网络重试重复写入，验证阶段直接公开，保留状态字段。互动只开放给可浏览对象的已公开评价，不计入对象的星级和评价总数。回复区点击后才加载，纯文本显示。

## 数据模型

`teachers` 与 `courses` 各自独立，创建和浏览不依赖授课关系或学期。
教师可同名，以 ID 区分；官网链接可为空，前端仅允许 HTTPS。
课程代码可为空，已知代码唯一。

课程 category 为 major（专业课）、elective（公选课），未知时为空。课程列表可用 category 参数筛选，两类可与名称搜索组合；教师接口不接受该参数。is_listed=0 的课程不会出现在列表、搜索、详情或评论接口中。首批7门数学统计课程归入专业课，3门思政课程退出课程目录，目前公选课为空。未来导入应人工确认分类，不凭教师学院或课程名称自动分类。

初版的 `terms`、`course_offerings` 表及其数据暂时保留，避免破坏已应用迁移；当前页面与 API 不再使用它们。`teacher_reviews` 与 `course_reviews` 分别关联教师或课程，不关联授课记录，也不强制填写学期。

## 部署

`wrangler.jsonc` 已绑定本项目 D1。首次部署需登录相应 Cloudflare 账户。新增迁移先应用，再发布：

```sh
node --env-file-if-exists=.env.deploy --require ./scripts/cloudflare-network.cjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote
npm run deploy
```

远程迁移会修改线上数据库，不要导入本地演示数据。迁移应在发布依赖新字段的 Worker 前执行。

部署命令禁用 HTTP 持久连接和 TLS 会话复用，HTTPS 证书校验保持开启。此配置仅影响 CLI。需要代理时，在被 Git 忽略的 `.env.deploy` 中设置 `CSU_DEPLOY_PROXY=http://127.0.0.1:你的代理端口`；未配置时使用 HTTP(S) 代理环境变量或直连。不要提交凭据、token 或 secret。

## 性能

使用系统字体、内联 SVG 图标，无远程字体、图片或 UI 组件库。搜索点击提交后请求。带哈希的 JS/CSS 缓存一年，HTML 重新验证；目录 API 保留 private/max-age=60 供其他调用方使用，页面请求使用 no-store 避免发布评价后显示旧分数；评论接口使用 no-store。请求20秒超时，可重试，切页取消旧请求且不显示前一查询结果。页面提供加载骨架、错误重试、空结果、键盘搜索快捷键 `/`、跳到主要内容、可访问表单和减少动画设置。
