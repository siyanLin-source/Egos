import { redirect } from "next/navigation";

import { ChatView } from "@/components/chat/chat-view";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("messages")
    .select("id,user_id,sender,content,image_url,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const messages = (data ?? []) as Message[];

  return <ChatView initialMessages={messages} userEmail={user.email ?? ""} />;
}
