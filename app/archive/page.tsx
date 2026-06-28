import { redirect } from "next/navigation";

import { ArchiveView } from "@/components/archive/archive-view";
import { createClient } from "@/lib/supabase/server";
import type { Entry, ProfileFact, Topic } from "@/lib/types";

export default async function ArchivePage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    redirect("/login");
  }

  const [
    { data },
    { data: profileFactData, error: profileFactError },
    { data: personTopicData, error: personTopicError },
  ] = await Promise.all([
      supabase
        .from("entries")
        .select(
          "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
        )
        .eq("user_id", claims.sub)
        .order("created_at", { ascending: false }),
      supabase
        .from("profile_facts")
        .select(
          "id,user_id,kind,subject,text,importance,pinned,source_entry_id,source_message_ids,first_observed_at,last_observed_at,created_at,updated_at",
        )
        .eq("user_id", claims.sub)
        .order("importance", { ascending: false })
        .order("last_observed_at", { ascending: false }),
      supabase
        .from("topics")
        .select(
          "id,user_id,type,name,first_mentioned_at,last_mentioned_at,mention_count,facts,created_at,updated_at",
        )
        .eq("user_id", claims.sub)
        .eq("type", "person")
        .order("mention_count", { ascending: false })
        .order("last_mentioned_at", { ascending: false }),
    ]);

  if (profileFactError) {
    console.error("Could not load profile facts for archive.", profileFactError);
  }

  if (personTopicError) {
    console.error("Could not load person topics for archive.", personTopicError);
  }

  return (
    <ArchiveView
      entries={(data ?? []) as Entry[]}
      profileFacts={(profileFactData ?? []) as ProfileFact[]}
      personTopics={(personTopicData ?? []) as Topic[]}
    />
  );
}
