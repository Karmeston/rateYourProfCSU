# rateMyProfCSU

面向中南大学学生的教师与课程评价平台，采用两个独立入口：
- 教师：按教师浏览，未来直接评价教师，课程与修读时间由评论者自行叙述。
- 课程：按课程浏览，未来直接评价课程，任课教师可在正文补充。

目前实现独立列表、名称搜索、分页、详情及教师官网链接。评论功能尚未实现，不显示不可用的投稿按钮。

## 技术与目录

TypeScript、React、Vite、Hono、Cloudflare Workers、D1；不依赖常驻进程或线上本地磁盘。

- `web/`：前端页面、系统字体样式、静态资源缓存。
- `src/index.ts`：只读 API、服务端输入验证、参数化 SQL。
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

列表支持 limit（1–100，默认20）、offset（0–100000，默认0）、q（最多100字符的名称搜索），按 ID 升序。搜索字面匹配，百分号和下划线不是通配符。详情不接受查询参数。重复、未知或非法参数返回400，不存在的详情返回404，数据库故障返回通用500，详细错误仅记服务端日志。没有写入 HTTP 接口。

旧的 `/api/courses/:id/offerings` 已移除。

## 数据模型

`teachers` 与 `courses` 各自独立，创建和浏览不依赖授课关系或学期。
教师可同名，以 ID 区分；官网链接可为空，前端仅允许 HTTPS。
课程代码可为空，已知代码唯一。

初版的 `terms`、`course_offerings` 表及其数据暂时保留，避免破坏已应用迁移；当前页面与 API 不再使用它们。未来评论分别关联教师或课程，不关联授课记录，也不强制填写学期。评论表留待评论功能单独实现。

## 部署

`wrangler.jsonc` 已绑定本项目 D1。首次部署需登录相应 Cloudflare 账户。新增迁移先应用，再发布：

```sh
node --env-file-if-exists=.env.deploy --require ./scripts/cloudflare-network.cjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote
npm run deploy
```

远程迁移会修改线上数据库，不要导入本地演示数据。迁移应在发布依赖新字段的 Worker 前执行。

部署命令禁用 HTTP 持久连接和 TLS 会话复用，HTTPS 证书校验保持开启。此配置仅影响 CLI。需要代理时，在被 Git 忽略的 `.env.deploy` 中设置 `CSU_DEPLOY_PROXY=http://127.0.0.1:你的代理端口`；未配置时使用 HTTP(S) 代理环境变量或直连。不要提交凭据、token 或 secret。

## 性能

使用系统字体，无远程字体、图片或 UI 组件库。搜索点击提交后请求。带哈希的 JS/CSS 缓存一年，HTML 重新验证；成功的 API 响应在浏览器缓存60秒。请求20秒超时，可重试，切页取消旧请求。
