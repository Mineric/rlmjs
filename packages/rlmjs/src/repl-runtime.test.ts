import { test } from "node:test";
import assert from "node:assert/strict";

import { ContextHandle, MemoryCorpusStore } from "./corpus.js";
import { ReplRuntime } from "./repl-runtime.js";
import type { ReplStateStore } from "./repl-state-store.js";

class MemoryReplStateStore implements ReplStateStore {
  private readonly sessions = new Map<string, Record<string, unknown>>();

  async loadState(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const value = this.sessions.get(sessionId);
    return value ? JSON.parse(JSON.stringify(value)) : undefined;
  }

  async saveState(sessionId: string, state: Record<string, unknown>): Promise<void> {
    this.sessions.set(sessionId, JSON.parse(JSON.stringify(state)) as Record<string, unknown>);
  }
}

function createContext(): ContextHandle {
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId: "m1",
      sequence: 1,
      role: "user",
      text: "Can you confirm the Atlas launch date?"
    },
    {
      chunkId: "m2",
      sequence: 2,
      role: "assistant",
      text: "Atlas is scheduled to launch on April 12."
    },
    {
      chunkId: "m3",
      sequence: 3,
      role: "user",
      text: "There was also a billing dispute in a later message."
    }
  ]);
  return new ContextHandle(store);
}

test("browser repl runtime persists state across cells", async () => {
  const runtime = new ReplRuntime({
    context: createContext()
  });

  const first = await runtime.executeCell(`
    state.answer = "April 12";
    print("stored", state.answer);
  `);
  const second = await runtime.executeCell(`
    FINAL_VAR("answer");
  `);

  assert.equal(first.ok, true);
  assert.deepEqual(first.prints, ["stored April 12"]);
  assert.equal(second.ok, true);
  assert.equal(second.finalAnswer, "April 12");
});

test("browser repl runtime persists and restores state through a state store", async () => {
  const stateStore = new MemoryReplStateStore();
  const firstRuntime = new ReplRuntime({
    context: createContext(),
    sessionId: "session-1",
    stateStore
  });

  const saved = await firstRuntime.executeCell(`
    state.answer = "April 12";
    state.large = "x".repeat(20_000);
    FINAL_VAR("answer");
  `);

  assert.equal(saved.ok, true);
  assert.equal(saved.finalAnswer, "April 12");

  const secondRuntime = new ReplRuntime({
    context: createContext(),
    sessionId: "session-1",
    stateStore
  });

  assert.deepEqual(await secondRuntime.getStateSnapshot(), {
    answer: "April 12",
    large: "x".repeat(20_000)
  });

  const restored = await secondRuntime.executeCell(`
    state.largeLength = String(state.large.length);
    FINAL_VAR("largeLength");
  `);

  assert.equal(restored.ok, true);
  assert.equal(restored.finalAnswer, "20000");
});

test("browser repl runtime returns a failed result when persistence fails after execution", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    sessionId: "session-1",
    stateStore: {
      async loadState() {
        return undefined;
      },
      async saveState() {
        throw new Error("save failed");
      }
    }
  });

  const out = await runtime.executeCell(`
    state.answer = "April 12";
    FINAL_VAR("answer");
  `);

  assert.equal(out.ok, false);
  assert.equal(out.finalAnswer, "April 12");
  assert.match(out.error ?? "", /save failed/);
  assert.equal(runtime.getTrace().length, 1);
});

test("browser repl runtime exposes virtualized context operations", async () => {
  const runtime = new ReplRuntime({
    context: createContext()
  });

  const out = await runtime.executeCell(`
    const focused = await context.subviewFromSearch("billing", { k: 2 });
    state.ids = (await focused.list()).map((chunk) => chunk.chunkId);
    FINAL_VAR("ids");
  `);

  assert.equal(out.ok, true);
  assert.equal(out.finalAnswer, "[\"m3\"]");
});

test("browser repl runtime routes recursive child calls through the provided hook", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxDepth: 2,
    onRecursiveCall: async ({ query, context, depth }) => {
      const materialized = await context.materialize({ limitBytes: 2_000 });
      return {
        answer: `${depth}:${query}:${materialized.chunkIds.join(",")}`
      };
    }
  });

  const out = await runtime.executeCell(`
    const focused = await context.subviewFromSearch("launch", { k: 2 });
    const child = await callRlm("confirm launch", { context: focused });
    state.childAnswer = child.answer;
    FINAL_VAR("childAnswer");
  `);

  assert.equal(out.ok, true);
  assert.equal(out.finalAnswer, "1:confirm launch:m1,m2");
  assert.equal(out.childCalls.length, 1);
  assert.deepEqual(out.childCalls[0], {
    query: "confirm launch",
    depth: 1,
    chunkIds: ["m1", "m2"],
    traceId: undefined,
    answer: "1:confirm launch:m1,m2"
  });
});

test("repl runtime can recurse over an ephemeral derived text context", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxDepth: 2,
    onRecursiveCall: async ({ context }) => {
      const materialized = await context.materialize({ limitBytes: 2_000 });
      return {
        answer: materialized.text
      };
    }
  });

  const out = await runtime.executeCell(`
    const child = await callRlm("confirm derived text", {
      text: "Derived launch note: Atlas launches on April 12."
    });
    state.answer = child.answer;
    FINAL_VAR("answer");
  `);

  assert.equal(out.ok, true);
  assert.match(out.finalAnswer ?? "", /Derived launch note/);
  assert.equal(out.childCalls.length, 1);
  assert.deepEqual(out.childCalls[0], {
    query: "confirm derived text",
    depth: 1,
    chunkIds: ["ephemeral:1:1"],
    traceId: undefined,
    answer: "[1:ephemeral:1:1 derived] Derived launch note: Atlas launches on April 12."
  });
});

test("repl runtime falls back to a leaf handler at the depth limit", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxDepth: 1,
    onRecursiveCall: async () => {
      return {
        answer: "unexpected-recursive-call"
      };
    },
    onLeafCall: async ({ query, context, depth }) => {
      const materialized = await context.materialize({ limitBytes: 2_000 });
      return {
        answer: `${depth}:${query}:${materialized.chunkIds.join(",")}`
      };
    }
  });

  const out = await runtime.executeCell(`
    const focused = await context.subviewFromSearch("April 12", { k: 2 });
    const child = await callRlm("child", { context: focused });
    state.answer = child.answer;
    FINAL_VAR("answer");
  `);

  assert.equal(out.ok, true);
  assert.equal(out.finalAnswer, "1:child:m2");
});

test("repl runtime applies child call budgets across the recursive tree", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxDepth: 2,
    maxChildCalls: 1,
    onRecursiveCall: async ({ query, runtime: childRuntime }) => {
      if (query === "grandchild") {
        return {
          answer: "grandchild-ok"
        };
      }

      const child = await childRuntime.executeCell(`
        const grandchild = await callRlm("grandchild");
        FINAL(grandchild.answer);
      `);
      return {
        answer: child.finalAnswer ?? child.error ?? "missing result"
      };
    }
  });

  const out = await runtime.executeCell(`
    const child = await callRlm("child");
    FINAL(child.answer);
  `);

  assert.equal(out.ok, true);
  assert.match(out.finalAnswer ?? "", /maxChildCalls exceeded/);
});

test("browser repl runtime enforces child call limits", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxDepth: 3,
    maxChildCalls: 1,
    onRecursiveCall: async ({ query }) => ({
      answer: query
    })
  });

  const out = await runtime.executeCell(`
    await callRlm("first");
    await callRlm("second");
  `);

  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /maxChildCalls exceeded/);
});

test("browser repl runtime enforces cooperative execution timeouts", async () => {
  const runtime = new ReplRuntime({
    context: createContext(),
    maxExecutionMs: 5
  });

  const out = await runtime.executeCell(`
    await new Promise((resolve) => setTimeout(resolve, 20));
  `);

  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /timed out/);
});

test("browser repl runtime shadows ambient browser and Node globals", async () => {
  const runtime = new ReplRuntime({
    context: createContext()
  });

  const out = await runtime.executeCell(`
    state.kinds = [
      typeof fetch,
      typeof globalThis,
      typeof indexedDB,
      typeof global,
      typeof process,
      typeof Buffer
    ];
    FINAL_VAR("kinds");
  `);

  assert.equal(out.ok, true);
  assert.equal(out.finalAnswer, '["undefined","undefined","undefined","undefined","undefined","undefined"]');
});

test("browser repl runtime rejects unsupported dynamic import usage", async () => {
  const runtime = new ReplRuntime({
    context: createContext()
  });

  const out = await runtime.executeCell(`
    await import("./something.js");
  `);

  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /dynamic import is not available/);
});

test("browser repl runtime rejects constructor-based global escapes", async () => {
  const runtime = new ReplRuntime({
    context: createContext()
  });

  const out = await runtime.executeCell(`
    FINAL(({}).constructor.constructor("return this")());
  `);

  assert.equal(out.ok, false);
  assert.match(out.error ?? "", /constructor-based global escapes are not available/);
});
