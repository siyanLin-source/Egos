export type MessageSender = "user" | "ai";

export type Message = {
  id: string;
  user_id: string;
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
  created_at: string;
  updated_at: string;
};

export type TopicType = "person" | "place" | "pet";
