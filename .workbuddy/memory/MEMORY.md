# 项目长期记忆：末世搜打撤（文字放置废土·系统搜打撤）

## 项目概况
- 换皮项目：原《万界道友》(Hono + React SPA) → 末世废土求生《文字放置废土·系统搜打撤》。
- 包名仍为 `wanjiedaoyou`（package.json），版本 `1.0.0`（2026-09-06 首发）。
- 纯前端 localStorage 存档，无后端（生存玩法部分）；上游另有 Hono/PG/Redis 服务端代码但本项目主玩法走本地。

## 版本与发布约定（用户明确指定）
- **首发 = v1.0.0**（2026-09-06 已推 GitHub，tag `v1.0.0`）。
- **后续每次推 GitHub 递增补丁号**（用户原话："之后的推到github，就1.0.1逐步增加"），流程：改 `package.json` 的 `version` → 提交 → `git tag -a vX.Y.Z` → `git push origin main --tags`。
- **用户偏好：攒一批需求统一改好后再推，不要零散推送。**
- **当前版本分级（2026-09-08 用户最新指令）**：累积本地改动全部归类到 v1.0.6 → 已推送（tag `v1.0.6` 指向 `ead4015`）。
- **v1.0.7 已发布**（2026-09-08，tag `v1.0.7`
- **v1.0.8 已发布**（2026-09-08，tag `v1.0.8` 指向本次提交）：耐力续航 ×2→×1.5 分钟 / 潜行绕行改受敏捷 timeScale 缩放（基础 3 分钟）且 UI 文案「耗费大量时间潜行通过」/ 恢复速率重做（废止 REGEN_SCALE 魔法数；医疗站 recoveryPerLevel 0.5→0.2=Lv5翻倍×2、基础公式 maxHp×0.005+体质×0.4，yemo 恢复 ~417→~48/min）/ 体质加点出击内外均 +20 最大生命回归验证通过。package.json 已 bump 到 `1.0.8`。
 指向本次提交）：遣散二次确认（内联确认防误触）/ 进图当前血被压到 baseNoGear 修复（yemo 1935→1415）/ 副本内换装体质·耐力应改最大血 / 遣散按钮 window.confirm 失效改内联确认 / 潜行绕行固定 3 分钟 五项。package.json 已 bump 到 `1.0.7`。
- 推送前提：本机 Clash 代理 7890 开启（沙箱内置代理无法连 github）；无活跃 git hooks。

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
