import type {
  RlmSlice,
  RlmSliceNeighborArgs,
  RlmSliceSearchArgs,
  RlmSliceSearchHit,
  RlmSliceSummaryArgs,
  RlmStorageAdapter
} from "@software-machines/rlmjs-core";

export type HttpStorageAdapterOptions = {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
};

type EndpointMap = {
  searchSlices: string;
  loadSlice: string;
  loadNeighbors: string;
  getSliceSummary: string;
};

const DEFAULT_ENDPOINTS: EndpointMap = {
  searchSlices: "/searchSlices",
  loadSlice: "/loadSlice",
  loadNeighbors: "/loadNeighbors",
  getSliceSummary: "/getSliceSummary"
};

export class HttpStorageAdapter implements RlmStorageAdapter {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoints: EndpointMap;

  constructor(options: HttpStorageAdapterOptions, endpoints?: Partial<EndpointMap>) {
    if (!options.baseUrl?.trim()) {
      throw new Error("baseUrl is required");
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoints = {
      ...DEFAULT_ENDPOINTS,
      ...(endpoints ?? {})
    };
  }

  async searchSlices(args: RlmSliceSearchArgs): Promise<RlmSliceSearchHit[]> {
    return await this.post<RlmSliceSearchHit[]>(this.endpoints.searchSlices, args);
  }

  async loadSlice(args: { sliceId: string; start?: number; end?: number }): Promise<RlmSlice> {
    return await this.post<RlmSlice>(this.endpoints.loadSlice, args);
  }

  async loadNeighbors(args: RlmSliceNeighborArgs): Promise<RlmSlice[]> {
    return await this.post<RlmSlice[]>(this.endpoints.loadNeighbors, args);
  }

  async getSliceSummary(args: RlmSliceSummaryArgs): Promise<{ sliceId: string; summary: string }> {
    return await this.post<{ sliceId: string; summary: string }>(this.endpoints.getSliceSummary, args);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`storage HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    return (await response.json()) as T;
  }
}

export function createHttpStorageAdapter(options: HttpStorageAdapterOptions): HttpStorageAdapter {
  return new HttpStorageAdapter(options);
}
