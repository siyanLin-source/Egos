import { NextResponse } from "next/server";

import {
  buildBirthdayFactText,
  buildCityFactText,
  buildNicknameFactText,
  getBasicProfile,
  saveBasicProfileField,
  USER_EDIT_FACT_KEYS,
} from "@/lib/profile/basic-profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FIELD_LENGTH = 40;

// 格式对还不够：'2026-13-40' 也能过正则，会以「你的生日是2026年13月40日」
// 进入 L1 注入。解析回读比对，确认是真实历法日期。
function isValidCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getBasicProfile({ supabase, userId: claims.sub });

  return NextResponse.json({ profile });
}

// 保存基本档案卡：三个字段全部可选；传空字符串 = 清除该字段。
// 只走用户编辑写入路径，不碰 AI 提取逻辑。
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    nickname?: unknown;
    birthday?: unknown;
    city?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "请求体不合法。" }, { status: 400 });
  }

  const userId = claims.sub;
  const errors: string[] = [];

  if (typeof body.nickname === "string") {
    // 内部空白规整为单个空格：含换行的值会让「」内解析断裂，
    // 造成「库里有值、界面看不见」的不一致。
    const nickname = body.nickname
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_FIELD_LENGTH);
    const result = await saveBasicProfileField({
      supabase,
      userId,
      field: {
        factKey: USER_EDIT_FACT_KEYS.nickname,
        kind: "identity",
        text: nickname ? buildNicknameFactText(nickname) : "",
      },
      value: nickname || null,
    });

    if (!result.ok) {
      errors.push(`称呼：${result.error}`);
    }
  }

  if (typeof body.birthday === "string") {
    const birthday = body.birthday.trim();

    if (birthday && !isValidCalendarDate(birthday)) {
      errors.push("生日格式需要是 YYYY-MM-DD 的真实日期。");
    } else {
      const result = await saveBasicProfileField({
        supabase,
        userId,
        field: {
          factKey: USER_EDIT_FACT_KEYS.birthday,
          kind: "identity",
          text: birthday ? buildBirthdayFactText(birthday) : "",
        },
        value: birthday || null,
      });

      if (!result.ok) {
        errors.push(`生日：${result.error}`);
      }
    }
  }

  if (typeof body.city === "string") {
    const city = body.city
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_FIELD_LENGTH);
    const result = await saveBasicProfileField({
      supabase,
      userId,
      field: {
        factKey: USER_EDIT_FACT_KEYS.city,
        kind: "place",
        text: city ? buildCityFactText(city) : "",
      },
      value: city || null,
    });

    if (!result.ok) {
      errors.push(`所在城市：${result.error}`);
    }
  }

  const profile = await getBasicProfile({ supabase, userId });

  if (errors.length > 0) {
    return NextResponse.json(
      { profile, error: errors.join("；") },
      { status: 400 },
    );
  }

  return NextResponse.json({ profile });
}
