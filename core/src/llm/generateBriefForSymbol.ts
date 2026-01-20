import { callOpenAICompatible, OpenAICompatPayload, resolveBaseUrl } from "./openaiCompat";

export interface BriefInput {
  moduleName: string;
  signature: string;
  implementation?: string;
  filePath?: string;
}

export type BriefResult = {
  brief: string;
  tags: string[];
};

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}

function normalizeTags(tags: unknown): string[] {
  const unique = new Set<string>();
  const pushTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      unique.add(normalized);
    }
  };

  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string") {
        pushTag(tag);
      }
    }
    return Array.from(unique);
  }

  if (typeof tags === "string") {
    const raw = tags.trim();
    if (!raw) {
      return [];
    }
    const containsCjk = /[\u4e00-\u9fff]/.test(raw);
    const hasSeparator = /[,\n\r，;；|、]/.test(raw);
    if (hasSeparator) {
      const parts = raw.split(/[,\n\r，;；|、]+/);
      for (const part of parts) {
        const tokens = part.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
          continue;
        }
        for (const token of tokens) {
          pushTag(token);
        }
      }
    } else {
      if (containsCjk && raw.includes("_")) {
        const parts = raw.split(/_+/).map((part) => part.trim()).filter(Boolean);
        if (parts.length > 0) {
          for (const part of parts) {
            pushTag(part);
          }
        } else {
          pushTag(raw);
        }
      } else {
        const tokens = raw.split(/\s+/).filter(Boolean);
        if (tokens.length > 1) {
          for (const token of tokens) {
            pushTag(token);
          }
        } else {
          pushTag(raw);
        }
      }
    }
  }

  return Array.from(unique);
}

function stripComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

function extractImplementationBody(input: string): string {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return input.slice(start + 1, end);
  }
  return input;
}

function adjustTagsForTrivialImplementation(impl: string | undefined, tags: string[]): string[] {
  if (!impl) {
    return tags;
  }
  const body = extractImplementationBody(impl);
  const stripped = stripComments(body).replace(/\s+/g, " ").trim();
  if (!stripped) {
    return ["空返回"];
  }
  if (/^return\s*;?\s*$/i.test(stripped)) {
    return ["空返回"];
  }
  if (/^return\s*(\{\}|\[\]|null|nullptr|undefined|none|nil|std::nullopt|""|'')\s*;?\s*$/i.test(stripped)) {
    return ["空返回"];
  }
  return tags;
}

function getTrivialBriefAndTags(input: BriefInput): BriefResult | null {
  if (!input.implementation) {
    return null;
  }
  const body = extractImplementationBody(input.implementation);
  const stripped = stripComments(body).replace(/\s+/g, " ").trim();
  if (!stripped) {
    return { brief: "空返回", tags: ["空返回"] };
  }
  if (/^return\s*;?\s*$/i.test(stripped)) {
    return { brief: "空返回", tags: ["空返回"] };
  }
  if (
    /^return\s*(\{\}|\[\]|null|nullptr|undefined|none|nil|std::nullopt|""|'')\s*;?\s*$/i.test(
      stripped
    )
  ) {
    return { brief: "空返回", tags: ["空返回"] };
  }
  if (!/^return\s+/.test(stripped)) {
    return null;
  }
  const expr = stripped.replace(/^return\s+/, "").replace(/;\s*$/, "").trim();
  if (!expr) {
    return null;
  }
  if (/[(){}\[\]+*/%&|^!?=]/.test(expr)) {
    return null;
  }
  const exprNoArrow = expr.replace(/->/g, "");
  if (/[<>]/.test(exprNoArrow)) {
    return null;
  }
  if (/[^A-Za-z0-9_$.]/.test(exprNoArrow)) {
    return null;
  }
  const isMemberReturn =
    expr.includes("this.") ||
    expr.includes("this->") ||
    /^(_|m_)[A-Za-z0-9_]+$/.test(expr);
  if (isMemberReturn) {
    return { brief: "返回成员变量", tags: ["成员变量访问", "只读访问"] };
  }
  return { brief: "简单返回", tags: ["简单返回"] };
}

const DEFAULT_SYSTEM_PROMPT =
  "你是一位拥有 20 年经验的资深代码架构师和算法专家。" +
  "分析函数签名与实现，生成 brief 与 tags。" +
  "brief 不超过 50 字，准确客观，不幻想。" +
  "tags 目标是高熵信息：算法/数据结构、设计模式、关键行为/副作用、明确业务语义；结构即证据。" +
  "标签可中文或 snake_case 英文，优先名词或名词短语；数量不限但宁缺毋滥。" +
  "只基于当前代码中的明确证据，不要过度联想；无证据则不输出。" +
  "若实现为空或仅默认返回（如 return {} / return null），只输出空返回/占位实现。" +
  "若为简单实现（仅返回成员变量/常量/直传参数），只输出简单语义，不扩展为管理/流程/结构类标签。" +
  "严禁语法噪音（function/class/void 等）、通用动词（processing/handling/managing）和泛化标签（控制流/指针/数据操作/生命周期/结构体等）。" +
  "避免文件路径/模块名/类名/函数名拆词，低质量通用词会在后处理过滤。" ;

const DEFAULT_USER_PROMPT = [
  "返回 JSON：{brief, tags}",
  "只返回 JSON，不要额外文本。",
  "moduleName: {{moduleName}}",
  "signature: {{signature}}",
  "implementation:",
  "```",
  "{{implementation}}",
  "```"
].join("\n");

function renderUserPrompt(input: BriefInput, implNote: string): string {
  const template = process.env.SRCA_LLM_USER_PROMPT || "";
  const raw = template.trim() ? template : DEFAULT_USER_PROMPT;
  return raw
    .split("{{moduleName}}")
    .join(input.moduleName)
    .split("{{signature}}")
    .join(input.signature)
    .split("{{implementation}}")
    .join(implNote);
}

export async function generateBriefAndTagsForSymbol(input: BriefInput): Promise<BriefResult> {
  const provider = process.env.SRCA_LLM_PROVIDER;
  const apiKey = process.env.SRCA_LLM_API_KEY;
  const model = process.env.SRCA_LLM_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.SRCA_LLM_BASE_URL || "";
  const systemPrompt = process.env.SRCA_LLM_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
  const temperatureEnv = Number(process.env.SRCA_LLM_TEMPERATURE ?? "0");
  const temperature = Number.isFinite(temperatureEnv)
    ? Math.min(1, Math.max(0, temperatureEnv))
    : 0;

  const trivialResult = getTrivialBriefAndTags(input);
  if (trivialResult) {
    return trivialResult;
  }

  if (!provider) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  if (!apiKey) {
    return { brief: `自动生成描述: ${input.signature}`, tags: [] };
  }

  const hasImpl = Boolean(input.implementation && input.implementation.trim());
  const implNote = hasImpl ? input.implementation! : "未提供实现，仅根据签名尽量推测。";

  const userPrompt = renderUserPrompt(input, implNote);
  const payload: OpenAICompatPayload = {
    model,
    temperature,
    max_tokens: 96,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  };

  try {
    const resolvedBaseUrl = resolveBaseUrl(provider, baseUrl);
    if (!resolvedBaseUrl) {
      console.warn(
        `[generateBriefForSymbol] 未配置 SRCA_LLM_BASE_URL，无法调用 ${provider}。`
      );
      return { brief: `自动生成描述: ${input.signature}`, tags: [] };
    }

    console.log(
      `[generateBriefForSymbol] LLM prompt file=${input.filePath ?? "unknown"} signature=${input.signature}`
    );
    console.log(`[generateBriefForSymbol] LLM prompt system=${systemPrompt}`);
    console.log(`[generateBriefForSymbol] LLM prompt user=${userPrompt}`);
    const text = await callOpenAICompatible({
      apiKey,
      baseUrl: resolvedBaseUrl,
      payload
    });
    if (text) {
      const jsonText = extractJson(text);
      if (jsonText) {
        try {
          const parsed = JSON.parse(jsonText) as { brief?: string; tags?: string[] };
          if (parsed?.brief) {
            return {
              brief: parsed.brief.trim(),
              tags: adjustTagsForTrivialImplementation(
                input.implementation,
                normalizeTags(parsed.tags || [])
              )
            };
          }
        } catch {
          // fall through to plain text
        }
      }
      return { brief: text, tags: [] };
    }
  } catch (error) {
    console.warn(
      `[generateBriefForSymbol] 调用失败: ${provider} ${input.moduleName} ${input.signature}`,
      error
    );
  }

  return { brief: `自动生成描述: ${input.signature}`, tags: [] };
}

export async function generateBriefForSymbol(input: BriefInput): Promise<string> {
  const result = await generateBriefAndTagsForSymbol(input);
  return result.brief;
}
