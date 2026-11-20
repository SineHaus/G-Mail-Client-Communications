"use client";
import { useCallback, useSyncExternalStore } from "react";

// A small setting remembered on this device (localStorage), read without a flash on first paint
// and shared by every component that uses the same key.

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function useLocalPref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => (read(key) as T | null) ?? fallback,
    () => fallback,
  );
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      listeners.forEach((fn) => fn());
    },
    [key],
  );
  return [value, set];
}

/** Light or dark on the page, from a Light / Dark / Auto choice. */
export function applyTheme(pref: "light" | "dark" | "auto") {
  const dark = pref === "dark" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}
