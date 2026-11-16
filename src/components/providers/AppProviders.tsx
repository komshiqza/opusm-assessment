"use client";

import "./ui5-setup";
import { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "@ui5/webcomponents-react";
import { setTheme } from "@ui5/webcomponents-base/dist/config/Theme.js";
import { COLOR_SCHEME, UI5_THEME, readThemeChoice, subscribeThemeChoice } from "@/lib/themePreference";
import { setLanguage } from "@ui5/webcomponents-base/dist/config/Language.js";
import { UI5_LANGUAGE, readLanguage, subscribeLanguage } from "@/lib/i18n/language";

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

/** UI5's own texts and the page language follow the language choice (the app's texts re-render by themselves). */
function LanguageSync() {
  useEffect(
    () =>
      subscribeLanguage(() => {
        const language = readLanguage();
        document.documentElement.lang = language;
        void setLanguage(UI5_LANGUAGE[language]);
      }),
    [],
  );
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider staticCssInjected>
      <ThemeSync />
      <LanguageSync />
      {children}
    </ThemeProvider>
  );
}
