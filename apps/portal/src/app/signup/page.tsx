import { AuthForm } from "@/components/auth-form";

// `?ref=CODE` attributes the signup to a partner. Captured here and carried
// through the signup form into the auth user's metadata.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  return <AuthForm mode="signup" referralCode={typeof ref === "string" ? ref : undefined} />;
}
