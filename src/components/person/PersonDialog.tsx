"use client";

import { Bar, Button, Dialog, Text } from "@ui5/webcomponents-react";
import { useToday } from "@/hooks/useToday";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { formatPersonType } from "@/lib/format";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { PersonSkills } from "./PersonSkills";
import { personSkillRows } from "./personSkillRows";
import styles from "./PersonSkills.module.css";

interface PersonDialogProps {
  person: Person;
  state: SkillDataState;
  /** Opens the assignment dialog for one skill (it opens on top; this view updates after a save). */
  onOpenCell: (person: Person, definition: SkillDefinition) => void;
  onClose: () => void;
}

/** All skills and certificates of one person, from data the app already loaded. */
export function PersonDialog({ person, state, onOpenCell, onClose }: PersonDialogProps) {
  const today = useToday();
  const rows = personSkillRows(
    person.id,
    state.data?.definitions ?? [],
    (personId, tagId) => state.assignmentByCell.get(cellKey(personId, tagId)),
    state.certificatesBySkill,
    today,
  );
  const held = rows.filter((r) => r.assignment).length;

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
              Close
            </Button>
          }
        />
      }
    >
      <div className={styles.summary}>
        <Text>{[person.jobTitle, formatPersonType(person.type)].filter(Boolean).join(" · ") || " "}</Text>
        <Text className={styles.muted}>
          {held} of {rows.length} skills assigned
        </Text>
      </div>
      <PersonSkills personName={person.name} rows={rows} onOpenSkill={(definition) => onOpenCell(person, definition)} />
    </Dialog>
  );
}
