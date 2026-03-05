import type { RlmProvider, RlmProviderAction, RlmProviderInput } from "@software-machines/rlmjs-core";

export type OpenAiCompatibleProviderOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  temperature?: number;
  actionSystemPrompt?: string;
  includeResponseFormatJson?: boolean;
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

const DEFAULT_ACTION_PROMPT = [
  "You are a recursive retrieval controller.",
  "Return exactly one JSON object.",
  "Valid formats:",
  '{"type":"tool_call","call":{"name":"searchSlices|loadSlice|loadNeighbors|getSliceSummary|recursive_query","args":{}}}',
  '{"type":"final","answer":"...","citations":[{"id":"...","start":0,"end":0}]}',
  "Do not include markdown fences."
].join("\n");

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function normalizeAction(candidate: unknown, fallbackAnswer: string): RlmProviderAction {
  if (candidate && typeof candidate === "object") {
    const obj = candidate as {
      type?: unknown;
      call?: { name?: unknown; args?: unknown };
      answer?: unknown;
      citations?: unknown;
    };

    if (obj.type === "tool_call" && obj.call && typeof obj.call.name === "string") {
      const args = obj.call.args && typeof obj.call.args === "object" ? (obj.call.args as Record<string, unknown>) : {};
      return {
        type: "tool_call",
        call: {
          name: obj.call.name,
          args
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
    answer: fallbackAnswer || "No answer returned by provider."
  };
}

function toOpenAiMessages(input: RlmProviderInput): OpenAiChatMessage[] {
  const base: OpenAiChatMessage[] = [
    {
      role: "system",
      content: DEFAULT_ACTION_PROMPT
    }
  ];

  for (const message of input.messages) {
    base.push({
      role: message.role,
      content: message.content,
      name: message.name
    });
  }

  return base;
}

export class OpenAiCompatibleProvider implements RlmProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly actionSystemPrompt: string;
  private readonly includeResponseFormatJson: boolean;

  constructor(options: OpenAiCompatibleProviderOptions) {
    if (!options.baseUrl?.trim()) {
      throw new Error("baseUrl is required");
    }
    if (!options.model?.trim()) {
      throw new Error("model is required");
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.temperature = options.temperature ?? 0;
    this.actionSystemPrompt = options.actionSystemPrompt ?? DEFAULT_ACTION_PROMPT;
    this.includeResponseFormatJson = options.includeResponseFormatJson ?? true;
  }

  async complete(input: RlmProviderInput): Promise<RlmProviderAction> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const messages = toOpenAiMessages(input);
      messages[0] = {
        role: "system",
        content: this.actionSystemPrompt
      };

      const body: Record<string, unknown> = {
        model: this.model,
        temperature: this.temperature,
        messages
      };

      if (this.includeResponseFormatJson) {
        body.response_format = { type: "json_object" };
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...this.headers
      };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`provider HTTP ${response.status}: ${text.slice(0, 400)}`);
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
      const toolCall = message?.tool_calls?.[0]?.function;
      if (toolCall && typeof toolCall.name === "string") {
        const argsRaw = typeof toolCall.arguments === "string" ? safeJsonParse(toolCall.arguments) : toolCall.arguments;
        return normalizeAction(
          {
            type: "tool_call",
            call: {
              name: toolCall.name,
              args: argsRaw
            }
          },
          ""
        );
      }

      const content = extractTextContent(message?.content);
      const parsed = safeJsonParse(content);
      return normalizeAction(parsed, content);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(options);
}
