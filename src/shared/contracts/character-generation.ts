import type { ApiSuccess } from '@shared/contracts/http';
import type { Cultivator } from '@shared/types/cultivator';

export const CHARACTER_GENERATION_DAILY_LIMIT = 6;
export const CHARACTER_GENERATION_LIMIT_REACHED_CODE =
  'CHARACTER_GENERATION_LIMIT_REACHED';

export type CharacterGenerationLimitedBy = 'none' | 'email' | 'ip' | 'both';

export type CharacterGenerationQuota = {
  dailyLimit: number;
  remaining: number;
  remainingByEmail: number;
  remainingByIp: number;
  limitedBy: CharacterGenerationLimitedBy;
  ipTracked: boolean;
  /** 离线（未配置 LLM）时为 true，表示不限额、不计量 */
  unlimited?: boolean;
};

export type CharacterGenerationQuotaResponse = ApiSuccess<{
  quota: CharacterGenerationQuota;
}>;

export type GenerateCharacterResponse = ApiSuccess<{
  cultivator: Cultivator;
  tempCultivatorId: string;
  quota: CharacterGenerationQuota;
}>;
