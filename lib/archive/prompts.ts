import type { Message } from "@/lib/types";

export const EMOTIONS = ["开心", "平静", "低落", "烦躁", "焦虑", "感动"] as const;

export const CATEGORIES = [
  "人际关系",
  "家人",
  "美食",
  "工作",
  "健康",
  "想法",
  "地点",
  "宠物",
  "其他",
] as const;

export function formatTranscript(messages: Message[]) {
  return messages
    .map((message) => {
      const role = message.sender === "user" ? "用户" : "AI";
      return `[${message.id}] ${role}: ${message.content}`;
    })
    .join("\n");
}

export function buildBoundaryPrompt({
  previousMessages,
  newUserMessage,
}: {
  previousMessages: Message[];
  newUserMessage: Message;
}) {
  return `你在帮一个聊天应用做"事件边界检测"。

判断新用户消息是上一件事的延续，还是明显开启了另一件事。

只输出 JSON，不要 Markdown。

可选 action:
- "continue": 新消息仍在聊同一件事
- "new_event": 新消息明显开始另一件事，应先归档旧事件

上一件事的消息:
${formatTranscript(previousMessages)}

新用户消息:
[${newUserMessage.id}] 用户: ${newUserMessage.content}

输出格式:
{"action":"continue"或"new_event","reason":"一句很短的原因"}`;
}

export function buildExtractionPrompt(messages: Message[]) {
  return `你在帮一个聊天应用做"事件级归档"。请把下面这一整个事件窗口总结成一组结构化 Entry。

规则:
- 只基于用户实际说过的内容，不要编造。
- AI 消息只能辅助理解上下文，summary 不要把 AI 的建议当成用户事实。
- 一个事件窗口里如果包含明显不同的话题，尤其是分类不同的话题，要拆成多条 Entry，各自归类，不要硬塞进一张卡片。
- 判断依据是话题/分类是否不同，不是消息条数；同一条消息里出现多个明显不同话题，也可以拆成多条 Entry，并让这些 Entry 回链同一个相关 message_id。
- 例: "我有只狗叫Voli / 我从美国带回来的 / 还有男朋友 / 想吃喜茶的小蛋糕"
  应拆成三条: 宠物(Voli)、人际关系或想法(男朋友)、美食(喜茶小蛋糕)，而不是一条宠物卡。
- 每条 Entry 的 message_ids 只放支撑这条 Entry 的相关消息 ID；如果同一条消息支撑多个话题，可以重复出现在多条 Entry 的 message_ids 里。
- summary 用中文，1-2 句，20-50 字。
- summary 要是温和的、像本人事后轻轻回顾的口吻，不要写成"用户……"这种第三人称报告腔。
  反例: 用户与母亲因拍视频吵架，用户感到绝望。
  正例: 和妈妈为拍视频的事吵了一架，她说的话挺伤人，那天很难熬。
- 沉重的事如实记，但不要复述最尖锐的原话，例如不要写"想死"；传达"那天很痛苦/难熬"即可。
- "完"、"就这样"、"先这样"、"没了"这类结束信号是触发归档的控制词，不是内容。
- summary 绝不能描述"结束/完成了这个话题"这类元动作，也不要把结束信号写进 summary。
- 只要有实质内容，哪怕很小，也要干净克制地记录内容本身。例如"想吃喜茶的小蛋糕"。
- 小事不要夸大、不拔高；有地点、人名、店名就自然带上。
- 只有完全没信息量的纯填充/控制消息才跳过不归档，例如单独的"完"、"就这样"、"嗯"、"在吗"、"哈哈"。
- emotion 必须从: 开心/平静/低落/烦躁/焦虑/感动 中选一个。
- emotion_intensity 是 0.0-1.0。
- category 必须从: 人际关系/家人/美食/工作/健康/想法/地点/宠物/其他 中选一个。
- people、places、pets、keywords 没有就返回 []。
- people 只放人名、昵称或称呼，例如"建生"、"妈妈"、"男朋友"。
- places 只放地点名。
- pets 只放明确提到的宠物名字或称呼，例如"团子"、"Voli"、"小猫咪"、"小狗"。
- 不要把宠物名混进 people；如果用户说"团子是猫"，团子是宠物，不是人。
- keywords 放对以后回忆有帮助的短词。

事件消息:
${formatTranscript(messages)}

只输出有效 JSON:
{
  "entries": [
    {
      "summary": "1-2 句概括，20-50 字",
      "emotion": "开心/平静/低落/烦躁/焦虑/感动",
      "emotion_intensity": 0.0,
      "category": "人际关系/家人/美食/工作/健康/想法/地点/宠物/其他",
      "people": [],
      "places": [],
      "pets": ["提到的宠物名字，如'团子'，没有就 []"],
      "keywords": [],
      "message_ids": ["相关消息ID"]
    }
  ]
}`;
}
