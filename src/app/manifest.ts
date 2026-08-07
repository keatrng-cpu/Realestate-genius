import type { MetadataRoute } from "next";

/**
 * PWA manifest (V9).
 *
 * Served at /manifest.webmanifest by Next's metadata route. Deliberately the
 * ONLY manifest: a static /public/manifest.webmanifest occupies the same URL
 * and Next hard-fails the request with "conflicting public file and page file"
 * (E212). Do not re-add one.
 *
 * Icons reference SVGs already in /public — no new binary assets, no CDN.
 * `purpose: "maskable"` needs the artwork to survive a 20% safe-area crop,
 * which these marks do because they are centred glyphs on a full-bleed field.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Realestate Genius",
    short_name: "RE Genius",
    description:
      "Property intelligence for finding and completing deals — zoning headroom, permit history and permit absence, ADU and lot-split maths, and the true cost of ownership.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // Matches --color-ink-900, so the OS chrome continues the dark shell.
    theme_color: "#0a0a0b",
    background_color: "#0a0a0b",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/window.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/window.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/globe.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "monochrome",
      },
    ],
  };
}
