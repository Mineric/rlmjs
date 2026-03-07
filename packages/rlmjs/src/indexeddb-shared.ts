export function tokenizeForSearch(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

export function lexicalIncludesScore(tokens: string[], text: string): number {
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

export function truncatePreview(text: string, maxLength = 240): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

export async function openIndexedDbStore(
  dbName: string,
  version: number,
  storeName: string,
  keyPath: string
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this runtime");
  }

  return await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath });
        store.createIndex("sequence", "sequence", { unique: false });
        store.createIndex("timestampMs", "timestampMs", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed to open indexeddb"));
  });
}

export async function getAllFromObjectStore<T>(
  db: IDBDatabase,
  storeName: string,
  errorMessage: string
): Promise<T[]> {
  return await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error(errorMessage));
  });
}
