import { redirect } from "next/navigation";

// Clean entry point for marketing "Start Free Trial" CTAs.
export default function SignupPage() {
  redirect("/?signup=1&redirect=/billing");
}
