import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <ChatWorkspace />;
}
