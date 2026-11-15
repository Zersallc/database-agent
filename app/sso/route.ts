import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

// The address the Sys.Lab Platform links to. It never shows a page:
//   already signed in here      -> straight to the app
//   Sys.Lab login switched on   -> straight to the Sys.Lab login, which answers at once for someone already signed in there
//   otherwise                   -> the normal login page
// (/login?sso=1 forwards here, so older links keep working.)
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (session?.user?.id) redirect("/");
  if (!(process.env.AUTH_COGNITO_ID && process.env.AUTH_COGNITO_ISSUER)) redirect("/login");
  await signIn("cognito", { redirectTo: "/" });
}
