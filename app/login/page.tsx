import { Suspense } from "react";
import { LoginPage } from "@/components/auth/LoginPage";

export const metadata = {
  title: "Sign in · Database Agent",
};

export default function Page() {
  // LoginPage reads the address (?sso=1, ?error=...), which needs this boundary
  // so the rest of the page can still be built ahead of time.
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
