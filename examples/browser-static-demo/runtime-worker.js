import {
  createRlm,
  createIndexedDbCorpusStore,
  createIndexedDbReplStateStore
} from "../../packages/rlmjs/dist/index.js";
import { OpenAiCompatibleChatModel } from "../../packages/rlmjs-chat-adapter/dist/index.js";

const storage = createIndexedDbCorpusStore({
  dbName: "rlmjs-static-demo",
  storeName: "chat_chunks"
});
const runtimeStateStore = createIndexedDbReplStateStore({
  dbName: "rlmjs-static-demo-state"
});

const DEMO_SYSTEM_PROMPT = [
  "You are answering questions by writing JavaScript for a notebook runtime.",
  "Reply with exactly one ```js``` code block each turn.",
  "Available values: state, context, callRlm, FINAL, FINAL_VAR, print.",
  "All context methods are async. Always use await.",
  "await context.search(query, { k }) returns hits with: chunkId, score, sequence, summary, metadata.",
  "Search hits do not have content or text fields.",
  "If you need raw text, use await context.get(hit.chunkId) or await context.materialize({ limitBytes: 4000 }).",
  "Conversation lines may begin with log timestamps like 2025-01-03. Do not return the log timestamp when the answer is a date mentioned inside the message content.",
  "Use short steps: search, inspect, then FINAL(...).",
  "Do not output prose outside the code block.",
  "Example:",
  "```js",
  'const hits = await context.search("launch date", { k: 3 });',
  'const chunk = hits[0] ? await context.get(hits[0].chunkId) : undefined;',
  'if (chunk) FINAL(chunk.text);',
  'else FINAL("not found");',
  "```"
].join("\n");

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

function summarizeChunk(text, maxLen = 120) {
  const cleaned = text
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim())
    .filter(Boolean)
    .join("\n");
  return cleaned.slice(0, maxLen);
}

async function loadContext(rawText) {
  const raw = String(rawText ?? "").trim();
  if (!raw) {
    throw new Error("Context text is empty.");
  }

  const chunks = chunkText(raw, 450);
  const records = chunks.map((text, idx) => ({
    chunkId: `chunk-${idx + 1}`,
    sequence: idx + 1,
    role: "message",
    text,
    summary: summarizeChunk(text)
  }));

  await storage.putChunks(records);
  return { count: records.length };
}

function createChatModel(config) {
  return new OpenAiCompatibleChatModel({
    baseUrl: String(config.baseUrl ?? "").trim(),
    model: String(config.model ?? "").trim(),
    apiKey: config.apiKey ? String(config.apiKey) : undefined,
    timeoutMs: 45_000,
    temperature: 0
  });
}

async function runQuery(config) {
  const baseUrl = String(config.baseUrl ?? "").trim();
  const model = String(config.model ?? "").trim();
  const apiKey = String(config.apiKey ?? "").trim();
  const query = String(config.query ?? "").trim();

  if (!baseUrl || !model || !query) {
    throw new Error("Base URL, model, and query are required.");
  }

  const chatModel = createChatModel({
    baseUrl,
    model,
    apiKey
  });
  const session = createRlm({
    context: storage,
    model: chatModel,
    sessionId: "browser-static-demo",
    stateStore: runtimeStateStore,
    maxDepth: 2,
    maxChildCalls: 6,
    maxExecutionMs: 10_000,
    maxIterations: 8,
    recursiveMaxIterations: 6,
    systemPrompt: DEMO_SYSTEM_PROMPT,
    recursiveSystemPrompt: DEMO_SYSTEM_PROMPT
  });

  return await session.run(query);
}

async function handleRequest(message) {
  switch (message.type) {
    case "boot":
      return { ok: true, data: { ready: true } };
    case "loadContext":
      return { ok: true, data: await loadContext(message.contextText) };
    case "runQuery":
      return { ok: true, data: await runQuery(message) };
    default:
      throw new Error(`unknown worker request '${String(message.type)}'`);
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  const requestId = message.requestId;
  if (typeof requestId !== "string" || !requestId) {
    return;
  }

  try {
    const response = await handleRequest(message);
    self.postMessage({
      requestId,
      ...response
    });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "unknown"
    });
  }
});
