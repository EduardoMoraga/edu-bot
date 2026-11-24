import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { appSettingLabel, credentialDescription, credentialLabel, credentialPlaceholder } from "./server-labels";

afterEach(() => setLocale("en"));

describe("server labels", () => {
  it("translates only the English the server sends for a known setting or key", () => {
    setLocale("es");
    expect(appSettingLabel("rooms.turnTimeoutMinutes", "Room turn timeout")).toBe("Límite de tiempo de turno en grupos");
    expect(appSettingLabel("rooms.turnTimeoutMinutes", "Renamed upstream")).toBe("Renamed upstream");
    expect(appSettingLabel("unknown.setting", "Some label")).toBe("Some label");
    expect(credentialLabel("xaiApiKey", "xAI API key")).toBe("Clave API de xAI");
    expect(credentialDescription("xaiApiKey", "Used by the built-in Grok provider. Ventas puede usarlo, pero nunca leerlo."))
      .toBe("La usa el proveedor Grok integrado. Ventas puede usarlo, pero nunca leerlo.");
    expect(credentialDescription("xaiApiKey", "Something else.")).toBe("Something else.");
    expect(credentialPlaceholder("boxToken", "Boat API key", "Paste your Boat API key")).toBe("Pega aquí: Clave API de Boat");
    expect(credentialPlaceholder("xaiApiKey", "xAI API key", "xai-…")).toBe("xai-…");
    setLocale("en");
    expect(credentialLabel("xaiApiKey", "xAI API key")).toBe("xAI API key");
    expect(credentialPlaceholder("boxToken", "Boat API key", "Paste your Boat API key")).toBe("Paste your Boat API key");
  });
});
