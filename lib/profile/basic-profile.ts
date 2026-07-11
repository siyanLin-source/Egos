import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProfileFact } from "@/lib/types";

type ProfileSupabaseClient = Pick<SupabaseClient, "from">;

// 基本档案卡（称呼/生日/所在城市）：不建新表，写入 profile_facts，
// source='user_edit'，fact_key 用固定值保证每人每字段只有一行。
export const USER_EDIT_FACT_KEYS = {
  nickname: "user_edit|nickname",
  birthday: "user_edit|birthday",
  city: "user_edit|city",
} as const;

export type BasicProfile = {
  nickname: string | null;
  // YYYY-MM-DD
  birthday: string | null;
  city: string | null;
};

export function buildNicknameFactText(nickname: string) {
  return `你希望 TA 叫你「${nickname}」`;
}

export function buildBirthdayFactText(birthday: string) {
  const [year, month, day] = birthday.split("-").map(Number);
  return `你的生日是${year}年${month}月${day}日`;
}

export function buildCityFactText(city: string) {
  return `你现在住在${city}`;
}

export function parseNicknameFromFactText(text: string) {
  return text.match(/「(.+)」/)?.[1]?.trim() ?? null;
}

export function parseBirthdayFromFactText(text: string) {
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseCityFromFactText(text: string) {
  return text.match(/^你现在住在(.+)$/)?.[1]?.trim() ?? null;
}

// 从一组 profile facts 里解析出基本档案（按 fact_key 识别，靠文本兜底解析）。
export function parseBasicProfile(
  facts: Array<Pick<ProfileFact, "text"> & { fact_key?: string }>,
): BasicProfile {
  const byKey = new Map(
    facts
      .filter((fact) => fact.fact_key)
      .map((fact) => [fact.fact_key as string, fact.text]),
  );

  const nicknameText = byKey.get(USER_EDIT_FACT_KEYS.nickname);
  const birthdayText = byKey.get(USER_EDIT_FACT_KEYS.birthday);
  const cityText = byKey.get(USER_EDIT_FACT_KEYS.city);

  return {
    nickname: nicknameText ? parseNicknameFromFactText(nicknameText) : null,
    birthday: birthdayText ? parseBirthdayFromFactText(birthdayText) : null,
    city: cityText ? parseCityFromFactText(cityText) : null,
  };
}

export async function getBasicProfile({
  supabase,
  userId,
}: {
  supabase: ProfileSupabaseClient;
  userId: string;
}): Promise<BasicProfile> {
  const { data, error } = await supabase
    .from("profile_facts")
    .select("text,fact_key")
    .eq("user_id", userId)
    .in("fact_key", Object.values(USER_EDIT_FACT_KEYS));

  if (error) {
    console.error("Could not load basic profile facts.", error);
    return { nickname: null, birthday: null, city: null };
  }

  return parseBasicProfile(
    (data ?? []) as Array<{ text: string; fact_key: string }>,
  );
}

// 从 L1 画像事实里取出用户偏好的称呼（问候与对话注入用）。
export function getPreferredNickname(
  facts: Array<Pick<ProfileFact, "text"> & { fact_key?: string }>,
) {
  const fact = facts.find(
    (item) => item.fact_key === USER_EDIT_FACT_KEYS.nickname,
  );

  return fact ? parseNicknameFromFactText(fact.text) : null;
}

type UpsertField = {
  factKey: string;
  kind: "identity" | "place";
  text: string;
};

// 保存一个字段：空值 → 删除对应行；有值 → upsert。
// source 列可能还没在 Supabase 应用迁移（0013）：插入报未知列时降级为不带 source 重试。
export async function saveBasicProfileField({
  supabase,
  userId,
  field,
  value,
}: {
  supabase: ProfileSupabaseClient;
  userId: string;
  field: UpsertField | null;
  value: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!field) {
    return { ok: false, error: "未知字段。" };
  }

  if (!value) {
    const { error } = await supabase
      .from("profile_facts")
      .delete()
      .eq("user_id", userId)
      .eq("fact_key", field.factKey);

    if (error) {
      console.error("Could not clear basic profile field.", error);
      return { ok: false, error: "没删掉，再试一次。" };
    }

    return { ok: true };
  }

  const now = new Date().toISOString();
  const baseRow = {
    user_id: userId,
    kind: field.kind,
    subject: "你",
    text: field.text,
    fact_key: field.factKey,
    importance: 1.0,
    // 用户手动填写没有来源消息；表约束要求非空数组，用哨兵值标记。
    source_message_ids: ["user_edit"],
    first_observed_at: now,
    last_observed_at: now,
  };

  const { error } = await supabase
    .from("profile_facts")
    .upsert(
      { ...baseRow, source: "user_edit" },
      { onConflict: "user_id,fact_key" },
    );

  if (!error) {
    return { ok: true };
  }

  // source 列迁移（0013）未应用时降级保存（不带 source）。
  // PostgREST 对载荷里的未知列返回 PGRST204（schema cache 未找到该列）；
  // 42703 是直连 Postgres 的 undefined_column，两个都认。判定必须收紧到
  // 错误码，否则无关错误也会触发降级，把用户编辑静默存成默认 source。
  if (error.code === "PGRST204" || error.code === "42703") {
    const { error: retryError } = await supabase
      .from("profile_facts")
      .upsert(baseRow, { onConflict: "user_id,fact_key" });

    if (!retryError) {
      return { ok: true };
    }

    console.error("Could not save basic profile field (retry).", retryError);
    return { ok: false, error: "没存上，再试一次。" };
  }

  console.error("Could not save basic profile field.", error);
  return { ok: false, error: "没存上，再试一次。" };
}
