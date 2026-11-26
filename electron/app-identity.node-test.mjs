import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEEP_LINK_SCHEME, ownDeepLink, PHONE_DISCOVERY_SERVICE_TYPE, PHONE_LINK_SCHEME } from "./app-identity.mjs";
import { chatLinkFrom } from "./chat-link.mjs";
import { isCloudDeepLink } from "./cloud-entry.mjs";
import { packageUrlFromDeepLink } from "./package-link.mjs";

const PACKAGE = "https://raw.githubusercontent.com/acme/bots/main/team.md";

test("edubot:// links open, and openmausbot:// ones open the same way", () => {
  for (const scheme of ["edubot", "openmausbot", "OpenMausBot"]) {
    const thread = ownDeepLink(`${scheme}://thread/t-1?bot=b-1`);
    assert.equal(chatLinkFrom(thread), "edubot://thread/t-1?bot=b-1", scheme);
    assert.equal(chatLinkFrom(ownDeepLink(`${scheme}://bot/b-1`)), "edubot://bot/b-1", scheme);
    assert.equal(isCloudDeepLink(ownDeepLink(`${scheme}://cloud`)), true, scheme);
    assert.equal(packageUrlFromDeepLink(ownDeepLink(`${scheme}://install?url=${encodeURIComponent(PACKAGE)}`)), PACKAGE, scheme);
  }
});

test("only a link's scheme changes; anything else passes through untouched", () => {
  for (const value of ["https://example.test/openmausbot://thread/x", "--inspect", "mailto:openmausbot://", "", undefined]) {
    assert.equal(ownDeepLink(value), value);
  }
});

test("the OS hears only edubot://, and the phone apps keep the identifiers they look for", () => {
  assert.equal(DEEP_LINK_SCHEME, "edubot");
  const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(builder, /schemes: \[edubot\]/);
  assert.doesNotMatch(builder, /schemes:.*openmausbot/);
  assert.equal(PHONE_LINK_SCHEME, "openmausbot");
  assert.equal(PHONE_DISCOVERY_SERVICE_TYPE, "_openmausbot._tcp");
});
