import type { ReplStateStore } from "./repl-state-store.js";

type PersistedBlobRef = {
  __rlmjsBlobRef: string;
};

type PersistedStateValue =
  | string
  | number
  | boolean
  | null
  | PersistedBlobRef
  | PersistedStateValue[]
  | { [key: string]: PersistedStateValue };

type PersistedSessionRecord = {
  sessionId: string;
  state: PersistedStateValue;
  blobIds: string[];
  updatedAt: number;
};

type PersistedBlobRecord = {
  blobId: string;
  sessionId: string;
  value: string;
  updatedAt: number;
};

export type IndexedDbReplStateStoreOptions = {
  dbName?: string;
  version?: number;
  sessionStoreName?: string;
  blobStoreName?: string;
  inlineValueBytes?: number;
};

const DEFAULT_DB_NAME = "rlmjs_state";
const DEFAULT_SESSION_STORE_NAME = "repl_sessions";
const DEFAULT_BLOB_STORE_NAME = "repl_state_blobs";
const DEFAULT_INLINE_VALUE_BYTES = 16_384;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeStateValue(
  value: unknown,
  context: {
    sessionId: string;
    inlineValueBytes: number;
    encoder: TextEncoder;
    blobs: Map<string, string>;
    nextBlobId: () => string;
    seen: WeakSet<object>;
  }
): PersistedStateValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const bytes = context.encoder.encode(value).length;
    if (bytes <= context.inlineValueBytes) {
      return value;
    }

    const blobId = context.nextBlobId();
    context.blobs.set(blobId, value);
    return {
      __rlmjsBlobRef: blobId
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeStateValue(entry, context));
  }

  if (isPlainObject(value)) {
    if (context.seen.has(value)) {
      throw new Error("persistent runtime state does not support circular references");
    }
    context.seen.add(value);
    const out: Record<string, PersistedStateValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = serializeStateValue(entry, context);
    }
    context.seen.delete(value);
    return out;
  }

  throw new Error(
    `persistent runtime state only supports JSON-like data; received ${typeof value}`
  );
}

async function hydrateStateValue(
  value: PersistedStateValue,
  loader: (blobId: string) => Promise<string>
): Promise<unknown> {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const entry of value) {
      out.push(await hydrateStateValue(entry, loader));
    }
    return out;
  }

  if (isPlainObject(value) && typeof value.__rlmjsBlobRef === "string") {
    return await loader(value.__rlmjsBlobRef);
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = await hydrateStateValue(entry as PersistedStateValue, loader);
    }
    return out;
  }

  return value;
}

export class IndexedDbReplStateStore implements ReplStateStore {
  private readonly dbName: string;
  private readonly version: number;
  private readonly sessionStoreName: string;
  private readonly blobStoreName: string;
  private readonly inlineValueBytes: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options?: IndexedDbReplStateStoreOptions) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    this.version = options?.version ?? 1;
    this.sessionStoreName = options?.sessionStoreName ?? DEFAULT_SESSION_STORE_NAME;
    this.blobStoreName = options?.blobStoreName ?? DEFAULT_BLOB_STORE_NAME;
    this.inlineValueBytes = Math.max(256, Math.floor(options?.inlineValueBytes ?? DEFAULT_INLINE_VALUE_BYTES));
  }

  async loadState(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const db = await this.open();
    const record = await new Promise<PersistedSessionRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(this.sessionStoreName, "readonly");
      const req = tx.objectStore(this.sessionStoreName).get(sessionId);
      req.onsuccess = () => resolve(req.result as PersistedSessionRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("failed to load repl session state"));
    });

    if (!record) {
      return undefined;
    }

    const hydrated = await hydrateStateValue(record.state, async (blobId) => {
      const blobRecord = await new Promise<PersistedBlobRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(this.blobStoreName, "readonly");
        const req = tx.objectStore(this.blobStoreName).get(blobId);
        req.onsuccess = () => resolve(req.result as PersistedBlobRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error("failed to load repl state blob"));
      });
      if (!blobRecord) {
        throw new Error(`missing persisted state blob '${blobId}'`);
      }
      return blobRecord.value;
    });

    return (hydrated as Record<string, unknown>) ?? {};
  }

  async saveState(sessionId: string, state: Record<string, unknown>): Promise<void> {
    const db = await this.open();
    const previous = await new Promise<PersistedSessionRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(this.sessionStoreName, "readonly");
      const req = tx.objectStore(this.sessionStoreName).get(sessionId);
      req.onsuccess = () => resolve(req.result as PersistedSessionRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("failed to read existing repl session state"));
    });

    const encoder = new TextEncoder();
    let blobIndex = 0;
    const blobs = new Map<string, string>();
    const serialized = serializeStateValue(state, {
      sessionId,
      inlineValueBytes: this.inlineValueBytes,
      encoder,
      blobs,
      seen: new WeakSet<object>(),
      nextBlobId: () => `${sessionId}:blob:${blobIndex += 1}`
    });
    const blobIds = [...blobs.keys()];
    const record: PersistedSessionRecord = {
      sessionId,
      state: cloneJsonValue(serialized),
      blobIds,
      updatedAt: Date.now()
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.sessionStoreName, this.blobStoreName], "readwrite");
      const sessionStore = tx.objectStore(this.sessionStoreName);
      const blobStore = tx.objectStore(this.blobStoreName);

      if (previous) {
        for (const blobId of previous.blobIds) {
          if (!blobs.has(blobId)) {
            blobStore.delete(blobId);
          }
        }
      }

      for (const [blobId, value] of blobs.entries()) {
        blobStore.put({
          blobId,
          sessionId,
          value,
          updatedAt: record.updatedAt
        } satisfies PersistedBlobRecord);
      }

      sessionStore.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to save repl session state"));
      tx.onabort = () => reject(tx.error ?? new Error("repl session state transaction aborted"));
    });
  }

  async deleteState(sessionId: string): Promise<void> {
    const db = await this.open();
    const previous = await new Promise<PersistedSessionRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(this.sessionStoreName, "readonly");
      const req = tx.objectStore(this.sessionStoreName).get(sessionId);
      req.onsuccess = () => resolve(req.result as PersistedSessionRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("failed to read repl session state"));
    });

    if (!previous) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.sessionStoreName, this.blobStoreName], "readwrite");
      tx.objectStore(this.sessionStoreName).delete(sessionId);
      const blobStore = tx.objectStore(this.blobStoreName);
      for (const blobId of previous.blobIds) {
        blobStore.delete(blobId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to delete repl session state"));
      tx.onabort = () => reject(tx.error ?? new Error("repl session delete transaction aborted"));
    });
  }

  private async open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is not available in this runtime");
    }
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.sessionStoreName)) {
          db.createObjectStore(this.sessionStoreName, { keyPath: "sessionId" });
        }
        if (!db.objectStoreNames.contains(this.blobStoreName)) {
          db.createObjectStore(this.blobStoreName, { keyPath: "blobId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("failed to open repl state indexeddb"));
    });

    return await this.dbPromise;
  }
}

export function createIndexedDbReplStateStore(
  options?: IndexedDbReplStateStoreOptions
): IndexedDbReplStateStore {
  return new IndexedDbReplStateStore(options);
}
