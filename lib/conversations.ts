import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseLike = Pick<SupabaseClient, "from">;

export type Conversation = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

async function setCurrentConversation({
  supabase,
  userId,
  conversationId,
}: {
  supabase: SupabaseLike;
  userId: string;
  conversationId: string;
}) {
  const { error } = await supabase.from("user_conversation_state").upsert(
    {
      user_id: userId,
      current_conversation_id: conversationId,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Could not set current conversation: ${error.message}`);
  }
}

async function createConversation({
  supabase,
  userId,
  title = null,
}: {
  supabase: SupabaseLike;
  userId: string;
  title?: string | null;
}) {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title,
    })
    .select("id,user_id,title,created_at,updated_at")
    .single();

  if (error || !data) {
    throw new Error(`Could not create conversation: ${error?.message ?? ""}`);
  }

  return data as Conversation;
}

export async function ensureCurrentConversation({
  supabase,
  userId,
}: {
  supabase: SupabaseLike;
  userId: string;
}) {
  const { data: state, error: stateError } = await supabase
    .from("user_conversation_state")
    .select("current_conversation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (stateError) {
    throw new Error(`Could not load current conversation: ${stateError.message}`);
  }

  if (state?.current_conversation_id) {
    const { data: currentConversation, error: currentError } = await supabase
      .from("conversations")
      .select("id,user_id,title,created_at,updated_at")
      .eq("user_id", userId)
      .eq("id", state.current_conversation_id)
      .maybeSingle();

    if (currentError) {
      throw new Error(`Could not load conversation: ${currentError.message}`);
    }

    if (currentConversation) {
      return currentConversation as Conversation;
    }
  }

  const { data: existingConversation, error: existingError } = await supabase
    .from("conversations")
    .select("id,user_id,title,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Could not load latest conversation: ${existingError.message}`);
  }

  const conversation =
    (existingConversation as Conversation | null) ??
    (await createConversation({
      supabase,
      userId,
      title: "初始对话",
    }));

  await setCurrentConversation({
    supabase,
    userId,
    conversationId: conversation.id,
  });

  return conversation;
}

export async function startNewConversation({
  supabase,
  userId,
}: {
  supabase: SupabaseLike;
  userId: string;
}) {
  const conversation = await createConversation({
    supabase,
    userId,
    title: null,
  });

  await setCurrentConversation({
    supabase,
    userId,
    conversationId: conversation.id,
  });

  return conversation;
}
