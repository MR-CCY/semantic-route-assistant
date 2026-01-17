export type OpenAICompatPayload = {
  model: string;
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export async function callOpenAICompatible(params: {
  apiKey: string;
  baseUrl: string;
  payload: OpenAICompatPayload;
}): Promise<string | null> {
  const { apiKey, baseUrl, payload } = params;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

export function resolveBaseUrl(provider: string, baseUrl: string): string | null {
  if (baseUrl) {
    return baseUrl;
  }
  if (provider === "openai") {
    return "https://api.openai.com/v1";
  }
  return null;
}
