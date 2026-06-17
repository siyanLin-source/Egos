import { redirect } from "next/navigation";

import { ArchiveView } from "@/components/archive/archive-view";
import { createClient } from "@/lib/supabase/server";
import type { Entry } from "@/lib/types";

export default async function ArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("entries")
    .select(
      "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,created_at,updated_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return <ArchiveView entries={(data ?? []) as Entry[]} />;
}
