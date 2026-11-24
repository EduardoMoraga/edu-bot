import { afterEach, describe, expect, it } from "vitest";

import { cliProbeFailure, cliWithoutVersion, PROBE_REASONS } from "../../server/drivers/acp/probe-reason";
import { engineReason } from "./engine-reason";
import { setLocale } from "./i18n";
import { en } from "@/locales";

afterEach(() => { setLocale("en"); });

describe("engineReason", () => {
  it("is the English the catalog holds for every CLI probe reason", () => {
    for (const [key, english] of Object.entries(PROBE_REASONS)) expect(en[key as keyof typeof en], key).toBe(english);
  });

  it("shows a missing CLI in the app's language, and the server's English for any other key", () => {
    const missing = cliProbeFailure("agy", Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" }));
    expect(engineReason(missing)).toBe(missing.reason);
    setLocale("es");
    expect(engineReason(missing)).toBe("`agy` no está instalado, o no está en el PATH de esta app. Instálalo para el usuario que ejecuta Edu Bot o usa Definir CLI, y vuelve a revisar.");
    expect(engineReason(cliWithoutVersion("agy"))).toContain("no devolvió una versión");
    expect(engineReason({ reason: "Raw English", reasonKey: "settings.title" })).toBe("Raw English");
    expect(engineReason({ reason: "Raw English" })).toBe("Raw English");
  });
});
