import { redirect } from "next/navigation";

import { ChatView } from "@/components/chat/chat-view";
import { ensureCurrentConversation } from "@/lib/conversations";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    redirect("/login");
  }

  const conversation = await ensureCurrentConversation({
    supabase,
    userId: claims.sub,
  });

  // live chat 只看当前对话线；归档只是后台索引，不能影响可见历史。
  const { data } = await supabase
    .from("messages")
    .select(
      "id,user_id,conversation_id,sender,content,image_url,created_at,archived_at",
    )
    .eq("user_id", claims.sub)
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });

  const messages = (data ?? []) as Message[];

  return (
    <ChatView
      initialMessages={messages}
      userEmail={claims.email ?? ""}
      conversationId={conversation.id}
    />
  );
}
