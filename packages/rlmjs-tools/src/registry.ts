export type RlmToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type RlmToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  loadedBytes?: number;
};

export type RlmToolRuntimeState = {
  depth: number;
  iteration: number;
  traceId: string;
  loadedBytes: number;
};

export interface RlmToolRuntime {
  invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult>;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  state: RlmToolRuntimeState
) => Promise<RlmToolResult> | RlmToolResult;

export type ToolRegistryOptions = {
  unknownToolMessage?: (name: string) => string;
};

export function createToolRegistry(
  handlers: Record<string, ToolHandler>,
  options?: ToolRegistryOptions
): RlmToolRuntime {
  const unknownToolMessage =
    options?.unknownToolMessage ?? ((name: string) => `unknown tool '${name}'`);

  return {
    async invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
      const handler = handlers[call.name];
      if (!handler) {
        return {
          ok: false,
          error: unknownToolMessage(call.name)
        };
      }

      try {
        return await handler(call.args, state);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "tool execution failed"
        };
      }
    }
  };
}

export function okToolResult(data: unknown, loadedBytes = 0): RlmToolResult {
  return {
    ok: true,
    data,
    loadedBytes: Math.max(0, Math.floor(loadedBytes))
  };
}

export function errorToolResult(error: string): RlmToolResult {
  return {
    ok: false,
    error
  };
}
