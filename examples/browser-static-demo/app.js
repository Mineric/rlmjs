import { RlmEngine } from "../../packages/rlmjs-core/dist/index.js";
import {
  createIndexedDbStorageAdapter,
  createWorkerToolRuntime
} from "../../packages/rlmjs-browser/dist/index.js";
import { OpenAiCompatibleProvider } from "../../packages/rlmjs-adapter-openai/dist/index.js";

const SAMPLE_CONTEXT = [
  "2025-01-03 Alice: We should target April 12 for public launch.",
  "2025-01-09 Bob: Budget note approved for launch campaign.",
  "2025-01-15 Alice: If QA slips, we might move to April 19.",
  "2025-01-20 Carol: Current status still points to April 12."
].join("\n");

const els = {
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  contextText: document.getElementById("contextText"),
  loadContextBtn: document.getElementById("loadContextBtn"),
  loadStatus: document.getElementById("loadStatus"),
  query: document.getElementById("query"),
  runBtn: document.getElementById("runBtn"),
  output: document.getElementById("output")
};

els.contextText.value = SAMPLE_CONTEXT;

const storage = createIndexedDbStorageAdapter({
  dbName: "rlmjs-static-demo",
  storeName: "chat_slices"
});
const worker = new Worker("./worker.js", { type: "module" });
const toolRuntime = createWorkerToolRuntime(worker, {
  timeoutMs: 20_000,
  maxPending: 32
});

function setOutput(value) {
  els.output.textContent = value;
}

function chunkText(text, maxLen = 450) {
  const chunks = [];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function loadContext() {
  const raw = els.contextText.value.trim();
  if (!raw) {
    throw new Error("Context text is empty.");
  }

  const chunks = chunkText(raw, 450);
  const slices = chunks.map((text, idx) => ({
    sliceId: `slice-${idx + 1}`,
    sequence: idx + 1,
    text,
    summary: text.slice(0, 120)
  }));

  await storage.putSlices(slices);
  return slices.length;
}

async function runQuery() {
  const baseUrl = els.baseUrl.value.trim();
  const model = els.model.value.trim();
  const apiKey = els.apiKey.value.trim();
  const query = els.query.value.trim();

  if (!baseUrl || !model || !query) {
    throw new Error("Base URL, model, and query are required.");
  }

  const provider = new OpenAiCompatibleProvider({
    baseUrl,
    model,
    apiKey: apiKey || undefined,
    timeoutMs: 45_000,
    temperature: 0
  });

  const engine = new RlmEngine({
    provider,
    tools: toolRuntime,
    limits: {
      maxDepth: 4,
      maxIterations: 10,
      maxTimeMs: 60_000,
      maxLoadedBytes: 1_500_000
    }
  });

  return await engine.run({
    query,
    systemPrompt:
      "Use tools to inspect context. Call searchSlices before loadSlice. Use composeSubcontext before recursive_query when you can narrow the evidence. Return final answer with citations when possible."
  });
}

els.loadContextBtn.addEventListener("click", async () => {
  els.loadStatus.textContent = "Loading...";
  try {
    const count = await loadContext();
    els.loadStatus.textContent = `Loaded ${count} slices.`;
  } catch (error) {
    els.loadStatus.textContent = `Failed: ${error instanceof Error ? error.message : "unknown"}`;
  }
});

els.runBtn.addEventListener("click", async () => {
  setOutput("Running...");
  try {
    const result = await runQuery();
    setOutput(JSON.stringify(result, null, 2));
  } catch (error) {
    setOutput(`Error: ${error instanceof Error ? error.message : "unknown"}`);
  }
});
