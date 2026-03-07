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
  runtimeStatus: document.getElementById("runtimeStatus"),
  contextText: document.getElementById("contextText"),
  loadContextBtn: document.getElementById("loadContextBtn"),
  loadStatus: document.getElementById("loadStatus"),
  query: document.getElementById("query"),
  runBtn: document.getElementById("runBtn"),
  output: document.getElementById("output")
};

els.contextText.value = SAMPLE_CONTEXT;

let requestCounter = 0;
let worker = null;
let bootPromise = null;

function setRuntimeStatus(value) {
  els.runtimeStatus.textContent = value;
}

function setOutput(value) {
  els.output.textContent = value;
}

function createRuntimeWorker() {
  const instance = new Worker(new URL("./runtime-worker.js", import.meta.url), {
    type: "module"
  });

  return instance;
}

function requestWorker(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("runtime worker is not available"));
      return;
    }

    const requestId = `req-${++requestCounter}`;

    const handleMessage = (event) => {
      const message = event.data ?? {};
      if (message.requestId !== requestId) {
        return;
      }
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);

      if (message.ok) {
        resolve(message.data);
        return;
      }

      reject(new Error(String(message.error ?? "unknown")));
    };

    const handleError = (event) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(event.error instanceof Error ? event.error : new Error("runtime worker crashed"));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError, { once: true });
    worker.postMessage({
      requestId,
      type,
      ...payload
    });
  });
}

async function ensureRuntimeWorker() {
  if (bootPromise) {
    return await bootPromise;
  }

  worker = createRuntimeWorker();
  bootPromise = requestWorker("boot")
    .then(() => {
      setRuntimeStatus("Runtime worker ready.");
    })
    .catch((error) => {
      setRuntimeStatus(`Runtime worker failed: ${error instanceof Error ? error.message : "unknown"}`);
      throw error;
    });

  return await bootPromise;
}

async function loadContext() {
  return await requestWorker("loadContext", {
    contextText: els.contextText.value
  });
}

async function runQuery() {
  return await requestWorker("runQuery", {
    baseUrl: els.baseUrl.value,
    model: els.model.value,
    apiKey: els.apiKey.value,
    query: els.query.value
  });
}

els.loadContextBtn.addEventListener("click", async () => {
  els.loadStatus.textContent = "Loading...";
  try {
    await ensureRuntimeWorker();
    const result = await loadContext();
    els.loadStatus.textContent = `Loaded ${result.count} chunks.`;
  } catch (error) {
    els.loadStatus.textContent = `Failed: ${error instanceof Error ? error.message : "unknown"}`;
  }
});

els.runBtn.addEventListener("click", async () => {
  setOutput("Running...");
  try {
    await ensureRuntimeWorker();
    const result = await runQuery();
    setOutput(JSON.stringify(result, null, 2));
  } catch (error) {
    setOutput(`Error: ${error instanceof Error ? error.message : "unknown"}`);
  }
});

ensureRuntimeWorker().catch(() => {
  // Status text is already updated in ensureRuntimeWorker.
});
