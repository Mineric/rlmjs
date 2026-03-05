import { test } from "node:test";
import assert from "node:assert/strict";

import { RlmEngine, RlmEngineLimitError } from "./engine.js";
import type {
  RlmProvider,
  RlmProviderInput,
  RlmProviderAction,
  RlmToolRuntime,
  RlmToolCall,
  RlmToolResult,
  RlmToolRuntimeState
} from "./types.js";

function hasToolMessage(input: RlmProviderInput): boolean {
  return input.messages.some((m) => m.role === "tool");
}

class InlineTools implements RlmToolRuntime {
  constructor(
    private readonly handler: (call: RlmToolCall, state: RlmToolRuntimeState) => Promise<RlmToolResult>
  ) {}

  invoke(call: RlmToolCall, state: RlmToolRuntimeState): Promise<RlmToolResult> {
    return this.handler(call, state);
  }
}

test("root flow explores tools before final answer", async () => {
  const provider: RlmProvider = {
    async complete(input): Promise<RlmProviderAction> {
      if (!hasToolMessage(input)) {
        return {
          type: "tool_call",
          call: {
            name: "searchSlices",
            args: { query: input.query }
          }
        };
      }
      return {
        type: "final",
        answer: "answer after exploration"
      };
    }
  };

  const tools = new InlineTools(async () => ({
    ok: true,
    data: { hits: ["slice-1"] },
    loadedBytes: 128
  }));

  const engine = new RlmEngine({ provider, tools });
  const out = await engine.run({ query: "where is launch date" });
  const trace = engine.getTrace();

  assert.equal(out.answer, "answer after exploration");
  assert.equal(out.stats.iterations, 2);
  assert.ok(trace);
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0]?.providerAction.type, "tool_call");
  assert.equal(trace.steps[1]?.providerAction.type, "final");
  assert.equal(trace.steps[0]?.toolResult?.ok, true);
});

test("recursive_query dispatch reaches child depth and returns to root", async () => {
  const provider: RlmProvider = {
    async complete(input): Promise<RlmProviderAction> {
      const toolSeen = hasToolMessage(input);

      if (input.depth === 0 && !toolSeen) {
        return {
          type: "tool_call",
          call: {
            name: "recursive_query",
            args: { query: "find deeper detail" }
          }
        };
      }

      if (input.depth === 1 && !toolSeen) {
        return {
          type: "tool_call",
          call: {
            name: "searchSlices",
            args: { query: input.query }
          }
        };
      }

      if (input.depth === 1) {
        return {
          type: "final",
          answer: "child answer"
        };
      }

      return {
        type: "final",
        answer: "root answer"
      };
    }
  };

  const tools = new InlineTools(async (call) => ({
    ok: true,
    data: { tool: call.name },
    loadedBytes: 64
  }));

  const engine = new RlmEngine({ provider, tools, limits: { maxDepth: 3 } });
  const out = await engine.run({ query: "main question" });
  const trace = engine.getTrace();

  assert.equal(out.answer, "root answer");
  assert.ok(trace);
  assert.ok(trace.steps.some((s) => s.depth === 1));
  assert.ok(
    trace.steps.some(
      (s) => s.depth === 0 && s.providerAction.type === "tool_call" && s.providerAction.call.name === "recursive_query"
    )
  );
});

test("loaded-bytes limit is enforced", async () => {
  const provider: RlmProvider = {
    async complete(input): Promise<RlmProviderAction> {
      if (!hasToolMessage(input)) {
        return {
          type: "tool_call",
          call: {
            name: "loadSlice",
            args: { id: "slice-1" }
          }
        };
      }
      return {
        type: "final",
        answer: "never reached"
      };
    }
  };

  const tools = new InlineTools(async () => ({
    ok: true,
    data: { text: "x" },
    loadedBytes: 2_000
  }));

  const engine = new RlmEngine({
    provider,
    tools,
    limits: {
      maxLoadedBytes: 1_000
    }
  });

  await assert.rejects(() => engine.run({ query: "q" }), (err: unknown) => {
    assert.ok(err instanceof RlmEngineLimitError);
    assert.match((err as Error).message, /maxLoadedBytes exceeded/);
    return true;
  });
});

test("engine run state is isolated between runs", async () => {
  let runs = 0;
  const provider: RlmProvider = {
    async complete(): Promise<RlmProviderAction> {
      runs += 1;
      return {
        type: "final",
        answer: `run-${runs}`
      };
    }
  };

  const tools = new InlineTools(async () => ({ ok: true }));
  const engine = new RlmEngine({ provider, tools });

  const one = await engine.run({ query: "a" });
  const firstTrace = engine.getTrace();
  const two = await engine.run({ query: "b" });
  const secondTrace = engine.getTrace();

  assert.equal(one.answer, "run-1");
  assert.equal(two.answer, "run-2");
  assert.ok(firstTrace);
  assert.ok(secondTrace);
  assert.notEqual(firstTrace.traceId, secondTrace.traceId);
  assert.equal(secondTrace.steps.length, 1);
});
