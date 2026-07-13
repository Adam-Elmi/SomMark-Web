/**
 * Generates a blocking inline script string for common FOUC-prevention patterns.
 * Pass the result to the `themeScript` plugin option.
 *
 * Preset "dark-mode": reads localStorage and system preference, sets an attribute
 * on <html> before the first paint — eliminates theme flash on page load.
 *
 * @example
 * sommarkWeb({ themeScript: themeScript("dark-mode") })
 * sommarkWeb({ themeScript: themeScript("dark-mode", { storageKey: "theme", attribute: "data-theme", default: "light" }) })
 */
export function themeScript(
  preset: "dark-mode",
  options?: {
    /** localStorage key to read/write the theme. Default: "theme-value" */
    storageKey?: string;
    /** Attribute set on <html>. Default: "data-theme" */
    attribute?: string;
    /** Fallback when no stored value and system preference is light. Default: "light" */
    default?: "light" | "dark";
  }
): string {
  if (preset === "dark-mode") {
    const key  = options?.storageKey ?? "theme-value";
    const attr = options?.attribute  ?? "data-theme";
    const def  = options?.default    ?? "light";
    const dark = def === "dark" ? `'dark'` : `(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')`;
    return `!function(){var t=localStorage.getItem('${key}')||${dark};document.documentElement.setAttribute('${attr}',t)}()`;
  }
  return "";
}
