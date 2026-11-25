/** Every body a bot can wear: the gradient catalog plus the carved bodies. */

import { z } from "zod";

import { DEFAULT_MASCOT_BODY, MASCOT_BODY_IDS } from "./mascot-bodies.ts";
import { CARVED_BODY_IDS, DIWALI_BODY_IDS, HALLOWEEN_BODY_IDS, type CarvedBodyId } from "./carved-bodies.ts";

export const BOT_BODY_IDS = [...MASCOT_BODY_IDS, ...CARVED_BODY_IDS] as const;

export type BotBodyId = (typeof BOT_BODY_IDS)[number];

export const botBodySchema = z.enum(BOT_BODY_IDS);

/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botBodyId(value: unknown): BotBodyId {
  const id = botBodySchema.safeParse(value).data;
  return id === "cursor" ? DEFAULT_MASCOT_BODY : id ?? DEFAULT_MASCOT_BODY;
}

export function isCarvedBody(value: unknown): value is CarvedBodyId {
  return (CARVED_BODY_IDS as readonly unknown[]).includes(value);
}

/** The carved bodies as the avatar picker groups them, one row each. */
export const BODY_PACKS = { halloween: HALLOWEEN_BODY_IDS, diwali: DIWALI_BODY_IDS } as const;

export type BodyPackId = keyof typeof BODY_PACKS;

export const BODY_PACK_IDS = Object.keys(BODY_PACKS) as BodyPackId[];
