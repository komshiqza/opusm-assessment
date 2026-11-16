import type { Metadata } from "next";
import "@ui5/webcomponents-react/styles.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "Skill Management",
  description: "opusm assessment: skill matrix and certificates on SAP FSM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* UI5 Web Components runtime configuration. Must exist before any component boots. */}
        <script
          data-ui5-config
          type="application/json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({ theme: "sap_horizon", animationMode: "minimal" }) }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
