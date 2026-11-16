"use client";

import "./ui5-setup";
import { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "@ui5/webcomponents-react";
import { setTheme } from "@ui5/webcomponents-base/dist/config/Theme.js";
import { COLOR_SCHEME, UI5_THEME, readThemeChoice, subscribeThemeChoice } from "@/lib/themePreference";

/**
 * Applies the light/dark choice when the user changes it in the ShellBar menu.
 * The saved choice is already applied before the first paint (layout head script and ui5-setup).
 */
function ThemeSync() {
  useEffect(
    () =>
      subscribeThemeChoice(() => {
        const choice = readThemeChoice();
        document.documentElement.style.colorScheme = COLOR_SCHEME[choice];
        void setTheme(UI5_THEME[choice]);
      }),
    [],
  );
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider staticCssInjected>
      <ThemeSync />
      {children}
    </ThemeProvider>
  );
}
