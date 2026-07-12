import { NextResponse } from "next/server";

import { REMINDER_COLUMNS } from "@/lib/reminders/reminders";
import { createClient } from "@/lib/supabase/server";
import type { Reminder } from "@/lib/types";

export const runtime = "nodejs";

// 完成 / 顺延 1 小时。RLS 保证只能改自己的。
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
    action?: unknown;
  } | null;
  const action = body?.action;

  if (action !== "done" && action !== "snooze") {
    return NextResponse.json(
      { error: "action 必须是 done 或 snooze。" },
      { status: 400 },
    );
  }

  if (action === "done") {
    const { data, error } = await supabase
      .from("reminders")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", claims.sub)
      .select(REMINDER_COLUMNS)
      .single();

    if (error || !data) {
      console.error("Could not complete reminder.", error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reminder: data as Reminder });
  }

  // 顺延：从「当前 due_at 与现在的较晚者」起 +1 小时，避免过期项顺延后仍是过去时间。
  const { data: existing, error: loadError } = await supabase
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("id", id)
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (loadError || !existing) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const reminder = existing as Reminder;
  const base = Math.max(new Date(reminder.due_at).getTime(), Date.now());
  const nextDueAt = new Date(base + 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("reminders")
    .update({ due_at: nextDueAt })
    .eq("id", id)
    .eq("user_id", claims.sub)
    .select(REMINDER_COLUMNS)
    .single();

  if (error || !data) {
    console.error("Could not snooze reminder.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reminder: data as Reminder });
}

// 删除一条提醒。
export async function DELETE(
  _request: Request,
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
  const { error } = await supabase
    .from("reminders")
    .delete()
    .eq("id", id)
    .eq("user_id", claims.sub);

  if (error) {
    console.error("Could not delete reminder.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
