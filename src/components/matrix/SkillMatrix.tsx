"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  Button,
  Icon,
  IllustratedMessage,
  Input,
  Label,
  Link,
  MultiComboBox,
  MultiComboBoxItem,
  Title,
  ToggleButton,
} from "@ui5/webcomponents-react";
import { getAssignmentStatus } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { alsoOnNote, linkedRecordNote } from "@/lib/format";
import { knownSkillIds } from "@/lib/domain/skillFilter";
import { NO_JOB_TITLE, isStartJobTitleSelection, jobTitleOptions, knownJobTitles, selectedJobTitles } from "@/lib/domain/jobTitleFilter";
import { COMPACT_QUERY, PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useCanScrollRight } from "@/hooks/useCanScrollRight";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { usePageState } from "@/hooks/usePageState";
import { parseJobTitleSelection, readStoredJobTitles, resetJobTitles, saveJobTitles, subscribeJobTitles } from "@/lib/jobTitleSelection";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY, compactStatusText, statusText } from "./statusDisplay";
import { csvFileName, downloadCsv, matrixCsv } from "./matrixCsv";
import { COUNTER_STATUSES, countStatuses, filterMatrixRows, peopleTitle, toStatusFilter, type StatusFilter } from "./matrixRows";
import { t, tn } from "@/lib/i18n/t";
import { BulkAssignDialog } from "@/components/bulk/BulkAssignDialog";
import styles from "./SkillMatrix.module.css";

/** The status counters are the status filter, coloured like their status (always with icon and text). */
const COUNTER_DESIGN = { expiring: "Attention", expired: "Negative", valid: "Positive", upcoming: "Default" } as const;

interface SkillMatrixProps {
  state: SkillDataState;
  onOpenCell: (person: Person, definition: SkillDefinition) => void;
  /** Shows all skills and certificates of one person. */
  onOpenPerson: (person: Person) => void;
  onGoToCatalogue: () => void;
}

export function SkillMatrix({ state, onOpenCell, onOpenPerson, onGoToCatalogue }: SkillMatrixProps) {
  const { data, assignmentByCell, alsoOnByCell, certificatesBySkill } = state;
  const [personQuery, setPersonQuery] = usePageState("matrix.personQuery", "");
  const [skillIds, setSkillIds] = usePageState<string[]>("matrix.skillIds", []);
  /** Kept in this browser across reloads, like the tab order; null until the user chooses (start selection). */
  const storedJobTitles = useSyncExternalStore(subscribeJobTitles, readStoredJobTitles, () => "");
  const jobTitles = useMemo(() => parseJobTitleSelection(storedJobTitles), [storedJobTitles]);
  const [storedStatusFilter, setStatusFilter] = usePageState<StatusFilter>("matrix.statusFilter", "all");
  const statusFilter = toStatusFilter(storedStatusFilter);
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

  /** Job titles of all loaded persons; the start selection or the user's choice, without titles nobody has any more. */
  const titleOptions = useMemo(() => jobTitleOptions(data?.persons ?? []), [data]);
  const titleFilter = useMemo(() => selectedJobTitles(jobTitles, titleOptions), [jobTitles, titleOptions]);
  // Forget unknown titles in the stored choice too (only with loaded data: before that nothing is known).
  useEffect(() => {
    if (!data || jobTitles === null) return;
    const known = knownJobTitles(jobTitles, titleOptions);
    if (known !== jobTitles) saveJobTitles(known);
  }, [data, jobTitles, titleOptions]);

  const statusOf = (personId: string, tagId: string) => getAssignmentStatus(assignmentByCell.get(cellKey(personId, tagId)), today);

  const query = personQuery.trim().toLowerCase();
  /** One row per real person (FSM UnifiedPerson, see src/lib/domain/persons.ts). */
  const rows = data?.persons ?? [];
  /** The rows shown; the CSV export and Bulk assign take exactly these. */
  const visiblePersons = filterMatrixRows(rows, { query, jobTitles: titleFilter, statusFilter, skills: visibleSkills, statusOf });

  /**
   * Counts over the people shown (name search and Job title filter) and the visible skills, so a
   * counter matches what clicking it lists. Independent of the status filter, so the user can switch.
   */
  const counts = countStatuses(rows, { query, jobTitles: titleFilter, skills: visibleSkills, statusOf });

  if (!data) return null;

  if (definitions.length === 0) {
    return (
      <IllustratedMessage name="NoEntries" titleText={t("matrix.noSkills")} subtitleText={t("matrix.noSkillsHint")}>
        <Button design="Emphasized" icon="add" onClick={onGoToCatalogue}>
          {t("matrix.goToCatalogue")}
        </Button>
      </IllustratedMessage>
    );
  }

  /** Anything Reset would change (the job titles reset to the start selection, not to nothing). */
  const filtersActive = Boolean(query || !isStartJobTitleSelection(titleFilter, titleOptions) || filterIds.length || statusFilter !== "all");

  /**
   * Where a person's skill sits when not on their main record ("on Employee record"), and a second
   * assignment of it on another record ("also on Employee record"; it opens from the person view).
   */
  const notesOf = (p: Person, tagId: string) => {
    const assignment = assignmentByCell.get(cellKey(p.id, tagId));
    const others = (alsoOnByCell.get(cellKey(p.id, tagId)) ?? []).map((a) => a.personId);
    return [assignment ? linkedRecordNote(p, assignment.personId) : "", alsoOnNote(p, others)].filter(Boolean);
  };

  /** Everything one cell (or one line of a phone card) shows. */
  const cellInfo = (p: Person, d: SkillDefinition) => {
    const assignment = assignmentByCell.get(cellKey(p.id, d.id));
    const status = getAssignmentStatus(assignment, today);
    const certCount = assignment ? (certificatesBySkill.get(assignment.id)?.length ?? 0) : 0;
    const text = statusText(status, assignment);
    const shortText = compactStatusText(status, assignment);
    const notes = notesOf(p, d.id);
    const label = assignment
      ? t("matrix.cellLabel", {
          person: p.name,
          skill: d.name,
          status: notes.length ? `${text} (${notes.join("; ")})` : text,
          level: assignment.proficiencyName ? t("matrix.cellLevel", { level: assignment.proficiencyName }) : "",
          certificates: certCount ? tn("matrix.cellCertificates", certCount) : t("matrix.cellNoCertificate"),
        })
      : t("matrix.cellNotAssigned", { person: p.name, skill: d.name });
    return { assignment, notes, status, certCount, display: STATUS_DISPLAY[status], text, shortText, label };
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
        {info.notes.length > 0 && <span className={styles.recordNote}>{info.notes.join(" · ")}</span>}
      </>
    ) : (
      <span className={styles.empty}>
        <span aria-hidden>–</span>
        <span className={styles.assignHint}>
          <Icon name="add" className={styles.cellIcon} style={{ color: "inherit" }} /> {t("common.assign")}
        </span>
      </span>
    );

  /** What the paperclip means and how to open a cell; next to the table title (Fiori: title group on the left). */
  const legend = (
    <span className={styles.legend}>
      <Icon name="attachment" className={styles.chipIcon} /> {t("matrix.legend")} · {isPhone ? t("matrix.legendPhone") : t("matrix.legendDesktop")}
    </span>
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} role="search">
        <div className={styles.field}>
          <Label for="matrix-person-filter">{t("common.person")}</Label>
          <Input
            id="matrix-person-filter"
            icon={<Icon name="search" />}
            placeholder={t("matrix.personFilter")}
            value={personQuery}
            onInput={(e) => setPersonQuery(e.target.value ?? "")}
            showClearIcon
          />
        </div>
        <div className={styles.field}>
          <Label for="matrix-job-title-filter">{t("matrix.jobTitles")}</Label>
          <MultiComboBox
            id="matrix-job-title-filter"
            placeholder={t("matrix.allJobTitles")}
            onSelectionChange={(e) => saveJobTitles(e.detail.items.map((i) => String(i.dataset.id)))}
          >
            {titleOptions.map((title) => (
              <MultiComboBoxItem
                key={title}
                data-id={title}
                text={title === NO_JOB_TITLE ? t("matrix.noJobTitle") : title}
                selected={titleFilter.includes(title)}
              />
            ))}
          </MultiComboBox>
        </div>
        <div className={styles.field}>
          <Label for="matrix-skill-filter">{t("matrix.skills")}</Label>
          <MultiComboBox
            id="matrix-skill-filter"
            placeholder={t("matrix.allSkills")}
            onSelectionChange={(e) => setSkillIds(e.detail.items.map((i) => String(i.dataset.id)))}
          >
            {definitions.map((d) => (
              <MultiComboBoxItem key={d.id} data-id={d.id} text={d.name} selected={skillIds.includes(d.id)} />
            ))}
          </MultiComboBox>
        </div>
        {filtersActive && (
          <Button
            design="Transparent"
            className={styles.reset}
            onClick={() => {
              setPersonQuery("");
              resetJobTitles();
              setSkillIds([]);
              setStatusFilter("all");
            }}
          >
            {t("matrix.resetFilters")}
          </Button>
        )}
      </div>

      <div className={styles.summary} aria-live="polite">
        {COUNTER_STATUSES.filter((s) => s !== "upcoming" || counts.upcoming > 0 || statusFilter === "upcoming").map((s) => (
          <ToggleButton
            key={s}
            design={COUNTER_DESIGN[s]}
            className={s === "upcoming" ? styles.counterInformation : undefined}
            icon={STATUS_DISPLAY[s].icon}
            pressed={statusFilter === s}
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            tooltip={statusFilter === s ? t("matrix.counterShowAll") : t("matrix.counterShowOnly", { status: STATUS_DISPLAY[s].label })}
          >
            {tn(`matrix.counter.${s}`, counts[s])}
          </ToggleButton>
        ))}
      </div>

      {/* Table toolbar (Fiori: title with item counter on the left, the table's actions on the right). */}
      <div className={styles.tableToolbar}>
        <Title level="H4" id="matrix-title">
          {peopleTitle(visiblePersons.length)}
        </Title>
        {!isPhone && legend}
        <div className={styles.tableActions}>
          <Button design="Transparent" icon="add-employee" onClick={() => setBulkOpen(true)} disabled={visiblePersons.length === 0}>
            {t("matrix.bulk")}
          </Button>
          {/* Fiori table toolbar: business actions first, then each further group (here: export) after a separator. */}
          <span className={styles.toolbarSeparator} role="separator" aria-orientation="vertical" />
          <Button
            design="Transparent"
            icon="excel-attachment"
            tooltip={t("matrix.exportTooltip")}
            onClick={() =>
              downloadCsv(
                matrixCsv(
                  visiblePersons,
                  (person, tagId) => notesOf(person, tagId).join("; "),
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
            {t("matrix.export")}
          </Button>
        </div>
      </div>

      {/* Phone: no room next to the title, so the legend gets its own line, right above the cards. */}
      {isPhone && legend}

      {visiblePersons.length === 0 ? (
        <IllustratedMessage name="NoFilterResults" titleText={t("matrix.noMatch")} subtitleText={t("matrix.noMatchHint")} />
      ) : isPhone ? (
        // On a phone a wide matrix is hard to use: one card per person, skills stacked.
        <ul className={styles.cards} aria-labelledby="matrix-title">
          {visiblePersons.map((p) => (
            <li key={p.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Link className={styles.personName} onClick={() => onOpenPerson(p)} accessibleName={t("person.allSkills", { name: p.name })}>
                  {p.name}
                </Link>
                {p.jobTitle && <span className={styles.personMeta}>{p.jobTitle}</span>}
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
                  <span className={styles.personMeta}>{t("matrix.notAssignedList")}</span>
                  {visibleSkills
                    .filter((d) => !assignmentByCell.has(cellKey(p.id, d.id)))
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={styles.assignChip}
                        onClick={() => onOpenCell(p, d)}
                        aria-label={t("matrix.cellNotAssigned", { person: p.name, skill: d.name })}
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
            <table className={styles.table} data-compact={isCompact || undefined} aria-labelledby="matrix-title">
              <thead>
                <tr>
                  <th scope="col" className={styles.corner}>
                    {t("common.person")}
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
                      <Link className={styles.personName} onClick={() => onOpenPerson(p)} accessibleName={t("person.allSkills", { name: p.name })}>
                        {p.name}
                      </Link>
                      {/* The job title is hidden below 1024 px. */}
                      {p.jobTitle && (
                        <span className={styles.personMeta}>
                          <span className={styles.jobTitle}>{p.jobTitle}</span>
                        </span>
                      )}
                    </th>
                    {visibleSkills.map((d) => {
                      const info = cellInfo(p, d);
                      return (
                        <td key={d.id} className={styles.cell} data-status={info.status}>
                          <button type="button" className={styles.cellButton} onClick={() => onOpenCell(p, d)} aria-label={info.label} title={info.label}>
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
