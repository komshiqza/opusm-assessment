import { FsmError, FsmTimeoutError } from "@/lib/fsm/client";
import { t } from "@/lib/i18n/t";

/** Turns any thrown error into a sentence for the user (FSM's own message is kept). */
export function toUserMessage(error: unknown): string {
  if (error instanceof FsmTimeoutError) return error.message;
  if (error instanceof FsmError) {
    if (error.message.startsWith("CA-198")) {
      return t("fsm.fileTooLarge", { message: error.message });
    }
    const code = (error.data as { code?: string } | undefined)?.code;
    return t("fsm.error", { status: error.status ? ` ${error.status}` : "", code: code ? ` (${code})` : "", message: error.message });
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
