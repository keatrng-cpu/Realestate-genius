"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  readStoredPreference,
  systemTheme,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme-script";

/* ---------------------------------------------------------------------- */
/* External stores                                                         */
/*                                                                          */
/* The theme lives in localStorage and in the OS, i.e. outside React. Both  */
/* are modelled as external stores rather than mirrored into state via an   */
/* effect: that gives correct SSR snapshots, no cascading render on mount,  */
/* and cross-tab sync for free.                                             */
/* ---------------------------------------------------------------------- */

const localListeners = new Set<() => void>();

function emitLocal() {
  for (const l of localListeners) l();
}

function subscribePreference(cb: () => void) {
  localListeners.add(cb);
  // `storage` only fires in *other* tabs, hence the local listener set too.
  window.addEventListener("storage", cb);
  return () => {
    localListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Returns a primitive, so the snapshot identity is stable by construction. */
function getPreferenceSnapshot(): ThemePreference {
  return readStoredPreference();
}

function getServerPreference(): ThemePreference {
  return "system";
}

function subscribeSystem(cb: () => void) {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getSystemSnapshot(): ResolvedTheme {
  return systemTheme();
}

/** Matches the CSS default in globals.css: dark is the brand baseline. */
function getServerSystem(): ResolvedTheme {
  return "dark";
}

const noopSubscribe = () => () => {};

/* ---------------------------------------------------------------------- */

type ThemeContextValue = {
  /** What the user asked for — including "system". */
  preference: ThemePreference;
  /** What is actually painted right now. */
  theme: ResolvedTheme;
  /** False during SSR and the hydration pass. */
  hydrated: boolean;
  setPreference: (pref: ThemePreference) => void;
  /** Pins an explicit choice, flipping whatever is currently painted. */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
    getServerPreference,
  );
  const system = useSyncExternalStore(
    subscribeSystem,
    getSystemSnapshot,
    getServerSystem,
  );
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const theme: ResolvedTheme = preference === "system" ? system : preference;

  /**
   * Mirror the resolved preference onto <html>. The pre-hydration inline
   * script has normally already done this, so on first paint the effect is a
   * no-op; it exists to keep the attribute correct after a toggle.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
    root.setAttribute("data-theme-pref", preference);
  }, [preference]);

  /**
   * Writing the preference is the whole operation. The cross-fade lives in
   * globals.css behind `prefers-reduced-motion: no-preference` — toggling a
   * transition class here would race style recalculation and could strand the
   * shell on the previous theme's background colour.
   */
  const setPreference = useCallback((next: ThemePreference) => {
    writeStoredPreference(next);
    emitLocal();
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [setPreference, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, hydrated, setPreference, toggle }),
    [preference, theme, hydrated, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Safe outside a provider: returns a static dark reading rather than throwing,
 * so a primitive can be dropped into a test or storybook tree.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return {
    preference: "system",
    theme: "dark",
    hydrated: false,
    setPreference: () => {},
    toggle: () => {},
  };
}
