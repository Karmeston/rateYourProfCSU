# rateMyProfCSU

面向中南大学学生的教师与课程评价平台，采用两个独立入口：
- 教师：按教师浏览并评价教师，课程与修读时间由评论者自行叙述。
- 课程：按课程浏览并评价课程，任课教师可在正文补充。

目前实现独立列表、名称搜索、分页、详情、教师官网链接及星级评论。评价区包括平均分、五星分布、最新评论和投稿弹窗。没有评价时显示暂无评分。

教师首页只显示搜索入口，提交非空关键词后才请求并展示匹配教师；空输入或纯空白不请求列表。课程页继续展示分类和列表。这是页面展示规则，不是教师资料访问权限限制。

## 技术与目录

TypeScript、React、Vite、Hono、Cloudflare Workers、D1；不依赖常驻进程或线上本地磁盘。

- `web/`：前端页面、系统字体样式、静态资源缓存。
- `src/index.ts`：只读 API、服务端输入验证、参数化 SQL。
- `src/reviews.ts`：评价列表、星级统计及投稿（验证阶段直接发布）。
- `migrations/`：按顺序执行的迁移，已应用文件不修改。
- `seeds/local.sql`：虚构演示资料，仅用于本地。
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
| `/api/courses` | courses、limit、offset、q、hasMore |
| `/api/teachers/:id` | teacher |
| `/api/courses/:id` | course |
| `/api/health` | status，仅检查服务响应 |

列表支持 limit（1–100，默认20）、offset（0–100000，默认0）、q（最多100字符的名称搜索），按 ID 升序。搜索字面匹配，百分号和下划线不是通配符。详情不接受查询参数。重复、未知或非法参数返回400，不存在的详情返回404，数据库故障返回通用500，详细错误仅记服务端日志。

旧的 `/api/courses/:id/offerings` 已移除。

## 星级评论

`GET /api/teachers/:id/reviews` 与 `GET /api/courses/:id/reviews` 返回 reviews、summary、offset、limit、hasMore。只接受 offset（0–100000，默认0），每页20条，按 created_at、id 降序。summary 包含所有已公开评价的 count、average 和五星分布，不只统计当前页。没有公开评价时 average 为 null。

相同路径支持 POST JSON：`{ "id": "客户端生成的 UUID v4", "rating": 5, "body": "评论正文" }`。星级为1–5整数，正文1–2000个 UTF-16 代码单元，请求体最多8192字节。服务器不接受审核状态或其他字段。原样重试相同 ID 返回202，不重复写入；同 ID 改写内容返回409。

验证阶段的新投稿直接写为 published，提交后刷新评论和评分。公开列表及星级统计仍只使用 published，既有 pending 和 rejected 不自动公开。状态字段保留，用户不能通过 API 指定状态；以后需要时再恢复审核流程。

评论按纯文本渲染，不执行 HTML。前端不收集姓名、学号或联系方式；公开作者统一显示匿名用户。这不代表网络服务商不保留访问日志。初始化阶段尚未接入登录、Turnstile 或频率限制；提交去重只用于网络重试，不等于防刷。

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

使用系统字体，无远程字体、图片或 UI 组件库。搜索点击提交后请求。带哈希的 JS/CSS 缓存一年，HTML 重新验证；目录 API 成功响应在浏览器缓存60秒，评论接口使用 no-store。请求20秒超时，可重试，切页取消旧请求。
