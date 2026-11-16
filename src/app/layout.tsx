import type { Metadata } from "next";
import Script from "next/script";
import "@ui5/webcomponents-react/styles.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { THEME_BOOT_SCRIPT } from "@/lib/themePreference";

export const metadata: Metadata = {
  title: "Skill Management",
  description: "opusm assessment: skill matrix and certificates on SAP FSM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* UI5 Web Components runtime configuration. Must exist before any component boots.
            sap_horizon_auto follows the device light/dark setting (the "System" theme choice). */}
        <script
          data-ui5-config
          type="application/json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({ theme: "sap_horizon_auto", animationMode: "minimal" }) }}
        />
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
