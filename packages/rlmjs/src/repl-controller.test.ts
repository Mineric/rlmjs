import { test } from "node:test";
import assert from "node:assert/strict";

import { ContextHandle, MemoryCorpusStore } from "./corpus.js";
import {
  ReplController,
  buildReplCallGraph,
  buildReplRunHistory,
  createReplChatModelAdapter,
  createReplLeafCallHandler,
  createReplModelStack
} from "./repl-controller.js";
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
      chunkId: "c1",
      sequence: 1,
      role: "user",
      text: "The Atlas launch date is discussed in this thread."
    },
    {
      chunkId: "c2",
      sequence: 2,
      role: "assistant",
      text: "Atlas launches on April 12."
    }
  ]);
  return new ContextHandle(store);
}

test("repl controller feeds missing-code feedback and completes on final code", async () => {
  const seenMessages: string[] = [];
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    model: {
      async complete(input) {
        seenMessages.push(input.messages[input.messages.length - 1]?.content ?? "");
        if (input.iteration === 0) {
          return { content: "I think the answer is April 12." };
        }
        return {
          content: [
            "```js",
            'state.answer = "April 12";',
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(out.query, "When does Atlas launch?");
  assert.equal(out.iterations, 2);
  assert.match(seenMessages[1] ?? "", /No executable JavaScript code block/);
});

test("repl controller can drive recursive sub-calls through runtime", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 2,
      onRecursiveCall: async ({ query, context, depth }) => {
        const materialized = await context.materialize({ limitBytes: 2_000 });
        return {
          answer: `${depth}:${query}:${materialized.chunkIds.join(",")}`
        };
      }
    }),
    model: {
      async complete() {
        return {
          content: [
            "```js",
            'const focused = await context.subviewFromSearch("launch", { k: 2 });',
            'const child = await callRlm("confirm launch", { context: focused });',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    }
  });

  const out = await controller.run("Confirm the launch date.");

  assert.equal(out.answer, "1:confirm launch:c1,c2");
  assert.equal(out.trace[0]?.cellResult?.childCalls.length, 1);
});

test("repl controller fails after max iterations without FINAL", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 2,
    model: {
      async complete(input) {
        return {
          content: ["```js", `print("still exploring ${input.iteration}");`, "```"].join("\n")
        };
      }
    }
  });

  await assert.rejects(
    () => controller.run("When does Atlas launch?"),
    /maxIterations exceeded/
  );
});

test("repl controller fails early on identical consecutive code blocks", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 3,
    model: {
      async complete() {
        return {
          content: ["```js", 'print("still exploring");', "```"].join("\n")
        };
      }
    }
  });

  await assert.rejects(
    () => controller.run("When does Atlas launch?"),
    /identical code generated in consecutive iterations/
  );
});

test("repl controller can adapt a plain chat model", async () => {
  const adapted = createReplChatModelAdapter({
    async complete({ messages }) {
      return {
        content: `seen:${messages.length}`
      };
    }
  });

  const out = await adapted.complete({
    query: "q",
    iteration: 0,
    traceId: "t",
    depth: 0,
    contextSizeChars: 42,
    contextChunkCount: 2,
    messages: [
      { role: "system", content: "s" },
      { role: "user", content: "u" }
    ]
  });

  assert.equal(out.content, "seen:2");
});

test("repl controller surfaces runtime depth and context size to the model", async () => {
  let seenInput:
    | {
        depth: number;
        contextSizeChars: number;
        contextChunkCount: number;
        messages: Array<{ role: string; content: string }>;
      }
    | undefined;

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      depth: 2
    }),
    maxIterations: 1,
    model: {
      async complete(input) {
        seenInput = input;
        return {
          content: 'FINAL("April 12")'
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(seenInput?.depth, 2);
  assert.equal(seenInput?.contextSizeChars, 77);
  assert.equal(seenInput?.contextChunkCount, 2);
  assert.match(seenInput?.messages[1]?.content ?? "", /current_depth: 2/);
  assert.match(seenInput?.messages[1]?.content ?? "", /context_size_chars: 77/);
});

test("repl controller accepts plain FINAL tags outside code blocks", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 1,
    model: {
      async complete() {
        return {
          content: 'FINAL("April 12")'
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(out.iterations, 1);
});

test("repl controller can resolve FINAL_VAR from persisted runtime state", async () => {
  const stateStore = new MemoryReplStateStore();
  await stateStore.saveState("persisted-session", {
    answer: "April 12"
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      sessionId: "persisted-session",
      stateStore
    }),
    maxIterations: 1,
    model: {
      async complete() {
        return {
          content: 'FINAL_VAR("answer")'
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(out.iterations, 1);
});

test("repl controller accepts trailing FINAL tags in mixed assistant text", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 1,
    model: {
      async complete() {
        return {
          content: 'Answer found.\nFINAL("April 12")'
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(out.iterations, 1);
});

test("repl controller can resolve trailing FINAL_VAR tags after code execution", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 1,
    model: {
      async complete() {
        return {
          content: [
            "```js",
            'state.answer = "April 12";',
            "```",
            'FINAL_VAR("answer")'
          ].join("\n")
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "April 12");
  assert.equal(out.iterations, 1);
});

test("repl controller truncates large execution observations", async () => {
  let seenObservation = "";
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    maxIterations: 2,
    maxObservationChars: 512,
    model: {
      async complete(input) {
        if (input.iteration === 0) {
          return {
            content: [
              "```js",
              `print(${JSON.stringify("x".repeat(20_000))});`,
              "```"
            ].join("\n")
          };
        }

        seenObservation = input.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
        return {
          content: ['```js', 'FINAL("done")', "```"].join("\n")
        };
      }
    }
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "done");
  assert.ok(seenObservation.length <= 512);
  assert.match(seenObservation, /\[truncated \d+ chars\]/);
});

test("repl controller runs end-to-end through the chat model adapter", async () => {
  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext()
    }),
    model: createReplChatModelAdapter({
      async complete() {
        return {
          content: [
            "```js",
            'const hits = await context.search("April 12", { k: 2 });',
            "state.answer = hits[0]?.summary ?? \"unknown\";",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    })
  });

  const out = await controller.run("When does Atlas launch?");

  assert.match(out.answer, /April 12/);
  assert.equal(out.iterations, 1);
});

test("repl controller supports recursive child runs through the chat model adapter", async () => {
  const chatModel = createReplChatModelAdapter({
    async complete({ messages }) {
      const userMessages = messages.filter((message) => message.role === "user");
      const latestUser = userMessages[userMessages.length - 1]?.content ?? "";

      if (latestUser.includes("Execution succeeded.") && latestUser.includes("Final answer: child-final")) {
        return {
          content: [
            "```js",
            'state.answer = "child-final";',
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }

      if (messages.some((message) => message.content.includes("child confirm"))) {
        return {
          content: [
            "```js",
            'state.answer = "child-final";',
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }

      return {
        content: [
          "```js",
          'const narrowed = await context.subviewFromSearch("April 12", { k: 2 });',
          'const child = await callRlm("child confirm", { context: narrowed });',
          "state.answer = child.answer;",
          'FINAL_VAR("answer");',
          "```"
        ].join("\n")
      };
    }
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 2,
      onRecursiveCall: async ({ query, runtime }) => {
        const childController = new ReplController({
          runtime,
          model: chatModel
        });
        const child = await childController.run(query);
        return {
          answer: child.answer,
          traceId: child.traceId
        };
      }
    }),
    model: chatModel
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "child-final");
  assert.equal(out.trace[0]?.cellResult?.childCalls.length, 1);
});

test("createReplLeafCallHandler answers with plain model completion", async () => {
  const leafHandler = createReplLeafCallHandler({
    model: {
      async complete({ messages }) {
        const user = messages.find((message) => message.role === "user")?.content ?? "";
        assert.match(user, /Question: When does Atlas launch\?/);
        assert.match(user, /Context:/);
        assert.match(user, /April 12/);
        return {
          content: "Atlas launches on April 12."
        };
      }
    },
    maxContextBytes: 2_000
  });

  const result = await leafHandler({
    query: "When does Atlas launch?",
    context: createContext(),
    depth: 1
  });

  assert.equal(result.answer, "Atlas launches on April 12.");
});

test("createReplLeafCallHandler includes large context by default", async () => {
  const largeText = "x".repeat(12_000);
  const store = new MemoryCorpusStore();
  store.putChunks([
    {
      chunkId: "big",
      sequence: 1,
      text: largeText
    }
  ]);

  let seenUserMessage = "";
  const leafHandler = createReplLeafCallHandler({
    model: {
      async complete({ messages }) {
        seenUserMessage = messages.find((message) => message.role === "user")?.content ?? "";
        return {
          content: "ok"
        };
      }
    }
  });

  const result = await leafHandler({
    query: "Inspect large context",
    context: new ContextHandle(store),
    depth: 1
  });

  assert.equal(result.answer, "ok");
  assert.ok(seenUserMessage.length > 12_000);
  assert.match(seenUserMessage, /Context:/);
  assert.match(seenUserMessage, /x{1000}/);
});

test("createReplModelStack can use a cheaper recursive model for child controllers", async () => {
  const calls: string[] = [];
  const stack = createReplModelStack({
    model: {
      async complete() {
        calls.push("root");
        return {
          content: [
            "```js",
            'const focused = await context.subviewFromSearch("April 12", { k: 2 });',
            'const child = await callRlm("child confirm", { context: focused });',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    },
    recursiveModel: {
      async complete() {
        calls.push("recursive");
        return {
          content: [
            "```js",
            'state.answer = "child-final";',
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    }
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 2,
      onRecursiveCall: stack.onRecursiveCall,
      onLeafCall: stack.onLeafCall
    }),
    model: stack.model
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "child-final");
  assert.deepEqual(calls, ["root", "recursive"]);
});

test("createReplModelStack uses the recursive model for leaf fallbacks by default", async () => {
  const calls: string[] = [];
  const stack = createReplModelStack({
    model: {
      async complete() {
        calls.push("root");
        return {
          content: [
            "```js",
            'const child = await callRlm("leaf confirm");',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    },
    recursiveModel: {
      async complete({ messages }) {
        calls.push("recursive-leaf");
        const user = messages.find((message) => message.role === "user")?.content ?? "";
        assert.match(user, /Question: leaf confirm/);
        return {
          content: "leaf-final"
        };
      }
    }
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 1,
      onRecursiveCall: stack.onRecursiveCall,
      onLeafCall: stack.onLeafCall
    }),
    model: stack.model
  });

  const out = await controller.run("When does Atlas launch?");

  assert.equal(out.answer, "leaf-final");
  assert.deepEqual(calls, ["root", "recursive-leaf"]);
});

test("buildReplCallGraph reconstructs nested recursive call trees", async () => {
  const stack = createReplModelStack({
    model: {
      async complete({ messages }) {
        if (messages.some((message) => message.content.includes("child confirm"))) {
          return {
            content: [
              "```js",
              'state.answer = "child-final";',
              'FINAL_VAR("answer");',
              "```"
            ].join("\n")
          };
        }

        return {
          content: [
            "```js",
            'const focused = await context.subviewFromSearch("April 12", { k: 2 });',
            'const child = await callRlm("child confirm", { context: focused });',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    }
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 2,
      onRecursiveCall: stack.onRecursiveCall,
      onLeafCall: stack.onLeafCall
    }),
    model: stack.model
  });

  const out = await controller.run("When does Atlas launch?");
  const graph = stack.buildCallGraph(out);
  const rebuiltGraph = buildReplCallGraph(out, stack.getRecordedRuns());

  assert.equal(graph.query, "When does Atlas launch?");
  assert.equal(graph.answer, "child-final");
  assert.equal(graph.children.length, 1);
  assert.equal(graph.children[0]?.query, "child confirm");
  assert.equal(graph.children[0]?.answer, "child-final");
  assert.equal(graph.children[0]?.node?.answer, "child-final");
  assert.deepEqual(rebuiltGraph, graph);
});

test("buildReplRunHistory exports prompts, observations, and nested child runs", async () => {
  const stack = createReplModelStack({
    model: {
      async complete({ messages }) {
        if (messages.some((message) => message.content.includes("child confirm"))) {
          return {
            content: [
              "```js",
              'print("child run");',
              'state.answer = "child-final";',
              'FINAL_VAR("answer");',
              "```"
            ].join("\n")
          };
        }

        return {
          content: [
            "```js",
            'const focused = await context.subviewFromSearch("April 12", { k: 2 });',
            'const child = await callRlm("child confirm", { context: focused });',
            "state.answer = child.answer;",
            'FINAL_VAR("answer");',
            "```"
          ].join("\n")
        };
      }
    }
  });

  const controller = new ReplController({
    runtime: new ReplRuntime({
      context: createContext(),
      maxDepth: 2,
      onRecursiveCall: stack.onRecursiveCall,
      onLeafCall: stack.onLeafCall
    }),
    model: stack.model
  });

  const out = await controller.run("When does Atlas launch?");
  const history = stack.buildRunHistory(out);
  const rebuilt = buildReplRunHistory(out, stack.getRecordedRuns());

  assert.equal(history.query, "When does Atlas launch?");
  assert.equal(history.steps.length, 1);
  assert.equal(history.steps[0]?.messages[2]?.content, "When does Atlas launch?");
  assert.match(history.steps[0]?.messages[1]?.content ?? "", /context_size_chars/);
  assert.equal(history.steps[0]?.childCalls[0]?.query, "child confirm");
  assert.equal(history.children.length, 1);
  assert.equal(history.children[0]?.answer, "child-final");
  assert.equal(history.children[0]?.steps[0]?.prints?.[0], "child run");
  assert.deepEqual(rebuilt, history);
});
