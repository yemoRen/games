# 《全民求生・系统搜打撤》换皮设计大纲

> 目标：把现有修仙放置游戏《万界道友》的主题与核心循环，改写为**末世 LitRPG 搜打撤（系统搜打撤）**生存手游。
> 原则：**引擎零改动或极少改动，只换主题层（名词/文案/数值/美术 token）与核心循环外壳**。
> 本文档仅为设计思路与大纲，**不改动任何代码**。

---

## 0. 一句话定位

| 维度 | 万界道友（现状） | 全民求生・系统搜打撤（目标） |
|---|---|---|
| 题材 | 修仙放置 | 末世生存 + LitRPG「系统」 |
| 主循环 | 闭关修炼 → 突破 → 秘境产出 | 系统发布任务 → **搜**(搜刮) → **打**(战斗) → **撤**(撤离结算) |
| 爽点 | 境界飞升、功法法宝收集 | 高风险高回报的撤离、装备积累、据点经营 |
| 底层引擎 | Hono+React+PostgreSQL+Drizzle+Battle-v5 | **完全复用** |

结论：现有架构是「主题无关的数据/规则引擎」，换皮 = 主题层重写 + 名词映射表 + 数值重新调参 + 一个「出击-撤离」状态机外壳。

---

## 1. 为什么这套代码天然适合换皮

阅读核心模块后得到的关键事实：

- **角色是纯数据模型** (`src/shared/types/cultivator.ts`)：六维 `Attributes` + `inventory`(artifacts/consumables/materials) + `equipped` + `condition`。没有任何修仙硬编码。
- **战斗完全 data-driven** (`src/shared/engine/battle-v5`)：技能/Buff/效果全部由 `AbilityConfig` / `Buff` / `Effect` 配置驱动，运行时从 `creation_products.product_model` 实时推导。**改主题不动战斗逻辑**。
- **创造系统 LLM+词条驱动** (`src/shared/engine/creation-v2`)：产品分 `skill / artifact / gongfa` 三类，由 affix（词条）+ LLM 生成 `productModel`。换皮只需改产品类型与词条库。
- **「撤」已有契约** (`src/shared/contracts/retreat.ts`)：已有 `cultivate | breakthrough` 的撤离/闭关结果结构，可扩展为「撤出战场结算」。
- **in-run 状态机已存在** (`src/shared/types/condition.ts`)：`hp/mp`、`toxicity`、`statuses`(weakness/wound/near_death)。这正好是**单次出击的生存状态**的现成载体。
- 修炼、炼丹、势力、市场、副本敌人生成均为独立模块，可逐个替换文案与数值。

---

## 2. 核心循环：系统搜打撤（最关键的增量设计）

原游戏「秘境」是**被动放置产出**。新游戏要把它升级为**主动的「出击 → 撤离」循环**，这是整个换皮的灵魂。

```
┌─────────┐   任务/目标   ┌──────────┐
│ 系统面板 │ ───────────▶ │ 据点(安全区)│
└─────────┘              └────┬─────┘
                               │ 出击(搜打撤)
                               ▼
                     ┌───────────────────┐
                     │ 危险区域(副本/战场)│
                     │  搜: 搜刮物资/容器  │
                     │  打: 战斗(丧尸/人)  │
                     │  撤: 抵达撤离点     │
                     └────┬──────────┬───┘
                 撤离成功 │          │ 死亡/超时
                          ▼          ▼
                   ┌──────────┐  ┌──────────────┐
                   │ 物资入库  │  │ 丢失未撤离物资 │
                   └────┬─────┘  └──────────────┘
                        │ 回到据点
                        ▼
                  休整(condition恢复) → 强化装备 → 再出击
```

- **搜（Loot）**：进入危险区域，探索建筑/容器，搜刮材料、弹药、食物、装备（复用 `materials` / `consumables` / `artifacts`）。带**时间压力/区域收缩**机制。
- **打（Fight）**：遭遇战用 `battle-v5` 引擎；敌人由 `enemy-generation` 生成（丧尸、变种人、掠夺者、其他幸存者）。武器=原法宝，战术=原功法，医疗包=原丹药。
- **撤（Extract）**：抵达撤离点即「撤」。**成功 → 本局搜刮入库；死亡/超时 → 仅丢失本局未撤离物资**（保留据点资产）。这正是 `retreat.ts` 与 `condition.ts` 的用武之地。

> 决策点：是否引入 **PvP（其他真人玩家同图）**？建议首版仅 PvE + AI 掠夺者，PvP 作为二期。

---

## 3. 概念映射总表（修仙 → 末世）

| 原概念 | 代码/模块 | 末世映射 | 备注 |
|---|---|---|---|
| 道友/修士 | `cultivator` | 幸存者 | 改名即可 |
| 六维属性 | `Attributes` | 体魄/力量/智力/根骨/敏捷/意志 → **体力/力量/科技/体质/敏捷/意志** | 重命名 + 微调含义 |
| 灵根(五行) | `SpiritualRoot` | 天赋专长（力量型/敏捷型/科技型/医疗型） | 元素→专长分支 |
| 先天命格 | `PreHeavenFate` | 出身背景/初始天赋 | 保留随机生成 |
| 境界 | `realm`/`cultivation` | 生存等级段位（落难者→据点成员→佣兵→战团领袖→避难所长） | 数值曲线重调 |
| 修为/感悟 | `cultivation_progress` | 经验/声望 | 改名 |
| 功法(被动) | `CultivationTechnique` | 战术专长/被动技能 | 产品类型重映射 |
| 技能(主动) | `Skill` | 主动战术/武器技能 | 复用 |
| 法宝 | `Artifact` | 武器/护甲/义体/配件 | 产品类型重映射 |
| 丹药 | `Consumable` | 医疗包/罐头/血清/兴奋剂 | 复用 `spec` |
| 炼丹 | `alchemyConfig` | 制造/改装台 | 词条末世化 |
| 灵石 | `spirit_stones` | 废土币/信用点 | 改名 |
| 宗门 | `sect` | 避难所/佣兵战团/势力 | 复用据点逻辑 |
| 秘境 | 副本/敌人生成 | 危险区域/搜打撤战场 | 加时间压力 |
| 灵田 | `spirit-field` | 据点温室/生产车间 | 复用产出 |
| 心魔/走火入魔 | `deviation_risk` | 创伤/精神污染 | 改名 |
| 闭关 | `retreat` | 休整/据点恢复 | 复用 |
| 顿悟 | `epiphany` | 灵感/突破 | 保留 |
| 五行元素 | `ElementType` | 物理/火焰/腐蚀/电磁/冰冻等伤害类型 | 重映射 |

---

## 4. 各系统改造要点

### 4.1 角色与属性（`types/cultivator.ts`）
- 六维 `Attributes` 仅做**语义重命名**（如 `spirit 灵力`→`科技/能量`），数值字段不变，避免动 DB schema。
- `SpiritualRoot` → 改为「初始天赋树」：决定开局偏向（近战/远程/医疗/工程），影响属性成长与可装备类型。
- `pre_heaven_fates` → 「出身叙事」，保留 LLM 随机生成。

### 4.2 战斗引擎（`engine/battle-v5`）—— **几乎零改动**
- 这是最大的好消息：战斗逻辑完全配置驱动。
- 改造只发生在**表现层**：技能名/特效文案/元素主题（五行→废土伤害类型）。
- `CultivatorCombatAdapter` 已把角色映射成战斗属性，改文案即可。
- 建议新增「**环境危害**」词条（辐射区、陷阱）丰富搜打撤战术。

### 4.3 装备与创造（`engine/creation-v2`）—— **改产品类型 + 词条库**
- 现有三类 `skill / artifact / gongfa` 直接映射为：
  - `artifact` → **武器 / 护甲 / 义体 / 配件**
  - `skill` → **主动战术**
  - `gongfa` → **被动专长**
- `affixes`（词条）库整体重写为末世向（如「+暴击」→「+爆头伤害」，「火抗」→「防辐射」）。
- `CraftCostCalculator` / `CreationOrchestrator` 逻辑不变，仅成本货币与材料改名。

### 4.4 状态系统（`types/condition.ts`）—— **搜打撤核心，重点改造**
现状已具备：
```
resources: { hp, mp }
gauges: { pillToxicity }
statuses: weakness / minor_wound / major_wound / near_death ...
```
末世化改造：
- `hp/mp` → 生命/体力（mp 可作「体力/精力」，决定能否冲刺、精准射击）。
- `pillToxicity` → **辐射/感染值**：搜打撤中暴露在污染区累积，过高触发 debuff。
- `statuses` 扩展为末世创伤：流血、骨折、饥饿、脱水、恐慌。
- 这正是**单次出击 survival 状态**的理想载体：进图初始化，撤离后按规则恢复。

### 4.5 撤离结算（`contracts/retreat.ts`）—— **扩展为「撤」**
- 现有 `RetreatResultData` 增加 `extract` 分支：成功/死亡/超时三种结果。
- 死亡/超时 → 仅清空「本局未撤离背包」，据点仓库与已装备保留（控制挫败感）。

### 4.6 修炼 → 等级/声望（`engine/cultivation`）
- `realmProgression` 改为「生存段位」阶梯，突破改为「晋升考核」。
- `cultivationExpGain` / `qiSystem` 文案改为经验/声望获取。

### 4.7 炼丹 → 制造（`config/alchemyConfig`）
- 丹药配方 → 医疗包/罐头/血清/弹药改装配方。
- `consumableSystem` 的 `spec` 结构可直接复用（效果=回血/解毒/增益）。

### 4.8 经济（`marketConfig`/`auctionConfig`/`recycle`）
- 灵石 → 废土币；交易行 → **黑市**；回收 → 拆解变卖。
- 保留 auction/recycle 机制，仅文案与货币改名。

### 4.9 势力（`engine/sect`）
- 宗门 → 避难所/佣兵战团：据点建设、成员、专属商店、转投势力。
- `sectShop` / `sectTransferTalisman` 逻辑可复用。

### 4.10 副本与敌人（`engine/enemy-generation`）
- 秘境 → 危险区域（公寓/医院/军事基地/荒野）。
- 敌人类型：丧尸群、变种生物、AI 掠夺者小队、（二期）其他玩家。
- 新增「区域收缩/毒圈」与「撤离点」配置。

---

## 5. 数值与平衡方向

- **风险/回报曲线**：危险区域等级越高，产出越好，但死亡丢装概率越高。这是搜打撤的灵魂张力。
- **死亡惩罚分级**：本局未撤离物资丢失；据点资产与已装备安全。避免硬核劝退。
- **装备损耗**：战斗/环境磨损耐久，制造台修复（复用 `alchemy` 改造）。
- **双货币**：废土币（日常流通）+ 稀有材料（高级制造/黑市），对应原灵石+材料。
- **属性曲线**：原修仙「后期数值爆炸」，末世宜更线性、更吃装备与操作，避免数值通胀。

---

## 6. 叙事与「系统」包装（LitRPG）

- 复用现有 **LLM 旁白能力**，把「天道/系统」改为「末世生存系统」：
  - 任务播报：「检测到附近物资信号，是否出击？」
  - 撤离提示：「撤离点已开启，剩余 02:13。」
  - 死亡复盘：「本次未撤离物资已遗失……」
- 「系统」作为贯穿 UI 的主视觉语言（HUD 风格、扫描线、告警红）。

---

## 7. 分阶段落地路线（参考 AGENTS.md 架构）

| 阶段 | 目标 | 涉及模块（真实路径） | 改动量 |
|---|---|---|---|
| **Phase 0 主题层** | 名词/文案/美术 token 替换 | `types/constants.ts`、`types/cultivator.ts`、`dictionaries.ts`、`public/` 资源 | 低（纯文案/资源） |
| **Phase 1 核心循环** | 出击-撤离状态机 + condition 进图初始化/结算 | `contracts/retreat.ts`、`types/condition.ts`、`engine/enemy-generation`、`react-app` 战场 UI | **中（新增主循环）** |
| **Phase 2 数值重构** | 段位曲线、损耗、双货币、危险区等级 | `config/realmProgression.ts`、`cultivationTuning.ts`、`marketConfig.ts`、`alchemyConfig.ts` | 中 |
| **Phase 3 经济与势力** | 黑市、避难所、制造台 | `marketConfig`/`auctionConfig`/`recycle`、`engine/sect`、`engine/creation-v2` 词条库 | 中 |
| **Phase 4 内容扩展** | 新区域/敌人/PvP/赛季 | `enemy-generation`、`online-battle`、`contracts` | 高（增量） |

> 路线遵循 AGENTS.md 约束：新 API 走 `src/server/routes/api/index.ts` + 现有中间件；前端路由集中 `router.tsx`；纯引擎逻辑单测仅限 `src/shared`。

---

## 8. 风险与待决策

1. **PvP 与否**：同图真人极大提升搜打撤张力，但也带来反作弊/匹配成本。建议二期。
2. **死亡惩罚粒度**：硬核丢装 vs 轻度惩罚，需 A/B 验证留存。
3. **美术资源量级**：末世写实风 vs 原修仙风资源不可复用，是主要美术成本。
4. **买量/SEO**：换皮后应用商店素材、关键词需重新定位。
5. **引擎边界**：`condition` 当前是「角色持久状态」，要切分「据点态」与「出击态」，需确认 `battleProjection` 重建逻辑不受影响（AGENTS.md 已规定 battleProjection 为运行时重建、不持久化，利好转皮）。

---

## 9. 下一步建议

若确认方向，建议按 Phase 0 → Phase 1 推进，先做一个**最小可玩 Demo**：
- 一个危险区域 + 搜刮 + 一场战斗 + 撤离结算 + condition 恢复。
- 验证「搜打撤」手感与 `condition`+`retreat` 的改造可行性，再全面铺开。

---

## 10. 实际执行进度（截至 2026-09-05 深夜）

Phase 0 → 3 已落地并接入 dev（5174）；本晚完成 Phase 4 收尾（功能 + 全量 lint 清零于 reskin 范围）。

- **末世行止菜单换皮**：`/survival/menu` 6 大分组（生存/机遇/交易/争锋/情报/系统）× 约 23 项，逐项仿原「万界行止」换皮为末世主题——医疗中心、招募集合、避难所·菜园、战术手册、掌握技能、战团技能、全部战绩、探险札记、漫游搜打撤、蜃景密室、重塑天赋、任务中心、废土市场、鉴物回收、拍卖行/末世赌局/擂台（占位）、英雄榜、世界传闻、兑换码、救济簿、幸存者社群/意见反馈、系统设置。
- **副本救援幸存者**：`ExtractionEngine.rollRescue()` 按危险等级概率触发 → 带出 `carriedNpc`；`extract()` 成功搬入 `bankedNpc`；经 `applySortieResult` 写入 `state.recruits`，可在「招募集合」付费纳新。
- **撤离后随时间回血（非满血再战）**：`recovery.ts` 百分比恢复模型（基础 0.8%·maxHp/分 + 体质 0.4/点/分，医疗站 / 药品 / 伤势综合修正）；`survivorStatus` 持久化 `currentHp/maxHp/injuries/lastRecoveredAt`；进页面 / 切 tab 时 `recoverAll` 时间戳结算；受伤越重恢复越慢，药品开启 2× 恢复窗口。
- **明确不做（用户要求）**：撤离点 / 收缩圈倒计时（Phase 4 暂不做）。
- **质量验证**：reskin 相关文件 `bun run lint` 全绿；`tsc -p tsconfig.app.json --noEmit` 通过；`rescue-recovery-smoke.ts` 冒烟通过；`bun run dev` 前端 5174 + `/survival/menu` 均 200、可玩搜打撤闭环。
- **残留 lint（原游戏基础设施，未动）**：`server/lib/auth/hono.ts` 两处「未用」疑似 alias 误报；`extraction/ExtractionEngine.ts` 的 `fight(_rng)` 未用参数（7 处调用，动它=动原游戏代码）。

（文档正文完。）

---

## 10. 实施进度（Phase 0 / Phase 1 MVP 已完成 ✅）

按本大纲已落地一个**可运行的最小可玩 Demo**，验证「搜打撤」核心循环确实能在现有引擎上跑通：

**新增文件（均为新增，未改原游戏逻辑）**
- `src/shared/theme/survival.ts` — Phase 0 主题层：名词映射 +「系统」旁白文案。
- `src/shared/engine/extraction/types.ts` — Phase 1 类型：出击状态机、战利品、危险区域、撤离结算。
- `src/shared/engine/extraction/content.ts` — Demo 内容资产（区域/敌人/战利品/幸存者预设）。
- `src/shared/engine/extraction/ExtractionEngine.ts` — 核心引擎：搜刮 → 真实战斗(battle-v5) → 撤离结算；in-run 状态复用 `CultivatorCondition`。
- `src/shared/engine/extraction/demo.ts` — 可运行演示入口。
- `src/shared/engine/extraction/index.ts` — 导出。

**运行方式**
```
bun run src/shared/engine/extraction/demo.ts
```
**已验证的行为**
- 搜刮获得物资 → 携带（未撤离）；
- 遭遇战走真实 `resolveDuelToCompletion`，回合/胜负/HP 真实结算；
- 撤离成功 → 携带物资入库；阵亡 → 仅丢未撤离物资（0 入库）；
- 同种子 `mulberry32` 结果可复现。

**下一步（Phase 2 起）**：接 `createCombatUnitFromCultivator` 让幸存者带完整装备/战术参战；把 `ExtractionRunState` 持久化（替代/扩展 `retreat` 契约）；做前端 UI 与区域收缩/撤离点。

---

## 11. Phase 2 / Phase 3 实施进度（✅ 已落地）

在 Phase 0/1 基础上，已完成**数值重构（随机生成属性词条）**与**经济/势力（废土币·制造改装·避难所·战团）**，并补齐原游戏式「底部常驻导航」UI。

**新增引擎文件（`src/shared/engine/survival/`，均为新增，未改原游戏逻辑）**
- `rng.ts` — 可复现随机数（hashSeed/mulberry32 同源）。
- `chargen.ts` — **Phase 2 数值重构**：基于种子 RNG 随机生成幸存者六维属性 + 1~3 条「词条」，含战力/段位/稀有度推导。词条可改属性、给战斗增益（HP/暴击/搜刮运势）。稀有度越高属性加成与词条数越多。
- `economy.ts` — **Phase 3 经济与势力**：废土币、制造改装（配方 + 随机词缀产出装备）、避难所设施（瞭望塔/医疗站/改装工坊/训练场，升级提供驻防被动）、战团/势力声望。
- `state.ts` — 持久化游戏状态：花名册/背包/装备/货币/避难所/势力，纯函数 mutators（招募、入库折算、装备、制造、升级、投资、出击装配 `buildLoadout`）。
- `persistence.ts` — localStorage 存档（浏览器守卫，Node 环境安全回退）。
- `demo.ts` — 整链验证入口。

**新增 UI（`src/react-app/`）**
- `routes/survival/route.tsx` — 主玩法 Hub：仿原游戏**底部常驻导航**（角色 / 背包 / 基地 / 出击）。
  - 角色：花名册、属性条、词条、段位/战力、招募（递增费用）。
  - 背包：材料、制造（配方消耗材料+币）、装备库与装备/卸下（属性真实带入出击）。
  - 基地：避难所设施升级、战团声望投资、驻防加成一览、重置存档。
  - 出击：复用 `extraction` 引擎跑真实战斗，撤离入库写回存档（废土币+材料），瞭望塔/医疗站等加成生效。
- `router.tsx` 注册顶层路由 `/survival`。

**运行方式**
```
bun run src/shared/engine/survival/demo.ts   # 引擎整链验证
# 浏览器：dev 5174 → /survival
```

**已验证**：引擎 demo 跑通（生成→出击→入库→制造→装备→升级→投资→重新推导属性）；`eslint` 0 错；`tsc -p tsconfig.app.json` 0 错；dev 5174 编译 `/survival` 模块 200。

**已知设计取舍**
- 出击 HP 数值较大（battle-v5 属性→HP 缩放约 10×），UI 直接显示，未做压缩展示。
- 避难所/势力加成通过 `buildLoadout` 在进入搜打撤时叠加到属性，撤离时限/收缩点暂未启用（Phase 4 候选）。
- 制造为确定性本地随机（不依赖 LLM），词缀池为精简版，后续可对接 `creation-v2` 词条库做更丰富掉落。

## 11. battle-v5 集成：正式装备 / 词条进入战斗（已落地）

**目标**：把"词条/装备的战斗加成"真正接入 battle-v5，而非只影响六维属性。

**做法**
- 新增 `src/shared/engine/survival/combatAdapter.ts`：
  - `buildSurvivorUnit` / `buildEnemyUnit` 通过 **`createCombatUnitFromCultivator`** 构建战斗单位（与原游戏 tower/sect 同一条派生属性链路）。
  - 词条/装备/避难所的"战斗加成"在构建后以 `AttributeModifier` 注入：
    - `hpBonus` → `MAX_HP`（FIXED 加值）
    - `critBonus` → `CRIT_RATE`（FIXED 加值）
  - `lootLuck` / `startHpRatio` 属"搜打撤"层收益，不进战斗单位（分别由 `search` 运势、出击初始血量消费）。
- `SurvivorLoadout` 增加可选 `profile?` / `bonus?`：`fight`/`createRun` 检测到即走正式链路，否则退化为原"属性直转"（旧 demo / 独立 `/sortie` 页不受影响）。
- `economy.ts` 装备新增 `combat?: { hpBonus, critBonus, lootLuck }` 战斗词条，`rollGear` 约 50% 概率附加一条（气血/暴击/搜刮运势），并并入装备 `affixes` 展示。
- `state.ts` 新增 `buildSortieLoadout`（聚合 词条+装备+避难所 加成）与 `aggregateGearCombat`。
- `recovery.ts` `freshStatus` 改用 battle-v5 同款 `400 + 体质×20 + 耐力×3 (+词条气血)` 公式，使恢复/战斗共用同一 maxHp 口径。
- `search(state, rng, luck)` 新增 `luck` 参数：整数保底额外次数 + 小数部分概率额外一次。

**数据流**
```
幸存者档案 + 已装备 + 避难所
   → buildLoadout(属性) + aggregateTraitCombat + aggregateGearCombat + computeShelterBonuses
   → buildSortieLoadout → { attributes, profile, bonus }
   → createRun / fight → buildSurvivorUnit → createCombatUnitFromCultivator + 注入 MAX_HP/CRIT_RATE 修饰
   → resolveDuelToCompletion（真实战斗）
   → 回写 HP/伤势（applySortieResult 同步 battle maxHp）
```

**UI**
- `/survival` 出击页：出击前展示"战斗加成"胶囊（气血上限+/暴击+/搜刮运势+/初始血量+，并标注由 `createCombatUnitFromCultivator` 构建）。
- 装备词条（含战斗词条）随装备库/制造结果自然展示。

**已验证**
- `tsc -p tsconfig.app.json` 0 错；`bun run lint` 除 3 处原游戏基础设施遗留报错外 0 错（hono.ts 误报、`ExtractionEngine._rng` 未用参数，均非换皮范围）。
- 集成冒烟：`hpBonus=60 → maxHp 736→796`、`critBonus=0.18 → CRIT 0.05→0.23`、出击携带 HP 注入正确；完整 `buildSortieLoadout→createRun→fight→extract` 路径运行成功。
- dev 5174 编译 `/survival`、`/survival/menu` 均 200，无 transform 错误。

**边界**：撤离点 / 收缩圈倒计时仍未做（用户明确暂不实施）。

**下一步（Phase 4+ 候选）**：撤离点/收缩圈倒计时压迫感；将状态接入正式账号与 `retreat` 契约做服务端持久化；扩充战利品/敌人/区域内容（敌人也支持词条/装备）；对接 `creation-v2` 词条库丰富掉落。


---

## 第 12 节　扩充战利品/敌人/区域（Phase 5）

在 Phase 4 的战斗集成之上，扩充内容深度并引入"阶级词缀"体系。

### 12.1 七阶级稀有度（白-绿-蓝-紫-黄-橙-红）
- 新增 `src/shared/engine/survival/affixes.ts`：`AFFIX_TIERS` 共 7 阶，配色与最初游戏完全一致（白 `#cbd5e1` → 绿 → 蓝 → 紫 → 黄 → 橙 → 红 `#f87171`），阶级逐级提升：数值更强、出现概率更低。
- 每阶带 `weight`（抽取权重，越高级越稀有）与 `affixMag`（数值缩放倍率 1.0→5.0）。
- 关于"对接 creation-v2 词条库"：creation-v2 的 `AffixRarity` 仅 4 阶且依赖整套 creation-tag/监听器/能量预算管线，直接拉入会拖垮本模块。这里沿用其"稀有度→权重→词缀数量→数值缩放"的分层思想，落到**自包含**的废土词条模型，保证可复现、可 lint、低风险。

### 12.2 敌人词缀（随副本难度提升）
- `ENEMY_AFFIXES` 词缀池（凶暴/嗜血/铁甲/重甲/迅捷/狂怒/钢骨/巅峰/不灭…），覆盖属性增量与暴击/气血战斗增益。
- `rollEncounter` 现在按区域 `dangerLevel` 结算敌人词缀：`rollEnemyAffixes` 决定词缀**数量**（1→4）与**阶级上限**（=危险度），`aggregateEnemyAffixes` 把词缀聚合成属性增量 + 气血/暴击加成，写入 `EnemyArchetype.bonus/affixes`。
- `combatAdapter.buildEnemyUnit` 把敌人 `bonus` 以 `AttributeModifier` 注入战斗单元（与幸存者同链路），`fight` 的战斗日志会打出敌人词缀标签（如 `〔凶暴·蓝〕`）。

### 12.3 掉落装备（带阶级词缀）
- `GEAR_AFFIXES` 词缀池（凯夫拉/动力核心/致命一击/强化装甲/神话锻造…）。
- `rollGearDrop(rng, dangerLevel)` 按危险度掷出阶级，阶级越高词缀越多（1→3 条），产出完整 `GearItem`（带 `tier/tierColor/rarityName` 与战斗词条），以 `LootItem.gear` 装箱。
- `search` 每个搜刮轮有概率（0.25 + 危险度×0.04）掉落这类装备；瞭望塔额外掉落（`makeBonusLoot`）也转为带阶装备。
- `bankLoot` 识别 `item.gear` 并把装备直接入库到 `state.gear`（不再折算为材料/币），合成装备带阶级词缀进入可装备库存。

### 12.4 区域/敌人内容扩充
- `content.ts` 区域由 4 → 7 个，危险度 1..6：废弃公寓(1) / 废弃医院(2) / 城郊废墟(3) / 军事检查站(3) / 地铁隧道(4) / 地下研究所(5) / 核爆禁区(6)。
- 敌人原型由 4 → 9：新增 作战无人机、重装暴徒、废土狙击手、流窜拾荒客、战争领主(boss) 等。

### 12.5 验证（冒烟）
- 敌人词缀随危险度单调提升（均阶级 D1 0.55 → D6 1.94；词缀数 1→4；气血加成 1.7→21.7；暴击 0.5%→6.5%）。
- 装备掉落阶级严格 ≤ 区域危险度，D6 可达红阶。
- 完整 `createRun→search→fight→extract→bankLoot` 路径中，带阶级装备正确入库（合成紫阶"感知+10/搜刮运势+25%"验证通过）。
- `tsc -p tsconfig.app.json` 0 错；`bun run lint` 除 3 处原游戏基础设施遗留报错外 0 错；dev 5174 三路由均 200 无 transform 错误。
