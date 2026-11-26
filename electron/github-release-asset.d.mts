export declare const GITHUB_RELEASE_ASSET_HOSTS: ReadonlySet<string>;

export declare function isGitHubReleaseAssetUrl(url: string): boolean;

export declare function releaseAssetRedirect(fromUrl: string, location: string | null): string | null;

export declare function fetchGitHubReleaseAsset(url: string, fetchImpl: typeof fetch, init?: RequestInit): Promise<Response>;
