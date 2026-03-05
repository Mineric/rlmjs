import { test } from "node:test";
import assert from "node:assert/strict";

import { bindWorkerToolHandler, createWorkerToolRuntime, type WorkerLike } from "./worker-runtime.js";

class PairedWorker implements WorkerLike {
  private listeners: Array<(event: { data: unknown }) => void> = [];
  peer: PairedWorker | null = null;

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.push(listener);
  }

  postMessage(message: unknown): void {
    if (!this.peer) {
      return;
    }
    for (const listener of this.peer.listeners) {
      queueMicrotask(() => listener({ data: message }));
    }
  }
}

function createPair(): { main: PairedWorker; worker: PairedWorker } {
  const main = new PairedWorker();
  const worker = new PairedWorker();
  main.peer = worker;
  worker.peer = main;
  return { main, worker };
}

test("worker runtime round-trips tool calls", async () => {
  const { main, worker } = createPair();

  bindWorkerToolHandler(worker, async (call) => {
    return {
      ok: true,
      data: { name: call.name }
    };
  });

  const runtime = createWorkerToolRuntime(main, { timeoutMs: 1_000 });
  const out = await runtime.invoke(
    { name: "searchSlices", args: { query: "x" } },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );

  assert.equal(out.ok, true);
  assert.equal((out.data as { name: string }).name, "searchSlices");
});

test("worker runtime returns timeout errors", async () => {
  const { main } = createPair();
  const runtime = createWorkerToolRuntime(main, { timeoutMs: 10 });

  const out = await runtime.invoke(
    { name: "loadSlice", args: { sliceId: "a" } },
    { depth: 0, iteration: 0, traceId: "t", loadedBytes: 0 }
  );

  assert.equal(out.ok, false);
  assert.match(String(out.error), /timeout/);
});
