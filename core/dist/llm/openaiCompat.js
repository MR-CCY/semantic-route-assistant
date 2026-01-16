"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenAICompatible = callOpenAICompatible;
exports.resolveBaseUrl = resolveBaseUrl;
async function callOpenAICompatible(params) {
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
    const data = (await response.json());
    return data.choices?.[0]?.message?.content?.trim() ?? null;
}
function resolveBaseUrl(provider, baseUrl) {
    if (baseUrl) {
        return baseUrl;
    }
    if (provider === "openai") {
        return "https://api.openai.com/v1";
    }
    return null;
}
