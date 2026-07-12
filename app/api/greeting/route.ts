import { NextResponse } from "next/server";

import {
  generateGreetingText,
  getGreetingMaterial,
} from "@/lib/memory/greeting";
import { getTimeContext } from "@/lib/memory/time-context";
import { syncUserTimezone } from "@/lib/settings/user-settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 开屏问候：新会话创建后，为 TA 生成这段对话的第一条消息。
// best-effort——任何一步失败都返回 { message: null }，前端保持静默，绝不报错打扰用户。
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = claims.sub;

  const body = (await request.json().catch(() => ({}))) as {
    conversationId?: string;
    timezone?: string;
  };

  if (!body.conversationId) {
    return NextResponse.json(
      { error: "conversationId is required." },
      { status: 400 },
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", body.conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (conversationError || !conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }

  // 只给空会话发问候：已经聊起来了就不插嘴。
  const { count, error: countError } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("conversation_id", body.conversationId);

  if (countError) {
    console.error("Could not count messages for greeting.", countError);
    return NextResponse.json({ message: null });
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json({ message: null });
  }

  const timeContext = getTimeContext(body.timezone ?? null);

  try {
    // 顺手把客户端时区同步进 user_settings（提醒解析与对话时间感依赖它）。
    // best-effort，与取材并行，失败不影响问候。
    const [material] = await Promise.all([
      getGreetingMaterial({ supabase, userId }),
      syncUserTimezone({ supabase, userId, timezone: body.timezone }),
    ]);
    const text = await generateGreetingText({ material, timeContext });

    // 生成期间用户可能已经先开口了（竞态兜底）：再查一次，非空就放弃问候。
    const { count: recheckCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("conversation_id", body.conversationId);

    if ((recheckCount ?? 0) > 0) {
      return NextResponse.json({ message: null });
    }

    const { data: message, error: insertError } = await supabase
      .from("messages")
      .insert({
        user_id: userId,
        conversation_id: body.conversationId,
        sender: "ai",
        content: text,
      })
      .select("id,user_id,conversation_id,sender,content,image_url,created_at")
      .single();

    if (insertError || !message) {
      console.error("Could not save greeting message.", insertError);
      return NextResponse.json({ message: null });
    }

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Greeting flow failed.", error);
    return NextResponse.json({ message: null });
  }
}
