export type OpenAiChatCompletionOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  temperature: number;
};

export type OpenAiChatCompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type OpenAiChatCompletionPayload = {
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

export function extractOpenAiTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text?: unknown }).text ?? "")
          : ""
      )
      .join("\n")
      .trim();
  }
  return "";
}

export async function requestOpenAiChatCompletion(
  options: OpenAiChatCompletionOptions,
  messages: OpenAiChatCompletionMessage[],
  bodyExtras?: Record<string, unknown>
): Promise<OpenAiChatCompletionPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(options.headers ?? {})
    };
    if (options.apiKey) {
      headers.authorization = `Bearer ${options.apiKey}`;
    }

    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        temperature: options.temperature,
        messages,
        ...(bodyExtras ?? {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`chat completion HTTP ${response.status}: ${text.slice(0, 400)}`);
    }

    return (await response.json()) as OpenAiChatCompletionPayload;
  } finally {
    clearTimeout(timer);
  }
}
