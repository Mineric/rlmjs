export type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

export type CorpusChunk = {
  chunkId: string;
  sequence: number;
  text: string;
  role?: string;
  timestampMs?: number;
  summary?: string;
  metadata?: Record<string, JsonLike>;
};

export type CorpusSearchHit = {
  chunkId: string;
  score: number;
  sequence: number;
  summary: string;
  metadata?: Record<string, JsonLike>;
};

export type CorpusSearchArgs = {
  query: string;
  k?: number;
  chunkIds?: string[];
};

export type ContextMaterialization = {
  text: string;
  chunkIds: string[];
  truncated: boolean;
  loadedBytes: number;
};

export interface CorpusStore {
  putChunks(chunks: CorpusChunk[]): Promise<void> | void;
  getChunk(chunkId: string): Promise<CorpusChunk | undefined> | CorpusChunk | undefined;
  listChunks(chunkIds?: string[]): Promise<CorpusChunk[]> | CorpusChunk[];
  searchChunks(args: CorpusSearchArgs): Promise<CorpusSearchHit[]> | CorpusSearchHit[];
}

function sliceTextByBytes(text: string, maxBytes: number, encoder: TextEncoder): string {
  if (maxBytes <= 0 || text.length === 0) {
    return "";
  }

  if (encoder.encode(text).length <= maxBytes) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid);
    if (encoder.encode(candidate).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, low);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function lexicalScore(tokens: string[], text: string): number {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function truncateText(text: string, maxLength = 240): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
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

function intersectChunkIds(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  if (!left) {
    return right ? [...right] : undefined;
  }
  if (!right) {
    return [...left];
  }

  const allowed = new Set(left);
  return right.filter((chunkId) => allowed.has(chunkId));
}

export class MemoryCorpusStore implements CorpusStore {
  private readonly chunks = new Map<string, CorpusChunk>();

  putChunks(chunks: CorpusChunk[]): void {
    for (const chunk of chunks) {
      const chunkId = chunk.chunkId.trim();
      if (!chunkId) {
        throw new Error("chunkId is required");
      }
      this.chunks.set(chunkId, {
        ...chunk,
        chunkId
      });
    }
  }

  getChunk(chunkId: string): CorpusChunk | undefined {
    return this.chunks.get(chunkId.trim());
  }

  listChunks(chunkIds?: string[]): CorpusChunk[] {
    const allowed = chunkIds ? new Set(normalizeChunkIds(chunkIds) ?? []) : null;
    return [...this.chunks.values()]
      .filter((chunk) => !allowed || allowed.has(chunk.chunkId))
      .sort((left, right) => left.sequence - right.sequence);
  }

  searchChunks(args: CorpusSearchArgs): CorpusSearchHit[] {
    const tokens = tokenize(String(args.query ?? "").trim());
    const k = Math.max(1, Math.floor(args.k ?? 8));
    const scored: Array<CorpusSearchHit | null> = this.listChunks(args.chunkIds).map((chunk) => {
        const source = `${chunk.summary ?? ""}\n${chunk.text}`;
        const score = tokens.length === 0 ? 1 : lexicalScore(tokens, source);
        if (score <= 0) {
          return null;
        }

        return {
          chunkId: chunk.chunkId,
          score,
          sequence: chunk.sequence,
          summary: chunk.summary ?? truncateText(chunk.text),
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
}

export type ContextHandleOptions = {
  chunkIds?: string[];
};

export type ContextSearchOptions = {
  k?: number;
};

export type ContextMaterializeOptions = {
  limitBytes?: number;
  joiner?: string;
};

export class ContextHandle {
  private readonly store: CorpusStore;
  private readonly chunkIds?: string[];

  constructor(store: CorpusStore, options?: ContextHandleOptions) {
    this.store = store;
    this.chunkIds = normalizeChunkIds(options?.chunkIds);
  }

  getChunkIds(): string[] | undefined {
    return this.chunkIds ? [...this.chunkIds] : undefined;
  }

  async list(): Promise<CorpusChunk[]> {
    return await this.store.listChunks(this.chunkIds);
  }

  async size(): Promise<number> {
    return (await this.list()).length;
  }

  async get(chunkId: string): Promise<CorpusChunk | undefined> {
    const cleaned = chunkId.trim();
    if (!cleaned) {
      return undefined;
    }
    if (this.chunkIds && !this.chunkIds.includes(cleaned)) {
      return undefined;
    }
    return await this.store.getChunk(cleaned);
  }

  async search(query: string, options?: ContextSearchOptions): Promise<CorpusSearchHit[]> {
    return await this.store.searchChunks({
      query,
      k: options?.k,
      chunkIds: this.chunkIds
    });
  }

  select(chunkIds: string[]): ContextHandle {
    return new ContextHandle(this.store, {
      chunkIds: intersectChunkIds(this.chunkIds, normalizeChunkIds(chunkIds))
    });
  }

  async subviewFromSearch(query: string, options?: ContextSearchOptions): Promise<ContextHandle> {
    const hits = await this.search(query, options);
    return this.select(hits.map((hit) => hit.chunkId));
  }

  async range(sequenceStart: number, sequenceEnd: number): Promise<ContextHandle> {
    const min = Math.min(sequenceStart, sequenceEnd);
    const max = Math.max(sequenceStart, sequenceEnd);
    const chunkIds = (await this.list())
      .filter((chunk) => chunk.sequence >= min && chunk.sequence <= max)
      .map((chunk) => chunk.chunkId);
    return this.select(chunkIds);
  }

  async window(chunkId: string, radius = 1): Promise<ContextHandle> {
    const cleaned = chunkId.trim();
    const size = Math.max(0, Math.floor(radius));
    const chunks = await this.list();
    const index = chunks.findIndex((chunk) => chunk.chunkId === cleaned);
    if (index < 0) {
      return this.select([]);
    }

    const start = Math.max(0, index - size);
    const end = Math.min(chunks.length - 1, index + size);
    return this.select(chunks.slice(start, end + 1).map((chunk) => chunk.chunkId));
  }

  async materialize(options?: ContextMaterializeOptions): Promise<ContextMaterialization> {
    const limitBytes = Math.max(1, Math.floor(options?.limitBytes ?? 32_768));
    const joiner = options?.joiner ?? "\n\n";
    const encoder = new TextEncoder();
    const joinerBytes = encoder.encode(joiner).length;
    const chunks = await this.list();

    const lines: string[] = [];
    const chunkIds: string[] = [];
    let loadedBytes = 0;
    let truncated = false;

    for (const chunk of chunks) {
      const prefix = `[${chunk.sequence}:${chunk.chunkId}${chunk.role ? ` ${chunk.role}` : ""}] `;
      const text = `${prefix}${chunk.text}`;
      const separatorBytes = lines.length > 0 ? joinerBytes : 0;
      const textBytes = encoder.encode(text).length;

      if (loadedBytes + separatorBytes + textBytes > limitBytes) {
        const remainingTextBytes = limitBytes - loadedBytes - separatorBytes;
        const partialText = sliceTextByBytes(text, remainingTextBytes, encoder);
        if (partialText) {
          lines.push(partialText);
          chunkIds.push(chunk.chunkId);
          loadedBytes += separatorBytes + encoder.encode(partialText).length;
        }
        truncated = true;
        break;
      }

      lines.push(text);
      chunkIds.push(chunk.chunkId);
      loadedBytes += separatorBytes + textBytes;
    }

    return {
      text: lines.join(joiner),
      chunkIds,
      truncated,
      loadedBytes
    };
  }
}

export function createContextHandle(store: CorpusStore, options?: ContextHandleOptions): ContextHandle {
  return new ContextHandle(store, options);
}
