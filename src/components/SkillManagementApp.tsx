"use client";

import { useState } from "react";
import { BusyIndicator, Button, IllustratedMessage, MessageStrip, ShellBar, Tab, TabContainer } from "@ui5/webcomponents-react";
import { CANDIDATE_ID_VALID, NAME_PREFIX } from "@/lib/candidate";
import { useSkillData } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { ToastProvider } from "./common/Toast";
import { SkillMatrix } from "./matrix/SkillMatrix";
import { SkillCatalog } from "./catalog/SkillCatalog";
import { AssignmentDialog } from "./assignment/AssignmentDialog";
import { ExpiryOverview } from "./expiry/ExpiryOverview";
import styles from "./SkillManagementApp.module.css";

type TabKey = "matrix" | "expiry" | "catalogue";

export function SkillManagementApp() {
  const state = useSkillData();
  const [tab, setTab] = useState<TabKey>("matrix");
  const [cell, setCell] = useState<{ person: Person; definition: SkillDefinition } | null>(null);

  return (
    <ToastProvider>
      <ShellBar primaryTitle="Skill Management" secondaryTitle="Service technicians on SAP FSM" />
      <main className={styles.main}>
        {!CANDIDATE_ID_VALID && (
          <MessageStrip design="Negative" hideCloseButton>
            NEXT_PUBLIC_CANDIDATE_ID in .env.local is missing or invalid. All changes are blocked until it is set.
          </MessageStrip>
        )}

        {state.error && state.data && (
          <MessageStrip design="Negative" hideCloseButton>
            Could not reload the data from FSM: {state.error}{" "}
            <Button design="Transparent" icon="refresh" onClick={() => void state.reload()}>
              Try again
            </Button>
          </MessageStrip>
        )}

        {state.loading && (
          <BusyIndicator active delay={0} size="L" text="Loading persons, skills and certificates from FSM…" className={styles.loading} />
        )}

        {!state.loading && !state.data && (
          <IllustratedMessage name="UnableToLoad" titleText="Could not load data from FSM" subtitleText={state.error ?? "Unknown error"}>
            <Button design="Emphasized" icon="refresh" onClick={() => void state.reload()}>
              Try again
            </Button>
          </IllustratedMessage>
        )}

        {state.data && (
          <>
            <BusyIndicator active={state.refreshing} delay={300} className={styles.content}>
              <TabContainer
                className={styles.tabs}
                contentBackgroundDesign="Transparent"
                onTabSelect={(e) => setTab((e.detail.tab.dataset.key as TabKey) ?? "matrix")}
              >
                <Tab text="Skill matrix" data-key="matrix" selected={tab === "matrix"}>
                  <SkillMatrix
                    state={state}
                    onOpenCell={(person, definition) => setCell({ person, definition })}
                    onGoToCatalogue={() => setTab("catalogue")}
                  />
                </Tab>
                <Tab text="Expiry overview" data-key="expiry" selected={tab === "expiry"}>
                  <ExpiryOverview state={state} onOpen={(person, definition) => setCell({ person, definition })} />
                </Tab>
                <Tab text={`Skill catalogue (${state.data.definitions.length})`} data-key="catalogue" selected={tab === "catalogue"}>
                  <SkillCatalog state={state} />
                </Tab>
              </TabContainer>
            </BusyIndicator>
            <p className={styles.footnote}>
              Your skills are stored in FSM with the prefix “{NAME_PREFIX}”. Persons are read-only demo data; only active persons are shown.
            </p>
          </>
        )}
      </main>

      {cell && <AssignmentDialog key={`${cell.person.id}|${cell.definition.id}`} {...cell} state={state} onClose={() => setCell(null)} />}
    </ToastProvider>
  );
}
