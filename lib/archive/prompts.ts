import type { Message } from "../types";

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
- summary 抓这条里真正重要的东西：核心事件 + 用户情绪。不要把路人、部门、流程、职位细节都堆进去。
- summary 不要推断用户没说的细节；用户只说"填表"，就写"填表"，不要脑补成"保险表格"、"报销流程"、"责任认定"。
- summary 要是温和的、像本人事后轻轻回顾的口吻，不要写成"用户……"这种第三人称报告腔。
  反例: 用户与母亲因拍视频吵架，用户感到绝望。
  正例: 和妈妈为拍视频的事吵了一架，她说的话挺伤人，那天很难熬。
- 例: "我姐和姐夫开我车出差，车被撞了，工程部向总还让我填表，烦死"
  summary 应是"车被撞了，还被要求填表，真的很烦。" people 可包含"姐姐"、"姐夫"、"向总"；不要写成公司结构报告，也不要脑补"保险表格"。
- 沉重的事如实记，但不要复述最尖锐的原话，例如不要写"想死"；传达"那天很痛苦/难熬"即可。
- is_crisis 用来标记急性自伤/危机语言。只有用户说出自伤、自杀、"想死"、"不想活"、"活不下去"、"绝望"这类急性危险语言时才为 true。
- 普通难过、失恋、吵架、压力大、烦躁、哭了，不等于 is_crisis；它们应该用 emotion="低落"/"烦躁"/"焦虑"，is_crisis=false。
- is_crisis=true 的 Entry 仍要输出，但 summary 必须软化，不要复述危险原话；profile_facts 必须返回 []。
- "完"、"就这样"、"先这样"、"没了"这类结束信号是触发归档的控制词，不是内容。
- summary 绝不能描述"结束/完成了这个话题"这类元动作，也不要把结束信号写进 summary。
- 只要有实质内容，哪怕很小，也要干净克制地记录内容本身。例如"想吃喜茶的小蛋糕"。
- 小事不要夸大、不拔高；有地点、人名、店名就自然带上。
- summary 必须是你用自己的话提炼出来的，绝不照抄用户原话、不复述每个细节流水；抓"这件事到底是什么"。
- 没有记忆价值的生活琐事/流水账直接跳过、不要生成 Entry：例如挪车/找车位、把东西从一处搬到另一处、"随便看看 / 在网上看看"、纯日常路过和操作。判断标准是"半年后回看还值不值得记一笔"。
- 同一件事不要拆成多条几乎一样的卡片：只有"分类明显不同"才拆（见上方狗/男朋友/蛋糕的例子）；同一分类、内容近似的合并成一条。
- 只有完全没信息量的纯填充/控制消息才跳过不归档，例如单独的"完"、"就这样"、"嗯"、"在吗"、"哈哈"。
- emotion 必须从: 开心/平静/低落/烦躁/焦虑/感动 中选一个。
- emotion_intensity 是 0.0-1.0。
- category 必须从: 人际关系/家人/美食/工作/健康/想法/地点/宠物/其他 中选一个。
- people、places、pets、keywords 没有就返回 []。
- people 只放人名、昵称或称呼，例如"建生"、"妈妈"、"男朋友"。
- people 要用用户实际叫法归一：如果同一句里有"向总"和"经理/领导"，只保留"向总"，不要同时输出"经理"；如果只有泛称才用泛称。
- 稳定抓人：妈妈、姐姐、姐夫、男朋友、Ena、向总这类都应进 people；但它们不等于 profile_facts。
- places 只放地点名。
- pets 只放明确提到的宠物名字或称呼，例如"团子"、"Voli"、"小猫咪"、"小狗"。
- 不要把宠物名混进 people；如果用户说"团子是猫"，团子是宠物，不是人。
- keywords 放对以后回忆有帮助的短词。
- profile_facts 是"关于用户的稳定事实/当前长期状态"，用于回答"你记得我是谁吗"。
- profile_facts 不是吸尘器。只收【用户明确在介绍自己的、持久的身份/生活事实】；一句话里顺带提到的人、职位、部门、同行者、办事流程，不进 profile_facts。
- profile_facts 只放以后认识用户有用的事实，不放一次性事件。每条 8-40 字，像"你叫 Liz"、"你有男朋友"、"你养了一只狗叫 Voli"、"你在健身"、"你在减肥"。
- 名字必须保留用户原文拼写、大小写和连写方式；用户说"Liz"，就输出"Liz"，不要改成"Li Z"、"liz"或其他变体。
- 一条 profile_fact 只表达一件事；禁止输出"你叫 Liz，有男朋友"这种复合 fact，必须拆成"你叫 Liz"和"你有男朋友"两条。
- profile_fact 必须平实、忠于用户原本的程度，不要夸张拔高。用户说"想把软件项目当成毕生的事业"，就写"你在做一个软件项目"或"你想把它当成毕生的事业"，绝不能写成"你投入了毕生的全部精力"这类话。
- 适合进 profile_facts: 名字/身份、重要关系、宠物、兴趣、偏好、长期目标、习惯、健康/健身状态、工作/学习、常去地点。
- 不适合进 profile_facts: "昨天看了电影"、"今天吃了烤串"、"和妈妈吵了一架"这类单次事件；它们留在 summary。
- 不适合进 profile_facts: "姐姐/姐夫/同事/经理/向总/工程部"这类在事件里顺带出现的人和组织信息。它们可以进 people 或 topics，但不要当成"关于用户"。
- 判断 profile_facts 时问自己：朋友以后会拿这条来认识这个人吗？如果只是这次事件的配角或背景，就不要记成 profile_fact。
- kind 必须从: identity/relationship/pet/interest/preference/routine/goal/health/work/school/place/other 中选一个。
- subject 写事实主语，默认"你"；如果事实主语是宠物/人物，也可以写"Voli"、"妈妈"。
- importance 是 0.0-1.0；按"对认识这个人有多重要"给，不按提及次数给。名字/长期伴侣/宠物 0.8-1.0；长期习惯/目标/工作学习 0.6-0.8；轻微偏好 0.3-0.5；顺嘴一提不要输出。

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
      "is_crisis": false,
      "people": [],
      "places": [],
      "pets": ["提到的宠物名字，如'团子'，没有就 []"],
      "keywords": [],
      "message_ids": ["相关消息ID"],
      "profile_facts": [
        {
          "text": "关于用户的稳定事实；没有稳定事实就返回 []",
          "kind": "identity/relationship/pet/interest/preference/routine/goal/health/work/school/place/other",
          "subject": "你",
          "importance": 0.8
        }
      ]
    }
  ]
}`;
}
