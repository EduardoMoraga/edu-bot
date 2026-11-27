import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { adoptLegacyOutputs, createCloudFilesService } from "./cloud-sync.mjs";
import { openSyncState } from "./cloud-sync-state.mjs";

function setup(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "edubot-outputs-")));
  const documentsDir = join(dir, "home", "Documents");
  mkdirSync(documentsDir, { recursive: true });
  const state = openSyncState(join(dir, "user", "state.db"));
  const open = [state];
  t.after(() => {
    for (const handle of open.reverse()) handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const legacy = join(documentsDir, "MausBot"), current = join(documentsDir, "Edu Bot");
  const work = (root, file = "plan.md", text = "the plan") => {
    mkdirSync(join(root, "Owl", "Q3"), { recursive: true });
    writeFileSync(join(root, "Owl", "Q3", file), text);
  };
  return { dir, documentsDir, state, legacy, current, work, closesBeforeRemoval: (handle) => open.push(handle) };
}

test("only Documents/MausBot with this app's work: renamed to Documents/Edu Bot once, its places follow", (t) => {
  const s = setup(t);
  s.work(s.legacy);
  s.state.setPlace("bot-owl-q3", join(s.legacy, "Owl", "Q3"));
  const first = adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state });
  assert.deepEqual(first, { dir: s.current, legacy: s.legacy, moved: true });
  assert.equal(existsSync(s.legacy), false);
  assert.equal(readFileSync(join(s.current, "Owl", "Q3", "plan.md"), "utf8"), "the plan");
  assert.equal(s.state.place("bot-owl-q3"), join(s.current, "Owl", "Q3"));
  assert.equal(adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state }).moved, false, "it moves once");
});

test("both folders exist: Edu Bot is used and MausBot is left exactly as it was, never merged", (t) => {
  const s = setup(t);
  s.work(s.legacy, "old.md", "old work");
  s.work(s.current, "new.md", "new work");
  s.state.setPlace("bot-owl-q3", join(s.legacy, "Owl", "Q3"));
  const result = adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state });
  assert.deepEqual(result, { dir: s.current, legacy: s.legacy, moved: false });
  assert.deepEqual(readdirSync(join(s.legacy, "Owl", "Q3")), ["old.md"]);
  assert.deepEqual(readdirSync(join(s.current, "Owl", "Q3")), ["new.md"]);
  assert.equal(s.state.place("bot-owl-q3"), join(s.legacy, "Owl", "Q3"), "a conversation that landed in MausBot keeps landing there");
});

test("neither folder exists: the new name, and nothing is created until work comes down", (t) => {
  const s = setup(t);
  assert.deepEqual(adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state }), { dir: s.current, legacy: s.legacy, moved: false });
  assert.deepEqual(readdirSync(s.documentsDir), []);
});

test("a MausBot folder this app never wrote to belongs to OpenMausBot and is not moved", (t) => {
  const s = setup(t);
  s.work(s.legacy);
  assert.equal(adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state }).moved, false);
  assert.equal(readFileSync(join(s.legacy, "Owl", "Q3", "plan.md"), "utf8"), "the plan");
  assert.equal(existsSync(s.current), false);
});

test("a rename that fails leaves the folder and its places as they were", (t) => {
  const s = setup(t);
  s.work(s.legacy);
  s.state.setPlace("bot-owl-q3", join(s.legacy, "Owl", "Q3"));
  const busy = () => { throw Object.assign(new Error("resource busy"), { code: "EBUSY" }); };
  assert.equal(adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state, rename: busy }).moved, false);
  assert.equal(existsSync(join(s.legacy, "Owl", "Q3", "plan.md")), true);
  assert.equal(s.state.place("bot-owl-q3"), join(s.legacy, "Owl", "Q3"));
});

test("another account's places under the moved folder follow it when its Files open", (t) => {
  const s = setup(t);
  s.work(s.current);
  s.state.setPlace("bot-owl-q3", join(s.legacy, "Owl", "Q3"));
  s.state.setPlace("shared-elsewhere", join(s.dir, "home", "Clients"));
  adoptLegacyOutputs({ documentsDir: s.documentsDir, state: s.state });
  assert.equal(s.state.place("bot-owl-q3"), join(s.current, "Owl", "Q3"));
  assert.equal(s.state.place("shared-elsewhere"), join(s.dir, "home", "Clients"));
});

test("Files shows and opens Documents/Edu Bot after moving this app's MausBot folder", async (t) => {
  const s = setup(t);
  s.work(s.legacy);
  s.state.setPlace("bot-owl-q3", join(s.legacy, "Owl", "Q3"));
  const stateFile = join(s.dir, "user", "state.db");
  const service = createCloudFilesService({
    settingsFile: join(s.dir, "user", "settings.json"), stateFile,
    documentsDir: s.documentsDir, localDataDir: join(s.dir, "home", ".edubot"), homeDir: join(s.dir, "home"),
    cloudOrigin: () => null, fetch: async () => { throw new Error("no network in tests"); }, trashItem: async () => {},
    watch: () => () => {}, freeBytes: () => 100 * 1024 ** 3,
  });
  s.closesBeforeRemoval(service);
  assert.equal(service.state().outputs.dir, s.current);
  assert.equal(readFileSync(join(s.current, "Owl", "Q3", "plan.md"), "utf8"), "the plan");
  assert.equal(s.state.place("bot-owl-q3"), join(s.current, "Owl", "Q3"));
});
