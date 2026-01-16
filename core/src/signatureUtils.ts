import { createHash } from "crypto";

export function normalizeSignature(signature: string): string {
  return signature
    .replace(/\s+/g, " ")
    .replace(/\s*([(),*&<>:=])\s*/g, "$1")
    .trim();
}

export function hashSignature(signature: string): string {
  const normalized = normalizeSignature(signature);
  return createHash("sha1").update(normalized).digest("hex");
}
