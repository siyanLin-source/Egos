import type { SupabaseClient } from "@supabase/supabase-js";

import { proxyFetch } from "@/lib/ai/proxy-fetch";
import {
  buildBoundaryPrompt,
  buildExtractionPrompt,
} from "@/lib/archive/prompts";
import {
  CATEGORIES,
  EMOTIONS,
  PROFILE_FACT_KINDS,
} from "@/lib/archive/taxonomy";
import {
  normalizeProfileFacts,
  type NormalizedProfileFact,
  type RawProfileFact,
} from "@/lib/archive/profile-facts";
import type { Entry, Message } from "@/lib/types";

type ArchiveSupabaseClient = Pick<SupabaseClient, "from" | "rpc">;

const IDLE_ARCHIVE_MS = Number(process.env.ARCHIVE_IDLE_MS ?? 5 * 60 * 1000);
const AI_TIMEOUT_MS = Number(process.env.ARCHIVE_AI_TIMEOUT_MS ?? 20_000);
const MAX_EVENT_MESSAGES = 30;
const MAX_DRAIN_ARCHIVE_BATCHES = 8;
const MAX_DRAIN_STALL_RETRIES = 2;
const IDLE_USER_BATCH_SIZE = 50;
const EXPLICIT_END_SIGNALS = [
  "完",
  "完了",
  "就这样",
  "先这样",
  "没了",
  "说完了",
  "讲完了",
  "到这",
  "到这里",
];
const CONTROL_OR_FILLER_MESSAGES = [
  ...EXPLICIT_END_SIGNALS,
  "嗯",
  "嗯嗯",
  "在吗",
  "哈哈",
  "哈哈哈",
  "好",
  "好的",
  "ok",
  "OK",
];

type BoundaryAction = "continue" | "new_event";

type ExtractedProfileFact = NormalizedProfileFact;

type ExtractedEntry = {
  summary: string;
  emotion: (typeof EMOTIONS)[number];
  emotion_intensity: number;
  category: (typeof CATEGORIES)[number];
  people: string[];
  places: string[];
  pets: string[];
  keywords: string[];
  message_ids: string[];
  is_crisis: boolean;
  profile_facts: ExtractedProfileFact[];
  created_at: string;
};

type RawExtractedEntry = Partial<Omit<ExtractedEntry, "created_at">>;

function normalizeList(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean).slice(0, 12)),
  );
}

const PERSON_ALIASES: Record<string, string> = {
  妈: "妈妈",
  母亲: "妈妈",
  男友: "男朋友",
  女友: "女朋友",
};

const GENERIC_PERSON_ROLES = new Set([
  "经理",
  "主管",
  "领导",
  "老板",
  "上司",
]);

function cleanEntityName(value: string) {
  return value
    .trim()
    .replace(/^[""'']+|[""'']+$/g, "")
    .replace(/[，,。.!！?？；;：:、]+$/g, "")
    .trim();
}

function findActualCalledName(sourceText: string) {
  return (
    sourceText.match(/[\p{Script=Han}A-Za-z0-9]{1,8}总/u)?.[0] ??
    sourceText.match(/[\p{Script=Han}A-Za-z0-9]{1,12}(?:老师|师傅)/u)?.[0] ??
    null
  );
}

function normalizePersonList(values: string[], sourceTexts: string[]) {
  const sourceText = sourceTexts.join("\n");

  return Array.from(
    new Set(
      values
        .map((value) => {
          const name = cleanEntityName(value);

          if (!name) {
            return "";
          }

          if (GENERIC_PERSON_ROLES.has(name)) {
            return findActualCalledName(sourceText) ?? name;
          }

          return PERSON_ALIASES[name] ?? name;
        })
        .filter(Boolean)
        .slice(0, 12),
    ),
  );
}

// 急性痛苦/自伤语言。prompt 会先判断，这里在代码层再兜底一次。
// 命中的 Entry 只做内部标记，不生成可浏览卡片、topics 或 profile facts。
const ACUTE_DISTRESS_MARKERS = [
  "想死",
  "不想活",
  "活不下去",
  "自杀",
  "自尽",
  "轻生",
  "了结自己",
  "结束生命",
  "去死",
  "自残",
  "自伤",
  "割腕",
  "跳楼",
  "绝望",
];

function containsAcuteDistress(text: string) {
  const normalized = text.replace(/\s+/g, "");
  return ACUTE_DISTRESS_MARKERS.some((marker) => normalized.includes(marker));
}

function buildEntrySourceText(messages: Message[]) {
  return messages
    .filter((message) => message.sender === "user")
    .map((message) => message.content)
    .join("\n");
}

function sanitizeCrisisSummary() {
  return "这段内容被标记为急性痛苦内容。";
}

function messageOverlapRatio(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const setA = new Set(a);
  const shared = b.filter((id) => setA.has(id)).length;

  return shared / Math.min(a.length, b.length);
}

function isExplicitEndSignal(content: string) {
  const text = content.trim();

  return EXPLICIT_END_SIGNALS.some((signal) => {
    return text === signal || text.endsWith(signal);
  });
}

function normalizeControlText(content: string) {
  return content
    .trim()
    .replace(/\s+/g, "")
    .replace(/[。.!！?？~～…]+$/g, "");
}

function isControlOrFillerMessage(content: string) {
  const text = normalizeControlText(content);

  return CONTROL_OR_FILLER_MESSAGES.includes(text);
}

function hasSubstantiveUserContent(messages: Message[]) {
  return messages.some((message) => {
    return (
      message.sender === "user" && !isControlOrFillerMessage(message.content)
    );
  });
}

function getLatestMessageTime(messages: Message[]) {
  return Math.max(
    ...messages.map((message) => new Date(message.created_at).getTime()),
  );
}

function inferFallbackCategory(text: string): ExtractedEntry["category"] {
  if (/吃|喝|海鲜|饭|菜|火锅|烤串|奶茶|咖啡|餐厅|店/.test(text)) {
    return "美食";
  }

  if (/健身|减肥|运动|身体|睡|病|疼|医院/.test(text)) {
    return "健康";
  }

  if (/妈妈|母亲|爸爸|父亲|姐姐|姐夫|家人|男朋友|女朋友|朋友/.test(text)) {
    return "人际关系";
  }

  if (/工作|项目|软件|公司|老板|同事|客户/.test(text)) {
    return "工作";
  }

  return "其他";
}

function inferFallbackKeywords(text: string) {
  const keywords = [
    "辣炒海鲜",
    "海鲜",
    "火锅",
    "烤串",
    "奶茶",
    "咖啡",
    "健身",
    "减肥",
    "软件项目",
  ];

  return keywords.filter((keyword) => text.includes(keyword)).slice(0, 5);
}

function buildFallbackSummary(userMessages: Message[]) {
  const content = userMessages
    .slice(-3)
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("；");
  const compact = content.replace(/\s+/g, " ").slice(0, 110);

  return compact || "聊到了一件刚发生的小事。";
}

async function commitFallbackEntry({
  supabase,
  userId,
  messages,
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
  messages: Message[];
}) {
  const eventMessages = messages
    .filter((message) => message.user_id === userId)
    .slice(0, MAX_EVENT_MESSAGES);
  const userMessages = eventMessages.filter(
    (message) => message.sender === "user" && !isControlOrFillerMessage(message.content),
  );

  if (userMessages.length === 0) {
    await markMessagesArchived({ supabase, userId, messages: eventMessages });
    return [];
  }

  const combinedUserText = userMessages.map((message) => message.content).join("\n");
  const messageIds = eventMessages.map((message) => message.id);
  const latestTime = new Date(getLatestMessageTime(eventMessages)).toISOString();

  if (containsAcuteDistress(combinedUserText)) {
    const { data, error } = await supabase
      .from("entries")
      .insert({
        user_id: userId,
        summary: sanitizeCrisisSummary(),
        emotion: "低落",
        emotion_intensity: 1,
        category: "想法",
        people: [],
        places: [],
        keywords: [],
        message_ids: messageIds,
        is_crisis: true,
        created_at: latestTime,
      })
      .select(
        "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
      )
      .single();

    await markMessagesArchived({ supabase, userId, messages: eventMessages });
    console.warn("Archived fallback entry as crisis-only internal record.");

    if (error || !data) {
      console.error("Could not commit fallback crisis archive entry.", error);
      return [];
    }

    return [data as Entry];
  }

  const summary = buildFallbackSummary(userMessages);
  const { data, error } = await supabase
    .from("entries")
    .insert({
      user_id: userId,
      summary,
      emotion: "平静",
      emotion_intensity: 0.3,
      category: inferFallbackCategory(combinedUserText),
      people: [],
      places: [],
      keywords: inferFallbackKeywords(combinedUserText),
      message_ids: messageIds,
      is_crisis: false,
      created_at: latestTime,
    })
    .select(
      "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
    )
    .single();

  if (error || !data) {
    console.error("Could not commit fallback archive entry.", error);
    return null;
  }

  await markMessagesArchived({ supabase, userId, messages: eventMessages });

  return [data as Entry];
}

async function createHaikuTextMessage({
  prompt,
  temperature = 0,
}: {
  prompt: string;
  temperature?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await proxyFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      },
      body: JSON.stringify({
        model:
          process.env.ANTHROPIC_EXTRACTION_MODEL ??
          "claude-haiku-4-5-20251001",
        max_tokens: 1800,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content
      ?.map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();

    if (!text) {
      throw new Error("Anthropic response did not include text content.");
    }

    return text;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Anthropic request timed out after ${AI_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getUnarchivedMessages(
  supabase: ArchiveSupabaseClient,
  userId: string,
  conversationId?: string,
) {
  let query = supabase
    .from("messages")
    .select("id,user_id,conversation_id,sender,content,image_url,created_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_EVENT_MESSAGES);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Could not load unarchived messages.", error);
    return [];
  }

  return (data ?? []) as Message[];
}

function getMessageIdSignature(messages: Message[]) {
  return messages.map((message) => message.id).join(",");
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("Anthropic response was not JSON.");
    }

    return JSON.parse(match[0]) as unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isEmotion(value: unknown): value is ExtractedEntry["emotion"] {
  return typeof value === "string" && EMOTIONS.includes(value as never);
}

function isCategory(value: unknown): value is ExtractedEntry["category"] {
  return typeof value === "string" && CATEGORIES.includes(value as never);
}

function isProfileFactKind(value: unknown): value is RawProfileFact["kind"] {
  return (
    typeof value === "string" && PROFILE_FACT_KINDS.includes(value as never)
  );
}

function parseProfileFacts(value: unknown, sourceTexts: string[]) {
  if (!Array.isArray(value)) {
    return [];
  }

  const facts: RawProfileFact[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const text = typeof item.text === "string" ? item.text.trim() : "";

    if (!text) {
      continue;
    }

    const kind = isProfileFactKind(item.kind) ? item.kind : "other";
    facts.push({
      text: text.slice(0, 160),
      kind,
      subject:
        typeof item.subject === "string" && item.subject.trim()
          ? item.subject.trim().slice(0, 100)
          : "你",
      importance:
        typeof item.importance === "number"
          ? Math.max(0, Math.min(1, item.importance))
          : 0.5,
    });
  }

  return normalizeProfileFacts(facts, sourceTexts);
}

function parseBoundaryAction(text: string): BoundaryAction {
  const parsed = parseJsonObject(text);

  if (!isRecord(parsed)) {
    throw new Error("Boundary JSON was not an object.");
  }

  return parsed.action === "new_event" ? "new_event" : "continue";
}

function parseExtractionEntries(
  text: string,
  sourceMessages: Message[],
): RawExtractedEntry[] {
  const parsed = parseJsonObject(text);
  const sourceTexts = sourceMessages
    .filter((message) => message.sender === "user")
    .map((message) => message.content);

  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Extraction JSON did not include entries array.");
  }

  return parsed.entries
    .filter(isRecord)
    .map((entry) => ({
      summary: typeof entry.summary === "string" ? entry.summary : "",
      emotion: isEmotion(entry.emotion) ? entry.emotion : undefined,
      emotion_intensity:
        typeof entry.emotion_intensity === "number"
          ? entry.emotion_intensity
          : undefined,
      category: isCategory(entry.category) ? entry.category : undefined,
      people: normalizePersonList(asStringArray(entry.people), sourceTexts),
      places: asStringArray(entry.places),
      pets: asStringArray(entry.pets),
      keywords: asStringArray(entry.keywords),
      message_ids: asStringArray(entry.message_ids),
      // 只按 summary（卡片文字）判定危机：温和措辞的难过事正常保留，
      // 只有卡片里直接出现"想死/绝望"这类原话才隐藏。不再因聊天原文里出现过就整件隐藏。
      is_crisis: containsAcuteDistress(
        typeof entry.summary === "string" ? entry.summary : "",
      ),
      profile_facts: parseProfileFacts(entry.profile_facts, sourceTexts),
    }));
}

async function decideBoundaryWithHaiku({
  previousMessages,
  newUserMessage,
}: {
  previousMessages: Message[];
  newUserMessage: Message;
}) {
  if (previousMessages.length === 0) {
    return "continue" as const;
  }

  try {
    const text = await createHaikuTextMessage({
      prompt: buildBoundaryPrompt({ previousMessages, newUserMessage }),
      temperature: 0,
    });

    return parseBoundaryAction(text);
  } catch (error) {
    console.error("Haiku boundary detection failed; keeping current event open.", error);
    return "continue" as const;
  }
}

async function extractEntryWithHaiku(messages: Message[]) {
  const messageById = new Map(messages.map((message) => [message.id, message]));

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await createHaikuTextMessage({
        prompt: buildExtractionPrompt(messages),
        temperature: 0,
      });
      const extractedEntries = parseExtractionEntries(text, messages)
        .map((entry) => {
          if (
            !entry.summary ||
            !entry.emotion ||
            typeof entry.emotion_intensity !== "number" ||
            !entry.category
          ) {
            return null;
          }

          const messageIds = Array.from(
            new Set(
              (entry.message_ids ?? []).filter((messageId) =>
                messageById.has(messageId),
              ),
            ),
          );
          const entryMessages = messageIds
            .map((messageId) => messageById.get(messageId))
            .filter((message): message is Message => Boolean(message));

          if (!hasSubstantiveUserContent(entryMessages)) {
            return null;
          }

          const sourceText = buildEntrySourceText(entryMessages);
          const isCrisis =
            entry.is_crisis === true ||
            containsAcuteDistress(entry.summary) ||
            containsAcuteDistress(sourceText);

          return {
            summary: isCrisis ? sanitizeCrisisSummary() : entry.summary.trim(),
            emotion: entry.emotion,
            emotion_intensity: Math.max(0, Math.min(1, entry.emotion_intensity)),
            category: entry.category,
            people: isCrisis ? [] : normalizeList(entry.people ?? []),
            places: isCrisis ? [] : normalizeList(entry.places ?? []),
            pets: isCrisis ? [] : normalizeList(entry.pets ?? []),
            keywords: isCrisis ? [] : normalizeList(entry.keywords ?? []),
            message_ids: messageIds,
            is_crisis: isCrisis,
            profile_facts: isCrisis ? [] : (entry.profile_facts ?? []),
            created_at: new Date(getLatestMessageTime(entryMessages)).toISOString(),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      // 模型偶尔把同一个单一话题拆成几乎一样的多条 Entry（重复卡片）。
      // 同分类且消息高度重叠的合并成一条，保留更完整的 summary。
      const dedupedEntries: typeof extractedEntries = [];

      for (const entry of extractedEntries) {
        const duplicate = dedupedEntries.find(
          (kept) =>
            kept.category === entry.category &&
            messageOverlapRatio(kept.message_ids, entry.message_ids) >= 0.5,
        );

        if (duplicate) {
          if (entry.is_crisis) {
            duplicate.is_crisis = true;
            duplicate.summary = sanitizeCrisisSummary();
            duplicate.people = [];
            duplicate.places = [];
            duplicate.pets = [];
            duplicate.keywords = [];
            duplicate.profile_facts = [];
          } else if (!duplicate.is_crisis && entry.summary.length > duplicate.summary.length) {
            duplicate.summary = entry.summary;
          }
          continue;
        }

        dedupedEntries.push(entry);
      }

      if (dedupedEntries.length === 0) {
        console.error("Haiku extraction returned entries, but none referenced substantive user content.");
      }

      return dedupedEntries;
    } catch (error) {
      console.error(`Haiku entry extraction failed on attempt ${attempt}.`, error);
    }
  }

  return null;
}

async function markMessagesArchived({
  supabase,
  userId,
  messages,
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
  messages: Message[];
}) {
  const messageIds = messages
    .filter((message) => message.user_id === userId)
    .map((message) => message.id);

  if (messageIds.length === 0) {
    return;
  }

  const { error } = await supabase.rpc("mark_messages_archived", {
    p_user_id: userId,
    p_message_ids: messageIds,
  });

  if (error) {
    console.error("Could not mark non-substantive messages archived.", error);
  }
}

export async function archiveEvent({
  supabase,
  userId,
  messages,
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
  messages: Message[];
}) {
  const eventMessages = messages
    .filter((message) => message.user_id === userId)
    .slice(0, MAX_EVENT_MESSAGES);

  if (!eventMessages.some((message) => message.sender === "user")) {
    await markMessagesArchived({ supabase, userId, messages: eventMessages });
    return [];
  }

  if (!hasSubstantiveUserContent(eventMessages)) {
    await markMessagesArchived({ supabase, userId, messages: eventMessages });
    return null;
  }

  const extraction = await extractEntryWithHaiku(eventMessages);

  if (!extraction || extraction.length === 0) {
    console.error("Skipping archive because extraction did not produce valid JSON.");
    return commitFallbackEntry({ supabase, userId, messages: eventMessages });
  }

  const { data, error } = await supabase.rpc("commit_archive_entries", {
    p_user_id: userId,
    p_entries: extraction.map((entry: ExtractedEntry) => ({
      summary: entry.is_crisis ? sanitizeCrisisSummary() : entry.summary,
      emotion: entry.emotion,
      emotion_intensity: entry.emotion_intensity,
      category: entry.category,
      people: entry.is_crisis ? [] : entry.people,
      places: entry.is_crisis ? [] : entry.places,
      pets: entry.is_crisis ? [] : entry.pets,
      keywords: entry.is_crisis ? [] : entry.keywords,
      message_ids: entry.message_ids,
      is_crisis: entry.is_crisis,
      profile_facts: entry.is_crisis ? [] : entry.profile_facts,
      created_at: entry.created_at,
    })),
  });

  if (error) {
    console.error("Could not commit archive entries transaction.", error);
    return commitFallbackEntry({ supabase, userId, messages: eventMessages });
  }

  const committed = (data ?? []) as Entry[];

  if (committed.length === 0) {
    console.warn("Archive RPC returned no entries; using fallback entry.");
    return commitFallbackEntry({ supabase, userId, messages: eventMessages });
  }

  return committed;
}

export async function processArchiveAfterTurn({
  supabase,
  userId,
  userMessage,
  assistantMessage,
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
  userMessage: Message;
  assistantMessage: Message;
}) {
  const unarchivedMessages = await getUnarchivedMessages(
    supabase,
    userId,
    userMessage.conversation_id,
  );
  const currentTurnIds = new Set([userMessage.id, assistantMessage.id]);
  const previousMessages = unarchivedMessages.filter(
    (message) => !currentTurnIds.has(message.id),
  );

  if (isExplicitEndSignal(userMessage.content)) {
    await archiveEvent({ supabase, userId, messages: unarchivedMessages });
    return;
  }

  if (unarchivedMessages.length >= MAX_EVENT_MESSAGES) {
    await archiveEvent({ supabase, userId, messages: unarchivedMessages });
    return;
  }

  const action = await decideBoundaryWithHaiku({
    previousMessages,
    newUserMessage: userMessage,
  });

  if (action === "new_event" && previousMessages.length > 0) {
    await archiveEvent({ supabase, userId, messages: previousMessages });
  }
}

export async function processArchiveNowForUser({
  supabase,
  userId,
  conversationId,
  drain = false,
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
  conversationId?: string;
  drain?: boolean;
}) {
  if (!drain) {
    const messages = await getUnarchivedMessages(supabase, userId, conversationId);

    return archiveEvent({ supabase, userId, messages });
  }

  const committed: Entry[] = [];

  for (let batch = 0; batch < MAX_DRAIN_ARCHIVE_BATCHES; batch += 1) {
    const messages = await getUnarchivedMessages(supabase, userId, conversationId);

    if (messages.length === 0) {
      return committed;
    }

    const before = getMessageIdSignature(messages);
    const entries = await archiveEvent({ supabase, userId, messages });

    if (entries) {
      committed.push(...entries);
    }

    let remaining = await getUnarchivedMessages(
      supabase,
      userId,
      conversationId,
    );

    if (remaining.length === 0) {
      return committed;
    }

    let remainingSignature = getMessageIdSignature(remaining);
    let retry = 0;

    while (remainingSignature === before && retry < MAX_DRAIN_STALL_RETRIES) {
      retry += 1;
      await new Promise((resolve) => setTimeout(resolve, retry * 500));

      const retryEntries = await archiveEvent({ supabase, userId, messages });

      if (retryEntries) {
        committed.push(...retryEntries);
      }

      remaining = await getUnarchivedMessages(supabase, userId, conversationId);

      if (remaining.length === 0) {
        return committed;
      }

      remainingSignature = getMessageIdSignature(remaining);
    }

    if (remainingSignature === before) {
      throw new Error(
        "Archive did not make progress; keeping current conversation active.",
      );
    }
  }

  throw new Error("Archive drain reached the batch limit.");
}

export async function processIdleArchives({
  supabase,
}: {
  supabase: ArchiveSupabaseClient;
}) {
  const idleBefore = new Date(Date.now() - IDLE_ARCHIVE_MS).toISOString();
  const { data, error } = await supabase.rpc("list_idle_archive_users", {
    p_idle_before: idleBefore,
    p_limit: IDLE_USER_BATCH_SIZE,
  });

  if (error) {
    console.error("Could not list idle archive users.", error);
    return { attempted: 0, archived: 0 };
  }

  let archived = 0;
  const users = (data ?? []) as { user_id: string }[];

  for (const user of users) {
    const messages = await getUnarchivedMessages(supabase, user.user_id);
    const entries = await archiveEvent({
      supabase,
      userId: user.user_id,
      messages,
    });

    if (entries) {
      archived += entries.length;
    }
  }

  return { attempted: users.length, archived };
}
