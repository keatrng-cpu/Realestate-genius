import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth/SignInForm";
import { Spinner } from "@/components/auth/form-primitives";

export const metadata: Metadata = {
  title: "Sign in — Realestate Genius",
  description: "Sign in to your Realestate Genius account.",
};

export default function SignInPage() {
  return (
    // SignInForm reads `?next=` via useSearchParams, which needs a Suspense
    // boundary or the whole route opts out of static rendering.
    <Suspense fallback={<FormSkeleton />}>
      <SignInForm />
    </Suspense>
  );
}

function FormSkeleton() {
  return (
    <div className="flex items-center gap-3 text-[14px] text-bone-300">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
