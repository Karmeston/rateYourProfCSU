# 项目维护说明

整理日期：2026-10-09。项目继续采用React前端、Hono Worker和D1，按功能组织小模块。

2026-10-14更新：课程列表按页读取附加记录，汇总评价统计共用一次聚合。资料补充展开后加载，支持本人修改、撤回及独立分页；资料路由与举报接收分别维护。当前86项测试、严格类型检查和构建通过，未新增依赖。新增迁移`0009`；旧代码不识别资料撤回，线上回退须保留撤回过滤，具体基线与兼容要求见[匿名社区功能说明](community-features.md)。

## 模块边界

后台管理增量：管理认证、队列查询和概况分别位于`src/admin*.ts`，审核事务集中在`src/moderation.ts`供网页和CLI共同使用。前端`web/admin*.tsx`按需加载，统计上报与180日汇总清理分别在`web/traffic.ts`、`src/traffic.ts`；没有新增依赖。迁移`0010`追加管理员会话、流量汇总与短期去重表，并补充审核日志来源/版本。维护和回退见[后台说明](admin.md)。

当前94项测试、严格类型检查、构建与应用提交的main CI通过。隔离预览走通审核/举报/日志，320/390像素后台检查无横向溢出；线上登录、受保护读取和退出后的会话失效已验证。历史验收段落保留其当时版本和数量，当前发行以[部署记录](deployment-20261012.md)为准。

2026-10-15：课程筛选提取到`web/catalog-filters.tsx`，卡片保持必要概览，版本资料留在详情；页长24覆盖桌面三列/平板两列。旧offset链接对齐完整页，API默认页长不变。95项CI检查通过，来源新增21门课程、193条资料，原课程及资料逐字段核对保留。没有新增运行依赖或迁移；布局及核查记录见[列表改造说明](catalog-layout-20261015.md)。

| 位置 | 职责 |
| --- | --- |
| `web/main.tsx` | 应用外壳、导航、键盘快捷键和页面调度 |
| `web/routing.ts` | URL解析、筛选状态与返回链接 |
| `web/catalog.tsx`、`web/teacher-catalog.tsx`、`web/detail.tsx`、`web/guide.tsx` | 各自页面的展示与操作 |
| `web/reviews.tsx`、`web/review-interactions.tsx` | 评价列表、投票和回复 |
| `web/review-form.tsx`、`web/own-review-actions.tsx` | 评价草稿、选课背景、本人修改与撤回 |
| `web/course-supplements.tsx`、`web/community-forms.tsx` | 同学补充资料、举报表单与共用背景字段 |
| `web/supplement-form.tsx`、`web/supplement-draft.ts` | 资料补充表单、当前标签页草稿验证与原编号重试 |
| `web/own-supplement-actions.tsx` | 本人资料状态、修改入口、撤回确认与重试 |
| `web/use-data.ts`、`web/visitor.ts` | 取消过期读取请求、超时、匿名会话及写入请求 |
| `shared/` | 纯类型、枚举和可核实的业务规则；可由前后端共同导入 |
| `src/index.ts` | 路由装配、健康检查与错误兜底 |
| `src/*catalog.ts`、`src/reviews.ts`、`src/review-interactions.ts` | 对应功能的参数验证、SQL与响应 |
| `src/visitor.ts` | 签名Cookie、跨站写入检查和频率限制 |
| `src/community.ts`、`src/community-input.ts` | 社区路由装配、匿名身份与共用输入验证 |
| `src/course-supplements.ts`、`src/content-reports.ts`、`scripts/moderate.mjs` | 资料生命周期、举报接收与审核工具 |
| `src/validation.ts`、`src/request-body.ts` | 重复使用的ID/UUID校验、受限请求体读取 |
| `src/review-targets.ts` | 固定的评价、投票、回复表名和外键映射 |
| `tests/helpers/database.mjs` | 将生产迁移按顺序应用到调用方的临时D1 |
| `data/`、`scripts/` | 来源、采集、审核和导入；业务请求不直接读取采集文件 |

页面与API按功能扩展。重复出现且含义一致的类型或规则放入`shared/`；数据库、请求上下文、浏览器存储分别留在服务端或前端模块。目录足够小，暂不增加服务层或通用数据库封装。

## 修改约定

- 页面入口只负责装配。新业务放入对应模块；公共函数只提取已有且含义相同的重复逻辑。
- 列表附加资料只读取当前页；默认/名称排序先分页再读取评分和来源年份，评分/评价数排序须先计算排名再分页。专业方案按课程ID集合读取，并保留版本、学分与必选修差异。折叠的资料区域展开后才请求，关闭或切页取消未完成的读取。
- 写入超时表示结果未确认，原样重试须保留提交编号；资料草稿按课程保存在当前标签页，成功后清除，存储不可用时仍可提交。草稿只保存用户输入，归属和合法性由服务端检查。
- SQL表名来自固定代码配置，外部值全部参数绑定。课程隐藏状态要覆盖搜索、详情、评价和互动入口。
- ID允许负数演示资料，零和不安全整数无效；真实课程导入保留正编号。匿名Cookie与写入限制继续由服务端验证。
- 公选课事实、当期开课与模块认定分别存储。结论绑定专业/方案版本和官方来源；缺少依据保留未知，专项班单独核对。
- 本人评价由已验证匿名访客判定，UUID不能作为归属凭证；同访客同对象唯一约束覆盖所有状态。评分查询和互动入口须同时检查公开状态及未撤回。资料补充与官方记录分开，管理操作保留理由、版本检查和原子日志。
- 已应用的迁移只追加新文件。业务测试使用临时D1（`persist: false`），新增用例复用`tests/helpers/database.mjs`；数据库约束测试继续保留自己的SQLite夹具。
- `.editorconfig`约定UTF-8、LF、两空格缩进；Python四空格。TypeScript启用严格检查、未使用声明及参数检查。
- 前端更新后重新构建并重启Wrangler，使静态资源索引与构建一致。浏览器验收使用现有隔离预览数据库；演示数据保持明确标记。
- 配置、凭据、生成类型、依赖、构建产物、原始大附件与临时缓存按现有忽略规则管理。线上迁移和发布按README单独执行。

## 检查与回退

```sh
npm run check
git diff --check
```

`check`依次运行前后端类型检查、完整业务测试、前端构建及Worker dry-run。重构优先用既有API测试检验响应、校验、可见性、缓存和写入行为；仅有内部代码整理时不修改业务数据。

`.github/workflows/check.yml`在推送和Pull Request时用Node.js 24运行同一检查，Action固定到核实的官方提交，仅有仓库读取权限，不执行部署。工作流随代码推送后才会在GitHub运行，本轮只验证本地检查及工作流配置。

本次61项业务测试、严格类型检查和构建通过；客户端构建的JS/CSS内容哈希与整理前一致（`index-B5RQAw7M.js`、`index-CE026vbA.css`），页面输出保持一致。

整理前基线是`513eb8b`，Git标签为`codex/maintenance-baseline-20261009`。可在独立目录查看旧代码：

```sh
git worktree add ../rateProf-maintenance-baseline codex/maintenance-baseline-20261009
```

本次整理没有数据库迁移。后续回退整理提交可使用`git revert`，保留其后的历史。当前功能与命令以README为入口，调研依据保留在各专题文档，接手快照只作历史记录。
