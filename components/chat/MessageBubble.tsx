"use client";

import { motion } from "framer-motion";
import { SparklesIcon } from "lucide-react";
import { Markdown } from "./Markdown";
import type { Message } from "@/lib/workspace";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={isUser ? "flex justify-end" : "flex gap-3"}
    >
      {!isUser && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <SparklesIcon className="size-3.5" />
        </div>
      )}

      {isUser ? (
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
          {message.content}
        </div>
      ) : (
        <div className="min-w-0 flex-1 text-sm">
          <Markdown content={message.content} />
        </div>
      )}
    </motion.div>
  );
}
