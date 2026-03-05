import type { RlmToolCall, RlmToolResult, RlmToolRuntime, RlmToolRuntimeState } from "@software-machines/rlmjs-core";

export type WorkerLike = {
  postMessage: (message: unknown) => void;
  addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
  removeEventListener?: (type: "message", listener: (event: { data: unknown }) => void) => void;
};

export type WorkerToolRuntimeOptions = {
  timeoutMs?: number;
  maxPending?: number;
};

type ToolInvokeMessage = {
  type: "rlm_tool_invoke";
  id: string;
  call: RlmToolCall;
  state: RlmToolRuntimeState;
};

type ToolResultMessage = {
  type: "rlm_tool_result";
  id: string;
  result: RlmToolResult;
};

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkerToolRuntime(
  worker: WorkerLike,
  options?: WorkerToolRuntimeOptions
): RlmToolRuntime {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const maxPending = options?.maxPending ?? 64;
  const pending = new Map<
    string,
    {
      resolve: (value: RlmToolResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const onMessage = (event: { data: unknown }) => {
    const msg = event.data as ToolResultMessage;
    if (!msg || typeof msg !== "object" || msg.type !== "rlm_tool_result" || typeof msg.id !== "string") {
      return;
    }

    const task = pending.get(msg.id);
    if (!task) {
      return;
    }

    clearTimeout(task.timer);
    pending.delete(msg.id);
    task.resolve(msg.result ?? { ok: false, error: "worker returned empty result" });
  };

  worker.addEventListener("message", onMessage);

  return {
    async invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
      if (pending.size >= maxPending) {
        return {
          ok: false,
          error: `worker runtime pending limit exceeded (${maxPending})`
        };
      }

      const id = makeId();
      return await new Promise<RlmToolResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`worker tool timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });

        const message: ToolInvokeMessage = {
          type: "rlm_tool_invoke",
          id,
          call,
          state
        };
        worker.postMessage(message);
      }).catch((error: unknown) => {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "worker invoke failed"
        };
      });
    }
  };
}

export type WorkerToolHandler = (
  call: RlmToolCall,
  state: RlmToolRuntimeState
) => Promise<RlmToolResult> | RlmToolResult;

export function bindWorkerToolHandler(workerScope: WorkerLike, handler: WorkerToolHandler): void {
  workerScope.addEventListener("message", async (event: { data: unknown }) => {
    const msg = event.data as ToolInvokeMessage;
    if (!msg || typeof msg !== "object" || msg.type !== "rlm_tool_invoke" || typeof msg.id !== "string") {
      return;
    }

    try {
      const result = await handler(msg.call, msg.state);
      const response: ToolResultMessage = {
        type: "rlm_tool_result",
        id: msg.id,
        result
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: ToolResultMessage = {
        type: "rlm_tool_result",
        id: msg.id,
        result: {
          ok: false,
          error: error instanceof Error ? error.message : "worker handler failed"
        }
      };
      workerScope.postMessage(response);
    }
  });
}
