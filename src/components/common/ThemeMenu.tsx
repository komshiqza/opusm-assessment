"use client";

import { useState, useSyncExternalStore } from "react";
import { Menu, MenuItem, MenuItemGroup } from "@ui5/webcomponents-react";
import { DEFAULT_THEME, readThemeChoice, saveThemeChoice, subscribeThemeChoice, type ThemeChoice } from "@/lib/themePreference";
import { DEFAULT_LANGUAGE, readLanguage, saveLanguage, subscribeLanguage, type Language } from "@/lib/i18n/language";
import { t } from "@/lib/i18n/t";

interface ChoiceMenuProps<T extends string> {
  opener: HTMLElement | null;
  onClose: () => void;
  headerText: string;
  choices: { value: T; label: string }[];
  current: T;
  onPick: (value: T) => void;
}

/** A ShellBar menu with one ticked choice (theme, language). */
function ChoiceMenu<T extends string>({ opener, onClose, headerText, choices, current, onPick }: ChoiceMenuProps<T>) {
  return (
    <Menu
      open={opener !== null}
      opener={opener ?? undefined}
      headerText={headerText}
      onClose={onClose}
      onItemClick={(e) => {
        const picked = e.detail.item.dataset.choice as T | undefined;
        // UI5 would untick the active item when it is picked again; keep it ticked and just close.
        if (picked === current) {
          e.preventDefault();
          onClose();
          return;
        }
        if (picked) onPick(picked);
      }}
    >
      <MenuItemGroup checkMode="Single">
        {choices.map((c) => (
          <MenuItem key={c.value} data-choice={c.value} text={c.label} checked={current === c.value} />
        ))}
      </MenuItemGroup>
    </Menu>
  );
}

/** Light or dark, opened from the ShellBar's "Theme" button. */
export function ThemeMenu({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, () => DEFAULT_THEME);
  const choices: { value: ThemeChoice; label: string }[] = [
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
  ];
  return <ChoiceMenu opener={opener} onClose={onClose} headerText={t("theme.button")} choices={choices} current={choice} onPick={saveThemeChoice} />;
}

/** English or German, opened from the ShellBar's "Language" button. */
export function LanguageMenu({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const language = useSyncExternalStore(subscribeLanguage, readLanguage, () => DEFAULT_LANGUAGE);
  const choices: { value: Language; label: string }[] = [
    { value: "en", label: t("language.en") },
    { value: "de", label: t("language.de") },
  ];
  return <ChoiceMenu opener={opener} onClose={onClose} headerText={t("language.button")} choices={choices} current={language} onPick={saveLanguage} />;
}

/** Keeps track of which ShellBar item opened a menu. */
export function useThemeMenu() {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return { opener, open: (target: HTMLElement) => setOpener(target), close: () => setOpener(null) };
}
