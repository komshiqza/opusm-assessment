"use client";

import { useMemo } from "react";
import {
  CheckBox,
  Icon,
  IllustratedMessage,
  Label,
  Link,
  Option,
  Select,
  Table,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
} from "@ui5/webcomponents-react";
import { addDays } from "@/lib/domain/status";
import { useToday } from "@/hooks/useToday";
import { formatDate, linkedRecordNote } from "@/lib/format";
import { t, tn } from "@/lib/i18n/t";
import { expiryStatus } from "./expiryStatus";
import type { SkillDataState } from "@/hooks/useSkillData";
import { usePageState } from "@/hooks/usePageState";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY } from "@/components/matrix/statusDisplay";

const WINDOWS = [30, 60, 90, 180, 365];

interface ExpiryOverviewProps {
  state: SkillDataState;
  onOpen: (person: Person, definition: SkillDefinition, recordId?: string) => void;
  /** Shows all skills and certificates of one person. */
  onOpenPerson: (person: Person) => void;
}

/** Everything that ends within the next N days (and optionally what has already expired), soonest first. */
export function ExpiryOverview({ state, onOpen, onOpenPerson }: ExpiryOverviewProps) {
  const [days, setDays] = usePageState("expiry.days", 30);
  const [includeExpired, setIncludeExpired] = usePageState("expiry.includeExpired", true);
  const today = useToday();
  const until = addDays(today, days);

  const rows = useMemo(() => {
    const definitions = new Map((state.data?.definitions ?? []).map((d) => [d.id, d]));
    return (state.data?.assignments ?? [])
      .filter((a) => a.endDate && a.endDate <= until && (includeExpired || a.endDate >= today))
      .flatMap((a) => {
        const person = state.personOfRecord(a.personId); // undefined: no active person, not listed
        const definition = definitions.get(a.tagId);
        return person && definition ? [{ assignment: a, person, definition, endDate: a.endDate! }] : [];
      })
      .sort((x, y) => x.endDate.localeCompare(y.endDate) || x.person.name.localeCompare(y.person.name));
  }, [state, until, today, includeExpired]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "0.75rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.75rem 1.5rem" }}>
        <div style={{ display: "grid", gap: "0.25rem" }}>
          <Label for="expiry-window">{t("expiry.endsWithin")}</Label>
          <Select id="expiry-window" value={String(days)} onChange={(e) => setDays(Number(e.detail.selectedOption.value))}>
            {WINDOWS.map((d) => (
              <Option key={d} value={String(d)}>
                {t("expiry.days", { n: d })}
              </Option>
            ))}
          </Select>
        </div>
        <CheckBox text={t("expiry.includeExpired")} checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
        <Text style={{ color: "var(--sapContent_LabelColor)" }}>
          {tn("expiry.summary", rows.length, { date: formatDate(until) })}
        </Text>
      </div>

      {rows.length === 0 ? (
        <IllustratedMessage name="NoData" titleText={t("expiry.nothing")} subtitleText={t("expiry.nothingHint")} />
      ) : (
        <Table
          overflowMode="Popin"
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell minWidth="9rem">{t("expiry.endsOn")}</TableHeaderCell>
              <TableHeaderCell minWidth="10rem">{t("common.status")}</TableHeaderCell>
              <TableHeaderCell minWidth="12rem">{t("common.person")}</TableHeaderCell>
              <TableHeaderCell minWidth="12rem">{t("common.skill")}</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">{t("common.level")}</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">{t("common.certificates")}</TableHeaderCell>
            </TableHeaderRow>
          }
        >
          {rows.map(({ assignment, person, definition, endDate }) => {
            const { status, text } = expiryStatus({ startDate: assignment.startDate, endDate }, today);
            const certs = state.certificatesBySkill.get(assignment.id)?.length ?? 0;
            return (
              <TableRow key={assignment.id} rowKey={assignment.id}>
                <TableCell>
                  <Link onClick={() => onOpen(person, definition, assignment.personId)} accessibleName={t("expiry.open", { skill: definition.name, person: person.name })}>
                    {formatDate(endDate)}
                  </Link>
                </TableCell>
                <TableCell>
                  <span
                    style={{ color: STATUS_DISPLAY[status].color, fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "0.375rem" }}
                  >
                    <Icon name={STATUS_DISPLAY[status].icon} style={{ color: "inherit", width: "1rem", height: "1rem" }} />
                    {text}
                  </span>
                </TableCell>
                <TableCell>
                  <Text>
                    <Link onClick={() => onOpenPerson(person)} accessibleName={t("person.allSkills", { name: person.name })} style={{ fontWeight: "bold" }}>
                      {person.name}
                    </Link>
                    {linkedRecordNote(person, assignment.personId) ? ` · ${linkedRecordNote(person, assignment.personId)}` : ""}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text>{definition.name}</Text>
                </TableCell>
                <TableCell>
                  <Text>{assignment.proficiencyName ?? "–"}</Text>
                </TableCell>
                <TableCell>
                  <Text>{certs || "–"}</Text>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </div>
  );
}
