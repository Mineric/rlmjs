import {
  extractOpenAiTextContent,
  requestOpenAiChatCompletion
} from "./openai-chat-completion.js";

export type OpenAiCompatibleChatModelOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  temperature?: number;
};

export type OpenAiChatModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAiChatModelInput = {
  messages: OpenAiChatModelMessage[];
};

export type OpenAiChatModelOutput = {
  content: string;
};

export class OpenAiCompatibleChatModel {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly temperature: number;

  constructor(options: OpenAiCompatibleChatModelOptions) {
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
  }

  async complete(input: OpenAiChatModelInput): Promise<OpenAiChatModelOutput> {
    const payload = await requestOpenAiChatCompletion(
      {
        baseUrl: this.baseUrl,
        model: this.model,
        apiKey: this.apiKey,
        headers: this.headers,
        timeoutMs: this.timeoutMs,
        temperature: this.temperature
      },
      input.messages
    );

    return {
      content: extractOpenAiTextContent(payload.choices?.[0]?.message?.content)
    };
  }
}

export function createOpenAiCompatibleChatModel(
  options: OpenAiCompatibleChatModelOptions
): OpenAiCompatibleChatModel {
  return new OpenAiCompatibleChatModel(options);
}
