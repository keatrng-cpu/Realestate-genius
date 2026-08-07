import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme-script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Realestate Genius — find and complete the deal",
  description:
    "A property marketplace built on the public record. Zoning headroom, permit history and permit absence, ADU and lot-split maths, opportunity signals, and the true cost of ownership — connecting buyers, sellers, landlords, tenants, and agents.",
  manifest: "/manifest.webmanifest",
  applicationName: "Realestate Genius",
  appleWebApp: {
    capable: true,
    title: "RE Genius",
    statusBarStyle: "black-translucent",
  },
};

/**
 * `themeColor` is media-scoped so the OS chrome tracks the active theme
 * instead of pinning the dark shell over a light page.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

/**
 * Props are typed explicitly rather than via Next's generated `LayoutProps<"/">`
 * global: that type only exists once `.next/types` has been emitted, so a cold
 * `tsc --noEmit` on a clean checkout fails on it.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrument.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before first paint so a light-mode user never sees the dark
            shell flash. Must stay in <head> and stay synchronous. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-surface text-fg">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
