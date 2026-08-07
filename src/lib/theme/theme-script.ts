/**
 * Pre-hydration theme resolution.
 *
 * This string is injected into <head> with dangerouslySetInnerHTML and runs
 * BEFORE first paint. Without it the server would emit the dark default, the
 * client would read localStorage during hydration, and a light-mode user
 * would eat a full-screen white flash on every navigation.
 *
 * Deliberately dependency-free, synchronous, and wrapped in try/catch —
 * localStorage throws in some privacy modes and a theme preference is never
 * worth breaking the page over.
 */

export const THEME_STORAGE_KEY = "rg-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var s=localStorage.getItem(k);
var r=document.documentElement;
if(s==="light"||s==="dark"){r.setAttribute("data-theme",s);}
else{r.removeAttribute("data-theme");}
r.setAttribute("data-theme-pref",s==="light"||s==="dark"?s:"system");
}catch(e){}})();`;

/** Reads the stored preference. Returns "system" when unset or unreadable. */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function writeStoredPreference(pref: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* private mode — preference simply won't persist */
  }
}

/**
 * What the OS is asking for. Mirrors the CSS default in globals.css: the
 * brand default is dark, and `prefers-color-scheme: light` flips it.
 */
export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}
