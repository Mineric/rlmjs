import type {
  CorpusChunk,
  CorpusSearchArgs,
  CorpusSearchHit,
  CorpusStore
} from "./corpus.js";

export type SemanticEmbeddingKind = "query" | "chunk";

export type SemanticEmbeddingFunction = (input: {
  text: string;
  kind: SemanticEmbeddingKind;
  chunk?: CorpusChunk;
}) => Promise<number[]> | number[];

export type SemanticSearchFunction = (
  args: CorpusSearchArgs & {
    store: CorpusStore;
  }
) => Promise<CorpusSearchHit[]> | CorpusSearchHit[];

export type SemanticCorpusStoreOptions = {
  baseStore: CorpusStore;
  embedText?: SemanticEmbeddingFunction;
  searchChunks?: SemanticSearchFunction;
};

function truncatePreview(text: string, maxLength = 240): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function dotProduct(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return total;
}

function magnitude(vector: number[]): number {
  let total = 0;
  for (const value of vector) {
    total += value * value;
  }
  return Math.sqrt(total);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct(left, right) / (leftMagnitude * rightMagnitude);
}

function buildChunkSource(chunk: CorpusChunk): string {
  return `${chunk.summary ?? ""}\n${chunk.text}`.trim();
}

export class SemanticCorpusStore implements CorpusStore {
  private readonly baseStore: CorpusStore;
  private readonly embedText?: SemanticEmbeddingFunction;
  private readonly searchImpl?: SemanticSearchFunction;
  private readonly chunkEmbeddings = new Map<string, number[]>();

  constructor(options: SemanticCorpusStoreOptions) {
    this.baseStore = options.baseStore;
    this.embedText = options.embedText;
    this.searchImpl = options.searchChunks;
  }

  async putChunks(chunks: CorpusChunk[]): Promise<void> {
    await this.baseStore.putChunks(chunks);
    if (!this.embedText || chunks.length === 0) {
      return;
    }

    for (const chunk of chunks) {
      this.chunkEmbeddings.set(
        chunk.chunkId,
        await this.embedText({
          text: buildChunkSource(chunk),
          kind: "chunk",
          chunk
        })
      );
    }
  }

  async getChunk(chunkId: string): Promise<CorpusChunk | undefined> {
    return await this.baseStore.getChunk(chunkId);
  }

  async listChunks(chunkIds?: string[]): Promise<CorpusChunk[]> {
    return await this.baseStore.listChunks(chunkIds);
  }

  async searchChunks(args: CorpusSearchArgs): Promise<CorpusSearchHit[]> {
    if (this.searchImpl) {
      return await this.searchImpl({
        ...args,
        store: this.baseStore
      });
    }

    if (!this.embedText) {
      throw new Error(
        "semantic search is not configured; provide SemanticCorpusStoreOptions.embedText or searchChunks"
      );
    }

    const queryText = String(args.query ?? "").trim();
    const k = Math.max(1, Math.floor(args.k ?? 8));
    const queryEmbedding = await this.embedText({
      text: queryText,
      kind: "query"
    });
    const chunks = await this.baseStore.listChunks(args.chunkIds);
    const scored: CorpusSearchHit[] = [];

    for (const chunk of chunks) {
      let chunkEmbedding = this.chunkEmbeddings.get(chunk.chunkId);
      if (!chunkEmbedding) {
        chunkEmbedding = await this.embedText({
          text: buildChunkSource(chunk),
          kind: "chunk",
          chunk
        });
        this.chunkEmbeddings.set(chunk.chunkId, chunkEmbedding);
      }

      if (chunkEmbedding.length !== queryEmbedding.length) {
        throw new Error(
          `semantic embedding dimension mismatch for chunk '${chunk.chunkId}' (${chunkEmbedding.length} !== ${queryEmbedding.length})`
        );
      }

      const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
      if (score <= 0) {
        continue;
      }

      scored.push({
        chunkId: chunk.chunkId,
        score,
        sequence: chunk.sequence,
        summary: chunk.summary ?? truncatePreview(chunk.text),
        metadata: chunk.metadata
      });
    }

    return scored
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.sequence - right.sequence;
      })
      .slice(0, k);
  }
}

export function createSemanticCorpusStore(options: SemanticCorpusStoreOptions): SemanticCorpusStore {
  return new SemanticCorpusStore(options);
}
