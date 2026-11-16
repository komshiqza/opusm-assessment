"use client";

import { useState } from "react";
import {
  Button,
  IllustratedMessage,
  Table,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  Title,
  Toolbar,
  ToolbarButton,
  ToolbarSpacer,
} from "@ui5/webcomponents-react";
import { getAssignmentStatus } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import type { SkillDataState } from "@/hooks/useSkillData";
import type { SkillDefinition } from "@/lib/skills/types";
import { useToast } from "@/components/common/Toast";
import { SkillDialog } from "./SkillDialog";
import { DeleteSkillDialog } from "./DeleteSkillDialog";
import { t, tn } from "@/lib/i18n/t";

type DialogState = { kind: "create" } | { kind: "edit"; skill: SkillDefinition } | { kind: "delete"; skill: SkillDefinition } | null;

export function SkillCatalog({ state }: { state: SkillDataState }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogState>(null);
  const definitions = state.data?.definitions ?? [];
  const today = useToday();

  /** Per skill: number of assignments, of those expiring/expired, and certificates. */
  const usage = new Map<string, { assigned: number; attention: number; certificates: number }>();
  for (const a of state.data?.assignments ?? []) {
    const u = usage.get(a.tagId) ?? { assigned: 0, attention: 0, certificates: 0 };
    u.assigned++;
    const status = getAssignmentStatus(a, today);
    if (status === "expiring" || status === "expired") u.attention++;
    u.certificates += state.certificatesBySkill.get(a.id)?.length ?? 0;
    usage.set(a.tagId, u);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "0.75rem" }}>
      <Toolbar design="Transparent" style={{ paddingInline: 0 }}>
        <Title level="H4">{t("catalogue.title", { n: definitions.length })}</Title>
        <ToolbarSpacer />
        <ToolbarButton design="Emphasized" icon="add" text={t("catalogue.create")} onClick={() => setDialog({ kind: "create" })} />
      </Toolbar>

      {definitions.length === 0 ? (
        <IllustratedMessage name="NoEntries" titleText={t("matrix.noSkills")} subtitleText={t("catalogue.noSkillsHint")}>
          <Button design="Emphasized" icon="add" onClick={() => setDialog({ kind: "create" })}>
            {t("catalogue.create")}
          </Button>
        </IllustratedMessage>
      ) : (
        <Table
          overflowMode="Popin"
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell minWidth="12rem">{t("common.skill")}</TableHeaderCell>
              <TableHeaderCell minWidth="14rem">{t("catalogue.description")}</TableHeaderCell>
              <TableHeaderCell minWidth="9rem">{t("catalogue.assignedTo")}</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">{t("common.certificates")}</TableHeaderCell>
              <TableHeaderCell minWidth="12rem" horizontalAlign="End">
                {t("common.actions")}
              </TableHeaderCell>
            </TableHeaderRow>
          }
        >
          {definitions.map((d) => {
            const u = usage.get(d.id);
            return (
              <TableRow key={d.id} rowKey={d.id}>
                <TableCell>
                  <Text style={{ fontWeight: "bold" }}>{d.name}</Text>
                </TableCell>
                <TableCell>
                  <Text>{d.description ?? "–"}</Text>
                </TableCell>
                <TableCell>
                  <Text>
                    {u ? tn("catalogue.persons", u.assigned) : t("catalogue.nobody")}
                    {u?.attention ? t("catalogue.attention", { n: u.attention }) : ""}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text>{u?.certificates ?? 0}</Text>
                </TableCell>
                <TableCell horizontalAlign="End">
                  <Button design="Transparent" icon="edit" onClick={() => setDialog({ kind: "edit", skill: d })} accessibleName={t("catalogue.editLabel", { skill: d.name })}>
                    {t("common.edit")}
                  </Button>
                  <Button design="Transparent" icon="delete" onClick={() => setDialog({ kind: "delete", skill: d })} accessibleName={t("catalogue.deleteLabel", { skill: d.name })}>
                    {t("common.delete")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      )}

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <SkillDialog
          skill={dialog.kind === "edit" ? dialog.skill : null}
          existingNames={definitions.map((d) => d.name)}
          onClose={() => setDialog(null)}
          onSaved={async (name) => {
            const refreshed = await state.reload();
            const saved = dialog.kind === "edit" ? t("catalogue.saved", { name }) : t("catalogue.created", { name });
            // A failed reload shows its own message with "Try again" on the page once the dialog closes.
            toast(refreshed ? saved : t("catalogue.notRefreshed", { done: saved }));
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteSkillDialog
          skill={dialog.skill}
          reload={state.reload}
          onClose={() => setDialog(null)}
          onDeleted={async (impact) => {
            const refreshed = await state.reload();
            const deleted = impact.assignments
              ? t("catalogue.deletedWith", { name: dialog.skill.name, assignments: impact.assignments, certificates: impact.certificates })
              : t("catalogue.deleted", { name: dialog.skill.name });
            // A failed reload shows its own message with "Try again" on the page once the dialog closes.
            toast(refreshed ? deleted : t("catalogue.notRefreshed", { done: deleted }));
          }}
        />
      )}
    </div>
  );
}
