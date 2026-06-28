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
};
