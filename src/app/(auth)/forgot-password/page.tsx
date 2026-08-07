import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password — Realestate Genius",
  description: "Request a link to set a new password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
