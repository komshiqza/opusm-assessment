"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BusyIndicator,
  Button,
  Icon,
  IllustratedMessage,
  MessageStrip,
  ShellBar,
  ShellBarItem,
  ShellBarBranding,
  Tab,
  TabContainer,
} from "@ui5/webcomponents-react";
import {
  isDefaultTabOrder,
  moveTab,
  parseTabOrder,
  readStoredTabOrder,
  resetTabOrder,
  saveTabOrder,
  subscribeTabOrder,
  type TabKey,
} from "@/lib/tabOrder";
import { NARROW_QUERY, PHONE_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { CANDIDATE_ID_VALID } from "@/lib/candidate";
import { useSkillData } from "@/hooks/useSkillData";
import type { Person, SkillDefinition } from "@/lib/skills/types";
import { ToastProvider } from "./common/Toast";
import { ThemeMenu, useThemeMenu } from "./common/ThemeMenu";
import { SkillMatrix } from "./matrix/SkillMatrix";
import { SkillCatalog } from "./catalog/SkillCatalog";
import { AssignmentDialog } from "./assignment/AssignmentDialog";
import { ExpiryOverview } from "./expiry/ExpiryOverview";
import { FindTechnician } from "./findTechnician/FindTechnician";
import styles from "./SkillManagementApp.module.css";

/** Tab labels; below tablet width short ones, so all four tabs fit next to each other. */
const TAB_LABELS: Record<TabKey, { full: string; short: string }> = {
  matrix: { full: "Skill matrix", short: "Matrix" },
  expiry: { full: "Expiring soon", short: "Expiring" },
  find: { full: "Find technician for a job", short: "Find" },
  catalogue: { full: "Skill catalogue", short: "Skills" },
};

const tabKeyOf = (element: HTMLElement | undefined) => element?.dataset.key as TabKey | undefined;

export function SkillManagementApp() {
  const state = useSkillData();
  const [tab, setTab] = useState<TabKey>("matrix");
  const [cell, setCell] = useState<{ person: Person; definition: SkillDefinition } | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const themeMenu = useThemeMenu();
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const storedOrder = useSyncExternalStore(subscribeTabOrder, readStoredTabOrder, () => "");
  const order = useMemo(() => parseTabOrder(storedOrder), [storedOrder]);
  const openCell = (person: Person, definition: SkillDefinition) => setCell({ person, definition });

  /** After a move the strip is rebuilt; put keyboard focus back on the moved tab. */
  const focusAfterMove = useRef<TabKey | null>(null);
  useEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    const frame = requestAnimationFrame(() => {
      const moved = document.querySelector<HTMLElement & { getDomRefInStrip?: () => HTMLElement | undefined }>(`ui5-tab[data-key="${key}"]`);
      const inStrip = moved?.getDomRefInStrip?.();
      if (inStrip && inStrip.getClientRects().length > 0) {
        inStrip.focus();
        return;
      }
      // The tab sits in the "More" menu: focus that menu's button instead of losing focus.
      const container = document.querySelector("ui5-tabcontainer");
      const overflowButtons = [...(container?.shadowRoot?.querySelectorAll<HTMLElement>("[data-ui5-stable^=overflow]") ?? [])];
      overflowButtons.find((button) => button.getClientRects().length > 0)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [order]);

  const content: Record<TabKey, ReactNode> = {
    matrix: <SkillMatrix state={state} onOpenCell={openCell} onGoToCatalogue={() => setTab("catalogue")} />,
    expiry: <ExpiryOverview state={state} onOpen={openCell} />,
    find: <FindTechnician state={state} onOpen={openCell} />,
    catalogue: <SkillCatalog state={state} />,
  };

  return (
    <ToastProvider>
      <ShellBar
        branding={
          <ShellBarBranding
            // UI5 shows only the logo on phones, so the phone gets the title inside the logo.
            logo={
              <span slot="logo" className={styles.logo}>
                <Icon name="competence" className={styles.logoIcon} />
                {isPhone && <span>Skill Management</span>}
              </span>
            }
          >
            Skill Management
          </ShellBarBranding>
        }
        secondaryTitle="Service technicians on SAP FSM"
      >
        <ShellBarItem icon="palette" text="Theme" onClick={(e) => themeMenu.open(e.detail.targetRef)} />
      </ShellBar>
      <ThemeMenu opener={themeMenu.opener} onClose={themeMenu.close} />
      <main className={styles.main}>
        {!CANDIDATE_ID_VALID && (
          <MessageStrip design="Negative" hideCloseButton>
            NEXT_PUBLIC_CANDIDATE_ID in .env.local is missing or invalid. All changes are blocked until it is set.
          </MessageStrip>
        )}

        {state.error && state.data && (
          <MessageStrip design="Negative" hideCloseButton>
            Could not reload the data from FSM: {state.error}{" "}
            <Button design="Transparent" icon="refresh" onClick={() => void state.reload()} disabled={state.refreshing}>
              {state.refreshing ? "Loading…" : "Try again"}
            </Button>
          </MessageStrip>
        )}

        {state.loading && (
          <BusyIndicator active delay={0} size="L" text="Loading persons, skills and certificates from FSM…" className={styles.loading} />
        )}

        {!state.loading && !state.data && (
          <IllustratedMessage name="UnableToLoad" titleText="Could not load data from FSM" subtitleText={state.error ?? "Unknown error"}>
            <Button design="Emphasized" icon="refresh" onClick={() => void state.reload()} disabled={state.refreshing}>
              {state.refreshing ? "Loading…" : "Try again"}
            </Button>
          </IllustratedMessage>
        )}

        {state.data && (
          <>
            <BusyIndicator active={state.refreshing} delay={300} className={styles.content}>
              <TabContainer
                // UI5 names each tab's slot by its position and does not redraw the strip when the app
                // reorders tabs, so a new order mounts a new strip. The panels' inputs live in usePageState,
                // so they survive; focus returns to the moved tab below.
                key={order.join()}
                className={styles.tabs}
                contentBackgroundDesign="Transparent"
                onTabSelect={(e) => setTab(tabKeyOf(e.detail.tab) ?? "matrix")}
                // Drag a tab (or Ctrl + arrow keys) to reorder: UI5 asks with move-over, then reports the drop with move.
                onMoveOver={(e) => {
                  const { source, destination } = e.detail;
                  if (tabKeyOf(source.element) && tabKeyOf(destination.element) && destination.placement !== "On") e.preventDefault();
                }}
                onMove={(e) => {
                  const source = tabKeyOf(e.detail.source.element);
                  const target = tabKeyOf(e.detail.destination.element);
                  const placement = e.detail.destination.placement;
                  if (source && target && placement !== "On") {
                    focusAfterMove.current = source;
                    saveTabOrder(moveTab(order, source, target, placement));
                  }
                }}
              >
                {order.map((key) => (
                  <Tab
                    key={key}
                    data-key={key}
                    movable
                    selected={tab === key}
                    text={`${isNarrow ? TAB_LABELS[key].short : TAB_LABELS[key].full}${key === "catalogue" ? ` (${state.data!.definitions.length})` : ""}`}
                  >
                    {content[key]}
                  </Tab>
                ))}
              </TabContainer>
            </BusyIndicator>
            <p className={styles.footnote}>
              Tip: drag a tab to change the order (saved in this browser only).{" "}
              {!isDefaultTabOrder(order) && (
                <Button design="Transparent" icon="reset" onClick={resetTabOrder}>
                  Reset tab order
                </Button>
              )}
            </p>
          </>
        )}
      </main>

      {cell && <AssignmentDialog key={`${cell.person.id}|${cell.definition.id}`} {...cell} state={state} onClose={() => setCell(null)} />}
    </ToastProvider>
  );
}
