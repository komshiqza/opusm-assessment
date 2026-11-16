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
import { t } from "@/lib/i18n/t";

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
            <TableHeaderCell minWidth="10rem">{t("common.skill")}</TableHeaderCell>
            <TableHeaderCell minWidth="11rem">{t("common.status")}</TableHeaderCell>
            <TableHeaderCell minWidth="7rem">{t("common.validFrom")}</TableHeaderCell>
            <TableHeaderCell minWidth="7rem">{t("common.validTo")}</TableHeaderCell>
            <TableHeaderCell minWidth="6rem">{t("common.level")}</TableHeaderCell>
            <TableHeaderCell minWidth="12rem">{t("common.certificates")}</TableHeaderCell>
            {onOpenSkill ? (
              <TableHeaderCell minWidth="9rem" horizontalAlign="End">
                {t("common.actions")}
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
              <Text>{assignment ? (assignment.endDate ? formatDate(assignment.endDate) : t("common.noEndDate")) : "–"}</Text>
            </TableCell>
            <TableCell>
              <Text>{assignment ? (assignment.proficiencyName ?? t("common.noLevel")) : "–"}</Text>
            </TableCell>
            <TableCell>
              {certificates.length === 0 ? (
                <Text>–</Text>
              ) : (
                <ul className={styles.certList}>
                  {certificates.map((c) => (
                    <li key={c.id}>
                      <Link onClick={() => setPreviewed(c)} accessibleName={t("certificates.open", { name: c.fileName })}>
                        {c.fileName}
                      </Link>
                      <Button
                        design="Transparent"
                        icon="download"
                        tooltip={t("certificates.download", { name: c.fileName })}
                        accessibleName={t("certificates.download", { name: c.fileName })}
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
                  accessibleName={
                    assignment
                      ? t("personView.editLabel", { skill: definition.name, person: personName })
                      : t("personView.assignLabel", { skill: definition.name, person: personName })
                  }
                >
                  {assignment ? t("common.edit") : t("common.assign")}
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
