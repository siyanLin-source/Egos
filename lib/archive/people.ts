import type { Entry, ProfileFact, Topic } from "@/lib/types";

// 别名归一：把"母亲/我妈/妈"都当"妈妈"，"boyfriend"当"男朋友"。
// 这里是唯一的归一入口（archive 内联视图和 /people 页面共用），避免两套逻辑。
export function canonicalPersonName(
  name: string,
  profileFacts: ProfileFact[],
): string | null {
  const cleaned = name.trim();
  const lower = cleaned.toLowerCase();

  if (!cleaned) {
    return null;
  }

  if (lower === "boyfriend") {
    return "男朋友";
  }

  if (lower === "girlfriend") {
    return "女朋友";
  }

  if (["母亲", "我妈", "妈", "老妈"].includes(cleaned)) {
    return "妈妈";
  }

  if (["父亲", "我爸", "爸", "老爸"].includes(cleaned)) {
    return "爸爸";
  }

  // 泛指的部门/职务不是具体的人，不进人物列表。
  if (/工程部|财务部|部门|公司/.test(cleaned)) {
    return null;
  }

  // 已知是宠物名的，不当人。
  if (profileFacts.some((fact) => fact.kind === "pet" && fact.text.includes(cleaned))) {
    return null;
  }

  return cleaned;
}

export type PersonType = "person" | "pet" | "place";

export type PersonRecord = {
  entryId: string | null;
  text: string;
  category: string | null;
  created_at: string;
};

export type PersonView = {
  key: string;
  name: string;
  type: PersonType;
  count: number;
  lastAt: string;
  records: PersonRecord[];
};

// 从"可见 Entry"派生人物/地点（计数=可见记录数，永远对得上）；宠物从 topics 取
//（entries 没有 pets 列）。传进来的 entries 应已过滤掉 is_crisis。
export function buildPeople(
  entries: Entry[],
  petTopics: Topic[],
  profileFacts: ProfileFact[],
): PersonView[] {
  const map = new Map<string, PersonView>();

  function add(name: string, type: PersonType, record: PersonRecord) {
    const key = `${type}:${name}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        key,
        name,
        type,
        count: 1,
        lastAt: record.created_at,
        records: [record],
      });
      return;
    }

    const duplicate =
      record.entryId !== null &&
      existing.records.some((item) => item.entryId === record.entryId);

    if (!duplicate) {
      existing.records.push(record);
    }
    if (record.created_at > existing.lastAt) {
      existing.lastAt = record.created_at;
    }
  }

  for (const entry of entries) {
    const seenPeople = new Set<string>();
    for (const raw of entry.people) {
      const name = canonicalPersonName(raw, profileFacts);
      if (!name || seenPeople.has(name)) {
        continue;
      }
      seenPeople.add(name);
      add(name, "person", {
        entryId: entry.id,
        text: entry.summary,
        category: entry.category,
        created_at: entry.created_at,
      });
    }

    const seenPlaces = new Set<string>();
    for (const raw of entry.places) {
      const name = raw.trim();
      if (!name || seenPlaces.has(name)) {
        continue;
      }
      seenPlaces.add(name);
      add(name, "place", {
        entryId: entry.id,
        text: entry.summary,
        category: entry.category,
        created_at: entry.created_at,
      });
    }
  }

  for (const topic of petTopics) {
    const name = topic.name.trim();
    if (!name) {
      continue;
    }
    for (const fact of topic.facts ?? []) {
      if (!fact.text) {
        continue;
      }
      add(name, "pet", {
        entryId: fact.source_entry_id ?? null,
        text: fact.text,
        category: null,
        created_at: fact.created_at ?? topic.last_mentioned_at,
      });
    }
  }

  return Array.from(map.values())
    .map((view) => ({
      ...view,
      records: [...view.records].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
      count: view.records.length,
    }))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}
