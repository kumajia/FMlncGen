var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// dictionary-keying.js
var KEY_SCHEMA_VERSION = 1;
var ID_PREFIXES = Object.freeze({
  claim: "claim",
  evidence: "ev",
  relation: "rel",
  history: "hist",
  rejection: "rej",
  job: "job",
  mutation: "mut",
  package: "package"
});
function newOpaqueId(prefix) {
  if (typeof prefix !== "string" || !prefix) {
    throw new TypeError("newOpaqueId: prefix must be a non-empty string");
  }
  return `${prefix}:${randomUuid()}`;
}
__name(newOpaqueId, "newOpaqueId");
function randomUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("newOpaqueId: crypto.getRandomValues unavailable");
  }
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = b[6] & 15 | 64;
  b[8] = b[8] & 63 | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
__name(randomUuid, "randomUuid");
var SET_LIKE_FIELDS = Object.freeze(/* @__PURE__ */ new Set([
  "entityKeys",
  "targets",
  "countries",
  "countryCodes",
  "worldRegions",
  "worldRegionCodes",
  "locales",
  "languages",
  "roles",
  "acceptedNormalizedNames",
  "requestedValueTypes",
  "scripts",
  "capabilities",
  "claimIds",
  "seededCandidateFingerprints"
]));
var CanonicalError = class extends TypeError {
  static {
    __name(this, "CanonicalError");
  }
};
function canonicalize(value, fieldName = null, path = "$", seen = /* @__PURE__ */ new Set()) {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return value;
  if (t === "boolean") return value;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalError(`canonicalize: non-finite number at ${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (t === "undefined") {
    throw new CanonicalError(`canonicalize: undefined at ${path} (use explicit null)`);
  }
  if (t === "bigint") {
    throw new CanonicalError(`canonicalize: BigInt at ${path} (convert in schema)`);
  }
  if (t === "function" || t === "symbol") {
    throw new CanonicalError(`canonicalize: ${t} at ${path}`);
  }
  if (value instanceof Date) {
    throw new CanonicalError(`canonicalize: Date at ${path} (pass epoch ms Number)`);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new CanonicalError(`canonicalize: ${value.constructor.name} at ${path} (pass canonical Array)`);
  }
  if (seen.has(value)) {
    throw new CanonicalError(`canonicalize: circular reference at ${path}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((v, i) => canonicalize(v, null, `${path}[${i}]`, seen));
      if (fieldName && SET_LIKE_FIELDS.has(fieldName)) {
        const uniq = /* @__PURE__ */ new Map();
        for (const it of items) uniq.set(stableSerialize(it), it);
        return [...uniq.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([, v]) => v);
      }
      return items;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalError(`canonicalize: non-plain object at ${path}`);
    }
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k], k, `${path}.${k}`, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}
__name(canonicalize, "canonicalize");
function stableSerialize(value) {
  return JSON.stringify(canonicalize(value));
}
__name(stableSerialize, "stableSerialize");
var HASH_CACHE = /* @__PURE__ */ new Map();
var HASH_CACHE_MAX = 2e4;
function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(toBase64Url, "toBase64Url");
async function sha256Base64Url(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("stableHash: crypto.subtle unavailable");
  const digest = await subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}
__name(sha256Base64Url, "sha256Base64Url");
async function stableHash(payload) {
  const serialized = stableSerialize(payload);
  const cached = HASH_CACHE.get(serialized);
  if (cached !== void 0) return cached;
  const hash = await sha256Base64Url(serialized);
  if (HASH_CACHE.size >= HASH_CACHE_MAX) HASH_CACHE.clear();
  HASH_CACHE.set(serialized, hash);
  return hash;
}
__name(stableHash, "stableHash");
function requireString(name, v) {
  if (typeof v !== "string" || v.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return v;
}
__name(requireString, "requireString");
function optString(name, v) {
  if (v === null || v === void 0) return null;
  if (typeof v !== "string") throw new TypeError(`${name} must be a string or null`);
  return v;
}
__name(optString, "optString");
function entityKey(target, fmId) {
  requireString("target", target);
  if (typeof fmId !== "string" || !/^\d+$/.test(fmId)) {
    throw new TypeError("fmId must be a decimal String (§4.1.1)");
  }
  return `${target}:${fmId}`;
}
__name(entityKey, "entityKey");
function entitySubjectKey(target, fmId) {
  return `entity:${entityKey(target, fmId)}`;
}
__name(entitySubjectKey, "entitySubjectKey");
async function lexicalSubjectKey(strictNormalizedSource2) {
  requireString("strictNormalizedSource", strictNormalizedSource2);
  const h = await stableHash({
    schema: "subject-lexical",
    version: KEY_SCHEMA_VERSION,
    normalizedSource: strictNormalizedSource2
  });
  return `lex:${h}`;
}
__name(lexicalSubjectKey, "lexicalSubjectKey");
async function phraseSubjectKey(strictNormalizedPhrase) {
  requireString("strictNormalizedPhrase", strictNormalizedPhrase);
  const h = await stableHash({
    schema: "subject-phrase",
    version: KEY_SCHEMA_VERSION,
    normalizedPhrase: strictNormalizedPhrase
  });
  return `phrase:${h}`;
}
__name(phraseSubjectKey, "phraseSubjectKey");
async function claimGroupKey({
  subjectKind,
  subjectKey,
  valueType,
  script = null,
  explicitConstraintSignature = null,
  sourceNameGuardSignature: sourceNameGuardSignature2 = null,
  keySchemaVersion = KEY_SCHEMA_VERSION
}) {
  return stableHash({
    schema: "claim-group",
    keySchemaVersion,
    subjectKind: requireString("subjectKind", subjectKind),
    subjectKey: requireString("subjectKey", subjectKey),
    valueType: requireString("valueType", valueType),
    script: optString("script", script),
    explicitConstraintSignature: optString("explicitConstraintSignature", explicitConstraintSignature),
    sourceNameGuardSignature: optString("sourceNameGuardSignature", sourceNameGuardSignature2)
  });
}
__name(claimGroupKey, "claimGroupKey");
async function semanticKey({
  claimGroupKey: groupKey,
  normalizedValue,
  keySchemaVersion = KEY_SCHEMA_VERSION
}) {
  return stableHash({
    schema: "claim-semantic",
    keySchemaVersion,
    claimGroupKey: requireString("claimGroupKey", groupKey),
    normalizedValue: requireString("normalizedValue", normalizedValue)
  });
}
__name(semanticKey, "semanticKey");
async function dedupeKey(payload, { keySchemaVersion = KEY_SCHEMA_VERSION } = {}) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("dedupeKey: payload must be a plain object");
  }
  return stableHash({ schema: "evidence-dedupe", keySchemaVersion, ...payload });
}
__name(dedupeKey, "dedupeKey");
async function edgeKey({
  relation,
  fromNodeId,
  toNodeId,
  keySchemaVersion = KEY_SCHEMA_VERSION
}) {
  return stableHash({
    schema: "relation-edge",
    keySchemaVersion,
    relation: requireString("relation", relation),
    fromNodeId: requireString("fromNodeId", fromNodeId),
    toNodeId: requireString("toNodeId", toNodeId)
  });
}
__name(edgeKey, "edgeKey");
async function symmetricEdgeKey({
  relation,
  nodeA,
  nodeB,
  keySchemaVersion = KEY_SCHEMA_VERSION
}) {
  requireString("nodeA", nodeA);
  requireString("nodeB", nodeB);
  const [from, to] = nodeA <= nodeB ? [nodeA, nodeB] : [nodeB, nodeA];
  return edgeKey({ relation, fromNodeId: from, toNodeId: to, keySchemaVersion });
}
__name(symmetricEdgeKey, "symmetricEdgeKey");
async function rejectionKey({
  claimGroupKey: groupKey,
  valueType,
  script = null,
  normalizedRejectedValue,
  contextConstraintSignature: contextConstraintSignature2 = null,
  keySchemaVersion = KEY_SCHEMA_VERSION
}) {
  return stableHash({
    schema: "rejection",
    keySchemaVersion,
    claimGroupKey: requireString("claimGroupKey", groupKey),
    valueType: requireString("valueType", valueType),
    script: optString("script", script),
    normalizedRejectedValue: requireString("normalizedRejectedValue", normalizedRejectedValue),
    contextConstraintSignature: optString("contextConstraintSignature", contextConstraintSignature2)
  });
}
__name(rejectionKey, "rejectionKey");
var INPUT_FINGERPRINT_VERSION = 1;
async function inputFingerprint(rawSourceText, { inputFingerprintVersion = INPUT_FINGERPRINT_VERSION } = {}) {
  if (typeof rawSourceText !== "string") {
    throw new TypeError("inputFingerprint: rawSourceText must be a string (raw, un-normalized)");
  }
  return stableHash({
    schema: "resolution-input",
    version: inputFingerprintVersion,
    rawSourceText,
    rawLengthUtf16: rawSourceText.length
  });
}
__name(inputFingerprint, "inputFingerprint");
async function builtinContentFingerprint(claims) {
  const entries = (claims ?? []).map((c) => stableSerialize({
    sourceText: c.sourceText,
    valueType: c.valueType,
    script: c.script ?? null,
    value: c.value,
    candidateFingerprint: c.candidateFingerprint ?? null
  })).sort();
  return stableHash({ schema: "builtin-content", version: 1, entries });
}
__name(builtinContentFingerprint, "builtinContentFingerprint");
async function resolutionKey({
  resolutionContextKey,
  resolutionPolicyFingerprint: resolutionPolicyFingerprint2,
  cacheKeySchemaVersion,
  builtinContentFingerprint: builtinContentFingerprint2 = void 0
}) {
  const payload = {
    schema: "resolution",
    version: cacheKeySchemaVersion,
    resolutionContextKey: requireString("resolutionContextKey", resolutionContextKey),
    resolutionPolicyFingerprint: requireString("resolutionPolicyFingerprint", resolutionPolicyFingerprint2)
  };
  if (builtinContentFingerprint2 !== void 0) {
    payload.builtinContentFingerprint = requireString(
      "builtinContentFingerprint",
      builtinContentFingerprint2
    );
  }
  return stableHash(payload);
}
__name(resolutionKey, "resolutionKey");
async function contextHash(context, { contextHashSchemaVersion = 1 } = {}) {
  return stableHash({ schema: "evidence-context", version: contextHashSchemaVersion, ...context });
}
__name(contextHash, "contextHash");
async function exactLookupKey(strictNormalizedSource2) {
  const h = await stableHash({
    schema: "lookup-exact",
    version: KEY_SCHEMA_VERSION,
    strictNormalizedSource: requireString("strictNormalizedSource", strictNormalizedSource2)
  });
  return `exact:${h}`;
}
__name(exactLookupKey, "exactLookupKey");
async function foldedLookupKey(foldedNormalizedSource2) {
  const h = await stableHash({
    schema: "lookup-fold",
    version: KEY_SCHEMA_VERSION,
    foldedNormalizedSource: requireString("foldedNormalizedSource", foldedNormalizedSource2)
  });
  return `fold:${h}`;
}
__name(foldedLookupKey, "foldedLookupKey");
async function aliasLookupKeyExact(normalizedValue) {
  const h = await stableHash({
    schema: "lookup-alias-exact",
    version: KEY_SCHEMA_VERSION,
    normalizedValue: requireString("normalizedValue", normalizedValue)
  });
  return `alias:${h}`;
}
__name(aliasLookupKeyExact, "aliasLookupKeyExact");
async function aliasLookupKeyFolded(foldedValue) {
  const h = await stableHash({
    schema: "lookup-alias-fold",
    version: KEY_SCHEMA_VERSION,
    foldedValue: requireString("foldedValue", foldedValue)
  });
  return `alias-fold:${h}`;
}
__name(aliasLookupKeyFolded, "aliasLookupKeyFolded");
async function originRecordKey({
  sourceKind,
  sourceId = null,
  recordIdentity,
  originRecordKeyVersion = 1
}) {
  return stableHash({
    schema: "origin-record",
    version: originRecordKeyVersion,
    sourceKind: requireString("sourceKind", sourceKind),
    sourceId: optString("sourceId", sourceId),
    recordIdentity
  });
}
__name(originRecordKey, "originRecordKey");
var RESOLUTION_POLICY_FIELDS = Object.freeze([
  "keySchemaVersion",
  "sourceNormalizerVersion",
  "valueNormalizerVersion",
  "parserVersion",
  "sourceNameFingerprintVersion",
  "sourceNameGuardPolicyVersion",
  "countryCanonicalizationVersion",
  "worldRegionCanonicalizationVersion",
  "modelLineageRegistryVersion",
  "packageTrustPolicyVersion",
  "packageStateRevision",
  "contextHashSchemaVersion",
  "targetProfileVersion",
  "resolverVersion",
  "confidencePolicyVersion",
  "renderPolicyVersion",
  "countryProfileVersion",
  "languageInferenceVersion",
  "nativeRecoveryPolicyVersion",
  "nativeConversionPolicyVersion",
  "derivationPolicyVersion",
  "candidateGenerationRevision",
  "builtinDictionaryVersion"
]);
async function resolutionPolicyFingerprint(meta) {
  const payload = { schema: "resolution-policy" };
  const missing = [];
  for (const f of RESOLUTION_POLICY_FIELDS) {
    const v = meta?.[f];
    if (v === void 0) {
      missing.push(f);
      continue;
    }
    payload[f] = v;
  }
  if (missing.length) {
    throw new Error(`resolutionPolicyFingerprint: missing ${missing.join(", ")}`);
  }
  return stableHash(payload);
}
__name(resolutionPolicyFingerprint, "resolutionPolicyFingerprint");

// dictionary-model-lineage.js
var MODEL_LINEAGE_REGISTRY_VERSION = 2;
var LINEAGE_CLASSIFICATION = Object.freeze({
  known: "known",
  unknown: "unknown"
});
function rawModelIdentity({ provider, requestedModel, returnedModel = null }) {
  if (typeof provider !== "string" || !provider) {
    throw new TypeError("rawModelIdentity: provider must be a non-empty string");
  }
  const model = returnedModel ?? requestedModel;
  if (typeof model !== "string" || !model) {
    throw new TypeError("rawModelIdentity: requestedModel or returnedModel is required");
  }
  return `${provider}:${model}`;
}
__name(rawModelIdentity, "rawModelIdentity");
var DEFAULT_MODEL_LINEAGE_REGISTRY = Object.freeze({
  modelLineageRegistryVersion: MODEL_LINEAGE_REGISTRY_VERSION,
  entries: Object.freeze({
    // --- Gemini 3 世代 ---------------------------------------------------
    // §22.2:「independenceGroup は *相関の強い同系統証拠* の単位」。
    // 同一世代の Gemini 3.x は互いに強く相関するため、世代単位で1 lineage へ
    // まとめる（既存 `gemini-2` と同じ粒度）。世代ごとに分けることで
    // Gemini 2 と Gemini 3 を独立 lineage として正しく区別しつつ、
    // 3.x 同士を「独立した2票」に水増ししない。
    "gemini:gemini-3.6-flash": { modelFamily: "gemini-3", modelLineageId: "google-gemini-3" },
    // --- Gemini 2 / 1.5 世代（Historical Evidence の分類に必要。削除しない）---
    // §22.3: 「現在呼べるモデル一覧」と「過去 Evidence を分類する Registry」は
    // 別概念。gemini-2.0-flash は 2026-06-01 に提供終了したが、過去 Evidence の
    // lineage 分類に必要なので entry は残す。
    "gemini:gemini-2.0-flash": { modelFamily: "gemini-2", modelLineageId: "google-gemini-2" },
    "gemini:gemini-2.0-flash-lite": { modelFamily: "gemini-2", modelLineageId: "google-gemini-2" },
    "gemini:gemini-1.5-flash": { modelFamily: "gemini-1.5", modelLineageId: "google-gemini-1.5" },
    "gemini:gemini-1.5-pro": { modelFamily: "gemini-1.5", modelLineageId: "google-gemini-1.5" },
    "groq:llama-3.3-70b-versatile": { modelFamily: "llama-3", modelLineageId: "meta-llama-3" },
    "groq:llama-3.1-8b-instant": { modelFamily: "llama-3", modelLineageId: "meta-llama-3" }
  })
});
function classifyModelLineage({ provider, requestedModel, returnedModel = null }, registry = DEFAULT_MODEL_LINEAGE_REGISTRY) {
  const raw = rawModelIdentity({ provider, requestedModel, returnedModel });
  const hit = registry.entries[raw] ?? null;
  if (hit) {
    return {
      rawModelIdentity: raw,
      modelFamily: hit.modelFamily ?? null,
      modelLineageId: hit.modelLineageId,
      independenceGroup: `ai:${hit.modelLineageId}`,
      lineageClassification: LINEAGE_CLASSIFICATION.known,
      modelLineageRegistryVersion: registry.modelLineageRegistryVersion
    };
  }
  return {
    rawModelIdentity: raw,
    modelFamily: null,
    modelLineageId: null,
    // §22.2:「不明なら保守的に ai:unknown:<provider>:<rawModelIdentity>」
    independenceGroup: `ai:unknown:${provider}:${raw}`,
    lineageClassification: LINEAGE_CLASSIFICATION.unknown,
    modelLineageRegistryVersion: registry.modelLineageRegistryVersion
  };
}
__name(classifyModelLineage, "classifyModelLineage");
function resolveEvidenceLineage(evidence, registry = DEFAULT_MODEL_LINEAGE_REGISTRY) {
  if (evidence?.provider == null) {
    return {
      rawModelIdentity: null,
      modelFamily: null,
      modelLineageId: null,
      independenceGroup: evidence?.independenceGroup ?? null,
      lineageClassification: null,
      modelLineageRegistryVersion: registry.modelLineageRegistryVersion,
      reclassified: false
    };
  }
  const stale = evidence.modelLineageRegistryVersion !== registry.modelLineageRegistryVersion;
  if (!stale) {
    return {
      rawModelIdentity: evidence.rawModelIdentity,
      modelFamily: evidence.modelFamily ?? null,
      modelLineageId: evidence.modelLineageId ?? null,
      independenceGroup: evidence.independenceGroup,
      lineageClassification: evidence.lineageClassification,
      modelLineageRegistryVersion: evidence.modelLineageRegistryVersion,
      reclassified: false
    };
  }
  const fresh = classifyModelLineage({
    provider: evidence.provider,
    requestedModel: evidence.requestedModel,
    returnedModel: evidence.returnedModel ?? null
  }, registry);
  return { ...fresh, reclassified: true };
}
__name(resolveEvidenceLineage, "resolveEvidenceLineage");

// dictionary-composer.js
var RENDER_POLICY_VERSION = 2;
var DEFAULT_RENDER_POLICY = Object.freeze({
  renderPolicyVersion: RENDER_POLICY_VERSION,
  /** 隣接する2つの解決済みKatakana Segmentの間の単純空白を中黒(・)へ変換する。
   *  既定はfalse (Legacy互換)。明示的にtrueを渡した場合だけsynthetic中黒を挿入。 */
  joinResolvedSegmentsWithMiddleDot: false,
  /**
   * §74「スペース」/ §73: source gap の whitespace run を visible separator
   * 1個へ canonicalize する。
   *
   * Legacy visible (index.html parseLine):
   *     line.trim() → split(/\s+/) → word列 → join(' ')
   * なので visible では
   *     - 先頭/末尾の whitespace は出ない
   *     - token 間の whitespace run は separator 1個
   * となる。実測した Legacy skeleton も同じ:
   *     "Pays	(Vert)"   → "Pays (Vert)"
   *     "Pays ( Vert )"  → "Pays ( Vert )"
   *     "City  -  City"  → "City - City"
   *
   * **最終文字列への global regex ではない。** 対象は source gap の whitespace
   * だけで、Claim/AI が生成した value 内部の意図的な spacing、punctuation、
   * 中黒/括弧/ハイフン等の他 Render Policy には一切触れない。
   */
  collapseSourceWhitespaceRuns: true,
  /** §74: 先頭/末尾の source whitespace を visible output へ出さない。 */
  trimOuterSourceWhitespace: true,
  /** canonical visible separator。U+0020。 */
  sourceWhitespaceSeparator: " ",
  /**
   * §74「Prefix保持」/ §61.1: recognized club prefix の canonical 表示形。
   *
   * B-4: Legacy visible は prefix word を **常に大文字化** して出す:
   *     index.html parseLine():  prefixWords.push(w.toUpperCase());
   * つまり `fc wellen` の visible は `FC ウェレン`。`render_mode = preserve` は
   * 「原文の case をそのまま出す」ではなく「翻訳せず canonical prefix 形で出す」
   * という意味である。
   *
   * これは Parser が「Legacy が prefix word として大文字化して出した語」と印を
   * 付けた segment（`legacyPrefixDisplay`）にだけ効く Render Policy であり、通常の
   * lexical token へ無条件 uppercase をかけるものではない（略語の後に続く数字
   * segment も対象外 — Legacy は数字を verbatim で push する）。
   *
   * CR-12: 対象の判定は Role (`club_prefix`) ではなく Parser が付けた
   * `legacyPrefixDisplay` 印である。club/comp では両者は一致するが、
   * player/stadium では §61 により Role を付けない一方で Legacy visible の
   * 表記保持だけは必要になるため（dictionary-parser.js `applyPrefixRoles` 参照）。
   */
  clubPrefixCanonicalCase: "upper",
  /**
   * Phase 8 §83.1 / §136: Native 由来 Japanese Display 専用の separator。
   *
   * 「全北 + 現代 + モータース → 全北現代モータース」のように、隣接する出力が
   * どちらも CJK（Han / Kana / Hangul）のときだけ source whitespace 由来の
   * separator をこの値へ差し替える。
   *
   * **既定は `null` = 無効** で、Phase 7 の visible 出力（`DEFAULT_RENDER_POLICY`）
   * は1 byteも変わらない。Native Recovery の合成だけが明示的に `''` を渡す。
   * 最終文字列への global regex ではなく、Composer の separator 決定に閉じる。
   */
  cjkAdjacentSeparator: null
});
var CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;
function endsWithCjk(text) {
  const s = String(text ?? "");
  if (!s) return false;
  return CJK_CHAR.test([...s].pop());
}
__name(endsWithCjk, "endsWithCjk");
function startsWithCjk(text) {
  const s = String(text ?? "");
  if (!s) return false;
  return CJK_CHAR.test([...s][0]);
}
__name(startsWithCjk, "startsWithCjk");
var WHITESPACE = /\s/u;
var KATAKANA_ONLY = /^[゠-ヿ々ー]+$/;
function isPureKatakana(text) {
  return typeof text === "string" && text.length > 0 && KATAKANA_ONLY.test(text);
}
__name(isPureKatakana, "isPureKatakana");
function hasLegacyPrefixDisplay(tokens, span) {
  for (let k = span.i; k < span.j; k++) {
    if (tokens[k]?.legacyPrefixDisplay === true) return true;
  }
  return false;
}
__name(hasLegacyPrefixDisplay, "hasLegacyPrefixDisplay");
function renderSourceDerived(text, renderPolicy) {
  if (renderPolicy.collapseSourceWhitespaceRuns === false) return text;
  const separator = renderPolicy.sourceWhitespaceSeparator ?? " ";
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (!WHITESPACE.test(text[i])) {
      out += text[i];
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && WHITESPACE.test(text[j])) j++;
    out += separator;
    i = j;
  }
  return out;
}
__name(renderSourceDerived, "renderSourceDerived");
function spanOutput(span, tokens, renderPolicy) {
  const { evalResult, spanText } = span;
  if (evalResult.resolutionState === "resolved" && evalResult.chosen) {
    return {
      outputText: evalResult.chosen.value,
      selectedClaimIds: [evalResult.chosen.claimId],
      method: evalResult.chosen.source === "builtin" ? "builtin" : "claim"
    };
  }
  if (evalResult.preserved === true) {
    const canonicalUpper = renderPolicy.clubPrefixCanonicalCase === "upper" && hasLegacyPrefixDisplay(tokens, span);
    const base = renderSourceDerived(spanText, renderPolicy);
    return {
      outputText: canonicalUpper ? base.toUpperCase() : base,
      selectedClaimIds: [],
      method: "preserved",
      preserved: true,
      preserveReason: evalResult.preserveReason ?? "render_mode_preserve"
    };
  }
  if (evalResult.resolutionState === "conflicted") {
    return {
      outputText: renderSourceDerived(spanText, renderPolicy),
      selectedClaimIds: evalResult.candidateIds,
      method: "conflicted_verbatim"
    };
  }
  return {
    outputText: renderSourceDerived(spanText, renderPolicy),
    selectedClaimIds: [],
    method: "unresolved_verbatim"
  };
}
__name(spanOutput, "spanOutput");
function splitGapRuns(sourceText, start, end) {
  const runs = [];
  let i = start;
  while (i < end) {
    const ws = WHITESPACE.test(sourceText[i]);
    let j = i + 1;
    while (j < end && WHITESPACE.test(sourceText[j]) === ws) j++;
    runs.push({ kind: ws ? "sep" : "src", start: i, end: j });
    i = j;
  }
  return runs;
}
__name(splitGapRuns, "splitGapRuns");
function composeResolution({ sourceText, tokens, chosenSpans }, renderPolicy = DEFAULT_RENDER_POLICY) {
  const collapse = renderPolicy.collapseSourceWhitespaceRuns !== false;
  const trimOuter = renderPolicy.trimOuterSourceWhitespace !== false;
  const separator = renderPolicy.sourceWhitespaceSeparator ?? " ";
  const pieces = [];
  const pushGap = /* @__PURE__ */ __name((from, to) => {
    if (from >= to) return;
    for (const run of splitGapRuns(sourceText, from, to)) {
      if (run.kind === "sep" && collapse) {
        pieces.push({ t: "sep", start: run.start, end: run.end });
      } else {
        pieces.push({ t: "src", start: run.start, end: run.end });
      }
    }
  }, "pushGap");
  let cursor = 0;
  for (let idx = 0; idx < chosenSpans.length; idx++) {
    const span = chosenSpans[idx];
    const spanSourceStart = span.sourceStart ?? tokens[span.i].start;
    const spanSourceEnd = span.sourceEnd ?? tokens[span.j - 1].end;
    pushGap(cursor, spanSourceStart);
    const out = spanOutput(span, tokens, renderPolicy);
    pieces.push({
      t: "span",
      idx,
      start: spanSourceStart,
      end: spanSourceEnd,
      out,
      outText: out.outputText,
      kind: out.method === "claim" || out.method === "builtin" ? isPureKatakana(out.outputText) ? "resolved_katakana" : "resolved_other" : "other"
    });
    cursor = spanSourceEnd;
  }
  pushGap(cursor, sourceText.length);
  const producesOutput = /* @__PURE__ */ __name((p) => p.t === "src" ? p.end > p.start : p.t === "span" ? p.out.outputText.length > 0 : false, "producesOutput");
  const firstContent = pieces.findIndex(producesOutput);
  const lastContent = (() => {
    for (let i = pieces.length - 1; i >= 0; i--) if (producesOutput(pieces[i])) return i;
    return -1;
  })();
  const keptSeparator = /* @__PURE__ */ __name((i) => {
    if (!trimOuter) return true;
    return firstContent !== -1 && i > firstContent && i < lastContent;
  }, "keptSeparator");
  const segments = [];
  let prevContentKind = null;
  let prevContentText = null;
  const nextContentKind = /* @__PURE__ */ __name((from) => {
    for (let i = from; i < pieces.length; i++) {
      if (producesOutput(pieces[i])) return pieces[i].t === "span" ? pieces[i].kind : "other";
    }
    return null;
  }, "nextContentKind");
  const nextContentText = /* @__PURE__ */ __name((from) => {
    for (let i = from; i < pieces.length; i++) {
      const p = pieces[i];
      if (!producesOutput(p)) continue;
      return p.t === "span" ? p.outText : sourceText.slice(p.start, p.end);
    }
    return null;
  }, "nextContentText");
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.t === "sep") {
      if (!keptSeparator(i)) continue;
      const middleDot = renderPolicy.joinResolvedSegmentsWithMiddleDot && prevContentKind === "resolved_katakana" && nextContentKind(i + 1) === "resolved_katakana";
      const cjkSep = renderPolicy.cjkAdjacentSeparator;
      const useCjkSep = !middleDot && typeof cjkSep === "string" && endsWithCjk(prevContentText) && startsWithCjk(nextContentText(i + 1));
      segments.push({
        mapKind: "synthetic",
        syntheticKind: middleDot ? "middle_dot" : useCjkSep ? "cjk_join" : "space",
        segmentId: `synthetic:${p.start}-${p.end}`,
        // §40:「Composerが挿入した中黒/スペース等は sourceStart=null /
        //  sourceEnd=null で隣接Source Segmentへ偽装しない」
        sourceStart: null,
        sourceEnd: null,
        sourceText: null,
        outputStart: null,
        outputEnd: null,
        outputText: middleDot ? "・" : useCjkSep ? cjkSep : separator,
        selectedClaimIds: [],
        method: "composer"
      });
      continue;
    }
    if (p.t === "src") {
      const text = sourceText.slice(p.start, p.end);
      segments.push({
        mapKind: "source_segment",
        segmentId: `verbatim:${p.start}-${p.end}`,
        sourceStart: p.start,
        sourceEnd: p.end,
        sourceText: text,
        outputStart: null,
        outputEnd: null,
        outputText: text,
        selectedClaimIds: [],
        method: "source_verbatim"
      });
      prevContentKind = "other";
      prevContentText = text;
      continue;
    }
    segments.push({
      mapKind: "source_segment",
      segmentId: `seg:${p.idx}`,
      sourceStart: p.start,
      sourceEnd: p.end,
      sourceText: sourceText.slice(p.start, p.end),
      outputStart: null,
      outputEnd: null,
      outputText: p.out.outputText,
      selectedClaimIds: p.out.selectedClaimIds,
      method: p.out.method,
      // §61.1 診断: preserve された segment を Source Map から判別できるようにする。
      ...p.out.preserved ? { preserved: true, preserveReason: p.out.preserveReason } : {}
    });
    prevContentKind = p.kind;
    prevContentText = p.outText;
  }
  let outputCursor = 0;
  let finalText = "";
  for (const seg of segments) {
    seg.outputStart = outputCursor;
    seg.outputEnd = outputCursor + seg.outputText.length;
    outputCursor = seg.outputEnd;
    finalText += seg.outputText;
  }
  return { finalText, segments, renderPolicyVersion: renderPolicy.renderPolicyVersion };
}
__name(composeResolution, "composeResolution");

// dictionary-policy-versions.js
var PARSER_VERSION = 3;
var TARGET_PROFILE_VERSION = 2;
var RESOLVER_VERSION = 5;
var VALUE_NORMALIZER_VERSION = 3;
var BUILTIN_DICTIONARY_VERSION = 2;
var RELEASE_POLICY_VERSION_FIELDS = Object.freeze({
  modelLineageRegistryVersion: MODEL_LINEAGE_REGISTRY_VERSION,
  renderPolicyVersion: RENDER_POLICY_VERSION,
  // CR-6: parser / resolver の decision semantics も release 定数が正本。
  // 既存DB の persisted meta が旧値でも Current 実行値で fingerprint を作る。
  parserVersion: PARSER_VERSION,
  resolverVersion: RESOLVER_VERSION,
  // CR-9: Value Normalizer も release 定数が正本。既存DB の persisted meta が
  // 旧値でも Current 実行値で fingerprint を作る（旧 cache へ落ちない）。
  valueNormalizerVersion: VALUE_NORMALIZER_VERSION,
  // CR-12: Target Profile も §61 に従い version 管理され、App release と一緒に
  // 配られる（DB側に権限が無い）。既存DB の persisted meta が v1 のままでも
  // Current 実行値で fingerprint を作る。
  targetProfileVersion: TARGET_PROFILE_VERSION,
  // 2.0.0: Builtin Dictionary は 0 件の固定値として release と一緒に配られる。
  // 既存DB の persisted meta が v1 のままでも Current 実行値 2 で fingerprint を
  // 作り、旧内蔵辞書で作られた resolution_cache entry を hit させない。
  builtinDictionaryVersion: BUILTIN_DICTIONARY_VERSION
});
var RELEASE_POLICY_VERSION_FIELD_NAMES = Object.freeze(
  Object.keys(RELEASE_POLICY_VERSION_FIELDS)
);
function effectivePolicyMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  let out = null;
  for (const [field, current] of Object.entries(RELEASE_POLICY_VERSION_FIELDS)) {
    if (meta[field] === current) continue;
    if (out === null) out = { ...meta };
    out[field] = current;
  }
  return out ?? meta;
}
__name(effectivePolicyMeta, "effectivePolicyMeta");
function releasePolicyMetaDrift(meta) {
  const drift = [];
  if (!meta || typeof meta !== "object") return drift;
  for (const [field, current] of Object.entries(RELEASE_POLICY_VERSION_FIELDS)) {
    if (meta[field] !== current) drift.push({ field, persisted: meta[field], current });
  }
  return drift;
}
__name(releasePolicyMetaDrift, "releasePolicyMetaDrift");
function applyReleasePolicyVersions(meta) {
  const drift = releasePolicyMetaDrift(meta);
  if (drift.length === 0) return { record: meta, changed: false, drift };
  const record = { ...meta };
  for (const d of drift) record[d.field] = d.current;
  return { record, changed: true, drift };
}
__name(applyReleasePolicyVersions, "applyReleasePolicyVersions");

// dictionary-schema.js
var DB_NAME = "FMlncGen";
var DB_VERSION = 1;
var STORE = Object.freeze({
  entities: "dictionary_entities",
  claims: "dictionary_claims",
  evidence: "dictionary_evidence",
  relations: "dictionary_relations",
  history: "dictionary_history",
  rejections: "dictionary_rejections",
  cache: "resolution_cache",
  jobs: "dictionary_jobs",
  packages: "dictionary_packages",
  meta: "dictionary_meta"
});
var STORE_NAMES = Object.freeze(Object.values(STORE));
var SCHEMA = Object.freeze({
  [STORE.entities]: {
    keyPath: "entityKey",
    indexes: [
      { name: "nodeId", keyPath: "nodeId", unique: true },
      { name: "target", keyPath: "target" },
      { name: "fmId", keyPath: "fmId" },
      { name: "normalizedOriginalName", keyPath: "normalizedOriginalName" },
      { name: "countryCode", keyPath: "countryCode" },
      { name: "lastSeenAt", keyPath: "lastSeenAt" }
    ]
  },
  [STORE.claims]: {
    keyPath: "claimId",
    indexes: [
      { name: "semanticKey", keyPath: "semanticKey", unique: true },
      { name: "subjectKey", keyPath: "subjectKey" },
      { name: "claimGroupKey", keyPath: "claimGroupKey" },
      { name: "subjectKind", keyPath: "subjectKind" },
      { name: "valueType", keyPath: "valueType" },
      { name: "normalizedSource", keyPath: "normalizedSource" },
      { name: "foldedSource", keyPath: "foldedSource" },
      { name: "normalizedValue", keyPath: "normalizedValue" },
      { name: "foldedValue", keyPath: "foldedValue" },
      { name: "trustTier", keyPath: "trustTier" },
      { name: "conflictState", keyPath: "conflictState" },
      { name: "revalidationState", keyPath: "revalidationState" },
      { name: "lifecycleState", keyPath: "lifecycleState" },
      { name: "verificationState", keyPath: "verificationState" },
      { name: "script", keyPath: "script" },
      { name: "stagingSessionId", keyPath: "stagingSessionId" },
      { name: "updatedAt", keyPath: "updatedAt" },
      // §15 複合Index
      { name: "subjectKey_valueType", keyPath: ["subjectKey", "valueType"] },
      { name: "normalizedSource_valueType", keyPath: ["normalizedSource", "valueType"] },
      { name: "valueType_normalizedValue", keyPath: ["valueType", "normalizedValue"] },
      { name: "valueType_foldedValue", keyPath: ["valueType", "foldedValue"] },
      { name: "claimGroupKey_conflictState", keyPath: ["claimGroupKey", "conflictState"] }
    ]
  },
  [STORE.evidence]: {
    // §25:「1M Evidenceへ20個以上のIndexを最初から貼らない」— Hot/Integrity経路のみ
    keyPath: "evidenceId",
    indexes: [
      { name: "dedupeKey", keyPath: "dedupeKey", unique: true },
      { name: "claimId", keyPath: "claimId" },
      { name: "evidenceRootId", keyPath: "evidenceRootId" },
      { name: "entityKey", keyPath: "entityKey" },
      { name: "evidenceType", keyPath: "evidenceType" },
      { name: "modelLineageId", keyPath: "modelLineageId" },
      { name: "originRecordKey", keyPath: "originRecordKey" },
      { name: "originPackageKey", keyPath: "originPackageKey" },
      { name: "createdAt", keyPath: "createdAt" },
      { name: "seededByClaimIds", keyPath: "seededByClaimIds", multiEntry: true },
      { name: "conditioningClaimIds", keyPath: "conditioningClaimIds", multiEntry: true }
    ]
  },
  [STORE.relations]: {
    keyPath: "relationId",
    indexes: [
      { name: "edgeKey", keyPath: "edgeKey", unique: true },
      { name: "fromNodeId", keyPath: "fromNodeId" },
      { name: "toNodeId", keyPath: "toNodeId" },
      { name: "relation", keyPath: "relation" },
      { name: "state", keyPath: "state" },
      { name: "createdFromEvidenceRootId", keyPath: "createdFromEvidenceRootId" },
      // §32.1 複合Index候補
      { name: "fromNodeId_relation", keyPath: ["fromNodeId", "relation"] },
      { name: "toNodeId_relation", keyPath: ["toNodeId", "relation"] },
      { name: "toNodeId_relation_state", keyPath: ["toNodeId", "relation", "state"] }
    ]
  },
  [STORE.history]: {
    keyPath: "historyId",
    indexes: [
      { name: "nodeId", keyPath: "nodeId" },
      { name: "action", keyPath: "action" },
      { name: "actor", keyPath: "actor" },
      { name: "mutationId", keyPath: "mutationId" },
      { name: "timestamp", keyPath: "timestamp" }
    ]
  },
  [STORE.rejections]: {
    keyPath: "rejectionId",
    indexes: [
      { name: "rejectionKey", keyPath: "rejectionKey", unique: true },
      { name: "claimGroupKey", keyPath: "claimGroupKey" },
      { name: "valueType", keyPath: "valueType" },
      { name: "normalizedRejectedValue", keyPath: "normalizedRejectedValue" },
      { name: "state", keyPath: "state" },
      { name: "sourceEvidenceId", keyPath: "sourceEvidenceId" },
      { name: "originRecordKey", keyPath: "originRecordKey" },
      { name: "createdAt", keyPath: "createdAt" }
    ]
  },
  [STORE.cache]: {
    keyPath: "resolutionKey",
    indexes: [
      { name: "entityKey", keyPath: "entityKey" },
      { name: "normalizedInput", keyPath: "normalizedInput" },
      { name: "resolutionPolicyFingerprint", keyPath: "resolutionPolicyFingerprint" },
      { name: "lastUsedAt", keyPath: "lastUsedAt" },
      { name: "dependencyClaimIds", keyPath: "dependencyClaimIds", multiEntry: true },
      { name: "lookupKeys", keyPath: "lookupKeys", multiEntry: true }
    ]
  },
  [STORE.jobs]: {
    keyPath: "jobId",
    indexes: [
      { name: "type", keyPath: "type" },
      { name: "mode", keyPath: "mode" },
      { name: "state", keyPath: "state" },
      { name: "updatedAt", keyPath: "updatedAt" },
      { name: "rootMutationId", keyPath: "rootMutationId" }
    ]
  },
  [STORE.packages]: {
    keyPath: "packageKey",
    indexes: [
      { name: "packageId", keyPath: "packageId", unique: true },
      { name: "state", keyPath: "state" },
      { name: "activeVersion", keyPath: "activeVersion" },
      { name: "updatedAt", keyPath: "updatedAt" }
    ]
  },
  [STORE.meta]: { keyPath: "key", indexes: [] }
});
function assertSchemaConstraints(schema = SCHEMA) {
  const problems = [];
  for (const [storeName, def] of Object.entries(schema)) {
    const seen = /* @__PURE__ */ new Set();
    for (const idx of def.indexes) {
      if (seen.has(idx.name)) problems.push(`${storeName}.${idx.name}: duplicate index name`);
      seen.add(idx.name);
      if (idx.multiEntry && Array.isArray(idx.keyPath)) {
        problems.push(`${storeName}.${idx.name}: multiEntry with compound keyPath`);
      }
      if (idx.multiEntry && idx.unique) {
        problems.push(`${storeName}.${idx.name}: multiEntry + unique is not intended here`);
      }
    }
  }
  if (problems.length) throw new Error(`Schema constraint violations:
  ${problems.join("\n  ")}`);
  return true;
}
__name(assertSchemaConstraints, "assertSchemaConstraints");
var VALUE_KIND = Object.freeze({
  string: "string",
  enum: "enum",
  boolean: "boolean",
  language_tag: "language_tag"
});
var CARDINALITY = Object.freeze({
  single_preferred: "single_preferred",
  single_preferred_per_context_and_script: "single_preferred_per_context_and_script",
  multi: "multi",
  multi_weighted: "multi_weighted"
});
var ROLE_ENUM = Object.freeze([
  "club_prefix",
  "club_term",
  "competition_term",
  "stadium_term",
  "proper_name",
  "place",
  "qualifier",
  "person",
  "given_name",
  "surname",
  "nickname",
  "sponsor",
  "brand",
  "organisation",
  "ordinal",
  "year",
  "team_level",
  "age_group",
  "direction",
  "number",
  "connector",
  "unknown"
]);
var RENDER_MODE_ENUM = Object.freeze([
  "transliterate",
  "preserve",
  "translate",
  "drop",
  "contextual"
]);
var SCRIPT_ENUM = Object.freeze([
  "Hans",
  "Hant",
  "Hang",
  "Hani",
  "Jpan",
  "Latn",
  "Cyrl",
  "Grek",
  "Arab",
  "Kana"
]);
var VALUE_TYPE_POLICIES = Object.freeze({
  japanese_display: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred,
    normalization: "nfc_trim",
    requiresScript: false,
    foldedValue: false
  },
  japanese_reading: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred,
    normalization: "nfc_trim_reading_space",
    requiresScript: false,
    foldedValue: false
  },
  short_display: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred,
    normalization: "nfc_trim",
    requiresScript: false,
    foldedValue: false
  },
  // §9.5 Legacy Club 3LETTER / 6LETTER Compatibility
  // slot名を exact character count validation として解釈しない。
  // ASCII-only制約を入れない。case を保持し lowercase へ潰さない。
  club_3letter_display: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred,
    normalization: "nfc_trim",
    requiresScript: false,
    foldedValue: false,
    legacyField: "l3"
  },
  club_6letter_display: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred,
    normalization: "nfc_trim",
    requiresScript: false,
    foldedValue: false,
    legacyField: "l6"
  },
  native_form: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.single_preferred_per_context_and_script,
    normalization: "nfc_trim_no_nfkc",
    requiresScript: true,
    // §9「Native Formでは script を必ず持つ」
    foldedValue: false
  },
  source_alias: {
    valueKind: VALUE_KIND.string,
    cardinality: CARDINALITY.multi,
    normalization: "source_strict",
    requiresScript: false,
    foldedValue: true
    // §9.2「source_alias だけ foldedValue を保持」
  },
  role: {
    valueKind: VALUE_KIND.enum,
    cardinality: CARDINALITY.multi_weighted,
    normalization: "enum_canonical",
    enumValues: ROLE_ENUM,
    requiresScript: false,
    foldedValue: false
  },
  language_hint: {
    valueKind: VALUE_KIND.language_tag,
    cardinality: CARDINALITY.multi_weighted,
    normalization: "bcp47_canonical",
    requiresScript: false,
    foldedValue: false
  },
  render_mode: {
    valueKind: VALUE_KIND.enum,
    cardinality: CARDINALITY.single_preferred,
    normalization: "enum_canonical",
    enumValues: RENDER_MODE_ENUM,
    requiresScript: false,
    foldedValue: false
  },
  atomicity: {
    valueKind: VALUE_KIND.boolean,
    cardinality: CARDINALITY.single_preferred,
    normalization: "boolean_string",
    requiresScript: false,
    foldedValue: false
  }
});
var VALUE_TYPES = Object.freeze(Object.keys(VALUE_TYPE_POLICIES));
var LEGACY_OBJECT_FIELD_TO_VALUE_TYPE = Object.freeze({
  t: "japanese_display",
  l3: "club_3letter_display",
  l6: "club_6letter_display"
});
var ValueValidationError = class extends Error {
  static {
    __name(this, "ValueValidationError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ValueValidationError";
    this.details = details;
  }
};
var BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?(-([0-9A-Za-z]{5,8}|\d[0-9A-Za-z]{3}))*$/;
function validateClaimValue({
  valueType,
  value,
  script = null,
  normalizedValue = void 0,
  foldedValue = void 0
}) {
  const policy = VALUE_TYPE_POLICIES[valueType];
  if (!policy) {
    throw new ValueValidationError(`unknown valueType: ${valueType}`, { valueType });
  }
  switch (policy.valueKind) {
    case VALUE_KIND.string:
      if (typeof value !== "string") {
        throw new ValueValidationError(`${valueType}.value must be a string`, { valueType, got: typeof value });
      }
      if (value.length === 0) {
        throw new ValueValidationError(`${valueType}.value must not be empty`, { valueType });
      }
      break;
    case VALUE_KIND.boolean:
      if (typeof value !== "boolean") {
        throw new ValueValidationError(`${valueType}.value must be a boolean`, { valueType, got: typeof value });
      }
      break;
    case VALUE_KIND.enum:
      if (typeof value !== "string" || !policy.enumValues.includes(value)) {
        throw new ValueValidationError(
          `${valueType}.value must be one of ${policy.enumValues.join("|")}`,
          { valueType, got: value }
        );
      }
      break;
    case VALUE_KIND.language_tag:
      if (typeof value !== "string" || !BCP47.test(value)) {
        throw new ValueValidationError(`${valueType}.value must be a BCP 47 tag`, { valueType, got: value });
      }
      break;
    default:
      throw new ValueValidationError(`unhandled valueKind ${policy.valueKind}`, { valueType });
  }
  if (policy.requiresScript) {
    if (typeof script !== "string" || !SCRIPT_ENUM.includes(script)) {
      throw new ValueValidationError(
        `${valueType} requires a script (${SCRIPT_ENUM.join("|")})`,
        { valueType, script }
      );
    }
  }
  if (normalizedValue !== void 0) {
    if (typeof normalizedValue !== "string" || normalizedValue.length === 0) {
      throw new ValueValidationError(
        `${valueType}.normalizedValue must be a non-empty string`,
        { valueType, got: typeof normalizedValue }
      );
    }
    if (policy.valueKind === VALUE_KIND.boolean && !["true", "false"].includes(normalizedValue)) {
      throw new ValueValidationError(
        `${valueType}.normalizedValue must be "true" or "false"`,
        { valueType, got: normalizedValue }
      );
    }
  }
  if (foldedValue !== void 0 && foldedValue !== null) {
    if (!policy.foldedValue) {
      throw new ValueValidationError(`${valueType} must not carry a foldedValue`, { valueType });
    }
    if (typeof foldedValue !== "string" || foldedValue.length === 0) {
      throw new ValueValidationError(`${valueType}.foldedValue must be a non-empty string`, { valueType });
    }
  }
  return true;
}
__name(validateClaimValue, "validateClaimValue");
var FIELD_OWNER = Object.freeze({
  immutableSemanticIdentity: "immutable_semantic_identity",
  evidenceInvalidation: "evidence_dependency_invalidation",
  derivedScoreWorker: "derived_score_worker",
  revalidationWorkflow: "revalidation_workflow",
  quarantineWorkflow: "import_doctor_quarantine",
  explicitSemanticMutation: "user_explicit_semantic_mutation",
  usageBuffer: "usage_buffer",
  /**
   * Phase 9C §146.4:「保留/defer は Contradict Evidence を作らない」。
   * Active Review Queue の defer/hide は review scheduling/UI 状態であって
   * Truth/authority ではない。§92.2 のとおり別 Owner field として明示する
   * ことで、Truth-affecting owner（derivedScoreWorker 等）の patch 経路と
   * 構造的に混ざらないようにする。
   */
  reviewQueueWorkflow: "review_queue_workflow"
});
var CLAIM_FIELD_OWNERSHIP = Object.freeze({
  // Immutable semantic identity / Replacement only（§119: in-place 書換えではない）
  subjectKind: FIELD_OWNER.immutableSemanticIdentity,
  subjectKey: FIELD_OWNER.immutableSemanticIdentity,
  valueType: FIELD_OWNER.immutableSemanticIdentity,
  value: FIELD_OWNER.immutableSemanticIdentity,
  normalizedValue: FIELD_OWNER.immutableSemanticIdentity,
  foldedValue: FIELD_OWNER.immutableSemanticIdentity,
  script: FIELD_OWNER.immutableSemanticIdentity,
  applicabilityConstraints: FIELD_OWNER.immutableSemanticIdentity,
  sourceNameGuard: FIELD_OWNER.immutableSemanticIdentity,
  claimGroupKey: FIELD_OWNER.immutableSemanticIdentity,
  semanticKey: FIELD_OWNER.immutableSemanticIdentity,
  keySchemaVersion: FIELD_OWNER.immutableSemanticIdentity,
  // Evidence/Dependency invalidation
  scoreInputRevision: FIELD_OWNER.evidenceInvalidation,
  scoreDirty: FIELD_OWNER.evidenceInvalidation,
  // Derived-score worker
  confidenceScore: FIELD_OWNER.derivedScoreWorker,
  trustTier: FIELD_OWNER.derivedScoreWorker,
  applicabilityProfile: FIELD_OWNER.derivedScoreWorker,
  evidenceSummary: FIELD_OWNER.derivedScoreWorker,
  contextHints: FIELD_OWNER.derivedScoreWorker,
  conflictState: FIELD_OWNER.derivedScoreWorker,
  scoreComputedFromInputRevision: FIELD_OWNER.derivedScoreWorker,
  scoreComputedAt: FIELD_OWNER.derivedScoreWorker,
  scorePolicyVersion: FIELD_OWNER.derivedScoreWorker,
  derivedRevision: FIELD_OWNER.derivedScoreWorker,
  truthStrength: FIELD_OWNER.derivedScoreWorker,
  contextHintsPolicyVersion: FIELD_OWNER.derivedScoreWorker,
  /**
   * §102.3.6 Phase 9B:「preferred は Soft Score の限定的な補正のみ」。
   *
   * Package trustMode 由来の補正を **confidenceScore とは別 field** に materialize
   * する。confidenceScore へ混ぜると §139.21「preferred 設定だけで Truth Eligibility
   * Gate を通過しない」を構造的に守れない（gate は confidenceScore を見る）ため、
   * ここは Candidate ranking 専用の soft 値として分離する。
   */
  packageSoftAdjust: FIELD_OWNER.derivedScoreWorker,
  // §7 / §28.1 Score input version fields。Phase 1 は総称 scorePolicyVersion しか
  // 宣言しておらず、Score Worker が §7 の正規 field を書けなかった。
  // §92.2「先に Schema Contract を変更する」に従って ownership を明示する。
  confidencePolicyVersion: FIELD_OWNER.derivedScoreWorker,
  scoreBuiltinDictionaryVersion: FIELD_OWNER.derivedScoreWorker,
  scoreCountryProfileVersion: FIELD_OWNER.derivedScoreWorker,
  scoreCountryCanonicalizationVersion: FIELD_OWNER.derivedScoreWorker,
  scoreWorldRegionCanonicalizationVersion: FIELD_OWNER.derivedScoreWorker,
  scoreModelLineageRegistryVersion: FIELD_OWNER.derivedScoreWorker,
  scoreContextHashSchemaVersion: FIELD_OWNER.derivedScoreWorker,
  scoreLanguageInferenceVersion: FIELD_OWNER.derivedScoreWorker,
  scoreDerivationPolicyVersion: FIELD_OWNER.derivedScoreWorker,
  // Revalidation / dependency workflow
  revalidationState: FIELD_OWNER.revalidationWorkflow,
  // Import / Doctor quarantine workflow
  quarantined: FIELD_OWNER.quarantineWorkflow,
  quarantineMetadata: FIELD_OWNER.quarantineWorkflow,
  stagingSessionId: FIELD_OWNER.quarantineWorkflow,
  // User / explicit semantic mutation
  locked: FIELD_OWNER.explicitSemanticMutation,
  lockMetadata: FIELD_OWNER.explicitSemanticMutation,
  disabled: FIELD_OWNER.explicitSemanticMutation,
  deletedAt: FIELD_OWNER.explicitSemanticMutation,
  lifecycleState: FIELD_OWNER.explicitSemanticMutation,
  verificationState: FIELD_OWNER.explicitSemanticMutation,
  semanticRevision: FIELD_OWNER.explicitSemanticMutation,
  supersededByClaimId: FIELD_OWNER.explicitSemanticMutation,
  // Usage buffer（§31.1 approximate / buffered）
  useCount: FIELD_OWNER.usageBuffer,
  lastUsedAt: FIELD_OWNER.usageBuffer,
  /**
   * Phase 9C §146.4 / §150「Active Review → 人間確認の効果を最大化」。
   * `{ deferredUntil, deferredAt, deferredBy, deferReason, hiddenUntil,
   *    hiddenAt, hiddenBy, hideReason }` の bundle。deferUntil が過去なら
   * defer 期限切れとして扱う（フィールドは残るが Queue には再表示される）。
   * Truth/confidenceScore/authority を一切含まない（§120-16 と同じ原則）。
   */
  reviewQueueState: FIELD_OWNER.reviewQueueWorkflow
});
function assertOwnedFields(owner, patch) {
  const bad = Object.keys(patch).filter((f) => CLAIM_FIELD_OWNERSHIP[f] !== owner);
  if (bad.length) {
    throw new Error(
      `Field ownership violation: owner "${owner}" may not write [${bad.join(", ")}]. §92.2 requires a Schema Contract change instead of an ad-hoc merge.`
    );
  }
  return true;
}
__name(assertOwnedFields, "assertOwnedFields");
var DICTIONARY_SCHEMA_VERSION = 1;
var CLAIM_SCHEMA_VERSION = 1;
var EVIDENCE_SCHEMA_VERSION = 1;
var RELATION_SCHEMA_VERSION = 1;
var SUPPORTED_SCHEMA_RANGE = Object.freeze({
  dictionarySchemaVersion: { min: 1, max: 1 },
  claimSchemaVersion: { min: 1, max: 1 },
  keySchemaVersion: { min: 1, max: 1 }
});
function defaultMeta({ installationId, now = Date.now() }) {
  return {
    dictionarySchemaVersion: DICTIONARY_SCHEMA_VERSION,
    schemaCompatibilityEpoch: 1,
    claimSchemaVersion: CLAIM_SCHEMA_VERSION,
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    relationSchemaVersion: RELATION_SCHEMA_VERSION,
    backupFormatVersion: 1,
    portableFormatVersion: 1,
    packageFormatVersion: 1,
    packageManifestVersion: 1,
    packageTrustPolicyVersion: 1,
    packageStateRevision: 0,
    keySchemaVersion: KEY_SCHEMA_VERSION,
    contextHashSchemaVersion: 1,
    originRecordKeyVersion: 1,
    sourceNormalizerVersion: 1,
    valueNormalizerVersion: VALUE_NORMALIZER_VERSION,
    parserVersion: PARSER_VERSION,
    sourceNameFingerprintVersion: 1,
    sourceNameGuardPolicyVersion: 1,
    targetProfileVersion: TARGET_PROFILE_VERSION,
    resolverVersion: RESOLVER_VERSION,
    confidencePolicyVersion: 1,
    // §74: Render Policy 定数から導出し、Composer と meta が drift しないようにする。
    renderPolicyVersion: RENDER_POLICY_VERSION,
    countryProfileVersion: 1,
    languageInferenceVersion: 1,
    nativeRecoveryPolicyVersion: 1,
    nativeConversionPolicyVersion: 1,
    derivationPolicyVersion: 1,
    promptProfilesVersion: 1,
    generationStrategyVersion: 1,
    candidateGenerationRevision: 1,
    cacheKeySchemaVersion: 1,
    countryCanonicalizationVersion: 2,
    worldRegionCanonicalizationVersion: 1,
    // §22.3:「modelLineageRegistryVersion を resolutionPolicyFingerprint へ含める」。
    // 出荷 Registry の定数から導出し、Registry と meta が drift しないようにする。
    modelLineageRegistryVersion: MODEL_LINEAGE_REGISTRY_VERSION,
    // 2.0.0: 出荷 Builtin は 0 件。release 定数から導出し、defaultMeta と
    // RELEASE_POLICY_VERSION_FIELDS が drift しないようにする。
    builtinDictionaryVersion: BUILTIN_DICTIONARY_VERSION,
    userDictionaryRevision: 0,
    // §105.1 legacyMigration state machine。Phase 1 では not_started のまま。
    legacyMigration: {
      version: 1,
      state: "not_started",
      sourceFingerprint: null,
      completedAt: null
    },
    // CR-1 / §105: production bootstrap の **per-source** 完了記録。
    // `legacyMigration` は Migration engine が持つ単一 checkpoint（最後に走った
    // source の fingerprint）なので、fm_user_dict と fm_user_dict_v2 の両方を
    // 扱うには source 別の完了記録が要る。engine の checkpoint 意味論は変えない。
    // 旧DB には存在しないので、読み手は **欠落を許容** しなければならない
    // （dictionary-bootstrap.js `readBootstrapMeta()`）。
    legacyBootstrap: {
      version: 1,
      sources: {}
    },
    lastBackupAt: null,
    lastDoctorRunAt: null,
    lastRevalidationAt: null,
    installationId,
    maxPhraseTokensByTarget: { club: 6, comp: 8, player: 4, stadium: 6 },
    maintenanceLock: null,
    createdAt: now
  };
}
__name(defaultMeta, "defaultMeta");
var BACKUP_META_WHITELIST = Object.freeze([
  "dictionarySchemaVersion",
  "schemaCompatibilityEpoch",
  "claimSchemaVersion",
  "evidenceSchemaVersion",
  "relationSchemaVersion",
  "backupFormatVersion",
  "portableFormatVersion",
  "packageFormatVersion",
  "packageManifestVersion",
  "packageTrustPolicyVersion",
  "packageStateRevision",
  "keySchemaVersion",
  "contextHashSchemaVersion",
  "originRecordKeyVersion",
  "sourceNormalizerVersion",
  "valueNormalizerVersion",
  "parserVersion",
  "sourceNameFingerprintVersion",
  "sourceNameGuardPolicyVersion",
  "targetProfileVersion",
  "resolverVersion",
  "confidencePolicyVersion",
  "renderPolicyVersion",
  "countryProfileVersion",
  "languageInferenceVersion",
  "nativeRecoveryPolicyVersion",
  "nativeConversionPolicyVersion",
  "derivationPolicyVersion",
  "promptProfilesVersion",
  "generationStrategyVersion",
  "candidateGenerationRevision",
  "cacheKeySchemaVersion",
  "countryCanonicalizationVersion",
  "worldRegionCanonicalizationVersion",
  "modelLineageRegistryVersion",
  "builtinDictionaryVersion",
  "maxPhraseTokensByTarget",
  "legacyMigration",
  // CR-1: Claim 本体を含む Backup と per-source migration 進捗が一緒に移動する。
  "legacyBootstrap",
  "sourceInstallationId",
  "capturedUserDictionaryRevision"
]);
var BACKUP_EXCLUDED_STORES = Object.freeze([
  STORE.cache,
  STORE.jobs
]);
var BACKUP_FORMAT = "FMlncGenDictionaryBackup";
var BACKUP_VERSION = 1;
var SchemaWriteGateError = class extends Error {
  static {
    __name(this, "SchemaWriteGateError");
  }
  constructor(message, details) {
    super(message);
    this.name = "SchemaWriteGateError";
    this.details = details;
    this.reloadRequired = true;
  }
};
function checkSchemaWriteCompatibility(meta, range = SUPPORTED_SCHEMA_RANGE) {
  const violations = [];
  for (const [field, { min, max }] of Object.entries(range)) {
    const v = meta?.[field];
    if (typeof v !== "number") {
      violations.push({ field, reason: "missing", value: v });
      continue;
    }
    if (v > max) violations.push({ field, reason: "db_newer_than_client", value: v, clientMax: max });
    else if (v < min) violations.push({ field, reason: "db_older_than_supported", value: v, clientMin: min });
  }
  return { compatible: violations.length === 0, violations };
}
__name(checkSchemaWriteCompatibility, "checkSchemaWriteCompatibility");
function assertSchemaWritable(meta, range = SUPPORTED_SCHEMA_RANGE) {
  const r = checkSchemaWriteCompatibility(meta, range);
  if (!r.compatible) {
    throw new SchemaWriteGateError(
      "Semantic write blocked: dictionary schema is not write-compatible with this client. Reload / update required (§96.4).",
      r.violations
    );
  }
  return true;
}
__name(assertSchemaWritable, "assertSchemaWritable");

// dictionary-storage.js
var META_KEY = "meta";
var BROADCAST_CHANNEL_NAME = "fmlncgen-dictionary";
var OWNER_TOKEN = newOpaqueId("owner");
var LEASE_POLICY = Object.freeze({
  defaultTtlMs: 3e4,
  heartbeatIntervalMs: 1e4
});
var COLLECTION_POLICY = Object.freeze({
  defaultLimit: 200,
  maxLimit: 1e3
});
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(req, "req");
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException("Transaction aborted", "AbortError"));
  });
}
__name(txDone, "txDone");
function idbFactory(env) {
  const f = env?.indexedDB ?? globalThis.indexedDB;
  if (!f) throw new Error("IndexedDB unavailable (§115: caller must degrade, not crash)");
  return f;
}
__name(idbFactory, "idbFactory");
function applyPhysicalSchema(db, tx) {
  for (const storeName of STORE_NAMES) {
    const def = SCHEMA[storeName];
    const store = db.objectStoreNames.contains(storeName) ? tx.objectStore(storeName) : db.createObjectStore(storeName, { keyPath: def.keyPath });
    const existing = /* @__PURE__ */ new Set([...store.indexNames]);
    for (const idx of def.indexes) {
      if (existing.has(idx.name)) continue;
      store.createIndex(idx.name, idx.keyPath, {
        unique: Boolean(idx.unique),
        multiEntry: Boolean(idx.multiEntry)
      });
    }
  }
}
__name(applyPhysicalSchema, "applyPhysicalSchema");
async function openDictionaryDB(opts = {}) {
  assertSchemaConstraints();
  const factory = idbFactory(opts.env);
  const db = await new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => applyPhysicalSchema(open.result, open.transaction);
    open.onblocked = () => {
      opts.onBlocked?.();
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  db.onversionchange = () => {
    try {
      opts.onVersionChange?.(db);
    } finally {
      if (opts.closeOnVersionChange !== false) db.close();
    }
  };
  await ensureMeta(db, opts);
  return db;
}
__name(openDictionaryDB, "openDictionaryDB");
async function ensureMeta(db, opts) {
  const tx = db.transaction([STORE.meta], "readwrite");
  const store = tx.objectStore(STORE.meta);
  const current = await req(store.get(META_KEY));
  let policyRefresh = { changed: false, drift: [] };
  if (!current) {
    const installationId = opts.installationId ?? newOpaqueId("install");
    store.put({ key: META_KEY, ...defaultMeta({ installationId, now: opts.now ?? Date.now() }) });
  } else {
    const applied = applyReleasePolicyVersions(current);
    if (applied.changed) {
      store.put(applied.record);
      policyRefresh = { changed: true, drift: applied.drift };
    }
  }
  await txDone(tx);
  return policyRefresh;
}
__name(ensureMeta, "ensureMeta");
async function getMeta(db) {
  const tx = db.transaction([STORE.meta], "readonly");
  const m = await req(tx.objectStore(STORE.meta).get(META_KEY));
  await txDone(tx);
  return m;
}
__name(getMeta, "getMeta");
function readMetaIn(tx) {
  return req(tx.objectStore(STORE.meta).get(META_KEY));
}
__name(readMetaIn, "readMetaIn");
function writeMetaIn(tx, meta) {
  return req(tx.objectStore(STORE.meta).put(meta));
}
__name(writeMetaIn, "writeMetaIn");
async function runSemanticMutation(db, storeNames, work, {
  bumpRevision = true,
  /**
   * §98 / §45.2 fencing token。Maintenance owner が自分であることを **同一
   * transaction 内で** 再確認する。`{owner, leaseEpoch}` を渡すと、mismatch 時に
   * transaction を abort して1 field も commit させない。
   */
  fence = null,
  /**
   * §87.5 / §132.9 Phase 4: Cache invalidation を意味的Mutationと**同一
   * transaction** に含めたい呼び出し側が、追加で開く Store を指定する。
   * 既定は空配列 — 呼び出し側が明示しない限りこれまでの trasaction 範囲を
   * 一切変えない（Phase 1〜3B の呼び出し互換性を壊さない）。
   */
  extraStores = []
} = {}) {
  const names = [.../* @__PURE__ */ new Set([...storeNames, ...extraStores, STORE.meta])];
  const tx = db.transaction(names, "readwrite");
  let meta = await readMetaIn(tx);
  assertSchemaWritable(meta);
  if (fence) {
    try {
      assertMaintenanceFenceOnMeta(meta, fence);
    } catch (e) {
      try {
        tx.abort();
      } catch {
      }
      throw e;
    }
  } else {
    try {
      assertNoForeignMaintenanceLock(meta);
    } catch (e) {
      try {
        tx.abort();
      } catch {
      }
      throw e;
    }
  }
  const ctx = {
    tx,
    store: /* @__PURE__ */ __name((n) => tx.objectStore(n), "store"),
    meta,
    /** 追加の meta patch を同一 transaction で反映する。 */
    patchMeta: /* @__PURE__ */ __name((patch) => {
      meta = { ...meta, ...patch };
    }, "patchMeta")
  };
  let result;
  try {
    result = await work(ctx);
  } catch (e) {
    try {
      tx.abort();
    } catch {
    }
    throw e;
  }
  if (bumpRevision) meta = { ...meta, userDictionaryRevision: (meta.userDictionaryRevision ?? 0) + 1 };
  await writeMetaIn(tx, meta);
  await txDone(tx);
  return { result, userDictionaryRevision: meta.userDictionaryRevision };
}
__name(runSemanticMutation, "runSemanticMutation");
async function runRead(db, storeNames, work) {
  const tx = db.transaction(storeNames, "readonly");
  const out = await work({ tx, store: /* @__PURE__ */ __name((n) => tx.objectStore(n), "store") });
  await txDone(tx);
  return out;
}
__name(runRead, "runRead");
function isConstraintError(e) {
  return e && (e.name === "ConstraintError" || e.code === 22);
}
__name(isConstraintError, "isConstraintError");
async function upsertByUniqueIndex(tx, storeName, indexName, keyValue, buildRecord) {
  const store = tx.objectStore(storeName);
  const index = store.index(indexName);
  const existing = await req(index.get(keyValue));
  if (existing) return { record: existing, created: false, raced: false };
  const record = buildRecord();
  try {
    await req(store.add(record));
    return { record, created: true, raced: false };
  } catch (e) {
    if (!isConstraintError(e)) throw e;
    const winner = await req(index.get(keyValue));
    if (!winner) throw e;
    return { record: winner, created: false, raced: true };
  }
}
__name(upsertByUniqueIndex, "upsertByUniqueIndex");
function upsertClaimBySemanticKey(tx, { semanticKey: semanticKey2, build }) {
  return upsertByUniqueIndex(tx, STORE.claims, "semanticKey", semanticKey2, build);
}
__name(upsertClaimBySemanticKey, "upsertClaimBySemanticKey");
function upsertEvidenceByDedupeKey(tx, { dedupeKey: dedupeKey2, build }) {
  return upsertByUniqueIndex(tx, STORE.evidence, "dedupeKey", dedupeKey2, build);
}
__name(upsertEvidenceByDedupeKey, "upsertEvidenceByDedupeKey");
function addRelationIfMissing(tx, { edgeKey: edgeKey2, build }) {
  return upsertByUniqueIndex(tx, STORE.relations, "edgeKey", edgeKey2, build);
}
__name(addRelationIfMissing, "addRelationIfMissing");
function upsertRejectionByKey(tx, { rejectionKey: rejectionKey2, build }) {
  return upsertByUniqueIndex(tx, STORE.rejections, "rejectionKey", rejectionKey2, build);
}
__name(upsertRejectionByKey, "upsertRejectionByKey");
function upsertPackageByPackageId(tx, { packageId, build }) {
  return upsertByUniqueIndex(tx, STORE.packages, "packageId", packageId, build);
}
__name(upsertPackageByPackageId, "upsertPackageByPackageId");
async function patchClaimExplicitState(tx, claimId, patch, { now = Date.now() } = {}) {
  assertOwnedFields(FIELD_OWNER.explicitSemanticMutation, patch);
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`patchClaimExplicitState: claim not found: ${claimId}`);
  const next = {
    ...current,
    ...patch,
    semanticRevision: (current.semanticRevision ?? 0) + 1,
    updatedAt: now
  };
  await req(store.put(next));
  return next;
}
__name(patchClaimExplicitState, "patchClaimExplicitState");
async function patchClaimDerivedFields(tx, claimId, patch, { expectedScoreInputRevision, now = Date.now() } = {}) {
  assertOwnedFields(FIELD_OWNER.derivedScoreWorker, patch);
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`patchClaimDerivedFields: claim not found: ${claimId}`);
  const stale = expectedScoreInputRevision !== void 0 && current.scoreInputRevision !== expectedScoreInputRevision;
  if (stale) {
    return { record: current, stale: true, applied: false };
  }
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) next[k] = v;
  if (expectedScoreInputRevision !== void 0) {
    next.scoreDirty = false;
    next.scoreComputedFromInputRevision = current.scoreInputRevision;
  }
  next.derivedRevision = (current.derivedRevision ?? 0) + 1;
  next.scoreComputedAt = now;
  await req(store.put(next));
  return { record: next, stale: false, applied: true };
}
__name(patchClaimDerivedFields, "patchClaimDerivedFields");
async function patchClaimQuarantineState(tx, claimId, patch, { now = Date.now() } = {}) {
  assertOwnedFields(FIELD_OWNER.quarantineWorkflow, patch);
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`patchClaimQuarantineState: claim not found: ${claimId}`);
  const next = { ...current, ...patch, updatedAt: now };
  await req(store.put(next));
  return next;
}
__name(patchClaimQuarantineState, "patchClaimQuarantineState");
async function patchClaimReviewQueueState(tx, claimId, patch, { now = Date.now() } = {}) {
  assertOwnedFields(FIELD_OWNER.reviewQueueWorkflow, patch);
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`patchClaimReviewQueueState: claim not found: ${claimId}`);
  const next = { ...current, ...patch, updatedAt: now };
  await req(store.put(next));
  return next;
}
__name(patchClaimReviewQueueState, "patchClaimReviewQueueState");
async function patchClaimRevalidationState(tx, claimId, patch, { now = Date.now() } = {}) {
  assertOwnedFields(FIELD_OWNER.revalidationWorkflow, patch);
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`patchClaimRevalidationState: claim not found: ${claimId}`);
  const next = { ...current, ...patch, updatedAt: now };
  await req(store.put(next));
  return next;
}
__name(patchClaimRevalidationState, "patchClaimRevalidationState");
async function markClaimScoreInputChanged(tx, claimId) {
  const store = tx.objectStore(STORE.claims);
  const current = await req(store.get(claimId));
  if (!current) throw new Error(`markClaimScoreInputChanged: claim not found: ${claimId}`);
  const next = {
    ...current,
    scoreInputRevision: (current.scoreInputRevision ?? 0) + 1,
    scoreDirty: true
  };
  await req(store.put(next));
  return next;
}
__name(markClaimScoreInputChanged, "markClaimScoreInputChanged");
function clampLimit(limit) {
  const n = Number.isFinite(limit) ? Math.floor(limit) : COLLECTION_POLICY.defaultLimit;
  if (n <= 0) throw new RangeError("limit must be positive");
  return Math.min(n, COLLECTION_POLICY.maxLimit);
}
__name(clampLimit, "clampLimit");
async function iterateIndex(db, {
  storeName,
  indexName = null,
  query = null,
  direction = "next",
  limit,
  cursor = null
}) {
  const max = clampLimit(limit);
  const isIndex = Boolean(indexName);
  const range = cursor ? cursor.range ?? null : query;
  return runRead(db, [storeName], async ({ store }) => {
    const src = isIndex ? store(storeName).index(indexName) : store(storeName);
    const items = [];
    let nextCursor = null;
    await new Promise((resolve, reject) => {
      const request = src.openCursor(range ?? null, direction);
      let positioned = !cursor;
      let skippedBoundary = !cursor;
      request.onsuccess = () => {
        const c = request.result;
        if (!c) {
          resolve();
          return;
        }
        if (!positioned) {
          positioned = true;
          if (isIndex) c.continuePrimaryKey(cursor.indexKey, cursor.primaryKey);
          else c.continue(cursor.primaryKey);
          return;
        }
        if (!skippedBoundary) {
          skippedBoundary = true;
          if (indexedDBKeyEquals(c.primaryKey, cursor.primaryKey)) {
            c.continue();
            return;
          }
        }
        items.push(c.value);
        if (items.length >= max) {
          nextCursor = { range, indexKey: c.key, primaryKey: c.primaryKey };
          resolve();
          return;
        }
        c.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return { items, nextCursor, done: nextCursor === null };
  });
}
__name(iterateIndex, "iterateIndex");
function indexedDBKeyEquals(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => indexedDBKeyEquals(x, b[i]));
  }
  return a === b;
}
__name(indexedDBKeyEquals, "indexedDBKeyEquals");
function iterateEvidenceForClaim(db, claimId, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.evidence,
    indexName: "claimId",
    query: cursor ? void 0 : IDBKeyRange.only(claimId),
    limit,
    cursor
  });
}
__name(iterateEvidenceForClaim, "iterateEvidenceForClaim");
function iterateDependents(db, { toNodeId, relation, limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.relations,
    indexName: "toNodeId_relation",
    query: cursor ? void 0 : IDBKeyRange.only([toNodeId, relation]),
    limit,
    cursor
  });
}
__name(iterateDependents, "iterateDependents");
async function forEachChunk(db, storeName, onChunk, { chunkSize = 500 } = {}) {
  let cursor = null;
  let total = 0;
  for (; ; ) {
    const page = await iterateIndex(db, { storeName, limit: chunkSize, cursor });
    if (page.items.length) {
      await onChunk(page.items);
      total += page.items.length;
    }
    if (page.done) break;
    cursor = page.nextCursor;
  }
  return total;
}
__name(forEachChunk, "forEachChunk");
var LeaseError = class extends Error {
  static {
    __name(this, "LeaseError");
  }
  constructor(message, details) {
    super(message);
    this.name = "LeaseError";
    this.details = details;
  }
};
function leaseIsLive(lock, now) {
  return Boolean(lock && lock.owner && typeof lock.expiresAt === "number" && lock.expiresAt > now);
}
__name(leaseIsLive, "leaseIsLive");
async function acquireMaintenanceLease(db, {
  type,
  ttlMs = LEASE_POLICY.defaultTtlMs,
  owner = OWNER_TOKEN,
  now = Date.now(),
  steal = false
}) {
  const tx = db.transaction([STORE.meta], "readwrite");
  const meta = await readMetaIn(tx);
  const lock = meta.maintenanceLock;
  if (leaseIsLive(lock, now) && lock.owner !== owner && !steal) {
    await txDone(tx);
    throw new LeaseError("maintenance lease held by another owner", { lock });
  }
  const nextEpoch = (lock?.leaseEpoch ?? 0) + 1;
  const nextLock = {
    owner,
    type,
    leaseEpoch: nextEpoch,
    acquiredAt: now,
    expiresAt: now + ttlMs,
    heartbeatAt: now
  };
  await writeMetaIn(tx, { ...meta, maintenanceLock: nextLock });
  await txDone(tx);
  return nextLock;
}
__name(acquireMaintenanceLease, "acquireMaintenanceLease");
async function renewMaintenanceLease(db, {
  owner = OWNER_TOKEN,
  leaseEpoch,
  ttlMs = LEASE_POLICY.defaultTtlMs,
  now = Date.now()
}) {
  const tx = db.transaction([STORE.meta], "readwrite");
  const meta = await readMetaIn(tx);
  const lock = meta.maintenanceLock;
  if (!lock || lock.owner !== owner || lock.leaseEpoch !== leaseEpoch) {
    await txDone(tx);
    throw new LeaseError("cannot renew: not the current lease owner/epoch", { lock, owner, leaseEpoch });
  }
  const next = { ...lock, expiresAt: now + ttlMs, heartbeatAt: now };
  await writeMetaIn(tx, { ...meta, maintenanceLock: next });
  await txDone(tx);
  return next;
}
__name(renewMaintenanceLease, "renewMaintenanceLease");
async function releaseMaintenanceLease(db, { owner = OWNER_TOKEN, leaseEpoch }) {
  const tx = db.transaction([STORE.meta], "readwrite");
  const meta = await readMetaIn(tx);
  const lock = meta.maintenanceLock;
  if (!lock || lock.owner !== owner || lock.leaseEpoch !== leaseEpoch) {
    await txDone(tx);
    throw new LeaseError("cannot release: not the current lease owner/epoch", { lock, owner, leaseEpoch });
  }
  const next = {
    owner: null,
    type: lock.type,
    leaseEpoch: lock.leaseEpoch,
    // ← 0 へ戻さない
    acquiredAt: lock.acquiredAt,
    expiresAt: null,
    heartbeatAt: lock.heartbeatAt
  };
  await writeMetaIn(tx, { ...meta, maintenanceLock: next });
  await txDone(tx);
  return next;
}
__name(releaseMaintenanceLease, "releaseMaintenanceLease");
function assertMaintenanceFenceOnMeta(meta, {
  owner = OWNER_TOKEN,
  leaseEpoch,
  now = Date.now()
} = {}) {
  const lock = meta?.maintenanceLock;
  if (!lock || lock.owner !== owner || lock.leaseEpoch !== leaseEpoch || !leaseIsLive(lock, now)) {
    throw new LeaseError("fencing token mismatch: refusing to commit", {
      lock,
      owner,
      leaseEpoch
    });
  }
  return meta;
}
__name(assertMaintenanceFenceOnMeta, "assertMaintenanceFenceOnMeta");
function assertNoForeignMaintenanceLock(meta, {
  owner = OWNER_TOKEN,
  now = Date.now()
} = {}) {
  const lock = meta?.maintenanceLock;
  if (leaseIsLive(lock, now) && lock.owner !== owner) {
    throw new LeaseError(
      `dictionary semantic write is paused: maintenance lease "${lock.type}" is held by another owner (§98). Retry after the maintenance transition completes.`,
      { lock, owner }
    );
  }
  return meta;
}
__name(assertNoForeignMaintenanceLock, "assertNoForeignMaintenanceLock");
var RESTORE_MARKER_META_KEY = "maintenanceRestore";
var MERGE_MARKER_META_KEY = "maintenanceMerge";
function markerInProgress(marker) {
  return Boolean(marker && typeof marker === "object" && marker.state === "running");
}
__name(markerInProgress, "markerInProgress");
function dictionaryMaintenanceState(meta, { now = Date.now(), owner = OWNER_TOKEN } = {}) {
  const lock = meta?.maintenanceLock ?? null;
  const active = leaseIsLive(lock, now);
  const lm = meta?.legacyMigration ?? null;
  const state = lm?.state ?? "not_started";
  const phase = lm?.phase ?? null;
  const legacyMigrationTransitionComplete = state === "not_started" || state === "completed" && phase === "done";
  const restoreMarker = meta?.[RESTORE_MARKER_META_KEY] ?? null;
  const mergeMarker = meta?.[MERGE_MARKER_META_KEY] ?? null;
  const restoreInProgress = markerInProgress(restoreMarker);
  const mergeInProgress = markerInProgress(mergeMarker);
  const knowledgeReplacementInProgress = restoreInProgress || mergeInProgress;
  let knowledgeReplacementReason = null;
  if (restoreInProgress) knowledgeReplacementReason = "restore_incomplete";
  else if (mergeInProgress) knowledgeReplacementReason = "merge_incomplete";
  return {
    maintenanceActive: active,
    maintenanceType: active ? lock.type : null,
    maintenanceOwnedByMe: active && lock.owner === owner,
    maintenanceLock: lock,
    legacyMigrationState: state,
    legacyMigrationPhase: phase,
    legacyMigrationTransitionComplete,
    // §106.3 Phase 9A
    restoreInProgress,
    mergeInProgress,
    knowledgeReplacementInProgress,
    knowledgeReplacementReason,
    restoreMarkerPhase: restoreMarker?.phase ?? null,
    mergeMarkerPhase: mergeMarker?.phase ?? null,
    // §98:「Read-only lookup は可能な範囲で継続」。ただし transition 未完了の
    // half-activated Knowledge を「正常 Current Dictionary」として扱ってはいけない。
    // restore/merge が incomplete なら（lease の有無に関わらず）stable ではない。
    currentKnowledgeStable: !active && legacyMigrationTransitionComplete && !knowledgeReplacementInProgress,
    semanticWriteAllowed: !active || lock.owner === owner
  };
}
__name(dictionaryMaintenanceState, "dictionaryMaintenanceState");
async function acquireJobLease(tx, jobId, {
  owner = OWNER_TOKEN,
  ttlMs = LEASE_POLICY.defaultTtlMs,
  now = Date.now(),
  steal = false
}) {
  const store = tx.objectStore(STORE.jobs);
  const job = await req(store.get(jobId));
  if (!job) throw new LeaseError(`job not found: ${jobId}`, { jobId });
  const live = job.leaseOwner && job.leaseExpiresAt > now;
  if (live && job.leaseOwner !== owner && !steal) {
    throw new LeaseError("job lease held by another owner", { job });
  }
  const next = {
    ...job,
    leaseOwner: owner,
    leaseEpoch: (job.leaseEpoch ?? 0) + 1,
    leaseExpiresAt: now + ttlMs,
    updatedAt: now
  };
  await req(store.put(next));
  return next;
}
__name(acquireJobLease, "acquireJobLease");
async function releaseJobLease(tx, jobId, { owner = OWNER_TOKEN, leaseEpoch, now = Date.now() }) {
  const store = tx.objectStore(STORE.jobs);
  const job = await req(store.get(jobId));
  if (!job || job.leaseOwner !== owner || job.leaseEpoch !== leaseEpoch) {
    throw new LeaseError("cannot release job lease: owner/epoch mismatch", { job, owner, leaseEpoch });
  }
  const next = { ...job, leaseOwner: null, leaseExpiresAt: null, leaseEpoch: job.leaseEpoch, updatedAt: now };
  await req(store.put(next));
  return next;
}
__name(releaseJobLease, "releaseJobLease");
async function assertJobFence(tx, jobId, { owner = OWNER_TOKEN, leaseEpoch, now = Date.now() }) {
  const job = await req(tx.objectStore(STORE.jobs).get(jobId));
  if (!job || job.leaseOwner !== owner || job.leaseEpoch !== leaseEpoch || !(job.leaseExpiresAt > now)) {
    throw new LeaseError("job fencing token mismatch: refusing to commit chunk", { job, owner, leaseEpoch });
  }
  return job;
}
__name(assertJobFence, "assertJobFence");
var BROADCAST_EVENTS = Object.freeze([
  "claimChanged",
  "claimDeleted",
  "evidenceChanged",
  "rejectionChanged",
  "entityObservationChanged",
  "cacheInvalidated",
  "metaRevisionChanged",
  "maintenanceLockChanged",
  "dbUpgradeRequired",
  "bulkDictionaryChanged"
]);
var BULK_BROADCAST_THRESHOLD = 100;
function createBroadcast({ env = globalThis, channelName = BROADCAST_CHANNEL_NAME } = {}) {
  const Ctor = env.BroadcastChannel;
  const supported = typeof Ctor === "function";
  const channel = supported ? new Ctor(channelName) : null;
  const listeners = /* @__PURE__ */ new Set();
  if (channel) channel.onmessage = (e) => {
    for (const l of listeners) l(e.data);
  };
  return {
    supported,
    /** @param {{type:string, revision?:number, scope?:string}} message */
    post(message) {
      if (!BROADCAST_EVENTS.includes(message?.type)) {
        throw new Error(`unknown broadcast event: ${message?.type}`);
      }
      const payload = {
        type: message.type,
        revision: message.revision ?? null,
        scope: message.scope ?? null,
        count: message.count ?? null,
        origin: OWNER_TOKEN
      };
      channel?.postMessage(payload);
      return payload;
    },
    /** §94.2: 大量変更は個別イベントを撒かず bulk へ畳む。 */
    postChanges({ type, ids, revision, scope }) {
      if (ids.length > BULK_BROADCAST_THRESHOLD) {
        return this.post({ type: "bulkDictionaryChanged", revision, scope, count: ids.length });
      }
      return this.post({ type, revision, scope, count: ids.length });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      channel?.close();
      listeners.clear();
    }
  };
}
__name(createBroadcast, "createBroadcast");
var BACKUP_MODE = Object.freeze({
  optimisticRevisionCheck: "optimistic_revision_check",
  maintenanceSnapshot: "maintenance_snapshot"
});
var BackupConsistencyError = class extends Error {
  static {
    __name(this, "BackupConsistencyError");
  }
  constructor(message, details) {
    super(message);
    this.name = "BackupConsistencyError";
    this.details = details;
  }
};
var BACKUP_STORE_TO_FIELD = Object.freeze({
  [STORE.entities]: "entities",
  [STORE.claims]: "claims",
  [STORE.evidence]: "evidence",
  [STORE.relations]: "relations",
  [STORE.history]: "history",
  [STORE.rejections]: "rejections",
  [STORE.packages]: "packages"
});
function parseLegacyDictionaryJson(rawJsonText) {
  if (typeof rawJsonText !== "string") {
    return { ok: false, reason: "not_a_string", value: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (e) {
    return { ok: false, reason: "invalid_json", error: String(e), value: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not_a_flat_object", value: null };
  }
  return { ok: true, value: parsed };
}
__name(parseLegacyDictionaryJson, "parseLegacyDictionaryJson");
function classifyLegacyRecordValue(sourceText, value) {
  if (typeof sourceText !== "string" || sourceText.length === 0) {
    return { sourceText, kind: "invalid_key", fields: [] };
  }
  if (typeof value === "string") {
    if (value.length === 0) return { sourceText, kind: "empty", fields: [] };
    return {
      sourceText,
      kind: "string",
      fields: [{ legacyField: "t", valueType: LEGACY_FIELD_MAP.t, value }]
    };
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const fields = [];
    const rejected = [];
    for (const [legacyField, valueType] of Object.entries(LEGACY_FIELD_MAP)) {
      const v = value[legacyField];
      if (v === void 0) continue;
      if (typeof v === "string" && v.length > 0) fields.push({ legacyField, valueType, value: v });
      else rejected.push({ legacyField, reason: typeof v !== "string" ? "not_a_string" : "empty" });
    }
    const unknown = Object.keys(value).filter((k) => !(k in LEGACY_FIELD_MAP));
    return { sourceText, kind: "object", fields, rejected, unknownFields: unknown };
  }
  return { sourceText, kind: "unsupported", valueType: typeof value, fields: [] };
}
__name(classifyLegacyRecordValue, "classifyLegacyRecordValue");
var LEGACY_FIELD_MAP = Object.freeze({
  t: "japanese_display",
  l3: "club_3letter_display",
  l6: "club_6letter_display"
});
async function getResolutionCacheEntry(db, resolutionKey2) {
  return runRead(db, [STORE.cache], ({ store }) => req(store(STORE.cache).get(resolutionKey2)));
}
__name(getResolutionCacheEntry, "getResolutionCacheEntry");
async function putResolutionCacheEntry(db, record) {
  const { result } = await runSemanticMutation(db, [STORE.cache], async ({ tx }) => {
    await req(tx.objectStore(STORE.cache).put(record));
    return record;
  }, { bumpRevision: false });
  return result;
}
__name(putResolutionCacheEntry, "putResolutionCacheEntry");
async function touchResolutionCacheLastUsed(db, resolutionKey2, now = Date.now()) {
  const { result } = await runSemanticMutation(db, [STORE.cache], async ({ tx }) => {
    const store = tx.objectStore(STORE.cache);
    const current = await req(store.get(resolutionKey2));
    if (!current) return null;
    const next = { ...current, lastUsedAt: now };
    await req(store.put(next));
    return next;
  }, { bumpRevision: false });
  return result;
}
__name(touchResolutionCacheLastUsed, "touchResolutionCacheLastUsed");
async function invalidateCacheEntriesByIndexIn(tx, indexName, key) {
  const store = tx.objectStore(STORE.cache);
  const index = store.index(indexName);
  const ids = /* @__PURE__ */ new Set();
  await new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const c = request.result;
      if (!c) {
        resolve();
        return;
      }
      ids.add(c.primaryKey);
      c.continue();
    };
    request.onerror = () => reject(request.error);
  });
  for (const id of ids) await req(store.delete(id));
  return ids.size;
}
__name(invalidateCacheEntriesByIndexIn, "invalidateCacheEntriesByIndexIn");
async function clearResolutionCacheIn(tx) {
  await req(tx.objectStore(STORE.cache).clear());
}
__name(clearResolutionCacheIn, "clearResolutionCacheIn");
async function clearResolutionCache(db) {
  await runSemanticMutation(db, [STORE.cache], async ({ tx }) => {
    await clearResolutionCacheIn(tx);
    return true;
  }, { bumpRevision: false });
}
__name(clearResolutionCache, "clearResolutionCache");

// dictionary-relations.js
var RELATION = Object.freeze({
  dependsOn: "depends_on",
  derivedFrom: "derived_from",
  replaces: "replaces",
  // §33:「conflicts_with は予約 / 明示Conflict用」
  conflictsWith: "conflicts_with",
  equivalentTo: "equivalent_to",
  variantOf: "variant_of",
  nativeFormOf: "native_form_of",
  japaneseReadingOf: "japanese_reading_of"
});
var CYCLE_POLICY = Object.freeze({
  forbid: "forbid",
  diagnose: "diagnose",
  allow: "allow"
});
var RELATION_TYPE_POLICIES = Object.freeze({
  depends_on: { directed: true, cyclePolicy: CYCLE_POLICY.forbid },
  derived_from: { directed: true, cyclePolicy: CYCLE_POLICY.diagnose },
  replaces: { directed: true, cyclePolicy: CYCLE_POLICY.forbid },
  conflicts_with: { directed: false, cyclePolicy: CYCLE_POLICY.allow },
  equivalent_to: { directed: false, cyclePolicy: CYCLE_POLICY.allow },
  variant_of: { directed: false, cyclePolicy: CYCLE_POLICY.allow },
  native_form_of: { directed: true, cyclePolicy: CYCLE_POLICY.diagnose },
  japanese_reading_of: { directed: true, cyclePolicy: CYCLE_POLICY.diagnose }
});
var PHASE3_ACTIVE_RELATIONS = Object.freeze([
  RELATION.dependsOn,
  RELATION.derivedFrom,
  RELATION.replaces
]);
var RELATION_STATE = Object.freeze({
  active: "active",
  inactive: "inactive"
});
var RELATION_TRAVERSAL_POLICY = Object.freeze({
  maxDepth: 32,
  maxNodes: 512,
  pageSize: 200
});
var RelationError = class extends Error {
  static {
    __name(this, "RelationError");
  }
  constructor(message, details) {
    super(message);
    this.name = "RelationError";
    this.details = details;
  }
};
function relationPolicy(relation) {
  const p = RELATION_TYPE_POLICIES[relation];
  if (!p) throw new RelationError(`unknown relation: ${relation}`, { relation });
  return p;
}
__name(relationPolicy, "relationPolicy");
async function computeEdgeKey({ relation, fromNodeId, toNodeId }) {
  const policy = relationPolicy(relation);
  if (policy.directed) {
    return edgeKey({ relation, fromNodeId, toNodeId });
  }
  return symmetricEdgeKey({ relation, nodeA: fromNodeId, nodeB: toNodeId });
}
__name(computeEdgeKey, "computeEdgeKey");
function canonicalEndpoints({ relation, fromNodeId, toNodeId }) {
  if (relationPolicy(relation).directed) return { fromNodeId, toNodeId };
  return fromNodeId <= toNodeId ? { fromNodeId, toNodeId } : { fromNodeId: toNodeId, toNodeId: fromNodeId };
}
__name(canonicalEndpoints, "canonicalEndpoints");
async function buildRelationRecord({
  relation,
  fromNodeId,
  toNodeId,
  createdFromEvidenceRootId = null,
  now = Date.now()
}) {
  relationPolicy(relation);
  if (typeof fromNodeId !== "string" || !fromNodeId) {
    throw new RelationError("fromNodeId must be a non-empty string", { fromNodeId });
  }
  if (typeof toNodeId !== "string" || !toNodeId) {
    throw new RelationError("toNodeId must be a non-empty string", { toNodeId });
  }
  if (fromNodeId === toNodeId) {
    throw new RelationError(`§36: self-reference is not allowed (${relation})`, { relation, fromNodeId });
  }
  const ends = canonicalEndpoints({ relation, fromNodeId, toNodeId });
  const key = await computeEdgeKey({ relation, fromNodeId, toNodeId });
  return {
    relationId: newOpaqueId("rel"),
    fromNodeId: ends.fromNodeId,
    toNodeId: ends.toNodeId,
    relation,
    // §32:「Edgeが最初に作られた由来の診断情報。Edge identity には含めない。」
    createdFromEvidenceRootId,
    edgeKey: key,
    keySchemaVersion: 1,
    state: RELATION_STATE.active,
    // §36 / §131: bounded cycle check が予算内で完了したかの記録。
    // 'checked' / 'not_required' / 'deferred'（Doctor の全体 scan へ回す）
    cycleAudit: "not_required",
    invalidatedAt: null,
    invalidationReason: null,
    createdAt: now
  };
}
__name(buildRelationRecord, "buildRelationRecord");
async function outgoingEdges(db, nodeId, relation, { pageSize }) {
  const out = [];
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.relations,
      indexName: "fromNodeId_relation",
      query: cursor ? void 0 : IDBKeyRange.only([nodeId, relation]),
      limit: pageSize,
      cursor
    });
    for (const r of page.items) if (r.state === RELATION_STATE.active) out.push(r);
    if (page.done) break;
    cursor = page.nextCursor;
    if (out.length >= pageSize * 4) break;
  }
  return out;
}
__name(outgoingEdges, "outgoingEdges");
async function collectDependents(db, {
  toNodeId,
  relation,
  maxRecords = RELATION_TRAVERSAL_POLICY.maxNodes,
  pageSize = RELATION_TRAVERSAL_POLICY.pageSize
}) {
  const items = [];
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    const page = await iterateDependents(db, { toNodeId, relation, limit: pageSize, cursor });
    for (const r of page.items) {
      if (r.state !== RELATION_STATE.active) continue;
      if (items.length >= maxRecords) {
        truncated = true;
        break;
      }
      items.push(r);
    }
    if (truncated || page.done) break;
    cursor = page.nextCursor;
  }
  return { items, truncated };
}
__name(collectDependents, "collectDependents");
async function collectDependencies(db, {
  fromNodeId,
  relation = RELATION.dependsOn,
  maxDepth = RELATION_TRAVERSAL_POLICY.maxDepth,
  maxNodes = RELATION_TRAVERSAL_POLICY.maxNodes,
  pageSize = RELATION_TRAVERSAL_POLICY.pageSize
} = {}) {
  const visited = /* @__PURE__ */ new Set();
  let frontier = [fromNodeId];
  let depth = 0;
  let overflow = false;
  while (frontier.length > 0 && depth < maxDepth) {
    const next = [];
    for (const node of frontier) {
      const edges = await outgoingEdges(db, node, relation, { pageSize });
      for (const e of edges) {
        if (visited.has(e.toNodeId)) continue;
        if (visited.size >= maxNodes) {
          overflow = true;
          continue;
        }
        visited.add(e.toNodeId);
        next.push(e.toNodeId);
      }
    }
    if (overflow) break;
    frontier = next;
    depth++;
  }
  if (frontier.length > 0 && depth >= maxDepth) overflow = true;
  return { claimIds: [...visited], overflow };
}
__name(collectDependencies, "collectDependencies");

// dictionary-resolution-cache.js
var CACHE_DEPENDENCY_CLOSURE_POLICY = Object.freeze({
  maxDepth: 32,
  maxNodes: 512
});
var HIGH_FANOUT_THRESHOLD = 200;
async function computeResolutionContextKey({
  target,
  entityKey: entityKey2 = null,
  strictNormalizedInput,
  countryCode = null,
  worldRegionCode = null,
  requestedValueTypes,
  sourceNameFingerprint = null,
  cacheKeySchemaVersion,
  inputFingerprint: inputFingerprint2,
  inputFingerprintVersion = INPUT_FINGERPRINT_VERSION
}) {
  if (typeof target !== "string" || !target) throw new TypeError("computeResolutionContextKey: target is required");
  if (typeof strictNormalizedInput !== "string") {
    throw new TypeError("computeResolutionContextKey: strictNormalizedInput is required");
  }
  if (!Array.isArray(requestedValueTypes) || requestedValueTypes.length === 0) {
    throw new TypeError("computeResolutionContextKey: requestedValueTypes must be a non-empty array");
  }
  if (typeof inputFingerprint2 !== "string" || !inputFingerprint2) {
    throw new TypeError("computeResolutionContextKey: inputFingerprint is required (§40.1 raw-sensitive identity)");
  }
  return stableHash({
    schema: "resolution-context",
    version: cacheKeySchemaVersion,
    target,
    entityKey: entityKey2,
    strictNormalizedInput,
    // §40.1: Raw入力そのものの identity。normalizedInput と併存させる
    // （normalizedInput は診断/index用、inputFingerprint は identity用）。
    inputFingerprint: inputFingerprint2,
    inputFingerprintVersion,
    countryCode,
    worldRegionCode,
    requestedValueTypes,
    sourceNameFingerprint
  });
}
__name(computeResolutionContextKey, "computeResolutionContextKey");
var computeInputFingerprint = inputFingerprint;
var computeResolutionPolicyFingerprint = resolutionPolicyFingerprint;
async function computeResolutionKey({
  resolutionContextKey,
  resolutionPolicyFingerprint: resolutionPolicyFingerprint2,
  cacheKeySchemaVersion,
  builtinContentFingerprint: builtinContentFingerprint2
}) {
  if (typeof builtinContentFingerprint2 !== "string" || !builtinContentFingerprint2) {
    throw new TypeError("computeResolutionKey: builtinContentFingerprint is required (§85.2)");
  }
  return resolutionKey({
    resolutionContextKey,
    resolutionPolicyFingerprint: resolutionPolicyFingerprint2,
    cacheKeySchemaVersion,
    builtinContentFingerprint: builtinContentFingerprint2
  });
}
__name(computeResolutionKey, "computeResolutionKey");
async function materializeDependencyClosure(db, directDependencyClaimIds, policy = CACHE_DEPENDENCY_CLOSURE_POLICY) {
  const direct = [...new Set(directDependencyClaimIds ?? [])];
  const all = new Set(direct);
  let overflow = false;
  for (const id of direct) {
    const { claimIds, overflow: o } = await collectDependencies(db, {
      fromNodeId: id,
      relation: RELATION.dependsOn,
      maxDepth: policy.maxDepth,
      maxNodes: policy.maxNodes
    });
    if (o) overflow = true;
    for (const c of claimIds) all.add(c);
    if (all.size > policy.maxNodes) {
      overflow = true;
      break;
    }
  }
  return { dependencyClaimIds: [...all], dependencyClosureOverflow: overflow };
}
__name(materializeDependencyClosure, "materializeDependencyClosure");
async function getLookupKeysForClaim(claim) {
  const keys = /* @__PURE__ */ new Set();
  if (!claim) return [];
  if (claim.subjectKind === "entity") {
    keys.add(claim.subjectKey);
  } else if (claim.subjectKind === "lexical" || claim.subjectKind === "phrase") {
    keys.add(claim.subjectKey);
    if (claim.normalizedSource) keys.add(await exactLookupKey(claim.normalizedSource));
    if (claim.foldedSource) keys.add(await foldedLookupKey(claim.foldedSource));
  }
  if (claim.valueType === "source_alias") {
    if (claim.normalizedValue) keys.add(await aliasLookupKeyExact(claim.normalizedValue));
    if (claim.foldedValue) keys.add(await aliasLookupKeyFolded(claim.foldedValue));
  }
  return [...keys];
}
__name(getLookupKeysForClaim, "getLookupKeysForClaim");
async function invalidateForClaimIn(tx, claim, lookupKeys, { fanoutThreshold = HIGH_FANOUT_THRESHOLD } = {}) {
  const targets = [
    { indexName: "dependencyClaimIds", key: claim.claimId },
    ...lookupKeys.map((key) => ({ indexName: "lookupKeys", key }))
  ];
  let estimated = 0;
  for (const t of targets) {
    estimated += await countCacheMatchesUpTo(tx, t.indexName, t.key, fanoutThreshold);
    if (estimated > fanoutThreshold) {
      await clearResolutionCacheIn(tx);
      return { mode: "broad_clear", estimatedCount: estimated };
    }
  }
  let n = 0;
  for (const t of targets) n += await invalidateCacheEntriesByIndexIn(tx, t.indexName, t.key);
  return { mode: "selective", count: n };
}
__name(invalidateForClaimIn, "invalidateForClaimIn");
async function countCacheMatchesUpTo(tx, indexName, key, limit) {
  const index = tx.objectStore(STORE.cache).index(indexName);
  let count = 0;
  await new Promise((resolve, reject) => {
    const request = index.openKeyCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const c = request.result;
      if (!c) {
        resolve();
        return;
      }
      count++;
      if (count > limit) {
        resolve();
        return;
      }
      c.continue();
    };
    request.onerror = () => reject(request.error);
  });
  return count;
}
__name(countCacheMatchesUpTo, "countCacheMatchesUpTo");
async function invalidateForRejectionIn(tx, lookupKeys, claimIds) {
  let n = 0;
  for (const key of lookupKeys) n += await invalidateCacheEntriesByIndexIn(tx, "lookupKeys", key);
  for (const id of claimIds) n += await invalidateCacheEntriesByIndexIn(tx, "dependencyClaimIds", id);
  return n;
}
__name(invalidateForRejectionIn, "invalidateForRejectionIn");
function sourceMapReproducesSource(result, rawSourceText) {
  if (typeof rawSourceText !== "string") {
    return { ok: false, detail: "raw_source_text_missing" };
  }
  for (const [valueType, entry] of Object.entries(result?.values ?? {})) {
    for (const seg of entry?.sourceMap ?? []) {
      if (seg?.mapKind !== "source_segment") continue;
      if (seg.sourceStart === null || seg.sourceEnd === null) continue;
      if (rawSourceText.slice(seg.sourceStart, seg.sourceEnd) !== seg.sourceText) {
        return {
          ok: false,
          detail: `${valueType}:${seg.segmentId ?? `${seg.sourceStart}-${seg.sourceEnd}`}`
        };
      }
    }
  }
  return { ok: true, detail: null };
}
__name(sourceMapReproducesSource, "sourceMapReproducesSource");
function validateCachedResolutionIdentity(entry, expected = {}) {
  if (!entry) return { valid: false, reason: "not_found" };
  if (entry.inputFingerprint === void 0 || entry.inputFingerprint === null) {
    return { valid: false, reason: "input_fingerprint_missing" };
  }
  if (entry.inputFingerprintVersion !== expected.inputFingerprintVersion) {
    return { valid: false, reason: "input_fingerprint_version_mismatch" };
  }
  if (entry.inputFingerprint !== expected.inputFingerprint) {
    return { valid: false, reason: "input_fingerprint_mismatch" };
  }
  if (typeof expected.builtinContentFingerprint !== "string" || !expected.builtinContentFingerprint) {
    return { valid: false, reason: "builtin_content_fingerprint_unspecified" };
  }
  if (entry.builtinContentFingerprint === void 0 || entry.builtinContentFingerprint === null) {
    return { valid: false, reason: "builtin_content_fingerprint_missing" };
  }
  if (entry.builtinContentFingerprint !== expected.builtinContentFingerprint) {
    return { valid: false, reason: "builtin_content_fingerprint_mismatch" };
  }
  if (entry.sourceNameFingerprintVersion === void 0 || entry.sourceNameFingerprintVersion === null) {
    return { valid: false, reason: "source_name_fingerprint_version_missing" };
  }
  if (entry.sourceNameFingerprintVersion !== expected.sourceNameFingerprintVersion) {
    return { valid: false, reason: "source_name_fingerprint_version_mismatch" };
  }
  if ((entry.sourceNameFingerprint ?? null) !== (expected.sourceNameFingerprint ?? null)) {
    return { valid: false, reason: "source_name_fingerprint_mismatch" };
  }
  const reproduced = sourceMapReproducesSource(entry.result, expected.rawSourceText);
  if (!reproduced.ok) {
    return { valid: false, reason: "source_map_not_reproducible", detail: reproduced.detail };
  }
  return { valid: true, reason: null };
}
__name(validateCachedResolutionIdentity, "validateCachedResolutionIdentity");
async function readValidatedResolutionCache(db, resolutionKey2, expected, { now = Date.now() } = {}) {
  if (!expected || typeof expected.inputFingerprint !== "string" || !expected.inputFingerprint) {
    throw new TypeError("readValidatedResolutionCache: expected.inputFingerprint is required (§40.1)");
  }
  if (typeof expected.builtinContentFingerprint !== "string" || !expected.builtinContentFingerprint) {
    throw new TypeError("readValidatedResolutionCache: expected.builtinContentFingerprint is required");
  }
  const entry = await getResolutionCacheEntry(db, resolutionKey2);
  const identity = validateCachedResolutionIdentity(entry, expected);
  if (!identity.valid) return { entry: null, hit: false, identity };
  await touchResolutionCacheLastUsed(db, resolutionKey2, now);
  return { entry, hit: true, identity };
}
__name(readValidatedResolutionCache, "readValidatedResolutionCache");
var PERSISTABLE_RESOLUTION_STATES = Object.freeze(["resolved", "conflicted"]);
function isPersistableResolutionState(resolutionState) {
  return PERSISTABLE_RESOLUTION_STATES.includes(resolutionState);
}
__name(isPersistableResolutionState, "isPersistableResolutionState");
async function maybePersistResolution(db, {
  resolutionKey: resolutionKey2,
  resolutionContextKey,
  resolutionPolicyFingerprint: resolutionPolicyFingerprint2,
  target,
  entityKey: entityKey2 = null,
  normalizedInput,
  result,
  directDependencyClaimIds,
  lookupKeys,
  policyVersions,
  now = Date.now(),
  inputFingerprint: inputFingerprint2 = null,
  inputFingerprintVersion = INPUT_FINGERPRINT_VERSION,
  sourceNameFingerprint = null,
  sourceNameFingerprintVersion = null,
  rawSourceText = null,
  builtinContentFingerprint: builtinContentFingerprint2 = null
} = {}) {
  if (typeof inputFingerprint2 !== "string" || !inputFingerprint2) {
    throw new TypeError("maybePersistResolution: inputFingerprint is required (§40.1)");
  }
  if (typeof sourceNameFingerprintVersion !== "number") {
    throw new TypeError("maybePersistResolution: sourceNameFingerprintVersion is required (§85)");
  }
  if (typeof builtinContentFingerprint2 !== "string" || !builtinContentFingerprint2) {
    throw new TypeError("maybePersistResolution: builtinContentFingerprint is required");
  }
  const meta = await getMeta(db);
  const maintenance = dictionaryMaintenanceState(meta, { now });
  if (!maintenance.currentKnowledgeStable) {
    return { persisted: false, reason: "maintenance_transition_unstable" };
  }
  if (!isPersistableResolutionState(result.resolutionState)) {
    return { persisted: false, reason: `non_persistable_state:${result.resolutionState}` };
  }
  if (result.hasUnresolvedCoverage === true) {
    return { persisted: false, reason: "unresolved_coverage_present" };
  }
  const closure = await materializeDependencyClosure(db, directDependencyClaimIds);
  if (closure.dependencyClosureOverflow) {
    return { persisted: false, reason: "dependency_closure_overflow", closure };
  }
  if (rawSourceText !== null) {
    const reproduced = sourceMapReproducesSource(result, rawSourceText);
    if (!reproduced.ok) {
      return { persisted: false, reason: "source_map_not_reproducible", detail: reproduced.detail };
    }
  }
  const record = {
    resolutionKey: resolutionKey2,
    target,
    entityKey: entityKey2,
    normalizedInput,
    resolutionContextKey,
    resolutionPolicyFingerprint: resolutionPolicyFingerprint2,
    // §85 / §40.1 Resolution Identity。Cache Hit 時にここを検証する。
    inputFingerprint: inputFingerprint2,
    inputFingerprintVersion,
    sourceNameFingerprint,
    sourceNameFingerprintVersion,
    builtinContentFingerprint: builtinContentFingerprint2,
    result,
    directDependencyClaimIds: [...new Set(directDependencyClaimIds ?? [])],
    dependencyClaimIds: closure.dependencyClaimIds,
    dependencyClosureOverflow: false,
    lookupKeys: [...new Set(lookupKeys ?? [])],
    ...policyVersions,
    createdAt: now,
    lastUsedAt: now
  };
  await putResolutionCacheEntry(db, record);
  return { persisted: true, record };
}
__name(maybePersistResolution, "maybePersistResolution");

// dictionary-history.js
var HISTORY_ACTION = Object.freeze({
  claimCreated: "claim_created",
  claimReplaced: "claim_replaced",
  claimSuperseded: "claim_superseded",
  claimExplicitStateChanged: "claim_explicit_state_changed",
  claimLocked: "claim_locked",
  claimUnlocked: "claim_unlocked",
  evidenceInvalidated: "evidence_invalidated",
  relationAdded: "relation_added",
  relationInvalidated: "relation_invalidated",
  rejectionCreated: "rejection_created",
  rejectionSuperseded: "rejection_superseded",
  entitySourceNameChanged: "entity_source_name_changed",
  historyCorrection: "history_correction"
});
var ACTIONS = new Set(Object.values(HISTORY_ACTION));
function buildHistoryRecord({
  nodeId,
  action,
  changes = [],
  actor,
  mutationId,
  detail = null,
  now = Date.now()
}) {
  if (typeof nodeId !== "string" || !nodeId) {
    throw new TypeError("buildHistoryRecord: nodeId must be a non-empty string");
  }
  if (!ACTIONS.has(action)) {
    throw new TypeError(`buildHistoryRecord: unknown action "${action}"`);
  }
  if (typeof actor !== "string" || !actor) {
    throw new TypeError("buildHistoryRecord: actor must be a non-empty string");
  }
  if (!Array.isArray(changes)) {
    throw new TypeError("buildHistoryRecord: changes must be an array");
  }
  for (const c of changes) {
    if (typeof c?.field !== "string") {
      throw new TypeError("buildHistoryRecord: each change needs a field name");
    }
  }
  return {
    historyId: newOpaqueId("hist"),
    nodeId,
    action,
    changes,
    actor,
    mutationId: mutationId ?? newOpaqueId("mut"),
    detail,
    timestamp: now
  };
}
__name(buildHistoryRecord, "buildHistoryRecord");
function addHistory(tx, record) {
  tx.objectStore(STORE.history).add(record);
  return record;
}
__name(addHistory, "addHistory");
function iterateHistoryForNode(db, nodeId, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.history,
    indexName: "nodeId",
    query: cursor ? void 0 : IDBKeyRange.only(nodeId),
    limit,
    cursor
  });
}
__name(iterateHistoryForNode, "iterateHistoryForNode");

// dictionary-evidence.js
var CONTEXT_HASH_SCHEMA_VERSION = 1;
var EVIDENCE_TYPE = Object.freeze({
  aiObservation: "ai_observation",
  explicitUserConfirmation: "explicit_user_confirmation",
  implicitUserAcceptance: "implicit_user_acceptance",
  userCorrection: "user_correction",
  manualEntry: "manual_entry",
  legacyImport: "legacy_import",
  lncImport: "lnc_import",
  portableImportSnapshot: "portable_import_snapshot",
  officialSource: "official_source",
  /**
   * §102.3.2 Phase 9B:「Pack由来Evidenceは evidenceType: "package_attestation"
   *  として保存する」。**Local Manual Knowledge ではない**（§120-51）。
   *  Pack作者が「確認済み」と書いていても user_confirmation へ変換しない。
   */
  packageAttestation: "package_attestation",
  derivedComposition: "derived_composition",
  derivedNativeConversion: "derived_native_conversion"
});
var EVIDENCE_TYPES = new Set(Object.values(EVIDENCE_TYPE));
var STANCE = Object.freeze({
  support: "support",
  contradict: "contradict",
  neutral: "neutral"
});
var COMMIT_DISPOSITION = Object.freeze({
  accepted: "accepted",
  evidenceOnly: "evidence_only",
  quarantined: "quarantined"
});
var DERIVED_EVIDENCE_TYPES = Object.freeze(/* @__PURE__ */ new Set([
  EVIDENCE_TYPE.derivedComposition,
  EVIDENCE_TYPE.derivedNativeConversion
]));
var DEDUPE_IDENTITY_KIND = Object.freeze({
  aiLogicalItem: "ai_logical_item",
  userMutation: "user_mutation",
  originRecord: "origin_record",
  derivationRoot: "derivation_root",
  /**
   * §102.3.1 Phase 9B:「Package Evidence の Idempotency は originRecordKey だけでは
   *  なく **Version を含む logical event** で作る」。
   *    v1.0 再Import → 同じ Evidence
   *    v1.1 Update   → 新しい Version Attestation
   *    Rollback v1.0 → 保存済み v1.0 Attestation を再利用
   */
  packageRecord: "package_record"
});
var DEDUPE_KIND_BY_TYPE = Object.freeze({
  [EVIDENCE_TYPE.aiObservation]: DEDUPE_IDENTITY_KIND.aiLogicalItem,
  [EVIDENCE_TYPE.explicitUserConfirmation]: DEDUPE_IDENTITY_KIND.userMutation,
  [EVIDENCE_TYPE.implicitUserAcceptance]: DEDUPE_IDENTITY_KIND.userMutation,
  [EVIDENCE_TYPE.userCorrection]: DEDUPE_IDENTITY_KIND.userMutation,
  [EVIDENCE_TYPE.manualEntry]: DEDUPE_IDENTITY_KIND.userMutation,
  [EVIDENCE_TYPE.legacyImport]: DEDUPE_IDENTITY_KIND.originRecord,
  [EVIDENCE_TYPE.lncImport]: DEDUPE_IDENTITY_KIND.originRecord,
  [EVIDENCE_TYPE.portableImportSnapshot]: DEDUPE_IDENTITY_KIND.originRecord,
  [EVIDENCE_TYPE.officialSource]: DEDUPE_IDENTITY_KIND.originRecord,
  [EVIDENCE_TYPE.packageAttestation]: DEDUPE_IDENTITY_KIND.packageRecord,
  [EVIDENCE_TYPE.derivedComposition]: DEDUPE_IDENTITY_KIND.derivationRoot,
  [EVIDENCE_TYPE.derivedNativeConversion]: DEDUPE_IDENTITY_KIND.derivationRoot
});
var EvidenceError = class extends Error {
  static {
    __name(this, "EvidenceError");
  }
  constructor(message, details) {
    super(message);
    this.name = "EvidenceError";
    this.details = details;
  }
};
function isMutationId(value) {
  return typeof value === "string" && /^mut:[^\s:][^\s]*$/.test(value);
}
__name(isMutationId, "isMutationId");
function assertMutationId(label, value) {
  if (!isMutationId(value)) {
    throw new EvidenceError(
      `§93: ${label} must be a "mut:<id>" root mutation id (got ${JSON.stringify(value)})`,
      { label, value }
    );
  }
  return value;
}
__name(assertMutationId, "assertMutationId");
function buildContextSnapshot({ rawFacts = {}, canonicalFacts = {}, inference = {} } = {}) {
  return {
    rawFacts: {
      originalName: rawFacts.originalName ?? null,
      countryRaw: rawFacts.countryRaw ?? null,
      worldRegionRaw: rawFacts.worldRegionRaw ?? null
    },
    canonicalFacts: {
      countryCode: canonicalFacts.countryCode ?? null,
      countryCanonicalizationVersion: canonicalFacts.countryCanonicalizationVersion ?? null,
      worldRegionCode: canonicalFacts.worldRegionCode ?? null,
      worldRegionCanonicalizationVersion: canonicalFacts.worldRegionCanonicalizationVersion ?? null
    },
    inference: {
      languageCandidates: inference.languageCandidates ?? [],
      role: inference.role ?? null,
      languageInferenceVersion: inference.languageInferenceVersion ?? null
    }
  };
}
__name(buildContextSnapshot, "buildContextSnapshot");
function computeContextHash({
  target,
  entityKey: entityKey2 = null,
  subjectKey = null,
  normalizedFullPhrase,
  countryCode = null,
  worldRegionCode = null,
  segmentSpan = null,
  languageConditioning = null,
  roleConditioning = null,
  languageInferenceVersion = null,
  contextHashSchemaVersion = CONTEXT_HASH_SCHEMA_VERSION
}) {
  return contextHash({
    target: target ?? null,
    entityKey: entityKey2,
    subjectKey,
    normalizedFullPhrase,
    countryCode,
    worldRegionCode,
    segmentSpan,
    languageConditioning,
    roleConditioning,
    languageInferenceVersion
  }, { contextHashSchemaVersion });
}
__name(computeContextHash, "computeContextHash");
async function buildEvidenceDedupeKey(evidenceType, record) {
  const kind = DEDUPE_KIND_BY_TYPE[evidenceType];
  if (!kind) throw new EvidenceError(`unknown evidenceType: ${evidenceType}`, { evidenceType });
  const base = {
    identityKind: kind,
    claimSemanticKey: requireStr("claimSemanticKey", record.claimSemanticKey),
    evidenceType,
    stance: requireStr("stance", record.stance)
  };
  switch (kind) {
    case DEDUPE_IDENTITY_KIND.aiLogicalItem:
      return dedupeKey({
        ...base,
        logicalGenerationItemId: requireStr("logicalGenerationItemId", record.logicalGenerationItemId),
        observationContextId: requireStr("observationContextId", record.observationContextId),
        contextHash: requireStr("contextHash", record.contextHash),
        promptProfileId: requireStr("promptProfileId", record.promptProfileId),
        provider: requireStr("provider", record.provider),
        rawModelIdentity: requireStr("rawModelIdentity", record.rawModelIdentity),
        promptVersion: requireNum("promptVersion", record.promptVersion),
        generationStrategyVersion: requireNum("generationStrategyVersion", record.generationStrategyVersion)
      }, { keySchemaVersion: KEY_SCHEMA_VERSION });
    case DEDUPE_IDENTITY_KIND.userMutation:
      return dedupeKey({
        ...base,
        valueType: requireStr("valueType", record.valueType),
        mutationId: requireStr("mutationId", record.mutationId),
        observationContextId: record.observationContextId ?? null
      }, { keySchemaVersion: KEY_SCHEMA_VERSION });
    case DEDUPE_IDENTITY_KIND.originRecord:
      return dedupeKey({
        ...base,
        valueType: requireStr("valueType", record.valueType),
        originRecordKey: requireStr("originRecordKey", record.originRecordKey)
      }, { keySchemaVersion: KEY_SCHEMA_VERSION });
    case DEDUPE_IDENTITY_KIND.packageRecord:
      return dedupeKey({
        ...base,
        valueType: requireStr("valueType", record.valueType),
        packageId: requireStr("originPackageId", record.originPackageId),
        packageRecordId: requireStr("originPackageRecordId", record.originPackageRecordId),
        packageVersion: requireStr("originPackageVersion", record.originPackageVersion),
        attestationKind: requireStr("packageAttestationKind", record.packageAttestationKind)
      }, { keySchemaVersion: KEY_SCHEMA_VERSION });
    case DEDUPE_IDENTITY_KIND.derivationRoot:
      return dedupeKey({
        ...base,
        derivationSignature: requireStr("derivationSignature", record.derivationSignature)
      }, { keySchemaVersion: KEY_SCHEMA_VERSION });
    default:
      throw new EvidenceError(`unhandled dedupe identity kind: ${kind}`, { kind });
  }
}
__name(buildEvidenceDedupeKey, "buildEvidenceDedupeKey");
function requireStr(name, v) {
  if (typeof v !== "string" || !v) {
    throw new EvidenceError(`${name} must be a non-empty string for this evidence type`, { field: name, got: v });
  }
  return v;
}
__name(requireStr, "requireStr");
function requireNum(name, v) {
  if (!Number.isFinite(v)) {
    throw new EvidenceError(`${name} must be a finite number for this evidence type`, { field: name, got: v });
  }
  return v;
}
__name(requireNum, "requireNum");
function assertNotFailedAttempt(spec) {
  if (spec.attemptFailed === true || spec.responseValid === false) {
    throw new EvidenceError(
      "§120-27: a failed / invalid AI attempt must not become Evidence (not even contradict Evidence).",
      { evidenceType: spec.evidenceType }
    );
  }
  return true;
}
__name(assertNotFailedAttempt, "assertNotFailedAttempt");
async function buildEvidenceRecord(spec, registry = DEFAULT_MODEL_LINEAGE_REGISTRY) {
  const {
    evidenceType,
    claimId,
    claimSemanticKey,
    claimKeySchemaVersion = KEY_SCHEMA_VERSION,
    stance = STANCE.support,
    now = Date.now()
  } = spec;
  if (!EVIDENCE_TYPES.has(evidenceType)) {
    throw new EvidenceError(`unknown evidenceType: ${evidenceType}`, { evidenceType });
  }
  requireStr("claimId", claimId);
  requireStr("claimSemanticKey", claimSemanticKey);
  if (DERIVED_EVIDENCE_TYPES.has(evidenceType) && stance !== STANCE.neutral) {
    throw new EvidenceError(
      `§17: "${evidenceType}" must use stance=neutral; it is not an independent truth vote.`,
      { evidenceType, stance }
    );
  }
  if (!Object.values(STANCE).includes(stance)) {
    throw new EvidenceError(`unknown stance: ${stance}`, { stance });
  }
  const isAi = evidenceType === EVIDENCE_TYPE.aiObservation;
  if (isAi) {
    assertNotFailedAttempt(spec);
    for (const f of [
      "provider",
      "requestedModel",
      "promptProfileId",
      "logicalGenerationItemId",
      "evidenceRootId",
      "observationContextId"
    ]) {
      requireStr(f, spec[f]);
    }
    for (const f of ["promptVersion", "generationStrategyVersion"]) requireNum(f, spec[f]);
  }
  const raw = isAi ? rawModelIdentity({
    provider: spec.provider,
    requestedModel: spec.requestedModel,
    returnedModel: spec.returnedModel ?? null
  }) : null;
  const lineage = isAi ? classifyModelLineage({
    provider: spec.provider,
    requestedModel: spec.requestedModel,
    returnedModel: spec.returnedModel ?? null
  }, registry) : null;
  const independenceGroup = isAi ? lineage.independenceGroup : nonAiIndependenceGroup(evidenceType, spec);
  const contextSnapshot = spec.contextSnapshot ?? buildContextSnapshot(spec.context ?? {});
  const record = {
    evidenceId: newOpaqueId("ev"),
    claimId,
    // §16:「Import/Merge時の local ID remap に依存しない Current semantic identity」
    claimSemanticKey,
    claimKeySchemaVersion,
    keySchemaVersion: KEY_SCHEMA_VERSION,
    // §21: HTTP retry / Job resume を跨ぐ1 logical generation item
    logicalGenerationItemId: spec.logicalGenerationItemId ?? null,
    // §21:「1 Rootから複数Claimが派生しても同じRootを共有」
    evidenceRootId: spec.evidenceRootId ?? null,
    // §21.2:「application context は別。1 AI generation を3 independent confirmations と数えない」
    observationContextId: spec.observationContextId ?? null,
    // §21.1: Provider への HTTP/Batch call。Truth independence には使わない。
    aiRequestId: spec.aiRequestId ?? null,
    // §22.1 細かな Provenance grouping
    evidenceFamily: isAi ? buildEvidenceFamily(spec, lineage) : `${evidenceType}`,
    // §22.2 Trust Quality Gate で使う相関グループ
    independenceGroup,
    evidenceType,
    /**
     * §93 Mutation ID:「意味的に1つの操作へ mut:<ULID> を付ける。
     *  **History / Evidence / Job で共有**」。
     *
     * §93.1 Safe Mutation Undo は「該当 Mutation で追加された Evidence を
     * invalidate」する単位なので、Evidence record 自身が mutationId を持たないと
     * 誤った大量学習をまとめて取り消せない。dedupeKey の計算には既に使っている
     * （§19.1 userMutation identity）が、識別子として保存もする。
     * dedupeKey の入力は変えないので既存 Evidence の identity は不変。
     */
    mutationId: spec.mutationId ?? null,
    originInstallationId: spec.originInstallationId ?? null,
    originRecordKey: spec.originRecordKey ?? null,
    originPackageKey: spec.originPackageKey ?? null,
    originPackageVersion: spec.originPackageVersion ?? null,
    originPackageRecordId: spec.originPackageRecordId ?? null,
    /**
     * §102.3.1 Phase 9B: dedupe identity に使う raw packageId。`originPackageKey`
     * は `package:<packageId>` の materialized 表現で、Version 切替や registry
     * 再構成の影響を受けない raw ID を別に持つ。
     */
    originPackageId: spec.originPackageId ?? null,
    /** §102.3.2 attestation.kind（package_curated 等）。Truth Authority ではない。 */
    packageAttestationKind: spec.packageAttestationKind ?? null,
    /**
     * §102.3.2:「packagePublisherClass: community_unverified」。
     * 署名/Publisher Identity が未検証な限り別 author 文字列だけを独立した
     * Human Authority と解釈しない。
     */
    packagePublisherClass: spec.packagePublisherClass ?? null,
    /**
     * §102.2 / §102.6 Phase 9B: Portable Import で持ち込まれた **元の**
     * Provenance Lineage。A→B→C と再 Export/Import しても元 lineage を失わない
     * ための保持先であり、独立 Truth 票ではない（§139.4）。
     */
    importedProvenanceLineage: spec.importedProvenanceLineage ?? null,
    stance,
    // §16.1: Index 用 denormalized field。意味の正本は contextSnapshot。
    entityKey: spec.entityKey ?? null,
    target: spec.target ?? null,
    countryCode: contextSnapshot.canonicalFacts.countryCode,
    contextSnapshot,
    fullPhrase: spec.fullPhrase ?? null,
    contextHash: spec.contextHash ?? null,
    // §20:「provider / requestedModel / returnedModel / rawModelIdentity 等の
    //  観測事実を後から別物へ書き換えない」
    provider: spec.provider ?? null,
    requestedModel: spec.requestedModel ?? null,
    returnedModel: spec.returnedModel ?? null,
    rawModelIdentity: raw,
    // §20: Derived metadata。Registry 更新時に再計算してよい。
    modelFamily: lineage?.modelFamily ?? null,
    modelLineageId: lineage?.modelLineageId ?? null,
    lineageClassification: lineage?.lineageClassification ?? null,
    modelLineageRegistryVersion: lineage?.modelLineageRegistryVersion ?? registry.modelLineageRegistryVersion,
    promptProfileId: spec.promptProfileId ?? null,
    promptVersion: spec.promptVersion ?? null,
    generationStrategyVersion: spec.generationStrategyVersion ?? null,
    resolverVersion: spec.resolverVersion ?? null,
    parserVersion: spec.parserVersion ?? null,
    sourceNormalizerVersion: spec.sourceNormalizerVersion ?? null,
    countryProfileVersion: spec.countryProfileVersion ?? null,
    countryCanonicalizationVersion: contextSnapshot.canonicalFacts.countryCanonicalizationVersion,
    worldRegionCanonicalizationVersion: contextSnapshot.canonicalFacts.worldRegionCanonicalizationVersion,
    languageInferenceVersion: contextSnapshot.inference.languageInferenceVersion,
    // §23: 候補値そのものを見せられていたか
    anchored: Boolean(spec.anchored),
    seededByClaimIds: [...spec.seededByClaimIds ?? []],
    seededCandidateFingerprints: [...spec.seededCandidateFingerprints ?? []],
    // §23.1: language/role 等の Context Claim による条件付け（candidate exposure と分離）
    conditioningClaimIds: [...spec.conditioningClaimIds ?? []],
    novelClaim: spec.novelClaim ?? !spec.anchored,
    // §16: AI自己申告 confidence は診断用のみ
    modelSelfConfidence: spec.modelSelfConfidence ?? null,
    qualityDiagnostics: spec.qualityDiagnostics ?? null,
    staleAtCommit: Boolean(spec.staleAtCommit),
    staleReason: spec.staleReason ?? null,
    commitDisposition: spec.commitDisposition ?? COMMIT_DISPOSITION.accepted,
    dedupeKey: null,
    // 直後に埋める
    contextHashSchemaVersion: CONTEXT_HASH_SCHEMA_VERSION,
    originRecordKeyVersion: spec.originRecordKeyVersion ?? 1,
    // §19.1:「dedupeされたRetry/再送を診断するだけ。Truth weight へ直接使わない。」
    duplicateSeenCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    invalidatedAt: null,
    invalidationReason: null,
    createdAt: now
  };
  if (record.anchored) record.novelClaim = false;
  if (record.seededByClaimIds.length > 0 || record.seededCandidateFingerprints.length > 0) {
    record.anchored = true;
    record.novelClaim = false;
  }
  record.dedupeKey = await buildEvidenceDedupeKey(evidenceType, {
    ...record,
    mutationId: spec.mutationId ?? null,
    derivationSignature: spec.derivationSignature ?? null,
    valueType: spec.valueType ?? null
  });
  return record;
}
__name(buildEvidenceRecord, "buildEvidenceRecord");
function nonAiIndependenceGroup(evidenceType, spec) {
  switch (evidenceType) {
    case EVIDENCE_TYPE.explicitUserConfirmation:
    case EVIDENCE_TYPE.implicitUserAcceptance:
    case EVIDENCE_TYPE.userCorrection:
    case EVIDENCE_TYPE.manualEntry:
      return `user:${spec.originInstallationId ?? "local"}`;
    case EVIDENCE_TYPE.officialSource:
      return `official:${spec.officialSourceId ?? "unknown"}`;
    case EVIDENCE_TYPE.legacyImport:
    case EVIDENCE_TYPE.lncImport:
      return `import:${evidenceType}:${spec.originInstallationId ?? "local"}`;
    case EVIDENCE_TYPE.portableImportSnapshot:
      if (typeof spec.portableOriginGroup === "string" && spec.portableOriginGroup) {
        return spec.portableOriginGroup;
      }
      return `import:${evidenceType}:${spec.originInstallationId ?? "local"}`;
    case EVIDENCE_TYPE.packageAttestation:
      return `package:${spec.originPackageId ?? spec.originPackageKey ?? "unknown"}`;
    case EVIDENCE_TYPE.derivedComposition:
    case EVIDENCE_TYPE.derivedNativeConversion:
      return `derived:${evidenceType}`;
    default:
      return `other:${evidenceType}`;
  }
}
__name(nonAiIndependenceGroup, "nonAiIndependenceGroup");
function buildEvidenceFamily(spec, lineage) {
  return [
    spec.provider,
    lineage?.modelFamily ?? "unknown",
    spec.promptProfileId,
    `v${spec.promptVersion}`,
    `strategy${spec.generationStrategyVersion}`
  ].join(":");
}
__name(buildEvidenceFamily, "buildEvidenceFamily");
async function recordEvidence(db, spec, {
  registry = DEFAULT_MODEL_LINEAGE_REGISTRY,
  invalidateCache = true
} = {}) {
  const prepared = await prepareEvidenceWrite(db, spec, { registry, invalidateCache });
  const extraStores = invalidateCache ? [STORE.cache] : [];
  const { result } = await runSemanticMutation(
    db,
    [STORE.evidence, STORE.claims],
    async ({ tx }) => commitEvidenceIn(tx, prepared),
    { extraStores }
  );
  return result;
}
__name(recordEvidence, "recordEvidence");
async function prepareEvidenceWrite(db, spec, {
  registry = DEFAULT_MODEL_LINEAGE_REGISTRY,
  invalidateCache = true,
  claimRecordForCache = null
} = {}) {
  const record = await buildEvidenceRecord(spec, registry);
  const cacheLookupKeys = invalidateCache ? await (async () => {
    if (claimRecordForCache) return getLookupKeysForClaim(claimRecordForCache);
    const pre = await runRead(db, [STORE.claims], ({ store }) => requestOf(store(STORE.claims).get(record.claimId)));
    return pre ? getLookupKeysForClaim(pre) : [];
  })() : null;
  return { record, cacheLookupKeys, invalidateCache };
}
__name(prepareEvidenceWrite, "prepareEvidenceWrite");
async function commitEvidenceIn(tx, prepared) {
  const { record, cacheLookupKeys, invalidateCache } = prepared;
  const out = await upsertEvidenceByDedupeKey(tx, {
    dedupeKey: record.dedupeKey,
    build: /* @__PURE__ */ __name(() => record, "build")
  });
  if (out.created) {
    if (isDecisionAffecting(record)) {
      await markClaimScoreInputChanged(tx, record.claimId);
      if (invalidateCache) {
        const current = await requestOf(tx.objectStore(STORE.claims).get(record.claimId));
        await invalidateForClaimIn(tx, current, cacheLookupKeys);
      }
    }
    return { evidence: out.record, created: true, duplicate: false, raced: out.raced };
  }
  const winner = out.record;
  const next = {
    ...winner,
    duplicateSeenCount: (winner.duplicateSeenCount ?? 0) + 1,
    lastSeenAt: record.lastSeenAt
  };
  await requestOf(tx.objectStore(STORE.evidence).put(next));
  return { evidence: next, created: false, duplicate: true, raced: out.raced };
}
__name(commitEvidenceIn, "commitEvidenceIn");
function isDecisionAffecting(evidence) {
  if (evidence.invalidatedAt != null) return false;
  if (evidence.commitDisposition === COMMIT_DISPOSITION.quarantined) return false;
  return evidence.stance !== STANCE.neutral;
}
__name(isDecisionAffecting, "isDecisionAffecting");
var EVIDENCE_COLLECTION_POLICY = Object.freeze({
  pageSize: 200,
  /**
   * `collectEvidenceForClaim()` が Memory へ積む Array の上限。
   *
   * **これは Correctness cap ではない。** UI / Doctor / 診断のように
   * 「先頭 N 件だけ見られればよい」経路のための Array 上限であり、
   * Confidence 集計はこの API を使わない（B3A-01）。Score は
   * `streamEvidenceForClaim()` で **全 Evidence** を走査する。
   */
  maxRecordsPerClaim: 2e3
});
async function streamEvidenceForClaim(db, claimId, onRecord, {
  pageSize = EVIDENCE_COLLECTION_POLICY.pageSize
} = {}) {
  let cursor = null;
  let scanned = 0;
  let pages = 0;
  let maxPageBuffer = 0;
  for (; ; ) {
    const page = await iterateEvidenceForClaim(db, claimId, { limit: pageSize, cursor });
    pages++;
    if (page.items.length > maxPageBuffer) maxPageBuffer = page.items.length;
    for (const ev of page.items) {
      await onRecord(ev);
      scanned++;
    }
    if (page.done) break;
    cursor = page.nextCursor;
  }
  return { scanned, pages, maxPageBuffer, pageSize };
}
__name(streamEvidenceForClaim, "streamEvidenceForClaim");
async function collectEvidenceForClaim(db, claimId, {
  pageSize = EVIDENCE_COLLECTION_POLICY.pageSize,
  maxRecords = EVIDENCE_COLLECTION_POLICY.maxRecordsPerClaim
} = {}) {
  const items = [];
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    const page = await iterateEvidenceForClaim(db, claimId, { limit: pageSize, cursor });
    for (const ev of page.items) {
      if (items.length >= maxRecords) {
        truncated = true;
        break;
      }
      items.push(ev);
    }
    if (truncated || page.done) break;
    cursor = page.nextCursor;
  }
  return { items, truncated };
}
__name(collectEvidenceForClaim, "collectEvidenceForClaim");
function iterateEvidenceByRoot(db, evidenceRootId, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.evidence,
    indexName: "evidenceRootId",
    query: cursor ? void 0 : IDBKeyRange.only(evidenceRootId),
    limit,
    cursor
  });
}
__name(iterateEvidenceByRoot, "iterateEvidenceByRoot");
function requestOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf, "requestOf");

// dictionary-normalizer.js
var SOURCE_NORMALIZER_VERSION = 1;
var HYPHEN_LIKE = /[‐‑‒–—―−⁃﹘﹣－֊᐀᠆]/g;
var APOSTROPHE_LIKE = /[‘’ʼʹ՚＇′´`]/g;
var SPACE_LIKE = /[\s   -   　]+/g;
function strictNormalizedSource(input) {
  if (typeof input !== "string") throw new TypeError("strictNormalizedSource: input must be a string");
  let s = input.normalize("NFKC");
  s = s.replace(HYPHEN_LIKE, "-");
  s = s.replace(APOSTROPHE_LIKE, "'");
  s = s.toLowerCase();
  s = s.replace(SPACE_LIKE, " ");
  s = normalizePunctuationSpacing(s);
  s = s.trim();
  return s;
}
__name(strictNormalizedSource, "strictNormalizedSource");
function normalizePunctuationSpacing(s) {
  let out = s;
  out = out.replace(/\s*([([{])\s*/g, " $1");
  out = out.replace(/\s*([)\]}])\s*/g, "$1 ");
  out = out.replace(/\s*([,;:])\s*/g, "$1 ");
  out = out.replace(/\s*-\s*/g, "-");
  out = out.replace(/ {2,}/g, " ");
  return out;
}
__name(normalizePunctuationSpacing, "normalizePunctuationSpacing");
var COMBINING_MARK = /\p{Mn}/u;
var LATIN_LETTER = /\p{Script=Latin}/u;
function foldedNormalizedSource(input) {
  const strict = strictNormalizedSource(input);
  return foldLatinDiacritics(strict);
}
__name(foldedNormalizedSource, "foldedNormalizedSource");
function foldLatinDiacritics(s) {
  const decomposed = s.normalize("NFD");
  let out = "";
  let baseIsLatin = false;
  for (const ch of decomposed) {
    if (COMBINING_MARK.test(ch)) {
      if (!baseIsLatin) out += ch;
      continue;
    }
    baseIsLatin = LATIN_LETTER.test(ch);
    out += ch;
  }
  return out.normalize("NFC");
}
__name(foldLatinDiacritics, "foldLatinDiacritics");
var ValueNormalizationError = class extends Error {
  static {
    __name(this, "ValueNormalizationError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ValueNormalizationError";
    this.details = details;
  }
};
function nfcRaw(v) {
  return v.normalize("NFC");
}
__name(nfcRaw, "nfcRaw");
function nfcTrim(v) {
  return v.normalize("NFC").trim();
}
__name(nfcTrim, "nfcTrim");
function nfcTrimReadingSpace(v) {
  return v.normalize("NFC").replace(SPACE_LIKE, " ").trim().replace(/\s*・\s*/g, "・");
}
__name(nfcTrimReadingSpace, "nfcTrimReadingSpace");
function nfcTrimNoNfkc(v) {
  return v.normalize("NFC").trim();
}
__name(nfcTrimNoNfkc, "nfcTrimNoNfkc");
function bcp47Canonical(v) {
  const parts = v.trim().split("-");
  return parts.map((p, i) => {
    if (i === 0) return p.toLowerCase();
    if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase();
    if (p.length === 2) return p.toUpperCase();
    if (/^\d{3}$/.test(p)) return p;
    return p.toLowerCase();
  }).join("-");
}
__name(bcp47Canonical, "bcp47Canonical");
function normalizeClaimValue(valueType, value, script = null) {
  const policy = VALUE_TYPE_POLICIES[valueType];
  if (!policy) throw new ValueNormalizationError(`unknown valueType: ${valueType}`, { valueType });
  let semanticValue = value;
  let normalizedValue;
  let foldedValue = null;
  switch (policy.normalization) {
    case "nfc_trim":
      requireString2(valueType, value);
      semanticValue = nfcRaw(value);
      normalizedValue = nfcTrim(value);
      break;
    case "nfc_trim_reading_space":
      requireString2(valueType, value);
      semanticValue = nfcTrimReadingSpace(value);
      normalizedValue = semanticValue;
      break;
    case "nfc_trim_no_nfkc":
      requireString2(valueType, value);
      semanticValue = nfcTrimNoNfkc(value);
      normalizedValue = semanticValue;
      break;
    case "source_strict":
      requireString2(valueType, value);
      semanticValue = value.normalize("NFC").trim();
      normalizedValue = strictNormalizedSource(value);
      foldedValue = foldedNormalizedSource(value);
      break;
    case "bcp47_canonical":
      requireString2(valueType, value);
      semanticValue = bcp47Canonical(value);
      normalizedValue = semanticValue;
      break;
    case "enum_canonical":
      requireString2(valueType, value);
      semanticValue = value.trim();
      if (!policy.enumValues.includes(semanticValue)) {
        throw new ValueNormalizationError(
          `${valueType}: "${semanticValue}" is not in the enum`,
          { valueType, enumValues: policy.enumValues }
        );
      }
      normalizedValue = semanticValue;
      break;
    case "boolean_string":
      if (typeof value !== "boolean") {
        throw new ValueNormalizationError(`${valueType}.value must be a boolean`, { valueType, got: typeof value });
      }
      semanticValue = value;
      normalizedValue = value ? "true" : "false";
      break;
    default:
      throw new ValueNormalizationError(
        `no normalization policy for ${valueType}`,
        { valueType, policy: policy.normalization }
      );
  }
  if (policy.valueKind !== VALUE_KIND.boolean && normalizedValue.length === 0) {
    throw new ValueNormalizationError(`${valueType}: value normalizes to an empty string`, { valueType });
  }
  if (policy.requiresScript && typeof script !== "string") {
    throw new ValueNormalizationError(`${valueType} requires a script`, { valueType, script });
  }
  if (!policy.foldedValue) foldedValue = null;
  return {
    value: semanticValue,
    normalizedValue,
    foldedValue,
    valueNormalizerVersion: VALUE_NORMALIZER_VERSION
  };
}
__name(normalizeClaimValue, "normalizeClaimValue");
function requireString2(valueType, v) {
  if (typeof v !== "string") {
    throw new ValueNormalizationError(`${valueType}.value must be a string`, { valueType, got: typeof v });
  }
}
__name(requireString2, "requireString");

// dictionary-parser.js
var SEGMENT_TYPE = Object.freeze({
  token: "token",
  space: "space",
  punctuation: "punctuation"
});
var TARGET_PROFILES = Object.freeze({
  club: {
    applyPrefixRule: true,
    preserveLegacyPrefixDisplay: true,
    roles: ["club_prefix", "club_term", "team_level", "proper_name", "place", "qualifier"],
    usesCountryContext: true,
    hasShortDisplay: true,
    nativeRecovery: "enabled"
  },
  comp: {
    applyPrefixRule: true,
    preserveLegacyPrefixDisplay: true,
    roles: ["competition_term", "sponsor", "brand", "proper_name", "place", "qualifier", "ordinal", "age_group"],
    usesCountryContext: true,
    hasShortDisplay: true,
    nativeRecovery: "on_demand"
  },
  player: {
    // §61:「club prefix ruleを適用しない」
    // → club_prefix Role も team_level/年号などの club 意味論も付けない。
    applyPrefixRule: false,
    // CR-12: ただし Legacy visible の先頭頭字語表記は保持する（下記参照）。
    preserveLegacyPrefixDisplay: true,
    roles: ["given_name", "surname", "nickname", "person", "proper_name", "qualifier"],
    usesCountryContext: true,
    hasShortDisplay: false,
    nativeRecovery: "disabled"
  },
  stadium: {
    // §61:「club prefix ruleを適用しない」
    applyPrefixRule: false,
    // CR-12: 同上。
    preserveLegacyPrefixDisplay: true,
    roles: ["stadium_term", "person", "place", "proper_name", "qualifier"],
    usesCountryContext: true,
    hasShortDisplay: false,
    nativeRecovery: "on_demand"
  }
});
var GENERIC_TARGET_PROFILE = Object.freeze({
  applyPrefixRule: false,
  // CR-12: Legacy `parseLine()` は target を一切見ない。未知 target でも Legacy
  // visible の先頭頭字語表記は同じように出るので、compat 側だけは有効にする
  // （§145.6「target固有Ruleだけ skip する」— これは target 固有 Rule ではない）。
  preserveLegacyPrefixDisplay: true,
  roles: ["proper_name", "place", "qualifier", "unknown"],
  usesCountryContext: true,
  hasShortDisplay: false,
  nativeRecovery: "disabled",
  generic: true
});
function getTargetProfile(target) {
  return TARGET_PROFILES[target] ?? GENERIC_TARGET_PROFILE;
}
__name(getTargetProfile, "getTargetProfile");
function isKnownTarget(target) {
  return Object.prototype.hasOwnProperty.call(TARGET_PROFILES, target);
}
__name(isKnownTarget, "isKnownTarget");
var LEGACY_PREFIXES = Object.freeze(/* @__PURE__ */ new Set([
  "FC",
  "KE",
  "VW",
  "RES",
  "SK",
  "VV",
  "ASV",
  "CS",
  "KVK",
  "SV",
  "AC",
  "AS",
  "1.",
  "SC",
  "FK",
  "NK",
  "BK",
  "HB",
  "IF",
  "GIF",
  "IFK",
  "ÍF",
  "FF",
  "BIF",
  "AIF",
  "MIF",
  "VfB",
  "VfL",
  "TSG",
  "SpVgg",
  "FSV",
  "BSC",
  "SGE",
  "SSV",
  "DSC",
  "MSV",
  "FKF",
  "TuS",
  "TuRa",
  "SuS",
  "RasenBallsport",
  "RB",
  "RC",
  "RS",
  "RSC",
  "US",
  "USM",
  "UGS",
  "UA",
  "CF",
  "UD",
  "SD",
  "CD",
  "RM",
  "RF",
  "GD",
  "SL",
  "OM",
  "OL",
  "SM",
  "PSG",
  "SS",
  "AD",
  "AM",
  "CA",
  "CR",
  "CE",
  "CP",
  "PFC",
  "PAOK",
  "OFI",
  "AEK",
  "AOK",
  "PAO",
  "OAK",
  "AO",
  "GS",
  "CSD",
  "LFC",
  "AFC",
  "PORTSMOUTH",
  "WFC",
  "BWFC",
  "NFFC",
  "THFC",
  "MUFC",
  "MCFC",
  "LCFC",
  "CFC",
  "AVFC",
  "EFC",
  "WBA",
  "QPR",
  "MK",
  "HFC",
  "HTAFC",
  "BCFC",
  "SWFC",
  "WWFC",
  "BRFC",
  "BHAFC",
  "LUFC",
  "NCFC",
  "ITFC",
  "SCFC",
  "CCFC",
  "DRFC",
  "TRFC",
  "DCFC",
  "POSH"
]));
var LEGACY_ASCII_UPPER = /[A-Z]/;
var LEGACY_ASCII_LOWER = /[a-z]/;
function isLegacyPrefixWord(word) {
  if (typeof word !== "string" || word.length === 0) return false;
  if (LEGACY_PREFIXES.has(word.toUpperCase())) return true;
  return word.length >= 2 && LEGACY_ASCII_UPPER.test(word) && !LEGACY_ASCII_LOWER.test(word);
}
__name(isLegacyPrefixWord, "isLegacyPrefixWord");
var isLegacyPrefixToken = isLegacyPrefixWord;
var PURE_NUMBER = /^\d+$/;
function legacyLookupKey(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}
__name(legacyLookupKey, "legacyLookupKey");
function isLegacyReachableSourceKey(key) {
  return typeof key === "string" && key.length > 0 && key === legacyLookupKey(key);
}
__name(isLegacyReachableSourceKey, "isLegacyReachableSourceKey");
var OPEN_BRACKET = /* @__PURE__ */ new Set(["(", "[", "{", "（", "［", "｛", "〔", "【"]);
var CLOSE_BRACKET = /* @__PURE__ */ new Set([")", "]", "}", "）", "］", "｝", "〕", "】"]);
function isSpace(ch) {
  return /\s/u.test(ch) || ch === "　" || ch === " ";
}
__name(isSpace, "isSpace");
function isPunctuation(ch) {
  return /[\p{P}\p{S}]/u.test(ch);
}
__name(isPunctuation, "isPunctuation");
function parseSourceName(sourceText, { target = null } = {}) {
  if (typeof sourceText !== "string") throw new TypeError("parseSourceName: sourceText must be a string");
  const profile = getTargetProfile(target);
  const segments = [];
  let offset = 0;
  let buffer = "";
  let bufferStart = 0;
  let bracketDepth = 0;
  let tokenSeq = 0;
  const flushToken = /* @__PURE__ */ __name(() => {
    if (!buffer) return;
    segments.push({
      segmentId: `seg:${++tokenSeq}`,
      type: SEGMENT_TYPE.token,
      text: buffer,
      start: bufferStart,
      end: bufferStart + buffer.length,
      // §56:「(Litín) を勝手に city と確定しない」— 構造由来の初期Roleだけを置く
      initialRole: bracketDepth > 0 ? "qualifier" : null,
      bracketDepth
    });
    buffer = "";
  }, "flushToken");
  for (const ch of sourceText) {
    const width = ch.length;
    if (isSpace(ch)) {
      flushToken();
      segments.push({ type: SEGMENT_TYPE.space, text: ch, start: offset, end: offset + width });
    } else if (isPunctuation(ch)) {
      flushToken();
      if (OPEN_BRACKET.has(ch)) bracketDepth++;
      segments.push({
        type: SEGMENT_TYPE.punctuation,
        text: ch,
        start: offset,
        end: offset + width,
        bracket: OPEN_BRACKET.has(ch) ? "open" : CLOSE_BRACKET.has(ch) ? "close" : null
      });
      if (CLOSE_BRACKET.has(ch) && bracketDepth > 0) bracketDepth--;
    } else {
      if (!buffer) bufferStart = offset;
      buffer += ch;
    }
    offset += width;
  }
  flushToken();
  applyPrefixRoles(segments, profile);
  return { sourceText, parserVersion: PARSER_VERSION, targetProfileVersion: TARGET_PROFILE_VERSION, segments };
}
__name(parseSourceName, "parseSourceName");
function groupWords(segments) {
  const words = [];
  let current = null;
  for (const seg of segments) {
    if (seg.type === SEGMENT_TYPE.space) {
      current = null;
      continue;
    }
    if (!current) {
      current = { segments: [], text: "", start: seg.start, end: seg.end };
      words.push(current);
    }
    current.segments.push(seg);
    current.text += seg.text;
    current.end = seg.end;
  }
  return words;
}
__name(groupWords, "groupWords");
function legacyWordUnits(parsed) {
  return groupWords(parsed.segments).map((w) => {
    const tokens = w.segments.filter((sg) => sg.type === SEGMENT_TYPE.token);
    return {
      start: w.start,
      end: w.end,
      text: w.text,
      segments: w.segments,
      tokens,
      hasToken: tokens.length > 0
    };
  });
}
__name(legacyWordUnits, "legacyWordUnits");
function applyPrefixRoles(segments, profile) {
  const applyClubRule = profile.applyPrefixRule === true;
  const preserveDisplay = profile.preserveLegacyPrefixDisplay === true;
  if (!applyClubRule && !preserveDisplay) return;
  const words = groupWords(segments);
  if (words.length <= 1) return;
  let sawAcronym = false;
  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i];
    const tokens = word.segments.filter((s) => s.type === SEGMENT_TYPE.token);
    if (tokens.length === 0) break;
    if (isLegacyPrefixWord(word.text)) {
      for (const t of tokens) {
        if (applyClubRule) t.initialRole = "club_prefix";
        if (preserveDisplay) {
          t.renderMode = "preserve";
          t.legacyPrefixDisplay = true;
        }
      }
      sawAcronym = true;
      continue;
    }
    if (PURE_NUMBER.test(word.text) && sawAcronym) {
      for (const t of tokens) {
        if (applyClubRule) t.initialRole = "year";
        if (preserveDisplay) t.renderMode = "preserve";
      }
      continue;
    }
    break;
  }
}
__name(applyPrefixRoles, "applyPrefixRoles");
function lexicalTokens(parsed) {
  return parsed.segments.filter((s) => s.type === SEGMENT_TYPE.token);
}
__name(lexicalTokens, "lexicalTokens");
function classifyLegacySourceKind(sourceText, parserVersion = PARSER_VERSION) {
  if (parserVersion !== PARSER_VERSION) {
    throw new Error(
      `classifyLegacySourceKind: parserVersion ${parserVersion} != current ${PARSER_VERSION}; re-classify with the current parser`
    );
  }
  const parsed = parseSourceName(sourceText, { target: null });
  const tokens = lexicalTokens(parsed);
  return {
    kind: tokens.length <= 1 ? "lexical" : "phrase",
    tokenCount: tokens.length,
    parserVersion: PARSER_VERSION,
    sourceText
    // §66.1.1「Raw sourceTextは必ず残す」
  };
}
__name(classifyLegacySourceKind, "classifyLegacySourceKind");

// dictionary-entities.js
var SOURCE_NAME_FINGERPRINT_VERSION = 1;
var SOURCE_NAME_GUARD_VERSION = 1;
var GUARD_MODE = Object.freeze({
  exactOrAlias: "exact_or_alias",
  similarStructure: "similar_structure",
  idOnly: "id_only",
  unboundEntityId: "unbound_entity_id"
});
var MINOR_CHANGE_POLICY = Object.freeze({
  none: "none",
  safeStructural: "safe_structural"
});
async function computeSourceNameFingerprint(sourceText, { target = null } = {}) {
  const strict = strictNormalizedSource(sourceText);
  const parsed = parseSourceName(sourceText, { target });
  const tokens = lexicalTokens(parsed);
  const prefixTokens = tokens.filter((t) => t.initialRole === "club_prefix").map((t) => t.text.toUpperCase());
  const nameTokens = tokens.filter((t) => t.initialRole !== "club_prefix").map((t) => strictNormalizedSource(t.text));
  const fingerprint = await stableHash({
    schema: "source-name-fingerprint",
    version: SOURCE_NAME_FINGERPRINT_VERSION,
    parserVersion: PARSER_VERSION,
    sourceNormalizerVersion: SOURCE_NORMALIZER_VERSION,
    strictNormalized: strict,
    tokenCount: tokens.length,
    prefixTokens,
    // 順序を保つ（構造の一部）
    nameTokens,
    structure: parsed.segments.map((s) => s.type).join("")
  });
  return {
    sourceNameFingerprint: fingerprint,
    sourceNameFingerprintVersion: SOURCE_NAME_FINGERPRINT_VERSION,
    // 診断用。Fingerprint だけで断定しないための補助情報。
    _parts: { strictNormalized: strict, prefixTokens, nameTokens, tokenCount: tokens.length }
  };
}
__name(computeSourceNameFingerprint, "computeSourceNameFingerprint");
async function sourceNameGuardSignature(guard) {
  if (!guard) return null;
  return stableHash({
    schema: "source-name-guard",
    version: guard.sourceNameGuardVersion ?? SOURCE_NAME_GUARD_VERSION,
    mode: guard.mode,
    // set-like: canonicalize → dedupe → sort（§10.4-4）
    acceptedNormalizedNames: [...guard.acceptedNormalizedNames ?? []],
    sourceFingerprint: guard.sourceFingerprint ?? null,
    minorChangePolicy: guard.minorChangePolicy ?? MINOR_CHANGE_POLICY.none
    // 動的 alias 集合は **含めない**
  });
}
__name(sourceNameGuardSignature, "sourceNameGuardSignature");
function buildSourceNameGuard({ origin, normalizedSourceName = null, sourceFingerprint = null }) {
  switch (origin) {
    case "ai":
      return {
        mode: GUARD_MODE.exactOrAlias,
        acceptedNormalizedNames: normalizedSourceName ? [normalizedSourceName] : [],
        sourceFingerprint,
        sourceFingerprintVersion: SOURCE_NAME_FINGERPRINT_VERSION,
        // §6:「AI生成Entity ClaimにはこのUser convenience toleranceを自動付与しない」
        minorChangePolicy: MINOR_CHANGE_POLICY.none,
        sourceNameGuardVersion: SOURCE_NAME_GUARD_VERSION
      };
    case "user_correction":
      return {
        mode: GUARD_MODE.exactOrAlias,
        acceptedNormalizedNames: normalizedSourceName ? [normalizedSourceName] : [],
        sourceFingerprint,
        sourceFingerprintVersion: SOURCE_NAME_FINGERPRINT_VERSION,
        minorChangePolicy: MINOR_CHANGE_POLICY.safeStructural,
        sourceNameGuardVersion: SOURCE_NAME_GUARD_VERSION
      };
    case "lnc_import_unbound":
      return {
        mode: GUARD_MODE.unboundEntityId,
        acceptedNormalizedNames: [],
        sourceFingerprint: null,
        sourceFingerprintVersion: null,
        minorChangePolicy: MINOR_CHANGE_POLICY.none,
        sourceNameGuardVersion: SOURCE_NAME_GUARD_VERSION
      };
    case "user_id_only":
      return {
        mode: GUARD_MODE.idOnly,
        acceptedNormalizedNames: [],
        sourceFingerprint: null,
        sourceFingerprintVersion: null,
        minorChangePolicy: MINOR_CHANGE_POLICY.none,
        sourceNameGuardVersion: SOURCE_NAME_GUARD_VERSION
      };
    default:
      throw new Error(`buildSourceNameGuard: unknown origin "${origin}"`);
  }
}
__name(buildSourceNameGuard, "buildSourceNameGuard");
var SAFE_STRUCTURAL_ROLE_WHITELIST = Object.freeze([
  "club_prefix",
  "team_level",
  "year",
  "ordinal",
  "connector",
  "sponsor"
]);
var TEAM_LEVEL = /^(u\d{1,2}|b|ii|iii|reserves?|academy|youth)$/i;
function classifyGuardToken(text) {
  if (isLegacyPrefixToken(text)) return "club_prefix";
  if (TEAM_LEVEL.test(text)) return "team_level";
  if (/^\d{4}$/.test(text)) return "year";
  return "proper_name";
}
__name(classifyGuardToken, "classifyGuardToken");
function evaluateSafeStructural({ acceptedNormalizedName, currentNormalizedName, target = null }) {
  const a = lexicalTokens(parseSourceName(acceptedNormalizedName, { target }));
  const b = lexicalTokens(parseSourceName(currentNormalizedName, { target }));
  const core = /* @__PURE__ */ __name((tokens) => tokens.map((t) => ({ text: strictNormalizedSource(t.text), role: classifyGuardToken(t.text) })).filter((t) => t.role === "proper_name").map((t) => t.text), "core");
  const coreA = core(a);
  const coreB = core(b);
  const coreMatches = coreA.length === coreB.length && coreA.every((t, i) => t === coreB[i]);
  const changed = [];
  const setA = new Set(a.map((t) => strictNormalizedSource(t.text)));
  const setB = new Set(b.map((t) => strictNormalizedSource(t.text)));
  for (const t of a) {
    const k = strictNormalizedSource(t.text);
    if (!setB.has(k)) changed.push({ side: "removed", text: t.text, role: classifyGuardToken(t.text) });
  }
  for (const t of b) {
    const k = strictNormalizedSource(t.text);
    if (!setA.has(k)) changed.push({ side: "added", text: t.text, role: classifyGuardToken(t.text) });
  }
  const allChangesWhitelisted = changed.every((c) => SAFE_STRUCTURAL_ROLE_WHITELIST.includes(c.role));
  return {
    safe: coreMatches && allChangesWhitelisted && coreA.length > 0,
    coreMatches,
    allChangesWhitelisted,
    changedTokens: changed,
    coreTokens: coreA
  };
}
__name(evaluateSafeStructural, "evaluateSafeStructural");
function evaluateSourceNameGuard({
  guard,
  currentNormalizedName,
  target = null,
  isManualOrLocked = false,
  aliasResolver = null
}) {
  const base = {
    mode: guard?.mode ?? null,
    eligible: false,
    reason: null,
    needsRevalidation: false,
    guardRefreshCandidate: false
  };
  if (!guard) return { ...base, reason: "no_guard" };
  switch (guard.mode) {
    case GUARD_MODE.idOnly:
      return { ...base, eligible: true, reason: "id_only_explicit_user_rule" };
    case GUARD_MODE.unboundEntityId:
      return {
        ...base,
        eligible: false,
        reason: "unbound_entity_id",
        needsRevalidation: true,
        bindCandidate: true
      };
    case GUARD_MODE.exactOrAlias: {
      const accepted = guard.acceptedNormalizedNames ?? [];
      if (accepted.includes(currentNormalizedName)) {
        return { ...base, eligible: true, reason: "exact_accepted_name" };
      }
      if (aliasResolver && aliasResolver(currentNormalizedName)) {
        return { ...base, eligible: true, reason: "accepted_via_source_alias" };
      }
      if (isManualOrLocked && guard.minorChangePolicy === MINOR_CHANGE_POLICY.safeStructural) {
        for (const name of accepted) {
          const s = evaluateSafeStructural({
            acceptedNormalizedName: name,
            currentNormalizedName,
            target
          });
          if (s.safe) {
            return {
              ...base,
              eligible: true,
              reason: "safe_structural",
              guardRefreshCandidate: true,
              structural: s
            };
          }
        }
      }
      return { ...base, eligible: false, reason: "source_name_changed", needsRevalidation: true };
    }
    case GUARD_MODE.similarStructure: {
      const accepted = guard.acceptedNormalizedNames ?? [];
      for (const name of accepted) {
        const s = evaluateSafeStructural({ acceptedNormalizedName: name, currentNormalizedName, target });
        if (s.safe) {
          return {
            ...base,
            eligible: false,
            reason: "similar_structure_candidate",
            candidate: true,
            structural: s
          };
        }
      }
      return { ...base, eligible: false, reason: "source_name_changed", needsRevalidation: true };
    }
    default:
      return { ...base, reason: `unknown_guard_mode:${guard.mode}` };
  }
}
__name(evaluateSourceNameGuard, "evaluateSourceNameGuard");
var ENTITY_STORE = STORE.entities;

// dictionary-claims.js
var SUBJECT_KIND = Object.freeze({
  entity: "entity",
  phrase: "phrase",
  lexical: "lexical",
  pattern: "pattern",
  nativeMapping: "native_mapping"
});
var SUBJECT_KINDS = new Set(Object.values(SUBJECT_KIND));
var TRUST_TIER = Object.freeze({
  provisional: "provisional",
  learned: "learned",
  trusted: "trusted"
});
var CONFLICT_STATE = Object.freeze({ clean: "clean", conflicted: "conflicted" });
var REVALIDATION_STATE = Object.freeze({ clean: "clean", needed: "needed" });
var LIFECYCLE_STATE = Object.freeze({
  active: "active",
  dormant: "dormant",
  archived: "archived"
});
var VERIFICATION_STATE = Object.freeze({
  none: "none",
  legacyUser: "legacy_user",
  explicitUserConfirmed: "explicit_user_confirmed",
  manualEntered: "manual_entered",
  manualCorrected: "manual_corrected",
  official: "official"
});
var VERIFICATION_PRECEDENCE = Object.freeze([
  VERIFICATION_STATE.official,
  VERIFICATION_STATE.manualCorrected,
  VERIFICATION_STATE.manualEntered,
  VERIFICATION_STATE.explicitUserConfirmed,
  VERIFICATION_STATE.legacyUser,
  VERIFICATION_STATE.none
]);
var DERIVATION_KIND = Object.freeze({
  composed: "composed",
  nativeConversion: "native_conversion",
  /** §76.2: Native Form から機械変換した Japanese Display。 */
  nativeToJapaneseDisplay: "native_to_japanese_display",
  /**
   * §80.1: 安全な Jpan 変換を作れないので Native 漢字をそのまま Japanese Display
   * として使った場合。「Jpanへ正規化済み」と偽らないため別 kind にする。
   */
  nativePassthroughDisplay: "native_passthrough_display"
});
var NATIVE_DERIVATION_KINDS = Object.freeze(/* @__PURE__ */ new Set([
  DERIVATION_KIND.nativeConversion,
  DERIVATION_KIND.nativeToJapaneseDisplay,
  DERIVATION_KIND.nativePassthroughDisplay
]));
var CONSTRAINT_DIMENSIONS = Object.freeze([
  "entityKeys",
  "targets",
  "countries",
  "worldRegions",
  "locales",
  "languages",
  "roles"
]);
function emptyApplicabilityConstraints() {
  const side = /* @__PURE__ */ __name(() => Object.fromEntries(CONSTRAINT_DIMENSIONS.map((d) => [d, []])), "side");
  return { include: side(), exclude: side() };
}
__name(emptyApplicabilityConstraints, "emptyApplicabilityConstraints");
function normalizeApplicabilityConstraints(input) {
  const out = emptyApplicabilityConstraints();
  for (const side of ["include", "exclude"]) {
    for (const dim of CONSTRAINT_DIMENSIONS) {
      const v = input?.[side]?.[dim];
      if (v === void 0 || v === null) continue;
      if (!Array.isArray(v)) {
        throw new TypeError(`applicabilityConstraints.${side}.${dim} must be an array`);
      }
      out[side][dim] = [...v];
    }
  }
  return out;
}
__name(normalizeApplicabilityConstraints, "normalizeApplicabilityConstraints");
function normalizeLegacySourceKeys(input) {
  if (!Array.isArray(input)) return null;
  return [...new Set(input.filter((k) => typeof k === "string" && k.length > 0))].sort();
}
__name(normalizeLegacySourceKeys, "normalizeLegacySourceKeys");
function hasApplicabilityConstraints(constraints) {
  if (!constraints) return false;
  for (const side of ["include", "exclude"]) {
    for (const dim of CONSTRAINT_DIMENSIONS) {
      if ((constraints[side]?.[dim] ?? []).length > 0) return true;
    }
  }
  return false;
}
__name(hasApplicabilityConstraints, "hasApplicabilityConstraints");
async function applicabilityConstraintSignature(constraints) {
  if (!hasApplicabilityConstraints(constraints)) return null;
  const c = normalizeApplicabilityConstraints(constraints);
  return stableHash({
    schema: "claim-applicability-constraints",
    version: KEY_SCHEMA_VERSION,
    include: c.include,
    exclude: c.exclude
  });
}
__name(applicabilityConstraintSignature, "applicabilityConstraintSignature");
function emptyApplicabilityProfile() {
  return {
    targets: {},
    countries: {},
    worldRegions: {},
    locales: {},
    languages: {},
    roles: {},
    distinctEntities: 0,
    distinctPhrases: 0
  };
}
__name(emptyApplicabilityProfile, "emptyApplicabilityProfile");
var ClaimModelError = class extends Error {
  static {
    __name(this, "ClaimModelError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ClaimModelError";
    this.details = details;
  }
};
function assertSingleAssertionValue(valueType, value) {
  const policy = VALUE_TYPE_POLICIES[valueType];
  if (!policy) throw new ClaimModelError(`unknown valueType: ${valueType}`, { valueType });
  if (value !== null && typeof value === "object") {
    throw new ClaimModelError(
      `§7: 1 Claim = 1 assertion. "${valueType}" received an object value; split it into one Claim per assertion (§9.5 t / l3 / l6).`,
      { valueType, keys: Array.isArray(value) ? "(array)" : Object.keys(value) }
    );
  }
  return true;
}
__name(assertSingleAssertionValue, "assertSingleAssertionValue");
function evaluateClaimEligibility(claim) {
  if (claim.deletedAt != null) return { eligible: false, reason: "deleted", penalty: 0 };
  if (claim.disabled === true) return { eligible: false, reason: "disabled", penalty: 0 };
  if (claim.lifecycleState === LIFECYCLE_STATE.archived) {
    return { eligible: false, reason: "archived", penalty: 0 };
  }
  if (claim.quarantined === true) return { eligible: false, reason: "quarantined", penalty: 0 };
  if (claim.supersededByClaimId) return { eligible: false, reason: "superseded", penalty: 0 };
  if (claim.lifecycleState === LIFECYCLE_STATE.dormant) {
    return { eligible: true, reason: "dormant", penalty: CLAIM_POLICY.dormantPenalty };
  }
  return { eligible: true, reason: "active", penalty: 0 };
}
__name(evaluateClaimEligibility, "evaluateClaimEligibility");
var CLAIM_POLICY = Object.freeze({
  dormantPenalty: 10
});
async function buildClaimRecord({
  subjectKind,
  subjectKey,
  valueType,
  value,
  script = null,
  sourceText,
  legacySourceKeys = null,
  creationHints = null,
  applicabilityConstraints = null,
  sourceNameGuard = null,
  provenance,
  derivation = null,
  verificationState = VERIFICATION_STATE.none,
  locked = false,
  lockMetadata = null,
  lifecycleState = LIFECYCLE_STATE.active,
  stagingSessionId = null,
  quarantined = false,
  quarantineMetadata = null,
  now = Date.now()
}) {
  if (!SUBJECT_KINDS.has(subjectKind)) {
    throw new ClaimModelError(`unknown subjectKind: ${subjectKind}`, { subjectKind });
  }
  if (typeof subjectKey !== "string" || !subjectKey) {
    throw new ClaimModelError("subjectKey must be a non-empty string", { subjectKey });
  }
  if (typeof sourceText !== "string" || !sourceText) {
    throw new ClaimModelError("sourceText must be a non-empty string (§8.1 debuggability)", { sourceText });
  }
  if (script !== null && !SCRIPT_ENUM.includes(script)) {
    throw new ClaimModelError(`unknown script: ${script}`, { script });
  }
  if (!provenance || typeof provenance.createdBy !== "string") {
    throw new ClaimModelError("provenance.createdBy is required (§7)", { provenance });
  }
  if (locked && !lockMetadata) {
    throw new ClaimModelError("locked=true requires lockMetadata (§11.5)", {});
  }
  assertSingleAssertionValue(valueType, value);
  const normalized = normalizeClaimValue(valueType, value, script);
  validateClaimValue({
    valueType,
    value: normalized.value,
    script,
    normalizedValue: normalized.normalizedValue,
    foldedValue: normalized.foldedValue
  });
  const constraints = applicabilityConstraints ? normalizeApplicabilityConstraints(applicabilityConstraints) : emptyApplicabilityConstraints();
  const explicitConstraintSignature = await applicabilityConstraintSignature(constraints);
  const guardSignature = await sourceNameGuardSignature(sourceNameGuard);
  const groupKey = await claimGroupKey({
    subjectKind,
    subjectKey,
    valueType,
    script,
    explicitConstraintSignature,
    sourceNameGuardSignature: guardSignature,
    keySchemaVersion: KEY_SCHEMA_VERSION
  });
  const semKey = await semanticKey({
    claimGroupKey: groupKey,
    normalizedValue: normalized.normalizedValue,
    keySchemaVersion: KEY_SCHEMA_VERSION
  });
  return {
    claimId: newOpaqueId("claim"),
    subjectKind,
    subjectKey,
    claimGroupKey: groupKey,
    semanticKey: semKey,
    keySchemaVersion: KEY_SCHEMA_VERSION,
    sourceText,
    normalizedSource: strictNormalizedSource(sourceText),
    foldedSource: foldedNormalizedSource(sourceText),
    sourceNormalizerVersion: SOURCE_NORMALIZER_VERSION,
    /**
     * CR-10 §105.1: **derived compatibility metadata**（semantic authority ではない）。
     *
     * migration された Legacy User Dictionary Claim が、production Legacy で
     * 実際に引けていた lookup key 群（`dictionary-legacy-migration.js`
     * `legacyLookupKey()`）。Legacy 由来でない Claim は `null`。
     *
     * これは identity へ一切入らない: `subjectKey` / `claimGroupKey` /
     * `semanticKey` / `normalizedSource` / `KEY_SCHEMA_VERSION` は
     * §57.1 の NFKC contract のまま変わらない（§3 Fixed Contract）。
     * Resolver が **legacy_user Claim の適用可否だけ** を判定するために読む。
     * Truth / confidenceScore / verificationState へは影響しない（§13 認可洗浄禁止）。
     *
     * `[]` は「migration されたが Legacy からは到達不能だった entry」であり、
     * `null`（Legacy 由来ではない）とは意味が違うので潰さない。
     */
    legacySourceKeys: normalizeLegacySourceKeys(legacySourceKeys),
    valueType,
    value: normalized.value,
    normalizedValue: normalized.normalizedValue,
    foldedValue: normalized.foldedValue,
    valueNormalizerVersion: VALUE_NORMALIZER_VERSION,
    script,
    // §7.0:「Creation Hints は Authority ではない」— 診断用 snapshot
    creationHints: creationHints ?? { language: null, role: null, romanizationSystem: null },
    applicabilityConstraints: constraints,
    applicabilityProfile: emptyApplicabilityProfile(),
    contextHints: [],
    contextHintsPolicyVersion: 1,
    sourceNameGuard,
    trustTier: TRUST_TIER.provisional,
    // §11.2: 互いに独立した診断 / eligibility 軸。1 enum へ詰め込まない。
    conflictState: CONFLICT_STATE.clean,
    revalidationState: REVALIDATION_STATE.clean,
    quarantined,
    quarantineMetadata,
    stagingSessionId,
    lifecycleState,
    verificationState,
    locked,
    lockMetadata,
    // §28 Derived Score cache。Evidence / Dependency から再計算可能。
    confidenceScore: 0,
    truthStrength: 0,
    /**
     * §102.3.6 Phase 9B: Package trustMode 由来の Soft Score 補正。
     * confidenceScore とは別 field なので Truth Eligibility Gate を迂回しない
     * （§139.21）。Package が1件も無ければ常に 0。
     */
    packageSoftAdjust: 0,
    // §28.1.1 per-Claim fencing
    scoreInputRevision: 1,
    scoreComputedFromInputRevision: 0,
    scoreDirty: true,
    scoreComputedAt: 0,
    // §28.1 Score input version fields
    confidencePolicyVersion: 0,
    scoreBuiltinDictionaryVersion: 0,
    scoreCountryProfileVersion: 0,
    scoreCountryCanonicalizationVersion: 0,
    scoreWorldRegionCanonicalizationVersion: 0,
    scoreModelLineageRegistryVersion: 0,
    scoreContextHashSchemaVersion: 0,
    scoreLanguageInferenceVersion: 0,
    scoreDerivationPolicyVersion: 0,
    evidenceSummary: {},
    provenance: {
      createdBy: provenance.createdBy,
      firstEvidenceRootId: provenance.firstEvidenceRootId ?? null
    },
    // §7.5: null なら直接 assert された Claim
    derivation,
    useCount: 0,
    lastUsedAt: null,
    // §11.6 / §92.3: semantic metadata と Derived cache の競合を分離する
    semanticRevision: 1,
    derivedRevision: 1,
    supersededByClaimId: null,
    deletedAt: null,
    disabled: false,
    createdAt: now,
    updatedAt: now
  };
}
__name(buildClaimRecord, "buildClaimRecord");
async function upsertClaim(db, spec, {
  actor = "system",
  mutationId = null,
  invalidateCache = true
} = {}) {
  const prepared = await prepareClaimUpsert(spec, { mutationId, invalidateCache });
  const extraStores = invalidateCache ? [STORE.cache] : [];
  const { result } = await runSemanticMutation(
    db,
    [STORE.claims, STORE.history],
    async ({ tx }) => commitClaimUpsertIn(tx, prepared, { actor }),
    { extraStores }
  );
  return result;
}
__name(upsertClaim, "upsertClaim");
async function prepareClaimUpsert(spec, { mutationId = null, invalidateCache = true } = {}) {
  const record = await buildClaimRecord(spec);
  const mid = mutationId ?? newOpaqueId("mut");
  const cacheLookupKeys = invalidateCache ? await getLookupKeysForClaim(record) : null;
  return { record, mutationId: mid, cacheLookupKeys, invalidateCache, now: spec.now ?? Date.now() };
}
__name(prepareClaimUpsert, "prepareClaimUpsert");
async function commitClaimUpsertIn(tx, prepared, { actor = "system" } = {}) {
  const { record, mutationId: mid, cacheLookupKeys, invalidateCache, now } = prepared;
  const out = await upsertClaimBySemanticKey(tx, {
    semanticKey: record.semanticKey,
    build: /* @__PURE__ */ __name(() => record, "build")
  });
  if (out.created) {
    addHistory(tx, buildHistoryRecord({
      nodeId: record.claimId,
      action: HISTORY_ACTION.claimCreated,
      changes: [],
      actor,
      mutationId: mid,
      detail: { valueType: record.valueType, subjectKey: record.subjectKey },
      now
    }));
    if (invalidateCache) await invalidateForClaimIn(tx, out.record, cacheLookupKeys);
    return { claim: out.record, created: true, raced: out.raced, revived: false, revivalBlocked: false };
  }
  const existing = out.record;
  const tombstoned = existing.deletedAt != null || existing.disabled === true || existing.supersededByClaimId != null || existing.lifecycleState === LIFECYCLE_STATE.archived;
  return {
    claim: existing,
    created: false,
    raced: out.raced,
    revived: false,
    // §122.6:「AI が deleted/disabled を勝手に解除しない」。Evidence は追加可能。
    revivalBlocked: tombstoned
  };
}
__name(commitClaimUpsertIn, "commitClaimUpsertIn");
var AUTOMATED_ACTORS = /* @__PURE__ */ new Set(["ai", "revalidation", "background_job", "resolver", "package_import"]);
function isManualAuthorityClaim(claim) {
  return claim?.verificationState === VERIFICATION_STATE.manualEntered || claim?.verificationState === VERIFICATION_STATE.manualCorrected || claim?.verificationState === VERIFICATION_STATE.official;
}
__name(isManualAuthorityClaim, "isManualAuthorityClaim");
function assertAutomatedMutationAllowed(claim, { actor, intent }) {
  if (!AUTOMATED_ACTORS.has(actor)) return true;
  if (intent === "add_evidence" || intent === "derived_score") return true;
  if (claim.locked === true) {
    throw new ClaimModelError(
      `§120-10: actor "${actor}" may not ${intent} a locked Claim. Add a competing Claim / contradict Evidence instead.`,
      { claimId: claim.claimId, actor, intent }
    );
  }
  if (isManualAuthorityClaim(claim)) {
    throw new ClaimModelError(
      `§119: actor "${actor}" may not ${intent} a manual/official Claim (verificationState=${claim.verificationState}).`,
      { claimId: claim.claimId, actor, intent }
    );
  }
  return true;
}
__name(assertAutomatedMutationAllowed, "assertAutomatedMutationAllowed");
async function replaceClaimSemantics(db, {
  oldClaimId,
  newClaimSpec,
  actor,
  mutationId = null,
  completeReplacement = true,
  now = Date.now(),
  invalidateCache = true
}) {
  if (typeof oldClaimId !== "string" || !oldClaimId) {
    throw new ClaimModelError("replaceClaimSemantics: oldClaimId is required", {});
  }
  if (typeof actor !== "string" || !actor) {
    throw new ClaimModelError("replaceClaimSemantics: actor is required", {});
  }
  const newRecord = await buildClaimRecord({ ...newClaimSpec, now });
  const mid = mutationId ?? newOpaqueId("mut");
  const preexisting = await getClaimBySemanticKey(db, newRecord.semanticKey);
  const effectiveNewClaimId = preexisting?.claimId ?? newRecord.claimId;
  let oldCacheLookupKeys = null;
  let newCacheLookupKeys = null;
  if (invalidateCache) {
    const oldPre = await getClaim(db, oldClaimId);
    oldCacheLookupKeys = oldPre ? await getLookupKeysForClaim(oldPre) : [];
    newCacheLookupKeys = await getLookupKeysForClaim(newRecord);
  }
  if (effectiveNewClaimId === oldClaimId) {
    throw new ClaimModelError(
      "replaceClaimSemantics: the new Claim has the same semanticKey as the old one; this is not a semantic replacement (§10.2).",
      { oldClaimId }
    );
  }
  const edgeRecord = await buildRelationRecord({
    relation: RELATION.replaces,
    fromNodeId: effectiveNewClaimId,
    // §35: from = 新しい側
    toNodeId: oldClaimId,
    // §35: to = 置換される側
    createdFromEvidenceRootId: newClaimSpec.provenance?.firstEvidenceRootId ?? null,
    now
  });
  const extraStores = invalidateCache ? [STORE.cache] : [];
  const { result } = await runSemanticMutation(
    db,
    [STORE.claims, STORE.relations, STORE.history],
    async ({ tx }) => {
      const claims = tx.objectStore(STORE.claims);
      const old = await requestOf2(claims.get(oldClaimId));
      if (!old) throw new ClaimModelError(`replaceClaimSemantics: claim not found: ${oldClaimId}`, { oldClaimId });
      assertAutomatedMutationAllowed(old, { actor, intent: "replace_semantics" });
      const upserted = await upsertClaimBySemanticKey(tx, {
        semanticKey: newRecord.semanticKey,
        build: /* @__PURE__ */ __name(() => newRecord, "build")
      });
      if (upserted.record.claimId !== effectiveNewClaimId) {
        throw new ClaimModelError(
          "replaceClaimSemantics: concurrent upsert changed the target Claim id; retry",
          { expected: effectiveNewClaimId, actual: upserted.record.claimId }
        );
      }
      await addRelationIfMissing(tx, { edgeKey: edgeRecord.edgeKey, build: /* @__PURE__ */ __name(() => edgeRecord, "build") });
      const nextOld = {
        ...old,
        supersededByClaimId: effectiveNewClaimId,
        lifecycleState: completeReplacement ? LIFECYCLE_STATE.archived : old.lifecycleState,
        semanticRevision: (old.semanticRevision ?? 0) + 1,
        updatedAt: now
      };
      await requestOf2(claims.put(nextOld));
      if (invalidateCache) {
        await invalidateForClaimIn(tx, nextOld, oldCacheLookupKeys);
        if (upserted.created) await invalidateForClaimIn(tx, upserted.record, newCacheLookupKeys);
      }
      addHistory(tx, buildHistoryRecord({
        nodeId: old.claimId,
        action: HISTORY_ACTION.claimReplaced,
        changes: [
          { field: "supersededByClaimId", before: old.supersededByClaimId ?? null, after: effectiveNewClaimId },
          { field: "lifecycleState", before: old.lifecycleState, after: nextOld.lifecycleState }
        ],
        actor,
        mutationId: mid,
        detail: { newClaimId: effectiveNewClaimId, completeReplacement },
        now
      }));
      return { oldClaim: nextOld, newClaim: upserted.record, newClaimCreated: upserted.created };
    },
    { extraStores }
  );
  return {
    oldClaim: result.oldClaim,
    newClaim: result.newClaim,
    newClaimCreated: result.newClaimCreated,
    replacesEdgeKey: edgeRecord.edgeKey,
    mutationId: mid
  };
}
__name(replaceClaimSemantics, "replaceClaimSemantics");
function requestOf2(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf2, "requestOf");
async function getClaim(db, claimId) {
  return runRead(db, [STORE.claims], ({ store }) => requestOf2(store(STORE.claims).get(claimId)));
}
__name(getClaim, "getClaim");
async function getClaimBySemanticKey(db, semanticKey2) {
  return runRead(db, [STORE.claims], ({ store }) => requestOf2(store(STORE.claims).index("semanticKey").get(semanticKey2)));
}
__name(getClaimBySemanticKey, "getClaimBySemanticKey");
function findClaimsBySubject(db, subjectKey, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "subjectKey",
    query: cursor ? void 0 : IDBKeyRange.only(subjectKey),
    limit,
    cursor
  });
}
__name(findClaimsBySubject, "findClaimsBySubject");
function findClaimsBySubjectAndValueType(db, subjectKey, valueType, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "subjectKey_valueType",
    query: cursor ? void 0 : IDBKeyRange.only([subjectKey, valueType]),
    limit,
    cursor
  });
}
__name(findClaimsBySubjectAndValueType, "findClaimsBySubjectAndValueType");
function findClaimsByGroup(db, claimGroupKey2, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "claimGroupKey",
    query: cursor ? void 0 : IDBKeyRange.only(claimGroupKey2),
    limit,
    cursor
  });
}
__name(findClaimsByGroup, "findClaimsByGroup");
function findClaimsByNormalizedSource(db, normalizedSource, valueType, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "normalizedSource_valueType",
    query: cursor ? void 0 : IDBKeyRange.only([normalizedSource, valueType]),
    limit,
    cursor
  });
}
__name(findClaimsByNormalizedSource, "findClaimsByNormalizedSource");
function findAliasClaimsByNormalizedValue(db, normalizedValue, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "valueType_normalizedValue",
    query: cursor ? void 0 : IDBKeyRange.only(["source_alias", normalizedValue]),
    limit,
    cursor
  });
}
__name(findAliasClaimsByNormalizedValue, "findAliasClaimsByNormalizedValue");
function findAliasClaimsByFoldedValue(db, foldedValue, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "valueType_foldedValue",
    query: cursor ? void 0 : IDBKeyRange.only(["source_alias", foldedValue]),
    limit,
    cursor
  });
}
__name(findAliasClaimsByFoldedValue, "findAliasClaimsByFoldedValue");
function findClaimsByFoldedSource(db, foldedSource, { limit, cursor } = {}) {
  return iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "foldedSource",
    query: cursor ? void 0 : IDBKeyRange.only(foldedSource),
    limit,
    cursor
  });
}
__name(findClaimsByFoldedSource, "findClaimsByFoldedSource");
async function patchClaimExplicit(db, claimId, patch, {
  actor,
  mutationId = null,
  now = Date.now(),
  invalidateCache = true
} = {}) {
  const mid = mutationId ?? newOpaqueId("mut");
  const extraStores = invalidateCache ? [STORE.cache] : [];
  const cacheLookupKeys = invalidateCache ? await (async () => {
    const pre = await runRead(db, [STORE.claims], ({ store }) => requestOf2(store(STORE.claims).get(claimId)));
    return pre ? getLookupKeysForClaim(pre) : [];
  })() : null;
  const { result } = await runSemanticMutation(db, [STORE.claims, STORE.history], async ({ tx }) => {
    const current = await requestOf2(tx.objectStore(STORE.claims).get(claimId));
    if (!current) throw new ClaimModelError(`patchClaimExplicit: claim not found: ${claimId}`, { claimId });
    assertAutomatedMutationAllowed(current, { actor, intent: "patch_explicit_state" });
    const next = await patchClaimExplicitState(tx, claimId, patch, { now });
    if (invalidateCache) await invalidateForClaimIn(tx, next, cacheLookupKeys);
    addHistory(tx, buildHistoryRecord({
      nodeId: claimId,
      action: patch.locked === true ? HISTORY_ACTION.claimLocked : patch.locked === false ? HISTORY_ACTION.claimUnlocked : HISTORY_ACTION.claimExplicitStateChanged,
      changes: Object.keys(patch).map((f) => ({ field: f, before: current[f] ?? null, after: patch[f] })),
      actor,
      mutationId: mid,
      now
    }));
    return next;
  }, { extraStores });
  return result;
}
__name(patchClaimExplicit, "patchClaimExplicit");

// dictionary-confidence.js
var CONFIDENCE_POLICY_VERSION = 1;
var CONFIDENCE_POLICY = Object.freeze({
  version: CONFIDENCE_POLICY_VERSION,
  // §30.1 Base Weight。相対順序が契約（manual > blind AI > anchored AI > derived）。
  baseWeight: Object.freeze({
    [EVIDENCE_TYPE.officialSource]: 50,
    [EVIDENCE_TYPE.userCorrection]: 45,
    [EVIDENCE_TYPE.manualEntry]: 40,
    [EVIDENCE_TYPE.explicitUserConfirmation]: 30,
    [EVIDENCE_TYPE.legacyImport]: 20,
    [EVIDENCE_TYPE.aiObservation]: 18,
    [EVIDENCE_TYPE.lncImport]: 10,
    [EVIDENCE_TYPE.portableImportSnapshot]: 8,
    /**
     * §102.3.2:「Community Package != Local Manual」。Pack 作者の "確認済み" 表明は
     * Local User Confirmation へ変換しない。単独では learnedThreshold(12) にも
     * 届かない重みにして、Package だけで trusted へ到達しないことを数値でも担保する。
     */
    [EVIDENCE_TYPE.packageAttestation]: 6,
    [EVIDENCE_TYPE.implicitUserAcceptance]: 1,
    // §17:「derived_composition は独立Truth票としては0に近い」
    [EVIDENCE_TYPE.derivedComposition]: 0,
    [EVIDENCE_TYPE.derivedNativeConversion]: 0
  }),
  // §23 / §125: 候補を見せられた AI は Blind と同 weight にしない
  anchoredMultiplier: 0.35,
  // §30.1-5: stale-at-commit AI はさらに弱い
  staleAtCommitMultiplier: 0.4,
  // §22.3: unknown lineage は補助的にしか寄与しない
  unknownLineageMultiplier: 0.6,
  // §30.2 Diminishing Return:
  //   groupContribution = representative * min(cap, 1 + factor*log2(1 + extraRoots))
  diminishingLogFactor: 0.5,
  diminishingCap: 2,
  // Contradict の重み（§30.3 Context-aware Contradiction）
  contradictWeight: 1,
  // §11.7: 「適用領域が大きく重なる有力Candidateが存在する」= claim-level conflict
  conflictRatio: 0.5,
  // §30 Trust Quality Gate
  trustedThreshold: 35,
  learnedThreshold: 12,
  // §22.3:「unknown Group同士が2個あるだけでは trusted Quality Gate を満たさない」
  crossLineageRequiredKnownLineages: 2,
  // §13.2 profile strength の平滑化（0除算回避 + 1件で1.0にしない）
  profileSmoothing: 1,
  /**
   * §102.3.6 Package Trust Mode。**confidenceScore へは掛けない**。
   * Candidate ranking 用の `packageSoftAdjust` にだけ効く soft 補正であり、
   * §139.21「preferred 設定だけで Truth Eligibility Gate を通過しない」を
   * 構造的に保証する（gate は confidenceScore を見る）。
   */
  packageSoftAdjustByTrustMode: Object.freeze({
    normal: 0,
    preferred: 3,
    low_priority: -3
  }),
  /** packageSoftAdjust の絶対値上限。Package を何個入れても支配的にしない。 */
  packageSoftAdjustCap: 6,
  scoreMin: 0,
  scoreMax: 100
});
var VERIFICATION_STATE_TRUTH_WEIGHT = 0;
var USE_COUNT_TRUTH_WEIGHT = 0;
var ConfidenceError = class extends Error {
  static {
    __name(this, "ConfidenceError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ConfidenceError";
    this.details = details;
  }
};
function evidenceWeight(evidence, lineage, policy) {
  let w = policy.baseWeight[evidence.evidenceType];
  if (w === void 0) {
    throw new ConfidenceError(
      `no base weight for evidenceType ${evidence.evidenceType}`,
      { evidenceType: evidence.evidenceType }
    );
  }
  if (evidence.anchored) w *= policy.anchoredMultiplier;
  if (evidence.staleAtCommit) w *= policy.staleAtCommitMultiplier;
  if (lineage?.lineageClassification === LINEAGE_CLASSIFICATION.unknown) {
    w *= policy.unknownLineageMultiplier;
  }
  return w;
}
__name(evidenceWeight, "evidenceWeight");
function groupContribution(representativeWeight, distinctGenerationRoots, policy = CONFIDENCE_POLICY) {
  if (distinctGenerationRoots <= 0) return 0;
  const extra = distinctGenerationRoots - 1;
  const factor = Math.min(
    policy.diminishingCap,
    1 + policy.diminishingLogFactor * Math.log2(1 + extra)
  );
  return representativeWeight * factor;
}
__name(groupContribution, "groupContribution");
async function analyzeConditioningCircularityFromRoots(db, claimId, { roots, overflow = false }, { pageSize = 100, maxSiblings = 500 } = {}) {
  const siblingClaimIds = /* @__PURE__ */ new Set();
  const siblingsByRoot = /* @__PURE__ */ new Map();
  let truncated = overflow;
  for (const root of roots) {
    let cursor = null;
    for (; ; ) {
      const page = await iterateEvidenceByRoot(db, root, { limit: pageSize, cursor });
      for (const ev of page.items) {
        if (ev.claimId === claimId) continue;
        siblingClaimIds.add(ev.claimId);
        if (!siblingsByRoot.has(root)) siblingsByRoot.set(root, /* @__PURE__ */ new Set());
        siblingsByRoot.get(root).add(ev.claimId);
      }
      if (siblingClaimIds.size > maxSiblings) {
        truncated = true;
        break;
      }
      if (page.done) break;
      cursor = page.nextCursor;
    }
    if (truncated) break;
  }
  const contextSiblingRoots = /* @__PURE__ */ new Set();
  for (const [root, ids] of siblingsByRoot) {
    for (const id of ids) {
      const sibling = await runRead(db, [STORE.claims], ({ store }) => requestOf3(store(STORE.claims).get(id)));
      if (!sibling) continue;
      if (CONTEXT_DEFINING_VALUE_TYPES.has(sibling.valueType)) {
        contextSiblingRoots.add(root);
        break;
      }
    }
  }
  const dependentClaimIds = /* @__PURE__ */ new Set();
  for (const relation of [RELATION.dependsOn, RELATION.derivedFrom]) {
    const deps = await collectDependents(db, { toNodeId: claimId, relation });
    if (deps.truncated) truncated = true;
    for (const r of deps.items) dependentClaimIds.add(r.fromNodeId);
  }
  return { selfClaimId: claimId, siblingClaimIds, contextSiblingRoots, dependentClaimIds, truncated };
}
__name(analyzeConditioningCircularityFromRoots, "analyzeConditioningCircularityFromRoots");
var CONTEXT_DEFINING_VALUE_TYPES = Object.freeze(/* @__PURE__ */ new Set(["language_hint", "role"]));
function isCircularlyConditioned(evidence, circularity) {
  if (!circularity) return false;
  if (circularity.truncated) return true;
  if (evidence.evidenceRootId && circularity.contextSiblingRoots?.has(evidence.evidenceRootId)) {
    return true;
  }
  const ids = evidence.conditioningClaimIds ?? [];
  for (const id of ids) {
    if (id === circularity.selfClaimId) return true;
    if (circularity.siblingClaimIds?.has(id)) return true;
    if (circularity.dependentClaimIds?.has(id)) return true;
  }
  return false;
}
__name(isCircularlyConditioned, "isCircularlyConditioned");
var AGGREGATION_POLICY = Object.freeze({
  pageSize: 200,
  maxTrackedRootsPerGroup: 16,
  maxTrackedDistinct: 1e4,
  maxTrackedDistinctPerCell: 256
});
function rootSaturationThreshold(policy = CONFIDENCE_POLICY) {
  if (policy.diminishingLogFactor <= 0) return 1;
  return Math.ceil(2 ** ((policy.diminishingCap - 1) / policy.diminishingLogFactor));
}
__name(rootSaturationThreshold, "rootSaturationThreshold");
{
  const need = rootSaturationThreshold(CONFIDENCE_POLICY);
  if (AGGREGATION_POLICY.maxTrackedRootsPerGroup < need) {
    throw new Error(
      `AGGREGATION_POLICY.maxTrackedRootsPerGroup (${AGGREGATION_POLICY.maxTrackedRootsPerGroup}) must be >= the diminishing-return saturation threshold (${need}); otherwise streaming aggregation would stop being exact.`
    );
  }
}
var BoundedDistinctSet = class {
  static {
    __name(this, "BoundedDistinctSet");
  }
  constructor(limit) {
    this.limit = limit;
    this.set = /* @__PURE__ */ new Set();
    this.saturated = false;
  }
  add(v) {
    if (v === null || v === void 0 || v === "") return;
    if (this.set.has(v)) return;
    if (this.set.size >= this.limit) {
      this.saturated = true;
      return;
    }
    this.set.add(v);
  }
  get size() {
    return this.set.size;
  }
  has(v) {
    return this.set.has(v);
  }
};
function newDimensionCell(cellLimit) {
  return {
    strength: 0,
    supportWeight: 0,
    contradictWeight: 0,
    distinctEntities: 0,
    lastObservedAt: 0,
    _entities: new BoundedDistinctSet(cellLimit)
  };
}
__name(newDimensionCell, "newDimensionCell");
function addDimension(profile, dim, key, { weight, stance, entityKey: entityKey2, at }, cellLimit) {
  if (key === null || key === void 0 || key === "") return;
  const bucket = profile[dim];
  if (!bucket[key]) bucket[key] = newDimensionCell(cellLimit);
  const cell = bucket[key];
  if (stance === STANCE.support) cell.supportWeight += weight;
  else if (stance === STANCE.contradict) cell.contradictWeight += weight;
  if (entityKey2) cell._entities.add(entityKey2);
  if (at > cell.lastObservedAt) cell.lastObservedAt = at;
}
__name(addDimension, "addDimension");
function finalizeProfile(profile, policy) {
  for (const dim of ["targets", "countries", "worldRegions", "locales", "languages", "roles"]) {
    for (const key of Object.keys(profile[dim])) {
      const cell = profile[dim][key];
      cell.distinctEntities = cell._entities.size;
      delete cell._entities;
      const denom = cell.supportWeight + cell.contradictWeight + policy.profileSmoothing;
      cell.strength = denom > 0 ? round3(cell.supportWeight / denom) : 0;
    }
  }
  return profile;
}
__name(finalizeProfile, "finalizeProfile");
function round3(n) {
  return Math.round(n * 1e3) / 1e3;
}
__name(round3, "round3");
var PACKAGE_EFFECT_STATE = Object.freeze({
  counted: "counted",
  noSuchPackage: "no_such_package",
  packageNotActive: "package_not_active",
  versionNotActive: "version_not_active"
});
var EMPTY_PACKAGE_EFFECT = Object.freeze({
  packageEffectVersion: 0,
  byPackageKey: Object.freeze(/* @__PURE__ */ new Map())
});
function evaluatePackageAttestation(ev, effect = EMPTY_PACKAGE_EFFECT) {
  const key = ev.originPackageKey ?? (ev.originPackageId ? `package:${ev.originPackageId}` : null);
  const entry = key ? effect.byPackageKey?.get(key) : null;
  if (!entry) {
    return { counted: false, reason: PACKAGE_EFFECT_STATE.noSuchPackage, trustMode: null };
  }
  if (entry.state !== "active") {
    return { counted: false, reason: PACKAGE_EFFECT_STATE.packageNotActive, trustMode: entry.trustMode };
  }
  if (entry.activeVersion == null || ev.originPackageVersion !== entry.activeVersion) {
    return { counted: false, reason: PACKAGE_EFFECT_STATE.versionNotActive, trustMode: entry.trustMode };
  }
  return { counted: true, reason: PACKAGE_EFFECT_STATE.counted, trustMode: entry.trustMode ?? "normal" };
}
__name(evaluatePackageAttestation, "evaluatePackageAttestation");
var PACKAGE_EFFECT_POLICY = Object.freeze({
  pageSize: 100,
  /** installed Package 数の上限。超過分は fail closed（counted しない）。 */
  maxPackages: 2e3
});
async function readPackageEffectSnapshot(db, { policy = PACKAGE_EFFECT_POLICY } = {}) {
  const byPackageKey = /* @__PURE__ */ new Map();
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.packages,
      indexName: "updatedAt",
      limit: policy.pageSize,
      cursor
    });
    for (const p of page.items) {
      if (byPackageKey.size >= policy.maxPackages) {
        truncated = true;
        break;
      }
      byPackageKey.set(p.packageKey, {
        state: p.state,
        activeVersion: p.activeVersion ?? null,
        trustMode: p.trustMode ?? "normal"
      });
    }
    if (page.done || truncated) break;
    cursor = page.nextCursor;
  }
  return { packageEffectVersion: byPackageKey.size, byPackageKey, truncated };
}
__name(readPackageEffectSnapshot, "readPackageEffectSnapshot");
function createClaimScoreAggregator({
  registry = DEFAULT_MODEL_LINEAGE_REGISTRY,
  circularity = null,
  builtinAgreement = null,
  policy = CONFIDENCE_POLICY,
  aggregation = AGGREGATION_POLICY,
  /** §102.3.5 / §120-58: Package registry の bounded snapshot。既定は「Package 無し」。 */
  packageEffect = EMPTY_PACKAGE_EFFECT
} = {}) {
  const groups = /* @__PURE__ */ new Map();
  const knownLineages = /* @__PURE__ */ new Set();
  const softAdjustPackages = /* @__PURE__ */ new Map();
  const activePackages = new BoundedDistinctSet(aggregation.maxTrackedDistinct);
  const unknownGroups = new BoundedDistinctSet(aggregation.maxTrackedDistinct);
  const generationRoots = new BoundedDistinctSet(aggregation.maxTrackedDistinct);
  const distinctEntities = new BoundedDistinctSet(aggregation.maxTrackedDistinct);
  const distinctPhrases = new BoundedDistinctSet(aggregation.maxTrackedDistinct);
  const profile = {
    targets: {},
    countries: {},
    worldRegions: {},
    locales: {},
    languages: {},
    roles: {},
    distinctEntities: 0,
    distinctPhrases: 0
  };
  const counts = {
    totalEvidence: 0,
    truthEligibleCount: 0,
    neutralCount: 0,
    derivedCount: 0,
    supportCount: 0,
    contradictCount: 0,
    anchoredCount: 0,
    blindCount: 0,
    staleCount: 0,
    duplicateSeenTotal: 0,
    circularConditioningCount: 0,
    // §139.20 / §139.16: activeVersion 不一致 / disabled で Current vote から
    // 外した Package Attestation の件数（監査用。Truth へは効かない）。
    packageAttestationCount: 0,
    packageExcludedCount: 0
  };
  const gateFlags = { userVerified: false, official: false };
  function groupSide(group, stance) {
    if (!groups.has(group)) {
      groups.set(group, {
        support: { max: 0, roots: /* @__PURE__ */ new Set(), overflowed: false, count: 0 },
        contradict: { max: 0, roots: /* @__PURE__ */ new Set(), overflowed: false, count: 0 }
      });
    }
    const bucket = groups.get(group);
    return stance === STANCE.contradict ? bucket.contradict : bucket.support;
  }
  __name(groupSide, "groupSide");
  function noteRoot(side, root, weight) {
    if (weight > side.max) side.max = weight;
    if (side.roots.has(root)) return;
    if (side.roots.size >= aggregation.maxTrackedRootsPerGroup) {
      side.overflowed = true;
      return;
    }
    side.roots.add(root);
  }
  __name(noteRoot, "noteRoot");
  function sideContribution(side) {
    if (side.roots.size === 0) return 0;
    const distinctRoots = side.overflowed ? Math.max(side.roots.size + 1, rootSaturationThreshold(policy)) : side.roots.size;
    return groupContribution(side.max, distinctRoots, policy);
  }
  __name(sideContribution, "sideContribution");
  return {
    add(ev) {
      counts.totalEvidence++;
      if (DERIVED_EVIDENCE_TYPES.has(ev.evidenceType)) counts.derivedCount++;
      if (!isDecisionAffecting(ev)) {
        counts.neutralCount++;
        return;
      }
      if (ev.evidenceType === EVIDENCE_TYPE.packageAttestation) {
        counts.packageAttestationCount++;
        const eff = evaluatePackageAttestation(ev, packageEffect);
        if (!eff.counted) {
          counts.packageExcludedCount++;
          counts.neutralCount++;
          return;
        }
        const pk = ev.originPackageKey ?? `package:${ev.originPackageId}`;
        activePackages.add(pk);
        if (ev.stance === STANCE.support && !softAdjustPackages.has(pk)) {
          softAdjustPackages.set(pk, eff.trustMode ?? "normal");
        }
      }
      counts.truthEligibleCount++;
      const lineage = resolveEvidenceLineage(ev, registry);
      const group = lineage.independenceGroup ?? ev.independenceGroup ?? `other:${ev.evidenceType}`;
      const weight = evidenceWeight(ev, lineage, policy);
      if (ev.provider != null) {
        if (lineage.lineageClassification === LINEAGE_CLASSIFICATION.known) {
          if (!ev.anchored && ev.stance === STANCE.support) knownLineages.add(lineage.modelLineageId);
        } else {
          unknownGroups.add(group);
        }
      }
      if (ev.anchored) counts.anchoredCount++;
      else counts.blindCount++;
      if (ev.staleAtCommit) counts.staleCount++;
      counts.duplicateSeenTotal += ev.duplicateSeenCount ?? 0;
      if (ev.stance === STANCE.contradict) counts.contradictCount++;
      else counts.supportCount++;
      if (ev.stance === STANCE.support) {
        if (ev.evidenceType === EVIDENCE_TYPE.userCorrection || ev.evidenceType === EVIDENCE_TYPE.explicitUserConfirmation || ev.evidenceType === EVIDENCE_TYPE.manualEntry) gateFlags.userVerified = true;
        if (ev.evidenceType === EVIDENCE_TYPE.officialSource) gateFlags.official = true;
      }
      const root = ev.evidenceRootId ?? ev.evidenceId;
      if (ev.stance === STANCE.support) generationRoots.add(root);
      noteRoot(groupSide(group, ev.stance), root, weight);
      const snap = ev.contextSnapshot ?? {};
      const canonical = snap.canonicalFacts ?? {};
      const inference = snap.inference ?? {};
      const at = ev.lastSeenAt ?? ev.createdAt ?? 0;
      const entityKey2 = ev.entityKey ?? null;
      if (entityKey2) distinctEntities.add(entityKey2);
      if (ev.fullPhrase) distinctPhrases.add(ev.fullPhrase);
      const cell = { weight, stance: ev.stance, entityKey: entityKey2, at };
      const lim = aggregation.maxTrackedDistinctPerCell;
      addDimension(profile, "targets", ev.target, cell, lim);
      addDimension(profile, "countries", canonical.countryCode ?? null, cell, lim);
      addDimension(profile, "worldRegions", canonical.worldRegionCode ?? null, cell, lim);
      addDimension(profile, "locales", inference.languageCandidates?.[0]?.locale ?? null, cell, lim);
      if (isCircularlyConditioned(ev, circularity)) {
        counts.circularConditioningCount++;
      } else {
        addDimension(
          profile,
          "languages",
          inference.languageCandidates?.[0]?.language ?? null,
          cell,
          lim
        );
        addDimension(profile, "roles", inference.role ?? null, cell, lim);
      }
    },
    /** 集約 state の実測サイズ（bounded-memory テスト用）。 */
    state() {
      let trackedRoots = 0;
      for (const b of groups.values()) trackedRoots += b.support.roots.size + b.contradict.roots.size;
      let cells = 0;
      for (const dim of ["targets", "countries", "worldRegions", "locales", "languages", "roles"]) {
        cells += Object.keys(profile[dim]).length;
      }
      return {
        groups: groups.size,
        trackedRoots,
        profileCells: cells,
        trackedDistinctEntities: distinctEntities.size,
        trackedGenerationRoots: generationRoots.size,
        maxTrackedRootsPerGroup: aggregation.maxTrackedRootsPerGroup
      };
    },
    finalize({ evidenceTruncated = false } = {}) {
      profile.distinctEntities = distinctEntities.size;
      profile.distinctPhrases = distinctPhrases.size;
      finalizeProfile(profile, policy);
      let supportTotal = 0;
      let contradictTotal = 0;
      for (const bucket of groups.values()) {
        supportTotal += sideContribution(bucket.support);
        contradictTotal += sideContribution(bucket.contradict);
      }
      if (builtinAgreement?.agrees) {
        supportTotal += builtinAgreement.weight ?? policy.baseWeight[EVIDENCE_TYPE.legacyImport];
      }
      const net = supportTotal - contradictTotal * policy.contradictWeight;
      const truthStrength = clamp(Math.round(net), policy.scoreMin, policy.scoreMax);
      const qualityGate = trustQualityGateFromFlags({
        userVerified: gateFlags.userVerified,
        official: gateFlags.official,
        knownLineages,
        builtinAgreement,
        policy
      });
      let trustTier;
      if (!qualityGate.passed) {
        trustTier = truthStrength >= policy.learnedThreshold ? TRUST_TIER.learned : TRUST_TIER.provisional;
      } else {
        trustTier = truthStrength >= policy.trustedThreshold ? TRUST_TIER.trusted : TRUST_TIER.learned;
      }
      let packageSoftAdjust = 0;
      for (const mode of softAdjustPackages.values()) {
        packageSoftAdjust += policy.packageSoftAdjustByTrustMode[mode] ?? 0;
      }
      packageSoftAdjust = clamp(
        packageSoftAdjust,
        -policy.packageSoftAdjustCap,
        policy.packageSoftAdjustCap
      );
      const conflictState = contradictTotal > 0 && supportTotal > 0 && contradictTotal >= supportTotal * policy.conflictRatio ? CONFLICT_STATE.conflicted : CONFLICT_STATE.clean;
      const evidenceSummary = {
        totalEvidence: counts.totalEvidence,
        truthEligibleCount: counts.truthEligibleCount,
        neutralCount: counts.neutralCount,
        derivedCount: counts.derivedCount,
        supportCount: counts.supportCount,
        contradictCount: counts.contradictCount,
        // §29:「independentEntities = 100 と independenceGroups = 1 を分ける」
        independenceGroups: groups.size,
        knownLineageIds: [...knownLineages].sort(),
        unknownLineageGroups: unknownGroups.size,
        // §21.2 / §124.2: Fan-out しても actual generation は Root 数
        actualGenerationRoots: generationRoots.size,
        distinctEntities: distinctEntities.size,
        anchoredCount: counts.anchoredCount,
        blindCount: counts.blindCount,
        staleCount: counts.staleCount,
        circularConditioningCount: counts.circularConditioningCount,
        // §19.1:「duplicateSeenCount は診断だけ。Truth weight へ直接使わない。」
        duplicateSeenTotal: counts.duplicateSeenTotal,
        supportWeight: round3(supportTotal),
        contradictWeight: round3(contradictTotal),
        qualityGate,
        // B3A-01: Score 経路は全 Evidence を走査するので通常 false。
        // 診断 distinct counter が上限へ達した場合だけ true になる。
        evidenceTruncated,
        diagnosticsSaturated: generationRoots.saturated || distinctEntities.saturated || distinctPhrases.saturated,
        // §31 / §30.4: Truth へ足していないことを Trace で確認可能にする
        verificationStateTruthWeight: VERIFICATION_STATE_TRUTH_WEIGHT,
        useCountTruthWeight: USE_COUNT_TRUTH_WEIGHT,
        // §102.3 Package 集計の可視化（Truth 判定そのものではない）
        packageAttestationCount: counts.packageAttestationCount,
        packageExcludedCount: counts.packageExcludedCount,
        activePackageCount: activePackages.size,
        // §139.21: preferred は Truth Gate を迂回しないことを Trace で確認可能にする
        packageSoftAdjust,
        packageTrustGateBypass: false
      };
      return {
        truthStrength,
        // §7 の永続 field 名。Truth Strength と同じ数値で、Context Fit は別に計算する。
        confidenceScore: truthStrength,
        trustTier,
        conflictState,
        applicabilityProfile: profile,
        evidenceSummary,
        contextHints: buildContextHints(profile),
        /**
         * §102.3.6 / §139.21: Package trustMode 由来の **Soft** 補正。
         * confidenceScore / trustTier / qualityGate のいずれにも入っていない
         * ので、`preferred` にしただけでは Truth Eligibility Gate を越えない。
         */
        packageSoftAdjust
      };
    }
  };
}
__name(createClaimScoreAggregator, "createClaimScoreAggregator");
function trustQualityGateFromFlags({
  userVerified,
  official,
  knownLineages,
  builtinAgreement = null,
  policy = CONFIDENCE_POLICY
}) {
  const builtin = Boolean(builtinAgreement?.agrees);
  const crossKnownLineage = knownLineages.size >= policy.crossLineageRequiredKnownLineages;
  return {
    passed: Boolean(userVerified) || Boolean(official) || builtin || crossKnownLineage,
    userVerified: Boolean(userVerified),
    official: Boolean(official),
    builtinAgreement: builtin,
    crossKnownLineage,
    knownLineageCount: knownLineages.size,
    requiredKnownLineages: policy.crossLineageRequiredKnownLineages
  };
}
__name(trustQualityGateFromFlags, "trustQualityGateFromFlags");
function buildContextHints(profile) {
  const hints = [];
  const push = /* @__PURE__ */ __name((prefix, bucket) => {
    for (const [k, cell] of Object.entries(bucket)) {
      if (cell.strength > 0) hints.push(`${prefix}:${k}`);
    }
  }, "push");
  push("target", profile.targets);
  push("country", profile.countries);
  push("worldRegion", profile.worldRegions);
  push("language", profile.languages);
  return hints.sort();
}
__name(buildContextHints, "buildContextHints");
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
__name(clamp, "clamp");
var DERIVATION_POLICY_VERSION = 1;
var DERIVATION_POLICY = Object.freeze({
  version: DERIVATION_POLICY_VERSION,
  // §28.2:「Derived Score ≈ dependency Claim の保守的合成 × derivation reliability」
  composedReliability: 0.9,
  nativeConversionReliability: 0.75
});
function computeDerivedClaimScores(claim, dependencyClaims, {
  directEvidenceScore = 0,
  derivationPolicy = DERIVATION_POLICY,
  policy = CONFIDENCE_POLICY
} = {}) {
  if (!dependencyClaims.length) {
    return {
      truthStrength: directEvidenceScore,
      confidenceScore: directEvidenceScore,
      trustTier: TRUST_TIER.provisional,
      dependencyStale: false,
      dependencyConflicted: false
    };
  }
  const reliability = NATIVE_DERIVATION_KINDS.has(claim.derivation?.kind) ? derivationPolicy.nativeConversionReliability : derivationPolicy.composedReliability;
  const minDependencyTruth = Math.min(...dependencyClaims.map((c) => c.confidenceScore ?? 0));
  const dependencyConflicted = dependencyClaims.some((c) => c.conflictState === CONFLICT_STATE.conflicted);
  const dependencyStale = dependencyClaims.some((c) => c.revalidationState === "needed" || c.quarantined === true || c.scoreDirty === true);
  const truthStrength = clamp(
    Math.round(minDependencyTruth * reliability + directEvidenceScore),
    policy.scoreMin,
    policy.scoreMax
  );
  const tierRank = { [TRUST_TIER.provisional]: 0, [TRUST_TIER.learned]: 1, [TRUST_TIER.trusted]: 2 };
  const weakest = dependencyClaims.reduce((acc, c) => Math.min(acc, tierRank[c.trustTier] ?? 0), 2);
  const ownTier = truthStrength >= policy.trustedThreshold ? 2 : truthStrength >= policy.learnedThreshold ? 1 : 0;
  const rank = Math.min(weakest, ownTier);
  const trustTier = rank === 2 ? TRUST_TIER.trusted : rank === 1 ? TRUST_TIER.learned : TRUST_TIER.provisional;
  return {
    truthStrength,
    confidenceScore: truthStrength,
    trustTier,
    dependencyStale,
    dependencyConflicted,
    derivationReliability: reliability,
    minDependencyTruth
  };
}
__name(computeDerivedClaimScores, "computeDerivedClaimScores");
var CONTEXT_FIT_POLICY = Object.freeze({
  // §30.5:「language / role は推論の場合があるため Raw Country Fact と同じ重みで
  //  扱わない」
  dimensionWeight: Object.freeze({
    entityKey: 40,
    target: 20,
    country: 20,
    worldRegion: 10,
    language: 7,
    role: 3
  }),
  // §30.6:「Unknown Context は Mismatch ではない」— 加点も減点もしない
  unknownContextScore: 0,
  neutralBase: 30,
  max: 100
});
function evaluateHardConstraints(claim, context) {
  const c = claim.applicabilityConstraints;
  const dims = [
    ["entityKeys", context.entityKey],
    ["targets", context.target],
    ["countries", context.countryCode],
    ["worldRegions", context.worldRegionCode],
    ["locales", context.locale],
    ["languages", context.language],
    ["roles", context.role]
  ];
  for (const [dim, value] of dims) {
    const exclude = c?.exclude?.[dim] ?? [];
    if (value != null && exclude.includes(value)) {
      return { excluded: true, reason: `explicit_exclude:${dim}` };
    }
    const include = c?.include?.[dim] ?? [];
    if (include.length > 0) {
      if (value != null && !include.includes(value)) {
        return { excluded: true, reason: `explicit_include_mismatch:${dim}` };
      }
    }
  }
  return { excluded: false, reason: null };
}
__name(evaluateHardConstraints, "evaluateHardConstraints");
function calculateContextFit(claim, context, { policy = CONTEXT_FIT_POLICY } = {}) {
  const hard = evaluateHardConstraints(claim, context);
  if (hard.excluded) {
    return { fit: 0, eligible: false, reason: hard.reason, dimensions: {} };
  }
  const profile = claim.applicabilityProfile ?? {};
  const w = policy.dimensionWeight;
  const dimensions = {};
  let score = policy.neutralBase;
  const apply = /* @__PURE__ */ __name((name, bucket, value, weight) => {
    if (value == null) {
      dimensions[name] = { value: null, strength: null, unknown: true };
      return;
    }
    const cell = bucket?.[value];
    if (!cell) {
      dimensions[name] = { value, strength: 0, observed: false };
      return;
    }
    const delta = weight * cell.strength;
    score += delta;
    dimensions[name] = { value, strength: cell.strength, observed: true, delta: round3(delta) };
  }, "apply");
  if (context.entityKey && claim.subjectKey === `entity:${context.entityKey}`) {
    score += w.entityKey;
    dimensions.entityKey = { value: context.entityKey, exact: true, delta: w.entityKey };
  }
  apply("target", profile.targets, context.target ?? null, w.target);
  apply("country", profile.countries, context.countryCode ?? null, w.country);
  apply("worldRegion", profile.worldRegions, context.worldRegionCode ?? null, w.worldRegion);
  apply("language", profile.languages, context.language ?? null, w.language);
  apply("role", profile.roles, context.role ?? null, w.role);
  return {
    fit: clamp(Math.round(score), 0, policy.max),
    eligible: true,
    reason: null,
    dimensions
  };
}
__name(calculateContextFit, "calculateContextFit");
var MINIMUM_TRUTH_BY_MATCH_MODE = Object.freeze({
  entity_exact: 0,
  // §30.4.1:「eligible exact Entity manual/locked は User Control」
  exact: 12,
  alias_exact: 15,
  // §30.4.1:「folded / fuzzy は exact より高い Truth 条件を要求」
  folded: 25,
  fuzzy: 40
});
function truthEligibilityGate({
  claim,
  matchMode,
  minimums = MINIMUM_TRUTH_BY_MATCH_MODE
}) {
  const required = minimums[matchMode];
  if (required === void 0) {
    throw new ConfidenceError(`unknown matchMode: ${matchMode}`, { matchMode });
  }
  if (claim.locked === true && matchMode === "entity_exact") {
    return { eligible: true, reason: "locked_user_control", required, truthStrength: claim.confidenceScore ?? 0 };
  }
  const truth = claim.confidenceScore ?? 0;
  if (truth < required) {
    return {
      eligible: false,
      // §30.4.1:「Truth不足 → Context Fit だけで auto-accept へ押し上げない。
      //  Candidate として Trace には残し、AI再確認/Conflict/Unresolved へ」
      reason: "insufficient_truth",
      required,
      truthStrength: truth,
      disposition: "needs_ai_or_conflict"
    };
  }
  return { eligible: true, reason: "sufficient_truth", required, truthStrength: truth };
}
__name(truthEligibilityGate, "truthEligibilityGate");
function currentScoreInputVersions(meta, { registry = DEFAULT_MODEL_LINEAGE_REGISTRY } = {}) {
  return {
    confidencePolicyVersion: CONFIDENCE_POLICY_VERSION,
    scoreBuiltinDictionaryVersion: meta.builtinDictionaryVersion,
    scoreCountryProfileVersion: meta.countryProfileVersion,
    scoreCountryCanonicalizationVersion: meta.countryCanonicalizationVersion,
    scoreWorldRegionCanonicalizationVersion: meta.worldRegionCanonicalizationVersion,
    scoreModelLineageRegistryVersion: registry.modelLineageRegistryVersion,
    scoreContextHashSchemaVersion: meta.contextHashSchemaVersion,
    scoreLanguageInferenceVersion: meta.languageInferenceVersion,
    scoreDerivationPolicyVersion: DERIVATION_POLICY_VERSION
  };
}
__name(currentScoreInputVersions, "currentScoreInputVersions");
function isScoreStale(claim, versions) {
  if (claim.scoreDirty === true) return { stale: true, reason: "score_dirty" };
  for (const [field, current] of Object.entries(versions)) {
    if (claim[field] !== current) {
      return { stale: true, reason: `version_mismatch:${field}`, expected: current, got: claim[field] };
    }
  }
  return { stale: false, reason: null };
}
__name(isScoreStale, "isScoreStale");
async function recomputeClaimScore(db, claimId, {
  registry = DEFAULT_MODEL_LINEAGE_REGISTRY,
  builtinAgreement = null,
  policy = CONFIDENCE_POLICY,
  aggregation = AGGREGATION_POLICY,
  pageSize = void 0,
  snapshotRevision = void 0,
  now = Date.now(),
  invalidateCache = true,
  /**
   * §102.3.5 / §120-58: Package registry snapshot。省略時は DB から bounded に
   * 読む（Package が0件なら空 Map なので既存 Phase の挙動は1件も変わらない）。
   */
  packageEffect = void 0
} = {}) {
  const claim = await runRead(db, [STORE.claims], ({ store }) => requestOf3(store(STORE.claims).get(claimId)));
  if (!claim) throw new ConfidenceError(`recomputeClaimScore: claim not found: ${claimId}`, { claimId });
  const R = snapshotRevision !== void 0 ? snapshotRevision : claim.scoreInputRevision;
  const effectivePageSize = pageSize ?? aggregation.pageSize;
  const cacheLookupKeys = invalidateCache ? await getLookupKeysForClaim(claim) : null;
  const maxRoots = aggregation.circularityMaxRoots ?? 50;
  const rootSet = /* @__PURE__ */ new Set();
  let rootOverflow = false;
  const scanRoots = await streamEvidenceForClaim(db, claimId, (ev) => {
    if (!ev.evidenceRootId || rootSet.has(ev.evidenceRootId)) return;
    if (rootSet.size >= maxRoots) {
      rootOverflow = true;
      return;
    }
    rootSet.add(ev.evidenceRootId);
  }, { pageSize: effectivePageSize });
  const circularity = await analyzeConditioningCircularityFromRoots(
    db,
    claimId,
    { roots: [...rootSet], overflow: rootOverflow }
  );
  const effect = packageEffect ?? await readPackageEffectSnapshot(db);
  const agg = createClaimScoreAggregator({
    registry,
    circularity,
    builtinAgreement,
    policy,
    aggregation,
    packageEffect: effect
  });
  const scanScore = await streamEvidenceForClaim(
    db,
    claimId,
    (ev) => agg.add(ev),
    { pageSize: effectivePageSize }
  );
  const computed = agg.finalize();
  const meta = await runRead(db, [STORE.meta], ({ store }) => requestOf3(store(STORE.meta).get("meta")));
  const versions = currentScoreInputVersions(meta, { registry });
  let derivedNative = null;
  if (claim.derivation && NATIVE_DERIVATION_KINDS.has(claim.derivation.kind)) {
    const depIds = Array.isArray(claim.derivation.dependsOnClaimIds) ? claim.derivation.dependsOnClaimIds : [];
    const deps = await runRead(db, [STORE.claims], async ({ store }) => {
      const out = [];
      for (const id of depIds) {
        const rec = await requestOf3(store(STORE.claims).get(id));
        if (rec) out.push(rec);
      }
      return out;
    });
    derivedNative = computeDerivedClaimScores(claim, deps, {
      // §76.2:「AI Native Evidence を Japanese Display への別の独立AI票として
      //  二重加点しない」— derived_* の weight は 0 なので、ここへ native の
      //  Evidence は入ってこない。
      directEvidenceScore: computed.confidenceScore,
      policy
    });
  }
  const patch = {
    confidenceScore: derivedNative ? derivedNative.confidenceScore : computed.confidenceScore,
    trustTier: derivedNative ? derivedNative.trustTier : computed.trustTier,
    conflictState: derivedNative && derivedNative.dependencyConflicted ? CONFLICT_STATE.conflicted : computed.conflictState,
    applicabilityProfile: computed.applicabilityProfile,
    evidenceSummary: computed.evidenceSummary,
    contextHints: computed.contextHints,
    // §102.3.6: Soft 補正は confidenceScore と別 field（§139.21 Truth Gate 非迂回）
    packageSoftAdjust: computed.packageSoftAdjust ?? 0,
    ...versions
  };
  const extraStores = invalidateCache ? [STORE.cache] : [];
  const { result } = await runSemanticMutation(db, [STORE.claims], async ({ tx }) => {
    const patched = await patchClaimDerivedFields(tx, claimId, patch, {
      expectedScoreInputRevision: R,
      now
    });
    if (invalidateCache && patched.applied) await invalidateForClaimIn(tx, patched.record, cacheLookupKeys);
    return patched;
  }, { bumpRevision: false, extraStores });
  return {
    committed: !result.stale,
    stale: result.stale,
    snapshotRevision: R,
    claim: result.record,
    computed,
    derivedNative,
    circularityTruncated: circularity.truncated,
    evidenceTruncated: computed.evidenceSummary.evidenceTruncated,
    // bounded-memory instrumentation（§118.2 / §148.4 の検証用）
    aggregation: {
      pageSize: effectivePageSize,
      scannedRootPass: scanRoots.scanned,
      scannedScorePass: scanScore.scanned,
      pages: scanScore.pages,
      maxPageBuffer: Math.max(scanRoots.maxPageBuffer, scanScore.maxPageBuffer),
      state: agg.state()
    }
  };
}
__name(recomputeClaimScore, "recomputeClaimScore");
function requestOf3(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf3, "requestOf");

// dictionary-rejections.js
var REJECTION_STATE = Object.freeze({
  active: "active",
  superseded: "superseded"
});
var REJECTION_REASON = Object.freeze({
  userCorrection: "user_correction",
  manualRemoval: "manual_removal",
  importConflict: "import_conflict",
  doctorRepair: "doctor_repair",
  /**
   * §102.2 Phase 9B:「Portable Rejection を Import しただけで Local User Correction と
   *  同じ Lock 強度へ昇格させない」。reason を分けることで、Rejection Import Policy が
   *  Provenance/Context を再評価できる（user_correction と混同しない）。
   */
  portableImport: "portable_import"
});
var CONTEXT_DIMENSIONS = Object.freeze([
  "entityKeys",
  "targets",
  "countries",
  "worldRegions",
  "locales",
  "languages",
  "roles"
]);
var AUTO_PROMOTABLE_DIMENSIONS = Object.freeze(["entityKeys", "targets", "countries", "worldRegions"]);
var INFERENCE_DIMENSIONS = Object.freeze(["languages", "roles", "locales"]);
var RejectionError = class extends Error {
  static {
    __name(this, "RejectionError");
  }
  constructor(message, details) {
    super(message);
    this.name = "RejectionError";
    this.details = details;
  }
};
function emptyContextConstraints() {
  const side = /* @__PURE__ */ __name(() => Object.fromEntries(CONTEXT_DIMENSIONS.map((d) => [d, []])), "side");
  return { include: side(), exclude: side() };
}
__name(emptyContextConstraints, "emptyContextConstraints");
function normalizeContextConstraints(input) {
  const out = emptyContextConstraints();
  for (const side of ["include", "exclude"]) {
    for (const dim of CONTEXT_DIMENSIONS) {
      const v = input?.[side]?.[dim];
      if (v == null) continue;
      if (!Array.isArray(v)) throw new RejectionError(`contextConstraints.${side}.${dim} must be an array`, { dim });
      out[side][dim] = [...v];
    }
  }
  return out;
}
__name(normalizeContextConstraints, "normalizeContextConstraints");
function assertNoAutoPromotedInference(constraints, { explicitDimensions = [] } = {}) {
  const explicit = new Set(explicitDimensions);
  for (const side of ["include", "exclude"]) {
    for (const dim of INFERENCE_DIMENSIONS) {
      if ((constraints[side]?.[dim] ?? []).length > 0 && !explicit.has(dim)) {
        throw new RejectionError(
          `§38.0: inferred dimension "${dim}" must not be auto-promoted into a hard Rejection constraint. Keep it in the Correction Evidence inference snapshot.`,
          { side, dim }
        );
      }
    }
  }
  return true;
}
__name(assertNoAutoPromotedInference, "assertNoAutoPromotedInference");
async function contextConstraintSignature(constraints) {
  const c = normalizeContextConstraints(constraints);
  return stableHash({
    schema: "rejection-context-constraints",
    version: KEY_SCHEMA_VERSION,
    include: c.include,
    exclude: c.exclude
  });
}
__name(contextConstraintSignature, "contextConstraintSignature");
async function computeRejectionKey({
  claimGroupKey: claimGroupKey2,
  valueType,
  script = null,
  normalizedRejectedValue,
  contextConstraints
}) {
  const signature = await contextConstraintSignature(contextConstraints ?? emptyContextConstraints());
  return rejectionKey({
    claimGroupKey: claimGroupKey2,
    valueType,
    script,
    normalizedRejectedValue,
    contextConstraintSignature: signature
  });
}
__name(computeRejectionKey, "computeRejectionKey");
async function buildRejectionRecord({
  claimGroupKey: claimGroupKey2,
  valueType,
  script = null,
  rejectedValue,
  contextConstraints = null,
  explicitDimensions = [],
  replacementClaimId = null,
  sourceEvidenceId = null,
  reason = REJECTION_REASON.userCorrection,
  originRecordKey: originRecordKey2 = null,
  now = Date.now()
}) {
  if (typeof claimGroupKey2 !== "string" || !claimGroupKey2) {
    throw new RejectionError("claimGroupKey is required (§38.0: identity is not just the value string)", {});
  }
  if (script !== null && !SCRIPT_ENUM.includes(script)) {
    throw new RejectionError(`unknown script: ${script}`, { script });
  }
  const normalized = normalizeClaimValue(valueType, rejectedValue, script);
  const constraints = normalizeContextConstraints(contextConstraints ?? {});
  assertNoAutoPromotedInference(constraints, { explicitDimensions });
  const key = await computeRejectionKey({
    claimGroupKey: claimGroupKey2,
    valueType,
    script,
    normalizedRejectedValue: normalized.normalizedValue,
    contextConstraints: constraints
  });
  return {
    rejectionId: newOpaqueId("rej"),
    rejectionKey: key,
    keySchemaVersion: KEY_SCHEMA_VERSION,
    claimGroupKey: claimGroupKey2,
    valueType,
    script,
    rejectedValue: normalized.value,
    normalizedRejectedValue: normalized.normalizedValue,
    valueNormalizerVersion: VALUE_NORMALIZER_VERSION,
    contextConstraints: constraints,
    replacementClaimId,
    sourceEvidenceId,
    reason,
    state: REJECTION_STATE.active,
    originRecordKey: originRecordKey2,
    supersededByRejectionId: null,
    invalidatedAt: null,
    createdAt: now
  };
}
__name(buildRejectionRecord, "buildRejectionRecord");
var REJECTION_COLLECTION_POLICY = Object.freeze({
  pageSize: 100,
  maxRecords: 500
});
async function findActiveRejections(db, claimGroupKey2, {
  pageSize = REJECTION_COLLECTION_POLICY.pageSize,
  maxRecords = REJECTION_COLLECTION_POLICY.maxRecords
} = {}) {
  const items = [];
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.rejections,
      indexName: "claimGroupKey",
      query: cursor ? void 0 : IDBKeyRange.only(claimGroupKey2),
      limit: pageSize,
      cursor
    });
    for (const r of page.items) {
      if (r.state !== REJECTION_STATE.active) continue;
      if (items.length >= maxRecords) {
        truncated = true;
        break;
      }
      items.push(r);
    }
    if (truncated || page.done) break;
    cursor = page.nextCursor;
  }
  return { items, truncated };
}
__name(findActiveRejections, "findActiveRejections");
function rejectionAppliesToContext(rejection, context) {
  if (rejection.state !== REJECTION_STATE.active) return false;
  const c = rejection.contextConstraints ?? emptyContextConstraints();
  const dims = [
    ["entityKeys", context.entityKey],
    ["targets", context.target],
    ["countries", context.countryCode],
    ["worldRegions", context.worldRegionCode],
    ["locales", context.locale],
    ["languages", context.language],
    ["roles", context.role]
  ];
  for (const [dim, value] of dims) {
    const exclude = c.exclude?.[dim] ?? [];
    if (value != null && exclude.includes(value)) return false;
    const include = c.include?.[dim] ?? [];
    if (include.length === 0) continue;
    if (value == null) return false;
    if (!include.includes(value)) return false;
  }
  return true;
}
__name(rejectionAppliesToContext, "rejectionAppliesToContext");

export {
  __name,
  KEY_SCHEMA_VERSION,
  ID_PREFIXES,
  newOpaqueId,
  stableSerialize,
  stableHash,
  entityKey,
  entitySubjectKey,
  lexicalSubjectKey,
  phraseSubjectKey,
  claimGroupKey,
  semanticKey,
  edgeKey,
  INPUT_FINGERPRINT_VERSION,
  builtinContentFingerprint,
  exactLookupKey,
  foldedLookupKey,
  aliasLookupKeyExact,
  aliasLookupKeyFolded,
  originRecordKey,
  RESOLUTION_POLICY_FIELDS,
  resolutionPolicyFingerprint,
  LINEAGE_CLASSIFICATION,
  DEFAULT_MODEL_LINEAGE_REGISTRY,
  resolveEvidenceLineage,
  composeResolution,
  PARSER_VERSION,
  VALUE_NORMALIZER_VERSION,
  BUILTIN_DICTIONARY_VERSION,
  effectivePolicyMeta,
  STORE,
  ROLE_ENUM,
  SCRIPT_ENUM,
  VALUE_TYPE_POLICIES,
  validateClaimValue,
  BACKUP_META_WHITELIST,
  BACKUP_EXCLUDED_STORES,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  OWNER_TOKEN,
  LEASE_POLICY,
  openDictionaryDB,
  getMeta,
  runSemanticMutation,
  runRead,
  upsertClaimBySemanticKey,
  upsertEvidenceByDedupeKey,
  upsertRejectionByKey,
  upsertPackageByPackageId,
  patchClaimExplicitState,
  patchClaimQuarantineState,
  patchClaimReviewQueueState,
  patchClaimRevalidationState,
  markClaimScoreInputChanged,
  iterateIndex,
  iterateEvidenceForClaim,
  forEachChunk,
  LeaseError,
  acquireMaintenanceLease,
  renewMaintenanceLease,
  releaseMaintenanceLease,
  RESTORE_MARKER_META_KEY,
  MERGE_MARKER_META_KEY,
  dictionaryMaintenanceState,
  acquireJobLease,
  releaseJobLease,
  assertJobFence,
  createBroadcast,
  BACKUP_MODE,
  BackupConsistencyError,
  parseLegacyDictionaryJson,
  classifyLegacyRecordValue,
  clearResolutionCacheIn,
  clearResolutionCache,
  SOURCE_NORMALIZER_VERSION,
  strictNormalizedSource,
  foldedNormalizedSource,
  normalizeClaimValue,
  isKnownTarget,
  legacyLookupKey,
  isLegacyReachableSourceKey,
  parseSourceName,
  legacyWordUnits,
  lexicalTokens,
  classifyLegacySourceKind,
  SOURCE_NAME_FINGERPRINT_VERSION,
  GUARD_MODE,
  MINOR_CHANGE_POLICY,
  computeSourceNameFingerprint,
  buildSourceNameGuard,
  evaluateSourceNameGuard,
  RELATION,
  RELATION_TYPE_POLICIES,
  collectDependents,
  HISTORY_ACTION,
  buildHistoryRecord,
  addHistory,
  iterateHistoryForNode,
  computeResolutionContextKey,
  computeInputFingerprint,
  computeResolutionPolicyFingerprint,
  computeResolutionKey,
  getLookupKeysForClaim,
  invalidateForClaimIn,
  invalidateForRejectionIn,
  readValidatedResolutionCache,
  maybePersistResolution,
  SUBJECT_KIND,
  TRUST_TIER,
  CONFLICT_STATE,
  REVALIDATION_STATE,
  LIFECYCLE_STATE,
  VERIFICATION_STATE,
  VERIFICATION_PRECEDENCE,
  emptyApplicabilityConstraints,
  normalizeApplicabilityConstraints,
  emptyApplicabilityProfile,
  evaluateClaimEligibility,
  buildClaimRecord,
  upsertClaim,
  prepareClaimUpsert,
  commitClaimUpsertIn,
  isManualAuthorityClaim,
  replaceClaimSemantics,
  getClaim,
  findClaimsBySubject,
  findClaimsBySubjectAndValueType,
  findClaimsByGroup,
  findClaimsByNormalizedSource,
  findAliasClaimsByNormalizedValue,
  findAliasClaimsByFoldedValue,
  findClaimsByFoldedSource,
  patchClaimExplicit,
  EVIDENCE_TYPE,
  STANCE,
  COMMIT_DISPOSITION,
  isMutationId,
  assertMutationId,
  buildContextSnapshot,
  computeContextHash,
  buildEvidenceDedupeKey,
  buildEvidenceRecord,
  recordEvidence,
  prepareEvidenceWrite,
  commitEvidenceIn,
  isDecisionAffecting,
  collectEvidenceForClaim,
  calculateContextFit,
  truthEligibilityGate,
  currentScoreInputVersions,
  isScoreStale,
  recomputeClaimScore,
  REJECTION_STATE,
  REJECTION_REASON,
  AUTO_PROMOTABLE_DIMENSIONS,
  emptyContextConstraints,
  normalizeContextConstraints,
  buildRejectionRecord,
  findActiveRejections,
  rejectionAppliesToContext
};
