import Link from "next/link";
import { PRICING_VERIFIED_ON } from "@/lib/pricing";
import { FOOTER_SHELL } from "@/lib/layout";

/**
 * Site footer.
 *
 * Two rules it exists to enforce:
 *
 *  1. **Every page has a way into the product.** The footer is the second exit
 *     after the header, so Create an account and Sign in are real links here.
 *
 *  2. **The data-source line is load-bearing.** Consumer listing portals are
 *     deliberately absent — their terms forbid retaining copies, and claiming
 *     them as sources is a liability, not a feature. Do not add them back.
 *
 * Legal documents that are genuinely not written yet are rendered as marked
 * "in draft" rather than as links to a 404. The product's whole position is
 * that it shows a dashed line instead of a confident wrong answer; the footer
 * is held to the same standard.
 */

type FooterLink =
  | { label: string; href: string }
  | { label: string; pending: true };

type FooterGroup = { title: string; links: readonly FooterLink[] };

const GROUPS: readonly FooterGroup[] = [
  {
    title: "Product",
    links: [
      { label: "What we surface", href: "/#edge" },
      { label: "Depth of analysis", href: "/#analysis" },
      { label: "Landlord & tenant portal", href: "/#portal" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Create an account", href: "/sign-up" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Reset your password", href: "/forgot-password" },
    ],
  },
  {
    title: "Company & legal",
    links: [
      { label: "Data sources", href: "/#sources" },
      { label: "Terms of service", pending: true },
      { label: "Privacy policy", pending: true },
      { label: "Fair housing statement", pending: true },
    ],
  },
];

function FooterItem({ link }: { link: FooterLink }) {
  if ("pending" in link) {
    return (
      <li>
        <span className="inline-flex min-h-11 items-center gap-2 text-body-sm text-fg-subtle">
          {link.label}
          <span className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-micro uppercase text-unknown">
            In draft
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={link.href}
        // min-w-11 alongside min-h-11: "Pricing" and "Sign in" are short enough
        // that their text box measured 41px wide, 3px under the 44px minimum.
        className="inline-flex min-h-11 min-w-11 items-center text-body-sm text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {link.label}
      </Link>
    </li>
  );
}

export function Footer() {
  /**
   * UTC, not local. `/` is statically prerendered, so this line is computed
   * once in the build's timezone and again in the visitor's on hydration.
   * `getFullYear()` on a UTC-built page viewed from Chicago is the exact
   * shape of the React #418 that PermitTimeline just had to have removed.
   * (A build that straddles a New Year's rollover is still stale until the
   * next deploy — that is a redeploy problem, not a hydration one.)
   */
  const year = new Date().getUTCFullYear();

  return (
    <footer className={FOOTER_SHELL}>
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))] md:gap-8">
          <div>
            <Link
              href="/"
              className="group inline-flex min-h-11 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-accent/40 bg-accent-soft"
              >
                <span className="block h-2 w-2 rotate-45 bg-accent" />
              </span>
              <span className="font-display text-title-lg leading-none text-fg">
                Realestate <span className="text-accent">Genius</span>
              </span>
            </Link>

            <p className="mt-3 max-w-xs text-body-sm text-fg-muted">
              A property marketplace built on the public record, for Grand Forks
              and Fargo, North Dakota.
            </p>
            <p className="mt-3 font-mono text-micro uppercase text-fg-subtle">
              VitaForge Holdings · Ellingson Estates LLC
            </p>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="font-mono text-micro uppercase text-fg-subtle">
                {group.title}
              </h2>
              <ul className="mt-2">
                {group.links.map((link) => (
                  <FooterItem key={link.label} link={link} />
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 space-y-3 border-t border-line pt-8">
          <p className="max-w-3xl text-body-sm text-fg-muted">
            <span className="font-medium text-fg">Where the data comes from.</span>{" "}
            County assessor and recorder records, the North Dakota statewide
            parcel and tax-roll feed, FEMA&rsquo;s National Flood Hazard Layer,
            Census TIGER geography, municipal permit and zoning portals, licensed
            rent-comparable data, and information supplied directly by owners and
            agents. Every value in the product carries its source and the date it
            was observed. Consumer listing portals are not among our sources:
            their terms prohibit retaining copies of their data, so we do not use
            them and do not claim them.
          </p>

          <p className="max-w-3xl text-body-sm text-fg-subtle">
            <span className="font-medium text-fg-muted">
              Figures shown on these pages are illustrative.
            </span>{" "}
            Sample properties, scores, and dashboards on the marketing pages are
            demonstrations of the interface, not real valuations or offers.
            Nothing here is an appraisal, a rent guarantee, or legal, tax, or
            investment advice. Competitor prices referenced on the pricing page
            were read from those vendors&rsquo; own published pricing pages from{" "}
            {PRICING_VERIFIED_ON} onward, are dated where they appear, and can
            change without notice.
          </p>

          <p className="pt-2 font-mono text-micro uppercase text-fg-subtle">
            © {year} Realestate Genius · Grand Forks &amp; Fargo, ND
          </p>
        </div>
      </div>
    </footer>
  );
}
