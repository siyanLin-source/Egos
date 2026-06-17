import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { Entry, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ReviewMessage({ message }: { message: Message }) {
  const isUser = message.sender === "user";

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
        {message.content}
      </div>
    </div>
  );
}

export default async function ArchiveEntryPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: entryData, error: entryError } = await supabase
    .from("entries")
    .select(
      "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,created_at,updated_at",
    )
    .eq("id", entryId)
    .eq("user_id", user.id)
    .single();

  if (entryError || !entryData) {
    notFound();
  }

  const entry = entryData as Entry;
  const { data: messageData } = await supabase
    .from("messages")
    .select("id,user_id,sender,content,image_url,created_at")
    .eq("user_id", user.id)
    .in("id", entry.message_ids);

  const messageOrder = new Map(
    entry.message_ids.map((messageId, index) => [messageId, index]),
  );
  const messages = ((messageData ?? []) as Message[]).sort((left, right) => {
    return (
      (messageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (messageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500">{formatDate(entry.created_at)}</p>
            <h1 className="mt-1 text-lg font-semibold">事件回看</h1>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/archive">回到档案</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b]">
              {entry.category}
            </span>
            <span className="rounded-full bg-[#fff0bf] px-2.5 py-1 text-xs font-medium text-[#755c00]">
              {entry.emotion}
            </span>
          </div>
          <p className="text-[15px] leading-6">{entry.summary}</p>
        </div>

        <div className="flex flex-col gap-3">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
              <p className="text-sm text-neutral-500">这条档案暂时找不到对应消息。</p>
            </div>
          ) : (
            messages.map((message) => (
              <ReviewMessage key={message.id} message={message} />
            ))
          )}
        </div>
      </section>
    </main>
  );
}
