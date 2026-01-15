import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

export type Meta = {
  [relativePath: string]: {
    hash: string;
    skillDoc: string;
    lastUpdated: string;
  };
};

const META_FILENAME = ".meta.json";

export async function loadMeta(indexRoot: string): Promise<Meta> {
  const metaPath = path.join(indexRoot, META_FILENAME);
  try {
    const content = await readFile(metaPath, "utf8");
    return JSON.parse(content) as Meta;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveMeta(indexRoot: string, meta: Meta): Promise<void> {
  const metaPath = path.join(indexRoot, META_FILENAME);
  await mkdir(indexRoot, { recursive: true });
  const content = JSON.stringify(meta, null, 2);
  await writeFile(metaPath, content, "utf8");
}
