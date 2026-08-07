import { NextRequest, NextResponse } from "next/server";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: Message[] };
  const lastUserMessage = messages[messages.length - 1]?.content ?? "";

  // TODO: replace with a real LLM call + database query once credentials are provided.
  const reply = `You asked: "${lastUserMessage}". Database and AI integration isn't connected yet.`;

  return NextResponse.json({ reply });
}
