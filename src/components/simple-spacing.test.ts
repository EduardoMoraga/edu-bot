import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowSelectedSurface, rowSurface } from "./SidebarRowMarkers";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Simple mode's calmer spacing", () => {
  it("pads a Settings row 16px above and below in Simple mode only", () => {
    const rule = /\[data-settings-page-open\]:not\(\[data-settings-advanced\]\) :is\(\[data-setting-row\], \[data-settings-row-button\], \[data-settings-empty\]\) \{\s*padding-block: calc\(var\(--spacing\) \* 4\);\s*\}/;
    expect(css).toMatch(rule);
    expect(css.match(/\[data-settings-advanced\]/g)).toHaveLength(1);
  });
});

describe("the sidebar's selected row", () => {
  it("wears the skin's selected fill with a 3px accent mark on its leading edge", () => {
    const classes = rowSelectedSurface.split(" ");
    expect(classes).toEqual(expect.arrayContaining([
      "bg-raised-hover", "bg-[linear-gradient(var(--color-accent-text),var(--color-accent-text))]", "bg-[length:3px_50%]",
      "bg-[position:left_center]", "rtl:bg-[position:right_center]", "bg-no-repeat",
    ]));
    expect(rowSurface(true)).toBe("[--row:var(--color-raised-hover)]");
  });
});
