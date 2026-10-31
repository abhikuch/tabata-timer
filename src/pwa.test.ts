import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";

function pngSize(file: string) {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("pwa shell", () => {
  it("matches the install manifest", () => {
    expect(manifest).toMatchObject({
      name: "Tabata Timer",
      short_name: "Tabata",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#12355b",
      background_color: "#f6f7f9",
    });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    expect(manifest.icons[2].purpose).toBe("maskable");
  });

  it("ships the icon sizes and self-hosted fonts", () => {
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("160ms");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).toContain("Source Serif 4");
    expect(css).toContain("Libre Franklin");
    expect(css).toContain("min-height: 44px");
    for (const file of [
      "src/fonts/libre-franklin-400.woff2",
      "src/fonts/libre-franklin-600.woff2",
      "src/fonts/source-serif-4-600.woff2",
      "src/fonts/source-serif-4-italic-400.woff2",
    ]) {
      expect(readFileSync(file).byteLength).toBeGreaterThan(1000);
    }
  });
});
