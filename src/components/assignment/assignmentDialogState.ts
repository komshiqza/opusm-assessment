import { t } from "@/lib/i18n/t";

/**
 * The Person record the dialog works on, fixed when it opens: the record asked for, else the record of
 * the assignment the cell shows, else (a new assignment) the person's main record. After a reload the
 * dialog keeps to this record and never switches to another record's assignment of the same skill.
 */
export function pinnedRecordId(recordId: string | undefined, shown: { personId: string } | undefined, mainRecordId: string): string {
  return recordId ?? shown?.personId ?? mainRecordId;
}

/**
 * The main button of the assignment dialog. The list (and so `listed`) can be out of date when a
 * reload after a write failed, so the dialog also remembers what it did itself.
 */
export function primaryAction({
  listed,
  createdId,
  removed,
  savedWaitingForRefresh = false,
  createUnconfirmed = false,
}: {
  /** the loaded list shows this assignment */
  listed: boolean;
  /** id of the assignment this dialog created */
  createdId: string | null;
  /** this dialog removed the assignment */
  removed: boolean;
  /** a save is done and the dialog closes once the list is refreshed: editing more would be lost */
  savedWaitingForRefresh?: boolean;
  /** a create FSM answered too late for, and the check could not tell whether it arrived */
  createUnconfirmed?: boolean;
}): "assign" | "save" | "none" {
  if (removed || savedWaitingForRefresh) return "none";
  if (!listed && createUnconfirmed) return "none";
  if (listed) return "save";
  return createdId ? "none" : "assign";
}

/**
 * Level selected when the dialog opens. An assignment keeps its own level, also "none": FSM keeps a
 * level that is not sent, so saving only a date never changes it. A new assignment starts with the
 * scale's default level (FSM would set it anyway).
 */
export function initialLevelId(
  assignment: { proficiencyId: string | null } | undefined,
  levels: { id: string; isDefault: boolean }[],
): string {
  if (assignment) return assignment.proficiencyId ?? "";
  return levels.find((l) => l.isDefault)?.id ?? levels[0]?.id ?? "";
}

/**
 * The level buttons. UI5's SegmentedButton always selects one button (the first, if none is marked),
 * so an assignment stored without a level gets an explicit "No level" button (id ""): the dialog then
 * shows what is stored, and "" is not sent, so FSM keeps it.
 */
export function levelChoices<L extends { id: string; name: string }>(
  assignment: { proficiencyId: string | null } | undefined,
  levels: L[],
): { id: string; name: string }[] {
  return assignment && !assignment.proficiencyId ? [{ id: "", name: t("assign.noLevelOption") }, ...levels] : levels;
}

/**
 * The level Save sends. A picked level is sent. "No level" is sent as null (clears it) only when the
 * user picked it; untouched, nothing is sent and FSM keeps what it has. Without this, picking "No
 * level" after a save whose reload failed (the dialog still shows the old, level-less state) would
 * leave the just-saved level in FSM.
 */
export function levelToSend(levelId: string, touched: boolean): string | null | undefined {
  if (levelId) return levelId;
  return touched ? null : undefined;
}

/** After "Refresh list" works: close only when the save was the last step and no picked file is still waiting. */
export function closeAfterRefresh(notRefreshed: { close: boolean } | null, pendingFileCount: number): boolean {
  return Boolean(notRefreshed?.close) && pendingFileCount === 0;
}
