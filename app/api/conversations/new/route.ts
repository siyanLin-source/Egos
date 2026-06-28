import { NextResponse } from "next/server";

import {
  ensureCurrentConversation,
  startNewConversation,
} from "@/lib/conversations";
import { processArchiveNowForUser } from "@/lib/archive/archive-event";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = claims.sub;

  try {
    const currentConversation = await ensureCurrentConversation({
      supabase,
      userId,
    });

    const entries = await processArchiveNowForUser({
      supabase,
      userId,
      conversationId: currentConversation.id,
      drain: true,
    });

    const conversation = await startNewConversation({
      supabase,
      userId,
    });

    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      archived: entries?.length ?? 0,
    });
  } catch (error) {
    console.error("Could not start new conversation.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
