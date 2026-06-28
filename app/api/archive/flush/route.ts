import { NextResponse } from "next/server";

import { processArchiveNowForUser } from "@/lib/archive/archive-event";
import { ensureCurrentConversation } from "@/lib/conversations";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 用户手动触发归档时调用：把还没归档的消息写进档案索引。
// archived_at 只表示"已被索引"，不能影响 live chat 的可见历史。
export async function POST() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const conversation = await ensureCurrentConversation({
      supabase,
      userId: claims.sub,
    });
    const entries = await processArchiveNowForUser({
      supabase,
      userId: claims.sub,
      conversationId: conversation.id,
    });

    return NextResponse.json({ ok: true, archived: entries?.length ?? 0 });
  } catch (error) {
    console.error("Manual flush archive failed.", error);
    return NextResponse.json({ ok: false, archived: 0 }, { status: 500 });
  }
}
