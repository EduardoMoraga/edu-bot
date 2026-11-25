import { SKIN_IDS, isRetiredSkin } from "../../shared/app-settings";
import { paintAuroraField } from "./aurora-field";
import { hasPriorRun } from "./prior-run";
import { windowPrefChanged } from "./window-pref-changes";

export { SKIN_IDS };
export type SkinId = (typeof SKIN_IDS)[number];

export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
};

export const SKINS: readonly Skin[] = [
  { id: "meadow", name: "Edu", tagline: "Fresh white with a calm green. The Edu Bot look." },
  { id: "edu-night", name: "Edu Night", tagline: "The Edu Bot look after dark. Deep green-black with the same calm green." },
  { id: "midnight", name: "Classic", tagline: "The original. Cool and dark." },
  { id: "atelier", name: "Atelier", tagline: "Daylight on paper, warm and quiet." },
  { id: "foundry", name: "Foundry", tagline: "Night shift. Dark, warm, lit in brass." },
  { id: "lagoon", name: "Lagoon", tagline: "Cool daylight. Porcelain and deep teal." },
  { id: "graphite", name: "Graphite", tagline: "Quiet charcoal and softened steel blue." },
  { id: "linen", name: "Linen", tagline: "Clean daylight with a restrained navy accent." },
  { id: "dusk", name: "Dusk", tagline: "Muted plum after dark, calm and low-key." },
  { id: "daylight", name: "Daylight", tagline: "Classic in reverse. Near-white, ink-black bubbles." },
  { id: "pop", name: "Pop", tagline: "Cream paper, thick ink outlines, hard shadows. Chunky and cheerful." },
  { id: "aurora", name: "Aurora", tagline: "Near-black, crossed by a band of green light. Glass on top." },
];

/** "system" follows the OS between a light and a dark skin; anything else pins one skin. */
export type SkinChoice = SkinId | "system";
type ThemeSkins = Readonly<Record<"light" | "dark", SkinId>>;
/** What System, Light and Dark wear on an install that starts with this version. */
export const THEME_SKINS = { light: "meadow", dark: "edu-night" } as const satisfies ThemeSkins;
/** What they wore before the Edu pair; an install from then keeps them, so its look does not change under it. */
export const CLASSIC_THEME_SKINS = { light: "daylight", dark: "midnight" } as const satisfies ThemeSkins;

export const DEFAULT_SKIN_CHOICE: SkinChoice = "system";
export const PRIOR_INSTALL_SKIN: SkinId = "midnight";

const KEY = "omb-skin";
const PAIR_KEY = "omb-theme-skins";
const PAIRS = { edu: THEME_SKINS, classic: CLASSIC_THEME_SKINS } as const;
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isSkinId(value: unknown): value is SkinId {
  return SKIN_IDS.includes(value as SkinId);
}

function isSkinChoice(value: unknown): value is SkinChoice {
  return value === "system" || isSkinId(value);
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

export function resolveSkin(choice: SkinChoice, prefersDark = systemPrefersDark()): SkinId {
  if (choice !== "system") return choice;
  return themeSkins()[prefersDark ? "dark" : "light"];
}

// With storage blocked the localStorage getter itself throws, and `typeof` alone doesn't shield it.
function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The pair this install's System, Light and Dark wear, settled once: the Edu pair for a new install or one whose saved
 * skin was retired, the classic pair for any other install that ran before. */
export function themeSkins(): ThemeSkins {
  try {
    const store = getStore();
    const settled = store?.getItem(PAIR_KEY);
    if (settled === "edu" || settled === "classic") return PAIRS[settled];
    const pair = hasPriorRun(store) && !isRetiredSkin(store?.getItem(KEY)) ? "classic" : "edu";
    store?.setItem(PAIR_KEY, pair);
    return PAIRS[pair];
  } catch {
    return THEME_SKINS;
  }
}

export function readSkinChoice(): SkinChoice {
  try {
    const store = getStore();
    const stored = store?.getItem(KEY);
    if (isSkinChoice(stored)) return stored;
    if (isRetiredSkin(stored)) return DEFAULT_SKIN_CHOICE;
    return hasPriorRun(store) ? PRIOR_INSTALL_SKIN : DEFAULT_SKIN_CHOICE;
  } catch {
    return PRIOR_INSTALL_SKIN;
  }
}

export function readSkin(): SkinId {
  return resolveSkin(readSkinChoice());
}

let followingSystem: { query: MediaQueryList; onChange: () => void } | null = null;
const listeners = new Set<() => void>();

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function paintSkin(id: SkinId): void {
  document.documentElement.dataset.skin = id;
  if (id === "aurora") paintAuroraField();
  for (const listener of listeners) listener();
  // On Windows the caption buttons sit in a native overlay the main process paints, out of CSS's reach.
  try {
    void window.ogb?.applySkin?.(id)?.catch(() => undefined);
  } catch {
  }
}

function followSystem(follow: boolean): void {
  if (followingSystem && !follow) {
    followingSystem.query.removeEventListener("change", followingSystem.onChange);
    followingSystem = null;
  }
  if (!follow || followingSystem || typeof matchMedia !== "function") return;
  try {
    const query = matchMedia(DARK_QUERY);
    const onChange = () => paintSkin(resolveSkin("system", query.matches));
    query.addEventListener("change", onChange);
    followingSystem = { query, onChange };
  } catch {
  }
}

/** Wears a skin another page chose, without keeping it as this page's own choice or telling the app (the window's rail
 * wearing the skin of the page beside it). */
export function wearSkin(value: unknown): void {
  if (!isSkinId(value)) return;
  document.documentElement.dataset.skin = value;
  for (const listener of listeners) listener();
}

export function applySkinChoice(choice: SkinChoice): void {
  themeSkins();
  try {
    getStore()?.setItem(KEY, choice);
  } catch {
  }
  followSystem(choice === "system");
  paintSkin(resolveSkin(choice));
  windowPrefChanged();
}

export function applySkin(id: SkinId): void {
  applySkinChoice(id);
}
