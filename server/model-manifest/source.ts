import { PROJECT_REPOSITORY } from "../../shared/project-repository.ts";

/** `stable` (the default), a `vX.Y.Z` tag, a 40-hex commit, or `release:vX.Y.Z` for that release's asset. */
export const MODEL_MANIFEST_REF_ENV = "OMB_MODEL_MANIFEST_REF";
export const DEFAULT_MODEL_MANIFEST_REF = "stable";

const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const COMMIT = /^[0-9a-f]{40}$/;
const FILE = "server/model-manifest/model-manifest.json";

function refused(ref: string): Error {
  const shown = ref.replace(/[^\x20-\x7e]/g, "").slice(0, 80);
  return new Error(`refusing model manifest ref ${shown}`);
}

/** Where the live model list is read from. Only `stable`, a version tag, a 40-hex commit, or `release:vX.Y.Z`. A merge to main does not reach installed apps. */
export function modelManifestUrl(env: NodeJS.ProcessEnv = process.env): string {
  const ref = (env[MODEL_MANIFEST_REF_ENV] ?? "").trim() || DEFAULT_MODEL_MANIFEST_REF;
  if (ref === DEFAULT_MODEL_MANIFEST_REF || VERSION_TAG.test(ref) || COMMIT.test(ref)) {
    return `https://raw.githubusercontent.com/${PROJECT_REPOSITORY}/${ref}/${FILE}`;
  }
  if (ref.startsWith("release:")) {
    const tag = ref.slice("release:".length);
    if (!VERSION_TAG.test(tag)) throw refused(ref);
    return `https://github.com/${PROJECT_REPOSITORY}/releases/download/${tag}/model-manifest.json`;
  }
  throw refused(ref);
}
