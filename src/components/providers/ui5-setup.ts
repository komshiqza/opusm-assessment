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

// Language of UI5's own texts. UI5 has no Swiss German bundle, so its German texts are loaded with
// "ß" replaced by "ss" (Swiss spelling, like the app's own texts).
import { setLanguage } from "@ui5/webcomponents-base/dist/config/Language.js";
import { registerI18nLoader } from "@ui5/webcomponents-base/dist/asset-registries/i18n.js";
import { UI5_LANGUAGE, readLanguage } from "@/lib/i18n/language";

const swissSpelling = (bundle: Record<string, string>) => Object.fromEntries(Object.entries(bundle).map(([key, text]) => [key, text.replaceAll("ß", "ss")]));
registerI18nLoader("@ui5/webcomponents", "de", async () =>
  swissSpelling((await import("@ui5/webcomponents/dist/generated/assets/i18n/messagebundle_de.json")).default),
);
registerI18nLoader("@ui5/webcomponents-fiori", "de", async () =>
  swissSpelling((await import("@ui5/webcomponents-fiori/dist/generated/assets/i18n/messagebundle_de.json")).default),
);

if (typeof window !== "undefined") {
  void setLanguage(UI5_LANGUAGE[readLanguage()]);
  document.documentElement.lang = readLanguage();
}
