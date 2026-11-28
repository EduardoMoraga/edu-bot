// POST /api/auth/tailnet on a real server shared on the tailnet, with a scripted `tailscale`. As in
// tailnet-listener.e2e.test.ts, one of the runner's own non-loopback addresses stands in for a tailnet address, so the
// caller dialing it arrives from that address.
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { fakeTailscale, tailnetStatus, tailnetWhois } from "./testing/fake-tailscale.ts";

const NAME = "fixture.tail1234.ts.net";

const standIn = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))?.address;

function dial(address: string, port: number, path: string, headers: Record<string, string>, method = "GET", body?: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const call = request({ host: address, port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    call.on("error", reject);
    call.end(body);
  });
}

describe.skipIf(!standIn || process.platform === "win32")("signing in from the owner's other computer on the tailnet", () => {
  it("gives that computer a full session with no code, one per computer, and refuses every other way in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-tailnet-trust-e2e-"));
    const tailscale = fakeTailscale({ under: dir });
    tailscale.status(tailnetStatus());
    tailscale.whois({ [standIn!]: tailnetWhois({ address: standIn! }) });
    const fixture = await launchVerificationServer({ OMB_DEV_TRUST_LOCAL_BROWSER: "0", OMB_TAILNET_NAME: NAME, OMB_TAILNET_ADDRESSES: standIn!, OMB_TEST_TAILNET_STAND_IN: standIn!, OMB_TEST_TAILSCALE_CLI: tailscale.cli });
    const port = Number(new URL(fixture.info.url).port);
    const host = `${NAME}:${port}`;
    const json = { host, "content-type": "application/json" };
    const page = { host, origin: `http://${host}`, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
    const signIn = (body: unknown, headers: Record<string, string> = json) => dial(standIn!, port, "/api/auth/tailnet", headers, "POST", JSON.stringify(body));
    try {
      let descriptor = { status: 0, headers: {}, body: "" } as Awaited<ReturnType<typeof dial>>;
      for (let attempt = 0; attempt < 50 && descriptor.status !== 200; attempt++) {
        descriptor = await dial(standIn!, port, "/.well-known/openmausbot/environment", { host }).catch(() => descriptor);
        if (descriptor.status !== 200) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(descriptor.status).toBe(200);
      expect(JSON.parse(descriptor.body).capabilities.tailnetTrust).toBe(true);

      expect((await dial(standIn!, port, "/api/auth/tailnet", { host, "content-type": "text/plain" }, "POST", "{\"label\":\"PC\"}")).status).toBe(415);
      expect((await signIn({ label: "" })).status).toBe(400);
      expect(tailscale.calls(), "nothing asked of Tailscale before a real attempt").toEqual([]);

      // The same request on loopback, or naming a proxy, is never this.
      const loopback = await fetch(`${fixture.info.url}/api/auth/tailnet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "PC" }) });
      expect(loopback.status).toBe(403);
      expect((await loopback.json() as { code: string }).code).toBe("tailnet_not_direct");
      const proxied = await signIn({ label: "PC" }, { ...json, "x-forwarded-for": standIn! });
      expect(proxied.status).toBe(403);
      expect(JSON.parse(proxied.body).code).toBe("tailnet_not_direct");
      expect(tailscale.calls()).toEqual([]);

      const first = await signIn({ label: "Windows PC", platform: "win32" });
      expect(first.status).toBe(200);
      const answer = JSON.parse(first.body) as { token: string; session: { id: string; label: string; scopes: string[] }; environment: { capabilities: { tailnetTrust?: true } } };
      expect(answer.session).toMatchObject({ label: "Windows PC (Tailscale)", scopes: ["admin", "client"] });
      expect(answer.environment.capabilities.tailnetTrust).toBe(true);
      expect(first.headers["set-cookie"]).toBeUndefined();
      expect(tailscale.calls()).toEqual(expect.arrayContaining([["status", "--json"], ["whois", "--json", standIn!]]));
      const bearer = { host, authorization: `Bearer ${answer.token}`, "content-type": "application/json" };
      expect((await dial(standIn!, port, "/api/auth/pairing", bearer, "POST", "{}")).status, "an admin session").toBe(200);

      // The same computer again: its earlier session ends, and the cookie mode answers without the token.
      const again = await signIn({ label: "Windows PC", cookie: true });
      expect(again.status).toBe(200);
      const cookieAnswer = JSON.parse(again.body) as { token?: string; session: { id: string } };
      expect(cookieAnswer.token).toBeUndefined();
      const cookie = String(again.headers["set-cookie"]).split(";", 1)[0]!;
      expect(String(again.headers["set-cookie"])).toMatch(/HttpOnly/i);
      expect((await dial(standIn!, port, "/api/bots", { ...page, cookie })).status).toBe(200);
      expect((await dial(standIn!, port, "/api/bots", { host, authorization: `Bearer ${answer.token}` })).status, "the first session is over").toBe(401);

      // Tailscale says the caller is someone else's.
      tailscale.whois({ [standIn!]: tailnetWhois({ address: standIn!, login: "someone@example.com" }) });
      const stranger = await signIn({ label: "PC" });
      expect(stranger.status).toBe(403);
      expect(JSON.parse(stranger.body).code).toBe("tailnet_not_trusted");
      tailscale.whois({ [standIn!]: tailnetWhois({ address: standIn!, tags: ["tag:server"] }) });
      expect(JSON.parse((await signIn({ label: "PC" })).body).code).toBe("tailnet_not_trusted");
      expect((await dial(standIn!, port, "/api/bots", { ...page, cookie })).status, "a refusal ends nobody's session").toBe(200);
    } finally {
      await fixture.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
