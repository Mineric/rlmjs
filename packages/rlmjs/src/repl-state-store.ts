export interface ReplStateStore {
  loadState(sessionId: string): Promise<Record<string, unknown> | undefined>;
  saveState(sessionId: string, state: Record<string, unknown>): Promise<void>;
  deleteState?(sessionId: string): Promise<void>;
}
