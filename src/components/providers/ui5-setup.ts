"use client";

// Side-effect imports for UI5 Web Components: themes, i18n bundles and icons.
// Imported first by AppProviders. Never import this from a server component.
import "@ui5/webcomponents-react/dist/Assets.js";
import "@ui5/webcomponents-icons/dist/AllIcons.js";
// Illustrations for empty and error states (imported one by one to keep the bundle small).
import "@ui5/webcomponents-fiori/dist/illustrations/NoData.js";
import "@ui5/webcomponents-fiori/dist/illustrations/NoEntries.js";
import "@ui5/webcomponents-fiori/dist/illustrations/NoFilterResults.js";
import "@ui5/webcomponents-fiori/dist/illustrations/UnableToLoad.js";

// Apply the saved light/dark choice before any UI5 component boots, so the page starts in it.
import { setTheme } from "@ui5/webcomponents-base/dist/config/Theme.js";
import { UI5_THEME, readThemeChoice } from "@/lib/themePreference";

if (typeof window !== "undefined") void setTheme(UI5_THEME[readThemeChoice()]);
