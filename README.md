# rateYourProfCSU

面向中南大学学生的非官方课程与教师教学体验信息平台，帮助学生了解具体课程中的教学风格，不做教师好坏排行榜。

## 当前阶段

已有 React 课程列表、按学期分组的授课记录页面，以及 Hono 只读 API 和 D1 核心模型。前后端一起部署到 Cloudflare Workers。暂未实现评价系统；健康检查仅检查服务响应，不检查数据库。

## 本地运行

推荐使用 Node.js 24 LTS（API 测试直接运行 TypeScript，需要 Node.js 22.18 或更新版本），在项目目录运行：

```sh
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

打开终端显示的本地地址（通常为 http://localhost:8787）。首页显示课程列表，`/api/health` 返回 `{"status":"ok"}`。演示数据仅用于本地；修改前端后需重新运行 dev 构建。

本地开发无需登录 Cloudflare，无需配置 token，也无需创建 D1 数据库。Wrangler 使用本地 Workers 运行时。

```sh
npm run typecheck
npm run build
```

分别检查 TypeScript 和执行本地打包；`build` 使用 dry-run，不会部署。

## 文件说明

- `src/index.ts`：Worker 入口、只读 API、参数验证和错误处理。
- `web/`：React 页面、系统字体样式和静态资源缓存规则。
- `worker-configuration.d.ts`：`npm run types` 自动生成的 Workers/D1 类型，不提交 Git；类型检查会先生成它。
- `wrangler.jsonc`：Worker 名称、入口和运行时兼容日期。
- `tsconfig.json`：TypeScript 严格类型检查配置。
- `.gitignore`：忽略依赖、构建产物和本地敏感配置。
- `migrations/0001_core.sql`：四张核心表的建表迁移。
- `seeds/local.sql`：全部虚构的本地演示数据，独立于迁移。
- `tests/schema.test.mjs`：使用 Node.js 内存 SQLite 验证模型约束，不修改本地 D1。
- `tests/api.test.mjs`：使用独立临时 D1 验证 API；`npm test` 运行全部测试，不修改开发数据库。

## 浏览 API

先按下节完成本地建表和演示数据导入，再执行 `npm run dev`。浏览器可直接打开：

- http://localhost:8787/api/courses ：课程列表。
- http://localhost:8787/api/courses/-1/offerings ：演示课程的授课教师与学期。
- http://localhost:8787/api/courses?limit=1&offset=0 ：分页示例。

| GET 接口 | JSON 返回字段 |
| --- | --- |
| `/api/courses` | `courses`、`limit`、`offset`、`hasMore` |
| `/api/courses/:id/offerings` | `course`、`offerings`、`limit`、`offset`、`hasMore` |

两个接口均只接受可选整数参数 `limit`（默认 20，范围 1–100）和 `offset`（默认 0，范围 0–100000）；重复或未知参数返回 400。下一页把 offset 增加 limit；hasMore 表示是否仍有下一页。课程按 ID 升序，授课记录按学年、学期降序，同学期按授课记录 ID 升序。

授课记录字段为 `id`、`teacher_id`、`teacher_name`、`teacher_department`、`term_id`、`start_year`、`semester`。不同学期的记录分别返回。课程 ID 必须为非零安全整数，支持演示数据的负数 ID。

非法输入返回 400，课程不存在返回 404，存在但无授课记录返回 200 和空数组。数据库异常返回 500 和通用提示，详细错误只记入服务端日志。请求参数经过服务端验证和 SQL 参数绑定；没有写入数据的 HTTP 接口。

## 本地数据库

在项目目录执行（无需 Cloudflare 登录）：

```sh
npm run db:migrate:local
npm run db:seed:local
npm run test:db
```

第一条命令创建表，Wrangler 会记录已应用迁移，重复执行不会重新建表。第二条是可选的演示数据导入，可以重复执行；仅供空的本地开发数据库使用，不用于线上数据库。第三条运行约束测试，需要 Node.js 22.13 或更新版本（推荐 Node.js 24 LTS）。

所有数据库脚本均显式使用 `--local`，状态保存在被 Git 忽略的 `.wrangler/` 中。这只是本地模拟器的存储方式，线上应用通过 D1 绑定访问数据库，不依赖 Worker 本地磁盘。

| 表 | 内容 | 约束 |
| --- | --- | --- |
| `courses` | 名称、课程代码、所属学院 | 已知课程代码唯一，未知可为 NULL |
| `teachers` | 姓名、所属学院 | 允许同名，以 ID 区分 |
| `terms` | 学年开始年份、学期序号 | 年份与学期组合唯一 |
| `course_offerings` | 课程 ID、教师 ID、学期 ID | 三者组合唯一，均有外键 |

`start_year = 2026, semester = 1` 表示 2026–2027 学年第一学期。当前仅支持两个常规学期，同一教师同一课程同一学期的多个教学班暂时合并为一条授课记录；若之后需要短学期或区分教学班，再通过新迁移扩展。

未来每条教学体验关联 `course_offerings.id`，因此可以按具体课程和学期查看。外键禁止删除仍被授课记录引用的课程、教师或学期，避免误删关联数据。数据库约束不能替代 API 的服务端输入验证。

演示数据包含同一教师跨两个学期教授同一课程、同一课程由不同教师授课的情况。可查看关联结果：

```sh
npx wrangler d1 execute DB --local --command "SELECT c.name AS course, t.name AS teacher, s.start_year, s.semester FROM course_offerings o JOIN courses c ON c.id = o.course_id JOIN teachers t ON t.id = o.teacher_id JOIN terms s ON s.id = o.term_id ORDER BY c.id, s.start_year, s.semester, t.id;"
```

迁移应用后，后续表结构变化应新增迁移文件，不修改已应用迁移。

## 部署

当前 `wrangler.jsonc` 已绑定本项目的真实 D1，数据库已建表。首次在新电脑部署时先登录有权限的 Cloudflare 账户：

```sh
npx wrangler login
```

有新增迁移时应用线上迁移，再发布：

```sh
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

登录会打开浏览器授权；`--remote` 会修改线上数据库，部署会将 Worker 发布至 Cloudflare。不要将本地演示数据导入线上。不要将 API token、密码或其他 secret 写入代码或提交到 Git；本地 secret 使用 `.dev.vars`，线上使用 Wrangler 的 secret 配置。

## 浏览性能与验证

页面使用系统字体，无远程字体、图片或 UI 组件库。带内容哈希的 JS/CSS 缓存一年，HTML 每次重新验证；成功的浏览 API 响应在浏览器缓存 60 秒，因此数据更新最多有一分钟延迟。请求等待 20 秒后显示重试按钮，切页会取消旧请求。

运行 `npm run typecheck`、`npm run build` 和 `npm test` 验证类型、构建、数据库约束及 API。构建会清理 `dist/client` 中旧的产物。

教师来源资料保存在 `data/`，尚未据此导入授课记录。实际授课数据待确认；评价、审核、举报和反滥用留待后续独立步骤。

参考：[Hono Workers 入门](https://hono.dev/docs/getting-started/cloudflare-workers)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)。

数据库参考：[D1 本地开发](https://developers.cloudflare.com/d1/best-practices/local-development/)、[迁移](https://developers.cloudflare.com/d1/reference/migrations/)、[外键](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)。
