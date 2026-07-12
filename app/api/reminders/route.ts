import { NextResponse } from "next/server";

import {
  createReminder,
  getPendingReminders,
  type CreateReminderErrorCode,
} from "@/lib/reminders/reminders";
import { createClient } from "@/lib/supabase/server";

// createReminder 的错误文案是写给对话模型的；手动添加表单直接面向用户，
// 按错误码换成用户能看懂的话。
const USER_FACING_ERRORS: Record<CreateReminderErrorCode, string> = {
  empty_title: "先填上要提醒的事。",
  title_too_long: "这条有点长了，精简到一句话试试。",
  crisis_content: "这条内容看起来更适合聊一聊，先和 TA 说说吧。",
  unparseable_time: "这个时间读不懂，换一个试试。",
  missing_offset: "这个时间读不懂，换一个试试。",
  past_time: "这个时间已经过去了，选一个之后的时间吧。",
  db_error: "没存上，稍后再试一次。",
};

export const runtime = "nodejs";

// 全部待办（due_at 升序）。
export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reminders = await getPendingReminders({
    supabase,
    userId: claims.sub,
  });

  return NextResponse.json({ reminders });
}

// 手动添加（抽屉底部的小表单）。
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    due_at?: unknown;
    location?: unknown;
  } | null;

  if (
    !body ||
    typeof body.title !== "string" ||
    typeof body.due_at !== "string"
  ) {
    return NextResponse.json(
      { error: "title 和 due_at 是必填的。" },
      { status: 400 },
    );
  }

  const result = await createReminder({
    supabase,
    userId: claims.sub,
    input: {
      title: body.title,
      dueAt: body.due_at,
      location: typeof body.location === "string" ? body.location : null,
      source: "manual",
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: USER_FACING_ERRORS[result.code] ?? "没存上，再试一次。" },
      { status: 400 },
    );
  }

  return NextResponse.json({ reminder: result.reminder });
}
