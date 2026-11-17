"use client";

import { useCallback, useEffect, useState } from "react";
import { BusyIndicator, MessageStrip, Text } from "@ui5/webcomponents-react";
import { DeleteImpactChangedError, deleteSkillDefinition, getDeleteImpact, type DeleteImpact, type DeleteTargets } from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import type { SkillDefinition } from "@/lib/skills/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { t, tn } from "@/lib/i18n/t";

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
  const confirmText = inUse ? tn("deleteDialog.buttonWith", impact.assignments) : t("deleteDialog.button");

  return (
    <ConfirmDialog
      open
      title={t("deleteDialog.title", { name: skill.name })}
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
            <Text>{t("deleteDialog.checking")}</Text>
          </BusyIndicator>
        )}
        {loadError && (
          <MessageStrip design="Negative" hideCloseButton>
            {t("deleteDialog.checkFailed", { error: loadError })}
          </MessageStrip>
        )}
        {impact && !inUse && <Text>{t("deleteDialog.unused")}</Text>}
        {impact && inUse && (
          <MessageStrip design="Critical" hideCloseButton>
            {t("deleteDialog.inUse", {
              assignments: tn("catalogue.persons", impact.assignments),
              certificates: impact.certificates ? t("deleteDialog.inUseCertificates", { certificates: tn("delete.withCertificates", impact.certificates) }) : "",
              andCertificates: impact.certificates ? t("deleteDialog.andCertificates") : "",
            })}
          </MessageStrip>
        )}
      </>
    </ConfirmDialog>
  );
}
