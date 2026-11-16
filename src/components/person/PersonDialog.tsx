"use client";

import { Bar, Button, Dialog, Text } from "@ui5/webcomponents-react";
import { useToday } from "@/hooks/useToday";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { linkedRecordNote } from "@/lib/format";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { PersonSkills } from "./PersonSkills";
import { personSkillRows, personSkillSummary } from "./personSkillRows";
import styles from "./PersonSkills.module.css";
import { t } from "@/lib/i18n/t";

interface PersonDialogProps {
  person: Person;
  state: SkillDataState;
  /** Opens the assignment dialog for one skill of one record (it opens on top; this view updates after a save). */
  onOpenCell: (person: Person, definition: SkillDefinition, recordId?: string) => void;
  onClose: () => void;
}

/**
 * All skills and certificates of one person, across all of their Person records (from data the app
 * already loaded). A skill held by two records is listed twice, so nothing is hidden.
 */
export function PersonDialog({ person, state, onOpenCell, onClose }: PersonDialogProps) {
  const today = useToday();
  const rows = personSkillRows(
    person.records.map((r) => r.id),
    state.data?.definitions ?? [],
    (recordId, tagId) => state.assignmentByRecord.get(cellKey(recordId, tagId)),
    state.certificatesBySkill,
    today,
  );
  const { held, total } = personSkillSummary(rows);

  return (
    <Dialog
      open
      headerText={person.name}
      onClose={onClose}
      className={styles.dialog}
      footer={
        <Bar
          design="Footer"
          endContent={
            <Button design="Transparent" onClick={onClose}>
              {t("common.close")}
            </Button>
          }
        />
      }
    >
      <div className={styles.summary}>
        <Text>
          {person.jobTitle || " "}
        </Text>
        <Text className={styles.muted}>
          {t("personView.summary", { held, total })}
        </Text>
      </div>
      <PersonSkills
        personName={person.name}
        rows={rows}
        recordNote={(recordId) => linkedRecordNote(person, recordId)}
        onOpenSkill={(definition, recordId) => onOpenCell(person, definition, recordId)}
      />
    </Dialog>
  );
}
