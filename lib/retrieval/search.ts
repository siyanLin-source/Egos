import type { SupabaseClient } from "@supabase/supabase-js";

import { embedText, embeddingsEnabled } from "@/lib/ai/embeddings";
import type { Entry } from "@/lib/types";

type RetrievalSupabaseClient = Pick<SupabaseClient, "from" | "rpc">;

export type RetrievedEntry = Entry & { similarity: number | null };

export type RetrievalMode = "vector" | "keyword" | "none";

export type RetrievalResult = {
  entries: RetrievedEntry[];
  mode: RetrievalMode;
};

const ENTRY_COLUMNS =
  "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at";

// 语义检索：把问题向量化，调 match_entries 找回这个用户自己最相关的真实记录。
// 没有 embedding（没配 key / 失败）时退回关键词 ilike，再退回最近记录。
// 永远只返回 user 自己的、非危机记录。
export async function searchEntries({
  supabase,
  userId,
  query,
  matchCount = 8,
  since = null,
}: {
  supabase: RetrievalSupabaseClient;
  userId: string;
  query: string;
  matchCount?: number;
  since?: string | null;
}): Promise<RetrievalResult> {
  const trimmed = query.trim();

  if (!trimmed) {
    return { entries: [], mode: "none" };
  }

  if (embeddingsEnabled()) {
    const embedding = await embedText(trimmed);

    if (embedding) {
      const { data, error } = await supabase.rpc("match_entries", {
        p_user_id: userId,
        p_query_embedding: embedding,
        p_match_count: matchCount,
        p_since: since,
        p_exclude_crisis: true,
      });

      if (error) {
        console.error("Vector search failed; falling back to keyword.", error);
      } else {
        return {
          entries: (data ?? []) as RetrievedEntry[],
          mode: "vector",
        };
      }
    }
  }

  return keywordSearch({ supabase, userId, query: trimmed, matchCount, since });
}

async function keywordSearch({
  supabase,
  userId,
  query,
  matchCount,
  since,
}: {
  supabase: RetrievalSupabaseClient;
  userId: string;
  query: string;
  matchCount: number;
  since: string | null;
}): Promise<RetrievalResult> {
  const like = `%${query.replace(/[%_]/g, "")}%`;

  let builder = supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", userId)
    .eq("is_crisis", false)
    .ilike("summary", like)
    .order("created_at", { ascending: false })
    .limit(matchCount);

  if (since) {
    builder = builder.gte("created_at", since);
  }

  const { data, error } = await builder;

  if (error) {
    console.error("Keyword search failed.", error);
    return { entries: [], mode: "none" };
  }

  const rows = (data ?? []) as Entry[];

  if (rows.length > 0) {
    return {
      entries: rows.map((entry) => ({ ...entry, similarity: null })),
      mode: "keyword",
    };
  }

  // 关键词也没命中：退回最近的几条，给对话一点上下文（但明确标成非语义命中）。
  let recentBuilder = supabase
    .from("entries")
    .select(ENTRY_COLUMNS)
    .eq("user_id", userId)
    .eq("is_crisis", false)
    .order("created_at", { ascending: false })
    .limit(matchCount);

  if (since) {
    recentBuilder = recentBuilder.gte("created_at", since);
  }

  const { data: recent } = await recentBuilder;

  return {
    entries: ((recent ?? []) as Entry[]).map((entry) => ({
      ...entry,
      similarity: null,
    })),
    mode: "none",
  };
}
