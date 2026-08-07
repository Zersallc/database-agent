import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ChatApp } from "@/components/chat/ChatApp";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <ChatApp userEmail={session.user.email ?? ""} />;
}
