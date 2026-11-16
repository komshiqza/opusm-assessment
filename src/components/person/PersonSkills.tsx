"use client";

import { useState } from "react";
import { Button, Icon, Link, Table, TableCell, TableHeaderCell, TableHeaderRow, TableRow, Text } from "@ui5/webcomponents-react";
import { formatDate } from "@/lib/format";
import { toUserMessage } from "@/lib/errors";
import type { Certificate, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY, statusText } from "@/components/matrix/statusDisplay";
import { CertificatePreview } from "@/components/assignment/CertificatePreview";
import { saveCertificate } from "@/components/assignment/saveCertificate";
import type { PersonSkillRow } from "./personSkillRows";
import styles from "./PersonSkills.module.css";

interface PersonSkillsProps {
  personName: string;
  rows: PersonSkillRow<SkillDefinition>[];
  /**
   * Edit or assign one skill. Leave it out for a read-only list (e.g. a later "my skills" view for
   * technicians): then no Edit or Assign buttons are shown, only status, dates and certificates.
   */
  onOpenSkill?: (definition: SkillDefinition) => void;
}

/** All skills of one person: status, valid from/to, level and certificates (open or download). */
export function PersonSkills({ personName, rows, onOpenSkill }: PersonSkillsProps) {
  const [previewed, setPreviewed] = useState<Certificate | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  return (
    <>
      <Table
        overflowMode="Popin"
        headerRow={
          <TableHeaderRow>
            <TableHeaderCell minWidth="10rem">Skill</TableHeaderCell>
            <TableHeaderCell minWidth="11rem">Status</TableHeaderCell>
            <TableHeaderCell minWidth="7rem">Valid from</TableHeaderCell>
            <TableHeaderCell minWidth="7rem">Valid to</TableHeaderCell>
            <TableHeaderCell minWidth="6rem">Level</TableHeaderCell>
            <TableHeaderCell minWidth="12rem">Certificates</TableHeaderCell>
            {onOpenSkill ? (
              <TableHeaderCell minWidth="7rem" horizontalAlign="End">
                Actions
              </TableHeaderCell>
            ) : null}
          </TableHeaderRow>
        }
      >
        {rows.map(({ definition, assignment, status, certificates }) => (
          <TableRow key={definition.id} rowKey={definition.id}>
            <TableCell>
              <Text style={{ fontWeight: "bold" }}>{definition.name}</Text>
            </TableCell>
            <TableCell>
              <span className={styles.status} style={{ color: STATUS_DISPLAY[status].color }}>
                <Icon name={STATUS_DISPLAY[status].icon} className={styles.icon} style={{ color: "inherit" }} />
                {assignment ? statusText(status, assignment) : STATUS_DISPLAY.none.label}
              </span>
            </TableCell>
            <TableCell>
              <Text>{assignment ? formatDate(assignment.startDate) || "–" : "–"}</Text>
            </TableCell>
            <TableCell>
              <Text>{assignment ? (assignment.endDate ? formatDate(assignment.endDate) : "No end date") : "–"}</Text>
            </TableCell>
            <TableCell>
              <Text>{assignment ? (assignment.proficiencyName ?? "No level") : "–"}</Text>
            </TableCell>
            <TableCell>
              {certificates.length === 0 ? (
                <Text>{assignment ? "None" : "–"}</Text>
              ) : (
                <ul className={styles.certList}>
                  {certificates.map((c) => (
                    <li key={c.id}>
                      <Link onClick={() => setPreviewed(c)} accessibleName={`Open ${c.fileName}`}>
                        {c.fileName}
                      </Link>
                      <Button
                        design="Transparent"
                        icon="download"
                        tooltip={`Download ${c.fileName}`}
                        accessibleName={`Download ${c.fileName}`}
                        onClick={() => saveCertificate(c).catch((e: unknown) => setDownloadError(`${c.fileName}: ${toUserMessage(e)}`))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </TableCell>
            {onOpenSkill ? (
              <TableCell horizontalAlign="End">
                <Button
                  design="Transparent"
                  icon={assignment ? "edit" : "add"}
                  onClick={() => onOpenSkill(definition)}
                  accessibleName={assignment ? `Edit ${definition.name} of ${personName}` : `Assign ${definition.name} to ${personName}`}
                >
                  {assignment ? "Edit" : "Assign"}
                </Button>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </Table>
      {downloadError && <Text className={styles.error}>{downloadError}</Text>}
      {previewed && <CertificatePreview certificate={previewed} onClose={() => setPreviewed(null)} />}
    </>
  );
}
