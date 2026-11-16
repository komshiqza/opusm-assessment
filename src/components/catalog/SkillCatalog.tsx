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
        <Title level="H4">Skills ({definitions.length})</Title>
        <ToolbarSpacer />
        <ToolbarButton design="Emphasized" icon="add" text="Create skill" onClick={() => setDialog({ kind: "create" })} />
      </Toolbar>

      {definitions.length === 0 ? (
        <IllustratedMessage name="NoEntries" titleText="No skills yet" subtitleText="Skills you create here appear as columns in the skill matrix.">
          <Button design="Emphasized" icon="add" onClick={() => setDialog({ kind: "create" })}>
            Create skill
          </Button>
        </IllustratedMessage>
      ) : (
        <Table
          overflowMode="Popin"
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell minWidth="12rem">Skill</TableHeaderCell>
              <TableHeaderCell minWidth="14rem">Description</TableHeaderCell>
              <TableHeaderCell minWidth="9rem">Assigned to</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">Certificates</TableHeaderCell>
              <TableHeaderCell minWidth="12rem" horizontalAlign="End">
                Actions
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
                    {u ? `${u.assigned} person${u.assigned > 1 ? "s" : ""}` : "Nobody"}
                    {u?.attention ? ` (${u.attention} expiring or expired)` : ""}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text>{u?.certificates ?? 0}</Text>
                </TableCell>
                <TableCell horizontalAlign="End">
                  <Button design="Transparent" icon="edit" onClick={() => setDialog({ kind: "edit", skill: d })} accessibleName={`Edit ${d.name}`}>
                    Edit
                  </Button>
                  <Button design="Transparent" icon="delete" onClick={() => setDialog({ kind: "delete", skill: d })} accessibleName={`Delete ${d.name}`}>
                    Delete
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
            const saved = dialog.kind === "edit" ? `Skill “${name}” saved` : `Skill “${name}” created`;
            // A failed reload shows its own message with "Try again" on the page once the dialog closes.
            toast(refreshed ? saved : `${saved}, but the list could not be refreshed`);
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
              ? `Skill “${dialog.skill.name}” deleted with ${impact.assignments} assignment(s) and ${impact.certificates} certificate(s)`
              : `Skill “${dialog.skill.name}” deleted`;
            // A failed reload shows its own message with "Try again" on the page once the dialog closes.
            toast(refreshed ? deleted : `${deleted}, but the list could not be refreshed`);
          }}
        />
      )}
    </div>
  );
}
