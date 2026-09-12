# rateMyProfCSU

面向中南大学学生的教师与课程评价平台，采用两个独立入口：
- 教师：按教师浏览并评价教师，课程与修读时间由评论者自行叙述。
- 课程：按课程浏览并评价课程，任课教师可在正文补充。

目前实现独立列表、名称搜索、分页、详情、教师官网链接及星级评论。评价区包括平均分、五星分布、最新评论和投稿弹窗。没有评价时显示暂无评分。

## 技术与目录

TypeScript、React、Vite、Hono、Cloudflare Workers、D1；不依赖常驻进程或线上本地磁盘。

- `web/`：前端页面、系统字体样式、静态资源缓存。
- `src/index.ts`：只读 API、服务端输入验证、参数化 SQL。
- `src/reviews.ts`：评价列表、星级统计及待审核投稿。
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

新投稿固定为 pending，公开列表及星级统计仅使用 published，rejected 不公开。用户不能通过 API 更改状态。当前审核由项目维护者通过受保护的 D1 管理入口处理，将对应表中指定评论的 status 改为 published 或 rejected；尚无审核后台，也没有自动审核任务。

评论按纯文本渲染，不执行 HTML。前端不收集姓名、学号或联系方式；公开作者统一显示匿名用户。这不代表网络服务商不保留访问日志。初始化阶段尚未接入登录、Turnstile 或频率限制；提交去重只用于网络重试，不等于防刷。

## 数据模型

`teachers` 与 `courses` 各自独立，创建和浏览不依赖授课关系或学期。
教师可同名，以 ID 区分；官网链接可为空，前端仅允许 HTTPS。
课程代码可为空，已知代码唯一。

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
