"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAssignments, loadCertificates, loadPersons, loadScale, loadSkillDefinitions } from "@/lib/skills/repository";
import type { Assignment, Certificate, Person, ProficiencyScale, SkillDefinition } from "@/lib/skills/types";
import { toUserMessage } from "@/lib/errors";
import { createLatestLoader } from "@/lib/latestLoader";

export interface SkillData {
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
   * Reloads everything from FSM (5-6 requests in total, independent of the number of persons).
   * Resolves to false when the reload failed: the screen then still shows the old data, and a
   * dialog that just saved something must say so instead of acting as if the list were current.
   */
  reload: () => Promise<boolean>;
  /** `${personId}|${tagId}` → assignment */
  assignmentByCell: Map<string, Assignment>;
  /** skill (assignment) id → certificates, newest first */
  certificatesBySkill: Map<string, Certificate[]>;
  /** persons that hold at least one of our skills */
  assignedPersonIds: Set<string>;
}

export const cellKey = (personId: string, tagId: string) => `${personId}|${tagId}`;

async function loadAll(): Promise<SkillData> {
  // Four independent reads in parallel, then one query for all certificates.
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

  const assignmentByCell = useMemo(() => {
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

  const assignedPersonIds = useMemo(() => new Set((data?.assignments ?? []).map((a) => a.personId)), [data]);

  return { data, loading, refreshing, error, reload, assignmentByCell, certificatesBySkill, assignedPersonIds };
}
