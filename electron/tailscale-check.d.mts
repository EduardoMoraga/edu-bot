export interface TailscaleRun {
  missing: boolean;
  stdout: string;
  stderr: string;
}

export type TailscaleCheck =
  | { state: "ready"; name: string; addresses: string[]; https: boolean; cli: string | null }
  | { state: "not-installed" | "no-cli" | "not-running" | "signed-out" | "needs-approval" | "needs-permission" };

export declare const TAILSCALE_CLI_PATHS: readonly string[];
export declare function tailscaleInstall(options?: { exists?: (path: string) => boolean; env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform }): "cli" | "app-only" | "none";
export declare const tailscaleEnvironment: (env?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
export declare function tailscaleStatusCandidates(home?: string): string[];
export declare const runTailscaleStatus: (cli: string) => Promise<TailscaleRun>;
export declare const runTailscaleWhois: (cli: string, address: string) => Promise<TailscaleRun>;
export declare function readTailscaleStatus(stdout: string, stderr?: string): { state: TailscaleCheck["state"]; name?: string; addresses?: string[]; https?: boolean };
export declare function magicDnsName(address: string | undefined, options?: { resolver?: unknown }): Promise<string | null>;
export declare function checkTailscale(options?: {
  run?: (cli: string) => Promise<TailscaleRun>;
  install?: () => "cli" | "app-only" | "none";
  candidates?: readonly string[];
  interfaces?: () => NodeJS.Dict<Array<{ address: string }>>;
  reverse?: (address: string | undefined) => Promise<string | null>;
}): Promise<TailscaleCheck>;
