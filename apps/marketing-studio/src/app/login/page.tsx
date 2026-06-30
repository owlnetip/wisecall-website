import { LoginForm } from "@/components/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const initialError =
    params.error === "unauthorized"
      ? "Your account does not have admin access to Marketing Studio."
      : undefined;

  return <LoginForm redirectTo={params.redirect ?? "/"} initialError={initialError} />;
}
