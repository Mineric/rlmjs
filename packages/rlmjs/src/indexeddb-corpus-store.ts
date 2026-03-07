import type {
  CorpusChunk,
  CorpusSearchArgs,
  CorpusSearchHit,
  CorpusStore,
  JsonLike
} from "./corpus.js";
import {
  getAllFromObjectStore,
  lexicalIncludesScore,
  openIndexedDbStore,
  tokenizeForSearch,
  truncatePreview
} from "./indexeddb-shared.js";

export type IndexedDbCorpusRecord = {
  chunkId: string;
  sequence: number;
  text: string;
  role?: string;
  timestampMs?: number;
  summary?: string;
  metadata?: Record<string, JsonLike>;
};

export type IndexedDbCorpusStoreOptions = {
  dbName?: string;
  storeName?: string;
  version?: number;
};

const DEFAULT_DB_NAME = "rlmjs";
const DEFAULT_STORE_NAME = "corpus_chunks";

function normalizeChunkId(chunkId: string): string {
  const cleaned = chunkId.trim();
  if (!cleaned) {
    throw new Error("chunkId is required");
  }
  return cleaned;
}

function normalizeChunkIds(chunkIds: string[] | undefined): string[] | undefined {
  if (!chunkIds) {
    return undefined;
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const chunkId of chunkIds) {
    const cleaned = chunkId.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

export class IndexedDbCorpusStore implements CorpusStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options?: IndexedDbCorpusStoreOptions) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options?.storeName ?? DEFAULT_STORE_NAME;
    this.version = options?.version ?? 1;
  }

  async putChunks(chunks: CorpusChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);

      for (const chunk of chunks) {
        store.put({
          ...chunk,
          chunkId: normalizeChunkId(chunk.chunkId)
        } satisfies IndexedDbCorpusRecord);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to write corpus chunks"));
      tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
  }

  async getChunk(chunkId: string): Promise<CorpusChunk | undefined> {
    const db = await this.open();
    const key = normalizeChunkId(chunkId);
    return await new Promise<IndexedDbCorpusRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result as IndexedDbCorpusRecord | undefined);
      req.onerror = () => reject(req.error ?? new Error("failed to read corpus chunk"));
    });
  }

  async listChunks(chunkIds?: string[]): Promise<CorpusChunk[]> {
    const records = await this.getAll();
    const allowed = chunkIds ? new Set(normalizeChunkIds(chunkIds) ?? []) : null;
    return records
      .filter((record) => !allowed || allowed.has(record.chunkId))
      .sort((left, right) => left.sequence - right.sequence);
  }

  async searchChunks(args: CorpusSearchArgs): Promise<CorpusSearchHit[]> {
    const tokens = tokenizeForSearch(String(args.query ?? "").trim());
    const k = Math.max(1, Math.floor(args.k ?? 8));
    const chunks = await this.listChunks(args.chunkIds);

    const scored: Array<CorpusSearchHit | null> = chunks.map((chunk) => {
        const source = `${chunk.summary ?? ""}\n${chunk.text}`;
        const score = tokens.length === 0 ? 1 : lexicalIncludesScore(tokens, source);
        if (score <= 0) {
          return null;
        }
        return {
          chunkId: chunk.chunkId,
          score,
          sequence: chunk.sequence,
          summary: chunk.summary ?? truncatePreview(chunk.text),
          metadata: chunk.metadata
        };
      });

    return scored
      .filter((entry): entry is CorpusSearchHit => entry !== null)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.sequence - right.sequence;
      })
      .slice(0, k);
  }

  private async open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = openIndexedDbStore(this.dbName, this.version, this.storeName, "chunkId");

    return this.dbPromise;
  }

  private async getAll(): Promise<IndexedDbCorpusRecord[]> {
    const db = await this.open();
    return await getAllFromObjectStore<IndexedDbCorpusRecord>(
      db,
      this.storeName,
      "failed to scan corpus chunks"
    );
  }
}

export function createIndexedDbCorpusStore(
  options?: IndexedDbCorpusStoreOptions
): IndexedDbCorpusStore {
  return new IndexedDbCorpusStore(options);
}
