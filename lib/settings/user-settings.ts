import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_TIMEZONE,
  isValidTimezone,
} from "@/lib/memory/time-context";

type SettingsSupabaseClient = Pick<SupabaseClient, "from">;

// 读用户时区：user_settings 表可能还没在 Supabase 应用迁移（0012），
// 查询失败或无记录时一律兜底 Asia/Shanghai，绝不阻塞主流程。
export async function getUserTimezone({
  supabase,
  userId,
}: {
  supabase: SettingsSupabaseClient;
  userId: string;
}): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_TIMEZONE;
    }

    const timezone = (data as { timezone?: string }).timezone;

    return isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// 用客户端上报的时区回填 user_settings（开屏问候时顺手同步）。
// best-effort：表没建好 / 写失败都静默。
export async function syncUserTimezone({
  supabase,
  userId,
  timezone,
}: {
  supabase: SettingsSupabaseClient;
  userId: string;
  timezone: string | null | undefined;
}) {
  if (!isValidTimezone(timezone)) {
    return;
  }

  try {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, timezone }, { onConflict: "user_id" });

    if (error) {
      console.error("Could not sync user timezone (non-fatal).", error);
    }
  } catch {
    // 静默：时区同步失败不影响任何主流程。
  }
}
