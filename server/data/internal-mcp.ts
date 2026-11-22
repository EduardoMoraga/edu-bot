import type { ServerResponse } from "node:http";

import type { DataGrantMap } from "../../shared/data-connections.ts";
import type { Store } from "../store.ts";
import { DATA_INTERNAL_MCP_PATH, dataRpc } from "./rpc.ts";
import type { DataSheetRegistry } from "./sheet.ts";
import { DataFailure, type ChartCompiler, type ChartRenderer, type DataEngine, type VegaLiteValidator } from "./types.ts";

type Sender = { id: string; name: string; color: string };

export async function respondDataMcp(input: {
  method: string;
  path: string;
  res: ServerResponse;
  json: (res: ServerResponse, status: number, body: unknown) => void;
  readBody: () => Promise<unknown>;
  dataEngine: Pick<DataEngine, "unavailable" | "forBot">;
  sender: Sender;
  threadId: string;
  requireActive: () => void;
  store: Pick<Store, "bot" | "appendMessage" | "groupByThread">;
  secret: (id: string) => string | null;
  dataDir: string;
  sheets: Pick<DataSheetRegistry, "for">;
  compileChart: ChartCompiler;
  validateVegaLite: VegaLiteValidator;
  renderer: ChartRenderer;
  exportRoots: (sender: Sender) => string[];
}): Promise<boolean> {
  if (input.method !== "POST" || input.path !== DATA_INTERNAL_MCP_PATH) return false;
  const body = await input.readBody();
  const unavailable = input.dataEngine.unavailable();
  if (unavailable !== null) {
    input.json(input.res, 503, { error: `Data tools are unavailable: ${unavailable}` });
    return true;
  }
  const abort = new AbortController();
  input.res.once("close", () => { if (!input.res.writableEnded) abort.abort(); });
  let database;
  try {
    database = await input.dataEngine.forBot(input.sender.id);
  } catch (error) {
    if (error instanceof DataFailure) {
      input.json(input.res, 503, { error: error.message });
      return true;
    }
    throw error;
  }
  input.requireActive();
  const grouped = () => Boolean(input.store.groupByThread(input.threadId));
  const from = () => grouped() ? { from: { botId: input.sender.id, name: input.sender.name, color: input.sender.color } } : {};
  const allowlist = (): DataGrantMap | undefined => input.store.bot(input.sender.id)?.dataConnections;
  input.json(input.res, 200, { result: await dataRpc(body as { method?: unknown; params?: unknown }, {
    database, sheet: input.sheets.for(input.sender.id),
    compileChart: input.compileChart, validateVegaLite: input.validateVegaLite, renderer: input.renderer,
    exportRoots: () => input.exportRoots(input.sender),
    named: {
      botId: input.sender.id, threadId: input.threadId, dataDir: input.dataDir, allowlist,
      secret: input.secret,
      postCard: (text, card) => { input.store.appendMessage(input.threadId, { role: "bot", kind: "options", text, card, ...from() }); },
    },
    signal: abort.signal, assertActive: input.requireActive,
    onShow: (card) => {
      input.store.appendMessage(input.threadId, {
        role: "bot", kind: "activity", tool: { name: "data_show", ok: true },
        dataResult: { botId: input.sender.id, cardId: card.id, title: card.title, kind: card.kind, sql: card.sql },
        ...from(),
      });
    },
  }) });
  return true;
}
