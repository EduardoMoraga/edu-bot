import assert from "node:assert/strict";
import test from "node:test";

import { askConsent, consentGiven } from "./consent-dialog.mjs";

const question = { type: "question", message: "Let Mac mini use this computer?", grant: "Allow", refuse: "Not now" };
const answering = (response) => { const seen = []; return { seen, showMessageBox: async (...args) => { seen.push(args); return { response }; } }; };

test("the refusing button is first, the default and the cancel button", async () => {
  const dialog = answering(1);
  const parent = { id: 1 };
  assert.equal(await askConsent(dialog, parent, question), "granted");
  assert.deepEqual(dialog.seen, [[parent, { type: "question", message: question.message, buttons: ["Not now", "Allow"], defaultId: 0, cancelId: 0 }]]);
  const alone = answering(1);
  await askConsent(alone, null, question);
  assert.equal(alone.seen[0].length, 1, "no window: the dialog stands alone");
});

test("only the granting button grants", async () => {
  assert.equal(await askConsent(answering(0), null, question), "refused", "a dialog that could not open answers 0");
  for (const unknown of [2, -1, undefined, "1"]) assert.equal(await askConsent(answering(unknown), null, question), "refused");
  assert.equal(await askConsent({ showMessageBox: async () => { throw new Error("no display"); } }, null, question), "refused");
  assert.equal(await askConsent({ showMessageBox: async () => undefined }, null, question), "refused");
  assert.equal(await consentGiven(answering(0), null, question), false);
  assert.equal(await consentGiven(answering(1), null, question), true);
});
