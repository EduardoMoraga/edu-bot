import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { OptionCardData } from "../shared/wire.ts";
import { agentsServerEnv } from "./agents-turn.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { crewFolderRefusal, crewStatus, createEduCrew, eduCrewCommands, pickReviewer, type EduCrewRun } from "./edu-crew.ts";
import type { RequestAuth } from "./request-auth.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const root = mkdtempSync(join(tmpdir(), "edu-crew-"));
afterAll(() => removeTempDir(root));

const CLI = "/opt/edu/dist/cli.js";
const JOB = "11111111-2222-3333-4444-555555555555";
const GATE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GATE2 = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee";
const home = join(root, "home");
const dataDir = join(root, "data");
const project = join(home, "Projects", "shop");
const brain = join(dataDir, "brains", "bot-1");
for (const dir of [project, join(brain, ".edu", "specs"), join(home, ".edu")]) mkdirSync(dir, { recursive: true });
const specPath = join(brain, ".edu", "specs", "add-hello.md");
writeFileSync(specPath, "# Add hello\n\n- **R-1** hello.txt exists\n");

type Message = { id: string; role: string; kind: string; card?: OptionCardData; tool?: { name: string; ok?: boolean }; eduCrew?: unknown };

function setup(options: { eduCrew?: boolean; engine?: string; desktop?: boolean; folder?: string | null; installed?: string[]; edu?: (args: string[]) => { code?: number; stdout?: string; stderr?: string } } = {}) {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const threads = new Map<string, Message[]>();
  let next = 0;
  const bot = { id: "bot-1", name: "Luna", color: "blue", threadId: "t-1", eduCrew: options.eduCrew ?? true };
  const run: EduCrewRun = async (args, { env }) => {
    calls.push({ args, env });
    const answer = options.edu?.(args.slice(1)) ?? {};
    return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
  };
  const binDir = join(root, `bin-${Math.random().toString(36).slice(2)}`);
  mkdirSync(binDir, { recursive: true });
  for (const cli of options.installed ?? ["codex", "claude"]) writeFileSync(join(binDir, cli), "#!/bin/sh\n", { mode: 0o755 });
  const crew = createEduCrew({
    dataDir: mkdtempSync(join(root, "data-")),
    brains: {
      detect: async () => ({ state: "ready", home: join(home, ".edu"), cli: CLI, version: "6.0.0" }),
      brain: async () => ({ ok: true, folder: brain, runtime: { state: "ready", home: join(home, ".edu"), cli: CLI, version: "6.0.0" } }),
    },
    store: {
      bot: (id) => (id === bot.id ? bot : null),
      messagesFor: (threadId) => threads.get(threadId) ?? [],
      appendMessage: (threadId, message) => {
        const row = { ...message, id: `m${++next}` } as Message;
        threads.set(threadId, [...(threads.get(threadId) ?? []), row]);
        return row;
      },
      patchMessage: (threadId, messageId, patch) => {
        threads.set(threadId, (threads.get(threadId) ?? []).map((message) => (message.id === messageId ? { ...message, ...patch } : message)));
      },
    },
    folder: () => (options.folder === undefined ? project : options.folder),
    engine: () => options.engine ?? "claude",
    decide: (row) => decisions.push(row),
    desktop: options.desktop ?? true,
    env: { HOME: home, PATH: binDir, EDU_CREW_JOB: "" },
    path: () => binDir,
    run,
    git: async (args) => (args[0] === "diff" ? "diff --git a/x b/x\n+hello\n" : "abc\n"),
    pollMs: 5,
  });
  return { crew, calls, decisions, threads, bot };
}

const job = (status: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id: JOB, status, ...extra });
const awaiting = (requestId = GATE, extra: Record<string, unknown> = {}) =>
  job("awaiting-approval", { specPath, approval: { requestId, title: "Approve spec" }, ...extra });

async function ask(crew: ReturnType<typeof setup>["crew"], body: unknown, threadId = "t-1") {
  let sent: { status: number; body: { text?: string; error?: string } } | null = null;
  await crew.internal({ method: "POST", path: "/api/internal/edu/crew", res: {}, json: (_res, status, payload) => { sent = { status, body: payload as never }; }, botId: "bot-1", threadId, readBody: async () => body });
  return sent!;
}

const loopback = (trust: "owner" | "service"): RequestAuth => ({ kind: "loopback", trust } as RequestAuth);

describe("Edu crew commands", () => {
  it("never pass a gate themselves, and keep a goal or task past --", () => {
    const all = [
      eduCrewCommands.plan(project, "-y --allow-unregistered-checks ship it", "quick"),
      eduCrewCommands.review(project, "codex", "--yes review"),
      eduCrewCommands.status(project, JOB), eduCrewCommands.cancel(project, JOB),
      eduCrewCommands.decide(project, JOB, GATE, true), eduCrewCommands.decide(project, JOB, GATE, false),
    ];
    for (const args of all) {
      const options = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
      expect(options).not.toContain("--yes");
      expect(options).not.toContain("-y");
      expect(options).not.toContain("--allow-unregistered-checks");
      expect(options.slice(0, 2)).toEqual(["--cwd", project]);
    }
    expect(eduCrewCommands.plan(project, "-y ship it")).toEqual(["--cwd", project, "run", "--detach", "--", "-y ship it"]);
    expect(eduCrewCommands.review(project, "codex", "t")).toEqual(["--cwd", project, "crew", "dispatch", "--autonomy", "readonly", "--json", "--", "codex", "t"]);
    expect(eduCrewCommands.decide(project, JOB, GATE, false)).toEqual(["--cwd", project, "crew", "reject", JOB, "--request", GATE]);
    expect(crewStatus("awaiting-approval")).toBe("waiting");
    expect(crewStatus("queued")).toBe("running");
  });

  it("work only in a project folder: never home or above it, the data folder or the global brain", () => {
    const limits = { dataDir, home, globalHome: join(home, ".edu") };
    expect(crewFolderRefusal(project, limits)).toBeNull();
    expect(crewFolderRefusal(null, limits)).toMatch(/no working folder/);
    expect(crewFolderRefusal(home, limits)).toMatch(/home folder/);
    expect(crewFolderRefusal(root, limits)).toMatch(/home folder/);
    expect(crewFolderRefusal(brain, limits)).toMatch(/data folder/);
    expect(crewFolderRefusal(join(home, ".edu"), limits)).toMatch(/global Edu brain/);
    expect(crewFolderRefusal(join(root, "missing"), limits)).toMatch(/doesn't exist/);
  });

  it("send a review to another vendor's CLI, never the bot's own", () => {
    const installed = (cli: string) => cli !== "pi";
    expect(pickReviewer("codex", undefined, installed)).toEqual({ ok: true, cli: "claude" });
    expect(pickReviewer("claude", undefined, installed)).toEqual({ ok: true, cli: "codex" });
    expect(pickReviewer("claude", "claude", installed)).toMatchObject({ ok: false });
    expect(pickReviewer("claude", "opencode", installed)).toMatchObject({ ok: false });
    expect(pickReviewer("codex", undefined, (cli) => cli === "codex")).toMatchObject({ ok: false });
  });
});

describe("Edu crew tools", () => {
  const listed = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);
  const host = { skillAuthoring: false, sharedComputers: false, cloudHome: false, team: false, voiceNotes: false, x: false, research: false, imageGeneration: false, localVm: false };
  const env = (bot: { eduCrew?: boolean }, edu: boolean, room = false) =>
    agentsServerEnv({ threadId: "t-1", bot: { id: "bot-1", ...bot }, room, teamComputer: false, host: { ...host, edu } }, { generation: "g", depth: 0, skillAuthoring: false }, () => "token", "http://127.0.0.1:1");

  it("are listed only when the bot's switch is on and Edu is ready here, never in a room", () => {
    const crewTools = ["edu_plan", "edu_review", "edu_crew_status", "edu_crew_result"];
    expect(listed(env({ eduCrew: true }, true))).toEqual(expect.arrayContaining(crewTools));
    for (const off of [env({}, true), env({ eduCrew: false }, true), env({ eduCrew: true }, false), env({ eduCrew: true }, true, true)]) {
      expect(listed(off).filter((name) => crewTools.includes(name))).toEqual([]);
    }
    expect(listed(env({ eduCrew: true }, true))).not.toContain("edu_crew_approve");
  });

  it("refuses to start anything for a bot whose switch is off", async () => {
    const { crew, calls } = setup({ eduCrew: false });
    const answer = await ask(crew, { action: "plan", goal: "ship it" });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatch(/off for this bot/);
    expect(calls).toEqual([]);
  });

  it("refuses a chat without a project folder of its own", async () => {
    const { crew, calls } = setup({ folder: join(dataDir, "workspaces", "bot-1") });
    expect((await ask(crew, { action: "plan", goal: "ship it" })).body.error).toMatch(/data folder|doesn't exist/);
    expect(calls).toEqual([]);
  });
});

describe("Edu crew plan", () => {
  it("starts without --yes, turns the spec gate into a card, and only a person's approval reaches Edu", async () => {
    let state = "running";
    const { crew, calls, threads, decisions } = setup({
      edu: (args) => args.includes("run") ? { stdout: job("running") }
        : args.includes("status") ? { stdout: state === "running" ? job("running") : awaiting() }
          : { stdout: "{}" },
    });
    const started = await ask(crew, { action: "plan", goal: "Add a hello file", playbook: "quick" });
    expect(started.body.error).toBeUndefined();
    expect(started.status).toBe(200);
    expect(started.body.text).toContain(JOB);
    expect(started.body.text).toMatch(/Only the person can approve/);
    const runCall = calls[0]!;
    expect(runCall.args).toEqual([CLI, "--cwd", project, "run", "--detach", "--playbook", "quick", "--", "Add a hello file"]);
    expect(runCall.args.join(" ")).not.toMatch(/--yes|\s-y\b|autoApprove/);
    expect(runCall.env.EDU_HOME).toBe(join(brain, ".edu"));
    expect(runCall.env.EDU_CEILING_DIRECTORIES).toBe(join(home, "Projects"));
    expect(runCall.env).not.toHaveProperty("EDU_CREW_JOB");
    const line = threads.get("t-1")!.find((message) => message.eduCrew);
    expect(line).toMatchObject({ kind: "activity", eduCrew: { jobId: JOB, kind: "plan", status: "running", title: "Add a hello file" } });

    state = "awaiting";
    await crew.tick();
    const card = threads.get("t-1")!.find((message) => message.card?.eduCrewGate)!.card!;
    expect(card).toMatchObject({ tool: "edu_crew_gate", fixedOptions: true, options: ["Approve", "Reject"], title: "Let Edu crew go on?",
      eduCrewGate: { jobId: JOB, gateId: GATE, gate: "Approve spec", goal: "Add a hello file", folder: project } });
    expect(card.eduCrewGate!.spec).toContain("hello.txt exists");
    expect(threads.get("t-1")!.find((message) => message.eduCrew)!.eduCrew).toMatchObject({ status: "waiting" });
    expect(decisions.at(-1)).toMatchObject({ decision: "card-shown", tool: "edu_crew_gate" });
    await crew.tick();
    expect(threads.get("t-1")!.filter((message) => message.card?.eduCrewGate)).toHaveLength(1);

    expect(crew.answerRefusal(loopback("service"), "t-1", card.requestId!, "allow")).toMatch(/can only reject/);
    expect(crew.answerRefusal(loopback("service"), "t-1", card.requestId!, "deny")).toBeNull();
    expect(crew.answerRefusal({ kind: "session", scopes: ["admin"] } as unknown as RequestAuth, "t-1", card.requestId!, "allow")).toBeNull();
    expect(crew.answerRefusal({ kind: "session", scopes: [] } as unknown as RequestAuth, "t-1", card.requestId!, "allow")).toMatch(/admin/);
    expect(crew.answerRefusal(loopback("service"), "t-1", "other", "allow")).toBeUndefined();
    expect(await crew.resolve("t-1", card.requestId!, "answer")).toMatchObject({ ok: false, status: 400 });

    const before = calls.length;
    expect(await crew.resolve("t-1", card.requestId!, "allow")).toEqual({ ok: true, outcome: "allowed-once" });
    expect(calls.slice(before).filter((call) => !call.args.includes("status")).map((call) => call.args.slice(1))).toEqual([["--cwd", project, "crew", "approve", JOB, "--request", GATE]]);
    expect(threads.get("t-1")!.find((message) => message.card?.eduCrewGate)!.card).toMatchObject({ answered: "allow" });
    expect(decisions.at(-1)).toMatchObject({ decision: "user-approved", source: "user" });
    expect(await crew.resolve("t-1", card.requestId!, "deny")).toMatchObject({ ok: true, alreadySettled: true });
    await crew.tick();
    expect(threads.get("t-1")!.filter((message) => message.card?.eduCrewGate), "Edu still lists the decided gate until its worker takes it").toHaveLength(1);
    crew.stop();
  });

  it("posts a new card for each later gate and rejects with the gate's own id", async () => {
    let gate = GATE;
    const { crew, calls, threads } = setup({ edu: (args) => args.includes("run") ? { stdout: awaiting(GATE) } : args.includes("status") ? { stdout: awaiting(gate) } : { stdout: "{}" } });
    await ask(crew, { action: "plan", goal: "Two gates" });
    const first = threads.get("t-1")!.find((message) => message.card?.eduCrewGate)!;
    gate = GATE2;
    await crew.tick();
    const cards = threads.get("t-1")!.filter((message) => message.card?.eduCrewGate);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(await crew.resolve("t-1", first.card!.requestId!, "allow")).toMatchObject({ ok: true, alreadySettled: true });
    const before = calls.length;
    expect(await crew.resolve("t-1", cards[1]!.card!.requestId!, "deny")).toEqual({ ok: true, outcome: "rejected" });
    expect(calls.slice(before).filter((call) => !call.args.includes("status")).map((call) => call.args.slice(1))).toEqual([["--cwd", project, "crew", "reject", JOB, "--request", GATE2]]);
    crew.stop();
  });

  it("a gate decided elsewhere settles its card as no longer waiting", async () => {
    const { crew, threads } = setup({
      edu: (args) => args.includes("run") ? { stdout: awaiting() } : args.includes("approve") ? { code: 1, stderr: `edu: Crew job is not awaiting approval: ${JOB}` } : { stdout: job("running") },
    });
    await ask(crew, { action: "plan", goal: "x" });
    const card = threads.get("t-1")!.find((message) => message.card?.eduCrewGate)!.card!;
    expect(await crew.resolve("t-1", card.requestId!, "allow")).toEqual({ ok: true, outcome: "unavailable" });
    expect(threads.get("t-1")!.find((message) => message.card?.eduCrewGate)!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    crew.stop();
  });

  it("stops the chat's jobs when the person stops the turn", async () => {
    const { crew, calls, threads } = setup({ edu: (args) => args.includes("run") ? { stdout: awaiting() } : args.includes("cancel") ? { stdout: job("cancelled") } : { stdout: awaiting() } });
    await ask(crew, { action: "plan", goal: "Long work" });
    await crew.stopped("other-thread");
    expect(calls.some((call) => call.args.includes("cancel"))).toBe(false);
    await crew.stopped("t-1");
    expect(calls.filter((call) => call.args.includes("cancel")).map((call) => call.args.slice(1))).toEqual([["--cwd", project, "crew", "cancel", JOB, "--json"]]);
    const rows = threads.get("t-1")!;
    expect(rows.find((message) => message.eduCrew)).toMatchObject({ eduCrew: { status: "cancelled" }, tool: { name: "Edu crew stopped “Long work”" } });
    expect(rows.find((message) => message.card?.eduCrewGate)!.card).toMatchObject({ answered: "unavailable", dismissed: true });
    crew.stop();
  });

  it("a failed job is one plain line, and its job reads stay in its own chat", async () => {
    const { crew, threads } = setup({ edu: (args) => args.includes("run") ? { stdout: job("running") } : { stdout: job("failed", { summary: "Unable to produce a valid plan\nafter one repair" }) } });
    await ask(crew, { action: "plan", goal: "Fails" });
    await crew.tick();
    const rows = threads.get("t-1")!;
    expect(rows.filter((message) => message.kind === "activity")).toHaveLength(1);
    expect(rows.find((message) => message.eduCrew)).toMatchObject({ tool: { name: "Edu crew couldn't finish “Fails”: Unable to produce a valid plan after one repair", ok: false }, eduCrew: { status: "failed" } });
    expect(rows.some((message) => message.card)).toBe(false);
    expect((await ask(crew, { action: "status", job_id: JOB }, "t-2")).status).toBe(404);
    expect((await ask(crew, { action: "result", job_id: JOB })).body.text).toMatch(/failed: Unable to produce/);
    crew.stop();
  });
});

describe("Edu crew review", () => {
  it("runs read-only on another vendor's CLI and returns the review", async () => {
    const { crew, calls } = setup({ engine: "claude", edu: (args) => args.includes("dispatch") ? { stdout: job("queued", { cli: "codex" }) } : { stdout: job("done", { summary: "No findings." }) } });
    const answer = await ask(crew, { action: "review", question: "Is the parser safe?", paths: ["src/parse.ts"] });
    expect(answer.status).toBe(200);
    expect(answer.body.text).toContain("No findings.");
    expect(answer.body.text).toMatch(/not instructions/);
    const dispatch = calls[0]!.args.slice(1);
    expect(dispatch.slice(0, 10)).toEqual(["--cwd", project, "crew", "dispatch", "--autonomy", "readonly", "--json", "--", "codex", expect.stringContaining("Question: Is the parser safe?")]);
    expect(dispatch[9]).toContain("Do not modify files");
    crew.stop();
  });

  it("reviews the git changes when asked for nothing else, and refuses the bot's own CLI", async () => {
    const { crew, calls } = setup({ engine: "codex", edu: (args) => args.includes("dispatch") ? { stdout: job("queued") } : { stdout: job("done", { summary: "ok" }) } });
    expect((await ask(crew, { action: "review", reviewer: "codex" })).body.error).toMatch(/another vendor/);
    await ask(crew, { action: "review", base: "main" });
    const task = calls[0]!.args.at(-1)!;
    expect(calls[0]!.args.at(-2)).toBe("claude");
    expect(task).toContain("Changes since main");
    expect(task).toContain("+hello");
    expect((await ask(crew, { action: "review", base: "--output=/tmp/x" })).body.error).toMatch(/Unknown git base/);
    crew.stop();
  });
});
