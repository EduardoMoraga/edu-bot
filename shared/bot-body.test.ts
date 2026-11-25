import { describe, expect, it } from "vitest";

import { BODY_PACK_IDS, BODY_PACKS, BOT_BODY_IDS, botBodyId, botBodySchema, isCarvedBody } from "./bot-body.ts";
import { CARVED_BODY_IDS } from "./carved-bodies.ts";
import { MASCOT_BODY_IDS } from "./mascot-bodies.ts";

describe("bot bodies", () => {
  it("accepts every gradient body and every carved body", () => {
    expect(BOT_BODY_IDS).toEqual([...MASCOT_BODY_IDS, ...CARVED_BODY_IDS]);
    for (const id of BOT_BODY_IDS) expect(botBodySchema.safeParse(id).success).toBe(true);
  });

  it("falls back to the squircle for anything it does not know", () => {
    expect(botBodyId("pumpkin")).toBe("pumpkin");
    expect(botBodyId("laddu")).toBe("laddu");
    expect(botBodyId("star")).toBe("star");
    expect(botBodyId("hexagram")).toBe("squircle");
    expect(botBodyId(undefined)).toBe("squircle");
  });

  it("tells the carved bodies apart", () => {
    expect(isCarvedBody("ghost")).toBe(true);
    expect(isCarvedBody("jalebi")).toBe(true);
    expect(isCarvedBody("cursor")).toBe(false);
    expect(isCarvedBody(null)).toBe(false);
  });

  it("groups the carved bodies in packs, each body in one", () => {
    expect(BODY_PACK_IDS).toEqual(["halloween", "diwali"]);
    expect(BODY_PACK_IDS.flatMap((pack) => BODY_PACKS[pack])).toEqual([...CARVED_BODY_IDS]);
  });
});
