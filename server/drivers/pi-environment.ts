import { PROVIDER_CREDENTIAL_ENV, stripWorkspaceCredentialEnv } from "../config.ts";
import { guardEduCrew } from "../edu-crew-guard.ts";
import { augmentedPath } from "../env-path.ts";

export function piEnvironment(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source, PATH: augmentedPath() };
  // pi reads provider keys from its env: an inherited key would flip billing, and workspace
  // credentials are the harness's secrets.
  stripWorkspaceCredentialEnv(env);
  for (const key of PROVIDER_CREDENTIAL_ENV) delete env[key];
  guardEduCrew(env);
  return env;
}
