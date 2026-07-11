import { NextResponse } from "next/server";

import { completeWithHaiku } from "@/lib/ai/haiku";
import { createClient } from "@/lib/supabase/server";
import type { ProfileFact } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function buildProfilePrompt(facts: ProfileFact[]) {
  const lines = facts.map((fact) => `- ${fact.text}`).join("\n");

  return `下面是关于一个用户的稳定事实。把它们写成一句自然、通顺的中文自我介绍，用第二人称"你"。

要求：
- 一句话，温和、口语、不堆砌辞藻、不夸张。
- 合并相近的事实：比如"在健身"和"在减肥"要合成"在健身减肥"，不要分开各说一遍。
- 修饰语放进对应名词前面：比如"养着一只从美国带回来的狗 Voli"，不要把"从美国带回来"单独拖在句尾。
- 严格忠于事实、不脑补；但如果某条事实本身措辞明显夸张（如"投入了毕生的全部精力"），用更平实的话表达同样意思（如"在做一个软件项目"），绝不放大。
- 名字、宠物、关系这些先说；零碎的偏好放后面或省略。
- 只输出这一句话本身，不要解释、不要引号、不要列表。

事实：
${lines}`;
}

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("profile_facts")
    .select("id,kind,subject,text,fact_key,importance")
    .eq("user_id", claims.sub)
    .order("importance", { ascending: false })
    .limit(20);

  // 基本档案卡的 user_edit 行（「你希望 TA 叫你…」等）不是自我介绍素材：
  // 念进摘要会出现指代不明的「TA」，且和卡片信息重复。
  const facts = ((data ?? []) as ProfileFact[]).filter(
    (fact) => !fact.fact_key?.startsWith("user_edit|"),
  );

  if (facts.length === 0) {
    return NextResponse.json({ summary: null });
  }

  const summary = await completeWithHaiku(buildProfilePrompt(facts), {
    maxTokens: 300,
    temperature: 0.4,
  });

  return NextResponse.json({ summary });
}
