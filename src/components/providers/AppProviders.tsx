"use client";

import "./ui5-setup";
import type { ReactNode } from "react";
import { ThemeProvider } from "@ui5/webcomponents-react";

export function AppProviders({ children }: { children: ReactNode }) {
  return <ThemeProvider staticCssInjected>{children}</ThemeProvider>;
}
