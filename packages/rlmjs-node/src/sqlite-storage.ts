import Database from "better-sqlite3";

import type {
  JsonLike,
  RlmSlice,
  RlmSliceLoadArgs,
  RlmSliceNeighborArgs,
  RlmSliceSearchArgs,
  RlmSliceSearchHit,
  RlmSubcontext,
  RlmSliceSummaryArgs,
  RlmStorageAdapter
} from "@software-machines/rlmjs-core";

export type SqliteSliceRecord = {
  sliceId: string;
  text: string;
  sequence: number;
  timestampMs?: number;
  summary?: string;
  metadata?: Record<string, JsonLike>;
};

export type SqliteStorageOptions = {
  dbPath?: string;
  tableName?: string;
};

type SliceRow = {
  slice_id: string;
  text: string;
  sequence: number;
  timestamp_ms: number | null;
  summary: string | null;
  metadata_json: string | null;
};

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

function parseMetadata(metadataJson: string | null): Record<string, JsonLike> | undefined {
  if (!metadataJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, JsonLike>;
    return parsed;
  } catch {
    return undefined;
  }
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
  for (const [key, value] of Object.entries(filters)) {
    if (!metadata || metadata[key] !== value) {
      return false;
    }
  }
  return true;
}

function lexicalScore(tokens: string[], text: string): number {
  if (tokens.length === 0) {
    return 0;
  }
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function isAllowedSlice(sliceId: string, subcontext: RlmSubcontext | undefined): boolean {
  if (!subcontext) {
    return true;
  }
  return subcontext.sliceIds.includes(sliceId);
}

export class SqliteStorageAdapter implements RlmStorageAdapter {
  private readonly db: Database.Database;
  private readonly tableName: string;

  constructor(options?: SqliteStorageOptions) {
    this.db = new Database(options?.dbPath ?? ":memory:");
    this.tableName = options?.tableName ?? "rlm_slices";
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  putSlices(slices: SqliteSliceRecord[]): void {
    if (slices.length === 0) {
      return;
    }

    const sql = `
      INSERT INTO ${this.tableName}
      (slice_id, text, sequence, timestamp_ms, summary, metadata_json)
      VALUES (@slice_id, @text, @sequence, @timestamp_ms, @summary, @metadata_json)
      ON CONFLICT(slice_id) DO UPDATE SET
        text = excluded.text,
        sequence = excluded.sequence,
        timestamp_ms = excluded.timestamp_ms,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json
    `;

    const stmt = this.db.prepare(sql);
    const tx = this.db.transaction((records: SqliteSliceRecord[]) => {
      for (const record of records) {
        stmt.run({
          slice_id: ensureSliceId(record.sliceId),
          text: record.text,
          sequence: record.sequence,
          timestamp_ms: record.timestampMs ?? null,
          summary: record.summary ?? null,
          metadata_json: record.metadata ? JSON.stringify(record.metadata) : null
        });
      }
    });

    tx(slices);
  }

  async searchSlices(args: RlmSliceSearchArgs): Promise<RlmSliceSearchHit[]> {
    const query = String(args.query ?? "").trim();
    const tokens = tokenize(query);
    const k = Math.max(1, Math.floor(args.k ?? 8));

    const rows = this.db
      .prepare(
        `SELECT slice_id, text, sequence, timestamp_ms, summary, metadata_json
         FROM ${this.tableName}
         ORDER BY sequence ASC`
      )
      .all() as SliceRow[];

    const scored = rows
      .map((row) => {
        if (!isAllowedSlice(row.slice_id, args.subcontext)) {
          return null;
        }
        const metadata = parseMetadata(row.metadata_json);
        if (!matchesFilters(metadata, args.filters)) {
          return null;
        }
        const source = `${row.summary ?? ""}\n${row.text}`;
        const score = tokens.length === 0 ? 1 : lexicalScore(tokens, source);
        if (score <= 0) {
          return null;
        }
        return {
          sliceId: row.slice_id,
          score,
          summary: row.summary ?? truncateText(row.text),
          metadata,
          sequence: row.sequence
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.sequence - b.sequence;
      })
      .slice(0, k)
      .map<RlmSliceSearchHit>(({ sequence: _sequence, ...rest }) => rest);

    return scored;
  }

  async loadSlice(args: RlmSliceLoadArgs): Promise<RlmSlice> {
    const sliceId = ensureSliceId(args.sliceId);
    if (!isAllowedSlice(sliceId, args.subcontext)) {
      throw new Error(`slice not allowed in current subcontext: ${sliceId}`);
    }
    const row = this.db
      .prepare(
        `SELECT slice_id, text, sequence, timestamp_ms, summary, metadata_json
         FROM ${this.tableName}
         WHERE slice_id = ?`
      )
      .get(sliceId) as SliceRow | undefined;

    if (!row) {
      throw new Error(`slice not found: ${sliceId}`);
    }

    const start = Math.max(0, Math.floor(args.start ?? 0));
    const end = Math.max(start, Math.floor(args.end ?? row.text.length));

    return {
      sliceId: row.slice_id,
      text: row.text.slice(start, end),
      metadata: parseMetadata(row.metadata_json)
    };
  }

  async loadNeighbors(args: RlmSliceNeighborArgs): Promise<RlmSlice[]> {
    const sliceId = ensureSliceId(args.sliceId);
    const radius = Math.max(1, Math.floor(args.radius ?? 1));

    const rows = this.db
      .prepare(
        `SELECT slice_id, text, sequence, timestamp_ms, summary, metadata_json
         FROM ${this.tableName}
         ORDER BY sequence ASC`
      )
      .all() as SliceRow[];
    const allowedRows = rows.filter((row) => isAllowedSlice(row.slice_id, args.subcontext));
    const targetIndex = allowedRows.findIndex((row) => row.slice_id === sliceId);

    if (targetIndex < 0) {
      throw new Error(`slice not found: ${sliceId}`);
    }

    const start = Math.max(0, targetIndex - radius);
    const end = Math.min(allowedRows.length - 1, targetIndex + radius);
    return allowedRows.slice(start, end + 1).map<RlmSlice>((row) => ({
      sliceId: row.slice_id,
      text: row.text,
      metadata: parseMetadata(row.metadata_json)
    }));
  }

  async getSliceSummary(args: RlmSliceSummaryArgs): Promise<{ sliceId: string; summary: string }> {
    const sliceId = ensureSliceId(args.sliceId);
    if (!isAllowedSlice(sliceId, args.subcontext)) {
      throw new Error(`slice not allowed in current subcontext: ${sliceId}`);
    }
    const row = this.db
      .prepare(`SELECT slice_id, summary, text FROM ${this.tableName} WHERE slice_id = ?`)
      .get(sliceId) as { slice_id: string; summary: string | null; text: string } | undefined;

    if (!row) {
      throw new Error(`slice not found: ${args.sliceId}`);
    }

    return {
      sliceId: row.slice_id,
      summary: row.summary ?? truncateText(row.text)
    };
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        slice_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp_ms INTEGER,
        summary TEXT,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_sequence
        ON ${this.tableName}(sequence);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_timestamp
        ON ${this.tableName}(timestamp_ms);
    `);
  }
}

export function createSqliteStorageAdapter(options?: SqliteStorageOptions): SqliteStorageAdapter {
  return new SqliteStorageAdapter(options);
}
