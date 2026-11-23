import { stripRpmFeed } from "./strip-linux-rpm-feed.mjs";
import { describe, expect, it } from "vitest";

const feed = `version: 0.1.0
files:
  - url: EduBot-0.1.0-amd64.deb
    sha512: aaa
    size: 1
  - url: EduBot-0.1.0-x86_64.rpm
    sha512: ccc
    size: 3
  - url: EduBot-0.1.0-x86_64.AppImage
    sha512: bbb
    size: 2
path: EduBot-0.1.0-amd64.deb
sha512: aaa
releaseDate: '2026-11-23T00:00:00.000Z'
`;

describe("stripRpmFeed", () => {
  it("drops the rpm entry and leaves the deb as the legacy path", () => {
    const next = stripRpmFeed(feed);
    expect(next).not.toContain(".rpm");
    expect(next).toContain("url: EduBot-0.1.0-amd64.deb");
    expect(next).toContain("sha512: aaa");
    expect(next).toContain("url: EduBot-0.1.0-x86_64.AppImage");
    expect(next).toContain("sha512: bbb");
    expect(next).toContain("path: EduBot-0.1.0-amd64.deb");
    expect(next).not.toContain("sha512: ccc");
  });

  it("points the legacy path at a file that is still published when the rpm was first", () => {
    const rpmFirst = feed.replace("path: EduBot-0.1.0-amd64.deb\nsha512: aaa", "path: EduBot-0.1.0-x86_64.rpm\nsha512: ccc");
    const next = stripRpmFeed(rpmFirst);
    expect(next).not.toContain(".rpm");
    expect(next).toContain("path: EduBot-0.1.0-amd64.deb");
    expect(next).toMatch(/^sha512: aaa$/m);
  });

  it("leaves a feed that already has no rpm unchanged", () => {
    const clean = feed.replace(/\n {2}- url: EduBot-0\.1\.0-x86_64\.rpm\n {4}sha512: ccc\n {4}size: 3/, "");
    expect(stripRpmFeed(clean)).toBe(clean);
  });
});
