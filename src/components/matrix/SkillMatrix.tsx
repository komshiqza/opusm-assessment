"use client";

import { useMemo, useState } from "react";
import {
  Button,
  CheckBox,
  Icon,
  IllustratedMessage,
  Input,
  Label,
  MultiComboBox,
  MultiComboBoxItem,
  Option,
  Select,
  Text,
} from "@ui5/webcomponents-react";
import { getAssignmentStatus, todayIso, type AssignmentStatus } from "@/lib/domain/status";
import { formatPersonType } from "@/lib/format";
import { selectPersonRows } from "@/lib/domain/persons";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY, statusText } from "./statusDisplay";
import styles from "./SkillMatrix.module.css";

type StatusFilter = "all" | AssignmentStatus;

interface SkillMatrixProps {
  state: SkillDataState;
  onOpenCell: (person: Person, definition: SkillDefinition) => void;
  onGoToCatalogue: () => void;
}

export function SkillMatrix({ state, onOpenCell, onGoToCatalogue }: SkillMatrixProps) {
  const { data, assignmentByCell, certificatesBySkill } = state;
  const [personQuery, setPersonQuery] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showAllRecords, setShowAllRecords] = useState(false);
  const today = todayIso();

  const definitions = useMemo(() => data?.definitions ?? [], [data]);
  const visibleSkills = useMemo(() => (skillIds.length ? definitions.filter((d) => skillIds.includes(d.id)) : definitions), [definitions, skillIds]);

  const statusOf = (personId: string, tagId: string) => getAssignmentStatus(assignmentByCell.get(cellKey(personId, tagId)), today);

  const query = personQuery.trim().toLowerCase();
  /** One row per technician by default (see src/lib/domain/persons.ts). */
  const rows = useMemo(
    () => selectPersonRows(data?.persons ?? [], state.assignedPersonIds, showAllRecords),
    [data, state.assignedPersonIds, showAllRecords],
  );
  const visiblePersons = rows.filter((p) => {
    if (query && !`${p.name} ${p.jobTitle ?? ""}`.toLowerCase().includes(query)) return false;
    if (statusFilter === "all") return true;
    return visibleSkills.some((d) => statusOf(p.id, d.id) === statusFilter);
  });

  /** Counts over all rows and the visible skills (independent of the person and status filter). */
  const counts = { valid: 0, expiring: 0, expired: 0 };
  for (const p of rows) {
    for (const d of visibleSkills) {
      const s = statusOf(p.id, d.id);
      if (s !== "none") counts[s]++;
    }
  }

  if (!data) return null;

  if (definitions.length === 0) {
    return (
      <IllustratedMessage name="NoEntries" titleText="No skills yet" subtitleText="Create your first skill in the catalogue, then assign it here.">
        <Button design="Emphasized" icon="add" onClick={onGoToCatalogue}>
          Go to skill catalogue
        </Button>
      </IllustratedMessage>
    );
  }

  const filtersActive = Boolean(query || skillIds.length || statusFilter !== "all");

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} role="search">
        <div className={styles.field}>
          <Label for="matrix-person-filter">Person</Label>
          <Input
            id="matrix-person-filter"
            icon={<Icon name="search" />}
            placeholder="Name or job title"
            value={personQuery}
            onInput={(e) => setPersonQuery(e.target.value ?? "")}
            showClearIcon
          />
        </div>
        <div className={styles.field}>
          <Label for="matrix-skill-filter">Skills</Label>
          <MultiComboBox
            id="matrix-skill-filter"
            placeholder="All skills"
            onSelectionChange={(e) => setSkillIds(e.detail.items.map((i) => String(i.dataset.id)))}
          >
            {definitions.map((d) => (
              <MultiComboBoxItem key={d.id} data-id={d.id} text={d.name} selected={skillIds.includes(d.id)} />
            ))}
          </MultiComboBox>
        </div>
        <div className={styles.field}>
          <Label for="matrix-status-filter">Status</Label>
          <Select id="matrix-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.detail.selectedOption.value as StatusFilter)}>
            <Option value="all">All persons</Option>
            <Option value="expiring">With a skill expiring soon</Option>
            <Option value="expired">With an expired skill</Option>
            <Option value="valid">With a valid skill</Option>
            <Option value="none">With a missing skill</Option>
          </Select>
        </div>
        <CheckBox
          className={styles.reset}
          text={`Show all person records (${data?.persons.length ?? 0})`}
          checked={showAllRecords}
          onChange={(e) => setShowAllRecords(e.target.checked)}
          title="FSM keeps every technician twice (as employee and as ERP user) and also lists persons who are not technicians"
        />
        {filtersActive && (
          <Button
            design="Transparent"
            className={styles.reset}
            onClick={() => {
              setPersonQuery("");
              setSkillIds([]);
              setStatusFilter("all");
            }}
          >
            Reset filters
          </Button>
        )}
      </div>

      <div className={styles.summary} aria-live="polite">
        <Text>
          {visiblePersons.length} of {rows.length} {showAllRecords ? "person records" : "technicians"} · {visibleSkills.length} skills
        </Text>
        {(["expiring", "expired", "valid"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={styles.summaryChip}
            style={{ color: STATUS_DISPLAY[s].color }}
            aria-pressed={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            title={`Show persons with status “${STATUS_DISPLAY[s].label}”`}
          >
            <Icon name={STATUS_DISPLAY[s].icon} className={styles.chipIcon} style={{ color: "inherit" }} />
            {counts[s]} {STATUS_DISPLAY[s].label.toLowerCase()}
          </button>
        ))}
        <span className={styles.legend}>
          <Icon name="attachment" className={styles.chipIcon} /> = certificate attached · click a cell to assign or edit
        </span>
      </div>

      {visiblePersons.length === 0 ? (
        <IllustratedMessage name="NoFilterResults" titleText="No persons match the filters" subtitleText="Change or reset the filters." />
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.corner}>
                  Person
                </th>
                {visibleSkills.map((d) => (
                  <th key={d.id} scope="col" className={styles.skillHeader} title={d.description ?? d.name}>
                    {d.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePersons.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className={styles.personCell}>
                    <span className={styles.personName}>{p.name}</span>
                    <span className={styles.personMeta}>{[p.jobTitle, formatPersonType(p.type)].filter(Boolean).join(" · ")}</span>
                  </th>
                  {visibleSkills.map((d) => {
                    const assignment = assignmentByCell.get(cellKey(p.id, d.id));
                    const status = getAssignmentStatus(assignment, today);
                    const certCount = assignment ? (certificatesBySkill.get(assignment.id)?.length ?? 0) : 0;
                    const display = STATUS_DISPLAY[status];
                    const text = statusText(status, assignment?.endDate ?? null);
                    const label = assignment
                      ? `${p.name}, ${d.name}: ${text}${assignment.proficiencyName ? `, level ${assignment.proficiencyName}` : ""}, ${certCount ? `${certCount} certificate(s)` : "no certificate"}. Edit.`
                      : `${p.name}, ${d.name}: not assigned. Assign.`;
                    return (
                      <td key={d.id} className={styles.cell} data-status={status}>
                        <button type="button" className={styles.cellButton} onClick={() => onOpenCell(p, d)} aria-label={label} title={label}>
                          {assignment ? (
                            <>
                              <span className={styles.cellStatus} style={{ color: display.color }}>
                                <Icon name={display.icon} className={styles.cellIcon} style={{ color: "inherit" }} />
                                {text}
                              </span>
                              <span className={styles.cellMeta}>
                                <span>{assignment.proficiencyName ?? "No level"}</span>
                                {certCount > 0 && (
                                  <span className={styles.cert}>
                                    <Icon name="attachment" className={styles.cellIcon} />
                                    {certCount}
                                  </span>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className={styles.empty}>
                              <span aria-hidden>–</span>
                              <span className={styles.assignHint}>
                                <Icon name="add" className={styles.cellIcon} style={{ color: "inherit" }} /> Assign
                              </span>
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
