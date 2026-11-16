import { FsmError, FsmTimeoutError } from "@/lib/fsm/client";

/** Turns any thrown error into a sentence for the user (FSM's own message is kept). */
export function toUserMessage(error: unknown): string {
  if (error instanceof FsmTimeoutError) return error.message;
  if (error instanceof FsmError) {
    if (error.message.startsWith("CA-198")) {
      return `FSM rejected the file: it is larger than this FSM company allows for attachments. (${error.message})`;
    }
    const code = (error.data as { code?: string } | undefined)?.code;
    return `FSM error${error.status ? ` ${error.status}` : ""}${code ? ` (${code})` : ""}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
