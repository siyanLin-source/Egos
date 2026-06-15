import type { UIMessage } from "ai";

import { getUiMessageText } from "@/lib/safety/crisis";
import { cn } from "@/lib/utils";

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = getUiMessageText(message);

  if (!text.trim()) {
    return null;
  }

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[15px] leading-6 shadow-sm sm:max-w-[68%]",
          isUser
            ? "rounded-br-lg bg-[#0a84ff] text-white"
            : "rounded-bl-lg bg-white text-neutral-950 ring-1 ring-neutral-200",
        )}
      >
        {text}
      </div>
    </div>
  );
}
