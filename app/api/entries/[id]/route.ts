import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// 用户删除自己的一条事件记录。用登录态 + RLS，只能删自己的。
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: deleteError } = await supabase
    .from("entries")
    .delete()
    .eq("id", id)
    .eq("user_id", claims.sub);

  if (deleteError) {
    console.error("Could not delete entry.", deleteError);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
