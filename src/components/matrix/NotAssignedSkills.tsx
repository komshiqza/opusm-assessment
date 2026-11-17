"use client";

import { Icon, Panel } from "@ui5/webcomponents-react";
import { t } from "@/lib/i18n/t";
import styles from "./SkillMatrix.module.css";

interface NotAssignedSkillsProps<S extends { id: string; name: string }> {
  person: { id: string; name: string };
  /** The shown skills this person does not have. */
  skills: S[];
  /** Opens the assign dialog for this skill. */
  onAssign: (skill: S) => void;
}

/**
 * The phone card's "Not assigned (n)" line: collapsed on every load, so the card shows the skills the
 * person has; the panel header (a button with aria-expanded, keyboard operable) opens the assign chips.
 * Same collapsed Panel as "missing one skill" in Find technician. Nothing when no skill is missing.
 */
export function NotAssignedSkills<S extends { id: string; name: string }>({ person, skills, onAssign }: NotAssignedSkillsProps<S>) {
  if (skills.length === 0) return null;
  return (
    <Panel collapsed className={styles.cardMissing} headerText={t("matrix.notAssignedCount", { n: skills.length })}>
      <div className={styles.cardMissingChips}>
        {skills.map((d) => (
          <button
            key={d.id}
            type="button"
            className={styles.assignChip}
            onClick={() => onAssign(d)}
            aria-label={t("matrix.cellNotAssigned", { person: person.name, skill: d.name })}
          >
            <Icon name="add" className={styles.cellIcon} style={{ color: "inherit" }} />
            {d.name}
          </button>
        ))}
      </div>
    </Panel>
  );
}
