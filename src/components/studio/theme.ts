"use client";

import { create } from "zustand";
import { THEME_KEY } from "@/config/theme";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeStore {
  mode: ThemeMode;
  resolved: "light" | "dark";
  init(): () => void;
  setMode(m: ThemeMode): void;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(mode: ThemeMode): "light" | "dark" {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolved = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** Theme preference per browser; "system" follows the OS live. */
export const useTheme = create<ThemeStore>((set, get) => ({
  mode: "system",
  resolved: "dark",
  init() {
    const mode = readMode();
    set({ mode, resolved: apply(mode) });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (get().mode === "system") set({ resolved: apply("system") }); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  },
  setMode(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* private mode: applies for this visit only */ }
    set({ mode, resolved: apply(mode) });
  },
}));
