import type {
  CultivationTechnique,
  Cultivator,
  Skill,
} from '@shared/types/cultivator';
import { generateAiObject } from '@server/utils/aiClient';
import { isLlmConfigured } from '@shared/config/llm';
import { ELEMENT_VALUES, GENDER_VALUES } from '@shared/types/constants';
import { BASIC_SKILLS, BASIC_TECHNIQUES } from './config';
import {
  getCharacterGenerationPrompt,
  getCharacterGenerationUserPrompt,
} from './prompts';
import {
  CultivatorAIData,
  CultivatorAIRawSchema,
  normalizeCultivatorAIData,
} from './types';
import { generateAttributes, generateSpiritualRoots } from './utils';

const OFFLINE_SURNAMES = [
  '林', '苏', '叶', '沈', '楚', '萧', '云', '江', '顾', '谢', '陆', '白', '秦', '温', '莫',
];
const OFFLINE_GIVEN = [
  '清', '霜', '玄', '尘', '逸', '渊', '昭', '晏', '珩', '璃', '珏', '澜', '璟', '川', '衡', '若', '凝', '陌',
];
const OFFLINE_ORIGINS = [
  '青云宗外门', '散修村落', '落魄世家', '隐世药谷', '边陲小镇', '江湖游侠', '没落道统', '商会旁支',
];
const OFFLINE_PERSONALITIES = [
  '沉稳内敛，喜怒不形于色',
  '跳脱机敏，喜好钻研奇巧',
  '坚毅果决，重情重义',
  '淡然随性，随遇而安',
  '心高气傲，不服于人',
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSeveral<T>(arr: readonly T[], count: number): T[] {
  const pool = [...arr];
  const result: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

/**
 * 未配置 LLM 时的本地角色骨架生成，供本地开发 / 离线体验使用。
 * 不依赖任何外部 API，纯随机规则生成可落库的合法角色数据。
 */
function buildOfflineCharacterData(userInput: string): CultivatorAIData {
  const trimmed = userInput.trim();
  const surname = pickRandom(OFFLINE_SURNAMES);
  let given = pickRandom(OFFLINE_GIVEN);
  if (Math.random() < 0.5) given += pickRandom(OFFLINE_GIVEN);
  let name = surname + given;
  if (name.length > 4) name = name.slice(0, 4);
  if (name.length < 2) name = surname + pickRandom(OFFLINE_GIVEN);

  const elementCount = 1 + Math.floor(Math.random() * 4); // 1-4 个灵根
  const elementPreferences = pickSeveral(
    ELEMENT_VALUES,
    elementCount,
  ) as CultivatorAIData['element_preferences'];
  const aptitude = 40 + Math.floor(Math.random() * 56); // 40-95

  const origin = pickRandom(OFFLINE_ORIGINS);
  const personality = pickRandom(OFFLINE_PERSONALITIES);
  const background = trimmed
    ? `此子生于${origin}，本是寻常子弟。${trimmed}`
    : `此子生于${origin}，本是寻常子弟，机缘未至，道途尚远。`;

  return {
    player_race: 'human',
    race_narrative: '人身近道，百法皆可参悟。',
    name,
    gender: pickRandom(GENDER_VALUES) as CultivatorAIData['gender'],
    origin,
    personality,
    background: background.length > 300 ? background.slice(0, 300) : background,
    element_preferences: elementPreferences,
    aptitude_score: aptitude,
    balance_notes:
      '（离线生成）未配置 LLM，角色设定由本地规则随机生成；配置 LLM_PROVIDER 与对应 API Key 后可获得 AI 个性化设定。',
  };
}

export class CharacterGenerator {
  /**
   * 生成新角色
   * @param userInput 用户输入的描述/提示词
   */
  public static async generate(
    userInput: string,
  ): Promise<{ cultivator: Cultivator; balanceNotes: string }> {
    // 1. 调用 AI 生成角色骨架；未配置 LLM 时走本地离线生成
    const llmConfigured = isLlmConfigured();

    let data: CultivatorAIData;
    if (!llmConfigured) {
      data = buildOfflineCharacterData(userInput);
    } else {
      const prompt = getCharacterGenerationPrompt();
      const userPrompt = getCharacterGenerationUserPrompt(userInput);
      const aiResponse = await generateAiObject({
        system: prompt,
        prompt: userPrompt,
        schema: CultivatorAIRawSchema,
        name: '修仙真形骨架',
        sceneId: 'character-generation',
      });
      data = normalizeCultivatorAIData(aiResponse.output);
    }

    // 2. 数值化生成
    const attributes = generateAttributes();
    const spiritual_roots = generateSpiritualRoots(
      data.aptitude_score,
      data.element_preferences,
    );

    // 确定主灵根（强度最高的）
    const mainRoot = spiritual_roots.reduce((prev, current) =>
      prev.strength > current.strength ? prev : current,
    );

    // 3. 分配功法与神通
    // 功法：主灵根对应的基础功法
    const cultivation = BASIC_TECHNIQUES[mainRoot.element]();
    const cultivations: CultivationTechnique[] = [cultivation];

    // 神通：主灵根对应的一攻一守
    const skills: Skill[] = [...BASIC_SKILLS[mainRoot.element]];

    // 4. 其他基础数值
    const age = 14 + Math.floor(Math.random() * 6); // 14-20岁
    // 寿元：炼气期基础100，分数高加成
    const lifespan =
      80 + Math.floor(Math.random() * 20) + (data.aptitude_score > 80 ? 20 : 0);

    // 构造完整的 Cultivator 对象
    const cultivator: Cultivator = {
      id: '', // Placeholder
      name: data.name,
      gender: data.gender,
      origin: data.origin,
      personality: data.personality,
      background: data.background,
      playerRace: 'human',
      raceNarrative: data.race_narrative,

      realm: '炼气',
      realm_stage: '初期',
      age,
      lifespan,

      attributes,
      spiritual_roots,
      cultivations,
      skills,
      status: 'active',
      spirit_stones: 0,
      pre_heaven_fates: [], // 后续流程生成
      inventory: {
        artifacts: [],
        consumables: [],
        materials: [],
      },
      equipped: {
        weapon: null,
        armor: null,
        accessory: null,
      },
      prompt: userInput,
      balance_notes: data.balance_notes,
    };

    return {
      cultivator,
      balanceNotes: data.balance_notes,
    };
  }
}
