"use client";

import { useMemo, type ReactNode } from "react";
import {
  DatePicker,
  Icon,
  IllustratedMessage,
  Label,
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
import { checkSkillForJob, matchTechnicians } from "@/lib/domain/jobMatch";
import { normalizeEndDate } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { validateValidity } from "@/lib/domain/validation";
import { personsWithoutJobTitle, recordsNeedingType, selectPersonRows } from "@/lib/domain/persons";
import { formatDate, formatPersonType } from "@/lib/format";
import { cellKey, type SkillDataState } from "@/hooks/useSkillData";
import { usePageState } from "@/hooks/usePageState";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY } from "@/components/matrix/statusDisplay";
import { NoJobTitleTag } from "@/components/common/NoJobTitleTag";
import styles from "./FindTechnician.module.css";

const ANY_LEVEL = "any";

interface FindTechnicianProps {
  state: SkillDataState;
  onOpen: (person: Person, definition: SkillDefinition) => void;
}

/**
 * "Who can I send to this job on that day?" Works only on data the app already loaded:
 * no extra FSM calls, and no FSM jobs or requirements are read or written.
 */
export function FindTechnician({ state, onOpen }: FindTechnicianProps) {
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
  const dateError = jobDate ? validateValidity(jobDate, null) : "Please enter the job date.";

  const persons = useMemo(() => selectPersonRows(state.data?.persons ?? [], state.assignedPersonIds, false), [state.data, state.assignedPersonIds]);
  /** "ERP user" etc. only where two records of one person are listed (one row per person otherwise). */
  const needsType = useMemo(() => recordsNeedingType(persons), [persons]);
  const lookup = (personId: string, skillId: string) => state.assignmentByCell.get(cellKey(personId, skillId));
  const withoutJobTitle = useMemo(() => personsWithoutJobTitle(state.data?.persons ?? []), [state.data]);
  const result = dateError ? null : matchTechnicians(persons, required, lookup, jobDate, today, minLevel, (p) => !withoutJobTitle.has(p.id));

  /** One cell: how this person's skill looks on the job date. Clicking it opens the assignment. */
  const skillCell = (person: Person, skill: SkillDefinition): ReactNode => {
    const held = lookup(person.id, skill.id);
    const check = checkSkillForJob(held, skill, jobDate, today, minLevel);
    const certs = held ? (state.certificatesBySkill.get(held.id)?.length ?? 0) : 0;
    const end = normalizeEndDate(held?.endDate);
    const startsLater = Boolean(held?.startDate && held.startDate > jobDate);
    const [display, label] = !held
      ? [STATUS_DISPLAY.none, "Not assigned"]
      : check.ok
        ? [STATUS_DISPLAY.valid, "Valid on job day"]
        : end && end < jobDate
          ? [end < today ? STATUS_DISPLAY.expired : STATUS_DISPLAY.expiring, `Ends ${formatDate(end)}`]
          : startsLater
            ? [STATUS_DISPLAY.upcoming, `Starts ${formatDate(held.startDate)}`]
            : [STATUS_DISPLAY.expiring, "Level too low"];
    return (
      <button
        type="button"
        className={styles.cell}
        onClick={() => onOpen(person, skill)}
        title={check.reason ?? `${skill.name}: valid on ${formatDate(jobDate)}`}
      >
        <span className={styles.status} style={{ color: display.color }}>
          <Icon name={display.icon} className={styles.icon} style={{ color: "inherit" }} />
          {label}
        </span>
        {held && (
          <span className={styles.meta}>
            {held.proficiencyName ?? "No level"} · {end ? `to ${formatDate(end)}` : "no end date"}
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
        <b>{p.name}</b>
        <span className={styles.muted}>{[p.jobTitle, needsType.has(p.id) ? formatPersonType(p.type) : ""].filter(Boolean).join(" · ")}</span>
        {!technician && <NoJobTitleTag />}
      </span>
    </TableCell>
  );

  /** "2 technicians can do this job on 15.12.2026 (+1 person without a job title)" */
  const readyHeadline = (ready: { technician: boolean }[]) => {
    const technicians = ready.filter((r) => r.technician).length;
    const others = ready.length - technicians;
    const extra = others ? ` (+${others} ${others === 1 ? "person" : "people"} without a job title)` : "";
    if (!ready.length) return `Nobody can do this job on ${formatDate(jobDate)}`;
    if (!technicians) return `No technician can do this job on ${formatDate(jobDate)}${extra}`;
    return `${technicians} technician${technicians === 1 ? "" : "s"} can do this job on ${formatDate(jobDate)}${extra}`;
  };

  const header = (last: string) => (
    <TableHeaderRow sticky>
      <TableHeaderCell minWidth="12rem">Person</TableHeaderCell>
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
            Who can do the job?
          </Title>
        </div>
        <div className={styles.form}>
          <div className={styles.field}>
            <Label for="find-skills" required>
              Required skills
            </Label>
            <MultiComboBox
              id="find-skills"
              placeholder="Choose skills"
              onSelectionChange={(e) => setSkillIds(e.detail.items.map((i) => String(i.dataset.id)))}
            >
              {definitions.map((d) => (
                <MultiComboBoxItem key={d.id} data-id={d.id} text={d.name} selected={skillIds.includes(d.id)} />
              ))}
            </MultiComboBox>
          </div>
          <div className={styles.fieldSmall}>
            <Label for="find-level">Minimum level</Label>
            <Select id="find-level" value={minLevelId} onChange={(e) => setMinLevelId(e.detail.selectedOption.value ?? ANY_LEVEL)}>
              <Option value={ANY_LEVEL}>Any level</Option>
              {levels.map((l) => (
                <Option key={l.id} value={l.id}>
                  {l.name} or higher
                </Option>
              ))}
            </Select>
          </div>
          <div className={styles.fieldSmall}>
            <Label for="find-date" required>
              Job date
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
        </div>
      </section>

      {required.length === 0 || !result ? (
        <IllustratedMessage
          name="NoData"
          titleText={dateError ? "Check the job date" : "Choose the skills the job needs"}
          subtitleText={dateError ?? "The app then lists who can do the job on that day, and who is missing just one skill."}
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
              <Table overflowMode="Popin" headerRow={header("Result")}>
                {result.ready.map(({ person, technician }) => (
                  <TableRow key={person.id} rowKey={person.id}>
                    {personCell(person, technician)}
                    {required.map((s) => (
                      <TableCell key={s.id}>{skillCell(person, s)}</TableCell>
                    ))}
                    <TableCell>
                      <Text style={{ color: "var(--sapPositiveTextColor)", fontWeight: "bold" }}>Can do the job</Text>
                    </TableCell>
                  </TableRow>
                ))}
              </Table>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <Title level="H4">
                Almost ({result.almost.length}): one skill to renew, raise to the level, or that starts too late for {formatDate(jobDate)}
              </Title>
            </div>
            {result.almost.length > 0 ? (
              <Table overflowMode="Popin" headerRow={header("Why not")}>
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
              <Text className={styles.padded}>Nobody is just one renewal, level or start date away.</Text>
            )}
            {result.missingOne.length > 0 && (
              // Collapsed: with one required skill this is nearly everyone, and not having a skill cannot be fixed before the job.
              <Panel
                collapsed
                className={styles.missingPanel}
                headerText={
                  required.length === 1
                    ? `${result.missingOne.length} ${result.missingOne.length === 1 ? "person doesn't" : "people don't"} have this skill`
                    : `${result.missingOne.length} ${result.missingOne.length === 1 ? "person is" : "people are"} missing one of these skills`
                }
              >
                <ul className={styles.missingList}>
                  {result.missingOne.map(({ person, skillName, technician }) => (
                    <li key={person.id}>
                      <b>{person.name}</b>
                      {required.length > 1 && <span className={styles.muted}> · Missing: {skillName}</span>}
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
                {result.others} other technician{result.others === 1 ? "" : "s"} miss two or more of these skills.
              </Text>
            )}
          </section>
        </>
      )}
    </div>
  );
}
