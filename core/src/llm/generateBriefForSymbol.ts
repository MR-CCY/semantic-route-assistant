export interface BriefInput {
  moduleName: string;
  signature: string;
  implementation?: string;
  filePath?: string;
}

type OpenAICompatPayload = {
  model: string;
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

async function callOpenAICompatible(params: {
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

export async function generateBriefForSymbol(input: BriefInput): Promise<string> {
  const provider = process.env.SRCA_LLM_PROVIDER;
  const apiKey = process.env.SRCA_LLM_API_KEY;
  const model = process.env.SRCA_LLM_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.SRCA_LLM_BASE_URL || "";

  if (!provider) {
    return `自动生成描述: ${input.signature}`;
  }

  if (!apiKey) {
    return `自动生成描述: ${input.signature}`;
  }

  const hasImpl = Boolean(input.implementation && input.implementation.trim());
  const implNote = hasImpl ? input.implementation! : "未提供实现，仅根据签名尽量推测。";

  const payload: OpenAICompatPayload = {
    model,
    temperature: 0.2,
    max_tokens: 64,
    messages: [
      {
        role: "system",
        content:
          "你是一个 C++ 项目的代码审查助手。根据给定的函数签名和实现，生成一条简短的一句话功能描述。要求：不超过 40 个字，准确，不幻想不存在的参数或行为，可以提到关键前置条件，不要输出多行，不要加项目符号。"
      },
      {
        role: "user",
        content: [
          `moduleName: ${input.moduleName}`,
          `signature: ${input.signature}`,
          `implementation:\n\`\`\`cpp\n${implNote}\n\`\`\``
        ].join("\n")
      }
    ]
  };

  try {
    let resolvedBaseUrl = baseUrl;
    if (provider === "openai" && !resolvedBaseUrl) {
      resolvedBaseUrl = "https://api.openai.com/v1";
    }

    if (!resolvedBaseUrl) {
      console.warn(
        `[generateBriefForSymbol] 未配置 SRCA_LLM_BASE_URL，无法调用 ${provider}。`
      );
      return `自动生成描述: ${input.signature}`;
    }

    const text = await callOpenAICompatible({
      apiKey,
      baseUrl: resolvedBaseUrl,
      payload
    });
    if (text) {
      return text;
    }
  } catch (error) {
    console.warn(
      `[generateBriefForSymbol] 调用失败: ${provider} ${input.moduleName} ${input.signature}`,
      error
    );
  }

  return `自动生成描述: ${input.signature}`;
}
