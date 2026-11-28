import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthPairResponse, TailnetSignInErrorCode } from "../../shared/wire.ts";
import type { EnvironmentDescriptor } from "../environment.ts";
import { json, readBody } from "../harness/http.ts";
import { requestOrigin, serializeSessionCookie } from "../request-auth.ts";
import { cookieMaxAgeSeconds } from "../sessions.ts";
import { createTailnetSignIn, readTailnetSignIn, type TailnetSignInOptions } from "../tailnet-trust.ts";

export const TAILNET_SIGN_IN_PATH = "/api/auth/tailnet";

export interface TailnetSignInRouteDeps extends TailnetSignInOptions {
  cookieName: string;
  environment(): EnvironmentDescriptor;
}

/**
 * Security: no code, and no click, for a computer of this one's own Tailscale owner: Tailscale itself must say the caller
 * is an untagged node of that same login, and it must have connected straight to this server's tailnet listener. JSON
 * only, like POST /api/auth/pair: a cross-site form cannot send that content type without a preflight.
 */
export function createTailnetSignInRoute(deps: TailnetSignInRouteDeps) {
  const signIn = createTailnetSignIn(deps);
  return async function tailnetSignInRoute(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
    if (method !== "POST" || path !== TAILNET_SIGN_IN_PATH) return false;
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      json(res, 415, { error: "send it as JSON (content-type: application/json)", code: "tailnet_bad_request" satisfies TailnetSignInErrorCode });
      return true;
    }
    const ask = readTailnetSignIn(await readBody(req));
    if (!ask) {
      json(res, 400, { error: "send this computer's name as label", code: "tailnet_bad_request" satisfies TailnetSignInErrorCode });
      return true;
    }
    const result = await signIn(req, ask.label);
    if (!result.ok) {
      if (result.retryAfterMs !== undefined) res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
      json(res, result.status, { error: result.error, code: result.code, ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}) });
      return true;
    }
    const environment = deps.environment();
    if (ask.cookie) {
      const secure = requestOrigin(req)?.startsWith("https://") === true;
      res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, result.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(result.session) }));
      json(res, 200, { session: result.session, environment });
      return true;
    }
    json(res, 200, { token: result.token, session: result.session, environment } satisfies AuthPairResponse);
    return true;
  };
}
