import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DeleteEntryButton } from "@/components/archive/delete-entry-button";
import { isAcuteSummary } from "@/lib/archive/clean-entries";
import { DEV_TOOLS_ENABLED } from "@/lib/dev-tools";
import { createClient } from "@/lib/supabase/server";
import type { Entry, Message, ProfileFact, ProfileFactKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROFILE_FACT_KIND_LABELS: Record<ProfileFactKind, string> = {
  identity: "身份",
  relationship: "关系",
  pet: "宠物",
  interest: "兴趣",
  preference: "偏好",
  routine: "习惯",
  goal: "目标",
  health: "健康",
  work: "工作",
  school: "学习",
  place: "地点",
  other: "其他",
};

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
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    redirect("/login");
  }

  const userId = claims.sub;
  const { data: entryData, error: entryError } = await supabase
    .from("entries")
    .select(
      "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
    )
    .eq("id", entryId)
    .eq("user_id", userId)
    .single();

  if (entryError || !entryData) {
    notFound();
  }

  const entry = entryData as Entry;

  // summary 里直接含急性原话的卡片整体不展示（和列表/清洗层一致）。
  // 温和措辞的难过记忆（吵架等）正常打开，但下面会隐藏沉重的原始对话。
  if (isAcuteSummary(entry.summary)) {
    notFound();
  }
  const [
    { data: messageData },
    { data: profileFactData, error: profileFactError },
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("id,user_id,conversation_id,sender,content,image_url,created_at")
      .eq("user_id", userId)
      .in("id", entry.message_ids),
    supabase
      .from("profile_facts")
      .select(
        "id,user_id,kind,subject,text,importance,pinned,source_entry_id,source_message_ids,first_observed_at,last_observed_at,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("source_entry_id", entry.id)
      .order("importance", { ascending: false }),
  ]);

  const messageOrder = new Map(
    entry.message_ids.map((messageId, index) => [messageId, index]),
  );
  const messages = ((messageData ?? []) as Message[]).sort((left, right) => {
    return (
      (messageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (messageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  if (profileFactError) {
    console.error("Could not load profile facts for entry.", profileFactError);
  }

  const profileFacts = (profileFactData ?? []) as ProfileFact[];

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-neutral-500">{formatDate(entry.created_at)}</p>
            <h1 className="mt-1 text-lg font-semibold">事件回看</h1>
          </div>
          <div className="flex items-center gap-2">
            <DeleteEntryButton entryId={entry.id} />
            <Button asChild variant="secondary" size="sm">
              <Link href="/archive">回到档案</Link>
            </Button>
          </div>
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

        {DEV_TOOLS_ENABLED && profileFacts.length > 0 ? (
          <div className="border-y border-neutral-200 bg-[#fffaf2] px-4 py-4 sm:rounded-lg sm:border">
            <div className="mb-2 flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold">这件事里记住了</h2>
              <span className="text-xs text-neutral-500">
                {profileFacts.length} 条
              </span>
            </div>
            <div className="divide-y divide-neutral-200">
              {profileFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div>
                    <p className="mb-1 text-xs font-medium text-[#256f5b]">
                      {PROFILE_FACT_KIND_LABELS[fact.kind]}
                    </p>
                    <p className="text-sm leading-6 text-neutral-950">
                      {fact.text}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {Math.round(fact.importance * 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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
