import type { RlmProvider, RlmProviderAction, RlmProviderInput } from "@software-machines/rlmjs-core";

export type LlamaCppProviderOptions = {
  baseUrl?: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  temperature?: number;
  actionSystemPrompt?: string;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";
const DEFAULT_ACTION_PROMPT = [
  "Return exactly one JSON object.",
  '{"type":"tool_call","call":{"name":"searchSlices|loadSlice|loadNeighbors|getSliceSummary|composeSubcontext|recursive_query","args":{}}}',
  '{"type":"final","answer":"...","citations":[{"id":"...","start":0,"end":0}]}',
  "Use composeSubcontext to narrow child runs to selected slice IDs before recursive_query when possible."
].join("\n");

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function normalizeAction(candidate: unknown, fallback: string): RlmProviderAction {
  if (candidate && typeof candidate === "object") {
    const obj = candidate as {
      type?: unknown;
      call?: { name?: unknown; args?: unknown };
      answer?: unknown;
      citations?: unknown;
    };

    if (obj.type === "tool_call" && obj.call && typeof obj.call.name === "string") {
      return {
        type: "tool_call",
        call: {
          name: obj.call.name,
          args: obj.call.args && typeof obj.call.args === "object" ? (obj.call.args as Record<string, unknown>) : {}
        }
      };
    }

    if (obj.type === "final" && typeof obj.answer === "string") {
      const citations: Array<{ id: string; start?: number; end?: number }> = [];
      if (Array.isArray(obj.citations)) {
        for (const entry of obj.citations) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const c = entry as { id?: unknown; start?: unknown; end?: unknown };
          if (typeof c.id !== "string") {
            continue;
          }
          citations.push({
            id: c.id,
            start: typeof c.start === "number" ? c.start : undefined,
            end: typeof c.end === "number" ? c.end : undefined
          });
        }
      }

      return {
        type: "final",
        answer: obj.answer,
        citations: citations.length > 0 ? citations : undefined
      };
    }
  }

  return {
    type: "final",
    answer: fallback || "No answer returned by provider."
  };
}

export class LlamaCppProvider implements RlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly actionSystemPrompt: string;

  constructor(options: LlamaCppProviderOptions) {
    if (!options.model?.trim()) {
      throw new Error("model is required");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.temperature = options.temperature ?? 0;
    this.actionSystemPrompt = options.actionSystemPrompt ?? DEFAULT_ACTION_PROMPT;
  }

  async complete(input: RlmProviderInput): Promise<RlmProviderAction> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json"
      };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: this.temperature,
          messages: [
            { role: "system", content: this.actionSystemPrompt },
            ...input.messages
          ]
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama.cpp HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            tool_calls?: Array<{
              function?: {
                name?: unknown;
                arguments?: unknown;
              };
            }>;
          };
        }>;
      };

      const message = payload.choices?.[0]?.message;
      const functionCall = message?.tool_calls?.[0]?.function;
      if (functionCall && typeof functionCall.name === "string") {
        const parsedArgs =
          typeof functionCall.arguments === "string"
            ? parseJson(functionCall.arguments)
            : functionCall.arguments;

        return normalizeAction(
          {
            type: "tool_call",
            call: {
              name: functionCall.name,
              args: parsedArgs
            }
          },
          ""
        );
      }

      const text = typeof message?.content === "string" ? message.content : "";
      return normalizeAction(parseJson(text), text);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLlamaCppProvider(options: LlamaCppProviderOptions): LlamaCppProvider {
  return new LlamaCppProvider(options);
}
