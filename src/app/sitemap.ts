import type { MetadataRoute } from "next";

/**
 * Only the public marketing surface belongs here. Authenticated routes are
 * excluded — they redirect to /sign-in for anyone crawling them, so listing
 * them would just spend crawl budget on redirects.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realestate-genius.netlify.app";

  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.9 },
  ];
}
