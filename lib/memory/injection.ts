import type { SupabaseClient } from "@supabase/supabase-js";

import { containsCrisisSignal } from "@/lib/safety/crisis";
import type { ProfileFact, ProfileFactKind } from "@/lib/types";

type MemorySupabaseClient = Pick<SupabaseClient, "from">;

// L1 核心画像（MEMORY_ARCHITECTURE 第 2 节）：每次对话无条件注入的常驻记忆。
// v1 选择启发式：类别优先级 人物关系 > 身份/职业 > 长期偏好 > 其他，
// 同类内按更新时间倒序；显著性打分留给夜间巩固 sprint。
const CORE_PROFILE_MAX_FACTS = 20;
const CORE_PROFILE_MAX_CHARS = 600;
const CORE_PROFILE_FETCH_LIMIT = 80;

// fact_key 自迁移 0006 起就存在，选出来供「用户手动编辑的基本档案」识别称呼等字段。
const PROFILE_FACT_COLUMNS =
  "id,user_id,kind,subject,text,fact_key,importance,pinned,source_entry_id,source_message_ids,first_observed_at,last_observed_at,created_at,updated_at";

const KIND_PRIORITY: Record<ProfileFactKind, number> = {
  relationship: 0,
  pet: 1,
  identity: 1,
  work: 1,
  school: 1,
  interest: 2,
  preference: 2,
  routine: 2,
  goal: 2,
  health: 2,
  place: 3,
  other: 3,
};

// 输出分组：给对话模型看的是自然的中文小标题，不暴露内部字段名。
const PROFILE_GROUPS: Array<{ title: string; kinds: ProfileFactKind[] }> = [
  { title: "人和关系", kinds: ["relationship", "pet"] },
  { title: "身份与工作", kinds: ["identity", "work", "school"] },
  {
    title: "偏好与习惯",
    kinds: ["interest", "preference", "routine", "goal", "health"],
  },
  { title: "其他", kinds: ["place", "other"] },
];

const EMPTY_PROFILE_NOTE =
  "现在还没有沉淀出稳定的“关于这个人”。用户问你记不记得时，坦诚说还没记清，不要编。";

function compareCoreFacts(a: ProfileFact, b: ProfileFact) {
  // 用户手动置顶的「想记住的事」永远优先进画像。
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }

  const priorityA = KIND_PRIORITY[a.kind] ?? 3;
  const priorityB = KIND_PRIORITY[b.kind] ?? 3;

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  return (
    new Date(b.last_observed_at).getTime() -
    new Date(a.last_observed_at).getTime()
  );
}

function normalizeFactText(text: string) {
  return text.trim().replace(/[。.!！?？；;，,]+$/g, "");
}

function renderProfileSection(facts: ProfileFact[]) {
  const lines: string[] = ["# 关于这个人"];

  for (const group of PROFILE_GROUPS) {
    const groupFacts = facts.filter((fact) => group.kinds.includes(fact.kind));

    if (groupFacts.length === 0) {
      continue;
    }

    const sentences = groupFacts.map((fact) => normalizeFactText(fact.text));
    lines.push(`${group.title}：${sentences.join("；")}。`);
  }

  return lines.join("\n");
}

// 输出「# 关于这个人」小节：按类别分组、短句陈述；
// 不带内部字段名，不带置信度数字。空档案时给一段坦诚说明。
export function formatCoreProfile(facts: ProfileFact[]) {
  if (facts.length === 0) {
    return `# 关于这个人\n${EMPTY_PROFILE_NOTE}`;
  }

  return renderProfileSection(facts);
}

// 读取 profile_facts，选出 L1 画像。
// 总量硬约束：≤20 条，且格式化后 ≤600 字符，超限先砍低优先级类别。
export async function getCoreProfile({
  supabase,
  userId,
}: {
  supabase: MemorySupabaseClient;
  userId: string;
}): Promise<ProfileFact[]> {
  // 置顶的「想记住的事」单独取——它们可能很久没更新，
  // 只按 last_observed_at 截窗口会把老置顶静默挤掉。
  const [
    { data: pinnedData, error: pinnedError },
    { data: recentData, error: recentError },
  ] = await Promise.all([
    supabase
      .from("profile_facts")
      .select(PROFILE_FACT_COLUMNS)
      .eq("user_id", userId)
      .eq("pinned", true)
      .order("last_observed_at", { ascending: false })
      .limit(CORE_PROFILE_MAX_FACTS),
    supabase
      .from("profile_facts")
      .select(PROFILE_FACT_COLUMNS)
      .eq("user_id", userId)
      .order("last_observed_at", { ascending: false })
      .limit(CORE_PROFILE_FETCH_LIMIT),
  ]);

  if (pinnedError) {
    console.error("Could not load pinned profile facts.", pinnedError);
  }

  if (recentError) {
    console.error("Could not load profile facts for core profile.", recentError);
  }

  const merged = new Map<string, ProfileFact>();

  for (const fact of [
    ...((pinnedData ?? []) as ProfileFact[]),
    ...((recentData ?? []) as ProfileFact[]),
  ]) {
    if (!merged.has(fact.id)) {
      merged.set(fact.id, fact);
    }
  }

  const facts = Array.from(merged.values())
    .filter((fact) => fact.text.trim())
    .sort(compareCoreFacts);

  // 贪心装入：按优先级顺序加事实，超出条数或字符预算就停。
  // 因为已按优先级排序，被砍掉的一定是低优先级尾巴。
  const selected: ProfileFact[] = [];

  for (const fact of facts) {
    if (selected.length >= CORE_PROFILE_MAX_FACTS) {
      break;
    }

    const candidate = [...selected, fact];

    if (renderProfileSection(candidate).length > CORE_PROFILE_MAX_CHARS) {
      break;
    }

    selected.push(fact);
  }

  return selected;
}

// —— 开屏问候取材（治理规则 3.5：问候只从「稳定 + 中性/积极」事实取材）——

// 问候是冷启动语境，用户还没进入任何话题：敏感类别（健康）与
// 可能踩到痛处的字眼一律不进问候素材。对话内注入不受此限制。
const GREETING_EXCLUDED_KINDS: ProfileFactKind[] = ["health"];

const GREETING_NEGATIVE_MARKERS = [
  "分手",
  "离婚",
  "去世",
  "过世",
  "走了",
  "吵架",
  "冷战",
  "生病",
  "住院",
  "手术",
  "医院",
  "复诊",
  "体检",
  "化疗",
  "心理咨询",
  "吃药",
  "服药",
  "疼",
  "痛",
  "失业",
  "裁员",
  "被开除",
  "辞职",
  "离职",
  "欠",
  "债",
  "焦虑",
  "抑郁",
  "低落",
  "烦躁",
  "崩溃",
  "委屈",
  "生气",
  "讨厌",
  "心情差",
  "心情不好",
  "失眠",
  "难过",
  "伤心",
  "哭",
  "压力",
  "想死",
  "自杀",
  "自残",
  "绝望",
];

export function containsGreetingNegativeMarker(text: string) {
  const normalized = text.replace(/\s+/g, "");

  return GREETING_NEGATIVE_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

const NEGATIVE_EMOTIONS = new Set(["低落", "烦躁", "焦虑"]);

// 问候可用的画像事实：先走 L1 同一套优先级选择，再做问候侧过滤（双保险的
// 数据层）。任何带负面/敏感痕迹的事实绝不进问候 prompt。
// 除关键词黑名单外，还回查每条事实的来源事件：源条目是危机或负面情绪的，
// 衍生出的事实同样不进问候（用户手动编辑的事实没有源条目，不受影响）。
export async function getGreetingProfileFacts({
  supabase,
  userId,
  limit = 6,
}: {
  supabase: MemorySupabaseClient;
  userId: string;
  limit?: number;
}): Promise<ProfileFact[]> {
  const coreFacts = await getCoreProfile({ supabase, userId });

  let candidates = coreFacts
    .filter((fact) => !GREETING_EXCLUDED_KINDS.includes(fact.kind))
    .filter(
      (fact) =>
        !containsGreetingNegativeMarker(fact.text) &&
        !containsCrisisSignal(fact.text),
    );

  const sourceEntryIds = Array.from(
    new Set(
      candidates
        .map((fact) => fact.source_entry_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (sourceEntryIds.length > 0) {
    const { data, error } = await supabase
      .from("entries")
      .select("id,emotion,is_crisis")
      .in("id", sourceEntryIds);

    if (error) {
      // 查不动就保守处理：所有带源条目的事实都不进问候，宁缺勿错。
      console.error("Could not check source entries for greeting facts.", error);
      candidates = candidates.filter((fact) => !fact.source_entry_id);
    } else {
      const unsafeSourceIds = new Set(
        ((data ?? []) as Array<{
          id: string;
          emotion: string;
          is_crisis: boolean;
        }>)
          .filter((entry) => entry.is_crisis || NEGATIVE_EMOTIONS.has(entry.emotion))
          .map((entry) => entry.id),
      );

      candidates = candidates.filter(
        (fact) =>
          !fact.source_entry_id || !unsafeSourceIds.has(fact.source_entry_id),
      );
    }
  }

  return candidates.slice(0, limit);
}
