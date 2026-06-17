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
2. 不做"心理咨询/治疗"定位;强烈痛苦/自伤风险时,TA 只在语气里自然提一次 12356 求助资源,不做 UI 卡片。
3. 隐私:RLS 行级隔离从第一天开启;用户可导出、可彻底删除全部数据。
4. API key 只放环境变量,严禁出现在代码和提交记录里。

## 工作方式
- 每个任务:先输出实现计划,等用户确认后再写代码。
- 一次只做当前 Sprint 范围内的事,范围外的记入 backlog。
- 小步提交,每个功能单独 commit。
- 用户是非工程师:解释方案时用大白话,关键命令给出可直接复制的形式。

## Sprint 2 — 结构化与档案（已完成）

交付（已验证可用）：
- 事件级自动归档：消息 → Haiku 抽取 → Entry（summary/emotion/emotion_intensity/category/people/places/keywords/message_ids 回链）
- 实体卡 topics：people/places/pets 去重写入，mention_count + facts[]（带 source_entry_id）
- 档案页：卡片墙（时间倒序）、情绪+分类双维筛选、过去8周热力图、点击穿透到独立回看页
- 低落卡片默认隐藏，点"低落"筛选才显示

技术决策：
- 归档写入走 Postgres RPC commit_archive_entries（多 Entry），单事务 + pg_try_advisory_xact_lock 防重复/并发
- messages.archived_at 标记已处理；纯填充消息用 mark_messages_archived 标记，避免堵未归档队列
- 空闲归档：Vercel Cron（每3分钟）+ list_idle_archive_users，5分钟无新消息触发
- Haiku 走原生 anthropic HTTP（禁用 AI SDK generateObject——schema 泛型会拖爆 tsc）
- summary：温和回顾口吻、不写"用户…"、不放大尖锐字眼；"完/就这样"是控制词不进 summary；无实质内容不归档
- migrations 0001–0005 + mark_messages_archived 已应用到 Supabase

已知不完美 / 留 Sprint 3（不挡上线）：
- 分类不总准（吉他→想法、奶茶→健康）；目标是"更准+可扩展"，不是取消分类
- 别名未合并（妈妈=母亲）；宠物未按只拆成独立卡；TA 仍偏爱提问（少提问 prompt 已写待调）

待办 / 未验证：
- 换话题自动归档（本地可测）、空闲 cron 自动触发（仅部署后可验）
- 尚未部署；首批用户在大陆 → Vercel/Supabase 仅适合验证期；正式大陆上线需国内云+ICP备案+微信/手机登录（Phase 2）
