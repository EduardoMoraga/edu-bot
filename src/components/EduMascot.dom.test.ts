// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EduMascot, type EduMascotMood } from "./EduMascot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const MOODS: EduMascotMood[] = ["idle", "happy", "thinking"];
let host: HTMLDivElement, root: Root;
const draw = (props: Parameters<typeof EduMascot>[0] = {}) => act(async () => { root.render(createElement(EduMascot, props)); });
const mascot = () => host.querySelector<HTMLElement>("[data-edu-mascot]")!;
const moving = () => mascot().hasAttribute("data-moving");

beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("the Edu mascot", () => {
  it.each(MOODS)("%s is one speech-bubble character painted only with skin tokens, so it reads in every skin", async (mood) => {
    await draw({ mood });
    expect(mascot().dataset.eduMascot).toBe(mood);
    const paints = [...mascot().querySelectorAll("[fill], [stroke]")].flatMap((node) => [node.getAttribute("fill"), node.getAttribute("stroke")]).filter((paint) => paint && paint !== "none");
    expect(new Set(paints).has("var(--color-accent)")).toBe(true);
    for (const paint of paints) expect(paint).toMatch(/^var\(--color-accent(-ink|-text)?\)$/);
  });

  it("each mood has its own face: a spark when happy, thought dots when thinking, neither at rest", async () => {
    const marks = async (mood: EduMascotMood) => { await draw({ mood }); return [mascot().querySelectorAll(".edu-mascot-hop").length, mascot().querySelectorAll(".edu-mascot-dot").length]; };
    expect(await marks("idle")).toEqual([0, 0]);
    expect(await marks("happy")).toEqual([1, 0]);
    expect(await marks("thinking")).toEqual([0, 3]);
    const faces = new Set<string>();
    for (const mood of MOODS) { await draw({ mood }); faces.add(mascot().innerHTML); }
    expect(faces.size).toBe(3);
  });

  it("is never a bot's face: it carries no avatar marks a theme restyles", async () => {
    await draw();
    expect(host.querySelector("[data-avatar], [data-avatar-kind]")).toBeNull();
  });

  it("is decoration unless it is given a name", async () => {
    await draw();
    expect(mascot().getAttribute("aria-hidden")).toBe("true");
    expect(mascot().getAttribute("role")).toBeNull();
    await draw({ label: "Edu Bot" });
    expect(mascot().getAttribute("role")).toBe("img");
    expect(mascot().getAttribute("aria-label")).toBe("Edu Bot");
    expect(mascot().hasAttribute("aria-hidden")).toBe(false);
  });

  it("moves with CSS alone, no timer or frame of its own, and holds still when told to", async () => {
    vi.useFakeTimers();
    await draw({ mood: "thinking" });
    expect(moving()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await draw({ mood: "thinking", animated: false });
    expect(moving()).toBe(false);
  });

  it("reduced motion holds it still: the dev hook or the system setting, switched while it is shown", async () => {
    let reduce = false;
    const changes = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({ matches: reduce && query.includes("reduce"), media: query,
      addEventListener: (_: string, changed: () => void) => changes.add(changed), removeEventListener: (_: string, changed: () => void) => changes.delete(changed) }) as unknown as MediaQueryList);
    await draw({ mood: "happy" });
    expect(moving()).toBe(true);
    reduce = true;
    await act(async () => { changes.forEach((changed) => changed()); });
    expect(moving(), "system setting on").toBe(false);
    reduce = false;
    await act(async () => { changes.forEach((changed) => changed()); });
    expect(moving(), "system setting off").toBe(true);
    await act(async () => { document.documentElement.dataset.reducedMotion = "true"; await Promise.resolve(); });
    expect(moving(), "dev hook on").toBe(false);
  });

  it("its CSS animates only a mascot that may move, within the 300ms ceiling for the hop, and never under reduced motion", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const rules = css.split("\n").filter((line) => /animation: edu-mascot-/.test(line));
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule.startsWith("[data-edu-mascot][data-moving] ")).toBe(true);
    expect(css).toContain("animation: edu-mascot-hop 300ms");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \[data-edu-mascot\] :is\(\.edu-mascot-hop, \.edu-mascot-dot\) \{ animation: none; \}/);
    expect(css).toContain(':root[data-reduced-motion="true"] [data-edu-mascot] :is(.edu-mascot-hop, .edu-mascot-dot) { animation: none; }');
  });
});
