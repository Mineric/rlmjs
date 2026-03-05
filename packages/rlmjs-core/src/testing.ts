import type {
  RlmProvider,
  RlmProviderAction,
  RlmProviderInput,
  RlmToolCall,
  RlmToolResult,
  RlmToolRuntime,
  RlmToolRuntimeState
} from "./types.js";

export type DeterministicProviderRule = {
  when: (input: RlmProviderInput) => boolean;
  action: RlmProviderAction | ((input: RlmProviderInput) => RlmProviderAction | Promise<RlmProviderAction>);
};

export function createDeterministicProvider(
  rules: DeterministicProviderRule[],
  fallback?: (input: RlmProviderInput) => RlmProviderAction | Promise<RlmProviderAction>
): RlmProvider {
  return {
    async complete(input: RlmProviderInput): Promise<RlmProviderAction> {
      for (const rule of rules) {
        if (!rule.when(input)) {
          continue;
        }
        return typeof rule.action === "function" ? await rule.action(input) : rule.action;
      }
      if (fallback) {
        return await fallback(input);
      }
      throw new Error("no deterministic provider rule matched");
    }
  };
}

export type DeterministicToolHandler = (
  call: RlmToolCall,
  state: RlmToolRuntimeState
) => RlmToolResult | Promise<RlmToolResult>;

export function createDeterministicToolRuntime(
  handler: DeterministicToolHandler
): RlmToolRuntime {
  return {
    async invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
      return await handler(call, state);
    }
  };
}
