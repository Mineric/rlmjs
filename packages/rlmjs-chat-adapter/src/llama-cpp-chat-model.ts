import {
  OpenAiCompatibleChatModel,
  type OpenAiChatModelInput,
  type OpenAiChatModelMessage,
  type OpenAiChatModelOutput,
  type OpenAiCompatibleChatModelOptions
} from "./openai-chat-model.js";

const DEFAULT_LLAMA_CPP_BASE_URL = "http://127.0.0.1:8080/v1";

export type LlamaCppChatModelOptions = Omit<OpenAiCompatibleChatModelOptions, "baseUrl"> & {
  baseUrl?: string;
};

export type LlamaCppChatModelMessage = OpenAiChatModelMessage;
export type LlamaCppChatModelInput = OpenAiChatModelInput;
export type LlamaCppChatModelOutput = OpenAiChatModelOutput;

export class LlamaCppChatModel {
  private readonly inner: OpenAiCompatibleChatModel;

  constructor(options: LlamaCppChatModelOptions) {
    this.inner = new OpenAiCompatibleChatModel({
      ...options,
      baseUrl: (options.baseUrl ?? DEFAULT_LLAMA_CPP_BASE_URL).replace(/\/$/, "")
    });
  }

  async complete(input: LlamaCppChatModelInput): Promise<LlamaCppChatModelOutput> {
    return await this.inner.complete(input);
  }
}

export function createLlamaCppChatModel(options: LlamaCppChatModelOptions): LlamaCppChatModel {
  return new LlamaCppChatModel(options);
}
