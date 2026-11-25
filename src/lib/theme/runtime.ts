// The window's custom theme: colours painted over the skin's tokens, the theme's CSS after the app's own, kept in step
// with the server through `theme` frames. Every way back lives here, outside anything a theme's CSS can hide.
import { SAFE_LOOK_PARAM, THEME_COLOR_ROLES, themeFileSchema, type ActiveTheme, type ThemeFile } from "../../../shared/theme";
import { readColorScheme } from "../color-scheme";
import { DEFAULT_SKIN_CHOICE, SKIN_IDS, applySkinChoice, readSkin, resolveSkin, subscribeSkin, themeSkins, wearSkin, type SkinChoice, type SkinId } from "../skins";
import { accentPalette, canvasPalette, modeOf } from "./palette";
import { applyThemeCss } from "./theme-css";

const CACHE_KEY = "omb-theme";
const SAFE_KEY = "omb-safe-look";

export type WornTheme = { id: string; theme: ThemeFile };

let worn: WornTheme | null = null;
let preview: WornTheme | null = null;
let painted: string[] = [];
let painting = false;
const listeners = new Set<() => void>();

function storage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[kind];
  } catch {
    return undefined;
  }
}

/** This page started without the custom theme (the address held ?safe-look); it stays off until the tab closes. */
export function safeLook(): boolean {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has(SAFE_LOOK_PARAM)) storage("sessionStorage")?.setItem(SAFE_KEY, "1");
    return storage("sessionStorage")?.getItem(SAFE_KEY) === "1";
  } catch {
    return false;
  }
}

export function wornTheme(): WornTheme | null {
  return worn;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clearPaint(root: HTMLElement): void {
  for (const property of painted) root.style.removeProperty(property);
  painted = [];
}

const isLightOrDark = (choice: SkinChoice | undefined) => !choice || choice === "system" || choice === themeSkins().light || choice === themeSkins().dark;

/** The skin a theme wears whatever the person picks, or undefined when it follows their System, Light or Dark choice. */
function ownSkin(theme: ThemeFile): SkinChoice | undefined {
  if (theme.light && theme.dark && isLightOrDark(theme.skin)) return undefined;
  return theme.skin ?? (theme.canvas ? themeSkins()[modeOf(theme.canvas)] : undefined);
}

function draw(): boolean {
  if (typeof document === "undefined" || painting) return false;
  painting = true;
  try {
    const root = document.documentElement;
    clearPaint(root);
    const shown = safeLook() ? null : preview ?? worn;
    if (!shown) {
      delete root.dataset.theme;
      applyThemeCss("");
      wearSkin(readSkin());
      return true;
    }
    const theme = shown.theme;
    const base = ownSkin(theme);
    wearSkin(base ? resolveSkin(base) : readSkin());
    const mode = readColorScheme(root);
    const variant = theme[mode];
    const canvas = variant?.canvas ?? (theme.canvas && modeOf(theme.canvas) === mode ? theme.canvas : undefined);
    const accent = variant?.accent ?? theme.accent;
    const colors = {
      ...(canvas ? canvasPalette(canvas, mode) : {}),
      ...(accent ? accentPalette(accent, mode, canvas ?? (mode === "dark" ? "#121212" : "#ffffff")) : {}),
      ...theme.colors,
      ...variant?.colors,
    };
    for (const role of THEME_COLOR_ROLES) {
      const value = colors[role];
      if (!value) continue;
      root.style.setProperty(`--color-${role}`, value);
      painted.push(`--color-${role}`);
    }
    if (canvas) {
      root.style.setProperty("--code-color-scheme", mode);
      painted.push("--code-color-scheme");
    }
    if (theme.font) {
      root.style.setProperty("--font-sans", theme.font);
      root.style.setProperty("--tracking-ui", "0");
      painted.push("--font-sans", "--tracking-ui");
    }
    root.dataset.theme = shown.id;
    applyThemeCss(theme.css ?? "");
    return true;
  } finally {
    painting = false;
  }
}

function paint(): void {
  if (draw()) for (const listener of listeners) listener();
}

/** Paints a theme being edited over the worn one, in this window only and remembered nowhere, until `null` or the
 * reset keys. */
export function previewTheme(next: WornTheme | null): void {
  preview = next;
  draw();
}

/** Wears `next` in this window, remembering it so the next start paints it before the server answers. */
export function wearTheme(next: WornTheme | null): void {
  worn = next;
  try {
    if (next) storage("localStorage")?.setItem(CACHE_KEY, JSON.stringify(next));
    else storage("localStorage")?.removeItem(CACHE_KEY);
  } catch {
  }
  paint();
}

function cachedTheme(): WornTheme | null {
  try {
    const raw = JSON.parse(storage("localStorage")?.getItem(CACHE_KEY) ?? "null") as { id?: unknown; theme?: unknown } | null;
    const theme = themeFileSchema.safeParse(raw?.theme);
    return typeof raw?.id === "string" && theme.success ? { id: raw.id, theme: theme.data } : null;
  } catch {
    return null;
  }
}

/** Asks the server which theme this person wears and wears it. A failed read keeps what is painted. */
export async function loadTheme(): Promise<void> {
  try {
    const res = await fetch("/api/themes/active", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const active = (await res.json()) as ActiveTheme;
    const theme = active.theme ? themeFileSchema.safeParse(active.theme) : null;
    wearTheme(active.id && theme?.success ? { id: active.id, theme: theme.data } : null);
  } catch {
  }
}

/** A `theme` frame: this person's theme changed in another window, in Settings or by a bot. */
export function applyThemeFrame(frame: { skin?: string }): void {
  const skin = frame.skin;
  if (skin === "system" || SKIN_IDS.includes(skin as (typeof SKIN_IDS)[number])) applySkinChoice(skin as SkinChoice);
  void loadTheme();
}

const wearOnServer = (id: string | null, skin?: SkinChoice) =>
  fetch("/api/themes/active", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...(skin ? { skin } : {}) }) })
    .then((res) => res.ok, () => false);

/** Takes the custom theme off for this person, here at once and on the server for their other windows. */
export function takeOffTheme(): void {
  if (!worn) return;
  wearTheme(null);
  void wearOnServer(null);
}

/** A skin picked from the grid: any custom theme comes off, so the skin shows. */
export function chooseSkin(id: SkinId): void {
  preview = null;
  takeOffTheme();
  applySkinChoice(id);
}

/** A skin choice from the Light or dark row or a bot: a theme that follows System, Light or Dark stays on for those; any
 * other theme, or any other skin, takes the theme off, so the choice shows. */
export function chooseSkinChoice(choice: SkinChoice): void {
  const hides = (theme: WornTheme | null) => Boolean(theme && (!isLightOrDark(choice) || ownSkin(theme.theme)));
  if (hides(preview)) preview = null;
  if (hides(worn)) takeOffTheme();
  applySkinChoice(choice);
}

/** Wears one of the person's saved themes, here and in their other windows; false when the server refused. */
export async function chooseTheme(id: string | null): Promise<boolean> {
  const done = await wearOnServer(id);
  if (done) await loadTheme();
  return done;
}

/** The way back from any theme: drops it and wears the default skin, whatever the server says. */
export function resetLook(): void {
  preview = null;
  applySkinChoice(DEFAULT_SKIN_CHOICE);
  wearTheme(null);
  void wearOnServer(null, DEFAULT_SKIN_CHOICE);
}

/** Cmd+Option+Shift+R on a Mac, Ctrl+Alt+Shift+R elsewhere. */
export const isResetLookKey = (event: Pick<KeyboardEvent, "code" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">) =>
  event.code === "KeyR" && event.altKey && event.shiftKey && (event.metaKey || event.ctrlKey);

/** Before first paint: wears the remembered theme and listens for the reset keys on the window itself, where no
 * stylesheet can hide them. */
export function startTheme(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", (event) => {
    if (!isResetLookKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    resetLook();
  }, { capture: true });
  subscribeSkin(paint);
  if (typeof matchMedia === "function") {
    try {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
    } catch {
    }
  }
  worn = cachedTheme();
  if (worn) paint();
}
