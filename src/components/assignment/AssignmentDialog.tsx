"use client";

import { useRef, useState } from "react";
import { Bar, BusyIndicator, Button, DatePicker, Dialog, FileUploader, Label, MessageStrip, SegmentedButton, SegmentedButtonItem, Text } from "@ui5/webcomponents-react";
import { getAssignmentStatus } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { effectiveStartDate, validityProblem } from "@/lib/domain/validation";
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_LABEL, splitCertificateFiles } from "@/lib/domain/certificateRules";
import {
  checkAssignmentCreated,
  createAssignmentWithCertificates,
  deleteAssignment,
  recheckUploads,
  retryItems,
  updateAssignment,
  uploadCertificates,
} from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import { FsmTimeoutError } from "@/lib/fsm/client";
import { formatDate, formatFileSize, formatPersonType } from "@/lib/format";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { STATUS_DISPLAY, statusText } from "@/components/matrix/statusDisplay";
import { CertificateSection } from "./CertificateSection";
import { closeAfterRefresh, initialLevelId, levelChoices, levelToSend, primaryAction } from "./assignmentDialogState";
import { EMPTY_RESULTS, applyOutcome, createResultLine, type UploadResults } from "./uploadResults";
import { ResultStrip, UploadResultNotes } from "./UploadResultNotes";
import styles from "./AssignmentDialog.module.css";
import { t, tn } from "@/lib/i18n/t";

interface AssignmentDialogProps {
  person: Person;
  definition: SkillDefinition;
  state: SkillDataState;
  onClose: () => void;
}

/** Assign a skill, change level and validity, remove it, and manage its certificates. */
export function AssignmentDialog({ person, definition, state, onClose }: AssignmentDialogProps) {
  const toast = useToast();
  const listedAssignment = state.assignmentByCell.get(cellKey(person.id, definition.id));
  /** Set when this dialog removed the assignment; the list may still show it if the reload failed. */
  const [removed, setRemoved] = useState(false);
  const assignment = removed ? undefined : listedAssignment;
  const certificates = assignment ? (state.certificatesBySkill.get(assignment.id) ?? []) : [];
  const scale = state.data?.scale;
  const levels = scale && definition.scaleId === scale.id ? scale.levels : [];
  const today = useToday();

  /** "" = no level: only for an assignment stored without one; it is then not sent, so FSM keeps it. */
  const [levelId, setLevelId] = useState(() => initialLevelId(assignment, levels));
  /** The user picked a level button (also "No level"): only then is a cleared level sent. */
  const [levelTouched, setLevelTouched] = useState(false);
  const [from, setFrom] = useState(assignment?.startDate ?? "");
  const [to, setTo] = useState(assignment?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  /**
   * One synchronous lock for every operation of this dialog and its certificate section (save,
   * retry, checking picked files, uploading, deleting a certificate). Checked instantly by Save,
   * Retry, Remove, Cancel and closing, so nothing can slip in before React has re-rendered the
   * disabled buttons.
   */
  const operationRef = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** New assignment: certificates picked before saving, uploaded right after the assignment exists. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pickProblems, setPickProblems] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  /** Upload results of save and retry: confirmed late, not uploaded (Try again), not confirmed (Check again). */
  const [uploadResults, setUploadResults] = useState<UploadResults>(EMPTY_RESULTS);
  const { failed } = uploadResults;
  /**
   * A create FSM answered too late for, and what the check in FSM found: "done" (it is there),
   * "notDone" (it is not: Assign may be used again), "unconfirmed" (only Check again).
   */
  const [createCheck, setCreateCheck] = useState<{ result: "done" | "notDone" | "unconfirmed"; error?: string } | null>(null);
  /** Id of the assignment this dialog just created; retry must not depend on a successful reload. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const assignmentId = assignment?.id ?? createdId;
  /**
   * A write succeeded but the reload after it failed: the list behind the dialog is out of date.
   * `close`: the dialog closes once the list is refreshed (the save itself is done).
   */
  const [notRefreshed, setNotRefreshed] = useState<{ done: string; close: boolean } | null>(null);
  const action = primaryAction({
    listed: Boolean(listedAssignment),
    createdId,
    removed,
    savedWaitingForRefresh: notRefreshed?.close,
    createUnconfirmed: createCheck?.result === "unconfirmed",
  });
  /** Certificate uploads running: the assignment must not be removed or the dialog closed meanwhile. */
  const [uploading, setUploading] = useState(false);
  /** Picked files are being checked (first bytes): Save must wait, or they would be left out. */
  const [inspecting, setInspecting] = useState(false);
  const locked = busy || uploading || inspecting;
  /** The form is read-only while running, and after a save that only waits for the list (edits would be lost). */
  const formLocked = locked || Boolean(notRefreshed?.close);

  // The picker's value is always in valueFormat (YYYY-MM-DD) or, if the user typed nonsense, that text.
  // Our own validation decides; the picker's `valid` flag is unreliable with a custom displayFormat.
  const dateProblem = validityProblem(effectiveStartDate(from || null, today), to || null);
  const dateError = dateProblem?.message ?? null;
  const fromInvalid = dateProblem?.field === "from";
  const toInvalid = dateProblem?.field === "to";

  /** Runs one save or retry at a time and keeps the dialog locked meanwhile. */
  const runLocked = async (work: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(toUserMessage(e));
      // FSM did not answer a write: it may have saved it. Show what FSM has now instead of inviting a blind retry.
      if (e instanceof FsmTimeoutError && e.write) await state.reload();
    } finally {
      operationRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const showProgress = (file: File, index: number, total: number) => setProgress(t("assign.uploading", { name: file.name, i: index + 1, total }));

  const save = () =>
    runLocked(async () => {
      if (dateError) return;
      const input = { startDate: from || null, endDate: to || null, proficiencyId: levelToSend(levelId, levelTouched) };
      if (assignment) {
        setProgress("Saving…");
        await updateAssignment(assignment.id, input);
        // Files picked before a create whose answer timed out: the reload found the assignment, so upload them now.
        const outcome = pendingFiles.length ? await uploadCertificates(assignment.id, pendingFiles, showProgress) : null;
        if (outcome) {
          setPendingFiles([]);
          setUploadResults((current) => applyOutcome(current, outcome, null));
        }
        const allUploaded = !outcome || (outcome.failed.length === 0 && outcome.unconfirmed.length === 0);
        setProgress("Refreshing…");
        if (!(await state.reload())) {
          setNotRefreshed({ done: t("assign.doneSaved"), close: allUploaded });
          return;
        }
        if (!allUploaded) return;
        toast(outcome?.uploaded.length ? t("assign.savedWith", { n: outcome.uploaded.length }) : t("assign.saved"));
        onClose();
        return;
      }
      // An earlier create timed out and was not in FSM: make sure it did not arrive late before creating again.
      if (createCheck?.result === "notDone" && (await checkCreate())) return;
      setProgress("Assigning…");
      let result: Awaited<ReturnType<typeof createAssignmentWithCertificates>>;
      try {
        result = await createAssignmentWithCertificates(definition.id, person.id, input, pendingFiles, showProgress);
      } catch (e) {
        // FSM did not answer the create: look once whether it arrived. Never created again by itself.
        if (e instanceof FsmTimeoutError && e.write) {
          await checkCreate();
          return;
        }
        throw e;
      }
      setCreateCheck(null);
      setCreatedId(result.assignment.id);
      setPendingFiles([]);
      setUploadResults((current) => applyOutcome(current, result, null));
      setProgress("Refreshing…");
      const refreshed = await state.reload();
      const count = result.uploaded.length;
      const allUploaded = result.failed.length === 0 && result.unconfirmed.length === 0;
      if (!refreshed) setNotRefreshed({ done: t("assign.doneAssigned"), close: allUploaded });
      if (allUploaded && refreshed) {
        toast(count ? tn("assign.assignedWith", count, { skill: definition.name, person: person.name }) : t("assign.assignedTo", { skill: definition.name, person: person.name }));
        onClose();
      }
      // Otherwise the assignment exists and the dialog stays open with the files that still need attention.
    });

  /**
   * After a create FSM answered too late for: one read-only look in FSM. Returns true when the create
   * is settled for now (it is there, or the check could not tell), false when it is not in FSM.
   */
  const checkCreate = async (): Promise<boolean> => {
    setProgress(t("assign.checkingCreate"));
    const check = await checkAssignmentCreated(definition.id, person.id);
    if (check.result === "notDone") {
      setCreateCheck({ result: "notDone" });
      return false;
    }
    if (check.result === "unconfirmed") {
      setCreateCheck({ result: "unconfirmed", error: check.error });
      return true;
    }
    setCreatedId(check.value.id);
    setCreateCheck({ result: "done" });
    setProgress("Refreshing…");
    if (!(await state.reload())) setNotRefreshed({ done: t("assign.doneAssigned"), close: pendingFiles.length === 0 });
    return true;
  };

  const checkCreateAgain = () => runLocked(async () => void (await checkCreate()));

  /** Try again for the files that are not in FSM; a timed-out one is checked first, never sent twice. */
  const retryFailed = (file: File) =>
    runLocked(async () => {
      if (!assignmentId) return;
      const outcome = await uploadCertificates(assignmentId, retryItems(failed.filter((f) => f.file === file)), showProgress);
      setUploadResults((current) => applyOutcome(current, outcome, [file]));
      setProgress("Refreshing…");
      if (!(await state.reload())) {
        setNotRefreshed({ done: outcome.uploaded.length ? t("assign.doneUploaded") : t("assign.doneUploadFinished"), close: false });
        return;
      }
      if (outcome.uploaded.length) toast(t("assign.uploadedOne", { name: file.name })); // only this file: others may still need attention
    });

  /** Check again for uploads that could not be confirmed. Reads only. */
  const checkUploadsAgain = (file: File) =>
    runLocked(async () => {
      if (!assignmentId) return;
      setProgress(t("common.checkingFsm"));
      const outcome = await recheckUploads(assignmentId, uploadResults.unconfirmed.filter((u) => u.file === file));
      setUploadResults((current) => applyOutcome(current, outcome, [file]));
      if (outcome.uploaded.length && !(await state.reload())) setNotRefreshed({ done: t("assign.doneUploaded"), close: false });
    });

  /** Retries the reload after a write; closes the dialog when the write was the last step. */
  const refreshList = () =>
    runLocked(async () => {
      if (!(await state.reload())) throw new Error(t("assign.stillNotRefreshed"));
      const closeNow = closeAfterRefresh(notRefreshed, pendingFiles.length);
      setNotRefreshed(null);
      if (closeNow) {
        toast(t("assign.listRefreshed"));
        onClose();
      }
    });

  const pickFiles = async (files: File[]) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setInspecting(true);
    setProgress(t("assign.checkingFiles"));
    try {
      const { valid, problems } = await splitCertificateFiles(files);
      setPickProblems(problems);
      // No automatic de-duplication: two different files can share name and size. Every picked file is listed and can be removed.
      setPendingFiles((current) => [...current, ...valid]);
    } catch (e) {
      setPickProblems([toUserMessage(e)]);
    } finally {
      operationRef.current = false;
      setInspecting(false);
      setProgress(null);
      setPickerKey((k) => k + 1);
    }
  };

  const status = getAssignmentStatus(assignment, today);

  return (
    <>
      <Dialog
        open
        headerText={assignment ? t("assign.headerEdit", { skill: definition.name, person: person.name }) : t("assign.headerNew", { skill: definition.name })}
        onBeforeClose={(e) => (locked || operationRef.current) && e.preventDefault()}
        onClose={onClose}
        className={styles.dialog}
        footer={
          <Bar
            design="Footer"
            startContent={
              progress ? (
                <Text className={styles.muted}>{progress}</Text>
              ) : (
                assignment && (
                  <Button design="Transparent" icon="delete" onClick={() => !operationRef.current && setConfirmRemove(true)} disabled={locked}>
                    {t("assign.remove")}
                  </Button>
                )
              )
            }
            endContent={
              <>
                {action !== "none" && (
                  <Button design="Emphasized" onClick={save} disabled={locked || Boolean(dateError)}>
                    {action === "save"
                      ? pendingFiles.length
                        ? tn("assign.saveAndUpload", pendingFiles.length)
                        : t("common.save")
                      : pendingFiles.length
                        ? tn("assign.assignAndUpload", pendingFiles.length)
                        : t("common.assign")}
                  </Button>
                )}
                <Button design="Transparent" onClick={() => !operationRef.current && onClose()} disabled={locked}>
                  {failed.length || createdId || removed || notRefreshed ? t("common.close") : t("common.cancel")}
                </Button>
              </>
            }
          />
        }
      >
        <BusyIndicator active={busy} delay={0} style={{ display: "block" }}>
          <div className={styles.body}>
            <div className={styles.summary}>
              <Text>
                <b>{person.name}</b>
                {person.jobTitle || person.type ? ` · ${[person.jobTitle, formatPersonType(person.type)].filter(Boolean).join(" · ")}` : ""}
              </Text>
              {assignment && (
                <Text style={{ color: STATUS_DISPLAY[status].color, fontWeight: "bold" }}>
                  {STATUS_DISPLAY[status].label}: {statusText(status, assignment)}
                </Text>
              )}
            </div>

            {!removed && (
              <div className={styles.form}>
                {levels.length > 0 ? (
                  <div className={styles.formItem}>
                    <Label id="assignment-level-label" showColon>
                      {t("assign.level")}
                    </Label>
                    <SegmentedButton
                      accessibleNameRef="assignment-level-label"
                      className={styles.levels}
                      onSelectionChange={(e) => {
                        setLevelId(e.detail.selectedItems[0]?.dataset.id ?? "");
                        setLevelTouched(true);
                      }}
                    >
                      {levelChoices(assignment, levels).map((l) => (
                        <SegmentedButtonItem key={l.id || "none"} data-id={l.id} selected={levelId === l.id} disabled={formLocked}>
                          {l.name}
                        </SegmentedButtonItem>
                      ))}
                    </SegmentedButton>
                  </div>
                ) : (
                  <MessageStrip design="Information" hideCloseButton>
                    This skill has no proficiency scale, so no level can be set.
                  </MessageStrip>
                )}

                <div className={styles.formItem}>
                  <Label for="assignment-from" showColon>
                    {t("common.validFrom")}
                  </Label>
                  <DatePicker
                    id="assignment-from"
                    disabled={formLocked}
                    value={from}
                    valueFormat="yyyy-MM-dd"
                    displayFormat="dd.MM.yyyy"
                    placeholder={t("assign.fromPlaceholder", { date: formatDate(today) })}
                    valueState={fromInvalid ? "Negative" : "None"}
                    onChange={(e) => setFrom(e.target.value ?? "")}
                  />
                </div>

                <div className={styles.formItem}>
                  <Label for="assignment-to" showColon>
                    {t("common.validTo")}
                  </Label>
                  <DatePicker
                    id="assignment-to"
                    disabled={formLocked}
                    value={to}
                    valueFormat="yyyy-MM-dd"
                    displayFormat="dd.MM.yyyy"
                    placeholder={t("assign.toPlaceholder")}
                    valueState={toInvalid ? "Negative" : "None"}
                    onChange={(e) => setTo(e.target.value ?? "")}
                  />
                </div>
              </div>
            )}

            {dateError && !removed && (
              <MessageStrip design="Negative" hideCloseButton>
                {dateError}
                {!from && dateProblem?.kind === "beforeFrom" ? ` ${t("validation.emptyFromHint")}` : ""}
              </MessageStrip>
            )}
            {notRefreshed && (
              <MessageStrip design="Critical" hideCloseButton>
                {t("assign.notRefreshed", { done: notRefreshed.done })}{" "}
                <Button icon="refresh" onClick={refreshList} disabled={locked}>
                  {t("assign.refreshList")}
                </Button>
              </MessageStrip>
            )}
            {error && (
              <MessageStrip design="Negative" onClose={() => setError(null)}>
                {error}
              </MessageStrip>
            )}

            {createCheck && (
              <ResultStrip
                line={createResultLine(createCheck)}
                action={
                  createCheck.result === "notDone"
                    ? { text: t("result.tryAgain"), onClick: save }
                    : createCheck.result === "unconfirmed"
                      ? { text: t("result.checkAgain"), onClick: checkCreateAgain }
                      : undefined
                }
                locked={locked}
              />
            )}
            <UploadResultNotes results={uploadResults} onRetry={retryFailed} onCheckAgain={checkUploadsAgain} locked={locked} />

            {!removed && assignment && pendingFiles.length > 0 && (
              <MessageStrip design="Information" hideCloseButton>
                {t("assign.pending", { names: pendingFiles.map((f) => f.name).join(", ") })}{" "}
                <Button design="Transparent" onClick={() => setPendingFiles([])} disabled={locked}>
                  Don’t upload them
                </Button>
              </MessageStrip>
            )}
            {removed ? null : assignment ? (
              <CertificateSection
                assignmentId={assignment.id}
                certificates={certificates}
                onChanged={state.reload}
                onRefreshFailed={(done) => setNotRefreshed({ done, close: false })}
                onBusyChange={setUploading}
                operationRef={operationRef}
                locked={locked}
              />
            ) : (
              <section className={styles.certificates} aria-labelledby="new-certificates-title">
                <Label id="new-certificates-title">{t("assign.certificatesOptional")}</Label>
                {pendingFiles.length > 0 && (
                  <ul className={styles.certList}>
                    {pendingFiles.map((f, i) => (
                      <li key={i} className={styles.certItem}>
                        <span className={styles.certText}>
                          <span>{f.name}</span>
                          <span className={styles.muted}>{t("assign.uploadedWhenAssigned", { size: formatFileSize(f.size) })}</span>
                        </span>
                        <Button
                          design="Transparent"
                          icon="decline"
                          tooltip={t("assign.removeFile", { name: f.name })}
                          accessibleName={t("assign.removeFile", { name: f.name })}
                          disabled={formLocked}
                          onClick={() => setPendingFiles((current) => current.filter((c) => c !== f))}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.uploadRow}>
                  <FileUploader
                    key={pickerKey}
                    accept={CERTIFICATE_ACCEPT}
                    multiple
                    hideInput
                    disabled={formLocked}
                    onChange={(e) => void pickFiles(Array.from(e.detail.files ?? []))}
                  >
                    <Button icon="add" disabled={formLocked}>
                      {t("assign.chooseCertificates")}
                    </Button>
                  </FileUploader>
                  <Text className={styles.muted}>{t("assign.fileRules", { max: MAX_CERTIFICATE_LABEL })}</Text>
                </div>
                {pickProblems.length > 0 && (
                  <MessageStrip design="Negative" onClose={() => setPickProblems([])}>
                    {pickProblems.join(" · ")}
                  </MessageStrip>
                )}
              </section>
            )}
          </div>
        </BusyIndicator>
      </Dialog>

      {assignment && (
        <ConfirmDialog
          open={confirmRemove}
          title={t("assign.removeTitle")}
          confirmText={t("assign.removeButton")}
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            // Same lock as Save and the certificate actions: nothing else may run during the removal.
            if (operationRef.current) throw new Error(t("assign.busy"));
            operationRef.current = true;
            setBusy(true);
            try {
              try {
                await deleteAssignment(assignment.id);
              } catch (e) {
                // Part of it may be deleted already. Show the error in this dialog (the confirmation
                // closes, and may even disappear if the assignment is gone), then show what FSM has now.
                setError(toUserMessage(e));
                await state.reload();
                return;
              }
              setRemoved(true);
              if (!(await state.reload())) {
                setNotRefreshed({ done: t("assign.doneRemoved", { skill: definition.name, person: person.name }), close: true });
                return;
              }
              toast(t("assign.removed", { skill: definition.name, person: person.name }));
              onClose();
            } finally {
              operationRef.current = false;
              setBusy(false);
            }
          }}
        >
          {t("assign.removeText", {
            person: person.name,
            skill: definition.name,
            certificates: certificates.length ? t("assign.removeCertificates", { n: certificates.length }) : "",
          })}
        </ConfirmDialog>
      )}
    </>
  );
}
