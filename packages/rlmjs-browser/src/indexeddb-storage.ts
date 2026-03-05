import type {
  JsonLike,
  RlmSlice,
  RlmSliceNeighborArgs,
  RlmSliceSearchArgs,
  RlmSliceSearchHit,
  RlmSliceSummaryArgs,
  RlmStorageAdapter
} from "@software-machines/rlmjs-core";

export type IndexedDbSliceRecord = {
  sliceId: string;
  text: string;
  sequence: number;
  timestampMs?: number;
  summary?: string;
  metadata?: Record<string, JsonLike>;
};

export type IndexedDbStorageOptions = {
  dbName?: string;
  storeName?: string;
  version?: number;
};

const DEFAULT_DB_NAME = "rlmjs-browser";
const DEFAULT_STORE_NAME = "slices";

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function ensureSliceId(sliceId: string): string {
  const cleaned = sliceId.trim();
  if (!cleaned) {
    throw new Error("sliceId is required");
  }
  return cleaned;
}

function truncateText(text: string, max = 240): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function matchesFilters(
  metadata: Record<string, JsonLike> | undefined,
  filters: Record<string, JsonLike> | undefined
): boolean {
  if (!filters) {
    return true;
  }

  for (const [key, expected] of Object.entries(filters)) {
    if (!metadata || !(key in metadata)) {
      return false;
    }
    if (metadata[key] !== expected) {
      return false;
    }
  }

  return true;
}

function lexicalScore(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export class IndexedDbStorageAdapter implements RlmStorageAdapter {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options?: IndexedDbStorageOptions) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options?.storeName ?? DEFAULT_STORE_NAME;
    this.version = options?.version ?? 1;
  }

  async putSlices(slices: IndexedDbSliceRecord[]): Promise<void> {
    if (slices.length === 0) {
      return;
    }

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      for (const slice of slices) {
        store.put({
          ...slice,
          sliceId: ensureSliceId(slice.sliceId)
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to write slices"));
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
  }

  async searchSlices(args: RlmSliceSearchArgs): Promise<RlmSliceSearchHit[]> {
    const db = await this.open();
    const query = String(args.query ?? "").trim();
    const queryTokens = tokenize(query);
    const k = Math.max(1, Math.floor(args.k ?? 8));
    const records = await this.getAll(db);

    const matches = records
      .filter((rec) => matchesFilters(rec.metadata, args.filters))
      .map((rec) => {
        const source = `${rec.summary ?? ""}\n${rec.text}`;
        const score = queryTokens.length === 0 ? 1 : lexicalScore(queryTokens, source);
        return {
          rec,
          score
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.rec.sequence - b.rec.sequence;
      })
      .slice(0, k)
      .map<RlmSliceSearchHit>((entry) => ({
        sliceId: entry.rec.sliceId,
        score: entry.score,
        summary: entry.rec.summary ?? truncateText(entry.rec.text),
        metadata: entry.rec.metadata
      }));

    return matches;
  }

  async loadSlice(args: { sliceId: string; start?: number; end?: number }): Promise<RlmSlice> {
    const db = await this.open();
    const key = ensureSliceId(args.sliceId);
    const rec = await new Promise<IndexedDbSliceRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result as IndexedDbSliceRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("failed to read slice"));
    });

    if (!rec) {
      throw new Error(`slice not found: ${key}`);
    }

    const start = Math.max(0, Math.floor(args.start ?? 0));
    const end = Math.max(start, Math.floor(args.end ?? rec.text.length));
    return {
      sliceId: rec.sliceId,
      text: rec.text.slice(start, end),
      metadata: rec.metadata
    };
  }

  async loadNeighbors(args: RlmSliceNeighborArgs): Promise<RlmSlice[]> {
    const db = await this.open();
    const key = ensureSliceId(args.sliceId);
    const radius = Math.max(1, Math.floor(args.radius ?? 1));
    const records = await this.getAll(db);
    const target = records.find((rec) => rec.sliceId === key);
    if (!target) {
      throw new Error(`slice not found: ${key}`);
    }

    const minSeq = target.sequence - radius;
    const maxSeq = target.sequence + radius;

    return records
      .filter((rec) => rec.sequence >= minSeq && rec.sequence <= maxSeq)
      .sort((a, b) => a.sequence - b.sequence)
      .map<RlmSlice>((rec) => ({
        sliceId: rec.sliceId,
        text: rec.text,
        metadata: rec.metadata
      }));
  }

  async getSliceSummary(args: RlmSliceSummaryArgs): Promise<{ sliceId: string; summary: string }> {
    const slice = await this.loadSlice({ sliceId: args.sliceId });
    return {
      sliceId: slice.sliceId,
      summary: truncateText(slice.text)
    };
  }

  private async open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is not available in this runtime");
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "sliceId" });
          store.createIndex("sequence", "sequence", { unique: false });
          store.createIndex("timestampMs", "timestampMs", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("failed to open indexeddb"));
    });

    return this.dbPromise;
  }

  private async getAll(db: IDBDatabase): Promise<IndexedDbSliceRecord[]> {
    return await new Promise<IndexedDbSliceRecord[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve((req.result as IndexedDbSliceRecord[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("failed to scan slices"));
    });
  }
}

export function createIndexedDbStorageAdapter(
  options?: IndexedDbStorageOptions
): IndexedDbStorageAdapter {
  return new IndexedDbStorageAdapter(options);
}
