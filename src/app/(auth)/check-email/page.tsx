import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckEmailPanel } from "@/components/auth/CheckEmailPanel";
import { Spinner } from "@/components/auth/form-primitives";

export const metadata: Metadata = {
  title: "Confirm your email — Realestate Genius",
  robots: { index: false, follow: false },
};

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-3 text-[14px] text-bone-300">
          <Spinner />
          <span>Loading…</span>
        </div>
      }
    >
      <CheckEmailPanel />
    </Suspense>
  );
}
