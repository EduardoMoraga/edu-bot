import { expect, it } from "vitest";
import { DESKTOP_AUTO_UPDATE, DESKTOP_AUTO_UPDATE_PLATFORMS } from "./desktop-updates.mjs";

it("updates itself on Windows and Linux only; macOS stays manual until its builds are signed", () => {
  expect([...DESKTOP_AUTO_UPDATE_PLATFORMS].sort()).toEqual(["linux", "win32"]);
  expect(DESKTOP_AUTO_UPDATE_PLATFORMS.has("darwin")).toBe(false);
  expect(DESKTOP_AUTO_UPDATE).toBe(DESKTOP_AUTO_UPDATE_PLATFORMS.has(process.platform));
});
