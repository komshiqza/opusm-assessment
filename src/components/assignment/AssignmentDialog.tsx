"use client";

import { useRef, useState } from "react";
import { Bar, BusyIndicator, Button, DatePicker, Dialog, FileUploader, Label, MessageStrip, Option, Select, Text } from "@ui5/webcomponents-react";
import { getAssignmentStatus, todayIso } from "@/lib/domain/status";
import { effectiveStartDate, validateValidity } from "@/lib/domain/validation";
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_LABEL, splitCertificateFiles } from "@/lib/domain/certificateRules";
import {
  createAssignmentWithCertificates,
  deleteAssignment,
  updateAssignment,
  uploadCertificates,
  type UploadOutcome,
} from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import { formatDate, formatFileSize, formatPersonType } from "@/lib/format";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/common/Toast";
import { STATUS_DISPLAY, statusText } from "@/components/matrix/statusDisplay";
import { CertificateSection } from "./CertificateSection";
import styles from "./AssignmentDialog.module.css";

interface AssignmentDialogProps {
  person: Person;
  definition: SkillDefinition;
  state: SkillDataState;
  onClose: () => void;
}

/** Assign a skill, change level and validity, remove it, and manage its certificates. */
export function AssignmentDialog({ person, definition, state, onClose }: AssignmentDialogProps) {
  const toast = useToast();
  const assignment = state.assignmentByCell.get(cellKey(person.id, definition.id));
  const certificates = assignment ? (state.certificatesBySkill.get(assignment.id) ?? []) : [];
  const scale = state.data?.scale;
  const levels = scale && definition.scaleId === scale.id ? scale.levels : [];
  const today = todayIso();

  const [levelId, setLevelId] = useState(assignment?.proficiencyId ?? levels.find((l) => l.isDefault)?.id ?? levels[0]?.id ?? "");
  const [from, setFrom] = useState(assignment?.startDate ?? "");
  const [to, setTo] = useState(assignment?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  /** Same as `busy`, set synchronously: a fast second click cannot start a second save. */
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** New assignment: certificates picked before saving, uploaded right after the assignment exists. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pickProblems, setPickProblems] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  /** Files FSM did not accept during save or retry; they stay listed until uploaded or dismissed. */
  const [failed, setFailed] = useState<UploadOutcome["failed"]>([]);
  /** Id of the assignment this dialog just created; retry must not depend on a successful reload. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const assignmentId = assignment?.id ?? createdId;
  /** Certificate uploads running: the assignment must not be removed or the dialog closed meanwhile. */
  const [uploading, setUploading] = useState(false);
  const locked = busy || uploading;

  // The picker's value is always in valueFormat (YYYY-MM-DD) or, if the user typed nonsense, that text.
  // Our own validation decides; the picker's `valid` flag is unreliable with a custom displayFormat.
  const dateError = validateValidity(effectiveStartDate(from || null, today), to || null);
  const fromInvalid = Boolean(dateError?.startsWith("“Valid from”"));
  const toInvalid = Boolean(dateError) && !fromInvalid;

  /** Runs one save or retry at a time and keeps the dialog locked meanwhile. */
  const runLocked = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const showProgress = (file: File, index: number, total: number) => setProgress(`Uploading ${file.name} (${index + 1} of ${total})…`);

  const save = () =>
    runLocked(async () => {
      if (dateError) return;
      const input = { startDate: from || null, endDate: to || null, proficiencyId: levelId || null };
      if (assignment) {
        setProgress("Saving…");
        await updateAssignment(assignment.id, input);
        await state.reload();
        toast("Assignment saved");
        onClose();
        return;
      }
      setProgress("Assigning…");
      const result = await createAssignmentWithCertificates(definition.id, person.id, input, pendingFiles, showProgress);
      setCreatedId(result.assignment.id);
      setPendingFiles([]);
      setProgress("Refreshing…");
      await state.reload();
      const count = result.uploaded.length;
      if (result.failed.length === 0) {
        toast(`${definition.name} assigned to ${person.name}${count ? ` with ${count} certificate${count > 1 ? "s" : ""}` : ""}`);
        onClose();
        return;
      }
      // The assignment exists now; the dialog stays open with the files that still need uploading.
      setFailed(result.failed);
    });

  const retryFailed = () =>
    runLocked(async () => {
      if (!assignmentId) return;
      const outcome = await uploadCertificates(
        assignmentId,
        failed.map((f) => f.file),
        showProgress,
      );
      setFailed(outcome.failed);
      setProgress("Refreshing…");
      await state.reload();
      if (outcome.failed.length === 0) toast("All certificates uploaded");
    });

  const pickFiles = async (files: File[]) => {
    const { valid, problems } = await splitCertificateFiles(files);
    setPickProblems(problems);
    // No automatic de-duplication: two different files can share name and size. Every picked file is listed and can be removed.
    setPendingFiles((current) => [...current, ...valid]);
    setPickerKey((k) => k + 1);
  };

  const status = getAssignmentStatus(assignment, today);

  return (
    <>
      <Dialog
        open
        headerText={assignment ? `${definition.name}: ${person.name}` : `Assign ${definition.name}`}
        onBeforeClose={(e) => locked && e.preventDefault()}
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
                  <Button design="Transparent" icon="delete" onClick={() => setConfirmRemove(true)} disabled={locked}>
                    Remove assignment
                  </Button>
                )
              )
            }
            endContent={
              <>
                <Button design="Emphasized" onClick={save} disabled={locked || Boolean(dateError)}>
                  {assignment
                    ? "Save"
                    : pendingFiles.length
                      ? `Assign and upload ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`
                      : "Assign"}
                </Button>
                <Button design="Transparent" onClick={onClose} disabled={locked}>
                  {failed.length ? "Close" : "Cancel"}
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

            <div className={styles.form}>
              {levels.length > 0 ? (
                <div className={styles.formItem}>
                  <Label for="assignment-level" showColon>
                    Proficiency level
                  </Label>
                  <Select id="assignment-level" value={levelId} onChange={(e) => setLevelId(e.detail.selectedOption.value ?? "")}>
                    {levels.map((l) => (
                      <Option key={l.id} value={l.id}>
                        {l.name}
                      </Option>
                    ))}
                  </Select>
                </div>
              ) : (
                <MessageStrip design="Information" hideCloseButton>
                  This skill has no proficiency scale, so no level can be set.
                </MessageStrip>
              )}

              <div className={styles.formItem}>
                <Label for="assignment-from" showColon>
                  Valid from
                </Label>
                <DatePicker
                  id="assignment-from"
                  value={from}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder={`Today (${formatDate(today)}) if empty`}
                  valueState={fromInvalid ? "Negative" : "None"}
                  onChange={(e) => setFrom(e.target.value ?? "")}
                />
              </div>

              <div className={styles.formItem}>
                <Label for="assignment-to" showColon>
                  Valid to
                </Label>
                <DatePicker
                  id="assignment-to"
                  value={to}
                  valueFormat="yyyy-MM-dd"
                  displayFormat="dd.MM.yyyy"
                  placeholder="No end date if empty"
                  valueState={toInvalid ? "Negative" : "None"}
                  onChange={(e) => setTo(e.target.value ?? "")}
                />
              </div>
            </div>

            {dateError && (
              <MessageStrip design="Negative" hideCloseButton>
                {dateError}
                {!from && dateError.includes("before") ? " An empty “Valid from” means today, so enter the real start date." : ""}
              </MessageStrip>
            )}
            {error && (
              <MessageStrip design="Negative" onClose={() => setError(null)}>
                {error}
              </MessageStrip>
            )}

            {failed.length > 0 && (
              <MessageStrip design="Negative" onClose={() => setFailed([])}>
                The skill is assigned
                {certificates.length ? ` and ${certificates.length} certificate${certificates.length > 1 ? "s are" : " is"} uploaded` : ""}.{" "}
                {failed.length === 1 ? "This file was not uploaded:" : `These ${failed.length} files were not uploaded:`}
                <ul className={styles.errorList}>
                  {failed.map((f, i) => (
                    <li key={i}>
                      {f.file.name}: {f.error}
                    </li>
                  ))}
                </ul>
                <Button icon="refresh" onClick={retryFailed} disabled={locked}>
                  Retry failed uploads
                </Button>
              </MessageStrip>
            )}

            {assignment ? (
              <CertificateSection assignmentId={assignment.id} certificates={certificates} onChanged={state.reload} onBusyChange={setUploading} />
            ) : (
              <section className={styles.certificates} aria-labelledby="new-certificates-title">
                <Label id="new-certificates-title">Certificates (optional)</Label>
                {pendingFiles.length > 0 && (
                  <ul className={styles.certList}>
                    {pendingFiles.map((f, i) => (
                      <li key={i} className={styles.certItem}>
                        <span className={styles.certText}>
                          <span>{f.name}</span>
                          <span className={styles.muted}>{formatFileSize(f.size)} · uploaded when you assign</span>
                        </span>
                        <Button
                          design="Transparent"
                          icon="decline"
                          tooltip={`Remove ${f.name}`}
                          accessibleName={`Remove ${f.name}`}
                          disabled={locked}
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
                    disabled={locked}
                    onChange={(e) => void pickFiles(Array.from(e.detail.files ?? []))}
                  >
                    <Button icon="add" disabled={locked}>
                      Choose certificates
                    </Button>
                  </FileUploader>
                  <Text className={styles.muted}>PDF, JPG or PNG, max. {MAX_CERTIFICATE_LABEL} each</Text>
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
          title="Remove assignment?"
          confirmText="Remove"
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            try {
              await deleteAssignment(assignment.id);
            } catch (e) {
              // Part of it may be deleted already. Show the error in this dialog (the confirmation
              // closes, and may even disappear if the assignment is gone), then show what FSM has now.
              setError(toUserMessage(e));
              await state.reload();
              return;
            }
            await state.reload();
            toast(`${definition.name} removed from ${person.name}`);
            onClose();
          }}
        >
          {`${person.name} will no longer have “${definition.name}”.${
            certificates.length ? ` The ${certificates.length} attached certificate(s) will be deleted as well.` : ""
          } This cannot be undone.`}
        </ConfirmDialog>
      )}
    </>
  );
}
