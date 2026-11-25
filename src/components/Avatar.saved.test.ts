import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotAvatar, type BotAvatarProps } from "./Avatar";

const drawn = (bot: BotAvatarProps["bot"]) => renderToStaticMarkup(createElement(BotAvatar, { bot, size: 44, animated: false }));
const print = (bot: BotAvatarProps["bot"]) => createHash("sha256").update(drawn(bot)).digest("hex").slice(0, 16);

describe("a saved bot's face", () => {
  it("is drawn as it was saved, classic or carved, whatever the app's own mascot looks like", () => {
    expect({
      classic: print({ name: "Pepper", color: "green" }),
      classicBody: print({ name: "Pepper", color: "purple", mascotBody: "star", mascotFaceColor: "black" }),
      chrome: print({ name: "Pepper", color: "chrome" }),
      pumpkin: print({ name: "Pepper", color: "orange", mascotBody: "pumpkin" }),
      laddu: print({ name: "Pepper", color: "yellow", mascotBody: "laddu", mascotFaceColor: "white" }),
    }).toMatchInlineSnapshot(`
      {
        "chrome": "7537bb5da43153ae",
        "classic": "8cf0aed34a4c1d45",
        "classicBody": "d5e47996b587642e",
        "laddu": "172a8a185fffcdac",
        "pumpkin": "15c60fa3e7653f74",
      }
    `);
  });

  it.each(["star", "pumpkin"] as const)("with the %s body is a bot's face, not the Edu mascot", (mascotBody) => {
    const markup = drawn({ name: "Pepper", color: "orange", mascotBody });
    expect(markup).toContain('data-avatar="mascot" data-avatar-kind="bot"');
    expect(markup).not.toContain("data-edu-mascot");
  });
});
