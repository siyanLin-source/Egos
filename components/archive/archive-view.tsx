"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BasicProfileCard } from "@/components/archive/basic-profile-card";
import { Button } from "@/components/ui/button";
import { cleanEntries } from "@/lib/archive/clean-entries";
import { canonicalPersonName } from "@/lib/archive/people";
import { getPreferredNickname } from "@/lib/profile/basic-profile";
import { CATEGORIES, EMOTIONS } from "@/lib/archive/taxonomy";
import type {
  Entry,
  EntryCategory,
  EntryEmotion,
  ProfileFact,
  ProfileFactKind,
  Topic,
  TopicFact,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type EmotionFilter = EntryEmotion | "全部";
type CategoryFilter = EntryCategory | "全部";
type ActivityView = "calendar" | "heatmap";

const PROFILE_FACT_KIND_LABELS: Record<ProfileFactKind, string> = {
  identity: "身份",
  relationship: "关系",
  pet: "宠物",
  interest: "兴趣",
  preference: "偏好",
  routine: "习惯",
  goal: "目标",
  health: "健康",
  work: "工作",
  school: "学习",
  place: "地点",
  other: "其他",
};

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const NEGATIVE_EMOTIONS = new Set<EntryEmotion>(["低落", "烦躁", "焦虑"]);

function isNegativeEmotion(emotion: EntryEmotion) {
  return NEGATIVE_EMOTIONS.has(emotion);
}

function getLocalDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthCells(monthDate: Date) {
  const first = startOfMonth(monthDate);
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay(): 0=周日..6=周六，转换成周一开头的偏移。
  const leadingBlanks = (first.getDay() + 6) % 7;

  const cells: Array<{ key: string; day: number } | null> = [];

  for (let blank = 0; blank < leadingBlanks; blank += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ key: getLocalDateKey(new Date(year, month, day)), day });
  }

  return cells;
}

function buildHeatmap(entries: Entry[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const counts = new Map<string, number>();

  for (const entry of entries) {
    const key = getLocalDateKey(entry.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 56 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (55 - index));
    const key = getLocalDateKey(date);

    return { key, count: counts.get(key) ?? 0 };
  });
}

function heatmapColor(count: number) {
  if (count >= 4) return "bg-[#256f5b]";
  if (count === 3) return "bg-[#4b9a78]";
  if (count === 2) return "bg-[#8fc3a2]";
  if (count === 1) return "bg-[#cfe4d5]";
  return "bg-neutral-200";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDayLabel(key: string) {
  const [, month, day] = key.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function entryMatchesQuery(entry: Entry, query: string) {
  if (!query) {
    return true;
  }

  return [
    entry.summary,
    entry.category,
    entry.emotion,
    ...entry.keywords,
    ...entry.people,
    ...entry.places,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function stripYouPrefix(text: string) {
  return text
    .replace(/^你/, "")
    .replace(/[，,、；;。.!！?？]+$/g, "")
    .trim();
}

function getProfileName(facts: ProfileFact[]) {
  const identity = facts.find((fact) => fact.kind === "identity");
  const name =
    identity?.text.match(/^你(?:叫|是|名字是)\s*(.+)$/)?.[1]?.trim() ??
    identity?.text.match(/(?:叫|是|名字是)\s*(.+)$/)?.[1]?.trim();

  return name?.replace(/[。.!！?？]+$/g, "") || "你";
}

function getProfileInitial(name: string) {
  if (!name || name === "你") {
    return "你";
  }

  return name.trim().slice(0, 1).toUpperCase();
}

function joinFragments(fragments: string[]) {
  if (fragments.length <= 1) {
    return fragments[0] ?? "";
  }

  return `${fragments.slice(0, -1).join("、")}，也${fragments.at(-1)}`;
}

function buildProfileSummary(facts: ProfileFact[]) {
  if (facts.length === 0) {
    return "还没有沉淀出稳定画像。再聊几次，它会慢慢长出来。";
  }

  const name = getProfileName(facts);
  const fragments: string[] = [];
  const relationship = facts.find(
    (fact) =>
      fact.kind === "relationship" &&
      /(男朋友|女朋友|对象|伴侣)/.test(fact.text),
  );
  const pets = facts
    .filter((fact) => fact.kind === "pet")
    .map((fact) =>
      stripYouPrefix(fact.text)
        .replace(/^养了?/, "养着")
        .replace(/^有/, "养着"),
    )
    .slice(0, 2);
  const bodyAndInterests = facts
    .filter((fact) => fact.kind === "health" || fact.kind === "interest")
    .map((fact) => stripYouPrefix(fact.text))
    .slice(0, 3);
  const workOrPlace = facts.find(
    (fact) =>
      fact.kind === "work" || fact.kind === "school" || fact.kind === "place",
  );
  const preferenceOrGoal = facts.find(
    (fact) =>
      fact.kind === "preference" ||
      fact.kind === "routine" ||
      fact.kind === "goal",
  );

  if (pets.length > 0) {
    fragments.push(pets.join("，"));
  }

  if (bodyAndInterests.length > 0) {
    fragments.push(joinFragments(bodyAndInterests));
  }

  if (workOrPlace) {
    fragments.push(stripYouPrefix(workOrPlace.text));
  }

  if (relationship) {
    fragments.push(stripYouPrefix(relationship.text).replace(/^有/, "身边有"));
  }

  if (preferenceOrGoal) {
    fragments.push(stripYouPrefix(preferenceOrGoal.text));
  }

  const uniqueFragments = Array.from(new Set(fragments.filter(Boolean))).slice(
    0,
    3,
  );

  if (uniqueFragments.length === 0) {
    return name === "你"
      ? "我还在慢慢认识你。"
      : `你是 ${name}。`;
  }

  const lead = name === "你" ? "我知道你" : `你是 ${name}`;

  return `${lead}，${uniqueFragments.join("，")}。`;
}

function normalizeTopicFacts(facts: TopicFact[]) {
  const seen = new Set<string>();
  const normalized: TopicFact[] = [];

  for (const fact of facts) {
    if (!fact || typeof fact.text !== "string" || !fact.text.trim()) {
      continue;
    }

    const key = `${fact.source_entry_id ?? ""}:${fact.text.trim()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      ...fact,
      text: fact.text.trim(),
    });
  }

  return normalized.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return timeB - timeA;
  });
}

function buildPersonTopicViews(topics: Topic[], profileFacts: ProfileFact[]) {
  const grouped = new Map<string, Topic>();

  for (const topic of topics) {
    const name = canonicalPersonName(topic.name, profileFacts);
    const facts = normalizeTopicFacts(topic.facts);

    if (!name || facts.length === 0) {
      continue;
    }

    const existing = grouped.get(name);

    if (!existing) {
      grouped.set(name, {
        ...topic,
        id: `${topic.id}:${name}`,
        name,
        facts,
      });
      continue;
    }

    grouped.set(name, {
      ...existing,
      mention_count: existing.mention_count + topic.mention_count,
      first_mentioned_at:
        existing.first_mentioned_at < topic.first_mentioned_at
          ? existing.first_mentioned_at
          : topic.first_mentioned_at,
      last_mentioned_at:
        existing.last_mentioned_at > topic.last_mentioned_at
          ? existing.last_mentioned_at
          : topic.last_mentioned_at,
      facts: normalizeTopicFacts([...existing.facts, ...facts]),
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.mention_count !== a.mention_count) {
      return b.mention_count - a.mention_count;
    }

    return (
      new Date(b.last_mentioned_at).getTime() -
      new Date(a.last_mentioned_at).getTime()
    );
  });
}

function entryMentionsPerson(
  entry: Entry,
  personName: string,
  profileFacts: ProfileFact[],
) {
  return entry.people.some(
    (name) => canonicalPersonName(name, profileFacts) === personName,
  );
}

function ProfileFactRow({
  fact,
  onTogglePin,
}: {
  fact: ProfileFact;
  onTogglePin: (fact: ProfileFact) => void;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[#256f5b]">
          {PROFILE_FACT_KIND_LABELS[fact.kind]}
        </span>
        <span className="text-xs text-neutral-400">
          {formatDate(fact.last_observed_at)}
        </span>
      </div>
      <p className="text-sm leading-6 text-neutral-950">{fact.text}</p>
    </div>
  );

  return (
    <div className="flex items-start gap-3 py-3">
      {fact.source_entry_id ? (
        <Link
          href={`/archive/${fact.source_entry_id}`}
          className="block min-w-0 flex-1 transition hover:opacity-80"
        >
          {body}
        </Link>
      ) : (
        body
      )}
      <button
        type="button"
        onClick={() => onTogglePin(fact)}
        aria-label={fact.pinned ? "取消想记住" : "想记住"}
        title={fact.pinned ? "取消想记住" : "想记住"}
        className={cn(
          "shrink-0 text-lg leading-none transition",
          fact.pinned
            ? "text-[#e0a500]"
            : "text-neutral-300 hover:text-neutral-500",
        )}
      >
        {fact.pinned ? "★" : "☆"}
      </button>
    </div>
  );
}

function MonthCalendar({
  entries,
  selectedDay,
  onSelectDay,
}: {
  entries: Entry[];
  selectedDay: string | null;
  onSelectDay: (key: string | null) => void;
}) {
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));

  const counts = useMemo(() => {
    const map = new Map<string, number>();

    for (const entry of entries) {
      const key = getLocalDateKey(entry.created_at);
      map.set(key, (map.get(key) ?? 0) + 1);
    }

    return map;
  }, [entries]);

  const cells = useMemo(() => buildMonthCells(monthDate), [monthDate]);
  const todayKey = getLocalDateKey(new Date());
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(monthDate);

  function shiftMonth(delta: number) {
    setMonthDate(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-full px-2 py-1 text-sm text-neutral-500 transition hover:bg-neutral-100"
          aria-label="上个月"
        >
          ‹
        </button>
        <p className="text-sm font-medium">{monthLabel}</p>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-full px-2 py-1 text-sm text-neutral-500 transition hover:bg-neutral-100"
          aria-label="下个月"
        >
          ›
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs text-neutral-400">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, index) => {
          if (!cell) {
            return <div key={`blank-${index}`} className="aspect-square" />;
          }

          const count = counts.get(cell.key) ?? 0;
          const hasEntries = count > 0;
          const isSelected = selectedDay === cell.key;
          const isToday = cell.key === todayKey;

          return (
            <button
              key={cell.key}
              type="button"
              disabled={!hasEntries}
              onClick={() =>
                onSelectDay(isSelected ? null : cell.key)
              }
              title={hasEntries ? `${count} 条` : undefined}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-md text-sm transition",
                isSelected
                  ? "bg-[#256f5b] text-white"
                  : hasEntries
                    ? "bg-[#e7efe7] text-neutral-800 hover:bg-[#d6f7e9]"
                    : "text-neutral-300",
                isToday && !isSelected ? "ring-1 ring-[#256f5b]" : "",
              )}
            >
              <span>{cell.day}</span>
              {hasEntries ? (
                <span
                  className={cn(
                    "mt-0.5 h-1 w-1 rounded-full",
                    isSelected ? "bg-white" : "bg-[#256f5b]",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ArchiveView({
  entries,
  profileFacts,
  personTopics,
}: {
  entries: Entry[];
  profileFacts: ProfileFact[];
  personTopics: Topic[];
}) {
  const [emotionFilter, setEmotionFilter] = useState<EmotionFilter>("全部");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("全部");
  const [activityView, setActivityView] = useState<ActivityView>("calendar");
  const [showActivity, setShowActivity] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [facts, setFacts] = useState(profileFacts);

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  // 显示时清洗：去急性原话卡 + 去废话 + 近似重复合并。不依赖 DB 的 is_crisis 旗标。
  const safeEntries = useMemo(() => cleanEntries(entries), [entries]);
  const personTopicViews = useMemo(
    () => buildPersonTopicViews(personTopics, facts),
    [facts, personTopics],
  );
  const selectedPersonTopic = useMemo(
    () =>
      selectedPerson
        ? (personTopicViews.find((topic) => topic.name === selectedPerson) ??
          null)
        : null,
    [personTopicViews, selectedPerson],
  );
  const selectedPersonEntryIds = useMemo(() => {
    return new Set(
      normalizeTopicFacts(selectedPersonTopic?.facts ?? [])
        .map((fact) => fact.source_entry_id)
        .filter((id): id is string => Boolean(id)),
    );
  }, [selectedPersonTopic]);

  async function togglePin(target: ProfileFact) {
    const nextPinned = !target.pinned;

    setFacts((current) =>
      current.map((fact) =>
        fact.id === target.id ? { ...fact, pinned: nextPinned } : fact,
      ),
    );

    try {
      const response = await fetch(`/api/profile-facts/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });

      if (!response.ok) {
        throw new Error(`Pin request failed: ${response.status}`);
      }
    } catch (error) {
      console.error("Could not update pin; reverting.", error);
      setFacts((current) =>
        current.map((fact) =>
          fact.id === target.id ? { ...fact, pinned: !nextPinned } : fact,
        ),
      );
    }
  }

  const filteredEntries = useMemo(() => {
    return safeEntries.filter((entry) => {
      const emotionMatches =
        emotionFilter === "全部"
          ? !isNegativeEmotion(entry.emotion)
          : entry.emotion === emotionFilter;
      const categoryMatches =
        categoryFilter === "全部" || entry.category === categoryFilter;
      const dayMatches = selectedDay
        ? getLocalDateKey(entry.created_at) === selectedDay
        : true;

      const personMatches = selectedPerson
        ? selectedPersonEntryIds.has(entry.id) ||
          entryMentionsPerson(entry, selectedPerson, facts)
        : true;

      return (
        emotionMatches &&
        categoryMatches &&
        dayMatches &&
        personMatches &&
        entryMatchesQuery(entry, query)
      );
    });
  }, [
    categoryFilter,
    emotionFilter,
    query,
    selectedDay,
    selectedPerson,
    selectedPersonEntryIds,
    safeEntries,
    facts,
  ]);

  const pinnedFacts = useMemo(
    () => facts.filter((fact) => fact.pinned),
    [facts],
  );
  // 基本档案卡写入的 user_edit 行（「你的生日是…」「你希望 TA 叫你…」）
  // 不能进名字推导/本地摘要，否则画像卡会把生日当成名字。
  const aiFacts = useMemo(
    () => facts.filter((fact) => !fact.fact_key?.startsWith("user_edit|")),
    [facts],
  );
  const profileName = useMemo(
    () => getPreferredNickname(facts) ?? getProfileName(aiFacts),
    [facts, aiFacts],
  );
  const profileSummary = useMemo(() => buildProfileSummary(aiFacts), [aiFacts]);
  // AI 写的「关于你」那句话。加载完成前先用本地模板兜底，避免空白。
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/api/profile-summary")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data && typeof data.summary === "string") {
          setAiSummary(data.summary);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const heatmapDays = useMemo(() => buildHeatmap(safeEntries), [safeEntries]);

  // 选中某一天 → 取这天的全部可见事件，生成一段"当天日记"。
  const selectedDayEntries = useMemo(() => {
    if (!selectedDay) {
      return [];
    }
    return safeEntries.filter(
      (entry) => getLocalDateKey(entry.created_at) === selectedDay,
    );
  }, [safeEntries, selectedDay]);

  const [dayDiary, setDayDiary] = useState<string | null>(null);
  const [dayDiaryLoading, setDayDiaryLoading] = useState(false);

  useEffect(() => {
    if (!selectedDay || selectedDayEntries.length === 0) {
      setDayDiary(null);
      setDayDiaryLoading(false);
      return;
    }

    let active = true;
    setDayDiary(null);
    setDayDiaryLoading(true);

    fetch("/api/day-diary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: formatDayLabel(selectedDay),
        summaries: selectedDayEntries.map((entry) => entry.summary),
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data && typeof data.diary === "string") {
          setDayDiary(data.diary);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          setDayDiaryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedDay, selectedDayEntries]);
  // 人物视图统一从"可见 Entry"派生，避免 topics 的旧计数（提到 N 次）跟实际可见记录对不上。
  const personEntryCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const entry of safeEntries) {
      const seen = new Set<string>();

      for (const raw of entry.people) {
        const name = canonicalPersonName(raw, facts);

        if (!name || seen.has(name)) {
          continue;
        }

        seen.add(name);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    return counts;
  }, [safeEntries, facts]);

  // 选中某人时，显示 ta 所有可见记录（含低落情绪，不套用默认隐藏），按时间倒序。
  const personEntries = useMemo(() => {
    if (!selectedPerson) {
      return [];
    }

    return safeEntries
      .filter((entry) => entryMentionsPerson(entry, selectedPerson, facts))
      .filter((entry) => entryMatchesQuery(entry, query))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [safeEntries, selectedPerson, facts, query]);

  // 只展示真有可见记录的人，过滤掉"只在被隐藏记录里出现"的名字。
  const visiblePersonViews = useMemo(
    () =>
      personTopicViews.filter(
        (topic) => (personEntryCounts.get(topic.name) ?? 0) > 0,
      ),
    [personTopicViews, personEntryCounts],
  );

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">档案</h1>
            <p className="mt-1 text-xs text-neutral-500">事件和关于你的事实</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/people">人物</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">回到聊天</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索：人名、关键词、一句话…"
            className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-[#256f5b]"
          />
          {isSearching ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-600"
            >
              清除
            </button>
          ) : null}
        </div>

        {/* CSS 隐藏而不是卸载：搜索时卸载会丢掉编辑到一半的内容 */}
        <div className={isSearching ? "hidden" : undefined}>
          <BasicProfileCard />
        </div>

        {!isSearching && pinnedFacts.length > 0 ? (
          <div className="border-y border-[#f0e0b0] bg-[#fffdf5] px-4 py-4 sm:rounded-lg sm:border">
            <div className="mb-2 flex items-center justify-between gap-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="text-[#e0a500]">★</span> 想记住的事
              </h2>
              <span className="text-xs text-neutral-500">
                {pinnedFacts.length} 条
              </span>
            </div>
            <div className="divide-y divide-[#f0e0b0]">
              {pinnedFacts.map((fact) => (
                <ProfileFactRow
                  key={fact.id}
                  fact={fact}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-y border-neutral-200 bg-[#fffaf2] px-4 py-4 sm:rounded-lg sm:border">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-lg font-semibold text-white">
              {getProfileInitial(profileName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{profileName}</h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    {profileFacts.length > 0 ? "关于你" : "慢慢认识中"}
                  </p>
                </div>
                <span className="rounded-full bg-[#d6f7e9] px-3 py-1 text-xs font-medium text-[#256f5b]">
                  画像
                </span>
              </div>
              <p className="text-[15px] leading-7 text-neutral-800">
                {aiSummary ?? profileSummary}
              </p>
            </div>
          </div>
        </div>

        {visiblePersonViews.length > 0 ? (
          <div className="border-y border-neutral-200 bg-white px-4 py-4 sm:rounded-lg sm:border">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold">人物</h2>
              {selectedPerson ? (
                <button
                  type="button"
                  onClick={() => setSelectedPerson(null)}
                  className="text-xs text-neutral-500 hover:text-neutral-700"
                >
                  看全部
                </button>
              ) : (
                <span className="text-xs text-neutral-500">
                  {visiblePersonViews.length} 人
                </span>
              )}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {visiblePersonViews.map((topic) => {
                const isSelected = selectedPerson === topic.name;

                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() =>
                      setSelectedPerson(isSelected ? null : topic.name)
                    }
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-sm transition",
                      isSelected
                        ? "border-neutral-950 bg-neutral-950 text-white"
                        : "border-neutral-200 bg-[#fafafa] text-neutral-700 hover:border-neutral-300",
                    )}
                  >
                    {topic.name}
                    <span
                      className={cn(
                        "ml-1 text-xs",
                        isSelected ? "text-white/70" : "text-neutral-400",
                      )}
                    >
                      {personEntryCounts.get(topic.name) ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedPerson ? (
              <div className="mt-4 border-t border-neutral-100 pt-4">
                <div className="mb-3">
                  <h3 className="text-[15px] font-semibold">{selectedPerson}</h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    {personEntries.length} 条相关记录
                  </p>
                </div>

                {personEntries.length > 0 ? (
                  <div className="divide-y divide-neutral-100">
                    {personEntries.map((entry) => (
                      <Link
                        key={entry.id}
                        href={`/archive/${entry.id}`}
                        className="block py-2.5 transition hover:opacity-75"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#e7efe7] px-2 py-0.5 text-xs font-medium text-[#256f5b]">
                            {entry.category}
                          </span>
                          <span className="text-xs text-neutral-400">
                            {formatDate(entry.created_at)}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-neutral-800">
                          {entry.summary}
                        </p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-500">
                    当前筛选下暂无相关记录。
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["全部", ...EMOTIONS] as EmotionFilter[]).map((emotion) => (
              <button
                key={emotion}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition",
                  emotionFilter === emotion
                    ? "border-neutral-950 bg-neutral-950 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
                )}
                type="button"
                onClick={() => setEmotionFilter(emotion)}
              >
                {emotion}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["全部", ...CATEGORIES] as CategoryFilter[]).map((category) => (
              <button
                key={category}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition",
                  categoryFilter === category
                    ? "border-[#256f5b] bg-[#256f5b] text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
                )}
                type="button"
                onClick={() => setCategoryFilter(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {selectedDay ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#256f5b] px-3 py-1 text-xs font-medium text-white">
              {formatDayLabel(selectedDay)} · {filteredEntries.length} 条
            </span>
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              清除这天
            </button>
          </div>
        ) : null}

        {selectedDay && selectedDayEntries.length > 0 ? (
          <div className="border-y border-[#d6e8df] bg-[#f3f8f5] px-4 py-4 sm:rounded-lg sm:border">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-[#256f5b]">
                📖 当天日记
              </span>
              <span className="text-xs text-neutral-400">
                {formatDayLabel(selectedDay)}
              </span>
            </div>
            {dayDiaryLoading ? (
              <p className="text-sm leading-7 text-neutral-400">
                正在把这天串成一段日记…
              </p>
            ) : dayDiary ? (
              <p className="text-[15px] leading-7 text-neutral-800">{dayDiary}</p>
            ) : (
              <p className="text-sm leading-7 text-neutral-400">
                这天没什么好总结的。
              </p>
            )}
          </div>
        ) : null}

        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
            <p className="text-sm text-neutral-500">这里暂时还没有符合筛选的记录。</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEntries.map((entry) => {
              const calmAndLight =
                entry.emotion === "平静" && entry.emotion_intensity < 0.3;

              return (
                <Link
                  key={entry.id}
                  href={`/archive/${entry.id}`}
                  className="flex min-h-44 flex-col justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
                >
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b]">
                        {entry.category}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          calmAndLight
                            ? "bg-neutral-100 text-neutral-400"
                            : "bg-[#fff0bf] text-[#755c00]",
                        )}
                      >
                        {entry.emotion}
                      </span>
                    </div>
                    <p className="text-[15px] leading-6 text-neutral-950">
                      {entry.summary}
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {entry.people.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.people.map((person) => (
                          <span
                            key={person}
                            className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                          >
                            {person}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-neutral-400">
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <button
            type="button"
            onClick={() => setShowActivity((value) => !value)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-neutral-50"
          >
              <span className="text-sm font-medium">日历 · 活跃度</span>
            <span className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{safeEntries.length} 条 Entry</span>
              <span>{showActivity ? "收起 ▴" : "展开 ▾"}</span>
            </span>
          </button>

          {showActivity ? (
            <div className="border-t border-neutral-200 p-4">
              <div className="mb-3 flex items-center justify-end">
                <div className="flex rounded-full border border-neutral-200 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setActivityView("calendar")}
                    className={cn(
                      "rounded-full px-2.5 py-1 transition",
                      activityView === "calendar"
                        ? "bg-[#256f5b] text-white"
                        : "text-neutral-500",
                    )}
                  >
                    日历
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityView("heatmap")}
                    className={cn(
                      "rounded-full px-2.5 py-1 transition",
                      activityView === "heatmap"
                        ? "bg-[#256f5b] text-white"
                        : "text-neutral-500",
                    )}
                  >
                    热力图
                  </button>
                </div>
              </div>

              {activityView === "calendar" ? (
                <div className="mx-auto max-w-xs">
                  <MonthCalendar
                    entries={safeEntries}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                  />
                </div>
              ) : (
                <div className="grid grid-flow-col grid-rows-7 justify-start gap-1">
                  {heatmapDays.map((day) => (
                    <div
                      key={day.key}
                      title={`${day.key}: ${day.count} 条`}
                      className={cn("size-4 rounded-[3px]", heatmapColor(day.count))}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
