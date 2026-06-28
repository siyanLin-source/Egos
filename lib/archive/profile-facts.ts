import { PROFILE_FACT_KINDS } from "./taxonomy";

export type ProfileFactKind = (typeof PROFILE_FACT_KINDS)[number];

export type RawProfileFact = {
  text: string;
  kind: ProfileFactKind;
  subject: string;
  importance: number;
};

export type NormalizedProfileFact = RawProfileFact & {
  claim_key: string;
};

const PROFILE_FACT_SPLIT_PATTERN =
  /[，,；;。]+|(?:并且|而且|同时|另外|还有)/g;

function compactForMatch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s'".。！？!?，,；;：:、（）()[\]{}_-]+/g, "");
}

function trimFactText(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[。.!！?？；;，,]+$/g, "");
}

function extractSelfNameHints(sourceTexts: string[]) {
  const hints: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(?:我叫|我是|叫我|可以叫我)\s*([A-Za-z][A-Za-z0-9'.-]{1,40})/g,
  ];

  for (const text of sourceTexts) {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1]?.trim();
        if (!name) {
          continue;
        }

        const key = compactForMatch(name);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        hints.push(name);
      }
    }
  }

  return hints;
}

function restoreKnownName(text: string, sourceNameHints: string[]) {
  let restored = text;

  for (const hint of sourceNameHints) {
    const hintKey = compactForMatch(hint);

    restored = restored.replace(
      /([A-Za-z]+(?:\s+[A-Za-z]+){1,12})/g,
      (candidate) => {
        return compactForMatch(candidate) === hintKey ? hint : candidate;
      },
    );
  }

  return restored.replace(/(叫|是)\s+([A-Za-z])/g, "$1$2");
}

function completeContinuationClause(clause: string) {
  if (
    /^(你|我|TA|ta|Ta|他|她|它|[A-Za-z][A-Za-z0-9'.-]*|[\u4e00-\u9fa5]{1,8}(是|叫|在|有|养|喜欢))/.test(
      clause,
    )
  ) {
    return clause;
  }

  if (/^(有|在|养|叫|喜欢|正在|最近|目前|现在|会|学|想|准备|打算|住|工作|上学)/.test(clause)) {
    return `你${clause}`;
  }

  return `你${clause}`;
}

function expandHealthCompound(clause: string) {
  const compact = compactForMatch(clause);

  if (compact.includes("健身") && compact.includes("减肥")) {
    return ["你在健身", "你在减肥"];
  }

  return [clause];
}

function splitAtomicFactText(text: string) {
  const parts = trimFactText(text)
    .split(PROFILE_FACT_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap(expandHealthCompound);

  if (parts.length <= 1) {
    return parts;
  }

  return parts.map(completeContinuationClause);
}

function inferKind(text: string, fallback: ProfileFactKind): ProfileFactKind {
  const compact = compactForMatch(text);

  if (/^(你|我)?(叫|名字是|是)[a-z\u4e00-\u9fa5]/.test(compact)) {
    return "identity";
  }

  if (
    compact.includes("男朋友") ||
    compact.includes("女朋友") ||
    compact.includes("妈妈") ||
    compact.includes("母亲") ||
    compact.includes("爸爸") ||
    compact.includes("父亲") ||
    compact.includes("姐姐") ||
    compact.includes("姐夫")
  ) {
    return "relationship";
  }

  if (
    compact.includes("猫") ||
    compact.includes("狗") ||
    compact.includes("宠物")
  ) {
    return "pet";
  }

  if (
    compact.includes("减肥") ||
    compact.includes("健身") ||
    compact.includes("健康")
  ) {
    return "health";
  }

  if (
    compact.includes("吉他") ||
    compact.includes("画画") ||
    compact.includes("摄影") ||
    compact.includes("跳舞")
  ) {
    return "interest";
  }

  return fallback;
}

function getClaimKey(kind: ProfileFactKind, text: string) {
  const compact = compactForMatch(text);

  if (kind === "identity" && /^(你|我)?(叫|名字是|是)/.test(compact)) {
    return "name";
  }

  if (compact.includes("男朋友")) {
    return "partner:boyfriend";
  }

  if (compact.includes("女朋友")) {
    return "partner:girlfriend";
  }

  if (compact.includes("减肥")) {
    return "health:weight_loss";
  }

  if (compact.includes("健身")) {
    return "health:fitness";
  }

  if (compact.includes("吉他")) {
    return "interest:guitar";
  }

  const petName = text.match(/(?:叫|名叫)\s*([A-Za-z0-9'.-]+|[\u4e00-\u9fa5]{1,12})/)?.[1];
  if (kind === "pet" && petName) {
    return `pet:${compactForMatch(petName)}`;
  }

  return compact
    .replace(/^(你|我)/, "")
    .replace(/^(现在|目前|最近|正在|一直|已经|开始)/, "")
    .replace(/^(有|是|在)/, "")
    .slice(0, 80);
}

function hasAnyPattern(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source));
}

const THIRD_PARTY_CUE =
  "(姐姐|妹妹|哥哥|弟弟|姐夫|嫂子|表哥|表姐|表弟|表妹|堂哥|堂姐|堂弟|堂妹|妈妈|母亲|爸爸|父亲|同事|(?<!男|女)朋友|同学|老师|经理|主管|老板|领导|客户|部门|公司|团队|财务部|工程部|人事|行政|市场|销售|她|他|ta|TA|它)";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsThirdPartyClaim(source: string, term: string) {
  const escaped = escapeRegExp(term);
  const pattern = new RegExp(
    `${THIRD_PARTY_CUE}[^。！？\\n]{0,16}${escaped}|${escaped}[^。！？\\n]{0,16}${THIRD_PARTY_CUE}`,
  );

  return pattern.test(source);
}

function supportsImplicitSelfClaim(source: string, term: string) {
  return source.includes(term) && !containsThirdPartyClaim(source, term);
}

function sourceSupportsProfileFact({
  kind,
  subject,
  claimKey,
  sourceTexts,
}: {
  kind: ProfileFactKind;
  subject: string;
  claimKey: string;
  sourceTexts: string[];
}) {
  const source = sourceTexts.join("\n");
  const compactSubject = compactForMatch(subject);

  if (compactSubject && compactSubject !== "你" && compactSubject !== "我") {
    return false;
  }

  if (kind === "identity") {
    return hasAnyPattern(source, [
      /我叫\s*[A-Za-z\u4e00-\u9fa5]/,
      /我是\s*[A-Za-z\u4e00-\u9fa5]/,
      /叫我\s*[A-Za-z\u4e00-\u9fa5]/,
      /可以叫我\s*[A-Za-z\u4e00-\u9fa5]/,
    ]);
  }

  if (kind === "relationship") {
    if (
      claimKey === "partner:boyfriend" ||
      claimKey === "partner:girlfriend"
    ) {
      const relationshipTerm =
        claimKey === "partner:boyfriend" ? "男朋友" : "女朋友";

      return hasAnyPattern(source, [
        /我.{0,8}(有|交了|谈了|和).{0,8}(男朋友|女朋友|对象|伴侣)/,
        /(还有|有)(男朋友|女朋友|对象|伴侣)/,
      ]) || supportsImplicitSelfClaim(source, relationshipTerm);
    }

    return hasAnyPattern(source, [
      /我有(个|一个|一位)?(姐姐|妹妹|哥哥|弟弟|姐夫|妈妈|母亲|爸爸|父亲)/,
      /我的(姐姐|妹妹|哥哥|弟弟|姐夫|妈妈|母亲|爸爸|父亲)(叫|是)/,
    ]);
  }

  if (kind === "pet") {
    return hasAnyPattern(source, [
      /(我|我家|家里).{0,12}(养|有).{0,12}(猫|狗|宠物)/,
      /(猫|狗|宠物).{0,8}(叫|名叫)[A-Za-z0-9'.\-\u4e00-\u9fa5]/,
    ]);
  }

  if (kind === "health") {
    if (claimKey === "health:fitness") {
      return supportsImplicitSelfClaim(source, "健身");
    }

    if (claimKey === "health:weight_loss") {
      return supportsImplicitSelfClaim(source, "减肥");
    }

    return hasAnyPattern(source, [/我.{0,12}(健康|身体|睡眠|运动)/]);
  }

  if (kind === "interest") {
    return hasAnyPattern(source, [
      /我.{0,12}(喜欢|在学|学|练|爱).{0,12}(吉他|画画|摄影|跳舞)/,
    ]) || ["吉他", "画画", "摄影", "跳舞"].some((term) =>
      supportsImplicitSelfClaim(source, term),
    );
  }

  if (kind === "work" || kind === "school" || kind === "place") {
    return hasAnyPattern(source, [
      /我.{0,8}在.{1,24}(工作|上班|上学|读书|生活|住)/,
      /(^|[，,；;\n])在.{1,24}(工作|上班|上学|读书|生活|住)/,
    ]) && !containsThirdPartyClaim(source, "工作");
  }

  if (
    kind === "preference" ||
    kind === "routine" ||
    kind === "goal"
  ) {
    return hasAnyPattern(source, [
      /我.{0,12}(喜欢|爱|不喜欢|讨厌|每天|经常|习惯|想|准备|打算|目标是)/,
    ]);
  }

  return false;
}

function chooseBetterFact(
  current: NormalizedProfileFact,
  next: NormalizedProfileFact,
) {
  if (next.importance > current.importance) {
    return next;
  }

  if (next.importance < current.importance) {
    return current;
  }

  return next.text.length < current.text.length ? next : current;
}

export function normalizeProfileFacts(
  facts: RawProfileFact[],
  sourceTexts: string[],
) {
  const sourceNameHints = extractSelfNameHints(sourceTexts);
  const byClaim = new Map<string, NormalizedProfileFact>();

  for (const fact of facts) {
    const pieces = splitAtomicFactText(fact.text);

    for (const piece of pieces) {
      const text = restoreKnownName(trimFactText(piece), sourceNameHints);
      if (!text) {
        continue;
      }

      const kind = inferKind(text, fact.kind);
      const subject = fact.subject.trim() || "你";
      const claimKey = getClaimKey(kind, text);

      if (
        !sourceSupportsProfileFact({
          kind,
          subject,
          claimKey,
          sourceTexts,
        })
      ) {
        continue;
      }

      const dedupeKey = `${compactForMatch(subject)}|${kind}|${claimKey}`;
      const normalized: NormalizedProfileFact = {
        text: text.slice(0, 160),
        kind,
        subject: subject.slice(0, 100),
        importance: Math.max(0, Math.min(1, fact.importance)),
        claim_key: claimKey,
      };
      const existing = byClaim.get(dedupeKey);

      byClaim.set(
        dedupeKey,
        existing ? chooseBetterFact(existing, normalized) : normalized,
      );
    }
  }

  return Array.from(byClaim.values()).slice(0, 12);
}
