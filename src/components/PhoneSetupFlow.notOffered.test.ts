import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { signInNotOffered } from "../lib/phone-setup";
import { PhoneSetupFlowView, type CompanionState, type PhoneSetupController } from "./PhoneSetupFlow";

const state: CompanionState = { enabled: true, keepAwake: false, port: 8810, devices: [], pairing: null, lan: "192.168.1.34" };
const noop = () => {};
const controller = (over: Partial<PhoneSetupController>): PhoneSetupController => ({
  state, account: null, phase: "sign-in", email: "", code: "", codeSent: false, busy: false, accountBusy: false, error: null, accountError: null,
  pairingLink: null, address: null, pairingPort: 8810, addressText: null, hostedReady: false, localFallback: false, tailscaleFallback: false,
  tailscaleAvailable: true, pairingExpired: false, setupTimedOut: false, setEmail: noop, setCode: noop, changeEmail: noop, start: noop, useLocal: noop,
  useTailscale: noop, refreshTailscale: noop, requestCode: noop, verifyCode: noop, retryAccount: noop, cancel: noop, refreshCode: noop, finish: noop,
  act: async () => null, accountAct: async () => {}, ...over,
} as PhoneSetupController);
const render = (over: Partial<PhoneSetupController>) => renderToStaticMarkup(createElement(PhoneSetupFlowView, { controller: controller(over) }));

const noRelay = { available: false, status: "signed-out", message: "Secure access is not available right now. Local pairing still works.", problem: "unconfigured" } as const;

describe("pairing a phone where no relay service is set up", () => {
  it("offers the two ways that work, with nothing to retry and no failure", () => {
    expect(signInNotOffered(noRelay)).toBe(true);
    const html = render({ account: noRelay });
    expect(html).toContain("Choose how your phone connects");
    expect(html).toContain("Pair on this Wi-Fi<");
    expect(html).toContain("Pair using Tailscale");
    for (const gone of ["Secure access needs attention", "Try secure access again", "Secure access is not available", "Pair on this Wi-Fi instead", "role=\"alert\""]) expect(html, gone).not.toContain(gone);
  });

  it("still reports a relay that is set up but cannot be reached", () => {
    const unreachable = { available: false, status: "signed-out", problem: "unreachable" } as const;
    expect(signInNotOffered(unreachable)).toBe(false);
    const html = render({ account: unreachable });
    expect(html).toContain("Secure access needs attention");
    expect(html).toContain("Try secure access again");
    expect(html).toContain("Pair on this Wi-Fi instead");
  });
});
