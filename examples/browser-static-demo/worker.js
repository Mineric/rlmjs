import { createStorageToolRuntime } from "../../packages/rlmjs-core/dist/index.js";
import {
  bindWorkerToolHandler,
  createIndexedDbStorageAdapter
} from "../../packages/rlmjs-browser/dist/index.js";

const storage = createIndexedDbStorageAdapter({
  dbName: "rlmjs-static-demo",
  storeName: "chat_slices"
});

const runtime = createStorageToolRuntime(storage);

bindWorkerToolHandler(self, async (call, state) => {
  return await runtime.invoke(call, state);
});
