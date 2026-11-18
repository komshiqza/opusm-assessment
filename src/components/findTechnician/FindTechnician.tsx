"use client";

import { useMemo, type ReactNode } from "react";
import {
  DatePicker,
  Icon,
  IllustratedMessage,
  Label,
  Link,
  MultiComboBox,
  MultiComboBoxItem,
  Option,
  Panel,
  Select,
  Table,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  Title,
} from "@ui5/webcomponents-react";
import { checkSkillForJob, heldAcrossRecords, jobDayLabel, matchTechnicians, minimumLevelLabel } from "@/lib/domain/jobMatch";
import { normalizeEndDate } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { validateValidity } from "@/lib/domain/validation";
import { formatDate } from "@/lib/format";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { usePageState } from "@/hooks/usePageState";
import { useJobTitleFilter } from "@/hooks/useJobTitleFilter";
import { withJobTitles } from "@/lib/domain/jobTitleFilter";
import { findJobTitleStore } from "@/lib/jobTitleSelection";
import { JobTitleFilter } from "@/components/common/JobTitleFilter";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY } from "@/components/matrix/statusDisplay";
import { NoJobTitleTag } from "@/components/common/NoJobTitleTag";
import { t, tn } from "@/lib/i18n/t";
import styles from "./FindTechnician.module.css";

const ANY_LEVEL = "any";

interface FindTechnicianProps {
  state: SkillDataState;
  onOpen: (person: Person, definition: SkillDefinition, recordId?: string) => void;
  /** Shows all skills and certificates of one person, across all of their records. */
  onOpenPerson: (person: Person) => void;
}

/**
 * "Who can I send to this job on that day?" Works only on data the app already loaded:
 * no extra FSM calls, and no FSM jobs or requirements are read or written.
 */
export function FindTechnician({ state, onOpen, onOpenPerson }: FindTechnicianProps) {
  const today = useToday();
  const [skillIds, setSkillIds] = usePageState<string[]>("find.skillIds", []);
  /** "any" or a proficiency id. Not "": UI5's Select shows an empty value as "nothing selected". */
  const [minLevelId, setMinLevelId] = usePageState("find.minLevelId", ANY_LEVEL);
  /** null until the user picks a date: the job date then follows "today", also past midnight. */
  const [pickedJobDate, setJobDate] = usePageState<string | null>("find.jobDate", null);
  const jobDate = pickedJobDate ?? today;

  const definitions = useMemo(() => state.data?.definitions ?? [], [state.data]);
  const levels = state.data?.scale?.levels ?? [];
  const minLevel = levels.find((l) => l.id === minLevelId) ?? null;
  const required = definitions.filter((d) => skillIds.includes(d.id));
  const dateError = jobDate ? validateValidity(jobDate, null) : t("find.enterJobDate");

  /**
   * One row per real person (the shared list from UnifiedPerson, see src/lib/domain/persons.ts); each
   * skill counts with the best assignment across the person's Person records (ERP user, Employee).
   */
  const { options: titleOptions, selected: titleFilter } = useJobTitleFilter(findJobTitleStore, state.data?.persons);
  /** Only the people the Job title filter shows: the headline and every count below count only them. */
  const people = useMemo(
    () => withJobTitles(state.data?.persons ?? [], titleFilter).map((person) => ({ person, records: person.records })),
    [state.data, titleFilter],
  );
  const holder = heldAcrossRecords(people, (recordId, skillId) => state.assignmentByRecord.get(cellKey(recordId, skillId)), jobDate, today, minLevel);
  const lookup = (personId: string, skillId: string) => holder(personId, skillId)?.held;
  /** People without a job title are not technicians: listed after them, and only if they hold a required skill. */
  const result = dateError ? null : matchTechnicians(people.map((g) => g.person), required, lookup, jobDate, today, minLevel, (p) => Boolean(p.jobTitle));

  /** One cell: how this person's skill looks on the job date. Clicking it opens the record that holds it. */
  const skillCell = (person: Person, skill: SkillDefinition): ReactNode => {
    const holding = holder(person.id, skill.id);
    const held = holding?.held;
    const check = checkSkillForJob(held, skill, jobDate, today, minLevel);
    const certs = held ? (state.certificatesBySkill.get(held.id)?.length ?? 0) : 0;
    const end = normalizeEndDate(held?.endDate);
    const { status, label } = jobDayLabel(held, check, jobDate, today);
    const display = STATUS_DISPLAY[status];
    return (
      <button
        type="button"
        className={styles.cell}
        onClick={() => onOpen(person, skill, holding?.record.id)}
        title={check.reason ?? t("find.validOn", { skill: skill.name, date: formatDate(jobDate) })}
      >
        <span className={styles.status} style={{ color: display.color }}>
          <Icon name={display.icon} className={styles.icon} style={{ color: "inherit" }} />
          {label}
        </span>
        {held && (
          <span className={styles.meta}>
            {held.proficiencyName ?? t("common.noLevel")} · {end ? t("find.toDate", { date: formatDate(end) }) : t("find.noEndDate")}
            {certs > 0 && (
              <>
                {" "}
                <Icon name="attachment" className={styles.icon} />
                {certs}
              </>
            )}
          </span>
        )}
      </button>
    );
  };

  const personCell = (p: Person, technician: boolean) => (
    <TableCell>
      <span className={styles.person}>
        <Link onClick={() => onOpenPerson(p)} accessibleName={t("person.allSkills", { name: p.name })} className={styles.personLink}>
          {p.name}
        </Link>
        <span className={styles.muted}>{p.jobTitle}</span>
        {!technician && <NoJobTitleTag />}
      </span>
    </TableCell>
  );

  /** "2 technicians can do this job on 15.12.2026 (+1 person without a job title)" */
  const readyHeadline = (ready: { technician: boolean }[]) => {
    const technicians = ready.filter((r) => r.technician).length;
    const others = ready.length - technicians;
    const extra = others ? tn("find.withoutJobTitle", others) : "";
    const date = formatDate(jobDate);
    if (!ready.length) return t("find.nobody", { date });
    if (!technicians) return t("find.noTechnician", { date, extra });
    return tn("find.ready", technicians, { date, extra });
  };

  const header = (last: string) => (
    <TableHeaderRow sticky>
      <TableHeaderCell minWidth="12rem">{t("common.person")}</TableHeaderCell>
      {required.map((s) => (
        <TableHeaderCell key={s.id} minWidth="11rem">
          {s.name}
        </TableHeaderCell>
      ))}
      <TableHeaderCell minWidth="14rem">{last}</TableHeaderCell>
    </TableHeaderRow>
  );

  return (
    <div className={styles.wrapper}>
      <section className={styles.panel} aria-labelledby="find-title">
        <div className={styles.panelHeader}>
          <Title level="H4" id="find-title">
            {t("find.title")}
          </Title>
        </div>
        <div className={styles.form}>
          <div className={styles.field}>
            <Label for="find-skills" required>
              {t("find.requiredSkills")}
            </Label>
            <MultiComboBox
              id="find-skills"
              placeholder={t("find.chooseSkills")}
              onSelectionChange={(e) => setSkillIds(e.detail.items.map((i) => String(i.dataset.id)))}
            >
              {definitions.map((d) => (
                <MultiComboBoxItem key={d.id} data-id={d.id} text={d.name} selected={skillIds.includes(d.id)} />
              ))}
            </MultiComboBox>
          </div>
          <div className={styles.fieldSmall}>
            <Label for="find-level">{t("find.minLevel")}</Label>
            <Select id="find-level" value={minLevelId} onChange={(e) => setMinLevelId(e.detail.selectedOption.value ?? ANY_LEVEL)}>
              <Option value={ANY_LEVEL}>{t("find.anyLevel")}</Option>
              {levels.map((l) => (
                <Option key={l.id} value={l.id}>
                  {minimumLevelLabel(l, levels)}
                </Option>
              ))}
            </Select>
          </div>
          <div className={styles.fieldSmall}>
            <Label for="find-date" required>
              {t("find.jobDate")}
            </Label>
            <DatePicker
              id="find-date"
              value={jobDate}
              valueFormat="yyyy-MM-dd"
              displayFormat="dd.MM.yyyy"
              valueState={dateError ? "Negative" : "None"}
              valueStateMessage={<div>{dateError}</div>}
              onChange={(e) => setJobDate(e.target.value ?? "")}
            />
          </div>
          <div className={styles.field}>
            <Label for="find-job-title">{t("matrix.jobTitles")}</Label>
            <JobTitleFilter id="find-job-title" options={titleOptions} selected={titleFilter} onChange={findJobTitleStore.save} />
          </div>
        </div>
      </section>

      {required.length === 0 || !result ? (
        <IllustratedMessage
          // Nothing searched yet: SAP's "BeforeSearch" illustration; an invalid job date keeps "NoData".
          name={dateError ? "NoData" : "BeforeSearch"}
          titleText={dateError ? t("find.checkDate") : t("find.chooseTitle")}
          subtitleText={dateError ?? t("find.chooseHint")}
        />
      ) : (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <Title level="H4" style={{ color: result.ready.length ? "var(--sapPositiveTextColor)" : undefined }}>
                {readyHeadline(result.ready)}
              </Title>
            </div>
            {result.ready.length > 0 && (
              <Table overflowMode="Popin" headerRow={header(t("find.result"))}>
                {result.ready.map(({ person, technician }) => (
                  <TableRow key={person.id} rowKey={person.id}>
                    {personCell(person, technician)}
                    {required.map((s) => (
                      <TableCell key={s.id}>{skillCell(person, s)}</TableCell>
                    ))}
                    <TableCell>
                      <Text style={{ color: "var(--sapPositiveTextColor)", fontWeight: "bold" }}>{t("find.canDo")}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <Title level="H4">
                {t("find.almostTitle", { n: result.almost.length, date: formatDate(jobDate) })}
              </Title>
            </div>
            {result.almost.length > 0 ? (
              <Table overflowMode="Popin" headerRow={header(t("find.whyNot"))}>
                {result.almost.map(({ person, reason, technician }) => (
                  <TableRow key={person.id} rowKey={person.id}>
                    {personCell(person, technician)}
                    {required.map((s) => (
                      <TableCell key={s.id}>{skillCell(person, s)}</TableCell>
                    ))}
                    <TableCell>
                      <Text style={{ color: "var(--sapNegativeTextColor)", fontWeight: "bold" }}>{reason}</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            ) : (
              <Text className={styles.padded}>{t("find.almostNone")}</Text>
            )}
            {result.missingOne.length > 0 && (
              // Collapsed: with one required skill this is nearly everyone, and not having a skill cannot be fixed before the job.
              <Panel
                collapsed
                className={styles.missingPanel}
                headerText={
                  required.length === 1
                    ? tn("find.missingThis", result.missingOne.length)
                    : tn("find.missingOne", result.missingOne.length)
                }
              >
                <ul className={styles.missingList}>
                  {result.missingOne.map(({ person, skillName, technician }) => (
                    <li key={person.id}>
                      <b>{person.name}</b>
                      {required.length > 1 && <span className={styles.muted}> · {t("find.missingSkill", { skill: skillName })}</span>}
                      {!technician && (
                        <>
                          {" "}
                          <NoJobTitleTag />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {result.others > 0 && (
              <Text className={`${styles.muted} ${styles.padded}`}>
                {tn("find.others", result.others)}
              </Text>
            )}
          </section>
        </>
      )}
    </div>
  );
}
