import path from "path";

export function mapModuleName(relativePath: string): string {
  const base = path.basename(relativePath);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  return name || "core";
}
