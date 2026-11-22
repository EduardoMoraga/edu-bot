import { describe, expect, it } from "vitest";

import { cloudBase, createEduCloud, EDU_CLOUD_NO_TOKEN, usableCloudToken } from "./edu-cloud.ts";

const TOKEN = "s".repeat(48);
const bot = (token = "EDU_CLOUD_BI") => ({ id: "b1", eduBrain: { mode: "cloud" as const, url: "https://brain.example/team/mcp", token: { secret: token } } });

function fakeServer(routes: Record<string, (init: RequestInit) => Response>) {
  const seen: Array<{ url: string; method: string; authorization: string | null; redirect?: RequestInit["redirect"] }> = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    seen.push({ url, method: init.method ?? "GET", authorization: headers.get("authorization"), redirect: init.redirect });
    const route = routes[`${init.method ?? "GET"} ${new URL(url).pathname}`];
    return route ? route(init) : Response.json({ error: "Not found" }, { status: 404 });
  }) as typeof fetch;
  return { fetcher, seen };
}

describe("edu-cloud brains", () => {
  it("finds the review routes beside /mcp and sends a token only when one is saved", () => {
    expect(cloudBase("https://brain.example/team/mcp")).toBe("https://brain.example/team");
    expect(cloudBase("https://brain.example/mcp/")).toBe("https://brain.example");
    expect(usableCloudToken(` ${TOKEN} `)).toBe(TOKEN);
    expect(usableCloudToken("short")).toBeNull();
    expect(usableCloudToken("has space in it, which no token does")).toBeNull();
  });

  it("reads an older edu-cloud as one without review: no proposals, approved on the server", async () => {
    const { fetcher, seen } = fakeServer({});
    const cloud = createEduCloud({ token: () => TOKEN, fetch: fetcher });
    expect(await cloud.view(bot())).toEqual({ url: "https://brain.example/team/mcp", token: "EDU_CLOUD_BI", review: false });
    expect(await cloud.list(bot())).toEqual([]);
    expect(await cloud.steward(bot())).toBe(false);
    expect(seen.every((call) => call.authorization === `Bearer ${TOKEN}` && call.redirect === "error")).toBe(true);
    expect(seen.map((call) => call.url)).toContain("https://brain.example/team/api/v1/whoami");
  });

  it("lists a member's proposals read-only and lets a steward decide them", async () => {
    let scope = "member";
    const decided: string[] = [];
    const { fetcher } = fakeServer({
      "GET /team/api/v1/whoami": () => Response.json({ label: "ana@example.com", teamId: "bi", scope, review: true }),
      "GET /team/api/v1/proposals": () => Response.json({ proposals: [
        { id: "C-20261122-revenue", title: "Revenue means net revenue", kind: "domain", band: "inferred", why: "interpretation", body: "Net of returns." },
        { id: "--flag", title: "Not an id" },
      ], mayDecide: scope === "steward" }),
      "POST /team/api/v1/proposals/C-20261122-revenue/approve": () => scope === "steward"
        ? (decided.push("approve"), Response.json({ id: "C-20261122-revenue", outcome: "accepted" }))
        : Response.json({ error: "Only a steward token can approve or reject proposals" }, { status: 403 }),
      "POST /team/api/v1/proposals/C-20261122-revenue/reject": (init) => (decided.push(`reject ${String(init.body)}`), Response.json({ outcome: "rejected" })),
    });
    let now = 0;
    const cloud = createEduCloud({ token: () => TOKEN, fetch: fetcher, now: () => now });
    expect(await cloud.view(bot())).toMatchObject({ review: true, label: "ana@example.com", scope: "member" });
    expect(await cloud.list(bot())).toEqual([{
      id: "C-20261122-revenue", title: "Revenue means net revenue", kind: "domain", band: "inferred", why: "interpretation",
      brain: "https://brain.example/team/mcp", global: false, location: "https://brain.example/team/mcp", shared: true, cloud: true, body: "Net of returns.",
    }]);
    expect(await cloud.decide(bot(), "C-20261122-revenue", true)).toEqual({ status: 403, error: "Only a steward of this edu-cloud brain can approve or reject its proposals." });
    scope = "steward";
    now += 61_000;
    expect(await cloud.steward(bot())).toBe(true);
    expect(await cloud.decide(bot(), "C-20261122-revenue", true)).toBe("accepted");
    expect(await cloud.decide(bot(), "C-20261122-revenue", false, "Rejected in Edu Bot")).toBe("rejected");
    expect(await cloud.decide(bot(), "C-20261122-other", true)).toBe("gone");
    expect(await cloud.decide(bot(), "--flag", true)).toEqual({ status: 400, error: "That isn't an Edu proposal id." });
    expect(decided).toEqual(["approve", 'reject {"reason":"Rejected in Edu Bot"}']);
  });

  it("asks for the token before anything leaves this computer", async () => {
    const { fetcher, seen } = fakeServer({});
    const cloud = createEduCloud({ token: () => null, fetch: fetcher });
    expect(await cloud.view(bot())).toEqual({ url: "https://brain.example/team/mcp", token: "EDU_CLOUD_BI", tokenMissing: true, review: false });
    await expect(cloud.list(bot())).rejects.toThrow(EDU_CLOUD_NO_TOKEN);
    await expect(cloud.brief(bot())).rejects.toThrow(EDU_CLOUD_NO_TOKEN);
    expect(await cloud.decide(bot(), "C-1", true)).toEqual({ status: 409, error: EDU_CLOUD_NO_TOKEN });
    expect(cloud.server(bot())).toBeNull();
    expect(seen).toEqual([]);
  });
});
