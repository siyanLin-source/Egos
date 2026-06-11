# PROJECT.md — 你和你 (Ego)

## 这是什么
一个像最好的朋友一样懂你、记得你说过的每一件事的 AI;用户和它说过的所有话,
会慢慢长成一本关于自己的书。前台是温暖的对话(你和你),后台是结构化档案(Ego)。
用户从不"写日记"——只是在和朋友聊天,记录是聊天的副产品。

## 技术栈(定稿,不要更换)
Next.js 15 + TypeScript + Tailwind + shadcn/ui
Supabase(Postgres + pgvector + Auth + Storage,RLS 全程开启)
Claude API(对话用 Sonnet,后台抽取用 Haiku)
OpenAI text-embedding-3-small(向量)
Vercel AI SDK(流式输出)/ 部署 Vercel
形态:Web App / PWA 优先

## 数据模型(四实体)
- Message:原始消息,不可变(id, user_id, sender, content, image_url?, created_at)
- Entry:AI 抽取的结构化记录(summary, emotion, category, people[], places[],
  keywords[], embedding, message_ids[] 必须回链原始消息)
- Topic:实体卡(人/地点/宠物),facts[] 每条必须带 source_message_id
- Highlight:周期总结(week/month/year)

emotion 固定枚举:开心/平静/低落/烦躁/焦虑/感动
category 固定枚举:人际关系/家人/美食/工作/健康/想法/地点/宠物/其他

## AI 人格(系统 prompt 必须体现)
最好的朋友——不是心理咨询师、不是客服、不是高僧。
温柔不端着(像发微信,多口语:嗯、欸、哈哈、啊这);真好奇会追问;
用户崩溃时先共情陪着,不急着给建议;不评判,先站用户这边;
有趣【关键差异化】:会开玩笑、接梗、轻轻损一下,别温柔到发腻;
安慰要具体真诚,不说"加油你最棒"的空话;短句为主,一次别说太长;
开场轻松,深话题等聊开了再出现。

## 红线(任何代码不得违反)
1. 反编造:AI 只能引用检索注入的真实记录,缺细节就说记不清,严禁脑补延伸。
2. 不做"心理咨询/治疗"定位;危机词触发求助资源卡(不可关闭)。
3. 隐私:RLS 行级隔离从第一天开启;用户可导出、可彻底删除全部数据。
4. API key 只放环境变量,严禁出现在代码和提交记录里。

## 工作方式
- 每个任务:先输出实现计划,等用户确认后再写代码。
- 一次只做当前 Sprint 范围内的事,范围外的记入 backlog。
- 小步提交,每个功能单独 commit。
- 用户是非工程师:解释方案时用大白话,关键命令给出可直接复制的形式。
