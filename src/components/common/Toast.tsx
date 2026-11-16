"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Toast } from "@ui5/webcomponents-react";

const ToastContext = createContext<(message: string) => void>(() => {});

/** Short success messages ("Skill created") at the bottom of the screen. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((text: string) => setMessage(text), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Toast open={message !== null} duration={3000} onClose={() => setMessage(null)}>
        {message}
      </Toast>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
