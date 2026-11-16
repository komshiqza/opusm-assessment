"use client";

import { useRef, useState } from "react";
import {
  Bar,
  BusyIndicator,
  Button,
  DatePicker,
  Dialog,
  Icon,
  Label,
  List,
  ListItemStandard,
  MessageStrip,
  Option,
  SegmentedButton,
  SegmentedButtonItem,
  Select,
  Text,
} from "@ui5/webcomponents-react";
import { BULK_LIMIT, bulkAssign, recheckBulk, retryBulk, type BulkResult } from "@/lib/skills/repository";
import { effectiveStartDate, validateValidity } from "@/lib/domain/validation";
import { toUserMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useToday } from "@/hooks/useToday";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import type { Person } from "@/lib/skills/types";
import { useToast } from "@/components/common/Toast";
import { mergeResults, planBulk } from "./bulkPlan";
import styles from "./BulkAssignDialog.module.css";

interface BulkAssignDialogProps {
  /** The persons shown in the matrix right now (current filters and "Show" choice). */
  persons: Person[];
  state: SkillDataState;
  onClose: () => void;
}

const RESULT_LINE: Record<BulkResult["result"], { icon: string; color: string; text: string }> = {
  assigned: { icon: "sys-enter-2", color: "var(--sapPositiveTextColor)", text: "Assigned" },
  skipped: { icon: "less", color: "var(--sapContent_LabelColor)", text: "Skipped: already has it" },
  failed: { icon: "error", color: "var(--sapNegativeTextColor)", text: "Not assigned" },
  unconfirmed: { icon: "alert", color: "var(--sapCriticalTextColor)", text: "Couldn’t confirm" },
};

/**
 * One skill to several persons at once (at most 25 per action): skill, level and validity are set
 * once, persons who already have the skill are skipped. No certificates here; they stay per person.
 */
export function BulkAssignDialog({ persons, state, onClose }: BulkAssignDialogProps) {
  const toast = useToast();
  const today = useToday();
  const definitions = state.data?.definitions ?? [];
  const levels = state.data?.scale?.levels ?? [];
  const [skillId, setSkillId] = useState("");
  const [levelId, setLevelId] = useState(levels.find((l) => l.isDefault)?.id ?? levels[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Synchronous lock, like the assignment dialog: a second click cannot start a second run. */
  const operationRef = useRef(false);

  const definition = definitions.find((d) => d.id === skillId);
  const definitionLevels = definition && state.data?.scale && definition.scaleId === state.data.scale.id ? levels : [];
  const hasSkill = (personId: string) => Boolean(skillId && state.assignmentByCell.has(cellKey(personId, skillId)));
  const plan = planBulk(selected, hasSkill);
  const dateError = validateValidity(effectiveStartDate(from || null, today), to || null);
  const input = { startDate: from || null, endDate: to || null, proficiencyId: definitionLevels.length ? levelId || null : null };
  const nameOf = (personId: string) => persons.find((p) => p.id === personId)?.name ?? personId;

  const run = async (work: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      setProgress("Refreshing…");
      if (!(await state.reload())) setError("The assignments are saved, but the list could not be refreshed from FSM. Close this dialog and use “Try again” on the page.");
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      operationRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const assign = () =>
    run(async () => {
      if (!definition || dateError || plan.toAssign.length === 0 || plan.overLimit) return;
      const done = await bulkAssign(definition.id, plan.toAssign, input, (i, total) => setProgress(`Assigning ${i + 1} of ${total}…`));
      setResults([...done, ...plan.skip.map((personId): BulkResult => ({ personId, result: "skipped" }))]);
      const assigned = done.filter((r) => r.result === "assigned").length;
      if (assigned) toast(`${definition.name} assigned to ${assigned} person${assigned > 1 ? "s" : ""}`);
    });

  const retryFailed = () =>
    run(async () => {
      if (!definition || !results) return;
      setProgress("Trying again…");
      setResults(mergeResults(results, await retryBulk(definition.id, results.filter((r) => r.result === "failed"), input)));
    });

  const checkAgain = () =>
    run(async () => {
      if (!definition || !results) return;
      setProgress("Checking in FSM…");
      setResults(mergeResults(results, await recheckBulk(definition.id, results.filter((r) => r.result === "unconfirmed"))));
    });

  const failedCount = results?.filter((r) => r.result === "failed").length ?? 0;
  const unconfirmedCount = results?.filter((r) => r.result === "unconfirmed").length ?? 0;

  return (
    <Dialog
      open
      headerText="Assign a skill to several persons"
      onBeforeClose={(e) => (busy || operationRef.current) && e.preventDefault()}
      onClose={onClose}
      className={styles.dialog}
      footer={
        <Bar
          design="Footer"
          startContent={progress ? <Text className={styles.muted}>{progress}</Text> : undefined}
          endContent={
            <>
              {!results && (
                <Button
                  design="Emphasized"
                  onClick={assign}
                  disabled={busy || !definition || Boolean(dateError) || plan.toAssign.length === 0 || plan.overLimit}
                >
                  {plan.toAssign.length ? `Assign to ${plan.toAssign.length}` : "Assign"}
                </Button>
              )}
              <Button design="Transparent" onClick={() => !operationRef.current && onClose()} disabled={busy}>
                {results ? "Close" : "Cancel"}
              </Button>
            </>
          }
        />
      }
    >
      <BusyIndicator active={busy} delay={0} style={{ display: "block" }}>
        {results ? (
          <div className={styles.body}>
            <Text>
              {definition?.name}: {formatDate(input.startDate ?? today)} – {input.endDate ? formatDate(input.endDate) : "no end date"}
            </Text>
            <ul className={styles.results}>
              {results.map((r) => (
                <li key={r.personId} title={r.error}>
                  <Icon name={RESULT_LINE[r.result].icon} className={styles.icon} style={{ color: RESULT_LINE[r.result].color }} />
                  <span>
                    <b>{nameOf(r.personId)}</b> · {RESULT_LINE[r.result].text}
                    {r.result === "failed" && r.error && !r.checkFirst ? `: ${r.error}` : ""}
                    {r.error && <span className={styles.srOnly}> Details: {r.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              {failedCount > 0 && (
                <Button icon="refresh" onClick={retryFailed} disabled={busy}>
                  Try again for {failedCount}
                </Button>
              )}
              {unconfirmedCount > 0 && (
                <Button icon="refresh" onClick={checkAgain} disabled={busy}>
                  Check again for {unconfirmedCount}
                </Button>
              )}
            </div>
            {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.field}>
              <Label for="bulk-skill" required showColon>
                Skill
              </Label>
              <Select id="bulk-skill" value={skillId} onChange={(e) => setSkillId(e.detail.selectedOption.value ?? "")}>
                <Option value="">Choose a skill</Option>
                {definitions.map((d) => (
                  <Option key={d.id} value={d.id}>
                    {d.name}
                  </Option>
                ))}
              </Select>
            </div>
            {definitionLevels.length > 0 && (
              <div className={styles.field}>
                <Label id="bulk-level-label" showColon>
                  Proficiency level
                </Label>
                <SegmentedButton accessibleNameRef="bulk-level-label" onSelectionChange={(e) => setLevelId(e.detail.selectedItems[0]?.dataset.id ?? "")}>
                  {definitionLevels.map((l) => (
                    <SegmentedButtonItem key={l.id} data-id={l.id} selected={levelId === l.id}>
                      {l.name}
                    </SegmentedButtonItem>
                  ))}
                </SegmentedButton>
              </div>
            )}
            <div className={styles.dates}>
              <div className={styles.field}>
                <Label for="bulk-from" showColon>
                  Valid from
                </Label>
                <DatePicker
                  id="bulk-from"
                  value={from}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder={`Today (${formatDate(today)}) if empty`}
                  onChange={(e) => setFrom(e.target.value ?? "")}
                />
              </div>
              <div className={styles.field}>
                <Label for="bulk-to" showColon>
                  Valid to
                </Label>
                <DatePicker
                  id="bulk-to"
                  value={to}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder="No end date if empty"
                  valueState={dateError ? "Negative" : "None"}
                  onChange={(e) => setTo(e.target.value ?? "")}
                />
              </div>
            </div>
            {dateError && (
              <MessageStrip design="Negative" hideCloseButton>
                {dateError}
              </MessageStrip>
            )}
            <div className={styles.field}>
              <Label showColon>Persons (from the matrix as filtered now)</Label>
              <List
                selectionMode="Multiple"
                className={styles.persons}
                onSelectionChange={(e) => setSelected(e.detail.selectedItems.map((item) => String(item.dataset.id)))}
              >
                {persons.map((p) => (
                  <ListItemStandard
                    key={p.id}
                    data-id={p.id}
                    selected={selected.includes(p.id)}
                    description={p.jobTitle ?? undefined}
                    additionalText={hasSkill(p.id) ? "Already has it" : undefined}
                  >
                    {p.name}
                  </ListItemStandard>
                ))}
              </List>
            </div>
            <MessageStrip design={plan.overLimit ? "Negative" : "Information"} hideCloseButton>
              {!definition
                ? "Choose a skill and the persons."
                : plan.overLimit
                  ? `At most ${BULK_LIMIT} persons at once (selected to assign: ${plan.toAssign.length}).`
                  : `Assign to ${plan.toAssign.length}, skip ${plan.skip.length} who already ${plan.skip.length === 1 ? "has" : "have"} it. No certificates here: add them per person afterwards.`}
            </MessageStrip>
            {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
          </div>
        )}
      </BusyIndicator>
    </Dialog>
  );
}
