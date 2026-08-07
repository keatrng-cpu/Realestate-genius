import type { MetadataRoute } from "next";

/**
 * Deliberately open to AI crawlers.
 *
 * Checked 2026-08-07: zillow.com, redfin.com, realtor.com and homes.com all
 * hard-block automated retrieval of their search pages (403 / 429 / CAPTCHA).
 * Redfin's robots.txt names FireCrawlAgent with `Disallow: /`; Zillow's confines
 * AI2Bot and meta-externalagent to /blog/, /research/ and /tech/.
 *
 * Meanwhile Redfin, Homes.com and Realtor.com have all shipped conversational
 * AI search, so buyers are being trained to ask an assistant. Being the one
 * Grand Forks / Fargo property source an assistant can actually read is free
 * distribution the incumbents are refusing to take. That is the whole reason
 * this file is permissive.
 *
 * The authenticated surface is disallowed — not for secrecy (RLS is the actual
 * boundary) but because those URLs are useless to a crawler and would waste
 * crawl budget.
 */

const PRIVATE_PATHS = [
  "/api/",
  "/auth/",
  "/dashboard",
  "/onboarding",
  "/portfolio",
  "/deals",
  "/settings",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/check-email",
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realestate-genius.netlify.app";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
