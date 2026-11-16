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
