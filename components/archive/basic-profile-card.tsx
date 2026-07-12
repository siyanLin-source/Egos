"use client";

import { useEffect, useState } from "react";

import type { BasicProfile } from "@/lib/profile/basic-profile";

// 星座只做展示推导，不单独存储。
const STAR_SIGNS: Array<{ name: string; from: [number, number] }> = [
  { name: "摩羯座", from: [1, 1] },
  { name: "水瓶座", from: [1, 20] },
  { name: "双鱼座", from: [2, 19] },
  { name: "白羊座", from: [3, 21] },
  { name: "金牛座", from: [4, 20] },
  { name: "双子座", from: [5, 21] },
  { name: "巨蟹座", from: [6, 22] },
  { name: "狮子座", from: [7, 23] },
  { name: "处女座", from: [8, 23] },
  { name: "天秤座", from: [9, 23] },
  { name: "天蝎座", from: [10, 24] },
  { name: "射手座", from: [11, 23] },
  { name: "摩羯座", from: [12, 22] },
];

function getStarSign(birthday: string) {
  const [, month, day] = birthday.split("-").map(Number);

  if (!month || !day) {
    return null;
  }

  let sign = STAR_SIGNS[0].name;

  for (const candidate of STAR_SIGNS) {
    const [fromMonth, fromDay] = candidate.from;

    if (month > fromMonth || (month === fromMonth && day >= fromDay)) {
      sign = candidate.name;
    }
  }

  return sign;
}

function formatBirthday(birthday: string) {
  const [, month, day] = birthday.split("-").map(Number);
  return `${month} 月 ${day} 日`;
}

const EMPTY_PROFILE: BasicProfile = {
  nickname: null,
  birthday: null,
  city: null,
};

// 「关于你」页顶部的基本档案小卡：称呼 / 生日（推导星座）/ 所在城市，全部可选。
// 点击进入编辑态，保存即时生效（写 profile_facts，source='user_edit'）。
export function BasicProfileCard() {
  const [profile, setProfile] = useState<BasicProfile>(EMPTY_PROFILE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formNickname, setFormNickname] = useState("");
  const [formBirthday, setFormBirthday] = useState("");
  const [formCity, setFormCity] = useState("");

  useEffect(() => {
    let active = true;

    fetch("/api/basic-profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data?.profile) {
          setProfile(data.profile as BasicProfile);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          setIsLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  function startEditing() {
    setFormNickname(profile.nickname ?? "");
    setFormBirthday(profile.birthday ?? "");
    setFormCity(profile.city ?? "");
    setSaveError(null);
    setIsEditing(true);
  }

  async function save() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/basic-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nickname: formNickname.trim(),
          birthday: formBirthday.trim(),
          city: formCity.trim(),
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        profile?: BasicProfile;
        error?: string;
      } | null;

      if (data?.profile) {
        setProfile(data.profile);
      }

      if (!response.ok) {
        setSaveError(data?.error ?? "没存上，再试一次。");
        return;
      }

      setIsEditing(false);
    } catch (error) {
      console.error("Could not save basic profile.", error);
      setSaveError("没存上，再试一次。");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isLoaded) {
    return null;
  }

  const starSign = profile.birthday ? getStarSign(profile.birthday) : null;
  const hasAnyField = Boolean(
    profile.nickname || profile.birthday || profile.city,
  );

  return (
    <div className="border-y border-neutral-200 bg-white px-4 py-4 sm:rounded-lg sm:border">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">基本档案</h2>
        {!isEditing ? (
          <button
            type="button"
            onClick={startEditing}
            className="text-xs text-neutral-500 transition hover:text-neutral-700"
          >
            {hasAnyField ? "编辑" : "填一下"}
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">
                称呼（TA 怎么叫你）
              </span>
              <input
                type="text"
                value={formNickname}
                onChange={(event) => setFormNickname(event.target.value)}
                placeholder="比如：小林"
                className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">生日</span>
              <input
                type="date"
                value={formBirthday}
                onChange={(event) => setFormBirthday(event.target.value)}
                className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">
                所在城市
              </span>
              <input
                type="text"
                value={formCity}
                onChange={(event) => setFormCity(event.target.value)}
                placeholder="比如：重庆"
                className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b]"
              />
            </label>
          </div>
          {saveError ? (
            <p className="text-xs text-red-600">{saveError}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={save}
              className="rounded-full bg-neutral-950 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              {isSaving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setIsEditing(false)}
              className="rounded-full px-3 py-1.5 text-xs text-neutral-500 transition hover:text-neutral-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : hasAnyField ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {profile.nickname ? (
            <div>
              <dt className="text-xs text-neutral-400">称呼</dt>
              <dd className="mt-0.5 text-neutral-900">{profile.nickname}</dd>
            </div>
          ) : null}
          {profile.birthday ? (
            <div>
              <dt className="text-xs text-neutral-400">生日</dt>
              <dd className="mt-0.5 text-neutral-900">
                {formatBirthday(profile.birthday)}
                {starSign ? (
                  <span className="ml-1.5 text-xs text-neutral-500">
                    {starSign}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {profile.city ? (
            <div>
              <dt className="text-xs text-neutral-400">所在城市</dt>
              <dd className="mt-0.5 text-neutral-900">{profile.city}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-neutral-500">
          留几个基本信息，TA 会记得更准。都可以不填。
        </p>
      )}
    </div>
  );
}
