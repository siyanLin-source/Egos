export type MessageSender = "user" | "ai";

export type Message = {
  id: string;
  user_id: string;
  conversation_id: string;
  sender: MessageSender;
  content: string;
  image_url: string | null;
  created_at: string;
  archived_at?: string | null;
};

export type EntryEmotion = "开心" | "平静" | "低落" | "烦躁" | "焦虑" | "感动";

export type EntryCategory =
  | "人际关系"
  | "家人"
  | "美食"
  | "工作"
  | "健康"
  | "想法"
  | "地点"
  | "宠物"
  | "其他";

export type Entry = {
  id: string;
  user_id: string;
  summary: string;
  emotion: EntryEmotion;
  emotion_intensity: number;
  category: EntryCategory;
  people: string[];
  places: string[];
  keywords: string[];
  message_ids: string[];
  is_crisis: boolean;
  created_at: string;
  updated_at: string;
};

export type TopicType = "person" | "place" | "pet";

export type TopicFact = {
  text?: string;
  source_entry_id?: string;
  created_at?: string;
};

export type Topic = {
  id: string;
  user_id: string;
  type: TopicType;
  name: string;
  first_mentioned_at: string;
  last_mentioned_at: string;
  mention_count: number;
  facts: TopicFact[];
  created_at: string;
  updated_at: string;
};

export type ProfileFactKind =
  | "identity"
  | "relationship"
  | "pet"
  | "interest"
  | "preference"
  | "routine"
  | "goal"
  | "health"
  | "work"
  | "school"
  | "place"
  | "other";

export type ProfileFact = {
  id: string;
  user_id: string;
  kind: ProfileFactKind;
  subject: string;
  text: string;
  importance: number;
  pinned: boolean;
  source_entry_id: string | null;
  source_message_ids: string[];
  first_observed_at: string;
  last_observed_at: string;
  created_at: string;
  updated_at: string;
  // 可选：迁移 0008 起就有 fact_key；source 列由迁移 0013 补充（'extracted' | 'user_edit'）。
  // 大多数查询不选这两列，所以保持可选。
  fact_key?: string;
  source?: string;
};

export type ReminderStatus = "pending" | "done" | "dismissed";

export type ReminderSource = "chat" | "manual";

export type Reminder = {
  id: string;
  user_id: string;
  title: string;
  due_at: string;
  location: string | null;
  notes: string | null;
  status: ReminderStatus;
  source: ReminderSource;
  source_conversation_id: string | null;
  created_at: string;
  completed_at: string | null;
};
