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
import { LanguageMenu, ThemeMenu, useThemeMenu } from "./common/ThemeMenu";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/messages";
import { DEFAULT_LANGUAGE, readLanguage, setRenderedLanguage, subscribeLanguage } from "@/lib/i18n/language";
import { SkillMatrix } from "./matrix/SkillMatrix";
import { SkillCatalog } from "./catalog/SkillCatalog";
import { AssignmentDialog } from "./assignment/AssignmentDialog";
import { PersonDialog } from "./person/PersonDialog";
import { ExpiryOverview } from "./expiry/ExpiryOverview";
import { FindTechnician } from "./findTechnician/FindTechnician";
import styles from "./SkillManagementApp.module.css";

/** Tab labels; below tablet width short ones, so all four tabs fit next to each other. */
const TAB_LABELS: Record<TabKey, { full: MessageKey; short: MessageKey }> = {
  matrix: { full: "tab.matrix", short: "tab.matrix.short" },
  expiry: { full: "tab.expiry", short: "tab.expiry.short" },
  find: { full: "tab.find", short: "tab.find.short" },
  catalogue: { full: "tab.catalogue", short: "tab.catalogue.short" },
};

const tabKeyOf = (element: HTMLElement | undefined) => element?.dataset.key as TabKey | undefined;

export function SkillManagementApp() {
  const state = useSkillData();
  /** The tab the user picked; until then the app shows the first tab of the current order. */
  const [pickedTab, setTab] = useState<TabKey | null>(null);
  const [cell, setCell] = useState<{ person: Person; definition: SkillDefinition } | null>(null);
  const isPhone = useMediaQuery(PHONE_QUERY);
  const themeMenu = useThemeMenu();
  const languageMenu = useThemeMenu();
  // English while React takes over the server's HTML, then the saved choice; a change re-renders the
  // whole app, and every t() call below draws in this language.
  setRenderedLanguage(useSyncExternalStore(subscribeLanguage, readLanguage, () => DEFAULT_LANGUAGE));
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const storedOrder = useSyncExternalStore(subscribeTabOrder, readStoredTabOrder, () => "");
  const order = useMemo(() => parseTabOrder(storedOrder), [storedOrder]);
  const tab = pickedTab ?? order[0];
  const openCell = (person: Person, definition: SkillDefinition) => setCell({ person, definition });
  /** The person whose skills are shown (the assignment dialog can open on top of it). */
  /** The person whose skills are shown; `records`: all of their linked records (Find technician). */
  const [personShown, setPersonShown] = useState<{ person: Person; records?: Person[] } | null>(null);
  const showPerson = (person: Person, records?: Person[]) => setPersonShown({ person, records });

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
    matrix: <SkillMatrix state={state} onOpenCell={openCell} onOpenPerson={showPerson} onGoToCatalogue={() => setTab("catalogue")} />,
    expiry: <ExpiryOverview state={state} onOpen={openCell} onOpenPerson={showPerson} />,
    find: <FindTechnician state={state} onOpen={openCell} onOpenPerson={showPerson} />,
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
                {isPhone && <span>{t("app.title")}</span>}
              </span>
            }
          >
            {t("app.title")}
          </ShellBarBranding>
        }
        secondaryTitle={t("app.subtitle")}
      >
        <ShellBarItem icon="world" text={t("language.button")} onClick={(e) => languageMenu.open(e.detail.targetRef)} />
        <ShellBarItem icon="palette" text={t("theme.button")} onClick={(e) => themeMenu.open(e.detail.targetRef)} />
      </ShellBar>
      <ThemeMenu opener={themeMenu.opener} onClose={themeMenu.close} />
      <LanguageMenu opener={languageMenu.opener} onClose={languageMenu.close} />
      <main className={styles.main}>
        {!CANDIDATE_ID_VALID && (
          <MessageStrip design="Negative" hideCloseButton>
            {t("app.candidateMissing")}
          </MessageStrip>
        )}

        {state.error && state.data && (
          <MessageStrip design="Negative" hideCloseButton>
            {t("app.reloadFailed", { error: state.error })}{" "}
            <Button design="Transparent" icon="refresh" onClick={() => void state.reload()} disabled={state.refreshing}>
              {state.refreshing ? t("app.loadingShort") : t("app.tryAgain")}
            </Button>
          </MessageStrip>
        )}

        {state.loading && (
          <BusyIndicator active delay={0} size="L" text={t("app.loading")} className={styles.loading} />
        )}

        {!state.loading && !state.data && (
          <IllustratedMessage name="UnableToLoad" titleText={t("app.loadFailed")} subtitleText={state.error ?? t("app.unknownError")}>
            <Button design="Emphasized" icon="refresh" onClick={() => void state.reload()} disabled={state.refreshing}>
              {state.refreshing ? t("app.loadingShort") : t("app.tryAgain")}
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
                onTabSelect={(e) => setTab(tabKeyOf(e.detail.tab) ?? tab)}
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
                    setTab(tab); // stay on the open tab, even if another tab becomes first
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
                    text={`${t(isNarrow ? TAB_LABELS[key].short : TAB_LABELS[key].full)}${key === "catalogue" ? ` (${state.data!.definitions.length})` : ""}`}
                  >
                    {content[key]}
                  </Tab>
                ))}
              </TabContainer>
            </BusyIndicator>
            <p className={styles.footnote}>
              {t("app.tabTip")}{" "}
              {!isDefaultTabOrder(order) && (
                <Button
                  design="Transparent"
                  icon="reset"
                  onClick={() => {
                    setTab(tab);
                    resetTabOrder();
                  }}
                >
                  {t("app.resetTabs")}
                </Button>
              )}
            </p>
          </>
        )}
      </main>

      {personShown && <PersonDialog person={personShown.person} records={personShown.records} state={state} onOpenCell={openCell} onClose={() => setPersonShown(null)} />}
      {cell && <AssignmentDialog key={`${cell.person.id}|${cell.definition.id}`} {...cell} state={state} onClose={() => setCell(null)} />}
    </ToastProvider>
  );
}
