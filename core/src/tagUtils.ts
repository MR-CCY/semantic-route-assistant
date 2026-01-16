import path from "path";

const STOP_WORDS = new Set([
  "get",
  "set",
  "do",
  "run",
  "ctx",
  "impl",
  "mgr",
  "mgrs",
  "util",
  "utils",
  "helper",
  "helpers",
  "src",
  "core",
  "server",
  "client",
  "common",
  "base"
]);

function splitCamelAndSnake(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function pushTokens(set: Set<string>, tokens: string[], minLen: number): void {
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized.length < minLen) {
      continue;
    }
    if (STOP_WORDS.has(normalized)) {
      continue;
    }
    set.add(normalized);
  }
}

function collectLowInfoTags(filePath: string, symbolId: string, baseTags: string[]): Set<string> {
  const lowInfo = new Set<string>();
  for (const tag of baseTags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized) {
      lowInfo.add(normalized);
    }
  }

  const pathParts = filePath.split(/[\\/]+/);
  for (const part of pathParts) {
    const normalized = part.replace(/\.[a-z0-9]+$/i, "");
    for (const token of splitCamelAndSnake(normalized)) {
      if (token) {
        lowInfo.add(token.toLowerCase());
      }
    }
  }

  const symbolParts = symbolId.split("::");
  for (const part of symbolParts) {
    for (const token of splitCamelAndSnake(part)) {
      if (token) {
        lowInfo.add(token.toLowerCase());
      }
    }
  }

  return lowInfo;
}

export function inferBaseTagsForSymbol(params: {
  moduleId?: string;
  pathModuleHint?: string;
  filePath: string;
  symbolId: string;
  brief?: string;
}): string[] {
  const { moduleId, pathModuleHint, filePath, symbolId } = params;
  const tags = new Set<string>();

  if (pathModuleHint) {
    const parts = pathModuleHint.split(/[\\/]+/);
    pushTokens(tags, parts, 2);
  }

  if (moduleId) {
    pushTokens(tags, splitCamelAndSnake(moduleId), 2);
  }

  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    const dirParts = dir.split(/[\\/]+/);
    pushTokens(tags, dirParts, 2);
  }

  const base = path.basename(filePath, path.extname(filePath));
  pushTokens(tags, splitCamelAndSnake(base), 2);

  const symbolParts = symbolId.split("::");
  for (const part of symbolParts) {
    pushTokens(tags, splitCamelAndSnake(part), 3);
  }

  const limited = Array.from(tags);
  return limited.slice(0, 8);
}

export function filterSemanticTags(params: {
  semanticTags: string[];
  baseTags: string[];
  filePath: string;
  symbolId: string;
}): string[] {
  const { semanticTags, baseTags, filePath, symbolId } = params;
  const lowInfo = collectLowInfoTags(filePath, symbolId, baseTags);
  const filtered: string[] = [];
  const seen = new Set<string>();

  for (const tag of semanticTags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || normalized.length < 3) {
      continue;
    }
    if (STOP_WORDS.has(normalized)) {
      continue;
    }
    if (lowInfo.has(normalized)) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    filtered.push(normalized);
    if (filtered.length >= 5) {
      break;
    }
  }

  return filtered;
}
