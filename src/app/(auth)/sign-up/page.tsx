import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = {
  title: "Create your account — Realestate Genius",
  description:
    "One account for buying, selling, renting, and managing property in North Dakota.",
};

export default function SignUpPage() {
  return <SignUpForm />;
}
