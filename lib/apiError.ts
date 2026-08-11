import { z } from "zod";

// Turns a caught error into a client-safe message. ZodError.message is a raw JSON array of
// issue objects — readable to a developer, meaningless (or misleading, via generic Error
// handling) to a user — so it's reformatted into a plain "field: problem" sentence.
export function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) {
    return error.issues.map(i => `${i.path.join(".") || "field"}: ${i.message}`).join("; ");
  }
  return error instanceof Error ? error.message : fallback;
}
