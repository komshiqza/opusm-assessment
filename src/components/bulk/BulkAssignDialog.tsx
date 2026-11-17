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
import { BULK_LIMIT, bulkAssign, recheckBulk, retryBulk, type BulkResult } from "@/lib/skills/bulk";
import { effectiveStartDate, validateValidity } from "@/lib/domain/validation";
import { toUserMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useToday } from "@/hooks/useToday";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import type { Person } from "@/lib/skills/types";
import { useToast } from "@/components/common/Toast";
import { mergeResults, planBulk } from "./bulkPlan";
import styles from "./BulkAssignDialog.module.css";
import { t, tn } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/messages";

interface BulkAssignDialogProps {
  /** The persons shown in the matrix right now (current filters and "Show" choice). */
  persons: Person[];
  state: SkillDataState;
  onClose: () => void;
}

const RESULT_LINE: Record<BulkResult["result"], { icon: string; color: string; text: MessageKey }> = {
  assigned: { icon: "sys-enter-2", color: "var(--sapPositiveTextColor)", text: "bulk.assigned" },
  skipped: { icon: "less", color: "var(--sapContent_LabelColor)", text: "bulk.skipped" },
  failed: { icon: "error", color: "var(--sapNegativeTextColor)", text: "bulk.failed" },
  unconfirmed: { icon: "alert", color: "var(--sapCriticalTextColor)", text: "bulk.unconfirmed" },
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
  const describe = (p: Person) => p.jobTitle ?? undefined;
  const nameOf = (personId: string) => persons.find((p) => p.id === personId)?.name ?? personId;
  /** The person's refId: creates read the person's records fresh (new ones go to the main record, any record counts). */
  const refIdOf = (personId: string) => persons.find((p) => p.id === personId)?.refId ?? personId;

  const run = async (work: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
      setProgress("Refreshing…");
      if (!(await state.reload())) setError(t("bulk.notRefreshed"));
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
      // Also the persons shown as having the skill: FSM decides, and skips them without a write.
      const done = await bulkAssign(definition.id, plan.send, input, (i, total) => setProgress(t("bulk.progress", { i: i + 1, total })), refIdOf);
      setResults(done);
      const assigned = done.filter((r) => r.result === "assigned").length;
      if (assigned) toast(tn("bulk.toastAssigned", assigned, { skill: definition.name }));
    });

  const retryFailed = () =>
    run(async () => {
      if (!definition || !results) return;
      setProgress(t("bulk.tryingAgain"));
      setResults(mergeResults(results, await retryBulk(definition.id, results.filter((r) => r.result === "failed"), input, refIdOf)));
    });

  const checkAgain = () =>
    run(async () => {
      if (!definition || !results) return;
      setProgress(t("common.checkingFsm"));
      setResults(mergeResults(results, await recheckBulk(definition.id, results.filter((r) => r.result === "unconfirmed"), refIdOf)));
    });

  const failedCount = results?.filter((r) => r.result === "failed").length ?? 0;
  const unconfirmedCount = results?.filter((r) => r.result === "unconfirmed").length ?? 0;

  return (
    <Dialog
      open
      headerText={t("bulk.title")}
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
                  {plan.toAssign.length ? t("bulk.assignTo", { n: plan.toAssign.length }) : t("common.assign")}
                </Button>
              )}
              <Button design="Transparent" onClick={() => !operationRef.current && onClose()} disabled={busy}>
                {results ? t("common.close") : t("common.cancel")}
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
              {t("bulk.period", {
                skill: definition?.name ?? "",
                from: formatDate(input.startDate ?? today),
                to: input.endDate ? formatDate(input.endDate) : t("bulk.noEnd"),
              })}
            </Text>
            <ul className={styles.results}>
              {results.map((r) => (
                <li key={r.personId} title={r.error}>
                  <Icon name={RESULT_LINE[r.result].icon} className={styles.icon} style={{ color: RESULT_LINE[r.result].color }} />
                  <span>
                    <b>{nameOf(r.personId)}</b> · {t(RESULT_LINE[r.result].text)}
                    {r.result === "failed" && r.error && !r.checkFirst ? `: ${r.error}` : ""}
                    {r.error && <span className={styles.srOnly}> {t("common.details")}: {r.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              {failedCount > 0 && (
                <Button icon="refresh" onClick={retryFailed} disabled={busy}>
                  {t("bulk.retry", { n: failedCount })}
                </Button>
              )}
              {unconfirmedCount > 0 && (
                <Button icon="refresh" onClick={checkAgain} disabled={busy}>
                  {t("bulk.checkAgain", { n: unconfirmedCount })}
                </Button>
              )}
            </div>
            {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.field}>
              <Label for="bulk-skill" required showColon>
                {t("common.skill")}
              </Label>
              <Select id="bulk-skill" value={skillId} onChange={(e) => setSkillId(e.detail.selectedOption.value ?? "")}>
                <Option value="">{t("bulk.chooseSkill")}</Option>
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
                  {t("assign.level")}
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
                  {t("common.validFrom")}
                </Label>
                <DatePicker
                  id="bulk-from"
                  value={from}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder={t("assign.fromPlaceholder", { date: formatDate(today) })}
                  onChange={(e) => setFrom(e.target.value ?? "")}
                />
              </div>
              <div className={styles.field}>
                <Label for="bulk-to" showColon>
                  {t("common.validTo")}
                </Label>
                <DatePicker
                  id="bulk-to"
                  value={to}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder={t("assign.toPlaceholder")}
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
              <Label showColon>{t("bulk.persons")}</Label>
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
                    description={describe(p)}
                    additionalText={hasSkill(p.id) ? t("bulk.alreadyHas") : undefined}
                  >
                    {p.name}
                  </ListItemStandard>
                ))}
              </List>
            </div>
            <MessageStrip design={plan.overLimit ? "Negative" : "Information"} hideCloseButton>
              {!definition
                ? t("bulk.chooseFirst")
                : plan.overLimit
                  ? t("bulk.overLimit", { max: BULK_LIMIT, n: plan.send.length })
                  : t("bulk.preview", { n: plan.toAssign.length, skip: plan.skip.length })}
            </MessageStrip>
            {error && <MessageStrip design="Negative" hideCloseButton>{error}</MessageStrip>}
          </div>
        )}
      </BusyIndicator>
    </Dialog>
  );
}
