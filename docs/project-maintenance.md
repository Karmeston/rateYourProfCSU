# 项目维护说明

整理日期：2026-10-09。项目继续采用React前端、Hono Worker和D1，按功能组织小模块。

## 模块边界

| 位置 | 职责 |
| --- | --- |
| `web/main.tsx` | 应用外壳、导航、键盘快捷键和页面调度 |
| `web/routing.ts` | URL解析、筛选状态与返回链接 |
| `web/catalog.tsx`、`web/teacher-catalog.tsx`、`web/detail.tsx`、`web/guide.tsx` | 各自页面的展示与操作 |
| `web/reviews.tsx`、`web/review-interactions.tsx` | 评价列表、投票和回复 |
| `web/review-form.tsx`、`web/own-review-actions.tsx` | 评价草稿、选课背景、本人修改与撤回 |
| `web/course-supplements.tsx`、`web/community-forms.tsx` | 同学补充资料、举报表单与共用背景字段 |
| `web/use-data.ts`、`web/visitor.ts` | 取消过期读取请求、超时、匿名会话及写入请求 |
| `shared/` | 纯类型、枚举和可核实的业务规则；可由前后端共同导入 |
| `src/index.ts` | 路由装配、健康检查与错误兜底 |
| `src/*catalog.ts`、`src/reviews.ts`、`src/review-interactions.ts` | 对应功能的参数验证、SQL与响应 |
| `src/visitor.ts` | 签名Cookie、跨站写入检查和频率限制 |
| `src/community.ts`、`src/community-input.ts`、`scripts/moderate.mjs` | 资料补充、举报、输入验证和本地审核工具 |
| `src/validation.ts`、`src/request-body.ts` | 重复使用的ID/UUID校验、受限请求体读取 |
| `src/review-targets.ts` | 固定的评价、投票、回复表名和外键映射 |
| `tests/helpers/database.mjs` | 将生产迁移按顺序应用到调用方的临时D1 |
| `data/`、`scripts/` | 来源、采集、审核和导入；业务请求不直接读取采集文件 |

页面与API按功能扩展。重复出现且含义一致的类型或规则放入`shared/`；数据库、请求上下文、浏览器存储分别留在服务端或前端模块。目录足够小，暂不增加服务层或通用数据库封装。

## 修改约定

- 页面入口只负责装配。新业务放入对应模块；公共函数只提取已有且含义相同的重复逻辑。
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
