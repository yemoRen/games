# 项目长期记忆：末世搜打撤（文字放置废土·系统搜打撤）

## 项目概况
- 换皮项目：原《万界道友》(Hono + React SPA) → 末世废土求生《文字放置废土·系统搜打撤》。
- 包名仍为 `wanjiedaoyou`（package.json），版本 `1.0.0`（2026-09-06 首发）。
- 纯前端 localStorage 存档，无后端（生存玩法部分）；上游另有 Hono/PG/Redis 服务端代码但本项目主玩法走本地。

## 版本与发布约定（用户明确指定）
- **首发 = v1.0.0**（2026-09-06 已推 GitHub，tag `v1.0.0`）。
- **后续每次推 GitHub 递增补丁号**（用户原话："之后的推到github，就1.0.1逐步增加"），流程：改 `package.json` 的 `version` → 提交 → `git tag -a vX.Y.Z` → `git push origin main --tags`。
- **用户偏好：攒一批需求统一改好后再推，不要零散推送。**
- **副本两层数值的设计约定（v1.0.10 补充轮② 定稿，勿再混淆）**：
  - **深度 1~7**（`ZoneNode.depth`，区域后缀展示为「深N」）= 节点距起点层距归一化。只驱动**遇怪难度 / 遇怪概率**：威胁查表 `threatEncounterChance(深度, 威胁档)`、`rollEnemyAffixes`、转移伏击率、救援率、击杀经验。
  - **危险度 危1~危7**（`ZoneNode.danger` = `theme.dangerLevel`，**全图恒定**）= 大副本难度。只驱动**装备基础爆率**：`mobGearDropChance` / `MOB_GEAR_QUALITY_WEIGHTS` / `BOSS_GEAR_QUALITY_WEIGHTS`。
  - 引擎里取深度用 `zoneDepth(state)`（ExtractionEngine 内部函数），取爆率档位用 `state.zone.dangerLevel`，两者不可互换。
- **同一版本要合并补充改动时**：不递增版本号，改为「新提交 + `git tag -f vX.Y.Z` + `git push -f origin refs/tags/vX.Y.Z`」移动标签（不 force push main，避免改写已发布历史）。v1.0.10 即用此法合并了两轮补充（最终 tag → fa5902d）。
- **⛔ 严禁在本仓库执行 `git stash -u`**：实测会删除 `.git/refs` 与 `.git/objects/pack/*.pack`，导致仓库不可用。恢复办法：重建 refs 目录 → `git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'` → `git update-ref refs/heads/main refs/remotes/origin/main` → `git reset --mixed HEAD`（工作区文件不受影响）。
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

## v1.0.11（本地累积，未发布）
- 三项：①濒死禁再次出击 ②副本等级门槛（DANGER_LEVEL_REQ：危1=Lv1 不限→危7=Lv15）③难度提升靠等级门槛（低等级禁入高危区）。另加 `ENEMY_DANGER_SCALE` 钩子（content.ts / ExtractionEngine.fight 套用），当前全 1.0。
- 未 bump / 未 commit / 未 push，等用户发版指令（Clash 7890）。

## ⚠️ 战斗引擎「数值悬崖」（调难度必读）
- 实测：敌人基础六维放大 ~5%（如 危7 boss scale 1.0→1.05）即让 gated 胜率从 ~76% 直接跌到 0%（疑似被秒杀阈值）。说明 battle-v5 难度曲线极陡、不可微调。
- 因此**副本难度不要用敌人属性缩放来调**；用「等级门槛 + 区域危险度(设备爆率) + 深度词缀(遇怪)」三层间接控制。若确需整体提难，改 `ENEMY_DANGER_SCALE` 但必须充分模拟实测，避免造出 0% 胜率墙。

## v1.0.11 第二轮（本地累积，未发布）
- 热更新文案改废土风 + doExtract 加 atExtract 守卫（修 boss 区直接撤离）+ 属性 UI 次级 sticky + 场景/日志压缩 + 搜刮提示紧贴区名 + 7 张地图专属 16 区名（核心：generateZoneGraph 用 theme.subZones）。
- 未 bump / 未 commit / 未 push，等用户发版指令（Clash 7890）。

## ⚠️ 内容数据"共享池"陷阱（多地图项目必读）
- v1.0.11 之前 7 张大地图共用**全局 ZONE_POOL**（同一份 16 区名），造成「走到哪个副本 16 区名都雷同」。
- 教训：每张地图若主题不同，**专属池（map.subZones）必须独立**，别共用 ZONE_POOL。fallback 保留即可（不传则用全局），但**默认应是地图专属**。
