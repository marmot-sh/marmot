// Map the marmot-level `--reasoning low|medium|high` flag to each
// provider's specific knob. Single source of truth so the providers
// don't drift on the budget-token mapping or the option key shape.

import type { ReasoningEffort } from '../types.js';

const ANTHROPIC_BUDGET_TOKENS: Record<ReasoningEffort, number> = {
  low: 2_048,
  medium: 8_192,
  high: 24_576,
};

/** OpenAI / OpenRouter accept the effort string directly. Anthropic
 *  uses an explicit thinking-budget in tokens. */
export function reasoningForOpenAI(effort: ReasoningEffort | undefined) {
  if (!effort) return undefined;
  return { reasoningEffort: effort };
}

export function reasoningForAnthropic(effort: ReasoningEffort | undefined) {
  if (!effort) return undefined;
  return {
    thinking: {
      type: 'enabled' as const,
      budgetTokens: ANTHROPIC_BUDGET_TOKENS[effort],
    },
  };
}

export function reasoningForOpenRouter(effort: ReasoningEffort | undefined) {
  if (!effort) return undefined;
  return { reasoning: { effort } };
}
