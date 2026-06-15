export type MessageSender = "user" | "ai";

export type Message = {
  id: string;
  user_id: string;
  sender: MessageSender;
  content: string;
  image_url: string | null;
  created_at: string;
};
