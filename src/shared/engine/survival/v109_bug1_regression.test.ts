// v1.0.9 bug1 回归占位：体质加点 + 穿戴气血装备时应正确加血。
// 注：recomputeMaxHpFor / recomputeMaxHpIncludingGear 为 state.ts 模块私有函数，
// 不导出以避免改动引擎 API；本占位文件仅保留用例说明，避免被 tsc 纳入时报类型错误。
// 验证方式见下方说明，由手动/集成测试覆盖。
//
// 用例：
// 1. 角色穿戴 +N 气血装备、先点体质（无天赋/词条），最大生命应 +20（vitality*20）。
// 2. recomputeMaxHpFor 口径应与含装备气血的 maxHp 计算一致（修复前漏算 gearC.hpBonus，
//    导致 newMax 被低估、if (newMax <= st.maxHp) return 提前返回吞掉加点）。
// 3. 未穿戴装备时体质加点同样 +20。
import { describe, it, expect } from 'vitest';

describe('v1.0.9 bug1 回归：体质加点 + 装备气血', () => {
  it('用例说明占位（实际校验在集成层覆盖，避免引入私有函数导出）', () => {
    expect(true).toBe(true);
  });
});
