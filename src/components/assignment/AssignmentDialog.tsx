"use client";

import { useState } from "react";
import { Bar, BusyIndicator, Button, DatePicker, Dialog, Label, MessageStrip, Option, Select, Text } from "@ui5/webcomponents-react";
import { getAssignmentStatus, todayIso } from "@/lib/domain/status";
import { effectiveStartDate, validateValidity } from "@/lib/domain/validation";
import { createAssignment, deleteAssignment, updateAssignment } from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import { formatDate, formatPersonType } from "@/lib/format";
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
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** Certificate uploads running: the assignment must not be removed or the dialog closed meanwhile. */
  const [uploading, setUploading] = useState(false);
  const locked = busy || uploading;

  // The picker's value is always in valueFormat (YYYY-MM-DD) or, if the user typed nonsense, that text.
  // Our own validation decides; the picker's `valid` flag is unreliable with a custom displayFormat.
  const dateError = validateValidity(effectiveStartDate(from || null, today), to || null);
  const fromInvalid = Boolean(dateError?.startsWith("“Valid from”"));
  const toInvalid = Boolean(dateError) && !fromInvalid;

  const save = async () => {
    if (dateError) return;
    setBusy(true);
    setError(null);
    const input = { startDate: from || null, endDate: to || null, proficiencyId: levelId || null };
    try {
      if (assignment) {
        await updateAssignment(assignment.id, input);
        await state.reload();
        toast("Assignment saved");
        onClose();
      } else {
        await createAssignment(definition.id, person.id, input);
        await state.reload();
        setJustCreated(true);
        toast(`${definition.name} assigned to ${person.name}`);
      }
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
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
              assignment && (
                <Button design="Transparent" icon="delete" onClick={() => setConfirmRemove(true)} disabled={locked}>
                  Remove assignment
                </Button>
              )
            }
            endContent={
              <>
                <Button design="Emphasized" onClick={save} disabled={locked || Boolean(dateError)}>
                  {assignment ? "Save" : "Assign"}
                </Button>
                <Button design="Transparent" onClick={onClose} disabled={locked}>
                  {justCreated ? "Done" : "Cancel"}
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
                  {STATUS_DISPLAY[status].label}: {statusText(status, assignment.endDate)}
                </Text>
              )}
            </div>

            {justCreated && (
              <MessageStrip design="Positive" hideCloseButton>
                Assigned. You can add certificates below now.
              </MessageStrip>
            )}

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

            {assignment ? (
              <CertificateSection assignmentId={assignment.id} certificates={certificates} onChanged={state.reload} onBusyChange={setUploading} />
            ) : (
              <Text className={styles.muted}>You can add certificates after the skill is assigned.</Text>
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
