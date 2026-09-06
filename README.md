# 全民求生・系统搜打撤

<p align="center">
  <strong>末世 LitRPG · 文字放置「搜打撤」生存游戏</strong>
</p>

> 本项目是开源游戏《万界道友》的**末世换皮独立版本**：复用其底层引擎（Hono + React + battle-v5 战斗），将修仙放置主题改写为「末世废土 + 系统搜打撤」玩法。本仓库已与上游解耦为独立落地页与独立存档。

---

## 项目简介

《全民求生・系统搜打撤》把原游戏的「闭关修炼 → 突破 → 秘境产出」循环，改写为高潮汐落、高风险高回报的 **搜（搜刮）→ 打（战斗）→ 撤（撤离结算）** 循环：

- 在系统指引下进入危险区域搜刮物资、与丧尸/掠夺者交战；
- 抵达撤离点成功撤离 → 本局战利品入库；
- 撤离失败 / 阵亡 → 本局携带物资全部遗失，出击成员返回战团进入**濒死**状态，需用货币或医疗品救治，久治不愈则离世。

游戏为**纯文字 + 数据驱动**呈现，无美术资源依赖，适配桌面与移动端浏览器。

## 核心玩法

- **主角生成**：注册「幸存者档案」时，以玩家代号生成一名**全属性 15、紫色（epic）品质**的主角，直接入列战团。
- **战团成员（N/10）**：战团上限 **10 人**。副本中带回的幸存者不会自动入团，需先进入「幸存者花名册」用货币招募。
- **幸存者花名册**：展示副本中发现的幸存者列表，含**属性面板 + 招募金额**（越强力越贵，按段位分 5 档 `[50, 200, 800, 3000, 10000]` 废土币）。
- **招募 / 遣散**：招募后正式入列战团；战团满员无法招募，需**遣散**现有成员（返还 **1/3** 招募价值）或由成员死亡腾出名额。主角不可遣散。
- **出击 - 撤离**：复用 `battle-v5` 引擎跑真实战斗；撤离成功物资入库（废土币 + 材料 + 带阶级词缀的装备），阵亡/撤离失败仅丢失未撤离物资。
- **濒死与救治**：撤离失败成员返回战团进入濒死（约 5% 血量 + 10 分钟救治倒计时 + 流血/骨折/惊惧等伤势），可用 **100 废土币**或任意医疗品救治；超时未治则自动离世、移出战团。
- **末世行止**：仿原「万界行止」的菜单系统，含医疗中心、废土市场、探险札记、任务中心、英雄榜等模块。

## 技术概览

- 服务端：`Hono` + `Bun`
- 前端：`React 19` + `React Router 7` + `Vite`
- 样式：`Tailwind CSS 4`
- 战斗引擎：`battle-v5`（时间轴回合制，技能/词条/Buff 全配置驱动）
- 持久化：末世模式当前为**浏览器 `localStorage` 存档**（按账号隔离），不依赖服务端数据库即可游玩；底层框架同时保留 PostgreSQL / Drizzle / Redis / Better Auth 等能力供扩展。
- AI 旁白：复用 `AI SDK` 能力做「末世生存系统」播报（需配置 LLM Provider）。

## 目录结构（末世模式相关）

```text
.
├── src/shared/engine/survival/   # 末世模式引擎（均为新增，未改原游戏逻辑）
│   ├── chargen.ts                # 幸存者/主角随机生成（六维属性 + 词条 + 段位 + 稀有度）
│   ├── state.ts                  # 持久化状态 + mutators（招募/遣散/入库/制造/出击装配）
│   ├── recovery.ts               # HP/伤势/濒死/撤离后时间戳恢复
│   ├── economy.ts                # 废土币、制造改装、避难所设施、战团声望
│   ├── extraction/               # 出击-搜刮-战斗-撤离 状态机引擎
│   └── combatAdapter.ts          # 幸存者/敌人接入 battle-v5
├── src/react-app/routes/survival/
│   ├── route.tsx                 # 独立落地页（/survival）
│   ├── signup/route.tsx          # 建立幸存者档案（/survival/signup）
│   ├── login/route.tsx           # 幸存者核验（/survival/login）
│   ├── play/route.tsx            # 主玩法 Hub：战团/花名册/出击/医疗（/survival/play）
│   └── menu/                     # 末世行止菜单（/survival/menu）
├── docs/reskin-design-全民求生-系统搜打撤.md  # 完整换皮设计大纲
└── src/shared/theme/survival.ts  # 主题层：名词映射 + 「系统」旁白文案
```

## 本地开发与运行

环境要求：安装 [Bun](https://bun.sh)（≥ 1.x）。

```bash
# 1. 安装依赖
bun install

# 2. 启动开发服务器（前端 + API 并行）
bun run dev
# 浏览器打开 http://localhost:5173/

# 3. 进入末世模式落地页
#    访问 /survival → 点击「建立幸存者档案」注册 → 以代号生成紫色主角
```

其他常用命令：

```bash
bun run build      # 生产构建（client + server + battle-worker）
bun run lint       # ESLint
bun run check      # 类型检查（tsc -b）
bun run test       # 运行 src/shared 下的纯引擎单测
```

> 引擎整链验证（可选）：`bun run src/shared/engine/survival/demo.ts`

## 设计文档

完整的换皮设计思路、概念映射总表（修仙 → 末世）、分阶段落地路线与已落地进度，见
[`docs/reskin-design-全民求生-系统搜打撤.md`](docs/reskin-design-全民求生-系统搜打撤.md)。

## 开源协议与致谢

- 本换皮版本基于 [ChurchTao/Daoyou《万界道友》](https://github.com/ChurchTao/Daoyou) 开源代码改造，沿用其 **GNU General Public License v3.0** 协议（见 [`LICENSE`](LICENSE)）。
- 引擎、战斗、账号与部署框架来自上游；末世主题层、搜打撤循环、幸存者/战团/濒死系统等玩法改造为本仓库新增内容。
- 感谢上游社区与所有贡献者为本项目提供的底层架构。

<p align="center">
  愿你在废土中搜得一线生机，平安撤离。
</p>
