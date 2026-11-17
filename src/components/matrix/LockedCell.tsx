import type { ReactNode } from "react";
import styles from "./SkillMatrix.module.css";

/**
 * A cell of a linked record in "Show each FSM record": what the record holds, read-only. No button,
 * so no hover, click or keyboard action; new skills go on the person's main record (its own row).
 */
export function LockedCell({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <span className={styles.cellLocked} aria-disabled="true">
      <span aria-hidden>{children}</span>
      <span className={styles.srOnly}>{label}</span>
    </span>
  );
}
