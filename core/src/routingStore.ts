import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export type RoutingJson = {
  modules: {
    [moduleName: string]: string;
  };
  symbols: {
    [symbolId: string]: {
      module: string;
      declHash: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      tags?: string[];
    };
  };
};

export function buildRoutingFromModules(
  moduleEntries: Record<
    string,
    Array<{
      id: string;
      declHash: string;
      declLine?: number;
      implLine?: number;
      filePath?: string;
      tags?: string[];
    }>
  >
): RoutingJson {
  const routing: RoutingJson = { modules: {}, symbols: {} };

  for (const [moduleName, entries] of Object.entries(moduleEntries)) {
    routing.modules[moduleName] = `./modules/${moduleName}.md`;
    for (const entry of entries) {
      routing.symbols[entry.id] = {
        module: moduleName,
        declHash: entry.declHash,
        declLine: entry.declLine,
        implLine: entry.implLine,
        filePath: entry.filePath,
        tags: entry.tags
      };
    }
  }

  return routing;
}

export async function loadRouting(indexRoot: string): Promise<RoutingJson> {
  const routingPath = path.join(indexRoot, "routing.json");
  try {
    const content = await readFile(routingPath, "utf8");
    return JSON.parse(content) as RoutingJson;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { modules: {}, symbols: {} };
    }
    throw error;
  }
}

export async function saveRouting(indexRoot: string, routing: RoutingJson): Promise<void> {
  const routingPath = path.join(indexRoot, "routing.json");
  await mkdir(indexRoot, { recursive: true });
  const content = JSON.stringify(routing, null, 2);
  await writeFile(routingPath, content, "utf8");
}
