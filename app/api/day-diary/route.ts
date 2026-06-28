import { NextResponse } from "next/server";

import { completeWithHaiku } from "@/lib/ai/haiku";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 把某一天已经总结过的事件卡片，融合成一段日记式的总结。
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    label?: string;
    summaries?: string[];
  };
  const summaries = (body.summaries ?? [])
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, 30);

  if (summaries.length === 0) {
    return NextResponse.json({ diary: null });
  }

  const prompt = `下面是${body.label ?? "某一天"}发生的几件事（每条都已经是总结过的卡片）。把它们融合成一段自然、连贯的"当天日记"，用第二人称"你"，像本人睡前轻轻回顾这一天。

要求：
- 一小段，2-4 句，口语、温和、不堆砌辞藻、不夸张。
- 不要逐条复述、不要照抄；串成"这一天过得怎么样"的整体感觉。
- 跳过没记忆价值的流水账（挪车、搬东西、随便看看这类），别硬塞进去。
- 只输出这段日记本身，不要标题、不要解释。

这一天的事：
${summaries.map((item) => `- ${item}`).join("\n")}`;

  const diary = await completeWithHaiku(prompt, {
    maxTokens: 400,
    temperature: 0.5,
  });

  return NextResponse.json({ diary });
}
