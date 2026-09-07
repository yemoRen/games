# 项目长期记忆：末世搜打撤（文字放置废土·系统搜打撤）

## 项目概况
- 换皮项目：原《万界道友》(Hono + React SPA) → 末世废土求生《文字放置废土·系统搜打撤》。
- 包名仍为 `wanjiedaoyou`（package.json），版本 `1.0.0`（2026-09-06 首发）。
- 纯前端 localStorage 存档，无后端（生存玩法部分）；上游另有 Hono/PG/Redis 服务端代码但本项目主玩法走本地。

## 版本与发布约定（用户明确指定）
- **首发 = v1.0.0**（2026-09-06 已推 GitHub，tag `v1.0.0`）。
- **后续每次推 GitHub 递增补丁号：1.0.1 → 1.0.2 …**（用户原话："之后的推到github，就1.0.1逐步增加"）。
- 流程：改 `package.json` 的 `version` → 提交 → `git tag -a vX.Y.Z` → `git push origin main --tags`。
- 用户偏好：**攒一批需求统一改好后再推**，不要零散推送。

## Git / 网络
- 远程 `origin` = https://github.com/yemoRen/games.git ，主分支 `main`（已设跟踪 origin/main）。
- 注意：AGENTS.md 提到 CI 在 `master` 上构建；但本地工作分支是 `main`，推送走 `main`。
- **推送前提：用户本机 VPN/代理（Clash 类）必须开启**。git 配了 `http.proxy=https.proxy=http://127.0.0.1:7890`。
- 沙箱内置代理 127.0.0.1:59583 / 59564 **无法访问 github**（返回 502），直连 github 超时。7890 关闭时推送报 "Could not connect to server"。
- 无活跃 git hooks / husky，提交不会被拦截。

## 验证命令
- 类型检查：`bun run tsc -b tsconfig.app.json`
- 构建：`bun run build:client`（exit 0 即通过）
- lint 有 3 个历史遗留错误（hono.ts ×2 altcha 未用、ExtractionEngine `_rng`），按约定不动。

## 工具环境坑（重要）
- 本项目 Edit / Grep / Read 工具存在「沙箱视图」与真实磁盘不一致：Edit 报成功但 Grep/Read 可能读到旧版；关键改动一律用 **Bash + Python**（真实磁盘）落地，并用 Python 读文件复核后才算完成。
