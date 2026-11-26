/** Hosts GitHub sends a `releases/download/…` request to. One hop, then no further redirect. */
export const GITHUB_RELEASE_ASSET_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

const RELEASE_DOWNLOAD = /^https:\/\/github\.com\/EduardoMoraga\/edu-bot\/releases\/download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\/[A-Za-z0-9._-]+$/;

export function isGitHubReleaseAssetUrl(url) {
  return RELEASE_DOWNLOAD.test(String(url));
}

/** The next URL when `fromUrl` is one of our release assets and `location` stays on GitHub's asset hosts. */
export function releaseAssetRedirect(fromUrl, location) {
  if (!isGitHubReleaseAssetUrl(fromUrl) || !location) return null;
  let next;
  try {
    next = new URL(location, fromUrl);
  } catch {
    return null;
  }
  if (next.protocol !== "https:" || next.username || next.password) return null;
  if (!GITHUB_RELEASE_ASSET_HOSTS.has(next.hostname)) return null;
  return next.href;
}

/** Fetch one published release asset. A redirect is followed once, and only onto the asset hosts above. */
export async function fetchGitHubReleaseAsset(url, fetchImpl, init = {}) {
  if (!isGitHubReleaseAssetUrl(url)) throw new Error("refusing a request that is not a published release asset");
  const first = await fetchImpl(url, { ...init, redirect: "manual" });
  if (first.status < 300 || first.status >= 400) return first;
  const next = releaseAssetRedirect(url, first.headers.get("location"));
  await first.body?.cancel?.().catch(() => {});
  if (!next) throw new Error("refusing a redirect");
  return fetchImpl(next, { ...init, redirect: "error" });
}
