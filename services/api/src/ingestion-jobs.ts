import { createHash } from "node:crypto";

export function noteIngestionRequestKey(path: string, body: string): string {
  return createHash("sha256")
    .update(path)
    .update("\0")
    .update(body)
    .digest("hex");
}
