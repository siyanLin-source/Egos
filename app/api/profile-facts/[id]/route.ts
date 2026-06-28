import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 切换某条画像事实的"想记住"状态。RLS 保证只能改自己的。
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    pinned?: unknown;
  } | null;

  if (!body || typeof body.pinned !== "boolean") {
    return NextResponse.json(
      { error: "pinned must be a boolean." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("profile_facts")
    .update({ pinned: body.pinned })
    .eq("id", id)
    .eq("user_id", claims.sub);

  if (error) {
    console.error("Could not update profile fact pin.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pinned: body.pinned });
}
