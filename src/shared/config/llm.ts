import { z } from 'zod';

export const LLM_PROVIDER_IDS = ['deepseek', 'alibaba'] as const;

export const LlmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);

export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const LLM_PROVIDER_DEFAULT_MODELS: Record<LlmProviderId, string> = {
  deepseek: 'deepseek-v4-flash',
  alibaba: 'qwen3.7-flash',
};

export const LlmByokConfigSchema = z
  .object({
    provider: LlmProviderIdSchema,
    apiKey: z.string().trim().min(1).max(512),
    model: z.string().trim().min(1).max(128),
  })
  .strict();

export type LlmByokConfig = z.infer<typeof LlmByokConfigSchema>;

/**
 * 判断后端是否已配置真实 LLM（需要 LLM_PROVIDER 与至少一个对应 API Key 同时就绪）。
 * 仅在返回 true 时，角色推演等依赖外部模型的接口才会启用限流/计量。
 * 离线（未配置）时这些接口走本地兜底，不消耗额度、不受每日限额约束。
 */
export function isLlmConfigured(): boolean {
  return (
    Boolean(process.env.LLM_PROVIDER?.trim()) &&
    (Boolean(process.env.ALIBABA_API_KEY?.trim()) ||
      Boolean(process.env.DEEPSEEK_API_KEY?.trim()))
  );
}
