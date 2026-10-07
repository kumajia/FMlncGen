import {
  INPUT_FINGERPRINT_VERSION,
  RESOLUTION_POLICY_FIELDS,
  SOURCE_NAME_FINGERPRINT_VERSION,
  VERIFICATION_PRECEDENCE,
  __name,
  aliasLookupKeyExact,
  aliasLookupKeyFolded,
  builtinContentFingerprint,
  calculateContextFit,
  composeResolution,
  computeInputFingerprint,
  computeResolutionContextKey,
  computeResolutionKey,
  computeResolutionPolicyFingerprint,
  computeSourceNameFingerprint,
  currentScoreInputVersions,
  dictionaryMaintenanceState,
  effectivePolicyMeta,
  emptyApplicabilityConstraints,
  emptyApplicabilityProfile,
  entityKey,
  entitySubjectKey,
  evaluateClaimEligibility,
  evaluateSourceNameGuard,
  exactLookupKey,
  findActiveRejections,
  findAliasClaimsByFoldedValue,
  findAliasClaimsByNormalizedValue,
  findClaimsByFoldedSource,
  findClaimsByNormalizedSource,
  findClaimsBySubject,
  foldedLookupKey,
  foldedNormalizedSource,
  getMeta,
  isScoreStale,
  legacyLookupKey,
  legacyWordUnits,
  lexicalSubjectKey,
  lexicalTokens,
  maybePersistResolution,
  parseSourceName,
  phraseSubjectKey,
  readValidatedResolutionCache,
  recomputeClaimScore,
  rejectionAppliesToContext,
  strictNormalizedSource,
  truthEligibilityGate
} from "./shared-dictionary-core.js";

// dictionary-candidates.js
var MATCH_MODE = Object.freeze({
  entityExact: "entity_exact",
  exact: "exact",
  aliasExact: "alias_exact",
  aliasFolded: "alias_folded",
  phrase: "phrase",
  lex: "lex",
  folded: "folded",
  builtinExact: "builtin_exact",
  builtinFolded: "builtin_folded"
});
var BUILTIN_VIRTUAL_POLICY = Object.freeze({
  confidenceScore: 30,
  trustTier: "learned"
});
async function generateEntityCandidates(db, { target, fmId }) {
  const subjectKey = entitySubjectKey(target, fmId);
  const attemptedLookupKeys = [subjectKey];
  const page = await findClaimsBySubject(db, subjectKey, { limit: 200 });
  const candidates = page.items.map((claim) => toCandidate(claim, MATCH_MODE.entityExact));
  return { candidates, attemptedLookupKeys, hit: page.items.length > 0 };
}
__name(generateEntityCandidates, "generateEntityCandidates");
async function generateSpanCandidates(db, {
  spanText,
  tokenCount,
  isFullSpan = false,
  requestedValueTypes = ["japanese_display"],
  builtinIndex = null
}) {
  const strict = strictNormalizedSource(spanText);
  const folded = foldedNormalizedSource(spanText);
  const attemptedLookupKeys = [];
  const candidates = [];
  const seenClaimIds = /* @__PURE__ */ new Set();
  const pushClaims = /* @__PURE__ */ __name((claims, matchMode) => {
    for (const c of claims) {
      if (seenClaimIds.has(c.claimId)) continue;
      seenClaimIds.add(c.claimId);
      candidates.push(toCandidate(c, matchMode));
    }
  }, "pushClaims");
  const subjectKey = tokenCount <= 1 ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
  attemptedLookupKeys.push(subjectKey);
  const subjectPage = await findClaimsBySubject(db, subjectKey, { limit: 200 });
  pushClaims(subjectPage.items, tokenCount <= 1 ? MATCH_MODE.lex : MATCH_MODE.phrase);
  if (isFullSpan) {
    const exactKey = await exactLookupKey(strict);
    attemptedLookupKeys.push(exactKey);
    for (const vt of requestedValueTypes) {
      const page = await findClaimsByNormalizedSource(db, strict, vt, { limit: 50 });
      pushClaims(page.items, MATCH_MODE.exact);
    }
  }
  const aliasExactKey = await aliasLookupKeyExact(strict);
  attemptedLookupKeys.push(aliasExactKey);
  const aliasExactPage = await findAliasClaimsByNormalizedValue(db, strict, { limit: 50 });
  let aliasHit = aliasExactPage.items.length > 0;
  for (const aliasClaim of aliasExactPage.items) {
    const targetPage = await findClaimsBySubject(db, aliasClaim.subjectKey, { limit: 50 });
    pushClaims(targetPage.items, MATCH_MODE.aliasExact);
  }
  if (!aliasHit) {
    const aliasFoldKey = await aliasLookupKeyFolded(folded);
    attemptedLookupKeys.push(aliasFoldKey);
    const aliasFoldPage = await findAliasClaimsByFoldedValue(db, folded, { limit: 50 });
    aliasHit = aliasFoldPage.items.length > 0;
    for (const aliasClaim of aliasFoldPage.items) {
      const targetPage = await findClaimsBySubject(db, aliasClaim.subjectKey, { limit: 50 });
      pushClaims(targetPage.items, MATCH_MODE.aliasFolded);
    }
  }
  if (subjectPage.items.length === 0 && folded !== strict) {
    const foldKey = await foldedLookupKey(folded);
    attemptedLookupKeys.push(foldKey);
    const foldPage = await findClaimsByFoldedSource(db, folded, { limit: 50 });
    const matchingKind = tokenCount <= 1 ? "lexical" : "phrase";
    pushClaims(foldPage.items.filter((c) => c.subjectKind === matchingKind), MATCH_MODE.folded);
  }
  if (builtinIndex) {
    const { hits, matchedBy } = builtinIndex.lookup(spanText);
    const matchMode = matchedBy === "normalized_source" ? MATCH_MODE.builtinExact : MATCH_MODE.builtinFolded;
    for (const synthetic of hits) {
      if (tokenCount <= 1 ? synthetic.subjectKind !== "lexical" : synthetic.subjectKind !== "phrase") continue;
      candidates.push(toBuiltinCandidate(synthetic, matchMode));
    }
  }
  return { candidates, attemptedLookupKeys, subjectKey };
}
__name(generateSpanCandidates, "generateSpanCandidates");
function toCandidate(claim, matchMode) {
  return {
    source: "user",
    matchMode,
    claimId: claim.claimId,
    claim,
    subjectKind: claim.subjectKind,
    subjectKey: claim.subjectKey,
    claimGroupKey: claim.claimGroupKey,
    valueType: claim.valueType,
    value: claim.value,
    normalizedValue: claim.normalizedValue,
    script: claim.script,
    confidenceScore: claim.confidenceScore,
    trustTier: claim.trustTier,
    locked: claim.locked === true,
    verificationState: claim.verificationState
  };
}
__name(toCandidate, "toCandidate");
function toBuiltinCandidate(synthetic, matchMode) {
  return {
    source: "builtin",
    matchMode,
    claimId: synthetic.syntheticId,
    claim: {
      ...synthetic,
      claimId: synthetic.syntheticId,
      locked: false,
      disabled: false,
      deletedAt: null,
      quarantined: false,
      supersededByClaimId: null,
      lifecycleState: "active",
      conflictState: "clean",
      scoreDirty: false,
      confidenceScore: BUILTIN_VIRTUAL_POLICY.confidenceScore,
      trustTier: BUILTIN_VIRTUAL_POLICY.trustTier,
      applicabilityConstraints: emptyApplicabilityConstraints(),
      applicabilityProfile: emptyApplicabilityProfile()
    },
    subjectKind: synthetic.subjectKind,
    subjectKey: synthetic.subjectKey,
    claimGroupKey: synthetic.claimGroupKey,
    valueType: synthetic.valueType,
    value: synthetic.value,
    normalizedValue: synthetic.normalizedValue,
    script: synthetic.script,
    confidenceScore: BUILTIN_VIRTUAL_POLICY.confidenceScore,
    trustTier: BUILTIN_VIRTUAL_POLICY.trustTier,
    locked: false,
    verificationState: "none",
    candidateFingerprint: synthetic.candidateFingerprint
  };
}
__name(toBuiltinCandidate, "toBuiltinCandidate");
function aggregateCandidates(candidates) {
  const groups = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    const key = [c.subjectKey, c.valueType, c.script ?? "", c.normalizedValue].join(" ");
    if (!groups.has(key)) {
      groups.set(key, {
        subjectKind: c.subjectKind,
        subjectKey: c.subjectKey,
        claimGroupKey: c.claimGroupKey,
        valueType: c.valueType,
        value: c.value,
        normalizedValue: c.normalizedValue,
        script: c.script,
        members: []
      });
    }
    groups.get(key).members.push(c);
  }
  return [...groups.values()];
}
__name(aggregateCandidates, "aggregateCandidates");

// dictionary-resolver.js
var RESOLVER_POLICY = Object.freeze({
  /** §17:「Close Scoreで意味のある差がない場合、conflicted を返す」。 */
  closeScoreEpsilon: 6,
  /** §71 multi/multi_weighted系はConflict対象外。 */
  competingCardinalityValueTypes: /* @__PURE__ */ new Set([
    "japanese_display",
    "japanese_reading",
    "short_display",
    "club_3letter_display",
    "club_6letter_display",
    "render_mode",
    "atomicity",
    "native_form"
  ])
});
var EXACTNESS_RANK = Object.freeze({
  entity_exact: 100,
  exact: 90,
  alias_exact: 80,
  phrase: 70,
  lex: 70,
  alias_folded: 55,
  folded: 40,
  builtin_exact: 60,
  builtin_folded: 35
});
var TRUTH_GATE_MATCH_MODE = Object.freeze({
  entity_exact: "entity_exact",
  exact: "exact",
  alias_exact: "alias_exact",
  alias_folded: "folded",
  phrase: "exact",
  lex: "exact",
  folded: "folded",
  builtin_exact: "exact",
  builtin_folded: "folded"
});
async function recomputeStaleCandidates(db, candidates, { meta = null } = {}) {
  const currentMeta = meta ?? await getMeta(db);
  const versions = currentScoreInputVersions(currentMeta);
  const staleIds = /* @__PURE__ */ new Set();
  for (const c of candidates) {
    if (c.source !== "user") continue;
    const { stale } = isScoreStale(c.claim, versions);
    if (stale) staleIds.add(c.claimId);
  }
  const recomputed = /* @__PURE__ */ new Map();
  for (const id of staleIds) {
    const r = await recomputeClaimScore(db, id, { invalidateCache: true });
    recomputed.set(id, r.claim);
  }
  if (recomputed.size === 0) return candidates;
  return candidates.map((c) => recomputed.has(c.claimId) ? {
    ...c,
    claim: recomputed.get(c.claimId),
    confidenceScore: recomputed.get(c.claimId).confidenceScore,
    trustTier: recomputed.get(c.claimId).trustTier
  } : c);
}
__name(recomputeStaleCandidates, "recomputeStaleCandidates");
async function applyHardRules(db, candidates, context, sourceText = void 0) {
  const eligible = [];
  const filtered = [];
  const rejectionsByGroup = /* @__PURE__ */ new Map();
  for (const c of candidates) {
    if (c.source !== "user") continue;
    if (rejectionsByGroup.has(c.claimGroupKey)) continue;
    const { items } = await findActiveRejections(db, c.claimGroupKey);
    rejectionsByGroup.set(c.claimGroupKey, items);
  }
  for (const c of candidates) {
    if (c.source === "builtin") {
      eligible.push(c);
      continue;
    }
    const claim = c.claim;
    const elig = evaluateClaimEligibility(claim);
    if (!elig.eligible) {
      filtered.push({ ...c, filterReason: elig.reason });
      continue;
    }
    const rejections = rejectionsByGroup.get(c.claimGroupKey) ?? [];
    const rejected = rejections.some((r) => rejectionAppliesToContext(r, context));
    if (rejected) {
      filtered.push({ ...c, filterReason: "context_rejection" });
      continue;
    }
    if (claim.subjectKind === "entity" && context.target) {
      const embeddedTarget = claim.subjectKey.split(":")[1];
      if (embeddedTarget !== context.target) {
        filtered.push({ ...c, filterReason: "target_mismatch" });
        continue;
      }
    }
    if (claim.subjectKind === "entity" && claim.sourceNameGuard && typeof sourceText === "string") {
      const currentNormalizedName = strictNormalizedSource(sourceText);
      const isManualOrLocked = claim.locked === true || ["manual_entered", "manual_corrected", "official"].includes(claim.verificationState);
      const guardResult = evaluateSourceNameGuard({
        guard: claim.sourceNameGuard,
        currentNormalizedName,
        target: context.target,
        isManualOrLocked,
        aliasResolver: null
      });
      if (!guardResult.eligible) {
        filtered.push({ ...c, filterReason: `source_name_guard_mismatch:${guardResult.reason}` });
        continue;
      }
    }
    eligible.push({ ...c, dormant: elig.reason === "dormant", dormantPenalty: elig.penalty });
  }
  return { eligible, filtered };
}
__name(applyHardRules, "applyHardRules");
function evaluateTruthAndContextFit(candidates, context) {
  const passed = [];
  const rejected = [];
  for (const c of candidates) {
    const matchMode = TRUTH_GATE_MATCH_MODE[c.matchMode] ?? "folded";
    const gate = truthEligibilityGate({ claim: c.claim, matchMode });
    if (!gate.eligible) {
      rejected.push({ ...c, filterReason: "insufficient_truth", gate });
      continue;
    }
    const fit = calculateContextFit(c.claim, context);
    if (!fit.eligible) {
      rejected.push({ ...c, filterReason: fit.reason ?? "context_hard_exclude", fit });
      continue;
    }
    passed.push({ ...c, truthGate: gate, contextFit: fit.fit });
  }
  return { passed, rejected };
}
__name(evaluateTruthAndContextFit, "evaluateTruthAndContextFit");
function stableSemanticKey(c) {
  return c.candidateFingerprint ?? [c.subjectKey, c.valueType, c.script ?? "", c.normalizedValue].join(" ");
}
__name(stableSemanticKey, "stableSemanticKey");
function compareCandidates(a, b) {
  const av = VERIFICATION_PRECEDENCE.indexOf(a.claim.verificationState ?? "none");
  const bv = VERIFICATION_PRECEDENCE.indexOf(b.claim.verificationState ?? "none");
  if (av !== bv) return av - bv;
  const al = a.locked ? 1 : 0;
  const bl = b.locked ? 1 : 0;
  if (al !== bl) return bl - al;
  const ae = EXACTNESS_RANK[a.matchMode] ?? 0;
  const be = EXACTNESS_RANK[b.matchMode] ?? 0;
  if (ae !== be) return be - ae;
  const ac = a.confidenceScore ?? 0;
  const bc = b.confidenceScore ?? 0;
  if (ac !== bc) return bc - ac;
  const af = a.contextFit ?? 0;
  const bf = b.contextFit ?? 0;
  if (af !== bf) return bf - af;
  const ar = a.claim.evidenceSummary?.actualGenerationRoots ?? 0;
  const br = b.claim.evidenceSummary?.actualGenerationRoots ?? 0;
  if (ar !== br) return br - ar;
  const ak = stableSemanticKey(a);
  const bk = stableSemanticKey(b);
  if (ak !== bk) return ak < bk ? -1 : 1;
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0;
}
__name(compareCandidates, "compareCandidates");
function tierRank(c) {
  const av = VERIFICATION_PRECEDENCE.indexOf(c.claim.verificationState ?? "none");
  return [av, c.locked ? 0 : 1, -(EXACTNESS_RANK[c.matchMode] ?? 0)];
}
__name(tierRank, "tierRank");
function tiersEqual(a, b) {
  const ta = tierRank(a);
  const tb = tierRank(b);
  return ta.every((v, i) => v === tb[i]);
}
__name(tiersEqual, "tiersEqual");
function detectConflict(sortedGroup, { epsilon = RESOLVER_POLICY.closeScoreEpsilon } = {}) {
  if (sortedGroup.length < 2) return null;
  const [top, second] = sortedGroup;
  if (top.normalizedValue === second.normalizedValue) return null;
  const bothLocked = top.locked && second.locked;
  if (bothLocked) {
    return {
      type: "multiple_locked_claims",
      claimIds: [top.claimId, second.claimId]
    };
  }
  const scoreClose = Math.abs((top.confidenceScore ?? 0) - (second.confidenceScore ?? 0)) <= epsilon;
  const fitClose = Math.abs((top.contextFit ?? 0) - (second.contextFit ?? 0)) <= epsilon;
  if (tiersEqual(top, second) && scoreClose && fitClose) {
    return {
      type: "close_candidates",
      claimIds: [top.claimId, second.claimId]
    };
  }
  return null;
}
__name(detectConflict, "detectConflict");
function buildAggregatedRepresentative(group) {
  const sortedMembers = [...group.members].sort(compareCandidates);
  const primary = sortedMembers[0];
  const maxConfidence = Math.max(...group.members.map((m) => m.confidenceScore ?? 0));
  const maxContextFit = Math.max(...group.members.map((m) => m.contextFit ?? 0));
  return {
    ...primary,
    confidenceScore: maxConfidence,
    contextFit: maxContextFit,
    aggregatedMemberIds: group.members.map((m) => m.claimId),
    aggregatedFromMultipleSources: group.members.length > 1
  };
}
__name(buildAggregatedRepresentative, "buildAggregatedRepresentative");
function aggregatePassedCandidates(passed) {
  return aggregateCandidates(passed).map(buildAggregatedRepresentative);
}
__name(aggregatePassedCandidates, "aggregatePassedCandidates");
async function evaluateCandidateGroup(db, rawCandidates, context, {
  meta = null,
  attemptedLookupKeys = [],
  sourceText = void 0
} = {}) {
  const reasons = [];
  if (rawCandidates.length === 0) {
    return {
      resolutionState: "unresolved",
      chosen: null,
      candidateIds: [],
      filteredCandidateIds: [],
      attemptedLookupKeys,
      reasons: ["no_candidates"],
      resolutionConflict: null,
      quality: 0
    };
  }
  const withFreshScores = await recomputeStaleCandidates(db, rawCandidates, { meta });
  const { eligible, filtered } = await applyHardRules(db, withFreshScores, context, sourceText);
  const { passed, rejected } = evaluateTruthAndContextFit(eligible, context);
  const allFiltered = [
    ...filtered.map((c) => ({ claimId: c.claimId, reason: c.filterReason })),
    ...rejected.map((c) => ({ claimId: c.claimId, reason: c.filterReason }))
  ];
  if (passed.length === 0) {
    reasons.push(rawCandidates.length > 0 ? "all_candidates_filtered" : "no_candidates");
    return {
      resolutionState: "unresolved",
      chosen: null,
      candidateIds: rawCandidates.map((c) => c.claimId),
      filteredCandidateIds: allFiltered,
      attemptedLookupKeys,
      reasons,
      resolutionConflict: null,
      quality: 0
    };
  }
  const aggregated = aggregatePassedCandidates(passed);
  const sorted = [...aggregated].sort(compareCandidates);
  const conflict = detectConflict(sorted);
  if (conflict) {
    reasons.push(conflict.type);
    return {
      resolutionState: "conflicted",
      chosen: null,
      candidateIds: passed.map((c) => c.claimId),
      filteredCandidateIds: allFiltered,
      attemptedLookupKeys,
      reasons,
      resolutionConflict: conflict,
      // Conflict中でもDPスコアリングは進める必要があるため、上位候補のqualityを渡す。
      quality: candidateQuality(sorted[0])
    };
  }
  const chosen = sorted[0];
  reasons.push(`chosen_via:${chosen.matchMode}`);
  return {
    resolutionState: "resolved",
    chosen,
    candidateIds: passed.map((c) => c.claimId),
    filteredCandidateIds: allFiltered,
    attemptedLookupKeys,
    reasons,
    resolutionConflict: null,
    quality: candidateQuality(chosen)
  };
}
__name(evaluateCandidateGroup, "evaluateCandidateGroup");
function candidateQuality(c) {
  const exactness = EXACTNESS_RANK[c.matchMode] ?? 0;
  const confidence = c.confidenceScore ?? 0;
  const fit = c.contextFit ?? 30;
  return exactness * 0.5 + confidence * 0.4 + fit * 0.1;
}
__name(candidateQuality, "candidateQuality");

// dictionary-segmentation.js
var SEGMENTATION_POLICY = Object.freeze({
  /** §68.1:「Unknown coverageを強く減点」。tokenあたりの減点。 */
  unknownPenaltyPerToken: 30,
  /**
   * §61.1: `render_mode = preserve` の Segment（既存 PREFIXES Adapter が付ける
   * `club_prefix`）は「翻訳Claimが無い」が「Unknown」でもない。canonical prefix
   * 形で出すことが正しい描画である、という構造的に既知な span。
   *
   * B-4: preserve は **Hard Rule**（§70）であり Claim との Soft 競争はしない。
   * したがってこの値は「Claim に勝つ/負ける」ためのものではなく、preserve span を
   * unknown (-30/token) より明確に良いものとして DP へ載せるためだけの quality。
   * prefix token に対しては Candidate をそもそも生成しないので、この値が実 Claim
   * と比較されることはない。
   */
  preserveScorePerToken: 20,
  /** §68.1:「同等なら少ないSegment数を優先」。 */
  segmentFixedPenalty: 1,
  /** §68.1:「長いExact Phraseはbonusを持てるが低信頼なら絶対優先しない」
   *  → trusted/manual/lockedなSpanにだけ、token間の gap ごとに加点。 */
  spanGapBonusPerGap: 2,
  /** §69:「trusted/manual atomicity=true → 強いsplit penalty / 原則1 unit」。 */
  atomicityTrustedBonus: 40,
  /** §69:「provisional atomicity=true → bonus程度」。 */
  atomicityProvisionalBonus: 8,
  /** §89.2 既定 Phrase Span 上限（`dictionary_meta.maxPhraseTokensByTarget` が
   *  無い/target未知の場合のfallback）。 */
  defaultMaxSpanTokens: 6
});
function isPreserveToken(token) {
  return token?.renderMode === "preserve";
}
__name(isPreserveToken, "isPreserveToken");
function spanPreserveKind(tokens, i, j) {
  let anyPreserve = false;
  let anyPlain = false;
  for (let k = i; k < j; k++) {
    if (isPreserveToken(tokens[k])) anyPreserve = true;
    else anyPlain = true;
  }
  if (anyPreserve && anyPlain) return "mixed";
  return anyPreserve ? "preserve" : "plain";
}
__name(spanPreserveKind, "spanPreserveKind");
function preservedEvalResult(policy, kind) {
  return {
    resolutionState: "resolved",
    chosen: null,
    candidateIds: [],
    filteredCandidateIds: [],
    attemptedLookupKeys: [],
    reasons: [`preserved_render_mode:${kind}`],
    resolutionConflict: null,
    quality: policy.preserveScorePerToken,
    preserved: true,
    preserveReason: `${kind}_render_preserve`
  };
}
__name(preservedEvalResult, "preservedEvalResult");
function preserveKindOf(tokens, i, j) {
  for (let k = i; k < j; k++) {
    if (tokens[k]?.initialRole === "club_prefix") return "club_prefix";
  }
  return "legacy_prefix";
}
__name(preserveKindOf, "preserveKindOf");
function isTrustedCandidate(c) {
  if (!c) return false;
  if (c.locked === true) return true;
  const v = c.claim?.verificationState;
  if (v === "manual_entered" || v === "manual_corrected" || v === "official") return true;
  return c.trustTier === "trusted";
}
__name(isTrustedCandidate, "isTrustedCandidate");
async function computeAtomicityBonus(db, spanCandidates, context, policy) {
  const atomCandidates = spanCandidates.filter((c) => c.valueType === "atomicity");
  if (atomCandidates.length === 0) return { bonus: 0, trusted: false };
  const { eligible } = await applyHardRules(db, atomCandidates, context);
  const trueClaims = eligible.filter((c) => c.value === true);
  if (trueClaims.length === 0) return { bonus: 0, trusted: false };
  const trusted = trueClaims.some((c) => isTrustedCandidate(c));
  return { bonus: trusted ? policy.atomicityTrustedBonus : policy.atomicityProvisionalBonus, trusted };
}
__name(computeAtomicityBonus, "computeAtomicityBonus");
var USER_DICTIONARY_VERIFICATION = /* @__PURE__ */ new Set([
  // Legacy User Dictionary からの migration（§105.1）
  "legacy_user",
  // ユーザーが後から作った、より強い Current Knowledge。
  // これらを除外すると「同じ body を manual_corrected したのに構成語分解が
  // 勝つ」という逆転が起きるため、Legacy 互換のためにも含める必要がある。
  "explicit_user_confirmed",
  "manual_entered",
  "manual_corrected"
]);
function isUserDictionaryPhraseWinner(evalResult) {
  if (!evalResult || evalResult.resolutionState !== "resolved") return false;
  const chosen = evalResult.chosen;
  if (!chosen) return false;
  if (chosen.source === "builtin") return false;
  if (chosen.subjectKind !== "phrase") return false;
  const vs = chosen.claim?.verificationState ?? chosen.verificationState;
  return USER_DICTIONARY_VERIFICATION.has(vs);
}
__name(isUserDictionaryPhraseWinner, "isUserDictionaryPhraseWinner");
function isMigratedLegacyCandidate(candidate) {
  if (!candidate) return false;
  if (candidate.source === "builtin") return false;
  const vs = candidate.claim?.verificationState ?? candidate.verificationState;
  return vs === "legacy_user";
}
__name(isMigratedLegacyCandidate, "isMigratedLegacyCandidate");
function legacyCandidateAppliesToRawSpan(candidate, rawSpanText) {
  const claim = candidate?.claim ?? candidate;
  const keys = claim?.legacySourceKeys;
  if (!Array.isArray(keys)) return true;
  const probe = legacyLookupKey(rawSpanText);
  if (!probe) return false;
  return keys.includes(probe);
}
__name(legacyCandidateAppliesToRawSpan, "legacyCandidateAppliesToRawSpan");
function buildResolutionUnits(words) {
  const units = [];
  words.forEach((w, wordIndex) => {
    const base = {
      wordIndex,
      wordStart: w.start,
      wordEnd: w.end,
      wordText: w.text
    };
    if (!w.hasToken) {
      units.push({
        ...base,
        start: w.start,
        end: w.end,
        text: w.text,
        initialRole: null,
        renderMode: null,
        bracketDepth: 0,
        punctuationWord: true,
        isFirstOfWord: true,
        isLastOfWord: true
      });
      return;
    }
    w.tokens.forEach((t, k) => {
      units.push({
        ...base,
        ...t,
        punctuationWord: false,
        isFirstOfWord: k === 0,
        isLastOfWord: k === w.tokens.length - 1
      });
    });
  });
  return units;
}
__name(buildResolutionUnits, "buildResolutionUnits");
function spanGeometry(sourceText, units, i, j) {
  const first = units[i];
  const last = units[j - 1];
  const wordAligned = first.isFirstOfWord && last.isLastOfWord;
  const sourceStart = wordAligned ? first.wordStart : first.start;
  const sourceEnd = wordAligned ? last.wordEnd : last.end;
  return {
    sourceStart,
    sourceEnd,
    wordAligned,
    spanText: sourceText.slice(sourceStart, sourceEnd),
    // span がちょうど1つの Legacy word 全体を覆うか（CR-8 Hard Rule 用）
    coversWholeWord: wordAligned && first.wordIndex === last.wordIndex
  };
}
__name(spanGeometry, "spanGeometry");
function bodyStartIndex(tokens) {
  let i = 0;
  while (i < tokens.length && isPreserveToken(tokens[i])) i++;
  return i;
}
__name(bodyStartIndex, "bodyStartIndex");
async function segmentAndResolve(db, {
  sourceText,
  target,
  context,
  requestedValueType = "japanese_display",
  builtinIndex = null,
  meta = null,
  maxSpanTokensOverride = null,
  policy = SEGMENTATION_POLICY
}) {
  const parsed = parseSourceName(sourceText, { target });
  const words = legacyWordUnits(parsed);
  const tokens = buildResolutionUnits(words);
  const n = tokens.length;
  const attemptedLookupKeys = [];
  if (n === 0) {
    return { parsed, tokens, chosenSpans: [], attemptedLookupKeys, maxSpanTokens: 0 };
  }
  const effectiveMeta = meta ?? await getMeta(db);
  const configuredMax = effectiveMeta?.maxPhraseTokensByTarget?.[target] ?? policy.defaultMaxSpanTokens;
  const maxSpan = Math.min(n, maxSpanTokensOverride ?? configuredMax);
  const bodyStart = bodyStartIndex(tokens);
  const spanResults = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    for (let j2 = i + 1; j2 <= Math.min(n, i + maxSpan); j2++) {
      const geo = spanGeometry(sourceText, tokens, i, j2);
      const spanText = geo.spanText;
      const tokenCount = j2 - i;
      const isFullSpan = i === 0 && j2 === n;
      const preserveKind = spanPreserveKind(tokens, i, j2);
      if (preserveKind === "mixed") {
        continue;
      }
      if (preserveKind === "preserve") {
        const evalResult2 = preservedEvalResult(policy, preserveKindOf(tokens, i, j2));
        spanResults.set(spanKey(i, j2), {
          i,
          j: j2,
          tokenCount,
          spanText,
          evalResult: evalResult2,
          ...geo,
          score: policy.preserveScorePerToken * tokenCount - policy.segmentFixedPenalty,
          atomicity: { bonus: 0, trusted: false },
          preserved: true
        });
        continue;
      }
      const isWholeBodySpan = i === bodyStart && j2 === n;
      const legacyReachable = isWholeBodySpan || geo.coversWholeWord;
      const evaluateVariant = /* @__PURE__ */ __name(async (text, allowLegacy) => {
        const g = await generateSpanCandidates(db, {
          spanText: text,
          tokenCount,
          isFullSpan,
          requestedValueTypes: [requestedValueType],
          builtinIndex
        });
        attemptedLookupKeys.push(...g.attemptedLookupKeys);
        const all = g.candidates.filter((c) => c.valueType === requestedValueType);
        const legacyExclusionReason = /* @__PURE__ */ __name((c) => {
          if (!isMigratedLegacyCandidate(c)) return null;
          if (!allowLegacy) return "legacy_claim_unreachable_source_unit";
          if (!legacyCandidateAppliesToRawSpan(c, text)) {
            return "legacy_claim_raw_form_out_of_legacy_domain";
          }
          return null;
        }, "legacyExclusionReason");
        const excluded = [];
        const kept = [];
        for (const c of all) {
          const reason = legacyExclusionReason(c);
          if (reason) excluded.push({ candidate: c, reason });
          else kept.push(c);
        }
        let ev = await evaluateCandidateGroup(db, kept, context, {
          meta: effectiveMeta,
          attemptedLookupKeys: g.attemptedLookupKeys
        });
        if (excluded.length > 0) {
          ev = {
            ...ev,
            filteredCandidateIds: [
              ...ev.filteredCandidateIds ?? [],
              ...excluded.map((x) => ({ claimId: x.candidate.claimId, reason: x.reason }))
            ]
          };
        }
        return { gen: g, evalResult: ev, candidates: kept };
      }, "evaluateVariant");
      const tokenBoundedText = sourceText.slice(tokens[i].start, tokens[j2 - 1].end);
      const hasDistinctWordUnit = geo.wordAligned && geo.spanText !== tokenBoundedText;
      let chosenVariant = null;
      if (hasDistinctWordUnit) {
        const wordVariant = await evaluateVariant(geo.spanText, legacyReachable);
        if (wordVariant.evalResult.resolutionState !== "unresolved") {
          chosenVariant = { ...wordVariant, useWordGeometry: true };
        }
      }
      if (!chosenVariant) {
        const tokenVariantAllowsLegacy = legacyReachable && !hasDistinctWordUnit;
        const tokenVariant = await evaluateVariant(tokenBoundedText, tokenVariantAllowsLegacy);
        chosenVariant = { ...tokenVariant, useWordGeometry: false };
      }
      const gen = chosenVariant.gen;
      const spanTextUsed = chosenVariant.useWordGeometry ? geo.spanText : tokenBoundedText;
      const spanGeoUsed = chosenVariant.useWordGeometry ? { sourceStart: geo.sourceStart, sourceEnd: geo.sourceEnd } : { sourceStart: tokens[i].start, sourceEnd: tokens[j2 - 1].end };
      const valueCandidates = chosenVariant.candidates;
      const evalResult = chosenVariant.evalResult;
      let atomicity = { bonus: 0, trusted: false };
      if (tokenCount > 1) {
        atomicity = await computeAtomicityBonus(db, gen.candidates, context, policy);
      }
      let score;
      if (evalResult.resolutionState === "unresolved") {
        score = -(policy.unknownPenaltyPerToken * tokenCount);
      } else {
        const winnerForTrust = evalResult.chosen ?? (evalResult.resolutionConflict ? valueCandidates[0] : null);
        const trustedSpan = isTrustedCandidate(winnerForTrust);
        const gapBonus = trustedSpan ? policy.spanGapBonusPerGap * (tokenCount - 1) : 0;
        score = evalResult.quality * tokenCount + gapBonus + atomicity.bonus - policy.segmentFixedPenalty;
      }
      spanResults.set(spanKey(i, j2), {
        i,
        j: j2,
        tokenCount,
        spanText: spanTextUsed,
        evalResult,
        score,
        atomicity,
        preserved: false,
        wordAligned: geo.wordAligned,
        coversWholeWord: geo.coversWholeWord,
        ...spanGeoUsed
      });
    }
  }
  const bodyTokenCount = n - bodyStart;
  let wholeBodySpan = null;
  if (bodyTokenCount >= 2) {
    let sr = spanResults.get(spanKey(bodyStart, n));
    if (!sr) {
      const bodyGeo = spanGeometry(sourceText, tokens, bodyStart, n);
      const spanText = bodyGeo.spanText;
      if (spanPreserveKind(tokens, bodyStart, n) === "plain") {
        const gen = await generateSpanCandidates(db, {
          spanText,
          tokenCount: bodyTokenCount,
          isFullSpan: bodyStart === 0,
          requestedValueTypes: [requestedValueType],
          builtinIndex
        });
        attemptedLookupKeys.push(...gen.attemptedLookupKeys);
        const valueCandidates = gen.candidates.filter((c) => c.valueType === requestedValueType);
        const evalResult = await evaluateCandidateGroup(db, valueCandidates, context, {
          meta: effectiveMeta,
          attemptedLookupKeys: gen.attemptedLookupKeys
        });
        sr = {
          i: bodyStart,
          j: n,
          tokenCount: bodyTokenCount,
          spanText,
          evalResult,
          ...bodyGeo,
          score: evalResult.resolutionState === "unresolved" ? -(policy.unknownPenaltyPerToken * bodyTokenCount) : evalResult.quality * bodyTokenCount - policy.segmentFixedPenalty,
          atomicity: { bonus: 0, trusted: false },
          preserved: false
        };
        spanResults.set(spanKey(bodyStart, n), sr);
      }
    }
    if (sr && isUserDictionaryPhraseWinner(sr.evalResult)) wholeBodySpan = sr;
  }
  const dp = new Array(n + 1).fill(-Infinity);
  const back = new Array(n + 1).fill(null);
  dp[0] = 0;
  for (let j2 = 1; j2 <= n; j2++) {
    for (let i = Math.max(0, j2 - maxSpan); i < j2; i++) {
      const sr = spanResults.get(spanKey(i, j2));
      if (!sr) continue;
      const candidateScore = dp[i] + sr.score;
      if (candidateScore > dp[j2]) {
        dp[j2] = candidateScore;
        back[j2] = i;
      }
    }
  }
  if (wholeBodySpan && dp[bodyStart] > -Infinity) {
    dp[n] = dp[bodyStart] + wholeBodySpan.score;
    back[n] = bodyStart;
  }
  const chosenSpans = [];
  let j = n;
  while (j > 0) {
    const i = back[j];
    chosenSpans.unshift(spanResults.get(spanKey(i, j)));
    j = i;
  }
  return {
    parsed,
    tokens,
    chosenSpans,
    attemptedLookupKeys: [...new Set(attemptedLookupKeys)],
    maxSpanTokens: maxSpan,
    totalScore: dp[n],
    legacyWholeBodyPhrase: wholeBodySpan ? {
      i: wholeBodySpan.i,
      j: wholeBodySpan.j,
      spanText: wholeBodySpan.spanText
    } : null
  };
}
__name(segmentAndResolve, "segmentAndResolve");
function spanKey(i, j) {
  return `${i}:${j}`;
}
__name(spanKey, "spanKey");

// dictionary-resolve.js
var ENTITY_ONLY_VALUE_TYPES = Object.freeze(/* @__PURE__ */ new Set([
  "club_3letter_display",
  "club_6letter_display",
  "short_display"
]));
function extractPolicyVersions(meta) {
  const out = {};
  for (const f of RESOLUTION_POLICY_FIELDS) out[f] = meta[f];
  out.cacheKeySchemaVersion = meta.cacheKeySchemaVersion;
  return out;
}
__name(extractPolicyVersions, "extractPolicyVersions");
async function currentBuiltinContentIdentity(builtinIndex) {
  if (builtinIndex === null || builtinIndex === void 0) {
    return builtinContentFingerprint([]);
  }
  const fp = builtinIndex.contentFingerprint;
  if (typeof fp !== "string" || !fp) {
    throw new TypeError("resolveName: builtinIndex.contentFingerprint is required (build the index with indexBuiltinClaims(await loadBuiltinDictionary(...)))");
  }
  return fp;
}
__name(currentBuiltinContentIdentity, "currentBuiltinContentIdentity");
function combineStates(states) {
  if (states.includes("conflicted")) return "conflicted";
  if (states.length > 0 && states.every((s) => s === "resolved")) return "resolved";
  if (states.some((s) => s === "resolved")) return "partial";
  return "unresolved";
}
__name(combineStates, "combineStates");
function buildDecisionTrace({
  resolutionState,
  chosenClaimIds,
  candidateClaimIds,
  filteredCandidateIds,
  attemptedLookupKeys,
  reasons,
  resolutionConflict,
  sourceMap,
  policyVersions,
  resolutionPolicyFingerprint
}) {
  return {
    resolutionState,
    chosenClaimIds,
    candidateClaimIds,
    filteredCandidateIds,
    attemptedLookupKeys,
    reasons,
    resolutionConflict,
    sourceMap,
    policyVersions,
    resolutionPolicyFingerprint
  };
}
__name(buildDecisionTrace, "buildDecisionTrace");
async function resolveEntityValueType(db, { target, fmId, valueType, context, meta, sourceText }) {
  if (!fmId) {
    return { attemptedLookupKeys: [], evalResult: {
      resolutionState: "unresolved",
      chosen: null,
      candidateIds: [],
      filteredCandidateIds: [],
      reasons: ["no_entity_key"],
      resolutionConflict: null
    } };
  }
  const entGen = await generateEntityCandidates(db, { target, fmId });
  const vtCandidates = entGen.candidates.filter((c) => c.valueType === valueType);
  const evalResult = await evaluateCandidateGroup(db, vtCandidates, context, {
    meta,
    attemptedLookupKeys: entGen.attemptedLookupKeys,
    sourceText
  });
  return { attemptedLookupKeys: entGen.attemptedLookupKeys, evalResult };
}
__name(resolveEntityValueType, "resolveEntityValueType");
async function resolveWholeInputSubjectValueType(db, { sourceText, target, valueType, context, meta }) {
  const strict = strictNormalizedSource(sourceText);
  const tokenCount = lexicalTokens(parseSourceName(sourceText, { target })).length;
  if (tokenCount === 0) {
    return { attemptedLookupKeys: [], evalResult: {
      resolutionState: "unresolved",
      chosen: null,
      candidateIds: [],
      filteredCandidateIds: [],
      reasons: ["empty_input"],
      resolutionConflict: null
    } };
  }
  const subjectKey = tokenCount <= 1 ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
  const page = await findClaimsBySubject(db, subjectKey, { limit: 200 });
  const vtCandidates = page.items.filter((c) => c.valueType === valueType).map((claim) => ({
    source: "user",
    matchMode: "exact",
    claimId: claim.claimId,
    claim,
    subjectKind: claim.subjectKind,
    subjectKey: claim.subjectKey,
    claimGroupKey: claim.claimGroupKey,
    valueType: claim.valueType,
    value: claim.value,
    normalizedValue: claim.normalizedValue,
    script: claim.script,
    confidenceScore: claim.confidenceScore,
    trustTier: claim.trustTier,
    locked: claim.locked === true,
    verificationState: claim.verificationState
  }));
  const evalResult = await evaluateCandidateGroup(db, vtCandidates, context, {
    meta,
    attemptedLookupKeys: [subjectKey],
    sourceText
  });
  return { attemptedLookupKeys: [subjectKey], evalResult };
}
__name(resolveWholeInputSubjectValueType, "resolveWholeInputSubjectValueType");
async function resolveViaSegmentation(db, {
  sourceText,
  target,
  valueType,
  context,
  builtinIndex,
  meta
}) {
  const seg = await segmentAndResolve(db, {
    sourceText,
    target,
    context,
    requestedValueType: valueType,
    builtinIndex,
    meta
  });
  const composed = composeResolution({
    sourceText: seg.parsed.sourceText,
    tokens: seg.tokens,
    chosenSpans: seg.chosenSpans
  });
  const perSpanStates = seg.chosenSpans.map((s) => s.evalResult.resolutionState);
  const resolutionState = combineStates(perSpanStates);
  const hasUnresolvedCoverage = perSpanStates.some((s) => s === "unresolved" || s === "partial");
  const chosenClaimIds = seg.chosenSpans.filter((s) => s.evalResult.resolutionState === "resolved" && s.evalResult.chosen).map((s) => s.evalResult.chosen.claimId);
  const preservedSpanCount = seg.chosenSpans.filter((s) => s.evalResult.preserved === true).length;
  const candidateClaimIds = [...new Set(seg.chosenSpans.flatMap((s) => s.evalResult.candidateIds))];
  const filteredCandidateIds = seg.chosenSpans.flatMap((s) => s.evalResult.filteredCandidateIds);
  const conflicts = seg.chosenSpans.filter((s) => s.evalResult.resolutionConflict).map((s) => s.evalResult.resolutionConflict);
  const reasons = [...new Set(seg.chosenSpans.flatMap((s) => s.evalResult.reasons))];
  return {
    resolutionState,
    hasUnresolvedCoverage,
    preservedSpanCount,
    output: composed.finalText,
    sourceMap: composed.segments,
    chosenClaimIds,
    candidateClaimIds,
    filteredCandidateIds,
    attemptedLookupKeys: seg.attemptedLookupKeys,
    reasons,
    resolutionConflict: conflicts[0] ?? null,
    segments: seg.chosenSpans
  };
}
__name(resolveViaSegmentation, "resolveViaSegmentation");
async function resolveName(db, {
  sourceText,
  target,
  fmId = null,
  countryCode = null,
  worldRegionCode = null,
  requestedValueTypes = ["japanese_display"],
  builtinIndex = null,
  meta = null,
  now = Date.now()
}) {
  const effectiveMeta = effectivePolicyMeta(meta ?? await getMeta(db));
  const builtinContentFingerprint2 = await currentBuiltinContentIdentity(builtinIndex);
  const maintenance = dictionaryMaintenanceState(effectiveMeta, { now });
  const entityKeyValue = fmId ? entityKey(target, fmId) : null;
  const strictInput = strictNormalizedSource(sourceText);
  const context = { entityKey: entityKeyValue, target, countryCode, worldRegionCode };
  const sourceNameFingerprint = fmId ? (await computeSourceNameFingerprint(sourceText, { target })).sourceNameFingerprint : null;
  const inputFingerprint = await computeInputFingerprint(sourceText);
  const resolutionContextKey = await computeResolutionContextKey({
    target,
    entityKey: entityKeyValue,
    strictNormalizedInput: strictInput,
    countryCode,
    worldRegionCode,
    requestedValueTypes,
    sourceNameFingerprint,
    cacheKeySchemaVersion: effectiveMeta.cacheKeySchemaVersion,
    inputFingerprint,
    inputFingerprintVersion: INPUT_FINGERPRINT_VERSION
  });
  const resolutionPolicyFingerprint = await computeResolutionPolicyFingerprint(effectiveMeta);
  const resolutionKey = await computeResolutionKey({
    resolutionContextKey,
    resolutionPolicyFingerprint,
    cacheKeySchemaVersion: effectiveMeta.cacheKeySchemaVersion,
    builtinContentFingerprint: builtinContentFingerprint2
  });
  const expectedIdentity = {
    inputFingerprint,
    inputFingerprintVersion: INPUT_FINGERPRINT_VERSION,
    sourceNameFingerprint,
    sourceNameFingerprintVersion: SOURCE_NAME_FINGERPRINT_VERSION,
    rawSourceText: sourceText,
    builtinContentFingerprint: builtinContentFingerprint2
  };
  if (maintenance.knowledgeReplacementInProgress) {
    const gatedValues = {};
    for (const vt of requestedValueTypes) {
      gatedValues[vt] = {
        resolutionState: "unresolved",
        output: null,
        sourceMap: null,
        decisionTrace: buildDecisionTrace({
          resolutionState: "unresolved",
          chosenClaimIds: [],
          candidateClaimIds: [],
          filteredCandidateIds: [],
          attemptedLookupKeys: [],
          reasons: [`maintenance_gate:${maintenance.knowledgeReplacementReason}`],
          resolutionConflict: null,
          sourceMap: null,
          policyVersions: extractPolicyVersions(effectiveMeta),
          resolutionPolicyFingerprint
        })
      };
    }
    return {
      resolutionState: "unresolved",
      hasUnresolvedCoverage: true,
      maintenanceGate: maintenance.knowledgeReplacementReason,
      target,
      entityKey: entityKeyValue,
      normalizedInput: strictInput,
      values: gatedValues,
      resolutionContextKey,
      resolutionPolicyFingerprint,
      resolutionKey,
      resolutionId: `res:${resolutionKey}`,
      builtinContentFingerprint: builtinContentFingerprint2,
      inputFingerprint,
      inputFingerprintVersion: INPUT_FINGERPRINT_VERSION,
      fromCache: false,
      persisted: false,
      persistReason: "maintenance_gate"
    };
  }
  const cacheRead = maintenance.currentKnowledgeStable ? await readValidatedResolutionCache(db, resolutionKey, expectedIdentity, { now }) : { entry: null, hit: false, identity: { valid: false, reason: "maintenance_transition_unstable" } };
  const resolutionId = `res:${resolutionKey}`;
  if (cacheRead.hit) {
    return {
      ...cacheRead.entry.result,
      resolutionKey,
      resolutionId,
      builtinContentFingerprint: builtinContentFingerprint2,
      inputFingerprint,
      inputFingerprintVersion: INPUT_FINGERPRINT_VERSION,
      fromCache: true
    };
  }
  const values = {};
  const allDirectDependencyClaimIds = /* @__PURE__ */ new Set();
  const allLookupKeys = /* @__PURE__ */ new Set();
  const perValueTypeStates = [];
  const perValueTypeHasUnresolvedCoverage = [];
  for (const vt of requestedValueTypes) {
    if (ENTITY_ONLY_VALUE_TYPES.has(vt)) {
      const entityAttemptForVt = await resolveEntityValueType(db, {
        target,
        fmId,
        valueType: vt,
        context,
        meta: effectiveMeta,
        sourceText
      });
      let { attemptedLookupKeys, evalResult } = entityAttemptForVt;
      let fellBackToWholeInput = false;
      if (evalResult.resolutionState === "unresolved") {
        const wholeInputAttempt = await resolveWholeInputSubjectValueType(db, {
          sourceText,
          target,
          valueType: vt,
          context,
          meta: effectiveMeta
        });
        attemptedLookupKeys = [...attemptedLookupKeys, ...wholeInputAttempt.attemptedLookupKeys];
        evalResult = wholeInputAttempt.evalResult;
        fellBackToWholeInput = true;
      }
      for (const k of attemptedLookupKeys) allLookupKeys.add(k);
      if (evalResult.chosen) allDirectDependencyClaimIds.add(evalResult.chosen.claimId);
      for (const id of evalResult.candidateIds ?? []) allDirectDependencyClaimIds.add(id);
      const filteredCandidateIds = fellBackToWholeInput ? [
        ...entityAttemptForVt.evalResult.filteredCandidateIds ?? [],
        ...evalResult.filteredCandidateIds ?? []
      ] : evalResult.filteredCandidateIds ?? [];
      const reasons = fellBackToWholeInput ? [.../* @__PURE__ */ new Set([...entityAttemptForVt.evalResult.reasons ?? [], ...evalResult.reasons ?? []])] : evalResult.reasons ?? [];
      values[vt] = {
        resolutionState: evalResult.resolutionState,
        output: evalResult.chosen?.value ?? null,
        sourceMap: null,
        decisionTrace: buildDecisionTrace({
          resolutionState: evalResult.resolutionState,
          chosenClaimIds: evalResult.chosen ? [evalResult.chosen.claimId] : [],
          candidateClaimIds: evalResult.candidateIds ?? [],
          filteredCandidateIds,
          attemptedLookupKeys,
          reasons,
          resolutionConflict: evalResult.resolutionConflict ?? null,
          sourceMap: null,
          policyVersions: extractPolicyVersions(effectiveMeta),
          resolutionPolicyFingerprint
        })
      };
      perValueTypeStates.push(evalResult.resolutionState);
      perValueTypeHasUnresolvedCoverage.push(
        evalResult.resolutionState === "unresolved" || evalResult.resolutionState === "partial"
      );
      continue;
    }
    const entityAttempt = await resolveEntityValueType(db, {
      target,
      fmId,
      valueType: vt,
      context,
      meta: effectiveMeta,
      sourceText
    });
    for (const k of entityAttempt.attemptedLookupKeys) allLookupKeys.add(k);
    if (entityAttempt.evalResult.resolutionState !== "unresolved") {
      const evalResult = entityAttempt.evalResult;
      if (evalResult.chosen) allDirectDependencyClaimIds.add(evalResult.chosen.claimId);
      for (const id of evalResult.candidateIds ?? []) allDirectDependencyClaimIds.add(id);
      values[vt] = {
        resolutionState: evalResult.resolutionState,
        output: evalResult.chosen?.value ?? null,
        sourceMap: null,
        decisionTrace: buildDecisionTrace({
          resolutionState: evalResult.resolutionState,
          chosenClaimIds: evalResult.chosen ? [evalResult.chosen.claimId] : [],
          candidateClaimIds: evalResult.candidateIds ?? [],
          filteredCandidateIds: evalResult.filteredCandidateIds ?? [],
          attemptedLookupKeys: entityAttempt.attemptedLookupKeys,
          reasons: evalResult.reasons ?? [],
          resolutionConflict: evalResult.resolutionConflict ?? null,
          sourceMap: null,
          policyVersions: extractPolicyVersions(effectiveMeta),
          resolutionPolicyFingerprint
        })
      };
      perValueTypeStates.push(evalResult.resolutionState);
      perValueTypeHasUnresolvedCoverage.push(
        evalResult.resolutionState === "unresolved" || evalResult.resolutionState === "partial"
      );
      continue;
    }
    const segResult = await resolveViaSegmentation(db, {
      sourceText,
      target,
      valueType: vt,
      context,
      builtinIndex,
      meta: effectiveMeta
    });
    for (const k of segResult.attemptedLookupKeys) allLookupKeys.add(k);
    for (const id of segResult.candidateClaimIds) allDirectDependencyClaimIds.add(id);
    const entityFilteredIds = entityAttempt.evalResult.filteredCandidateIds ?? [];
    const entityReasons = entityAttempt.evalResult.reasons ?? [];
    values[vt] = {
      resolutionState: segResult.resolutionState,
      output: segResult.output,
      sourceMap: segResult.sourceMap,
      decisionTrace: buildDecisionTrace({
        resolutionState: segResult.resolutionState,
        chosenClaimIds: segResult.chosenClaimIds,
        candidateClaimIds: segResult.candidateClaimIds,
        filteredCandidateIds: [...entityFilteredIds, ...segResult.filteredCandidateIds],
        attemptedLookupKeys: segResult.attemptedLookupKeys,
        reasons: [.../* @__PURE__ */ new Set([...entityReasons, ...segResult.reasons])],
        resolutionConflict: segResult.resolutionConflict,
        sourceMap: segResult.sourceMap,
        policyVersions: extractPolicyVersions(effectiveMeta),
        resolutionPolicyFingerprint
      })
    };
    perValueTypeStates.push(segResult.resolutionState);
    perValueTypeHasUnresolvedCoverage.push(segResult.hasUnresolvedCoverage);
  }
  const overallState = combineStates(perValueTypeStates);
  const hasUnresolvedCoverage = perValueTypeHasUnresolvedCoverage.some(Boolean);
  const result = {
    resolutionState: overallState,
    hasUnresolvedCoverage,
    target,
    entityKey: entityKeyValue,
    normalizedInput: strictInput,
    values,
    resolutionContextKey,
    resolutionPolicyFingerprint
  };
  const persistOutcome = await maybePersistResolution(db, {
    resolutionKey,
    resolutionContextKey,
    resolutionPolicyFingerprint,
    target,
    entityKey: entityKeyValue,
    normalizedInput: strictInput,
    result,
    directDependencyClaimIds: [...allDirectDependencyClaimIds],
    lookupKeys: [...allLookupKeys],
    policyVersions: extractPolicyVersions(effectiveMeta),
    now,
    // §85 / §40.1 Resolution Identity をRecordへ保存する。
    inputFingerprint,
    inputFingerprintVersion: INPUT_FINGERPRINT_VERSION,
    sourceNameFingerprint,
    sourceNameFingerprintVersion: SOURCE_NAME_FINGERPRINT_VERSION,
    rawSourceText: sourceText,
    builtinContentFingerprint: builtinContentFingerprint2
  });
  return {
    ...result,
    resolutionKey,
    resolutionId,
    builtinContentFingerprint: builtinContentFingerprint2,
    // §40.1 Resolution Identity（Phase 6 Correction Alignment の照合用）
    inputFingerprint,
    inputFingerprintVersion: INPUT_FINGERPRINT_VERSION,
    fromCache: false,
    persisted: persistOutcome.persisted,
    persistReason: persistOutcome.reason ?? null,
    cacheMissReason: cacheRead.identity?.reason ?? null
  };
}
__name(resolveName, "resolveName");

export {
  TRUTH_GATE_MATCH_MODE,
  resolveName
};
