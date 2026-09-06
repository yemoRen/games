/**
 * Phase 0 — 末世生存主题层（noun / copy 替换层）
 *
 * 换皮原则：引擎逻辑一律不动，只在这里替换「叫什么、说什么」。
 * 后续把修仙 UI 文案、邮件/旁白、地图名词全部指向本文件即可。
 *
 * 对应设计大纲 docs/reskin-design-全民求生-系统搜打撤.md 第 3 节「概念映射总表」。
 */

/** 名词映射：修仙概念 → 末世概念（展示层统一从这里取词） */
export const SURVIVAL_NOUNS = {
  cultivator: '幸存者',
  realm: '生存段位',
  spiritualRoot: '天赋专长',
  cultivation: '战术训练',
  skill: '战术',
  artifact: '装备',
  pill: '医疗包',
  alchemy: '制造改装',
  spiritStone: '废土币',
  sect: '避难所',
  secretRealm: '危险区域',
  closedDoor: '休整',
  breakthrough: '晋升考核',
  innerDemon: '创伤应激',
  hp: '生命',
  mp: '体力',
  pillToxicity: '辐射/感染',
} as const;

export type SurvivalNounKey = keyof typeof SURVIVAL_NOUNS;

/** 「系统」音旁白（复用现有 LLM 旁白能力的占位文案） */
export const SYSTEM_LINES = {
  missionReady: '【生存系统】检测到附近物资信号，是否出击？',
  enterZone: '【生存系统】正在进入危险区域……环境因素开始侵蚀你的状态。',
  search: '【生存系统】搜刮中……发现物资。',
  encounter: '【生存系统】警告：敌对单位接近！',
  extractOpen: '【生存系统】撤离点已开启，尽快撤离！',
  extractSuccess: '【生存系统】撤离成功，物资已入库。',
  death: '【生存系统】生命体征消失……本次未撤离物资已遗失。',
  timeout: '【生存系统】区域封锁！未能及时撤离，物资遗失。',
} as const;

/** 段位阶梯（对应原「境界」） */
export const SURVIVAL_TIERS = [
  '落难者',
  '据点成员',
  '佣兵',
  '战团领袖',
  '避难所长',
] as const;

export function noun(key: SurvivalNounKey): string {
  return SURVIVAL_NOUNS[key];
}
