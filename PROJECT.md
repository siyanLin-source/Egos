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
- ESLint 单独运行会卡住，疑似 ESLint 9 flat config 与 eslint-config-next 版本适配问题；build 阶段已忽略 lint，不挡构建/部署/测试，后续作为工程债处理。

待办 / 未验证：
- 换话题自动归档（本地可测）、空闲 cron 自动触发（仅部署后可验）
- 尚未部署；首批用户在大陆 → Vercel/Supabase 仅适合验证期；正式大陆上线需国内云+ICP备案+微信/手机登录（Phase 2）

## Sprint 3 — 知识层 + 智能档案（已完成，tsc 通过）

交付（已验证可用）：
- 知识层「关于你」画像：profile_facts 沉淀稳定事实；`/api/profile-summary` 用 Haiku 生成一句通顺、不夸张的自我介绍（合并"健身+减肥"、修饰语前置、忠于原意不拔高）
- 别名合并：`canonicalPersonName` + `PERSON_ALIASES`（妈妈=母亲、男朋友=boyfriend），读/写两层归一，人物列表不再出现重复实体
- 人物独立页 `/people`（按 人物/宠物/地点 分组）+ `/people/[name]`（选人看 ta 的全部记录）；档案页保留内联人物速览，计数与可见记录一致
- 日历 → 当天 AI 日记：点某天 → `/api/day-diary` 把当天事件串成一段日记式总结（过滤废话）
- 显示层清洗 `lib/archive/clean-entries.ts`：去急性原话卡 + 去废话/流水账 + 近似重复合并（同日同类 + 字符相似/共享关键词/共享独特短语，留最早一条）——纯显示层，不动数据库
- 单条事件删除：`/api/entries/[id]` DELETE + 详情页删除按钮（RLS 只能删自己的）
- 想记住的事（置顶）：`profile_facts.pinned` + `/api/profile-facts/[id]` PATCH
- 新对话 fire-and-forget：点"新对话"立刻清空、后台归档，不阻塞
- 抽取 prompt 收紧：去废话/流水账、AI 提炼不照抄、不夸张、不拆同类近似；搜索（子串匹配）；日历默认折叠收小

技术决策：
- 危机内容改为「按 summary 判定」：`entries.is_crisis`（migration 20260619170716）+ 显示层 `isAcuteSummary`；温和措辞的难过记忆保留，只有卡片文字直接出现"想死/绝望"原话才隐藏。事件详情**保留用户原话**（用户自己的记忆，由用户决定删不删）
- 清洗/去重/危机过滤全部放在**显示层（读时）**，数据库不删——可随时调、可回退、不依赖手动跑 SQL
- 实体合并 + 人物视图统一从「可见 Entry」派生，计数永远和记录对得上
- AI 调用修复：undici 降到与本机 Node 兼容的 7.x；Anthropic 显式 `baseURL=.../v1`（ai@6 + @ai-sdk/anthropic@3 默认丢 /v1 → 404）；所有 AI 调用走 `lib/ai/proxy-fetch.ts` 代理（大陆直连超时）
- `app/loading.tsx` 即时骨架屏，缓解跨境慢加载的白屏
- migrations 0006–0009 + 20260619170716 已应用到 Supabase

已知不完美 / 下一步：
- 工程债：本机磁盘极慢（项目在 ~/Desktop，被 iCloud 同步 + node_modules）→ 编译/git 都会卡死；建议把项目移出 ~/Desktop（离开 iCloud）
- next.config 仍 `ignoreBuildErrors`（临时）；跨天的语义去重（不同天的同一件事）还没做
- 离"能拿给人试"还差：国内部署（数据库/AI/部署都在海外，现靠代理）、像 App 的移动端打磨、新人引导、隐私说明

本次 commit message（复制到 GitHub Desktop 用）：
```
Sprint 3+: 智能档案 — 关于你画像 / 人物独立页 / 日历AI日记 / 清洗去重 / 手动删除

- 知识层: AI 生成关于你画像(/api/profile-summary) + 别名合并(妈妈=母亲) + 想记住的事置顶
- 人物: 独立 /people 页(选人看 ta 的记录) + 档案内联速览, 计数与记录一致
- 日历: 点某天 → AI 当天日记(/api/day-diary)
- 清洗: 显示层去急性原话/去废话/近似重复合并(lib/archive/clean-entries.ts)
- 删除: 用户可删除单条事件(/api/entries/[id] + 详情页删除按钮)
- 新对话 fire-and-forget; 危机按 summary 判定隐藏; 事件详情保留原话
- 修复: undici 降级 + Anthropic baseURL/代理(proxy-fetch.ts, anthropic.ts)
```
