import {
  AI_ENVELOPE_SCHEMA_VERSION,
  AI_POLICY,
  AI_PURPOSE,
  ESTIMATOR_ID,
  GENERATION_STRATEGY_VERSION,
  PROMPT_PROFILE,
  PROMPT_PROFILES_BY_ID,
  REUSE_POLICY,
  buildPrompt,
  buildSchemaRepairPrompt,
  createAiBudget
} from "./shared-ai-prompt-policy.js";
import {
  TRUTH_GATE_MATCH_MODE,
  resolveName
} from "./shared-dictionary-resolver.js";
import {
  COMMIT_DISPOSITION,
  CONFLICT_STATE,
  EVIDENCE_TYPE,
  ID_PREFIXES,
  LIFECYCLE_STATE,
  REVALIDATION_STATE,
  ROLE_ENUM,
  STANCE,
  SUBJECT_KIND,
  TRUST_TIER,
  VERIFICATION_STATE,
  __name,
  assertMutationId,
  buildContextSnapshot,
  calculateContextFit,
  computeContextHash,
  computeInputFingerprint,
  computeSourceNameFingerprint,
  entitySubjectKey,
  evaluateClaimEligibility,
  findClaimsBySubjectAndValueType,
  getClaim,
  getMeta,
  isMutationId,
  lexicalSubjectKey,
  lexicalTokens,
  newOpaqueId,
  parseSourceName,
  phraseSubjectKey,
  recomputeClaimScore,
  recordEvidence,
  stableHash,
  strictNormalizedSource,
  truthEligibilityGate,
  upsertClaim
} from "./shared-dictionary-core.js";

// dictionary-ai-unknown.js
var RESOLVED_METHODS = Object.freeze(/* @__PURE__ */ new Set(["claim", "builtin"]));
var PRESERVED_METHOD = "preserved";
var UNRESOLVED_METHOD = "unresolved_verbatim";
var CONFLICTED_METHOD = "conflicted_verbatim";
var UnknownPlanError = class extends Error {
  static {
    __name(this, "UnknownPlanError");
  }
  constructor(message, details) {
    super(message);
    this.name = "UnknownPlanError";
    this.details = details;
  }
};
function isPureWhitespace(text) {
  return typeof text === "string" && text.length > 0 && /^\s+$/u.test(text);
}
__name(isPureWhitespace, "isPureWhitespace");
function splitAtPunctuation(sourceText, span, target) {
  const text = sourceText.slice(span.sourceStart, span.sourceEnd);
  const parsed = parseSourceName(text, { target });
  const runs = [];
  let cur = null;
  for (const seg of parsed.segments) {
    if (seg.type === "punctuation") {
      cur = null;
      continue;
    }
    if (seg.type === "space") continue;
    const absStart = span.sourceStart + seg.start;
    const absEnd = span.sourceStart + seg.end;
    if (cur) cur.sourceEnd = absEnd;
    else {
      cur = { sourceStart: absStart, sourceEnd: absEnd };
      runs.push(cur);
    }
  }
  return runs;
}
__name(splitAtPunctuation, "splitAtPunctuation");
function unknownSegmentId(sourceStart, sourceEnd) {
  return `u:${sourceStart}-${sourceEnd}`;
}
__name(unknownSegmentId, "unknownSegmentId");
function sourceMapSegments(valueResult) {
  const sm = valueResult?.sourceMap;
  if (Array.isArray(sm)) return sm;
  if (Array.isArray(sm?.segments)) return sm.segments;
  return null;
}
__name(sourceMapSegments, "sourceMapSegments");
function planUnknownSpans({ sourceText, target = null, valueResult }, policy = AI_POLICY) {
  if (typeof sourceText !== "string") {
    throw new UnknownPlanError("sourceText must be a string", { sourceText });
  }
  const segments = sourceMapSegments(valueResult);
  if (!Array.isArray(segments)) {
    return {
      unknownSpans: [],
      knownSegments: [],
      preservedSegments: [],
      conflictedSegments: [],
      hasSourceMap: false
    };
  }
  const known = [];
  const preserved = [];
  const conflicted = [];
  const rawUnknown = [];
  for (const seg of segments) {
    if (seg.mapKind !== "source_segment") continue;
    if (typeof seg.sourceStart !== "number" || typeof seg.sourceEnd !== "number") continue;
    if (RESOLVED_METHODS.has(seg.method)) {
      known.push({
        sourceStart: seg.sourceStart,
        sourceEnd: seg.sourceEnd,
        text: seg.sourceText,
        reading: seg.outputText,
        method: seg.method
      });
    } else if (seg.method === PRESERVED_METHOD) {
      preserved.push({ sourceStart: seg.sourceStart, sourceEnd: seg.sourceEnd, text: seg.sourceText });
    } else if (seg.method === CONFLICTED_METHOD) {
      conflicted.push({ sourceStart: seg.sourceStart, sourceEnd: seg.sourceEnd, text: seg.sourceText });
      if (policy.unknownSpan.includeConflictedSpans) {
        rawUnknown.push({ sourceStart: seg.sourceStart, sourceEnd: seg.sourceEnd });
      }
    } else if (seg.method === UNRESOLVED_METHOD) {
      rawUnknown.push({ sourceStart: seg.sourceStart, sourceEnd: seg.sourceEnd });
    }
  }
  rawUnknown.sort((a, b) => a.sourceStart - b.sourceStart);
  const atomic = [];
  for (const span of rawUnknown) {
    for (const run of splitAtPunctuation(sourceText, span, target)) atomic.push(run);
  }
  const merged = [];
  for (const span of atomic) {
    const last = merged[merged.length - 1];
    if (last) {
      const gap = sourceText.slice(last.sourceEnd, span.sourceStart);
      const mergeable = gap === "" || (policy.unknownSpan.mergeAcrossWhitespaceOnly ? isPureWhitespace(gap) : true);
      if (mergeable) {
        last.sourceEnd = span.sourceEnd;
        last.parts.push(span);
        continue;
      }
    }
    merged.push({ sourceStart: span.sourceStart, sourceEnd: span.sourceEnd, parts: [span] });
  }
  const unknownSpans = merged.map((m) => {
    const text = sourceText.slice(m.sourceStart, m.sourceEnd);
    const parsedSpan = parseSourceName(text, { target });
    const tokens = lexicalTokens(parsedSpan);
    return {
      segmentId: unknownSegmentId(m.sourceStart, m.sourceEnd),
      sourceStart: m.sourceStart,
      sourceEnd: m.sourceEnd,
      text,
      tokenCount: tokens.length,
      /**
       * §51.4:「synthetic punctuation boundary を跨ぐ → bad Lexical Claim を作らない」。
       * span 自体が punctuation を含むかを Parser 由来で判定して記録する
       * （Alignment Gate はこの事実を使う。文字列 heuristic を再実装しない）。
       */
      crossesPunctuation: parsedSpan.segments.some((s) => s.type === "punctuation"),
      mergedFrom: m.parts.map((p) => unknownSegmentId(p.sourceStart, p.sourceEnd))
    };
  }).filter((s) => s.text.trim().length > 0);
  return {
    unknownSpans,
    knownSegments: known,
    preservedSegments: preserved,
    conflictedSegments: conflicted,
    hasSourceMap: true
  };
}
__name(planUnknownSpans, "planUnknownSpans");
function needsAiCall(plan) {
  return Array.isArray(plan?.unknownSpans) && plan.unknownSpans.length > 0;
}
__name(needsAiCall, "needsAiCall");
function isReusableClaim(claim, { matchMode = "lex", context = {} } = {}, policy = REUSE_POLICY) {
  if (!claim) return { reusable: false, reason: "no_claim" };
  if (claim.quarantined === true) return { reusable: false, reason: policy.quarantined };
  const elig = evaluateClaimEligibility(claim);
  if (!elig.eligible) return { reusable: false, reason: elig.reason };
  if (claim.conflictState === CONFLICT_STATE.conflicted) {
    return { reusable: false, reason: "conflicted" };
  }
  if (claim.revalidationState === REVALIDATION_STATE.needed) {
    return { reusable: false, reason: "revalidation_needed" };
  }
  const fit = calculateContextFit(claim, context);
  if (!fit.eligible) {
    return {
      reusable: false,
      reason: `context_ineligible:${fit.reason}`,
      fit: fit.fit,
      contextEligible: false
    };
  }
  if (claim.locked === true) {
    return { reusable: true, reason: policy.locked, fit: fit.fit, contextEligible: true };
  }
  const v = claim.verificationState;
  if (v === VERIFICATION_STATE.manualEntered || v === VERIFICATION_STATE.manualCorrected || v === VERIFICATION_STATE.official) {
    return { reusable: true, reason: policy.manual, fit: fit.fit, contextEligible: true };
  }
  if (claim.trustTier === TRUST_TIER.trusted) {
    return { reusable: true, reason: policy.trusted, fit: fit.fit, contextEligible: true };
  }
  if (claim.trustTier === TRUST_TIER.learned) {
    return { reusable: true, reason: policy.learned, fit: fit.fit, contextEligible: true };
  }
  const gateMatchMode = TRUTH_GATE_MATCH_MODE[matchMode] ?? "folded";
  const gate = truthEligibilityGate({ claim, matchMode: gateMatchMode });
  if (!gate.eligible) {
    return {
      reusable: false,
      reason: gate.reason,
      // 'insufficient_truth'
      // §30.4.1:「Truth 不足 → Candidate Trace には残す → AI 再確認 / Conflict / Unresolved へ」
      disposition: gate.disposition ?? "needs_ai_or_conflict",
      gate,
      fit: fit.fit,
      contextEligible: true
    };
  }
  return { reusable: true, reason: policy.provisional, gate, fit: fit.fit, contextEligible: true };
}
__name(isReusableClaim, "isReusableClaim");
async function filterSpansNeedingAi(db, spans, {
  target = null,
  valueType = "japanese_display",
  context = {},
  reusePolicy = REUSE_POLICY
} = {}) {
  const aiSpans = [];
  const reused = [];
  const rejectedReuse = [];
  for (const span of spans) {
    const strict = strictNormalizedSource(span.text);
    const lexical = span.tokenCount <= 1;
    const subjectKey = lexical ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
    const page = await findClaimsBySubjectAndValueType(db, subjectKey, valueType, { limit: 20 });
    const evaluated = page.items.map((claim) => ({
      claim,
      verdict: isReusableClaim(
        claim,
        { matchMode: lexical ? "lex" : "phrase", context },
        reusePolicy
      )
    }));
    const hit = evaluated.find((x) => x.verdict.reusable);
    if (hit) {
      reused.push({
        span,
        claimId: hit.claim.claimId,
        reason: hit.verdict.reason,
        value: hit.claim.value,
        truthStrength: hit.verdict.gate?.truthStrength ?? null,
        requiredTruth: hit.verdict.gate?.required ?? null,
        contextFit: hit.verdict.fit ?? null
      });
      continue;
    }
    aiSpans.push(span);
    for (const e of evaluated) {
      rejectedReuse.push({
        span: span.segmentId,
        claimId: e.claim.claimId,
        reason: e.verdict.reason,
        disposition: e.verdict.disposition ?? null,
        truthStrength: e.verdict.gate?.truthStrength ?? null,
        requiredTruth: e.verdict.gate?.required ?? null,
        contextFit: e.verdict.fit ?? null,
        contextEligible: e.verdict.contextEligible ?? null
      });
    }
  }
  return { aiSpans, reused, rejectedReuse };
}
__name(filterSpansNeedingAi, "filterSpansNeedingAi");
function partialRetentionView({ sourceText, valueResult, plan }) {
  const segments = sourceMapSegments(valueResult) ?? [];
  return {
    /** Composer が既に組み立てている「未知は原文のまま」の文字列。失ってはならない。 */
    retainedOutput: valueResult?.output ?? null,
    resolutionState: valueResult?.resolutionState ?? "unresolved",
    resolvedSegmentCount: segments.filter((s) => RESOLVED_METHODS.has(s.method)).length,
    preservedSegmentCount: segments.filter((s) => s.method === PRESERVED_METHOD).length,
    unresolvedSpanCount: plan?.unknownSpans?.length ?? 0,
    sourceText
  };
}
__name(partialRetentionView, "partialRetentionView");
function composeCurrentSessionOutput({ sourceText, valueResult, spans, fills }) {
  const segments = sourceMapSegments(valueResult) ?? [];
  const filled = [];
  const emittedSpans = /* @__PURE__ */ new Set();
  const spanFor = /* @__PURE__ */ __name((seg) => spans.find((sp) => fills.has(sp.segmentId) && seg.sourceStart >= sp.sourceStart && seg.sourceEnd <= sp.sourceEnd), "spanFor");
  const out = [];
  let text = "";
  for (const seg of segments) {
    if (seg.mapKind !== "source_segment" || typeof seg.sourceStart !== "number") {
      out.push({ ...seg, aiFilled: false });
      text += seg.outputText;
      continue;
    }
    const sp = spanFor(seg);
    if (!sp) {
      out.push({ ...seg, aiFilled: false });
      text += seg.outputText;
      continue;
    }
    if (emittedSpans.has(sp.segmentId)) continue;
    emittedSpans.add(sp.segmentId);
    filled.push(sp.segmentId);
    const reading = fills.get(sp.segmentId);
    out.push({
      mapKind: "source_segment",
      segmentId: sp.segmentId,
      sourceStart: sp.sourceStart,
      sourceEnd: sp.sourceEnd,
      sourceText: sp.text,
      outputText: reading,
      // §49: これは「今回のAI直接出力」であって Claim 選択の結果ではない。
      method: "ai_session_fill",
      selectedClaimIds: [],
      aiFilled: true
    });
    text += reading;
  }
  let cursor = 0;
  for (const seg of out) {
    seg.outputStart = cursor;
    seg.outputEnd = cursor + seg.outputText.length;
    cursor = seg.outputEnd;
  }
  const unfilled = spans.map((s) => s.segmentId).filter((id) => !emittedSpans.has(id));
  return {
    text,
    filledSegmentIds: filled,
    unfilledSegmentIds: unfilled,
    complete: unfilled.length === 0,
    segments: out,
    sourceText
  };
}
__name(composeCurrentSessionOutput, "composeCurrentSessionOutput");

// dictionary-native-policy.js
var NATIVE_SCRIPT = Object.freeze({
  hans: "Hans",
  hant: "Hant",
  hani: "Hani",
  jpan: "Jpan",
  hang: "Hang",
  kana: "Kana"
});
var SCRIPT_AUTHORITY_SOURCE = Object.freeze({
  /** AI Response が明示した script metadata。単独では弱い。 */
  aiResponseMetadata: "ai_response_metadata",
  /** すでに学習済みの native mapping Claim が持つ script。 */
  knownMapping: "known_mapping",
  /** Country / Source convention（CN→Hans, TW/HK/MO→Hant 等）。単独では弱い。 */
  countryConvention: "country_convention",
  /** Builtin / Official Evidence。 */
  builtinOfficial: "builtin_official",
  /** 人手。 */
  manual: "manual"
});
var STRONG_SCRIPT_AUTHORITIES = Object.freeze(/* @__PURE__ */ new Set([
  SCRIPT_AUTHORITY_SOURCE.manual,
  SCRIPT_AUTHORITY_SOURCE.builtinOfficial,
  SCRIPT_AUTHORITY_SOURCE.knownMapping
]));
var COUNTRY_SCRIPT_CONVENTION = Object.freeze({
  CN: NATIVE_SCRIPT.hans,
  SG: NATIVE_SCRIPT.hans,
  TW: NATIVE_SCRIPT.hant,
  HK: NATIVE_SCRIPT.hant,
  MO: NATIVE_SCRIPT.hant
});
var NATIVE_RECOVERY_SCOPE = Object.freeze({
  zh: Object.freeze({
    language: "zh",
    countries: Object.freeze(/* @__PURE__ */ new Set(["CN", "TW", "HK", "MO", "SG"])),
    /** §84「初期優先: China club」。 */
    targets: Object.freeze(/* @__PURE__ */ new Set(["club"]))
  }),
  ko: Object.freeze({
    language: "ko",
    countries: Object.freeze(/* @__PURE__ */ new Set(["KR"])),
    targets: Object.freeze(/* @__PURE__ */ new Set(["club"]))
  })
});
var ROMANIZATION_SYSTEMS = Object.freeze(/* @__PURE__ */ new Set([
  "unknown",
  "pinyin",
  "wade_giles",
  "revised_romanization",
  "mccune_reischauer",
  "custom"
]));
var NATIVE_DISPLAY_GATE = Object.freeze({
  /** 中国 Hans/Hant/Hani — 積極利用。 */
  chineseHan: Object.freeze({
    truthMatchMode: "exact",
    minTrustTier: "learned",
    requiresStrongEvidence: false,
    /** §81:「Direct/Derived Native Claimがquarantinedでない」。 */
    forbidQuarantined: true,
    eligibleForJapaneseDisplay: true
  }),
  /** 韓国 Hangul — Native metadata として保存。Japanese final display には使わない。 */
  koreanHangul: Object.freeze({
    truthMatchMode: "exact",
    minTrustTier: "learned",
    requiresStrongEvidence: false,
    forbidQuarantined: true,
    /** §81.1:「Japanese final display policy は別」。Hangul をそのまま日本語表示にしない。 */
    eligibleForJapaneseDisplay: false
  }),
  /** 韓国 Hanja — §83 strong gate。 */
  koreanHanja: Object.freeze({
    truthMatchMode: "folded",
    minTrustTier: "trusted",
    requiresStrongEvidence: true,
    forbidQuarantined: true,
    eligibleForJapaneseDisplay: true
  })
});
var TRUST_TIER_RANK = Object.freeze({ provisional: 0, learned: 1, trusted: 2 });
var HANJA_STRONG_EVIDENCE = Object.freeze({
  /** 単独で通る strong source。 */
  sufficientSources: Object.freeze(/* @__PURE__ */ new Set(["manual", "builtin", "official"])),
  /** §83:「複数独立model lineageのBlind一致」に必要な独立 lineage 数。 */
  minIndependentBlindLineages: 2,
  /** §83:「Hangul↔Hanja Segment整合」を併せて要求する。 */
  requiresHangulHanjaAlignment: true
});
var LOANWORD_BRAND_SOURCE_TOKENS = Object.freeze(/* @__PURE__ */ new Set([
  "motors",
  "motor",
  "united",
  "city",
  "fc",
  "sc",
  "ac",
  "cf",
  "sports",
  "sport",
  "group",
  "holdings",
  "holding",
  "club",
  "football",
  "soccer",
  "athletic",
  "dragons",
  "bluewings",
  "blue",
  "wings",
  "greeners",
  "citizen",
  "orion",
  "stars",
  "star",
  "green",
  "red",
  "white",
  "black",
  "ivory"
]));
var LOANWORD_BRAND_ROLES = Object.freeze(/* @__PURE__ */ new Set([
  "brand",
  "sponsor",
  "club_prefix",
  "club_term",
  "connector",
  "number",
  "ordinal",
  "year"
]));
var SAFE_SIMPLIFIED_TO_JAPANESE = Object.freeze(/* @__PURE__ */ new Map([
  ["东", "東"],
  ["华", "華"],
  ["泰", "泰"],
  ["济", "済"],
  ["鲁", "魯"],
  ["岛", "島"],
  ["车", "車"],
  ["门", "門"],
  ["马", "馬"],
  ["长", "長"],
  ["国", "国"],
  ["学", "学"],
  ["体", "体"],
  ["应", "応"],
  ["关", "関"],
  ["声", "声"],
  ["壮", "壮"],
  ["宝", "宝"],
  ["实", "実"],
  ["将", "将"],
  ["带", "帯"],
  ["惠", "恵"],
  ["浜", "浜"],
  ["独", "独"],
  ["画", "画"],
  ["当", "当"],
  ["党", "党"],
  ["称", "称"],
  ["粛", "粛"],
  ["続", "続"],
  ["两", "両"],
  ["为", "為"],
  ["亚", "亜"],
  ["产", "産"],
  ["价", "価"],
  ["众", "衆"],
  ["传", "伝"],
  ["伟", "偉"],
  ["佛", "仏"],
  ["侨", "僑"],
  ["储", "儲"],
  ["党", "党"],
  ["决", "決"],
  ["凉", "涼"],
  ["刘", "劉"]
]));
var UNSAFE_SIMPLIFIED = Object.freeze(/* @__PURE__ */ new Map([
  ["发", "traditional_merger"],
  // 發 / 髮
  ["干", "traditional_merger"],
  // 乾 / 幹 / 干
  ["后", "traditional_merger"],
  // 後 / 后
  ["台", "traditional_merger"],
  // 臺 / 檯 / 颱 / 台
  ["里", "traditional_merger"],
  // 裏 / 里
  ["云", "traditional_merger"],
  // 雲 / 云
  ["面", "traditional_merger"],
  // 麵 / 面
  ["松", "traditional_merger"],
  // 鬆 / 松
  ["复", "traditional_merger"],
  // 復 / 複 / 覆
  ["历", "traditional_merger"],
  // 歷 / 曆
  ["钟", "traditional_merger"],
  // 鐘 / 鍾
  ["谷", "traditional_merger"],
  // 穀 / 谷
  ["广", "homograph_different_meaning"],
  // 廣。日本語「广」は同形別義
  ["厂", "homograph_different_meaning"],
  // 廠。日本語「厂」は同形別義
  ["叶", "traditional_merger"],
  // 葉 / 叶
  ["汇", "traditional_merger"]
  // 匯 / 彙
]));
var SIMPLIFIED_ONLY_CHARS = Object.freeze(/* @__PURE__ */ new Set([
  "东",
  "华",
  "济",
  "鲁",
  "岛",
  "车",
  "门",
  "马",
  "长",
  "广",
  "厂",
  "发",
  "云",
  "汇",
  "叶",
  "两",
  "为",
  "亚",
  "产",
  "价",
  "众",
  "传",
  "伟",
  "侨",
  "储",
  "决",
  "凉",
  "刘",
  "钟",
  "历",
  "复",
  "轮",
  "龙",
  "风",
  "飞",
  "鸟"
]));
var TRADITIONAL_ONLY_CHARS = Object.freeze(/* @__PURE__ */ new Set([
  "東",
  "華",
  "濟",
  "魯",
  "島",
  "車",
  "門",
  "馬",
  "長",
  "廣",
  "廠",
  "發",
  "雲",
  "匯",
  "葉",
  "兩",
  "為",
  "亞",
  "產",
  "價",
  "眾",
  "傳",
  "偉",
  "僑",
  "儲",
  "決",
  "涼",
  "劉",
  "鐘",
  "歷",
  "復",
  "輪",
  "龍",
  "風",
  "飛",
  "鳥"
]));
var SCRIPT_VALIDATION = Object.freeze({
  /** 期待 script の code point 比率がこれ未満なら scriptFit を fail とする。 */
  minScriptFitRatio: 0.6,
  /** 値に含めてよい非文字（空白 / 中黒 / ハイフン等）。fit 計算から除外する。 */
  neutralPattern: /[\s・·-‐-―()（）.,'’]/u,
  /** §52 と同じく異常長は拒否する。 */
  maxNativeCodePoints: 64,
  /**
   * Latin 文字が混じった値を「raw native form」と偽装しない（Phase 8 必須原則）。
   * native_form の値に Latin 文字が1文字でもあれば reject する。
   */
  forbidLatinInNativeForm: true
});
var MAPPING_ALIGNMENT = Object.freeze({
  /** AI が明示 segment mapping を返していない限り Lexical へ分解しない。 */
  requireExplicitSegmentMapping: true,
  /** Native span が重複していないこと。 */
  requireNonOverlappingNativeSpans: true,
  /** 分割 Native を再結合したものが全体 Native と一致すること。 */
  requireRecombinationMatch: true,
  /** 同一 source segment に対する Native 候補がこれを超えたら ambiguity 高で分解しない。 */
  maxNativeCandidatesPerSegment: 1
});
var NATIVE_REUSE_POLICY = Object.freeze({
  /** 再利用してよい trustTier。§53.2 REUSE_POLICY と同じ考え方。 */
  reusableTrustTiers: Object.freeze(/* @__PURE__ */ new Set(["learned", "trusted"])),
  /** provisional は clean（conflict/revalidation/quarantine なし）なら再利用。 */
  reuseProvisionalIfClean: true
});

// dictionary-native-script.js
var CHAR_CLASS = Object.freeze({
  han: "Han",
  hangul: "Hangul",
  kana: "Kana",
  latin: "Latin",
  digit: "Digit",
  punctuation: "Punctuation",
  other: "Other"
});
var RE_HAN = /\p{Script=Han}/u;
var RE_HANGUL = /\p{Script=Hangul}/u;
var RE_KANA = /\p{Script=Hiragana}|\p{Script=Katakana}|[ー゠]/u;
var RE_LATIN = /\p{Script=Latin}/u;
var RE_DIGIT = /\p{Nd}/u;
var RE_PUNCT = /[\p{P}\p{S}\p{Z}\s]/u;
function classifyChar(ch) {
  if (RE_HAN.test(ch)) return CHAR_CLASS.han;
  if (RE_HANGUL.test(ch)) return CHAR_CLASS.hangul;
  if (RE_KANA.test(ch)) return CHAR_CLASS.kana;
  if (RE_LATIN.test(ch)) return CHAR_CLASS.latin;
  if (RE_DIGIT.test(ch)) return CHAR_CLASS.digit;
  if (RE_PUNCT.test(ch)) return CHAR_CLASS.punctuation;
  return CHAR_CLASS.other;
}
__name(classifyChar, "classifyChar");
function analyzeScript(text) {
  const s = String(text ?? "");
  const counts = Object.fromEntries(Object.values(CHAR_CLASS).map((k) => [k, 0]));
  let codePoints = 0;
  let neutral = 0;
  for (const ch of s) {
    codePoints++;
    if (SCRIPT_VALIDATION.neutralPattern.test(ch)) {
      neutral++;
      continue;
    }
    counts[classifyChar(ch)]++;
  }
  const significant = codePoints - neutral;
  const present = Object.entries(counts).filter(([, n]) => n > 0).map(([k]) => k);
  return {
    codePoints,
    significant,
    counts,
    /** §82.1 mixedScriptFlags。Club名は Mixed になり得るので「異常」ではない。 */
    mixedScriptFlags: Object.freeze({
      mixed: present.length > 1,
      classes: Object.freeze(present.sort()),
      hasLatin: counts[CHAR_CLASS.latin] > 0,
      hasHan: counts[CHAR_CLASS.han] > 0,
      hasHangul: counts[CHAR_CLASS.hangul] > 0,
      hasKana: counts[CHAR_CLASS.kana] > 0
    })
  };
}
__name(analyzeScript, "analyzeScript");
function expectedClassFor(script) {
  switch (script) {
    case NATIVE_SCRIPT.hans:
    case NATIVE_SCRIPT.hant:
    case NATIVE_SCRIPT.hani:
      return CHAR_CLASS.han;
    case NATIVE_SCRIPT.hang:
      return CHAR_CLASS.hangul;
    case NATIVE_SCRIPT.kana:
      return CHAR_CLASS.kana;
    case NATIVE_SCRIPT.jpan:
      return null;
    default:
      return null;
  }
}
__name(expectedClassFor, "expectedClassFor");
function validateNativeScript(value, declaredScript) {
  const analysis = analyzeScript(value);
  const reasons = [];
  if (!value || analysis.significant === 0) {
    reasons.push("empty_or_neutral_only");
  }
  if (analysis.codePoints > SCRIPT_VALIDATION.maxNativeCodePoints) {
    reasons.push("too_long");
  }
  if (SCRIPT_VALIDATION.forbidLatinInNativeForm && analysis.mixedScriptFlags.hasLatin) {
    reasons.push("latin_in_native_form");
  }
  const expected = expectedClassFor(declaredScript);
  let scriptFitScore = null;
  if (expected !== null && analysis.significant > 0) {
    scriptFitScore = analysis.counts[expected] / analysis.significant;
    if (scriptFitScore < SCRIPT_VALIDATION.minScriptFitRatio) reasons.push("script_fit_below_threshold");
  } else if (declaredScript === NATIVE_SCRIPT.jpan && analysis.significant > 0) {
    const cjk = analysis.counts[CHAR_CLASS.han] + analysis.counts[CHAR_CLASS.kana];
    scriptFitScore = cjk / analysis.significant;
    if (scriptFitScore < SCRIPT_VALIDATION.minScriptFitRatio) reasons.push("script_fit_below_threshold");
  }
  return {
    ok: reasons.length === 0,
    /** §82.1:「Han文字として妥当」の Validation 用。Hans/Hant 分類には使わない。 */
    scriptFitScore,
    mixedScriptFlags: analysis.mixedScriptFlags,
    reasons: Object.freeze(reasons),
    analysis
  };
}
__name(validateNativeScript, "validateNativeScript");

// dictionary-ai-envelope.js
var ENVELOPE_ERROR = Object.freeze({
  notJson: "invalid_json",
  notObject: "not_an_object",
  schemaVersion: "unsupported_schema_version",
  requestItemIdMismatch: "request_item_id_mismatch",
  inputFingerprintMismatch: "input_fingerprint_mismatch",
  badStatus: "invalid_status",
  segmentsNotArray: "segments_not_array",
  tooManySegments: "too_many_segments",
  segmentNotObject: "segment_not_an_object",
  segmentIdMissing: "segment_id_missing",
  duplicateSegmentId: "duplicate_segment_id",
  unrequestedSegmentId: "unrequested_segment_id",
  readingNotString: "reading_not_a_string",
  readingEmpty: "reading_empty",
  readingTooLong: "reading_too_long",
  badLanguage: "invalid_language_tag",
  badRole: "invalid_role",
  badReusable: "invalid_reusable",
  badSubSegments: "invalid_sub_segment_mapping",
  unknownProfile: "unknown_prompt_profile",
  // --- Phase 8 §76 / §82.1 / §120「Schema Validation前に保存しない」 ---------
  nativeNotObject: "native_not_an_object",
  badNativeScript: "invalid_native_script",
  nativeValueNotString: "native_value_not_a_string",
  nativeValueEmpty: "native_value_empty",
  nativeValueTooLong: "native_value_too_long",
  /** §82.1 Native Script Validation 不合格（Latin混入 / scriptFit不足など）。 */
  nativeScriptValidationFailed: "native_script_validation_failed",
  badNativeSubSegments: "invalid_native_sub_segment_mapping",
  badLoanwordFlag: "invalid_loanword_flag",
  /** §82/§83: Hanja 候補は Hani script の Han 文字だけ。 */
  badHanjaCandidate: "invalid_hanja_candidate"
});
var ENVELOPE_STATUS = Object.freeze({
  resolved: "resolved",
  partial: "partial",
  unresolved: "unresolved"
});
var ROLES = new Set(ROLE_ENUM);
var LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
var CODE_FENCE = /```json|```/gi;
function codePointLength(s) {
  let n = 0;
  for (const _ of String(s ?? "")) n++;
  return n;
}
__name(codePointLength, "codePointLength");
function extractJsonObject(rawText) {
  const s = String(rawText ?? "").replace(CODE_FENCE, "").trim();
  if (!s) return { ok: false, code: ENVELOPE_ERROR.notJson, reason: "empty response" };
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ok: false, code: ENVELOPE_ERROR.notJson, reason: "no JSON object found" };
  }
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, code: ENVELOPE_ERROR.notObject, reason: "top level is not an object" };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    return { ok: false, code: ENVELOPE_ERROR.notJson, reason: String(e?.message ?? e) };
  }
}
__name(extractJsonObject, "extractJsonObject");
function validateEnvelope(rawText, request, policy = AI_POLICY) {
  const errors = [];
  const fail = /* @__PURE__ */ __name((code, detail) => {
    errors.push({ code, detail });
  }, "fail");
  const profile = PROMPT_PROFILES_BY_ID[request?.promptProfileId];
  if (!profile) {
    fail(ENVELOPE_ERROR.unknownProfile, request?.promptProfileId ?? null);
    return { ok: false, envelope: null, errors, missingSegmentIds: [] };
  }
  const parsed = extractJsonObject(rawText);
  if (!parsed.ok) {
    fail(parsed.code, parsed.reason);
    return { ok: false, envelope: null, errors, missingSegmentIds: [] };
  }
  const body = parsed.value;
  if (body.schemaVersion !== void 0 && body.schemaVersion !== AI_ENVELOPE_SCHEMA_VERSION) {
    fail(ENVELOPE_ERROR.schemaVersion, body.schemaVersion);
  }
  if (typeof body.requestItemId !== "string" || body.requestItemId !== request.requestItemId) {
    fail(
      ENVELOPE_ERROR.requestItemIdMismatch,
      { expected: request.requestItemId, got: body.requestItemId ?? null }
    );
  }
  if (body.inputFingerprint !== void 0 && body.inputFingerprint !== null && body.inputFingerprint !== request.inputFingerprint) {
    fail(
      ENVELOPE_ERROR.inputFingerprintMismatch,
      { expected: request.inputFingerprint, got: body.inputFingerprint }
    );
  }
  const status = body.status ?? ENVELOPE_STATUS.resolved;
  if (!Object.values(ENVELOPE_STATUS).includes(status)) {
    fail(ENVELOPE_ERROR.badStatus, status);
  }
  if (!Array.isArray(body.segments)) {
    fail(ENVELOPE_ERROR.segmentsNotArray, typeof body.segments);
    return { ok: false, envelope: null, errors, missingSegmentIds: [] };
  }
  if (body.segments.length > policy.response.maxSegmentsPerItem) {
    fail(ENVELOPE_ERROR.tooManySegments, body.segments.length);
  }
  const requested = new Set(request.requestedSegmentIds ?? []);
  const seen = /* @__PURE__ */ new Set();
  const segments = [];
  for (const raw of body.segments) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      fail(ENVELOPE_ERROR.segmentNotObject, raw);
      continue;
    }
    const segmentId = raw.segmentId;
    if (typeof segmentId !== "string" || !segmentId) {
      fail(ENVELOPE_ERROR.segmentIdMissing, segmentId ?? null);
      continue;
    }
    if (seen.has(segmentId)) {
      fail(ENVELOPE_ERROR.duplicateSegmentId, segmentId);
      continue;
    }
    seen.add(segmentId);
    if (!requested.has(segmentId)) {
      fail(ENVELOPE_ERROR.unrequestedSegmentId, segmentId);
      continue;
    }
    if (typeof raw.reading !== "string") {
      fail(ENVELOPE_ERROR.readingNotString, { segmentId, got: typeof raw.reading });
      continue;
    }
    const reading = raw.reading.trim();
    if (!reading) {
      fail(ENVELOPE_ERROR.readingEmpty, segmentId);
      continue;
    }
    if (codePointLength(reading) > policy.response.maxValueCodePoints) {
      fail(ENVELOPE_ERROR.readingTooLong, { segmentId, length: codePointLength(reading) });
      continue;
    }
    let language = null;
    if (raw.language !== void 0 && raw.language !== null) {
      if (typeof raw.language === "string" && LANGUAGE_TAG.test(raw.language.trim())) {
        language = raw.language.trim();
      } else {
        fail(ENVELOPE_ERROR.badLanguage, { segmentId, got: raw.language });
      }
    }
    let role = null;
    if (raw.role !== void 0 && raw.role !== null) {
      if (typeof raw.role === "string" && ROLES.has(raw.role)) role = raw.role;
      else fail(ENVELOPE_ERROR.badRole, { segmentId, got: raw.role });
    }
    let reusable = null;
    if (raw.reusable !== void 0 && raw.reusable !== null) {
      if (typeof raw.reusable === "boolean") reusable = raw.reusable;
      else fail(ENVELOPE_ERROR.badReusable, { segmentId, got: raw.reusable });
    }
    const subSegments = validateSubSegments(raw.subSegments, { segmentId, request, policy, fail });
    const native = validateNative(raw.native, { segmentId, profile, policy, fail });
    const nativeSubSegments = validateNativeSubSegments(
      raw.nativeSubSegments,
      { segmentId, request, profile, policy, fail }
    );
    let loanword = null;
    if (profile.nativeEnabled === true && raw.loanword !== void 0 && raw.loanword !== null) {
      if (typeof raw.loanword === "boolean") loanword = raw.loanword;
      else fail(ENVELOPE_ERROR.badLoanwordFlag, { segmentId, got: raw.loanword });
    }
    segments.push({
      segmentId,
      reading,
      language,
      role,
      reusable,
      subSegments,
      /**
       * §76 例の `native: {script, value}`。§79/§80: Native Form は
       * Japanese Reading/Display とは **別 Claim** になる。
       */
      native,
      /** §76.1 explicit segment mapping（無ければ null = 分解しない）。 */
      nativeSubSegments,
      /** §82:「Brand/外来語を無理にHanja化しない」の AI 側 Hint（Authority ではない）。 */
      loanword,
      /** §51 / §16: AI自己申告 confidence は **診断用のみ**。Truth Authority ではない。 */
      modelSelfConfidence: typeof raw.confidence === "number" ? raw.confidence : null
    });
  }
  const missingSegmentIds = [...requested].filter((id) => !seen.has(id));
  if (errors.length > 0) {
    return { ok: false, envelope: null, errors, missingSegmentIds };
  }
  const effectiveStatus = missingSegmentIds.length === 0 ? segments.length > 0 ? ENVELOPE_STATUS.resolved : ENVELOPE_STATUS.unresolved : segments.length > 0 ? ENVELOPE_STATUS.partial : ENVELOPE_STATUS.unresolved;
  return {
    ok: true,
    envelope: Object.freeze({
      schemaVersion: AI_ENVELOPE_SCHEMA_VERSION,
      requestItemId: request.requestItemId,
      inputFingerprint: request.inputFingerprint,
      promptProfileId: profile.promptProfileId,
      promptVersion: profile.promptVersion,
      /** §51.3:「unresolved 自体は Contradict Evidence ではない」。 */
      status: effectiveStatus,
      declaredStatus: status,
      segments: Object.freeze(segments),
      missingSegmentIds: Object.freeze(missingSegmentIds)
    }),
    errors,
    missingSegmentIds
  };
}
__name(validateEnvelope, "validateEnvelope");
function validateSubSegments(rawSubs, { segmentId, request, policy, fail }) {
  if (rawSubs === void 0 || rawSubs === null) return null;
  if (!Array.isArray(rawSubs) || rawSubs.length === 0) {
    fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "not a non-empty array" });
    return null;
  }
  const span = (request.sourceSpans ?? []).find((s) => s.segmentId === segmentId);
  if (!span) {
    fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "no matching requested span" });
    return null;
  }
  const out = [];
  for (const sub of rawSubs) {
    if (sub === null || typeof sub !== "object") {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "sub is not an object" });
      return null;
    }
    const { sourceStart, sourceEnd, reading } = sub;
    if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd) || sourceEnd <= sourceStart) {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "bad offsets", sub });
      return null;
    }
    if (sourceStart < span.sourceStart || sourceEnd > span.sourceEnd) {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "outside requested span", sub });
      return null;
    }
    if (typeof reading !== "string" || !reading.trim()) {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "bad sub reading", sub });
      return null;
    }
    if (codePointLength(reading) > policy.response.maxValueCodePoints) {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "sub reading too long" });
      return null;
    }
    out.push({ sourceStart, sourceEnd, reading: reading.trim() });
  }
  out.sort((a, b) => a.sourceStart - b.sourceStart);
  for (let i = 1; i < out.length; i++) {
    if (out[i].sourceStart < out[i - 1].sourceEnd) {
      fail(ENVELOPE_ERROR.badSubSegments, { segmentId, reason: "overlapping sub spans" });
      return null;
    }
  }
  return out;
}
__name(validateSubSegments, "validateSubSegments");
var AI_DECLARABLE_NATIVE_SCRIPTS = /* @__PURE__ */ new Set([
  NATIVE_SCRIPT.hans,
  NATIVE_SCRIPT.hant,
  NATIVE_SCRIPT.hani,
  NATIVE_SCRIPT.hang
]);
function validateNative(rawNative, { segmentId, profile, policy, fail }) {
  if (rawNative === void 0 || rawNative === null) return null;
  if (profile.nativeEnabled !== true) return null;
  if (typeof rawNative !== "object" || Array.isArray(rawNative)) {
    fail(ENVELOPE_ERROR.nativeNotObject, { segmentId, got: typeof rawNative });
    return null;
  }
  const script = rawNative.script;
  if (typeof script !== "string" || !AI_DECLARABLE_NATIVE_SCRIPTS.has(script)) {
    fail(ENVELOPE_ERROR.badNativeScript, { segmentId, got: script ?? null });
    return null;
  }
  if (typeof rawNative.value !== "string") {
    fail(ENVELOPE_ERROR.nativeValueNotString, { segmentId, got: typeof rawNative.value });
    return null;
  }
  const value = rawNative.value.trim();
  if (!value) {
    fail(ENVELOPE_ERROR.nativeValueEmpty, segmentId);
    return null;
  }
  if (codePointLength(value) > SCRIPT_VALIDATION.maxNativeCodePoints || codePointLength(value) > policy.response.maxValueCodePoints) {
    fail(ENVELOPE_ERROR.nativeValueTooLong, { segmentId, length: codePointLength(value) });
    return null;
  }
  const check = validateNativeScript(value, script);
  if (!check.ok) {
    fail(
      ENVELOPE_ERROR.nativeScriptValidationFailed,
      { segmentId, script, reasons: check.reasons }
    );
    return null;
  }
  const hanja = validateHanjaCandidate(rawNative.hanja, { segmentId, policy, fail });
  return {
    /** AI の **自己申告** script。Hans/Hant の Authority 判定は §79.1 で別途行う。 */
    declaredScript: script,
    value,
    /** §82.1: Diagnostic。Claim value の Authority field にはしない。 */
    scriptFitScore: check.scriptFitScore,
    mixedScriptFlags: check.mixedScriptFlags,
    /**
     * §82:「Hanjaは十分なEvidenceがあるSegmentだけ」。ここでは **候補として型検証
     * するだけ** で、採用可否は §83 の strong evidence gate が決める。
     */
    hanja
  };
}
__name(validateNative, "validateNative");
function validateHanjaCandidate(rawHanja, { segmentId, policy, fail }) {
  if (rawHanja === void 0 || rawHanja === null) return null;
  if (typeof rawHanja !== "object" || Array.isArray(rawHanja)) {
    fail(ENVELOPE_ERROR.badHanjaCandidate, { segmentId, reason: "not an object" });
    return null;
  }
  if (rawHanja.script !== NATIVE_SCRIPT.hani) {
    fail(ENVELOPE_ERROR.badHanjaCandidate, { segmentId, reason: "script must be Hani", got: rawHanja.script ?? null });
    return null;
  }
  if (typeof rawHanja.value !== "string" || !rawHanja.value.trim()) {
    fail(ENVELOPE_ERROR.badHanjaCandidate, { segmentId, reason: "bad value" });
    return null;
  }
  const value = rawHanja.value.trim();
  if (codePointLength(value) > SCRIPT_VALIDATION.maxNativeCodePoints || codePointLength(value) > policy.response.maxValueCodePoints) {
    fail(ENVELOPE_ERROR.badHanjaCandidate, { segmentId, reason: "too long" });
    return null;
  }
  const check = validateNativeScript(value, NATIVE_SCRIPT.hani);
  if (!check.ok) {
    fail(ENVELOPE_ERROR.badHanjaCandidate, { segmentId, reason: "script validation failed", reasons: check.reasons });
    return null;
  }
  return {
    declaredScript: NATIVE_SCRIPT.hani,
    value,
    scriptFitScore: check.scriptFitScore,
    mixedScriptFlags: check.mixedScriptFlags
  };
}
__name(validateHanjaCandidate, "validateHanjaCandidate");
function validateNativeSubSegments(rawSubs, { segmentId, request, profile, policy, fail }) {
  if (rawSubs === void 0 || rawSubs === null) return null;
  if (profile.nativeEnabled !== true) return null;
  if (!Array.isArray(rawSubs) || rawSubs.length === 0) {
    fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "not a non-empty array" });
    return null;
  }
  const span = (request.sourceSpans ?? []).find((s) => s.segmentId === segmentId);
  if (!span) {
    fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "no matching requested span" });
    return null;
  }
  const out = [];
  for (const sub of rawSubs) {
    if (sub === null || typeof sub !== "object" || Array.isArray(sub)) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "sub is not an object" });
      return null;
    }
    const { sourceStart, sourceEnd, script, value } = sub;
    if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd) || sourceEnd <= sourceStart) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "bad offsets", sub });
      return null;
    }
    if (sourceStart < span.sourceStart || sourceEnd > span.sourceEnd) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "outside requested span", sub });
      return null;
    }
    if (typeof script !== "string" || !AI_DECLARABLE_NATIVE_SCRIPTS.has(script)) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "bad sub script", sub });
      return null;
    }
    if (typeof value !== "string" || !value.trim()) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "bad sub native value", sub });
      return null;
    }
    const trimmed = value.trim();
    if (codePointLength(trimmed) > SCRIPT_VALIDATION.maxNativeCodePoints) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "sub native value too long" });
      return null;
    }
    const check = validateNativeScript(trimmed, script);
    if (!check.ok) {
      fail(
        ENVELOPE_ERROR.badNativeSubSegments,
        { segmentId, reason: "sub native script validation failed", reasons: check.reasons }
      );
      return null;
    }
    out.push({
      sourceStart,
      sourceEnd,
      declaredScript: script,
      value: trimmed,
      scriptFitScore: check.scriptFitScore,
      mixedScriptFlags: check.mixedScriptFlags,
      /** §51.4 と同じく reading も持てる（Japanese Reading は別 Claim）。 */
      reading: typeof sub.reading === "string" && sub.reading.trim() ? sub.reading.trim() : null,
      loanword: typeof sub.loanword === "boolean" ? sub.loanword : null,
      /** §83.1: Hanja は **Segment 単位** でのみ受け取る（全体1個の推測Hanjaを作らない）。 */
      hanja: validateHanjaCandidate(sub.hanja, { segmentId, policy, fail })
    });
  }
  out.sort((a, b) => a.sourceStart - b.sourceStart);
  for (let i = 1; i < out.length; i++) {
    if (out[i].sourceStart < out[i - 1].sourceEnd) {
      fail(ENVELOPE_ERROR.badNativeSubSegments, { segmentId, reason: "overlapping sub spans" });
      return null;
    }
  }
  return out;
}
__name(validateNativeSubSegments, "validateNativeSubSegments");

// dictionary-ai-provider.js
var PROVIDER = Object.freeze({ gemini: "gemini", groq: "groq" });
var PROVIDER_FAILURE = Object.freeze({
  timeout: "timeout",
  rateLimited: "rate_limited",
  // 429
  serverBusy: "server_busy",
  // 500 / 503 / overloaded
  network: "network_error",
  http: "http_error",
  emptyResponse: "empty_response",
  cooldown: "cooldown_active",
  budgetExhausted: "budget_exhausted",
  noApiKey: "no_api_key",
  cancelled: "cancelled"
});
var ProviderError = class extends Error {
  static {
    __name(this, "ProviderError");
  }
  constructor(failure, message, details) {
    super(message);
    this.name = "ProviderError";
    this.failure = failure;
    this.details = details ?? null;
    this.isEvidence = false;
  }
};
function isRetryableFailure(failure) {
  return failure === PROVIDER_FAILURE.timeout || failure === PROVIDER_FAILURE.rateLimited || failure === PROVIDER_FAILURE.serverBusy || failure === PROVIDER_FAILURE.network;
}
__name(isRetryableFailure, "isRetryableFailure");
function classifyHttp(status, message) {
  if (status === 429) return PROVIDER_FAILURE.rateLimited;
  if (status === 500 || status === 503 || status === 529) return PROVIDER_FAILURE.serverBusy;
  const m = String(message ?? "").toLowerCase();
  if (m.includes("overload") || m.includes("unavailable") || m.includes("high demand")) {
    return PROVIDER_FAILURE.serverBusy;
  }
  return PROVIDER_FAILURE.http;
}
__name(classifyHttp, "classifyHttp");
function createProviderAdapter({
  provider,
  apiKey,
  model = null,
  fetchImpl = null,
  policy = AI_POLICY,
  timeoutMs = null,
  now = /* @__PURE__ */ __name(() => Date.now(), "now")
} = {}) {
  if (provider !== PROVIDER.gemini && provider !== PROVIDER.groq) {
    throw new ProviderError(PROVIDER_FAILURE.http, `unknown provider: ${provider}`, { provider });
  }
  const doFetch = fetchImpl ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (typeof doFetch !== "function") {
    throw new ProviderError(PROVIDER_FAILURE.network, "no fetch implementation available", {});
  }
  const requestedModel = model ?? policy.provider.defaultModel[provider];
  const effectiveTimeout = timeoutMs ?? policy.provider.timeoutMs;
  async function generate({ promptText, structuredOutput = true, signal = null } = {}) {
    if (!apiKey) throw new ProviderError(PROVIDER_FAILURE.noApiKey, "API key is not set", { provider });
    const started = now();
    let url;
    let headers;
    let body;
    if (provider === PROVIDER.groq) {
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      body = { model: requestedModel, messages: [{ role: "user", content: promptText }] };
      if (structuredOutput) body.response_format = { type: "json_object" };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      headers = { "Content-Type": "application/json" };
      body = { contents: [{ role: "user", parts: [{ text: promptText }] }] };
      if (structuredOutput) body.generationConfig = { responseMimeType: "application/json" };
    }
    const res = await withTimeout(
      doFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal }),
      effectiveTimeout,
      provider,
      now
    ).catch((e) => {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(PROVIDER_FAILURE.network, String(e?.message ?? e), { provider });
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err?.error?.message || `HTTP ${res.status}`;
      throw new ProviderError(
        classifyHttp(res.status, message),
        message,
        { provider, status: res.status, retryAfterMs: parseRetryAfter(message) }
      );
    }
    const data = await res.json().catch((e) => {
      throw new ProviderError(
        PROVIDER_FAILURE.network,
        `response body is not JSON: ${e?.message}`,
        { provider }
      );
    });
    let rawText;
    let returnedModel;
    let usage;
    if (provider === PROVIDER.groq) {
      rawText = data?.choices?.[0]?.message?.content;
      returnedModel = typeof data?.model === "string" ? data.model : null;
      usage = data?.usage ? { inputTokens: data.usage.prompt_tokens ?? null, outputTokens: data.usage.completion_tokens ?? null } : null;
    } else {
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      returnedModel = typeof data?.modelVersion === "string" ? data.modelVersion : null;
      usage = data?.usageMetadata ? {
        inputTokens: data.usageMetadata.promptTokenCount ?? null,
        outputTokens: data.usageMetadata.candidatesTokenCount ?? null
      } : null;
    }
    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new ProviderError(
        PROVIDER_FAILURE.emptyResponse,
        "provider returned no text",
        { provider }
      );
    }
    return {
      rawText: rawText.trim(),
      provider,
      requestedModel,
      /** §22.3:「returnedModel も Raw provenance として保持」。 */
      returnedModel,
      /** §48 / §147.8: provider が返す usage は診断用。単位を provider 間で同一視しない。 */
      usage,
      latencyMs: now() - started
    };
  }
  __name(generate, "generate");
  return Object.freeze({
    provider,
    requestedModel,
    supportsStructuredOutput: true,
    maxBatchSize: policy.provider.maxBatchSize[provider],
    retryPolicy: policy.retry,
    generate
  });
}
__name(createProviderAdapter, "createProviderAdapter");
function parseRetryAfter(message) {
  const m = String(message ?? "").match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1e3) : null;
}
__name(parseRetryAfter, "parseRetryAfter");
function withTimeout(promise, ms, provider, now) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ProviderError(
        PROVIDER_FAILURE.timeout,
        `provider timed out after ${ms}ms`,
        { provider, at: now() }
      ));
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      }
    );
  });
}
__name(withTimeout, "withTimeout");
function createCooldownRegistry({ policy = AI_POLICY, now = /* @__PURE__ */ __name(() => Date.now(), "now") } = {}) {
  const state = /* @__PURE__ */ new Map();
  function entry(provider) {
    let e = state.get(provider);
    if (!e) {
      e = { consecutiveFailures: 0, cooldownUntil: 0, cooldownMs: policy.cooldown.cooldownMs };
      state.set(provider, e);
    }
    return e;
  }
  __name(entry, "entry");
  return {
    isCoolingDown(provider) {
      const e = entry(provider);
      return e.cooldownUntil > now();
    },
    remainingMs(provider) {
      const e = entry(provider);
      return Math.max(0, e.cooldownUntil - now());
    },
    recordSuccess(provider) {
      const e = entry(provider);
      e.consecutiveFailures = 0;
      e.cooldownUntil = 0;
      e.cooldownMs = policy.cooldown.cooldownMs;
    },
    /** @returns {{cooldownStarted:boolean, consecutiveFailures:number, cooldownUntil:number}} */
    recordFailure(provider) {
      const e = entry(provider);
      e.consecutiveFailures++;
      let started = false;
      if (e.consecutiveFailures >= policy.cooldown.consecutiveFailureThreshold) {
        e.cooldownUntil = now() + e.cooldownMs;
        e.cooldownMs = Math.min(policy.cooldown.maxCooldownMs, e.cooldownMs * 2);
        started = true;
      }
      return {
        cooldownStarted: started,
        consecutiveFailures: e.consecutiveFailures,
        cooldownUntil: e.cooldownUntil
      };
    },
    snapshot() {
      return Object.fromEntries([...state.entries()].map(([k, v]) => [k, { ...v }]));
    }
  };
}
__name(createCooldownRegistry, "createCooldownRegistry");
function backoffDelayMs(attempt, retryAfterMs, {
  policy = AI_POLICY,
  random = Math.random
} = {}) {
  const base = Math.min(policy.retry.maxDelayMs, policy.retry.baseDelayMs * 2 ** attempt);
  const chosen = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(policy.retry.maxDelayMs, retryAfterMs) : base;
  return Math.round(chosen * (1 + random() * policy.retry.jitterRatio));
}
__name(backoffDelayMs, "backoffDelayMs");
async function callWithRetry(adapter, args, {
  policy = AI_POLICY,
  cooldown = null,
  sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep"),
  random = Math.random,
  budget = null,
  onAttempt = null
} = {}) {
  if (cooldown?.isCoolingDown(adapter.provider)) {
    throw new ProviderError(
      PROVIDER_FAILURE.cooldown,
      `provider ${adapter.provider} is cooling down`,
      { provider: adapter.provider, remainingMs: cooldown.remainingMs(adapter.provider) }
    );
  }
  let providerCalls = 0;
  let retryCalls = 0;
  let lastError = null;
  for (let attempt = 0; attempt < policy.retry.maxAttempts; attempt++) {
    if (budget && !budget.canSpendProviderCall()) {
      throw new ProviderError(
        PROVIDER_FAILURE.budgetExhausted,
        "AI budget exhausted",
        { provider: adapter.provider, budget: budget.snapshot() }
      );
    }
    try {
      providerCalls++;
      if (attempt > 0) retryCalls++;
      budget?.recordProviderCall({ retry: attempt > 0 });
      onAttempt?.({ attempt, provider: adapter.provider });
      const result = await adapter.generate(args);
      cooldown?.recordSuccess(adapter.provider);
      return { result, attempts: attempt + 1, providerCalls, retryCalls };
    } catch (e) {
      lastError = e instanceof ProviderError ? e : new ProviderError(PROVIDER_FAILURE.network, String(e?.message ?? e), {});
      const cd = cooldown?.recordFailure(adapter.provider);
      if (!isRetryableFailure(lastError.failure)) break;
      if (cd?.cooldownStarted) break;
      if (attempt === policy.retry.maxAttempts - 1) break;
      if (budget && !budget.canSpendRetry()) break;
      await sleep(backoffDelayMs(attempt, lastError.details?.retryAfterMs, { policy, random }));
    }
  }
  lastError.providerCalls = providerCalls;
  lastError.retryCalls = retryCalls;
  throw lastError;
}
__name(callWithRetry, "callWithRetry");

// dictionary-ai-request.js
var AI_REQUEST_IDENTITY_VERSION = 1;
var STALE_REASON = Object.freeze({
  manualWinnerChanged: "manual_winner_changed",
  entitySourceChanged: "entity_source_changed",
  inputFingerprintChanged: "input_fingerprint_changed",
  policyOnlyChanged: "policy_only_changed",
  maintenanceSchemaChanged: "maintenance_schema_changed"
});
var AI_COMMIT_DISPOSITION = Object.freeze({
  accepted: COMMIT_DISPOSITION.accepted,
  evidenceOnly: COMMIT_DISPOSITION.evidenceOnly,
  quarantined: COMMIT_DISPOSITION.quarantined,
  discarded: "discarded"
});
async function computeLogicalGenerationItemId({
  spanText,
  target = null,
  countryCode = null,
  worldRegionCode = null,
  promptProfileId,
  promptVersion,
  generationStrategyVersion = GENERATION_STRATEGY_VERSION,
  languageConditioning = null,
  roleConditioning = null,
  surroundingStructure = null,
  rejectedValues = [],
  anchored = false,
  revalidationRunId = null
}) {
  return stableHash({
    schema: "ai-logical-generation-item",
    version: AI_REQUEST_IDENTITY_VERSION,
    normalizedSpan: strictNormalizedSource(spanText),
    target,
    countryCode,
    worldRegionCode,
    promptProfileId,
    promptVersion,
    generationStrategyVersion,
    languageConditioning,
    roleConditioning,
    surroundingStructure,
    // §24.1: Rejection を見せたかどうかは論理 item の一部（回答が変わり得る）。
    rejectedValues: [...rejectedValues].sort(),
    anchored: Boolean(anchored),
    // §21:「別の Blind Revalidation run では新しくする」。
    revalidationRunId
  });
}
__name(computeLogicalGenerationItemId, "computeLogicalGenerationItemId");
async function computeObservationContextId({
  entityKey = null,
  target = null,
  inputFingerprint,
  segmentId
}) {
  return stableHash({
    schema: "ai-observation-context",
    version: AI_REQUEST_IDENTITY_VERSION,
    entityKey,
    target,
    inputFingerprint,
    segmentId
  });
}
__name(computeObservationContextId, "computeObservationContextId");
function surroundingStructureSignature({ knownSegments = [], spanIndex = 0, spanCount = 1 }) {
  return [
    `k${knownSegments.length}`,
    `i${spanIndex}`,
    `n${spanCount}`,
    knownSegments.map((k) => strictNormalizedSource(k.text)).sort().join("|")
  ].join(":");
}
__name(surroundingStructureSignature, "surroundingStructureSignature");
function createRequestCoordinator() {
  const inFlight = /* @__PURE__ */ new Map();
  const completed = /* @__PURE__ */ new Map();
  const stats = { requested: 0, providerRuns: 0, dedupedInFlight: 0, dedupedCompleted: 0 };
  return {
    stats,
    /**
     * @param logicalGenerationItemId 論理 item ID
     * @param run 実際に provider を呼ぶ関数（この ID につき最大1回だけ実行される）
     */
    async run(logicalGenerationItemId, run) {
      stats.requested++;
      if (completed.has(logicalGenerationItemId)) {
        stats.dedupedCompleted++;
        return { ...completed.get(logicalGenerationItemId), deduped: true, dedupeKind: "completed" };
      }
      const pending = inFlight.get(logicalGenerationItemId);
      if (pending) {
        stats.dedupedInFlight++;
        const shared = await pending;
        return { ...shared, deduped: true, dedupeKind: "in_flight" };
      }
      stats.providerRuns++;
      const p = (async () => run())();
      inFlight.set(logicalGenerationItemId, p);
      try {
        const value = await p;
        completed.set(logicalGenerationItemId, value);
        return { ...value, deduped: false, dedupeKind: null };
      } finally {
        inFlight.delete(logicalGenerationItemId);
      }
    },
    has(id) {
      return inFlight.has(id) || completed.has(id);
    },
    snapshot() {
      return { ...stats, completedCount: completed.size, inFlightCount: inFlight.size };
    }
  };
}
__name(createRequestCoordinator, "createRequestCoordinator");
async function captureRequestSnapshot(db, {
  sourceText,
  target = null,
  entityKey = null,
  inputFingerprint,
  seededClaimIds = [],
  lockedClaimIds = []
}) {
  const meta = await getMeta(db);
  const entity = await computeSourceNameFingerprint(sourceText, { target });
  const seededClaimSemanticRevisions = {};
  for (const claimId of [.../* @__PURE__ */ new Set([...seededClaimIds, ...lockedClaimIds])]) {
    const claim = await getClaim(db, claimId);
    seededClaimSemanticRevisions[claimId] = claim ? {
      semanticRevision: claim.semanticRevision ?? 0,
      locked: claim.locked === true,
      verificationState: claim.verificationState ?? null,
      lifecycleState: claim.lifecycleState ?? null
    } : null;
  }
  return Object.freeze({
    capturedAt: Date.now(),
    inputFingerprint,
    entityKey,
    target,
    entitySourceFingerprint: entity.sourceNameFingerprint,
    requestBaseDictionaryRevision: meta.userDictionaryRevision ?? 0,
    schemaCompatibilityEpoch: meta.schemaCompatibilityEpoch ?? null,
    resolutionPolicyEpoch: meta.resolverVersion ?? null,
    seededClaimSemanticRevisions
  });
}
__name(captureRequestSnapshot, "captureRequestSnapshot");
async function evaluateStaleGate(db, snapshot, {
  currentSourceText = null,
  currentInputFingerprint = null,
  now = Date.now()
} = {}) {
  const meta = await getMeta(db);
  const reasons = [];
  const detail = {};
  if (currentInputFingerprint != null && currentInputFingerprint !== snapshot.inputFingerprint) {
    reasons.push(STALE_REASON.inputFingerprintChanged);
    detail.inputFingerprint = { was: snapshot.inputFingerprint, now: currentInputFingerprint };
  }
  if (currentSourceText != null) {
    const cur = await computeSourceNameFingerprint(currentSourceText, { target: snapshot.target });
    if (cur.sourceNameFingerprint !== snapshot.entitySourceFingerprint) {
      reasons.push(STALE_REASON.entitySourceChanged);
      detail.entitySourceFingerprint = { was: snapshot.entitySourceFingerprint, now: cur.sourceNameFingerprint };
    }
  }
  const claimChanges = [];
  for (const [claimId, was] of Object.entries(snapshot.seededClaimSemanticRevisions ?? {})) {
    const cur = await getClaim(db, claimId);
    if (was === null && cur == null) continue;
    if (was === null || cur == null) {
      claimChanges.push({ claimId, kind: "existence" });
      continue;
    }
    if ((cur.semanticRevision ?? 0) !== was.semanticRevision) {
      claimChanges.push({ claimId, kind: "semanticRevision" });
    } else if (cur.locked === true !== was.locked) {
      claimChanges.push({ claimId, kind: "locked" });
    } else if ((cur.verificationState ?? null) !== was.verificationState) {
      claimChanges.push({ claimId, kind: "verificationState" });
    } else if ((cur.lifecycleState ?? null) !== was.lifecycleState) {
      claimChanges.push({ claimId, kind: "lifecycleState" });
    }
  }
  if (claimChanges.length > 0) {
    reasons.push(STALE_REASON.manualWinnerChanged);
    detail.claimChanges = claimChanges;
  }
  if (snapshot.schemaCompatibilityEpoch != null && (meta.schemaCompatibilityEpoch ?? null) !== snapshot.schemaCompatibilityEpoch) {
    reasons.push(STALE_REASON.maintenanceSchemaChanged);
    detail.schemaCompatibilityEpoch = {
      was: snapshot.schemaCompatibilityEpoch,
      now: meta.schemaCompatibilityEpoch ?? null
    };
  }
  if (reasons.length === 0 && (meta.userDictionaryRevision ?? 0) !== snapshot.requestBaseDictionaryRevision) {
    reasons.push(STALE_REASON.policyOnlyChanged);
    detail.userDictionaryRevision = {
      was: snapshot.requestBaseDictionaryRevision,
      now: meta.userDictionaryRevision ?? 0
    };
  }
  return { ...dispositionFor(reasons), stale: reasons.length > 0, reasons, detail, evaluatedAt: now };
}
__name(evaluateStaleGate, "evaluateStaleGate");
function dispositionFor(reasons) {
  const has = /* @__PURE__ */ __name((r) => reasons.includes(r), "has");
  if (has(STALE_REASON.maintenanceSchemaChanged)) {
    return {
      commitDisposition: AI_COMMIT_DISPOSITION.quarantined,
      applyToCurrentResult: false,
      allowLexicalObservation: false,
      allowEntityPhraseClaim: false,
      staleReason: STALE_REASON.maintenanceSchemaChanged
    };
  }
  if (has(STALE_REASON.inputFingerprintChanged) || has(STALE_REASON.entitySourceChanged)) {
    return {
      commitDisposition: AI_COMMIT_DISPOSITION.discarded,
      applyToCurrentResult: false,
      allowLexicalObservation: false,
      allowEntityPhraseClaim: false,
      staleReason: has(STALE_REASON.inputFingerprintChanged) ? STALE_REASON.inputFingerprintChanged : STALE_REASON.entitySourceChanged
    };
  }
  if (has(STALE_REASON.manualWinnerChanged)) {
    return {
      commitDisposition: AI_COMMIT_DISPOSITION.evidenceOnly,
      applyToCurrentResult: false,
      allowLexicalObservation: true,
      allowEntityPhraseClaim: false,
      staleReason: STALE_REASON.manualWinnerChanged
    };
  }
  if (has(STALE_REASON.policyOnlyChanged)) {
    return {
      commitDisposition: AI_COMMIT_DISPOSITION.accepted,
      applyToCurrentResult: true,
      allowLexicalObservation: true,
      allowEntityPhraseClaim: true,
      staleReason: STALE_REASON.policyOnlyChanged,
      requiresResolverRerun: true
    };
  }
  return {
    commitDisposition: AI_COMMIT_DISPOSITION.accepted,
    applyToCurrentResult: true,
    allowLexicalObservation: true,
    allowEntityPhraseClaim: true,
    staleReason: null
  };
}
__name(dispositionFor, "dispositionFor");
function newEvidenceRootId() {
  return newOpaqueId("airoot");
}
__name(newEvidenceRootId, "newEvidenceRootId");
function newAiRequestId() {
  return newOpaqueId("aireq");
}
__name(newAiRequestId, "newAiRequestId");

// dictionary-ai-learning.js
var LEARNING_UNIT = Object.freeze({
  lexical: "lexical",
  phrase: "phrase",
  none: "none"
});
var ALIGNMENT_REASON = Object.freeze({
  singleToken: "single_lexical_token_exact_mapping",
  multiTokenWholeReadingOnly: "multi_token_whole_reading_only",
  explicitSubSegments: "explicit_sub_segment_mapping",
  crossesSyntheticBoundary: "crosses_punctuation_boundary",
  ambiguousMapping: "ambiguous_mapping",
  blocklistedFunctionWord: "blocklisted_function_word",
  emptySpan: "empty_span",
  segmentIdMismatch: "segment_id_mismatch"
});
function tokenCountOf(text, target) {
  return lexicalTokens(parseSourceName(text, { target })).length;
}
__name(tokenCountOf, "tokenCountOf");
function containsPunctuation(text, target) {
  return parseSourceName(text, { target }).segments.some((s) => s.type === "punctuation");
}
__name(containsPunctuation, "containsPunctuation");
function classifyLearningUnit({ span, segment, target = null }, policy = AI_POLICY) {
  if (!span || !segment) {
    return { unit: LEARNING_UNIT.none, reason: ALIGNMENT_REASON.segmentIdMismatch, claims: [] };
  }
  if (span.segmentId !== segment.segmentId) {
    return { unit: LEARNING_UNIT.none, reason: ALIGNMENT_REASON.segmentIdMismatch, claims: [] };
  }
  const spanText = String(span.text ?? "");
  if (!spanText.trim()) {
    return { unit: LEARNING_UNIT.none, reason: ALIGNMENT_REASON.emptySpan, claims: [] };
  }
  const tokens = tokenCountOf(spanText, target);
  const hasPunctuation = span.crossesPunctuation ?? containsPunctuation(spanText, target);
  if (Array.isArray(segment.subSegments) && segment.subSegments.length > 0) {
    const covered = coversSpanCompletely(span, segment.subSegments);
    if (!covered) {
      return {
        unit: LEARNING_UNIT.phrase,
        reason: ALIGNMENT_REASON.ambiguousMapping,
        claims: [phraseClaimOf(span, segment)]
      };
    }
    const claims = [];
    for (const sub of segment.subSegments) {
      const subText = spanText.slice(sub.sourceStart - span.sourceStart, sub.sourceEnd - span.sourceStart);
      if (containsPunctuation(subText, target) || tokenCountOf(subText, target) !== 1) {
        return {
          unit: LEARNING_UNIT.phrase,
          reason: ALIGNMENT_REASON.crossesSyntheticBoundary,
          claims: [phraseClaimOf(span, segment)]
        };
      }
      if (isBlocklisted(subText, policy)) {
        return {
          unit: LEARNING_UNIT.phrase,
          reason: ALIGNMENT_REASON.blocklistedFunctionWord,
          claims: [phraseClaimOf(span, segment)]
        };
      }
      claims.push({
        kind: "lexical",
        sourceText: subText,
        value: sub.reading,
        sourceStart: sub.sourceStart,
        sourceEnd: sub.sourceEnd
      });
    }
    return { unit: LEARNING_UNIT.lexical, reason: ALIGNMENT_REASON.explicitSubSegments, claims };
  }
  if (hasPunctuation) {
    return {
      unit: LEARNING_UNIT.phrase,
      reason: ALIGNMENT_REASON.crossesSyntheticBoundary,
      claims: [phraseClaimOf(span, segment)]
    };
  }
  if (tokens !== 1) {
    return {
      unit: LEARNING_UNIT.phrase,
      reason: ALIGNMENT_REASON.multiTokenWholeReadingOnly,
      claims: [phraseClaimOf(span, segment)]
    };
  }
  if (policy.learning.lexicalRequiresSingleToken && isBlocklisted(spanText, policy)) {
    return { unit: LEARNING_UNIT.none, reason: ALIGNMENT_REASON.blocklistedFunctionWord, claims: [] };
  }
  return {
    unit: LEARNING_UNIT.lexical,
    reason: ALIGNMENT_REASON.singleToken,
    claims: [{
      kind: "lexical",
      sourceText: spanText,
      value: segment.reading,
      sourceStart: span.sourceStart,
      sourceEnd: span.sourceEnd
    }]
  };
}
__name(classifyLearningUnit, "classifyLearningUnit");
function phraseClaimOf(span, segment) {
  return {
    kind: "phrase",
    sourceText: span.text,
    value: segment.reading,
    sourceStart: span.sourceStart,
    sourceEnd: span.sourceEnd
  };
}
__name(phraseClaimOf, "phraseClaimOf");
function isBlocklisted(text, policy) {
  return policy.learning.lexicalBlocklist.has(String(text).trim().toLowerCase());
}
__name(isBlocklisted, "isBlocklisted");
function coversSpanCompletely(span, subs) {
  const sorted = [...subs].sort((a, b) => a.sourceStart - b.sourceStart);
  let cursor = span.sourceStart;
  for (const s of sorted) {
    if (s.sourceStart > cursor) {
      const gap = span.text.slice(cursor - span.sourceStart, s.sourceStart - span.sourceStart);
      if (gap.trim() !== "") return false;
    }
    cursor = s.sourceEnd;
  }
  const tail = span.text.slice(cursor - span.sourceStart);
  return tail.trim() === "";
}
__name(coversSpanCompletely, "coversSpanCompletely");
async function findProtectedClaim(db, { subjectKey, valueType }) {
  const page = await findClaimsBySubjectAndValueType(db, subjectKey, valueType, { limit: 50 });
  for (const c of page.items) {
    if (c.lifecycleState === LIFECYCLE_STATE.archived || c.deletedAt != null) continue;
    if (c.locked === true) return c;
    if (c.verificationState === VERIFICATION_STATE.manualEntered || c.verificationState === VERIFICATION_STATE.manualCorrected || c.verificationState === VERIFICATION_STATE.official) return c;
  }
  return null;
}
__name(findProtectedClaim, "findProtectedClaim");
async function learnDirectAiSegment(db, {
  span,
  segment,
  target = null,
  entityKey = null,
  valueType = "japanese_display",
  inputFingerprint,
  // §21 identity
  logicalGenerationItemId,
  evidenceRootId,
  aiRequestId = null,
  /**
   * §93 / §93.1: この学習が属する **AI batch の root mutation ID**。
   * 1 batch = 1 ID で、同じ batch の全 item / 全 segment / language hint が共有する
   * （Safe Undo が batch 全体を1単位で選択できるのはこれが理由）。
   * 生成場所は `createAiFillSession()` 1箇所（§93.1 / dictionary-ai-orchestrator.js）。
   */
  mutationId,
  // §22 provenance
  provider,
  requestedModel,
  returnedModel = null,
  promptProfileId,
  promptVersion,
  generationStrategyVersion = GENERATION_STRATEGY_VERSION,
  // §23 / §23.1
  anchored = false,
  seededByClaimIds = [],
  seededCandidateFingerprints = [],
  conditioningClaimIds = [],
  // §16.1
  context,
  fullPhrase = null,
  countryCode = null,
  worldRegionCode = null,
  // §52.1 / §52.2
  staleAtCommit = false,
  staleReason = null,
  commitDisposition = AI_COMMIT_DISPOSITION.accepted,
  allowLexicalObservation = true,
  allowEntityPhraseClaim = true,
  policy = AI_POLICY,
  now = Date.now()
}) {
  const learned = [];
  const skipped = [];
  assertMutationId("learnDirectAiSegment({ mutationId })", mutationId);
  if (commitDisposition === AI_COMMIT_DISPOSITION.discarded) {
    return { learned, skipped: [{ reason: "stale_discarded", staleReason }], evidenceRootId };
  }
  const gate = classifyLearningUnit({ span, segment, target }, policy);
  if (gate.unit === LEARNING_UNIT.none) {
    return { learned, skipped: [{ reason: gate.reason, segmentId: segment.segmentId }], evidenceRootId };
  }
  for (const proposed of gate.claims) {
    if (proposed.kind === "lexical" && !allowLexicalObservation) {
      skipped.push({ reason: "stale_lexical_not_allowed", staleReason, sourceText: proposed.sourceText });
      continue;
    }
    if (proposed.kind === "phrase" && !allowEntityPhraseClaim) {
      skipped.push({ reason: "stale_phrase_not_allowed", staleReason, sourceText: proposed.sourceText });
      continue;
    }
    const strict = strictNormalizedSource(proposed.sourceText);
    const subjectKind = proposed.kind === "lexical" ? SUBJECT_KIND.lexical : SUBJECT_KIND.phrase;
    const subjectKey = proposed.kind === "lexical" ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
    const protectedClaim = await findProtectedClaim(db, { subjectKey, valueType });
    if (protectedClaim && protectedClaim.normalizedValue !== void 0) {
      skipped.push({
        reason: "protected_manual_or_locked",
        sourceText: proposed.sourceText,
        claimId: protectedClaim.claimId,
        locked: protectedClaim.locked === true,
        verificationState: protectedClaim.verificationState
      });
      continue;
    }
    const up = await upsertClaim(db, {
      subjectKind,
      subjectKey,
      valueType,
      value: proposed.value,
      sourceText: proposed.sourceText,
      provenance: { createdBy: "ai", firstEvidenceRootId: evidenceRootId },
      verificationState: VERIFICATION_STATE.none,
      now
      /**
       * §93:「History / Evidence / Job で共有」。batch root を Claim 書き込みへも
       * 渡さないと `commitClaimUpsertIn()` が Claim ごとに新しい `mut:` を発行し、
       * 382件の AI batch が History 上で 382 個の別 mutation に見える
       * （§93.1 の「最近の大量操作 → この操作を取り消す」が作れなくなる）。
       */
    }, { actor: "ai", mutationId, invalidateCache: true });
    const observationContextId = await computeObservationContextId({
      entityKey,
      target,
      inputFingerprint,
      segmentId: span.segmentId
    });
    const contextHash = await computeContextHash({
      target,
      entityKey,
      subjectKey,
      normalizedFullPhrase: strictNormalizedSource(fullPhrase ?? proposed.sourceText),
      countryCode,
      worldRegionCode,
      segmentSpan: { start: proposed.sourceStart, end: proposed.sourceEnd },
      languageConditioning: segment.language ?? null,
      roleConditioning: segment.role ?? null,
      languageInferenceVersion: context?.inference?.languageInferenceVersion ?? null
    });
    const ev = await recordEvidence(db, {
      evidenceType: EVIDENCE_TYPE.aiObservation,
      claimId: up.claim.claimId,
      claimSemanticKey: up.claim.semanticKey,
      stance: STANCE.support,
      valueType,
      // §21 identity
      logicalGenerationItemId,
      evidenceRootId,
      observationContextId,
      aiRequestId,
      // §93 / §93.1: batch root mutation ID（dedupeKey の入力ではない — §19.1
      // aiLogicalItem identity は変えない）。
      mutationId,
      // §22 provenance
      provider,
      requestedModel,
      returnedModel,
      promptProfileId,
      promptVersion,
      generationStrategyVersion,
      // §23 / §23.1
      anchored,
      seededByClaimIds,
      seededCandidateFingerprints,
      conditioningClaimIds,
      // §16.1
      entityKey,
      target,
      fullPhrase,
      context,
      contextHash,
      modelSelfConfidence: segment.modelSelfConfidence ?? null,
      // §52.1 / §52.2
      staleAtCommit,
      staleReason,
      commitDisposition,
      now
    }, { invalidateCache: true });
    let score = null;
    if (ev.created) {
      score = await recomputeClaimScore(db, up.claim.claimId, { invalidateCache: true }).catch(() => null);
    }
    learned.push({
      kind: proposed.kind,
      claimId: up.claim.claimId,
      created: up.created,
      evidenceCreated: ev.created,
      duplicate: ev.duplicate,
      sourceText: proposed.sourceText,
      value: proposed.value,
      alignmentReason: gate.reason,
      confidenceScore: score?.claim?.confidenceScore ?? null,
      trustTier: score?.claim?.trustTier ?? null
    });
    if (policy.learning.learnLanguageHint && segment.language) {
      const langUp = await upsertClaim(db, {
        subjectKind,
        subjectKey,
        valueType: "language_hint",
        value: segment.language,
        sourceText: proposed.sourceText,
        provenance: { createdBy: "ai", firstEvidenceRootId: evidenceRootId },
        verificationState: VERIFICATION_STATE.none,
        now
        /** §93: language hint Claim の History も同じ batch root を共有する。 */
      }, { actor: "ai", mutationId, invalidateCache: true }).catch(() => null);
      if (langUp) {
        await recordEvidence(db, {
          evidenceType: EVIDENCE_TYPE.aiObservation,
          claimId: langUp.claim.claimId,
          claimSemanticKey: langUp.claim.semanticKey,
          stance: STANCE.support,
          valueType: "language_hint",
          // §21:「同じ evidenceRootId を共有」— 独立AI票として数えない。
          logicalGenerationItemId,
          evidenceRootId,
          observationContextId,
          aiRequestId,
          // §93.1: language hint も **同じ batch mutation** に属する。ここが欠けると
          // Undo 後に「消えた Claim の language hint だけ生き残る」不整合になる。
          mutationId,
          provider,
          requestedModel,
          returnedModel,
          promptProfileId,
          promptVersion,
          generationStrategyVersion,
          anchored,
          seededByClaimIds,
          seededCandidateFingerprints,
          conditioningClaimIds,
          entityKey,
          target,
          fullPhrase,
          context,
          contextHash,
          staleAtCommit,
          staleReason,
          commitDisposition,
          now
        }, { invalidateCache: true }).catch(() => null);
        learned.push({
          kind: "language_hint",
          claimId: langUp.claim.claimId,
          created: langUp.created,
          value: segment.language,
          alignmentReason: gate.reason
        });
      }
    }
  }
  return { learned, skipped, evidenceRootId };
}
__name(learnDirectAiSegment, "learnDirectAiSegment");
async function learnDerivedComposition(db, {
  composedText,
  sourceText,
  target = null,
  entityKey = null,
  fmId = null,
  valueType = "japanese_display",
  dependsOnClaimIds = [],
  derivationRootIds = [],
  /**
   * §93.1:「同一batchの全item、全segment、language hint、derived Evidence が
   * 同じ root mutation ID を共有」。derived は独立AI票ではないが、Undo で
   * 依存 Claim を needs_revalidation へ倒す対象なので **同じ batch に属する**。
   */
  mutationId,
  context,
  countryCode = null,
  renderPolicyVersion = 1,
  derivationPolicyVersion = 1,
  now = Date.now(),
  policy = AI_POLICY
}) {
  if (!policy.learning.recordDerivedComposition) return { skipped: "disabled" };
  if (!composedText || !composedText.trim()) return { skipped: "empty_composition" };
  assertMutationId("learnDerivedComposition({ mutationId })", mutationId);
  const strict = strictNormalizedSource(sourceText);
  const subjectKind = entityKey && fmId ? SUBJECT_KIND.entity : tokenCountOf(sourceText, target) <= 1 ? SUBJECT_KIND.lexical : SUBJECT_KIND.phrase;
  const subjectKey = subjectKind === SUBJECT_KIND.entity ? entitySubjectKey(target, fmId) : subjectKind === SUBJECT_KIND.lexical ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
  const protectedClaim = await findProtectedClaim(db, { subjectKey, valueType });
  if (protectedClaim) {
    return { skipped: "protected_manual_or_locked", claimId: protectedClaim.claimId };
  }
  const up = await upsertClaim(db, {
    subjectKind,
    subjectKey,
    valueType,
    value: composedText,
    sourceText,
    provenance: { createdBy: "resolver", firstEvidenceRootId: null },
    // §7.5 Derived Claim。独立観測ではない。
    derivation: {
      kind: "composed",
      dependsOnClaimIds: [...dependsOnClaimIds],
      renderPolicyVersion,
      derivationPolicyVersion
    },
    verificationState: VERIFICATION_STATE.none,
    now
    /** §93: derived Claim の History も同じ batch root（§21 の root 共有と同型）。 */
  }, { actor: "resolver", mutationId, invalidateCache: true });
  const derivationSignature = await stableHash({
    schema: "derived-composition",
    version: 1,
    subjectKey,
    valueType,
    composedText,
    dependsOnClaimIds: [...dependsOnClaimIds].sort(),
    derivationRootIds: [...derivationRootIds].sort(),
    renderPolicyVersion,
    derivationPolicyVersion
  });
  const ev = await recordEvidence(db, {
    evidenceType: EVIDENCE_TYPE.derivedComposition,
    claimId: up.claim.claimId,
    claimSemanticKey: up.claim.semanticKey,
    // §17: derived_* は独立Truth票ではない → stance は neutral 固定。
    stance: STANCE.neutral,
    valueType,
    derivationSignature,
    // §93.1: derivationSignature が dedupe identity なので、mutationId を足しても
    // 同じ derivation の再 Composer は Evidence を増やさない（§19.1 / §129）。
    mutationId,
    entityKey,
    target,
    context,
    fullPhrase: sourceText,
    now
  }, { invalidateCache: true });
  return {
    claimId: up.claim.claimId,
    created: up.created,
    evidenceCreated: ev.created,
    duplicate: ev.duplicate,
    derivationSignature,
    dependsOnClaimIds: [...dependsOnClaimIds]
  };
}
__name(learnDerivedComposition, "learnDerivedComposition");

// dictionary-ai-orchestrator.js
var AiOrchestratorError = class extends Error {
  static {
    __name(this, "AiOrchestratorError");
  }
  constructor(message, details) {
    super(message);
    this.name = "AiOrchestratorError";
    this.details = details;
  }
};
var AI_FILL_DEFAULT_ON = false;
var ITEM_OUTCOME = Object.freeze({
  knownOnly: "known_only",
  // §147.1 AI call 0
  dictionaryReuse: "dictionary_reuse",
  // §53.2/§147.1 学習済み → AI call 0
  /** Current Session の unknown span が **全て** AI で埋まった。 */
  aiFilled: "ai_filled",
  /** 一部の span だけ埋まった（残りは原文保持）。 */
  aiPartial: "ai_partial",
  aiUnavailable: "ai_unavailable",
  // §55.1 provider不可でも resolved portion は保持
  aiInvalid: "ai_invalid",
  // §52 schema 失敗 → unresolved
  aiStaleNotApplied: "ai_stale_not_applied",
  noSourceMap: "no_source_map"
});
function createAiFillSession({
  adapter = null,
  provider = null,
  apiKey = null,
  model = null,
  fetchImpl = null,
  policy = AI_POLICY,
  purpose = AI_PURPOSE.translation,
  profile = PROMPT_PROFILE.translateUnknownSegments,
  cooldown = null,
  budget = null,
  coordinator = null,
  sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep"),
  random = Math.random,
  now = /* @__PURE__ */ __name(() => Date.now(), "now"),
  ...rest
} = {}) {
  for (const forbidden of ["rootMutationId", "mutationId"]) {
    if (forbidden in rest) {
      throw new AiOrchestratorError(
        `§93.1: createAiFillSession() does not accept a caller-supplied ${forbidden}; the session mints its own root mutation id`,
        { forbidden }
      );
    }
  }
  const effectiveAdapter = adapter ?? createProviderAdapter({
    provider: provider ?? policy.provider.defaultProvider,
    apiKey,
    model,
    fetchImpl,
    policy,
    now
  });
  return {
    adapter: effectiveAdapter,
    policy,
    profile,
    purpose,
    cooldown: cooldown ?? createCooldownRegistry({ policy, now }),
    budget: budget ?? createAiBudget({ policy, purpose }),
    coordinator: coordinator ?? createRequestCoordinator(),
    /**
     * §93 / §93.1 **AI batch 境界**。
     *
     * 1 session = 1 budget / 1 coordinator / 1 cooldown registry（この module の
     * 既存 run context 定義）= **意味的に1つの AI batch**。よって root mutation ID
     * も session 単位で1つ生成し、同じ session を使う全 `resolveWithAiFill()` /
     * `resolveWithNativeRecovery()` 呼び出し（= 全 item・全 segment・language hint・
     * derived Evidence）が共有する。
     *
     * - 別 session（別 batch）は別 ID。
     * - retry / schema-repair / fan-out dedupe は **同じ session 内** なので ID は増えない。
     * - stale / discarded で Evidence を書かない場合も ID は session に1つのままで、
     *   mutation record が増殖しない。
     */
    rootMutationId: newOpaqueId(ID_PREFIXES.mutation),
    sleep,
    random,
    now
  };
}
__name(createAiFillSession, "createAiFillSession");
function sessionRootMutationId(session) {
  const id = session?.rootMutationId ?? null;
  if (!isMutationId(id)) {
    throw new AiOrchestratorError(
      "§93.1: this AI session has no root mutation id; build it with createAiFillSession()",
      { rootMutationId: id }
    );
  }
  return id;
}
__name(sessionRootMutationId, "sessionRootMutationId");
async function resolveWithAiFill(db, session, {
  sourceText,
  target,
  fmId = null,
  countryCode = null,
  worldRegionCode = null,
  valueType = "japanese_display",
  builtinIndex = null,
  rejectedValues = [],
  seededCandidates = [],
  conditioningClaimIds = [],
  learn = true,
  composeDerived = false
} = {}) {
  const { policy, profile, budget, coordinator, cooldown, adapter } = session;
  const rootMutationId = sessionRootMutationId(session);
  const errors = [];
  const before = await resolveName(db, {
    sourceText,
    target,
    fmId,
    countryCode,
    worldRegionCode,
    requestedValueTypes: [valueType],
    builtinIndex
  });
  const valueResult = before.values[valueType];
  const plan = planUnknownSpans({ sourceText, target, valueResult }, policy);
  if (!plan.hasSourceMap) {
    return {
      outcome: ITEM_OUTCOME.noSourceMap,
      before,
      after: before,
      aiCalls: 0,
      plan,
      learned: [],
      skipped: [],
      stale: null,
      sessionOutput: valueResult?.output ?? null,
      errors
    };
  }
  if (!needsAiCall(plan)) {
    budget.recordKnownAvoided(1);
    return {
      outcome: ITEM_OUTCOME.knownOnly,
      before,
      after: before,
      aiCalls: 0,
      plan,
      reused: [],
      rejectedReuse: [],
      learned: [],
      skipped: [],
      stale: null,
      sessionOutput: valueResult.output,
      errors
    };
  }
  const { aiSpans, reused, rejectedReuse } = await filterSpansNeedingAi(
    db,
    plan.unknownSpans,
    {
      target,
      valueType,
      // §30.4.1 / §53.2 contextFit は Resolver と同じ Context 形で評価する。
      context: { entityKey: fmId ? `${target}:${fmId}` : null, target, countryCode, worldRegionCode }
    }
  );
  if (aiSpans.length === 0) {
    budget.recordKnownAvoided(reused.length);
    const reuseFills = new Map(reused.map((r) => [r.span.segmentId, r.value]));
    const reuseFill = composeCurrentSessionOutput({
      sourceText,
      valueResult,
      spans: plan.unknownSpans,
      fills: reuseFills
    });
    return {
      outcome: ITEM_OUTCOME.dictionaryReuse,
      before,
      after: before,
      aiCalls: 0,
      plan,
      reused,
      rejectedReuse: [],
      learned: [],
      skipped: [],
      stale: null,
      sessionOutput: reuseFill.text,
      sessionFill: reuseFill,
      retention: partialRetentionView({ sourceText, valueResult, plan }),
      errors
    };
  }
  if (reused.length > 0) budget.recordKnownAvoided(reused.length);
  const inputFingerprint = await computeInputFingerprint(sourceText);
  const spans = aiSpans.slice(0, policy.prompt.maxUnknownSegmentsPerItem);
  const requestItemId = `item:${inputFingerprint.slice(0, 16)}`;
  const context = buildContextSnapshot({
    rawFacts: { originalName: sourceText, countryRaw: null, worldRegionRaw: null },
    canonicalFacts: { countryCode, worldRegionCode },
    inference: {}
  });
  const surrounding = surroundingStructureSignature({
    knownSegments: plan.knownSegments,
    spanIndex: 0,
    spanCount: spans.length
  });
  const request = {
    requestItemId,
    inputFingerprint,
    target,
    entityIdentity: fmId ? { target, fmId: String(fmId) } : null,
    entityKey: fmId ? `${target}:${fmId}` : null,
    countryCode,
    worldRegionCode,
    requestedSegmentIds: spans.map((s) => s.segmentId),
    sourceSpans: spans,
    knownSegments: plan.knownSegments,
    rejectedValues,
    seededCandidates: profile.anchored ? seededCandidates : [],
    promptProfileId: profile.promptProfileId,
    promptVersion: profile.promptVersion,
    generationStrategyVersion: GENERATION_STRATEGY_VERSION
  };
  const logicalGenerationItemId = await computeLogicalGenerationItemId({
    spanText: spans.map((s) => s.text).join(" "),
    target,
    countryCode,
    worldRegionCode,
    promptProfileId: profile.promptProfileId,
    promptVersion: profile.promptVersion,
    generationStrategyVersion: GENERATION_STRATEGY_VERSION,
    surroundingStructure: surrounding,
    rejectedValues: profile.exposeRejected ? rejectedValues : [],
    anchored: profile.anchored
  });
  const snapshot = await captureRequestSnapshot(db, {
    sourceText,
    target,
    entityKey: request.entityKey,
    inputFingerprint,
    seededClaimIds: valueResult.decisionTrace?.chosenClaimIds ?? [],
    lockedClaimIds: valueResult.decisionTrace?.candidateClaimIds ?? []
  });
  let shared;
  try {
    shared = await coordinator.run(logicalGenerationItemId, async () => {
      if (!budget.canSpendItem()) {
        budget.recordBudgetBlocked();
        throw new ProviderError(PROVIDER_FAILURE.budgetExhausted, "item budget exhausted", {});
      }
      budget.recordAttemptedItem(1);
      budget.recordBatch();
      const built = buildPrompt(request, { profile, policy });
      const effectiveRequest = {
        ...request,
        requestedSegmentIds: built.effectiveRequestedSegmentIds
      };
      const aiRequestId = newAiRequestId();
      budget.recordPromptTokens(built.promptText);
      let call;
      try {
        call = await callWithRetry(adapter, { promptText: built.promptText }, {
          policy,
          cooldown,
          sleep: session.sleep,
          random: session.random,
          budget
        });
      } catch (e) {
        budget.recordFailure(e.failure ?? "unknown");
        if (e.failure === PROVIDER_FAILURE.cooldown) budget.recordCooldownBlocked();
        throw e;
      }
      budget.recordResponseTokens(call.result.rawText);
      budget.recordProviderUsage(call.result.usage);
      let validated = validateEnvelope(call.result.rawText, effectiveRequest, policy);
      let repaired = false;
      if (!validated.ok && policy.retry.schemaRepairAttempts > 0) {
        const repair = buildSchemaRepairPrompt(
          effectiveRequest,
          call.result.rawText,
          validated.errors,
          { profile, policy }
        );
        budget.recordPromptTokens(repair.promptText);
        try {
          const retryCall = await callWithRetry(adapter, { promptText: repair.promptText }, {
            policy,
            cooldown,
            sleep: session.sleep,
            random: session.random,
            budget
          });
          budget.recordResponseTokens(retryCall.result.rawText);
          budget.recordProviderUsage(retryCall.result.usage);
          const second = validateEnvelope(retryCall.result.rawText, effectiveRequest, policy);
          repaired = true;
          if (second.ok) {
            validated = second;
            call = retryCall;
          } else validated = second;
        } catch (e) {
          budget.recordFailure(e.failure ?? "unknown");
        }
      }
      if (!validated.ok) {
        budget.recordFailure("schema_invalid");
        return {
          ok: false,
          errors: validated.errors,
          repaired,
          aiRequestId,
          effectiveRequest,
          provider: adapter.provider,
          requestedModel: adapter.requestedModel,
          returnedModel: call.result.returnedModel ?? null
        };
      }
      budget.recordSuccessfulItem(1);
      return {
        ok: true,
        envelope: validated.envelope,
        // §21:「最終的に受理した1 valid output item が Evidence Root」
        evidenceRootId: newEvidenceRootId(),
        aiRequestId,
        effectiveRequest,
        provider: adapter.provider,
        requestedModel: adapter.requestedModel,
        returnedModel: call.result.returnedModel ?? null,
        repaired
      };
    });
  } catch (e) {
    return {
      outcome: ITEM_OUTCOME.aiUnavailable,
      before,
      after: before,
      aiCalls: 0,
      plan,
      learned: [],
      skipped: [],
      stale: null,
      // §55.1: provider 不可でも Dictionary 解決済み portion をそのまま返す。
      sessionOutput: valueResult.output,
      retention: partialRetentionView({ sourceText, valueResult, plan }),
      errors: [...errors, { failure: e.failure ?? "unknown", message: e.message }]
    };
  }
  if (shared.deduped) budget.recordDeduped(1);
  if (!shared.ok) {
    return {
      outcome: ITEM_OUTCOME.aiInvalid,
      before,
      after: before,
      aiCalls: shared.deduped ? 0 : 1,
      plan,
      learned: [],
      skipped: [],
      stale: null,
      sessionOutput: valueResult.output,
      retention: partialRetentionView({ sourceText, valueResult, plan }),
      errors: [...errors, ...shared.errors ?? []]
    };
  }
  const stale = await evaluateStaleGate(db, snapshot, {
    currentSourceText: sourceText,
    currentInputFingerprint: inputFingerprint
  });
  const learned = [];
  const skipped = [];
  const spanById = new Map(spans.map((sp) => [sp.segmentId, sp]));
  if (learn && stale.commitDisposition !== AI_COMMIT_DISPOSITION.discarded) {
    for (const segment of shared.envelope.segments) {
      const span = spanById.get(segment.segmentId);
      if (!span) {
        skipped.push({ reason: "segment_id_mismatch", segmentId: segment.segmentId });
        continue;
      }
      const out = await learnDirectAiSegment(db, {
        span,
        segment,
        target,
        entityKey: request.entityKey,
        valueType,
        inputFingerprint,
        logicalGenerationItemId,
        evidenceRootId: shared.evidenceRootId,
        aiRequestId: shared.aiRequestId,
        // §93.1: この batch の root mutation ID。Safe Undo の scope key。
        mutationId: rootMutationId,
        provider: shared.provider,
        requestedModel: shared.requestedModel,
        returnedModel: shared.returnedModel,
        promptProfileId: profile.promptProfileId,
        promptVersion: profile.promptVersion,
        generationStrategyVersion: GENERATION_STRATEGY_VERSION,
        anchored: profile.anchored,
        seededByClaimIds: profile.anchored ? valueResult.decisionTrace?.candidateClaimIds ?? [] : [],
        seededCandidateFingerprints: profile.anchored ? seededCandidates.map((c) => String(c)) : [],
        conditioningClaimIds,
        context,
        fullPhrase: sourceText,
        countryCode,
        worldRegionCode,
        staleAtCommit: stale.stale,
        staleReason: stale.staleReason ?? null,
        commitDisposition: stale.commitDisposition,
        allowLexicalObservation: stale.allowLexicalObservation,
        allowEntityPhraseClaim: stale.allowEntityPhraseClaim,
        policy
      });
      learned.push(...out.learned);
      skipped.push(...out.skipped);
    }
  }
  const after = await resolveName(db, {
    sourceText,
    target,
    fmId,
    countryCode,
    worldRegionCode,
    requestedValueTypes: [valueType],
    builtinIndex
  });
  const afterValue = after.values[valueType];
  const fills = /* @__PURE__ */ new Map();
  if (stale.applyToCurrentResult) {
    for (const segment of shared.envelope.segments) {
      if (spanById.has(segment.segmentId)) fills.set(segment.segmentId, segment.reading);
    }
  }
  const sessionFill = composeCurrentSessionOutput({
    sourceText,
    // Persistent 側で既に resolved になった span も反映した最新 Source Map の上へ重ねる。
    valueResult: afterValue,
    spans,
    fills
  });
  let derived = null;
  if (composeDerived && stale.applyToCurrentResult && sessionFill.complete && sessionFill.text) {
    derived = await learnDerivedComposition(db, {
      composedText: sessionFill.text,
      sourceText,
      target,
      entityKey: request.entityKey,
      fmId,
      valueType,
      // §126 depends_on: Known 側 Claim + 今回 AI が作った Direct Claim。
      dependsOnClaimIds: [
        .../* @__PURE__ */ new Set([
          ...afterValue.decisionTrace?.chosenClaimIds ?? [],
          ...learned.filter((l) => l.kind === "lexical" || l.kind === "phrase").map((l) => l.claimId)
        ])
      ],
      derivationRootIds: [shared.evidenceRootId],
      // §93.1: derived Evidence も同じ batch mutation に属する。
      mutationId: rootMutationId,
      context,
      countryCode
    });
  }
  const outcome = !stale.applyToCurrentResult ? ITEM_OUTCOME.aiStaleNotApplied : sessionFill.complete ? ITEM_OUTCOME.aiFilled : ITEM_OUTCOME.aiPartial;
  return {
    outcome,
    before,
    after,
    aiCalls: shared.deduped ? 0 : 1,
    deduped: Boolean(shared.deduped),
    plan,
    reused,
    rejectedReuse,
    learned,
    skipped,
    derived,
    /** §93.1: この item がどの batch mutation に属したか（History/Undo と突合用）。 */
    rootMutationId,
    stale,
    envelope: shared.envelope,
    evidenceRootId: shared.evidenceRootId,
    logicalGenerationItemId,
    /** Current Session の合成結果（Persistent Truth とは別概念）。 */
    sessionOutput: sessionFill.text,
    sessionFill,
    retention: partialRetentionView({ sourceText, valueResult: afterValue, plan }),
    errors
  };
}
__name(resolveWithAiFill, "resolveWithAiFill");
function sessionTelemetry(session) {
  return {
    estimatorId: ESTIMATOR_ID,
    defaultOn: AI_FILL_DEFAULT_ON,
    purpose: session.purpose,
    provider: session.adapter.provider,
    requestedModel: session.adapter.requestedModel,
    promptProfileId: session.profile.promptProfileId,
    promptVersion: session.profile.promptVersion,
    generationStrategyVersion: GENERATION_STRATEGY_VERSION,
    /** §93.1: この batch の Undo scope key。History/Evidence と突き合わせ可能。 */
    rootMutationId: session.rootMutationId ?? null,
    budget: session.budget.snapshot(),
    dedupe: session.coordinator.snapshot(),
    cooldown: session.cooldown.snapshot()
  };
}
__name(sessionTelemetry, "sessionTelemetry");
export {
  AI_FILL_DEFAULT_ON,
  AiOrchestratorError,
  ITEM_OUTCOME,
  createAiFillSession,
  resolveWithAiFill,
  sessionRootMutationId,
  sessionTelemetry
};
