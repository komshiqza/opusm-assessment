"use client";

import { useState, useSyncExternalStore } from "react";
import { Menu, MenuItem, MenuItemGroup } from "@ui5/webcomponents-react";
import { DEFAULT_THEME, THEME_LABELS, readThemeChoice, saveThemeChoice, subscribeThemeChoice, type ThemeChoice } from "@/lib/themePreference";

const CHOICES: ThemeChoice[] = ["light", "dark"];

/** The light/dark choice, opened from the ShellBar's "Theme" button. */
export function ThemeMenu({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, () => DEFAULT_THEME);
  return (
    <Menu
      open={opener !== null}
      opener={opener ?? undefined}
      headerText="Theme"
      onClose={onClose}
      onItemClick={(e) => {
        const picked = e.detail.item.dataset.choice as ThemeChoice | undefined;
        // UI5 would untick the active item when it is picked again; keep it ticked and just close.
        if (picked === choice) {
          e.preventDefault();
          onClose();
          return;
        }
        if (picked) saveThemeChoice(picked);
      }}
    >
      <MenuItemGroup checkMode="Single">
        {CHOICES.map((c) => (
          <MenuItem key={c} data-choice={c} text={THEME_LABELS[c]} checked={choice === c} />
        ))}
      </MenuItemGroup>
    </Menu>
  );
}

/** Keeps track of which ShellBar item opened the menu. */
export function useThemeMenu() {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return { opener, open: (target: HTMLElement) => setOpener(target), close: () => setOpener(null) };
}
