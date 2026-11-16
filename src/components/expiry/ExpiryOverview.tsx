"use client";

import { useMemo, useState } from "react";
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
import { addDays, daysBetween, getAssignmentStatus, todayIso } from "@/lib/domain/status";
import { formatDate, formatPersonType } from "@/lib/format";
import type { SkillDataState } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { STATUS_DISPLAY } from "@/components/matrix/statusDisplay";

const WINDOWS = [30, 60, 90, 180, 365];

interface ExpiryOverviewProps {
  state: SkillDataState;
  onOpen: (person: Person, definition: SkillDefinition) => void;
}

/** Everything that ends within the next N days (and optionally what has already expired), soonest first. */
export function ExpiryOverview({ state, onOpen }: ExpiryOverviewProps) {
  const [days, setDays] = useState(30);
  const [includeExpired, setIncludeExpired] = useState(true);
  const today = todayIso();
  const until = addDays(today, days);

  const rows = useMemo(() => {
    const persons = new Map((state.data?.persons ?? []).map((p) => [p.id, p]));
    const definitions = new Map((state.data?.definitions ?? []).map((d) => [d.id, d]));
    return (state.data?.assignments ?? [])
      .filter((a) => a.endDate && a.endDate <= until && (includeExpired || a.endDate >= today))
      .flatMap((a) => {
        const person = persons.get(a.personId);
        const definition = definitions.get(a.tagId);
        return person && definition ? [{ assignment: a, person, definition, endDate: a.endDate! }] : [];
      })
      .sort((x, y) => x.endDate.localeCompare(y.endDate) || x.person.name.localeCompare(y.person.name));
  }, [state.data, until, today, includeExpired]);

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "0.75rem 1.5rem" }}>
        <div style={{ display: "grid", gap: "0.25rem" }}>
          <Label for="expiry-window">Ends within</Label>
          <Select id="expiry-window" value={String(days)} onChange={(e) => setDays(Number(e.detail.selectedOption.value))}>
            {WINDOWS.map((d) => (
              <Option key={d} value={String(d)}>
                the next {d} days
              </Option>
            ))}
          </Select>
        </div>
        <CheckBox text="Include already expired" checked={includeExpired} onChange={(e) => setIncludeExpired(e.target.checked)} />
        <Text style={{ color: "var(--sapContent_LabelColor)" }}>
          {rows.length} assignment{rows.length === 1 ? "" : "s"} · until {formatDate(until)}
        </Text>
      </div>

      {rows.length === 0 ? (
        <IllustratedMessage name="NoData" titleText="Nothing ends in this period" subtitleText="Choose a longer period to look further ahead." />
      ) : (
        <Table
          overflowMode="Popin"
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell minWidth="9rem">Ends on</TableHeaderCell>
              <TableHeaderCell minWidth="10rem">Status</TableHeaderCell>
              <TableHeaderCell minWidth="12rem">Person</TableHeaderCell>
              <TableHeaderCell minWidth="12rem">Skill</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">Level</TableHeaderCell>
              <TableHeaderCell minWidth="7rem">Certificates</TableHeaderCell>
            </TableHeaderRow>
          }
        >
          {rows.map(({ assignment, person, definition, endDate }) => {
            const status = getAssignmentStatus(assignment, today);
            const left = daysBetween(today, endDate);
            const certs = state.certificatesBySkill.get(assignment.id)?.length ?? 0;
            return (
              <TableRow key={assignment.id} rowKey={assignment.id}>
                <TableCell>
                  <Link onClick={() => onOpen(person, definition)} accessibleName={`Open ${definition.name} of ${person.name}`}>
                    {formatDate(endDate)}
                  </Link>
                </TableCell>
                <TableCell>
                  <span style={{ color: STATUS_DISPLAY[status].color, fontWeight: "bold", display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                    <Icon name={STATUS_DISPLAY[status].icon} style={{ color: "inherit", width: "1rem", height: "1rem" }} />
                    {left < 0 ? `Expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "Ends today" : `${left} day${left === 1 ? "" : "s"} left`}
                  </span>
                </TableCell>
                <TableCell>
                  <Text>
                    <b>{person.name}</b> · {formatPersonType(person.type)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text>{definition.name}</Text>
                </TableCell>
                <TableCell>
                  <Text>{assignment.proficiencyName ?? "–"}</Text>
                </TableCell>
                <TableCell>
                  <Text>{certs || "None"}</Text>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </div>
  );
}
