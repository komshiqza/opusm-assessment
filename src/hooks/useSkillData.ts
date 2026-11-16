"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAssignments, loadCertificates, loadPersons, loadScale, loadSkillDefinitions } from "@/lib/skills/repository";
import type { Assignment, Certificate, Person, ProficiencyScale, SkillDefinition } from "@/lib/skills/types";
import { toUserMessage } from "@/lib/errors";
import { createLatestLoader } from "@/lib/latestLoader";
import { cellKey, placeAssignments } from "@/lib/domain/persons";

export { cellKey };

export interface SkillData {
  /** One entry per real person (FSM UnifiedPerson), see src/lib/domain/persons.ts */
  persons: Person[];
  definitions: SkillDefinition[];
  assignments: Assignment[];
  certificates: Certificate[];
  scale: ProficiencyScale | null;
}

export interface SkillDataState {
  data: SkillData | null;
  /** first load still running */
  loading: boolean;
  /** a reload after a change is running (the old data stays visible) */
  refreshing: boolean;
  error: string | null;
  /**
   * Reloads everything from FSM (6-7 requests in total, independent of the number of persons).
   * Resolves to false when the reload failed: the screen then still shows the old data, and a
   * dialog that just saved something must say so instead of acting as if the list were current.
   */
  reload: () => Promise<boolean>;
  /**
   * `${personId}|${tagId}` → the assignment shown for this person and skill: the one on the person's
   * main record, else the one on a linked record (`assignment.personId` says which record holds it).
   */
  assignmentByCell: Map<string, Assignment>;
  /** `${personId}|${tagId}` → further assignments of the same skill on the person's other records */
  alsoOnByCell: Map<string, Assignment[]>;
  /** `${recordId}|${tagId}` → the assignment held by exactly this Person record */
  assignmentByRecord: Map<string, Assignment>;
  /** The person a Person record belongs to (undefined: no active person) */
  personOfRecord: (recordId: string) => Person | undefined;
  /** skill (assignment) id → certificates, newest first */
  certificatesBySkill: Map<string, Certificate[]>;
}


async function loadAll(): Promise<SkillData> {
  // Independent reads in parallel (people are two queries: UnifiedPerson and Person), then one query for all certificates.
  const [persons, definitions, assignments, scale] = await Promise.all([loadPersons(), loadSkillDefinitions(), loadAssignments(), loadScale()]);
  const certificates = await loadCertificates(assignments.map((a) => a.id));
  return { persons, definitions, assignments, certificates, scale };
}

export function useSkillData(): SkillDataState {
  const [data, setData] = useState<SkillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Starts a load; answers of older loads are ignored if a newer one was started meanwhile. */
  const [fetchData] = useState(() =>
    createLatestLoader(loadAll, (result) => {
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setError(toUserMessage(result.error));
      }
      setLoading(false);
      setRefreshing(false);
    }),
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const reload = useCallback(() => {
    setRefreshing(true);
    return fetchData();
  }, [fetchData]);

  const placed = useMemo(() => placeAssignments(data?.persons ?? [], data?.assignments ?? []), [data]);
  const assignmentByRecord = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const a of data?.assignments ?? []) map.set(cellKey(a.personId, a.tagId), a);
    return map;
  }, [data]);

  const certificatesBySkill = useMemo(() => {
    const map = new Map<string, Certificate[]>();
    for (const c of data?.certificates ?? []) {
      const list = map.get(c.skillId) ?? [];
      list.push(c);
      map.set(c.skillId, list);
    }
    return map;
  }, [data]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload,
    assignmentByCell: placed.byCell,
    alsoOnByCell: placed.alsoOn,
    assignmentByRecord,
    personOfRecord: placed.ownerOf,
    certificatesBySkill,
  };
}
