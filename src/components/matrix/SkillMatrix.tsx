"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Button,
  Icon,
  IllustratedMessage,
  Input,
  Label,
  Link,
  MultiComboBox,
  MultiComboBoxItem,
  Option,
  SegmentedButton,
  SegmentedButtonItem,
  Select,
  Text,
  ToggleButton,
} from "@ui5/webcomponents-react";
import { getAssignmentStatus, type AssignmentStatus } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { formatPersonType } from "@/lib/format";
import { personsWithoutJobTitle, recordsNeedingType, selectPersonRows } from "@/lib/domain/persons";
import { knownSkillIds } from "@/lib/domain/skillFilter";
import { COMPACT_QUERY, PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useCanScrollRight } from "@/hooks/useCanScrollRight";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { usePageState } from "@/hooks/usePageState";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY, compactStatusText, statusText } from "./statusDisplay";
import { csvFileName, downloadCsv, matrixCsv } from "./matrixCsv";
import { BulkAssignDialog } from "@/components/bulk/BulkAssignDialog";
import styles from "./SkillMatrix.module.css";

type StatusFilter = "all" | AssignmentStatus;

/** The status counters are filter buttons, coloured like their status (always with icon and text). */
const COUNTER_STATUSES = ["expiring", "expired", "valid", "upcoming"] as const;
const COUNTER_DESIGN = { expiring: "Attention", expired: "Negative", valid: "Positive", upcoming: "Default" } as const;

interface SkillMatrixProps {
  state: SkillDataState;
  onOpenCell: (person: Person, definition: SkillDefinition) => void;
  /** Shows all skills and certificates of one person. */
  onOpenPerson: (person: Person) => void;
  onGoToCatalogue: () => void;
}

export function SkillMatrix({ state, onOpenCell, onOpenPerson, onGoToCatalogue }: SkillMatrixProps) {
  const { data, assignmentByCell, certificatesBySkill } = state;
  const [personQuery, setPersonQuery] = usePageState("matrix.personQuery", "");
  const [skillIds, setSkillIds] = usePageState<string[]>("matrix.skillIds", []);
  const [statusFilter, setStatusFilter] = usePageState<StatusFilter>("matrix.statusFilter", "all");
  const [showAllRecords, setShowAllRecords] = usePageState("matrix.showAllRecords", false);
  const today = useToday();
  const isPhone = useMediaQuery(PHONE_QUERY);
  /** Below 1280 px: icon plus short date, narrower columns (the phone has its own cards). */
  const isCompact = useMediaQuery(COMPACT_QUERY) && !isPhone;
  const [scrollerRef, canScrollRight] = useCanScrollRight();
  const [bulkOpen, setBulkOpen] = useState(false);

  const definitions = useMemo(() => data?.definitions ?? [], [data]);
  /** The skill filter without skills deleted meanwhile; a filter on only deleted skills means "all skills". */
  const filterIds = knownSkillIds(skillIds, definitions);
  const visibleSkills = useMemo(() => (filterIds.length ? definitions.filter((d) => filterIds.includes(d.id)) : definitions), [definitions, filterIds]);
  // Forget deleted skills in the stored filter too (only with loaded data: before that nothing is known).
  useEffect(() => {
    if (data && filterIds !== skillIds) setSkillIds(filterIds);
  }, [data, filterIds, skillIds, setSkillIds]);

  const statusOf = (personId: string, tagId: string) => getAssignmentStatus(assignmentByCell.get(cellKey(personId, tagId)), today);

  const query = personQuery.trim().toLowerCase();
  /** One row per technician by default (see src/lib/domain/persons.ts). */
  const technicianRows = useMemo(() => selectPersonRows(data?.persons ?? [], state.assignedPersonIds, false), [data, state.assignedPersonIds]);
  const rows = showAllRecords ? (data?.persons ?? []) : technicianRows;
  /** Shown because they hold our skills, but not technicians: labelled in the row (see persons.ts). */
  const withoutJobTitle = useMemo(() => personsWithoutJobTitle(data?.persons ?? []), [data]);
  const technicianCount = technicianRows.filter((p) => !withoutJobTitle.has(p.id)).length;
  const extraCount = technicianRows.length - technicianCount;
  const visiblePersons = rows.filter((p) => {
    if (query && !`${p.name} ${p.jobTitle ?? ""}`.toLowerCase().includes(query)) return false;
    if (statusFilter === "all") return true;
    return visibleSkills.some((d) => statusOf(p.id, d.id) === statusFilter);
  });

  /** "ERP user" etc. only with "All person records", or where two records of one person are listed. */
  const needsType = recordsNeedingType(visiblePersons);
  const typeOf = (p: Person) => (showAllRecords || needsType.has(p.id) ? formatPersonType(p.type) : "");

  /** Counts over all rows and the visible skills (independent of the person and status filter). */
  const counts = { upcoming: 0, valid: 0, expiring: 0, expired: 0 };
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

  const filtersActive = Boolean(query || filterIds.length || statusFilter !== "all");

  /** Everything one cell (or one line of a phone card) shows. */
  const cellInfo = (p: Person, d: SkillDefinition) => {
    const assignment = assignmentByCell.get(cellKey(p.id, d.id));
    const status = getAssignmentStatus(assignment, today);
    const certCount = assignment ? (certificatesBySkill.get(assignment.id)?.length ?? 0) : 0;
    const text = statusText(status, assignment);
    const shortText = compactStatusText(status, assignment);
    const label = assignment
      ? `${p.name}, ${d.name}: ${text}${assignment.proficiencyName ? `, level ${assignment.proficiencyName}` : ""}, ${certCount ? `${certCount} certificate(s)` : "no certificate"}. Edit.`
      : `${p.name}, ${d.name}: not assigned. Assign.`;
    return { assignment, status, certCount, display: STATUS_DISPLAY[status], text, shortText, label };
  };

  /**
   * Status, end date, level and certificates; shared by the table cells and the phone cards.
   * Compact: the date only and the level cut short if needed; the full text is in the cell's tooltip and label.
   */
  const cellContent = (info: ReturnType<typeof cellInfo>, compact = false) =>
    info.assignment ? (
      <>
        <span className={styles.cellStatus} style={{ color: info.display.color }}>
          <Icon name={info.display.icon} className={styles.cellIcon} style={{ color: "inherit" }} />
          {compact ? info.shortText : info.text}
        </span>
        <span className={styles.cellMeta}>
          <span className={styles.level}>{info.assignment.proficiencyName ?? "No level"}</span>
          {info.certCount > 0 && (
            <span className={styles.cert}>
              <Icon name="attachment" className={styles.cellIcon} />
              {info.certCount}
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
    );

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
            <Option value="upcoming">With a skill that starts later</Option>
            <Option value="none">With a missing skill</Option>
          </Select>
        </div>
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
        <Button design="Transparent" icon="add-employee" className={styles.export} onClick={() => setBulkOpen(true)} disabled={visiblePersons.length === 0}>
          Assign to several…
        </Button>
        <Button
          design="Transparent"
          icon="excel-attachment"
          className={styles.exportNext}
          tooltip="Download the rows and skill columns shown now as a CSV file for Excel"
          onClick={() =>
            downloadCsv(
              matrixCsv(
                visiblePersons,
                visibleSkills,
                (personId, tagId) => assignmentByCell.get(cellKey(personId, tagId)),
                (assignmentId) => certificatesBySkill.get(assignmentId)?.length ?? 0,
                today,
              ),
              csvFileName(today),
            )
          }
          disabled={visiblePersons.length === 0}
        >
          Export CSV
        </Button>
      </div>

      <div className={styles.showRow}>
        <Label id="matrix-show-label" showColon>
          Show
        </Label>
        <SegmentedButton
          accessibleNameRef="matrix-show-label"
          onSelectionChange={(e) => setShowAllRecords(e.detail.selectedItems[0]?.dataset.key === "all")}
        >
          <SegmentedButtonItem data-key="technicians" selected={!showAllRecords}>
            Technicians ({technicianCount}
            {extraCount ? ` + ${extraCount}` : ""})
          </SegmentedButtonItem>
          <SegmentedButtonItem data-key="all" selected={showAllRecords}>
            All person records ({data.persons.length})
          </SegmentedButtonItem>
        </SegmentedButton>
        {showAllRecords && <Text className={styles.legend}>Includes the linked Employee records and people without a job title.</Text>}
      </div>

      <div className={styles.summary} aria-live="polite">
        {COUNTER_STATUSES.filter((s) => s !== "upcoming" || counts.upcoming > 0 || statusFilter === "upcoming").map((s) => (
          <ToggleButton
            key={s}
            design={COUNTER_DESIGN[s]}
            icon={STATUS_DISPLAY[s].icon}
            pressed={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            tooltip={statusFilter === s ? "Show all persons again" : `Show only persons with status “${STATUS_DISPLAY[s].label}”`}
          >
            {counts[s]} {STATUS_DISPLAY[s].label.toLowerCase()}
          </ToggleButton>
        ))}
        <span className={styles.legend}>
          <Icon name="attachment" className={styles.chipIcon} /> = certificate attached ·{" "}
          {isPhone ? "tap a skill to edit, “+” to assign" : "click a cell to assign or edit"}
        </span>
      </div>

      {visiblePersons.length === 0 ? (
        <IllustratedMessage name="NoFilterResults" titleText="No persons match the filters" subtitleText="Change or reset the filters." />
      ) : isPhone ? (
        // On a phone a wide matrix is hard to use: one card per person, skills stacked.
        <ul className={styles.cards}>
          {visiblePersons.map((p) => (
            <li key={p.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Link className={styles.personName} onClick={() => onOpenPerson(p)} accessibleName={`All skills of ${p.name}`}>
                  {p.name}
                </Link>
                <span className={styles.personMeta}>{[p.jobTitle, typeOf(p)].filter(Boolean).join(" · ")}</span>
              </div>
              <ul className={styles.cardSkills}>
                {visibleSkills
                  .map((d) => ({ d, info: cellInfo(p, d) }))
                  .filter(({ info }) => info.assignment)
                  .map(({ d, info }) => (
                    <li key={d.id} className={styles.cardSkill} data-status={info.status}>
                      <button type="button" className={styles.cellButton} onClick={() => onOpenCell(p, d)} aria-label={info.label}>
                        <span className={styles.cardSkillName}>{d.name}</span>
                        {cellContent(info)}
                      </button>
                    </li>
                  ))}
              </ul>
              {visibleSkills.some((d) => !assignmentByCell.has(cellKey(p.id, d.id))) && (
                <div className={styles.cardMissing}>
                  <span className={styles.personMeta}>Not assigned:</span>
                  {visibleSkills
                    .filter((d) => !assignmentByCell.has(cellKey(p.id, d.id)))
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={styles.assignChip}
                        onClick={() => onOpenCell(p, d)}
                        aria-label={`${p.name}, ${d.name}: not assigned. Assign.`}
                      >
                        <Icon name="add" className={styles.cellIcon} style={{ color: "inherit" }} />
                        {d.name}
                      </button>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div
          className={styles.scrollFrame}
          data-more-right={canScrollRight || undefined}
          style={{ "--skill-columns": visibleSkills.length } as CSSProperties}
        >
          <div className={styles.scroller} ref={scrollerRef}>
            <table className={styles.table} data-compact={isCompact || undefined}>
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
                      <Link className={styles.personName} onClick={() => onOpenPerson(p)} accessibleName={`All skills of ${p.name}`}>
                        {p.name}
                      </Link>
                      <span className={styles.personMeta}>
                        {/* The job title is hidden below 1024 px; the record type (when shown) keeps linked records apart. */}
                        {p.jobTitle && (
                          <span className={styles.jobTitle}>
                            {p.jobTitle}
                            {typeOf(p) ? " · " : ""}
                          </span>
                        )}
                        {typeOf(p)}
                      </span>
                    </th>
                    {visibleSkills.map((d) => {
                      const info = cellInfo(p, d);
                      return (
                        <td key={d.id} className={styles.cell} data-status={info.status}>
                          <button
                            type="button"
                            className={styles.cellButton}
                            onClick={() => onOpenCell(p, d)}
                            aria-label={info.label}
                            title={info.label}
                          >
                            {cellContent(info, isCompact)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {bulkOpen && <BulkAssignDialog persons={visiblePersons} state={state} onClose={() => setBulkOpen(false)} />}
    </div>
  );
}
