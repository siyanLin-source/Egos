import {
  buildBoundaryPrompt,
  buildExtractionPrompt,
  CATEGORIES,
  EMOTIONS,
} from "@/lib/archive/prompts";
import type { Entry, Message } from "@/lib/types";

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown }>;

type ArchiveSupabaseClient = {
  // Keep Supabase's deep generic query builder out of this module's public types.
  from: (table: "messages") => any;
  rpc: <T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ) => QueryResult<T>;
};

const IDLE_ARCHIVE_MS = Number(process.env.ARCHIVE_IDLE_MS ?? 5 * 60 * 1000);
const AI_TIMEOUT_MS = Number(process.env.ARCHIVE_AI_TIMEOUT_MS ?? 10_000);
const MAX_EVENT_MESSAGES = 30;
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
  created_at: string;
};

type RawExtractedEntry = Partial<Omit<ExtractedEntry, "created_at">>;

function normalizeList(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean).slice(0, 12)),
  );
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
        max_tokens: 1200,
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
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,content,image_url,created_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_EVENT_MESSAGES);

  if (error) {
    console.error("Could not load unarchived messages.", error);
    return [];
  }

  return (data ?? []) as Message[];
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

function parseBoundaryAction(text: string): BoundaryAction {
  const parsed = parseJsonObject(text);

  if (!isRecord(parsed)) {
    throw new Error("Boundary JSON was not an object.");
  }

  return parsed.action === "new_event" ? "new_event" : "continue";
}

function parseExtractionEntries(text: string): RawExtractedEntry[] {
  const parsed = parseJsonObject(text);

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
      people: asStringArray(entry.people),
      places: asStringArray(entry.places),
      pets: asStringArray(entry.pets),
      keywords: asStringArray(entry.keywords),
      message_ids: asStringArray(entry.message_ids),
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
      const extractedEntries = parseExtractionEntries(text)
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

          return {
            summary: entry.summary.trim(),
            emotion: entry.emotion,
            emotion_intensity: Math.max(0, Math.min(1, entry.emotion_intensity)),
            category: entry.category,
            people: normalizeList(entry.people ?? []),
            places: normalizeList(entry.places ?? []),
            pets: normalizeList(entry.pets ?? []),
            keywords: normalizeList(entry.keywords ?? []),
            message_ids: messageIds,
            created_at: new Date(getLatestMessageTime(entryMessages)).toISOString(),
          };
        })
        .filter((entry) => entry !== null);

      if (extractedEntries.length === 0) {
        console.error("Haiku extraction returned entries, but none referenced substantive user content.");
      }

      return extractedEntries;
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
    return null;
  }

  if (!hasSubstantiveUserContent(eventMessages)) {
    await markMessagesArchived({ supabase, userId, messages: eventMessages });
    return null;
  }

  const extraction = await extractEntryWithHaiku(eventMessages);

  if (!extraction || extraction.length === 0) {
    console.error("Skipping archive because extraction did not produce valid JSON.");
    return null;
  }

  const { data, error } = await supabase.rpc("commit_archive_entries", {
    p_user_id: userId,
    p_entries: extraction.map((entry: ExtractedEntry) => ({
      summary: entry.summary,
      emotion: entry.emotion,
      emotion_intensity: entry.emotion_intensity,
      category: entry.category,
      people: entry.people,
      places: entry.places,
      pets: entry.pets,
      keywords: entry.keywords,
      message_ids: entry.message_ids,
      created_at: entry.created_at,
    })),
  });

  if (error) {
    console.error("Could not commit archive entries transaction.", error);
    return null;
  }

  return (data ?? []) as Entry[];
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
  const unarchivedMessages = await getUnarchivedMessages(supabase, userId);
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
}: {
  supabase: ArchiveSupabaseClient;
  userId: string;
}) {
  const messages = await getUnarchivedMessages(supabase, userId);

  return archiveEvent({ supabase, userId, messages });
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
