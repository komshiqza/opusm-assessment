"use client";

import { useCallback, useEffect, useState } from "react";
import { BusyIndicator, MessageStrip, Text } from "@ui5/webcomponents-react";
import { DeleteImpactChangedError, deleteSkillDefinition, getDeleteImpact, type DeleteImpact, type DeleteTargets } from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import type { SkillDefinition } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

interface DeleteSkillDialogProps {
  skill: SkillDefinition;
  onDeleted: (impact: DeleteImpact) => Promise<void>;
  /** Reloads the data; also used after a failed delete, which may have removed a part already. */
  reload: () => Promise<boolean>;
  onClose: () => void;
}

/**
 * Delete behaviour (see README): FSM refuses to delete a Tag that still has Skills. We show what
 * will be removed (counted fresh from FSM), and on confirmation delete certificates, assignments
 * and the skill definition, in that order. The delete gets exactly what the user confirmed: if FSM
 * has more by then, nothing is deleted and the dialog asks again with the new numbers.
 */
export function DeleteSkillDialog({ skill, onDeleted, reload, onClose }: DeleteSkillDialogProps) {
  const [impact, setImpact] = useState<DeleteTargets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Counts what a delete would remove now (also after a partial failure, so the button text is right). */
  const countImpact = useCallback(async () => {
    try {
      setImpact(await getDeleteImpact(skill.id));
      setLoadError(null);
    } catch (e) {
      setImpact(null);
      setLoadError(toUserMessage(e));
    }
  }, [skill.id]);

  useEffect(() => {
    let cancelled = false;
    getDeleteImpact(skill.id)
      .then((result) => !cancelled && setImpact(result))
      .catch((e) => !cancelled && setLoadError(toUserMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [skill.id]);

  const inUse = impact && impact.assignments > 0;
  const confirmText = inUse
    ? `Delete skill and ${impact.assignments} assignment${impact.assignments > 1 ? "s" : ""}`
    : "Delete skill";

  return (
    <ConfirmDialog
      open
      title={`Delete “${skill.name}”?`}
      confirmText={confirmText}
      confirmDisabled={!impact}
      onClose={onClose}
      onConfirm={async () => {
        if (!impact) return;
        let result: DeleteImpact;
        try {
          result = await deleteSkillDefinition(skill.id, impact);
        } catch (e) {
          if (e instanceof DeleteImpactChangedError) {
            setImpact(e.impact); // the new numbers; the user confirms again
          } else {
            // Part of it may be gone already: show what FSM has now, and count again for the button.
            await Promise.all([reload(), countImpact()]);
          }
          throw e;
        }
        await onDeleted(result);
      }}
    >
      <>
        {!impact && !loadError && (
          <BusyIndicator active delay={0} style={{ display: "block", minHeight: "2rem" }}>
            <Text>Checking where this skill is used…</Text>
          </BusyIndicator>
        )}
        {loadError && (
          <MessageStrip design="Negative" hideCloseButton>
            Could not check the assignments of this skill: {loadError}
          </MessageStrip>
        )}
        {impact && !inUse && <Text>The skill is not assigned to anyone. It will be deleted from FSM. This cannot be undone.</Text>}
        {impact && inUse && (
          <MessageStrip design="Critical" hideCloseButton>
            This skill is assigned to {impact.assignments} person{impact.assignments > 1 ? "s" : ""}
            {impact.certificates ? ` with ${impact.certificates} certificate${impact.certificates > 1 ? "s" : ""}` : ""}. Deleting it also removes
            these assignments{impact.certificates ? " and certificates" : ""}. This cannot be undone.
          </MessageStrip>
        )}
      </>
    </ConfirmDialog>
  );
}
