import { Suspense } from "react";
import { AutoLoginPage } from "@/components/auth/AutoLoginPage";

export const metadata = {
  title: "Signing in · Database Agent",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AutoLoginPage />
    </Suspense>
  );
}
