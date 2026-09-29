import {
  AI_POLICY,
  GENERATION_STRATEGY_VERSION,
  PROMPT_PROFILE,
  PROMPT_PROFILES_BY_ID,
  buildPrompt,
  estimateTokens
} from "./shared-ai-prompt-policy.js";
import {
  AUTO_PROMOTABLE_DIMENSIONS,
  BACKUP_EXCLUDED_STORES,
  BACKUP_FORMAT,
  BACKUP_META_WHITELIST,
  BACKUP_MODE,
  BACKUP_VERSION,
  BackupConsistencyError,
  CONFLICT_STATE,
  DEFAULT_MODEL_LINEAGE_REGISTRY,
  EVIDENCE_TYPE,
  GUARD_MODE,
  HISTORY_ACTION,
  ID_PREFIXES,
  KEY_SCHEMA_VERSION,
  LEASE_POLICY,
  LIFECYCLE_STATE,
  LINEAGE_CLASSIFICATION,
  LeaseError,
  MERGE_MARKER_META_KEY,
  MINOR_CHANGE_POLICY,
  OWNER_TOKEN,
  REJECTION_REASON,
  REJECTION_STATE,
  RELATION,
  RELATION_TYPE_POLICIES,
  RESTORE_MARKER_META_KEY,
  REVALIDATION_STATE,
  SCRIPT_ENUM,
  SOURCE_NORMALIZER_VERSION,
  STANCE,
  STORE,
  SUBJECT_KIND,
  TRUST_TIER,
  VALUE_NORMALIZER_VERSION,
  VALUE_TYPE_POLICIES,
  VERIFICATION_STATE,
  __name,
  acquireJobLease,
  acquireMaintenanceLease,
  addHistory,
  assertJobFence,
  assertMutationId,
  buildClaimRecord,
  buildEvidenceRecord,
  buildHistoryRecord,
  buildRejectionRecord,
  buildSourceNameGuard,
  claimGroupKey,
  clearResolutionCache,
  clearResolutionCacheIn,
  collectDependents,
  collectEvidenceForClaim,
  commitClaimUpsertIn,
  commitEvidenceIn,
  computeSourceNameFingerprint,
  createBroadcast,
  currentScoreInputVersions,
  dictionaryMaintenanceState,
  edgeKey,
  effectivePolicyMeta,
  emptyContextConstraints,
  entityKey,
  entitySubjectKey,
  evaluateSourceNameGuard,
  findClaimsByGroup,
  forEachChunk,
  getClaim,
  getLookupKeysForClaim,
  getMeta,
  invalidateForClaimIn,
  invalidateForRejectionIn,
  isDecisionAffecting,
  isManualAuthorityClaim,
  isScoreStale,
  iterateEvidenceForClaim,
  iterateHistoryForNode,
  iterateIndex,
  lexicalSubjectKey,
  markClaimScoreInputChanged,
  newOpaqueId,
  normalizeApplicabilityConstraints,
  normalizeClaimValue,
  normalizeContextConstraints,
  openDictionaryDB,
  originRecordKey,
  patchClaimExplicit,
  patchClaimExplicitState,
  patchClaimQuarantineState,
  patchClaimRevalidationState,
  patchClaimReviewQueueState,
  phraseSubjectKey,
  prepareClaimUpsert,
  prepareEvidenceWrite,
  recordEvidence,
  releaseJobLease,
  releaseMaintenanceLease,
  renewMaintenanceLease,
  replaceClaimSemantics,
  resolutionPolicyFingerprint,
  resolveEvidenceLineage,
  runRead,
  runSemanticMutation,
  stableHash,
  stableSerialize,
  strictNormalizedSource,
  upsertClaimBySemanticKey,
  upsertEvidenceByDedupeKey,
  upsertPackageByPackageId,
  upsertRejectionByKey,
  validateClaimValue
} from "./shared-dictionary-core.js";

// dictionary-risk-policy.js
var RISK_POLICY_VERSION = 1;
var RISK_POLICY = Object.freeze({
  riskPolicyVersion: RISK_POLICY_VERSION,
  /** reach / conflict / provenance weight の許容レンジ（外れ値で risk が発散しない）。 */
  minWeight: 0.25,
  maxWeight: 4,
  /** §44 provenanceRisk の加算要素。1.0 から始めて該当ぶんだけ乗算する。 */
  provenance: Object.freeze({
    /** 「same-generation fan-out reach が大きい → provenanceRisk上昇」 */
    fanoutReachThreshold: 8,
    fanoutReachWeight: 1.5,
    /** 「single independenceGroup のみ → provenanceRisk上昇」 */
    singleIndependenceGroupWeight: 1.6,
    /** 「old prompt/model lineage → provenanceRisk上昇」 */
    staleLineageWeight: 1.4,
    /** §22.3: unknown lineage 同士を独立確認にしない（§120-42）→ risk側でも上げる。 */
    unknownLineageWeight: 1.25
  }),
  /**
   * §44:「manual locked → 自動AI置換Queueからは外す。ただし Health/Conflict Risk
   *  を0にはしない」。Queue eligibility と risk 値は別物として返す。
   */
  manualLockedConflictFloor: 0.15
});
function clampWeight(w) {
  if (!Number.isFinite(w)) return 1;
  return Math.min(RISK_POLICY.maxWeight, Math.max(RISK_POLICY.minWeight, w));
}
__name(clampWeight, "clampWeight");
function log2Compress(n) {
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  return 1 + Math.log2(1 + v);
}
__name(log2Compress, "log2Compress");
function computeProvenanceRisk({
  sameGenerationReach = 0,
  independenceGroupCount = 1,
  staleLineage = false,
  unknownLineage = false
} = {}) {
  const p = RISK_POLICY.provenance;
  let risk = 1;
  if (sameGenerationReach >= p.fanoutReachThreshold) risk *= p.fanoutReachWeight;
  if ((independenceGroupCount ?? 0) <= 1) risk *= p.singleIndependenceGroupWeight;
  if (staleLineage) risk *= p.staleLineageWeight;
  if (unknownLineage) risk *= p.unknownLineageWeight;
  return clampWeight(risk);
}
__name(computeProvenanceRisk, "computeProvenanceRisk");
function computeRiskScore({
  uncertainty = 0.5,
  useCount = 0,
  dependentCount = 0,
  reachWeight = 1,
  conflictWeight = 1,
  provenanceRisk = 1,
  manualLocked = false
} = {}) {
  const u = Number.isFinite(uncertainty) ? Math.min(1, Math.max(0, uncertainty)) : 0.5;
  const raw = u * log2Compress(useCount) * log2Compress(dependentCount) * clampWeight(reachWeight) * clampWeight(conflictWeight) * clampWeight(provenanceRisk);
  const score = manualLocked ? Math.max(raw, RISK_POLICY.manualLockedConflictFloor) : raw;
  return {
    riskScore: score,
    riskPolicyVersion: RISK_POLICY_VERSION,
    // §44:「manual locked → 自動AI置換Queueからは外す」
    autoRevalidationEligible: !manualLocked,
    // §44:「ただし Health/Conflict Risk を0にはしない」
    healthWarningEligible: score > 0,
    inputs: { uncertainty: u, useCount, dependentCount, reachWeight, conflictWeight, provenanceRisk, manualLocked }
  };
}
__name(computeRiskScore, "computeRiskScore");

// dictionary-jobs.js
var JOB_TYPE = Object.freeze({
  revalidation: "revalidation",
  importMerge: "import_merge",
  doctorRepair: "doctor_repair",
  gc: "gc",
  logicalMigration: "logical_migration",
  /**
   * Phase 9C §93.1 / §140.6 Safe Mutation Undo。AI batch / Package Import /
   * Revalidation 等、既存 Mutation を安全に補償するための chunk job。
   * `mode: JOB_MODE.local`（AI を一切呼ばない）で実行する。
   */
  mutationUndo: "mutation_undo"
});
var JOB_MODE = Object.freeze({
  local: "local",
  blindAi: "blind_ai",
  deepBlind: "deep_blind",
  crossLineage: "cross_lineage",
  disputeResolution: "dispute_resolution",
  doctorScan: "doctor_scan",
  doctorRepair: "doctor_repair",
  gc: "gc"
});
var JOB_STATE = Object.freeze({
  queued: "queued",
  running: "running",
  paused: "paused",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled"
});
var TERMINAL_STATES = Object.freeze(/* @__PURE__ */ new Set([
  JOB_STATE.completed,
  JOB_STATE.failed,
  JOB_STATE.cancelled
]));
var JOB_POLICY = Object.freeze({
  /** §47:「数百件程度 → checkpoint → 次Chunk」。 */
  chunkSize: 200,
  /** §45.4: cursor page の読み取り単位。chunkSize と揃える。 */
  selectionPageSize: 200,
  /** 1 run で回す chunk の上限（UI から呼ぶ1 tick を無制限にしない）。 */
  maxChunksPerRun: 1e3,
  /** §45.4 final rescan の最大 pass 数。無限ループにしない。 */
  maxFinalRescanPasses: 1,
  leaseTtlMs: LEASE_POLICY.defaultTtlMs,
  /** §91: chunk 間の cooperative yield。UI Thread を長時間占有しない。 */
  yieldBetweenChunks: true
});
var JobError = class extends Error {
  static {
    __name(this, "JobError");
  }
  constructor(message, details) {
    super(message);
    this.name = "JobError";
    this.details = details;
  }
};
var POLICY_MISMATCH_ACTION = Object.freeze({
  /** Pause して User / automatic restart を待つ。 */
  pause: "pause",
  /** 新Jobとして再開する。 */
  restart: "restart",
  /** Local-only 安全処理だけ current version でやり直す。 */
  redoLocal: "redo_local"
});
async function buildPolicySnapshot(meta, {
  profile = PROMPT_PROFILE.blindRevalidate
} = {}) {
  const m = effectivePolicyMeta(meta);
  if (!m) throw new JobError("buildPolicySnapshot: meta is required");
  return {
    resolutionPolicyFingerprint: await resolutionPolicyFingerprint(m),
    confidencePolicyVersion: m.confidencePolicyVersion,
    parserVersion: m.parserVersion,
    sourceNormalizerVersion: m.sourceNormalizerVersion,
    countryCanonicalizationVersion: m.countryCanonicalizationVersion,
    worldRegionCanonicalizationVersion: m.worldRegionCanonicalizationVersion,
    countryProfileVersion: m.countryProfileVersion,
    modelLineageRegistryVersion: m.modelLineageRegistryVersion,
    contextHashSchemaVersion: m.contextHashSchemaVersion,
    languageInferenceVersion: m.languageInferenceVersion,
    promptProfileId: profile?.promptProfileId ?? null,
    promptVersion: profile?.promptVersion ?? null,
    generationStrategyVersion: GENERATION_STRATEGY_VERSION,
    schemaCompatibilityEpoch: m.schemaCompatibilityEpoch
  };
}
__name(buildPolicySnapshot, "buildPolicySnapshot");
function comparePolicySnapshot(job, currentSnapshot) {
  const snap = job?.policySnapshot ?? {};
  const localOnly = job?.mode === JOB_MODE.local || job?.type === JOB_TYPE.doctorRepair || job?.type === JOB_TYPE.gc;
  const skip = localOnly ? /* @__PURE__ */ new Set(["promptProfileId", "promptVersion", "generationStrategyVersion"]) : /* @__PURE__ */ new Set();
  const differences = [];
  for (const [field, current] of Object.entries(currentSnapshot)) {
    if (skip.has(field)) continue;
    if (snap[field] !== current) {
      differences.push({ field, snapshot: snap[field] ?? null, current });
    }
  }
  return {
    match: differences.length === 0,
    differences,
    /** §45.3:「Local-only 安全処理だけ current version でやり直す」。 */
    suggestedAction: differences.length === 0 ? null : localOnly ? POLICY_MISMATCH_ACTION.redoLocal : POLICY_MISMATCH_ACTION.pause
  };
}
__name(comparePolicySnapshot, "comparePolicySnapshot");
function requestOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf, "requestOf");
async function getJob(db, jobId) {
  return runRead(db, [STORE.jobs], ({ store }) => requestOf(store(STORE.jobs).get(jobId)));
}
__name(getJob, "getJob");
async function createJob(db, {
  type,
  mode,
  query = {},
  profile = PROMPT_PROFILE.blindRevalidate,
  providerBudget = null,
  rootMutationId = null,
  requiresFinalRescan = true,
  now = Date.now()
} = {}) {
  if (!Object.values(JOB_TYPE).includes(type)) throw new JobError(`createJob: unknown type ${type}`);
  if (!Object.values(JOB_MODE).includes(mode)) throw new JobError(`createJob: unknown mode ${mode}`);
  assertSafeQuery(query);
  if (Array.isArray(query?.claimIds) && query.claimIds.length > JOB_POLICY.chunkSize) {
    throw new JobError(
      "createJob: refusing to store a large explicit ID array on the job record",
      { count: query.claimIds.length, limit: JOB_POLICY.chunkSize }
    );
  }
  const jobId = newOpaqueId(ID_PREFIXES.job);
  const metaSnapshot = await runRead(db, [STORE.meta], ({ store }) => requestOf(store(STORE.meta).get("meta")));
  if (!metaSnapshot) throw new JobError("createJob: dictionary_meta is not initialised");
  const snapshot = await buildPolicySnapshot(metaSnapshot, { profile });
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx, meta }) => {
    const job = {
      jobId,
      type,
      mode,
      state: JOB_STATE.queued,
      query,
      policySnapshot: snapshot,
      // §45.4: Job 開始時点の change sequence。final rescan の判定に使う。
      selectionRevision: meta.userDictionaryRevision ?? 0,
      cursor: null,
      lastProcessedKey: null,
      requiresFinalRescan,
      finalRescanDone: false,
      /**
       * §45.4:「後続 Job へ回す」。final rescan 中にさらに selection が動いた場合、
       * 変更を黙って捨てて completed にしない。この flag が立った Job は
       * `createFollowUpJobIfNeeded()` で bounded な後続 Job を生む。
       */
      residualSelectionChange: false,
      residualSelectionRevision: null,
      followUpJobId: null,
      counts: { total: 0, processed: 0, changed: 0, failed: 0, staleResponses: 0 },
      /**
       * §48 AI再検証予算 / Phase 7 B1 Durable Budget Accounting。
       *
       * 予約値（`reserved*`）と実消費値（`attempted*` 等）を **別 field** に分ける。
       * provider へ送る前に fence 下で `reservedItems` を durable に増やし、
       * commit 時に実消費を書いて未使用分だけ解放する。
       *
       *   不変条件: attemptedItems <= reservedItems <= maxItems
       *
       * crash が reservation 後・call 前に起きた場合は予約が残るため **過少利用**に
       * なるが、resume 後の **過剰利用は構造的に起き得ない**（§48）。
       */
      providerBudget: {
        maxItems: providerBudget?.maxItems ?? null,
        maxBatches: providerBudget?.maxBatches ?? null,
        maxRetryCalls: providerBudget?.maxRetryCalls ?? null,
        maxEstimatedInputTokensPerRun: providerBudget?.maxEstimatedInputTokensPerRun ?? null,
        // 予約（durable reservation）
        reservedItems: 0,
        reservedProviderCalls: 0,
        // 実消費
        attemptedItems: 0,
        successfulItems: 0,
        providerCalls: 0,
        retryCalls: 0,
        estimatedInputTokens: 0
      },
      // §93: 意味的に1つの操作。History / Evidence / Job で共有する。
      rootMutationId: rootMutationId ?? newOpaqueId(ID_PREFIXES.mutation),
      /**
       * Phase 7 B3 Stable Logical Generation Identity。
       *
       * §21:「別の Blind Revalidation run では新しくする」の *run* は **Job** 単位。
       * Job 作成時に一度だけ決め、retry / crash resume / pause resume / owner 交代 /
       * lease steal / chunk replay を跨いで **不変**にする。これにより同じ論理生成の
       * dedupeKey が安定し、replay で Evidence が水増しされない。
       */
      revalidationRunId: `revalrun:${jobId}`,
      lastChunkMutationId: null,
      /** §45.5 / §47: 既に commit 済みの chunk 数。replay 検出に使う。 */
      committedChunks: 0,
      leaseOwner: null,
      leaseEpoch: 0,
      leaseExpiresAt: null,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
      error: null
    };
    await requestOf(tx.objectStore(STORE.jobs).add(job));
    return job;
  }, { bumpRevision: false });
  return result;
}
__name(createJob, "createJob");
var FORBIDDEN_QUERY_KEYS = Object.freeze(/* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]));
function assertSafeQuery(query) {
  if (query === null || query === void 0) return;
  if (typeof query !== "object" || Array.isArray(query)) {
    throw new JobError("job query must be a plain object", { query: typeof query });
  }
  for (const key of Object.keys(query)) {
    if (FORBIDDEN_QUERY_KEYS.has(key)) {
      throw new JobError(`job query key is not allowed: ${key}`, { key });
    }
  }
  if (Object.getPrototypeOf(query) !== Object.prototype && Object.getPrototypeOf(query) !== null) {
    throw new JobError("job query must be a plain object", {});
  }
}
__name(assertSafeQuery, "assertSafeQuery");
function validateJobRecord(job, { now = Date.now(), forExecution = true } = {}) {
  const problems = [];
  if (!job || typeof job !== "object") {
    throw new JobError("job record is missing or not an object", { job });
  }
  if (typeof job.jobId !== "string" || !job.jobId) problems.push("jobId");
  if (!Object.values(JOB_TYPE).includes(job.type)) problems.push(`unknown type: ${job.type}`);
  if (!Object.values(JOB_MODE).includes(job.mode)) problems.push(`unknown mode: ${job.mode}`);
  if (!Object.values(JOB_STATE).includes(job.state)) problems.push(`unknown state: ${job.state}`);
  try {
    assertSafeQuery(job.query);
  } catch (e) {
    problems.push(e.message);
  }
  if (Array.isArray(job.query?.claimIds) && job.query.claimIds.length > JOB_POLICY.chunkSize) {
    problems.push(`oversized claimIds array: ${job.query.claimIds.length}`);
  }
  if (problems.length) {
    throw new JobError(`invalid job record: ${problems.join("; ")}`, { jobId: job?.jobId, problems });
  }
  if (forExecution && TERMINAL_STATES.has(job.state)) {
    throw new JobError(`job is ${job.state} and cannot run`, { jobId: job.jobId, state: job.state });
  }
  return {
    ...job,
    query: job.query ?? {},
    cursor: job.cursor ?? null,
    counts: { total: 0, processed: 0, changed: 0, failed: 0, staleResponses: 0, ...job.counts ?? {} },
    providerBudget: normalizeProviderBudget(job.providerBudget),
    policySnapshot: job.policySnapshot ?? {},
    leaseEpoch: Number.isInteger(job.leaseEpoch) ? job.leaseEpoch : 0,
    leaseOwner: job.leaseOwner ?? null,
    leaseExpiresAt: Number.isFinite(job.leaseExpiresAt) ? job.leaseExpiresAt : null,
    revalidationRunId: job.revalidationRunId ?? `revalrun:${job.jobId}`,
    committedChunks: job.committedChunks ?? 0,
    validatedAt: now
  };
}
__name(validateJobRecord, "validateJobRecord");
function normalizeProviderBudget(b) {
  const src = b ?? {};
  const num = /* @__PURE__ */ __name((v, d = 0) => Number.isFinite(v) ? v : d, "num");
  return {
    maxItems: Number.isFinite(src.maxItems) ? src.maxItems : null,
    maxBatches: Number.isFinite(src.maxBatches) ? src.maxBatches : null,
    maxRetryCalls: Number.isFinite(src.maxRetryCalls) ? src.maxRetryCalls : null,
    maxEstimatedInputTokensPerRun: Number.isFinite(src.maxEstimatedInputTokensPerRun) ? src.maxEstimatedInputTokensPerRun : null,
    reservedItems: num(src.reservedItems),
    reservedProviderCalls: num(src.reservedProviderCalls),
    attemptedItems: num(src.attemptedItems),
    successfulItems: num(src.successfulItems),
    providerCalls: num(src.providerCalls),
    retryCalls: num(src.retryCalls),
    estimatedInputTokens: num(src.estimatedInputTokens)
  };
}
__name(normalizeProviderBudget, "normalizeProviderBudget");
var EXECUTOR_KIND = Object.freeze({
  local: "local",
  ai: "ai",
  doctor: "doctor",
  gc: "gc"
});
var ALLOWED_EXECUTORS = Object.freeze({
  [JOB_MODE.local]: /* @__PURE__ */ new Set([EXECUTOR_KIND.local]),
  [JOB_MODE.blindAi]: /* @__PURE__ */ new Set([EXECUTOR_KIND.ai, EXECUTOR_KIND.local]),
  [JOB_MODE.deepBlind]: /* @__PURE__ */ new Set([EXECUTOR_KIND.ai, EXECUTOR_KIND.local]),
  [JOB_MODE.crossLineage]: /* @__PURE__ */ new Set([EXECUTOR_KIND.ai, EXECUTOR_KIND.local]),
  [JOB_MODE.disputeResolution]: /* @__PURE__ */ new Set([EXECUTOR_KIND.ai, EXECUTOR_KIND.local]),
  [JOB_MODE.doctorScan]: /* @__PURE__ */ new Set([EXECUTOR_KIND.doctor]),
  [JOB_MODE.doctorRepair]: /* @__PURE__ */ new Set([EXECUTOR_KIND.doctor]),
  [JOB_MODE.gc]: /* @__PURE__ */ new Set([EXECUTOR_KIND.gc])
});
var jobExecutionStack = [];
async function withJobExecutionContext(ctx, fn) {
  jobExecutionStack.push(ctx);
  try {
    return await fn();
  } finally {
    jobExecutionStack.pop();
  }
}
__name(withJobExecutionContext, "withJobExecutionContext");
function assertExecutorAllowedForJob(job, executorKind) {
  if (!Object.values(EXECUTOR_KIND).includes(executorKind)) {
    throw new JobError(`unknown executor kind: ${executorKind}`, { executorKind });
  }
  const allowed = ALLOWED_EXECUTORS[job.mode];
  if (!allowed || !allowed.has(executorKind)) {
    throw new JobError(
      `job mode "${job.mode}" must not run a "${executorKind}" executor`,
      { jobId: job.jobId, mode: job.mode, executorKind }
    );
  }
  return true;
}
__name(assertExecutorAllowedForJob, "assertExecutorAllowedForJob");
function settleBudgetIn(currentBudget, { granted = 0, spent = null } = {}) {
  const b = normalizeProviderBudget(currentBudget);
  const s = spent ?? {};
  const attempted = s.attemptedItems ?? 0;
  const unused = Math.max(0, granted - attempted);
  return {
    ...b,
    // 未使用予約の解放。使った分は reserved に残す（attempted <= reserved を維持）。
    reservedItems: Math.max(attempted, b.reservedItems - unused),
    reservedProviderCalls: Math.max(0, b.reservedProviderCalls - unused),
    attemptedItems: b.attemptedItems + attempted,
    successfulItems: b.successfulItems + (s.successfulItems ?? 0),
    providerCalls: b.providerCalls + (s.providerCalls ?? 0),
    retryCalls: b.retryCalls + (s.retryCalls ?? 0),
    estimatedInputTokens: b.estimatedInputTokens + (s.estimatedInputTokens ?? 0)
  };
}
__name(settleBudgetIn, "settleBudgetIn");
async function claimJob(db, jobId, {
  owner = OWNER_TOKEN,
  ttlMs = JOB_POLICY.leaseTtlMs,
  steal = false,
  now = Date.now()
} = {}) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => {
    const job = await requestOf(tx.objectStore(STORE.jobs).get(jobId));
    if (!job) throw new JobError(`claimJob: job not found ${jobId}`, { jobId });
    if (TERMINAL_STATES.has(job.state)) {
      throw new JobError(`claimJob: job is ${job.state}`, { jobId, state: job.state });
    }
    const leased = await acquireJobLease(tx, jobId, { owner, ttlMs, now, steal });
    const next = {
      ...leased,
      state: JOB_STATE.running,
      startedAt: leased.startedAt ?? now,
      updatedAt: now
    };
    await requestOf(tx.objectStore(STORE.jobs).put(next));
    return next;
  }, { bumpRevision: false });
  return { job: result, owner, leaseEpoch: result.leaseEpoch };
}
__name(claimJob, "claimJob");
async function releaseJob(db, jobId, { owner = OWNER_TOKEN, leaseEpoch, now = Date.now() } = {}) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => releaseJobLease(tx, jobId, { owner, leaseEpoch, now }), { bumpRevision: false });
  return result;
}
__name(releaseJob, "releaseJob");
async function setJobState(db, jobId, state, { now = Date.now(), patch = {} } = {}) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => {
    const job = await requestOf(tx.objectStore(STORE.jobs).get(jobId));
    if (!job) throw new JobError(`job not found ${jobId}`, { jobId });
    if (TERMINAL_STATES.has(job.state) && job.state !== state) {
      throw new JobError(`job already ${job.state}`, { jobId, state: job.state });
    }
    const next = {
      ...job,
      ...patch,
      state,
      updatedAt: now,
      ...TERMINAL_STATES.has(state) ? { finishedAt: now } : {}
    };
    await requestOf(tx.objectStore(STORE.jobs).put(next));
    return next;
  }, { bumpRevision: false });
  return result;
}
__name(setJobState, "setJobState");
function pauseJob(db, jobId, opts = {}) {
  return setJobState(db, jobId, JOB_STATE.paused, opts);
}
__name(pauseJob, "pauseJob");
async function selectChunk(db, {
  storeName = STORE.claims,
  indexName = null,
  query = null,
  cursor = null,
  limit = JOB_POLICY.selectionPageSize,
  filter = null
} = {}) {
  const page = await iterateIndex(db, { storeName, indexName, query, cursor, limit });
  const items = filter ? page.items.filter(filter) : page.items;
  return { items, scanned: page.items.length, nextCursor: page.nextCursor, done: page.done };
}
__name(selectChunk, "selectChunk");
var nextTick = /* @__PURE__ */ __name(() => new Promise((r) => setTimeout(r, 0)), "nextTick");
async function runJobChunks(db, jobId, {
  select,
  prepare = /* @__PURE__ */ __name(async (items) => items, "prepare"),
  commit = null,
  owner = OWNER_TOKEN,
  leaseEpoch = null,
  ttlMs = JOB_POLICY.leaseTtlMs,
  maxChunks = JOB_POLICY.maxChunksPerRun,
  bumpRevision = false,
  policyMismatchAction = null,
  /**
   * この Job が実行してよい executor の種類（§141 Phase 7 の mode 拘束）。
   * `EXECUTOR_KIND.local` 既定。AI を走らせる呼び出しは `ai` を宣言する必要があり、
   * local / doctor / gc mode の Job では `assertExecutorAllowedForJob()` が throw する。
   */
  executorKind = EXECUTOR_KIND.local,
  /**
   * B2: item mutation を checkpoint と同一 transaction で commit するために
   * 開く追加 Store。既定は空（checkpoint だけの Job）。
   */
  commitStores = [],
  now = /* @__PURE__ */ __name(() => Date.now(), "now"),
  yieldFn = JOB_POLICY.yieldBetweenChunks ? nextTick : null
} = {}) {
  if (typeof select !== "function") throw new JobError("runJobChunks: select is required");
  const raw = await getJob(db, jobId);
  if (!raw) throw new JobError(`job not found ${jobId}`, { jobId });
  let job = validateJobRecord(raw, { now: now(), forExecution: true });
  assertExecutorAllowedForJob(job, executorKind);
  const meta = await runRead(db, [STORE.meta], ({ store }) => requestOf(store(STORE.meta).get("meta")));
  const recordedProfileId = job.policySnapshot?.promptProfileId ?? null;
  const currentProfile = recordedProfileId ? PROMPT_PROFILES_BY_ID[recordedProfileId] ?? { promptProfileId: recordedProfileId, promptVersion: null } : { promptProfileId: null, promptVersion: null };
  const current = await buildPolicySnapshot(meta, { profile: currentProfile });
  const policy = comparePolicySnapshot(job, current);
  if (!policy.match) {
    const action = policyMismatchAction ?? policy.suggestedAction;
    if (action === POLICY_MISMATCH_ACTION.pause) {
      const paused = await pauseJob(db, jobId, {
        now: now(),
        patch: { error: { kind: "policy_snapshot_mismatch", differences: policy.differences } }
      });
      return { job: paused, chunks: 0, stopped: "policy_mismatch", policy };
    }
    if (action === POLICY_MISMATCH_ACTION.redoLocal) {
      job = await restartLocalJobUnderCurrentPolicy(db, jobId, current, { now: now() });
    }
    if (action === POLICY_MISMATCH_ACTION.restart) {
      return { job, chunks: 0, stopped: "policy_mismatch_restart_required", policy };
    }
  }
  let epoch = leaseEpoch;
  if (epoch === null) {
    const claimed = await claimJob(db, jobId, { owner, ttlMs, now: now() });
    job = claimed.job;
    epoch = claimed.leaseEpoch;
  } else {
    job = await setJobState(db, jobId, JOB_STATE.running, { now: now() });
  }
  let cursor = job.cursor;
  let chunks = 0;
  let stopped = "completed";
  let finalRescanPasses = 0;
  try {
    for (; ; ) {
      if (chunks >= maxChunks) {
        stopped = "max_chunks";
        break;
      }
      const live = await getJob(db, jobId);
      if (!live) throw new JobError(`job vanished ${jobId}`, { jobId });
      if (live.state === JOB_STATE.paused) {
        stopped = "paused";
        job = live;
        break;
      }
      if (live.state === JOB_STATE.cancelled) {
        stopped = "cancelled";
        job = live;
        break;
      }
      const ctx = { job: live, jobId, owner, leaseEpoch: epoch, cursor };
      const page = await select(cursor, ctx);
      const items = page.items ?? [];
      if (items.length === 0 && page.done) {
        const rescan = await shouldFinalRescan(db, live, { passes: finalRescanPasses });
        if (rescan.needed) {
          finalRescanPasses++;
          cursor = null;
          job = await markFinalRescanStarted(db, jobId, {
            owner,
            leaseEpoch: epoch,
            now: now(),
            selectionRevision: rescan.currentRevision
          });
          continue;
        }
        break;
      }
      const chunkMutationId = await deterministicChunkMutationId(job, cursor);
      const prepared = items.length ? await withJobExecutionContext(
        { jobId, executorKind, owner, leaseEpoch: epoch, mode: job.mode, type: job.type },
        () => prepare(items, {
          ...ctx,
          chunkMutationId,
          /**
           * §93 / §93.1: Undo scope key は **Job の rootMutationId**。
           * `chunkMutationId`（§45.5）は transaction commit の識別子であって
           * batch/run Undo の scope ではない。両方を渡し、どちらを使うかを
           * 呼び出し側の読み手に明示する。
           */
          rootMutationId: job.rootMutationId ?? null,
          runId: job.revalidationRunId
        })
      ) : null;
      const t = now();
      const stores = [STORE.jobs];
      const { result } = await runSemanticMutation(db, stores, async ({ tx }) => {
        const fenced = await assertJobFence(tx, jobId, { owner, leaseEpoch: epoch, now: t });
        const cancelled = fenced.state === JOB_STATE.cancelled;
        let delta = { processed: items.length, changed: 0, failed: 0, staleResponses: 0 };
        if (commit && prepared !== null && !cancelled) {
          const out = await commit(prepared, { tx, job: fenced, chunkMutationId, owner, leaseEpoch: epoch });
          delta = {
            processed: out?.processed ?? items.length,
            changed: out?.changed ?? 0,
            failed: out?.failed ?? 0,
            staleResponses: out?.staleResponses ?? 0
          };
        } else if (cancelled) {
          delta = { processed: 0, changed: 0, failed: 0, staleResponses: 0 };
        }
        const checkpoint = {
          ...fenced,
          cursor: cancelled ? fenced.cursor : page.done ? null : page.nextCursor,
          lastProcessedKey: cancelled ? fenced.lastProcessedKey : lastKeyOf(items, page),
          counts: {
            total: Math.max(
              fenced.counts?.total ?? 0,
              (fenced.counts?.processed ?? 0) + delta.processed
            ),
            processed: (fenced.counts?.processed ?? 0) + delta.processed,
            changed: (fenced.counts?.changed ?? 0) + delta.changed,
            failed: (fenced.counts?.failed ?? 0) + delta.failed,
            staleResponses: (fenced.counts?.staleResponses ?? 0) + delta.staleResponses
          },
          // B1: 実消費を durable に記録し、未使用の予約を解放する。
          providerBudget: settleBudgetIn(fenced.providerBudget, {
            granted: prepared?.budgetGranted ?? 0,
            spent: prepared?.budgetSpent ?? null
          }),
          lastChunkMutationId: chunkMutationId,
          committedChunks: (fenced.committedChunks ?? 0) + (cancelled ? 0 : 1),
          leaseExpiresAt: t + ttlMs,
          // chunk commit を heartbeat 兼用にする
          updatedAt: t
        };
        await requestOf(tx.objectStore(STORE.jobs).put(checkpoint));
        return { skipped: cancelled, job: checkpoint, discarded: cancelled };
      }, { bumpRevision, extraStores: commitStores });
      if (result.skipped) {
        stopped = result.job.state;
        job = result.job;
        break;
      }
      job = result.job;
      chunks++;
      cursor = job.cursor;
      if (job.state === JOB_STATE.paused || job.state === JOB_STATE.cancelled) {
        stopped = job.state;
        break;
      }
      if (page.done && cursor === null) {
        const rescan = await shouldFinalRescan(db, job, { passes: finalRescanPasses });
        if (rescan.needed) {
          finalRescanPasses++;
          cursor = null;
          job = await markFinalRescanStarted(db, jobId, {
            owner,
            leaseEpoch: epoch,
            now: now(),
            selectionRevision: rescan.currentRevision
          });
          continue;
        }
        break;
      }
      if (yieldFn) await yieldFn();
    }
    if (stopped === "completed") {
      const residual = await detectResidualSelectionChange(db, job, finalRescanPasses);
      job = await finishJob(db, jobId, { owner, leaseEpoch: epoch, now: now(), residual });
    } else {
      await releaseJob(db, jobId, { owner, leaseEpoch: epoch, now: now() }).then((released) => {
        job = released;
      }).catch(() => {
      });
    }
  } catch (e) {
    if (e instanceof LeaseError) {
      return { job: await getJob(db, jobId), chunks, stopped: "fenced_out", error: e };
    }
    await setJobState(db, jobId, JOB_STATE.failed, {
      now: now(),
      patch: { error: { kind: "job_failed", message: String(e?.message ?? e) } }
    }).catch(() => {
    });
    throw e;
  }
  return { job, chunks, stopped, policy };
}
__name(runJobChunks, "runJobChunks");
function lastKeyOf(items, page) {
  if (page?.nextCursor?.primaryKey !== void 0) return page.nextCursor.primaryKey;
  const last = items[items.length - 1];
  return last?.claimId ?? last?.evidenceId ?? last?.resolutionKey ?? last?.jobId ?? null;
}
__name(lastKeyOf, "lastKeyOf");
async function deterministicChunkMutationId(job, cursor) {
  const startKey = cursor?.primaryKey ?? cursor?.indexKey ?? null;
  const h = await stableHash({
    schema: "job-chunk-mutation",
    jobId: job.jobId,
    rootMutationId: job.rootMutationId ?? null,
    startKey: startKey === null ? null : String(startKey)
  });
  return `${ID_PREFIXES.mutation}:chunk:${h}`;
}
__name(deterministicChunkMutationId, "deterministicChunkMutationId");
async function detectResidualSelectionChange(db, job, passes) {
  if (!job?.requiresFinalRescan) return null;
  const meta = await runRead(db, [STORE.meta], ({ store }) => requestOf(store(STORE.meta).get("meta")));
  const currentRevision = meta?.userDictionaryRevision ?? 0;
  if (currentRevision === job.selectionRevision) return null;
  return { residualSelectionChange: true, residualSelectionRevision: currentRevision, passes };
}
__name(detectResidualSelectionChange, "detectResidualSelectionChange");
async function shouldFinalRescan(db, job, { passes = 0 } = {}) {
  const meta = await runRead(db, [STORE.meta], ({ store }) => requestOf(store(STORE.meta).get("meta")));
  const currentRevision = meta?.userDictionaryRevision ?? 0;
  if (!job?.requiresFinalRescan) return { needed: false, currentRevision, reason: "not_requested" };
  if (passes >= JOB_POLICY.maxFinalRescanPasses) {
    return { needed: false, currentRevision, reason: "max_passes" };
  }
  if (currentRevision === job.selectionRevision) {
    return { needed: false, currentRevision, reason: "selection_stable" };
  }
  return { needed: true, currentRevision, reason: "selection_changed" };
}
__name(shouldFinalRescan, "shouldFinalRescan");
async function markFinalRescanStarted(db, jobId, { owner, leaseEpoch, now, selectionRevision }) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => {
    const job = await assertJobFence(tx, jobId, { owner, leaseEpoch, now });
    const next = {
      ...job,
      cursor: null,
      selectionRevision,
      finalRescanDone: true,
      updatedAt: now
    };
    await requestOf(tx.objectStore(STORE.jobs).put(next));
    return next;
  }, { bumpRevision: false });
  return result;
}
__name(markFinalRescanStarted, "markFinalRescanStarted");
async function finishJob(db, jobId, { owner, leaseEpoch, now, residual = null }) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => {
    const job = await assertJobFence(tx, jobId, { owner, leaseEpoch, now });
    const next = {
      ...job,
      state: JOB_STATE.completed,
      cursor: null,
      finishedAt: now,
      updatedAt: now,
      // §45.4: rescan 上限後も残った selection 変更を明示 checkpoint する。
      residualSelectionChange: residual?.residualSelectionChange === true,
      residualSelectionRevision: residual?.residualSelectionRevision ?? null,
      // §120-48: release でも epoch は維持する。
      leaseOwner: null,
      leaseExpiresAt: null
    };
    await requestOf(tx.objectStore(STORE.jobs).put(next));
    return next;
  }, { bumpRevision: false });
  return result;
}
__name(finishJob, "finishJob");
async function restartLocalJobUnderCurrentPolicy(db, jobId, snapshot, { now }) {
  const { result } = await runSemanticMutation(db, [STORE.jobs], async ({ tx, meta }) => {
    const job = await requestOf(tx.objectStore(STORE.jobs).get(jobId));
    const next = {
      ...job,
      policySnapshot: snapshot,
      cursor: null,
      lastProcessedKey: null,
      selectionRevision: meta.userDictionaryRevision ?? 0,
      counts: { total: 0, processed: 0, changed: 0, failed: 0, staleResponses: 0 },
      updatedAt: now,
      error: null
    };
    await requestOf(tx.objectStore(STORE.jobs).put(next));
    return next;
  }, { bumpRevision: false });
  return result;
}
__name(restartLocalJobUnderCurrentPolicy, "restartLocalJobUnderCurrentPolicy");

// dictionary-revalidation.js
var REVALIDATION_MODE = Object.freeze({
  /** §46.1 API なし。Evidence / Dependency 再集計だけ。 */
  local: "local",
  /** §46.2 現在候補を見せず AI へ再質問。 */
  blindAi: "blind_ai",
  /** §46.2.1 加えて過去の language / role 推論も見せない。 */
  deepBlind: "deep_blind",
  /** §46.3 別 independenceGroup / modelLineageId を優先。 */
  crossLineage: "cross_lineage",
  /** §46.4 複数候補を見せて比較させる anchored モード。 */
  disputeResolution: "dispute_resolution"
});
var AI_MODES = Object.freeze(/* @__PURE__ */ new Set([
  REVALIDATION_MODE.blindAi,
  REVALIDATION_MODE.deepBlind,
  REVALIDATION_MODE.crossLineage,
  REVALIDATION_MODE.disputeResolution
]));
var REVALIDATION_PRESET = Object.freeze({
  light: "light",
  standard: "standard",
  thorough: "thorough"
});
var REVALIDATION_POLICY = Object.freeze({
  revalidationPolicyVersion: 1,
  /** §109 preset → mode / AI 利用。 */
  presets: Object.freeze({
    [REVALIDATION_PRESET.light]: Object.freeze({
      mode: REVALIDATION_MODE.local,
      useAi: false,
      crossProvider: false,
      description: "API なし。Evidence 再計算のみ。"
    }),
    [REVALIDATION_PRESET.standard]: Object.freeze({
      mode: REVALIDATION_MODE.blindAi,
      useAi: true,
      crossProvider: false,
      description: "怪しい項目だけ AI 再確認。"
    }),
    [REVALIDATION_PRESET.thorough]: Object.freeze({
      mode: REVALIDATION_MODE.crossLineage,
      useAi: true,
      /** §147.4:「高Risk / conflict / explicit thorough revalidation」のみ。 */
      crossProvider: true,
      description: "高Risk 項目を別 Provider も含め検証。"
    })
  }),
  /**
   * §147.3:「AI が必要な高Risk項目だけ抽出」の閾値。
   * risk はここでだけ threshold と比較する（Confidence Policy へ混ぜない・§44）。
   */
  highRiskThreshold: 0.6,
  /** §46.2.1:「高Riskでは確定Context中心」— この risk 以上は Deep Blind を勧める。 */
  deepBlindRiskThreshold: 1.2,
  /** §46.3 / §147.4: Cross-lineage を勧める risk。 */
  crossLineageRiskThreshold: 1.6,
  /**
   * §44 uncertainty の導出。
   *
   * §26:「Confidence は確率と呼ばない」。`confidenceScore` は 0〜100 の
   * **重み合計** であって 1-p ではないので、`1 - confidenceScore` を
   * uncertainty にしてはいけない。§30 の意味軸（trustTier / Quality Gate /
   * conflict / revalidationState）から導く。
   */
  uncertaintyByTrustTier: Object.freeze({
    trusted: 0.15,
    learned: 0.5,
    provisional: 0.85
  }),
  /** §30 Trust Quality Gate 未通過は上げる。 */
  qualityGateFailedPenalty: 0.1,
  /** §11.7 claim-level conflict は最優先で再検証したい。 */
  conflictedUncertaintyFloor: 0.9,
  /** §11.2 revalidationState=needed は明示的に「再検証が要る」状態。 */
  revalidationNeededUncertaintyFloor: 0.7,
  /** contradict Evidence があるだけで uncertainty を底上げする。 */
  contradictedUncertaintyFloor: 0.8,
  /** Local Revalidation の chunk。§47「数百件程度 → checkpoint」。 */
  localChunkSize: 200,
  /** 選択 scan の page size。§148.2 bounded。 */
  selectionPageSize: 200,
  /**
   * 選択 scan が走査してよい record 数の上限。
   * §45.4:「UIの total は snapshot exact count ではなく estimate になり得る」。
   */
  maxSelectionScan: 5e3
});
var RevalidationError = class extends Error {
  static {
    __name(this, "RevalidationError");
  }
  constructor(message, details) {
    super(message);
    this.name = "RevalidationError";
    this.details = details;
  }
};
function requestOf2(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf2, "requestOf");
async function countEvidenceForClaim(db, claimId) {
  return runRead(db, [STORE.evidence], ({ store }) => requestOf2(store(STORE.evidence).index("claimId").count(IDBKeyRange.only(claimId))));
}
__name(countEvidenceForClaim, "countEvidenceForClaim");
function claimUncertainty(claim) {
  const p = REVALIDATION_POLICY;
  let u = p.uncertaintyByTrustTier[claim?.trustTier] ?? p.uncertaintyByTrustTier.provisional;
  const summary = claim?.evidenceSummary ?? {};
  if (summary.qualityGate && summary.qualityGate.passed === false) u += p.qualityGateFailedPenalty;
  if ((summary.contradictCount ?? 0) > 0) u = Math.max(u, p.contradictedUncertaintyFloor);
  if (claim?.revalidationState === REVALIDATION_STATE.needed) {
    u = Math.max(u, p.revalidationNeededUncertaintyFloor);
  }
  if (claim?.conflictState === CONFLICT_STATE.conflicted) {
    u = Math.max(u, p.conflictedUncertaintyFloor);
  }
  return Math.min(1, Math.max(0, u));
}
__name(claimUncertainty, "claimUncertainty");
function claimRiskFromMaterializedFields(claim, { staleLineage = false } = {}) {
  const summary = claim.evidenceSummary ?? {};
  const provenanceRisk = computeProvenanceRisk({
    sameGenerationReach: summary.distinctEntities ?? 0,
    independenceGroupCount: summary.independenceGroups ?? 0,
    staleLineage,
    // §120-42: unknown lineage しか無い Claim は独立確認済みとみなさない。
    unknownLineage: (summary.knownLineageIds?.length ?? 0) === 0 && (summary.unknownLineageGroups ?? 0) > 0
  });
  const uncertainty = claimUncertainty(claim);
  return computeRiskScore({
    uncertainty,
    useCount: claim.useCount ?? 0,
    // Relation 逆引きは選択経路では行わない（bounded）。derived 依存数の近似。
    dependentCount: summary.distinctEntities ?? 0,
    conflictWeight: claim.conflictState === CONFLICT_STATE.conflicted ? 2 : 1,
    provenanceRisk,
    manualLocked: claim.locked === true
  });
}
__name(claimRiskFromMaterializedFields, "claimRiskFromMaterializedFields");
function isRevalidationCandidate(claim) {
  if (!claim) return false;
  if (claim.deletedAt != null) return false;
  if (claim.disabled === true) return false;
  if (claim.quarantined === true) return false;
  if (claim.lifecycleState === LIFECYCLE_STATE.archived) return false;
  return true;
}
__name(isRevalidationCandidate, "isRevalidationCandidate");
async function selectRevalidationCandidates(db, {
  claimIds = null,
  selector = "needs_revalidation",
  limit = REVALIDATION_POLICY.maxSelectionScan,
  cursor = null,
  pageSize = REVALIDATION_POLICY.selectionPageSize
} = {}) {
  if (Array.isArray(claimIds)) {
    const items2 = [];
    await runRead(db, [STORE.claims], async ({ store }) => {
      for (const id of claimIds) {
        const c2 = await requestOf2(store(STORE.claims).get(id));
        if (isRevalidationCandidate(c2)) items2.push(c2);
      }
    });
    return { items: items2, scanned: claimIds.length, done: true, nextCursor: null };
  }
  const index = {
    needs_revalidation: { indexName: "revalidationState", key: REVALIDATION_STATE.needed },
    conflicted: { indexName: "conflictState", key: CONFLICT_STATE.conflicted },
    provisional: { indexName: "trustTier", key: TRUST_TIER.provisional }
  }[selector];
  if (!index) throw new RevalidationError(`unknown selector: ${selector}`, { selector });
  const items = [];
  let scanned = 0;
  let c = cursor;
  let done = false;
  while (items.length < limit) {
    const page = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName: index.indexName,
      query: c ? null : IDBKeyRange.only(index.key),
      cursor: c,
      limit: Math.min(pageSize, limit - items.length)
    });
    scanned += page.items.length;
    for (const claim of page.items) if (isRevalidationCandidate(claim)) items.push(claim);
    if (page.done) {
      done = true;
      c = null;
      break;
    }
    c = page.nextCursor;
  }
  return { items, scanned, done, nextCursor: c };
}
__name(selectRevalidationCandidates, "selectRevalidationCandidates");
function estimatePromptTokensForClaim(claim, {
  mode = REVALIDATION_MODE.blindAi,
  policy = AI_POLICY
} = {}) {
  const request = buildRevalidationRequest({ claim, mode });
  const built = buildPrompt(request, { profile: profileForMode(mode), policy });
  return estimateTokens(built.promptText);
}
__name(estimatePromptTokensForClaim, "estimatePromptTokensForClaim");
function profileForMode(mode) {
  switch (mode) {
    case REVALIDATION_MODE.blindAi:
    case REVALIDATION_MODE.crossLineage:
      return PROMPT_PROFILE.blindRevalidate;
    case REVALIDATION_MODE.deepBlind:
      return PROMPT_PROFILE.deepBlindRevalidate;
    case REVALIDATION_MODE.disputeResolution:
      return PROMPT_PROFILE.disputeResolution;
    case REVALIDATION_MODE.local:
      throw new RevalidationError("§46.1: local revalidation has no prompt profile", { mode });
    default:
      throw new RevalidationError(`unknown revalidation mode: ${mode}`, { mode });
  }
}
__name(profileForMode, "profileForMode");
function buildRevalidationRequest({
  claim,
  mode = REVALIDATION_MODE.blindAi,
  runId = null,
  currentCandidates = [],
  fullPhrase = null,
  languageHint = null,
  roleHint = null,
  knownSegments = []
} = {}) {
  if (!claim) throw new RevalidationError("buildRevalidationRequest: claim is required");
  const profile = profileForMode(mode);
  const sourceText = claim.sourceText ?? claim.normalizedSource ?? "";
  if (!sourceText) {
    throw new RevalidationError(
      "buildRevalidationRequest: claim has no source text",
      { claimId: claim.claimId }
    );
  }
  const segmentId = "s0";
  const anchored = profile.anchored === true;
  const forbidden = anchored ? [] : blindForbiddenValues(claim);
  const safeKnownSegments = anchored ? knownSegments : (knownSegments ?? []).filter((k) => !leaksForbidden(k?.reading, forbidden) && !leaksForbidden(k?.text, forbidden));
  const requestedFullPhrase = fullPhrase ?? sourceText;
  const safeFullPhrase = anchored || !leaksForbidden(requestedFullPhrase, forbidden) ? requestedFullPhrase : sourceText;
  const safeLanguageHint = leaksForbidden(languageHint, forbidden) ? null : languageHint;
  const safeRoleHint = leaksForbidden(roleHint, forbidden) ? null : roleHint;
  return {
    requestItemId: `reval:${claim.claimId}`,
    revalidationRunId: runId,
    target: claim.target ?? targetFromSubjectKey(claim.subjectKey),
    countryCode: claim.countryCode ?? claim.contextHints?.countryCode ?? null,
    worldRegionCode: claim.worldRegionCode ?? null,
    requestedSegmentIds: [segmentId],
    sourceSpans: [{ segmentId, text: sourceText }],
    // §46.2.1:「Full Phrase / Target / 確定 Country」は確定 Fact なので Deep Blind でも渡す。
    fullPhrase: safeFullPhrase,
    // profile.exposeInferredHints=false（Deep Blind）ならこの3つは Prompt へ載らない。
    languageHint: safeLanguageHint,
    roleHint: safeRoleHint,
    knownSegments: safeKnownSegments,
    // §24.1: Blind では rejected を渡さない（profile 側でも落とすが、ここでも渡さない）。
    rejectedValues: [],
    // §46.4 / §23.1: 候補を見せるのは anchored profile だけ。
    seededCandidates: anchored ? currentCandidates : [],
    anchored,
    /** 落とした leak の件数（診断用。0 が期待値）。 */
    blindGuard: anchored ? null : {
      droppedKnownSegments: (knownSegments ?? []).length - safeKnownSegments.length,
      droppedFullPhrase: safeFullPhrase !== requestedFullPhrase,
      droppedLanguageHint: safeLanguageHint !== languageHint,
      droppedRoleHint: safeRoleHint !== roleHint
    },
    promptProfileId: profile.promptProfileId,
    promptVersion: profile.promptVersion
  };
}
__name(buildRevalidationRequest, "buildRevalidationRequest");
function blindForbiddenValues(claim) {
  const out = [];
  for (const v of [claim.value, claim.normalizedValue, claim.foldedValue]) {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}
__name(blindForbiddenValues, "blindForbiddenValues");
function leaksForbidden(text, forbidden) {
  if (!forbidden.length) return false;
  const s = String(text ?? "");
  if (!s) return false;
  return forbidden.some((v) => s.includes(v));
}
__name(leaksForbidden, "leaksForbidden");
function targetFromSubjectKey(subjectKey) {
  if (typeof subjectKey !== "string") return null;
  const m = /^entity:(club|comp|player|stadium):/.exec(subjectKey);
  return m ? m[1] : null;
}
__name(targetFromSubjectKey, "targetFromSubjectKey");

// dictionary-cache-retention.js
var CACHE_RETENTION_DEFAULT_ON = false;
var CACHE_RETENTION_POLICY = Object.freeze({
  /** この module の policy/version fingerprint 成分。挙動を変えたら上げる。 */
  cacheRetentionPolicyVersion: 1,
  /** scan の chunk（§148.2 全件を Memory へ載せない）。 */
  chunkSize: 500,
  /** 1 transaction あたりの delete 件数（§92 巨大 transaction を作らない）。 */
  deleteBatchSize: 200,
  /**
   * 1 回の plan が走査してよい row 数の上限。超えたら `partial:true` で打ち切る。
   * 全件 scan を無条件に走らせない（§89.1）。
   */
  scanCap: 5e4,
  /** 1 回の plan が削除候補として抱えてよい row 数の上限（bounded memory）。 */
  maxPlannedDeletes: 1e4,
  /**
   * `idle_lru` class の閾値。これより長く一度も使われていない **有効** な行を
   * 削除候補にする。Cache は正本ではないので再計算で同じ答えが出る。
   */
  idleTtlMs: 30 * 24 * 60 * 60 * 1e3,
  /**
   * `over_row_cap` class の閾値。有効な行がこれを超えたら lastUsedAt の古い順に
   * 超過分を削除候補にする。
   */
  maxRows: 5e4
});
var CACHE_RETENTION_CLASS = Object.freeze({
  /** §87.4: 現在の resolutionPolicyFingerprint と異なる = 二度と hit しない。 */
  staleFingerprint: "stale_policy_fingerprint",
  /** 有効だが idleTtlMs 以上使われていない。 */
  idle: "idle_lru",
  /** 有効だが maxRows 超過分（lastUsedAt 古い順）。 */
  overCap: "over_row_cap"
});
var CacheRetentionError = class extends Error {
  static {
    __name(this, "CacheRetentionError");
  }
  constructor(message, details) {
    super(message);
    this.name = "CacheRetentionError";
    this.details = details;
  }
};
function cacheRetentionFingerprint(resolutionFingerprint) {
  const v = CACHE_RETENTION_POLICY.cacheRetentionPolicyVersion;
  return "cache-retention:v" + v + ":" + resolutionFingerprint;
}
__name(cacheRetentionFingerprint, "cacheRetentionFingerprint");
function requestOf3(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf3, "requestOf");
function isEnabled(enabled) {
  return enabled === void 0 ? CACHE_RETENTION_DEFAULT_ON : enabled === true;
}
__name(isEnabled, "isEnabled");
var MIN_CHUNK_SIZE = 2;
function clampChunkSize(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : CACHE_RETENTION_POLICY.chunkSize;
  if (v < MIN_CHUNK_SIZE) return MIN_CHUNK_SIZE;
  return v;
}
__name(clampChunkSize, "clampChunkSize");
function emptyByClass() {
  return {
    [CACHE_RETENTION_CLASS.staleFingerprint]: 0,
    [CACHE_RETENTION_CLASS.idle]: 0,
    [CACHE_RETENTION_CLASS.overCap]: 0
  };
}
__name(emptyByClass, "emptyByClass");
function classifyCacheRow(row, { currentFingerprint, now, idleTtlMs }) {
  if (!row) return null;
  if (row.resolutionPolicyFingerprint !== currentFingerprint) {
    return CACHE_RETENTION_CLASS.staleFingerprint;
  }
  const lastUsedAt = Number.isFinite(row.lastUsedAt) ? row.lastUsedAt : null;
  if (lastUsedAt !== null && now - lastUsedAt >= idleTtlMs) {
    return CACHE_RETENTION_CLASS.idle;
  }
  return null;
}
__name(classifyCacheRow, "classifyCacheRow");
async function planCacheRetentionGc(db, {
  now = Date.now(),
  enabled,
  meta = null,
  idleTtlMs = CACHE_RETENTION_POLICY.idleTtlMs,
  maxRows = CACHE_RETENTION_POLICY.maxRows,
  scanCap = CACHE_RETENTION_POLICY.scanCap,
  chunkSize = CACHE_RETENTION_POLICY.chunkSize,
  maxPlannedDeletes = CACHE_RETENTION_POLICY.maxPlannedDeletes
} = {}) {
  if (!isEnabled(enabled)) {
    return {
      readOnly: true,
      enabled: false,
      mutations: 0,
      scanned: 0,
      partial: false,
      deletes: [],
      byClass: emptyByClass(),
      totalRows: null,
      currentFingerprint: null,
      retentionFingerprint: null,
      idleTtlMs,
      maxRows,
      plannedAt: now
    };
  }
  const effective = effectivePolicyMeta(meta ?? await getMeta(db));
  const currentFingerprint = await resolutionPolicyFingerprint(effective);
  const deletes = [];
  const byClass = emptyByClass();
  const effectiveChunkSize = clampChunkSize(chunkSize);
  let scanned = 0;
  let partial = false;
  let totalRows = 0;
  const keepers = [];
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, { storeName: STORE.cache, limit: effectiveChunkSize, cursor });
    for (const row of page.items) {
      scanned += 1;
      totalRows += 1;
      const cls = classifyCacheRow(row, { currentFingerprint, now, idleTtlMs });
      if (cls) {
        if (deletes.length < maxPlannedDeletes) {
          deletes.push({ resolutionKey: row.resolutionKey, class: cls });
          byClass[cls] += 1;
        } else {
          partial = true;
        }
      } else if (keepers.length < maxPlannedDeletes + maxRows) {
        keepers.push({ resolutionKey: row.resolutionKey, lastUsedAt: row.lastUsedAt ?? 0 });
      } else {
        partial = true;
      }
    }
    if (page.done) break;
    if (scanned >= scanCap) {
      partial = true;
      break;
    }
    cursor = page.nextCursor;
  }
  if (!partial && keepers.length > maxRows) {
    keepers.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const excess = keepers.slice(0, keepers.length - maxRows);
    for (const k of excess) {
      if (deletes.length >= maxPlannedDeletes) {
        partial = true;
        break;
      }
      deletes.push({ resolutionKey: k.resolutionKey, class: CACHE_RETENTION_CLASS.overCap });
      byClass[CACHE_RETENTION_CLASS.overCap] += 1;
    }
  }
  return {
    readOnly: true,
    enabled: true,
    mutations: 0,
    scanned,
    partial,
    totalRows,
    deletes,
    byClass,
    currentFingerprint,
    retentionFingerprint: cacheRetentionFingerprint(currentFingerprint),
    idleTtlMs,
    maxRows,
    chunkSize: effectiveChunkSize,
    maxPlannedDeletes,
    plannedAt: now
  };
}
__name(planCacheRetentionGc, "planCacheRetentionGc");
async function runCacheRetentionGc(db, plan, {
  confirm = false,
  enabled,
  now = Date.now(),
  meta = null
} = {}) {
  if (confirm !== true) {
    throw new CacheRetentionError("§108: cache retention GC requires an explicit confirm:true");
  }
  if (!isEnabled(enabled)) {
    throw new CacheRetentionError("cache retention GC is disabled by feature flag", {
      featureFlag: "CACHE_RETENTION_DEFAULT_ON",
      value: CACHE_RETENTION_DEFAULT_ON
    });
  }
  if (!plan || plan.readOnly !== true) {
    throw new CacheRetentionError("runCacheRetentionGc requires a plan from planCacheRetentionGc()", {});
  }
  if (plan.enabled !== true) {
    throw new CacheRetentionError("plan was produced with the feature flag OFF", {});
  }
  const effective = effectivePolicyMeta(meta ?? await getMeta(db));
  const currentFingerprint = await resolutionPolicyFingerprint(effective);
  const idleTtlMs = plan.idleTtlMs ?? CACHE_RETENTION_POLICY.idleTtlMs;
  const planned = plan.deletes ?? [];
  const removedByClass = emptyByClass();
  const skipped = [];
  let removed = 0;
  for (let i = 0; i < planned.length; i += CACHE_RETENTION_POLICY.deleteBatchSize) {
    const slice = planned.slice(i, i + CACHE_RETENTION_POLICY.deleteBatchSize);
    await runSemanticMutation(db, [STORE.cache], async ({ tx }) => {
      const store = tx.objectStore(STORE.cache);
      for (const item of slice) {
        const row = await requestOf3(store.get(item.resolutionKey));
        if (!row) {
          skipped.push({ resolutionKey: item.resolutionKey, reason: "already_absent" });
          continue;
        }
        if (item.class === CACHE_RETENTION_CLASS.overCap) {
          if (row.resolutionPolicyFingerprint !== currentFingerprint) {
            await requestOf3(store.delete(item.resolutionKey));
            removed += 1;
            removedByClass[CACHE_RETENTION_CLASS.staleFingerprint] += 1;
            continue;
          }
          if (Number.isFinite(row.lastUsedAt) && row.lastUsedAt > (plan.plannedAt ?? 0)) {
            skipped.push({ resolutionKey: item.resolutionKey, reason: "used_since_plan" });
            continue;
          }
          await requestOf3(store.delete(item.resolutionKey));
          removed += 1;
          removedByClass[CACHE_RETENTION_CLASS.overCap] += 1;
          continue;
        }
        const cls = classifyCacheRow(row, { currentFingerprint, now, idleTtlMs });
        if (cls === null) {
          skipped.push({ resolutionKey: item.resolutionKey, reason: "no_longer_collectable" });
          continue;
        }
        await requestOf3(store.delete(item.resolutionKey));
        removed += 1;
        removedByClass[cls] += 1;
      }
    }, { bumpRevision: false });
  }
  return {
    readOnly: false,
    enabled: true,
    removed,
    removedByClass,
    skipped,
    plannedCount: planned.length,
    currentFingerprint,
    retentionFingerprint: cacheRetentionFingerprint(currentFingerprint),
    ranAt: now
  };
}
__name(runCacheRetentionGc, "runCacheRetentionGc");

// dictionary-doctor.js
var DOCTOR_POLICY = Object.freeze({
  doctorPolicyVersion: 1,
  /** §148.2: scan の chunk。全件を Memory へ載せない。 */
  chunkSize: 500,
  /** 1 check あたり報告する finding の上限（report 自体を巨大化させない）。 */
  maxFindingsPerCheck: 200,
  /** cycle 検出の深さ上限（§36 循環対策）。 */
  maxCycleDepth: 64,
  /** §108「大量duplicate retry Evidence」の閾値。 */
  duplicateRetryThreshold: 20,
  /** §101 安全自動GC: この日数より古い完了Jobを消してよい。 */
  completedJobRetentionDays: 30
});
var SEVERITY = Object.freeze({
  info: "info",
  warning: "warning",
  error: "error"
});
var REPAIR_KIND = Object.freeze({
  /** §108.1 Derived cache の再構築。意味を変えない。 */
  rebuildDerived: "rebuild_derived",
  /** §101 安全自動GC候補（expired cache / completed old jobs / expired leases）。 */
  safeGc: "safe_gc",
  /** 意味的 record を消す/書き換える。Maintenance Lease + 明示確認が要る。 */
  destructive: "destructive",
  /** 自動修復しない。人間の判断が要る。 */
  manualOnly: "manual_only"
});
var DoctorError = class extends Error {
  static {
    __name(this, "DoctorError");
  }
  constructor(message, details) {
    super(message);
    this.name = "DoctorError";
    this.details = details;
  }
};
function requestOf4(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf4, "requestOf");
var DOCTOR_CHECKS = Object.freeze([
  "dangling_evidence",
  "dangling_relation",
  "duplicate_semantic_key",
  "duplicate_edge_key",
  "depends_on_cycle",
  "replaces_cycle",
  "superseded_replaces_mismatch",
  "evidence_summary_mismatch",
  "score_cache_mismatch",
  "multiple_eligible_locked",
  "cache_selects_deleted_claim",
  "stale_cache_dependency",
  "cache_policy_fingerprint_mismatch",
  "invalid_entity_key",
  "invalid_typed_value",
  "invalid_applicability_constraints",
  "invalid_source_name_guard",
  "source_name_fingerprint_version_mismatch",
  "orphan_entity_claim",
  "duplicate_retry_evidence",
  "native_script_mismatch",
  "source_alias_invalid_subject",
  "derived_claim_missing_dependency",
  "derived_claim_policy_version_stale",
  "import_quarantine_residue",
  "expired_lease",
  "max_phrase_tokens_underestimate",
  // §140.4 追加検査
  "key_schema_version_mismatch",
  "invalid_score_revision_state",
  "dangling_transitive_dependency",
  "unknown_model_lineage_classification"
]);
async function runDoctorScan(db, {
  checks = DOCTOR_CHECKS,
  chunkSize = DOCTOR_POLICY.chunkSize,
  registry = DEFAULT_MODEL_LINEAGE_REGISTRY,
  now = Date.now()
} = {}) {
  const selected = checks.filter((c) => DOCTOR_CHECKS.includes(c));
  const unknown = checks.filter((c) => !DOCTOR_CHECKS.includes(c));
  if (unknown.length) throw new DoctorError(`unknown doctor checks: ${unknown.join(", ")}`, { unknown });
  const meta = await runRead(db, [STORE.meta], ({ store }) => requestOf4(store(STORE.meta).get("meta")));
  if (!meta) throw new DoctorError("runDoctorScan: dictionary_meta not initialised");
  const findings = [];
  const counts = {};
  const truncated = /* @__PURE__ */ new Set();
  const ctx = {
    db,
    meta,
    registry,
    now,
    chunkSize,
    emit(check, finding) {
      counts[check] = (counts[check] ?? 0) + 1;
      if (counts[check] > DOCTOR_POLICY.maxFindingsPerCheck) {
        truncated.add(check);
        return;
      }
      findings.push({ check, ...finding });
    }
  };
  const scanned = { claims: 0, evidence: 0, relations: 0, cache: 0, jobs: 0 };
  for (const check of selected) {
    await CHECK_IMPL[check](ctx, scanned);
  }
  const bySeverity = { info: 0, warning: 0, error: 0 };
  for (const f of findings) bySeverity[f.severity ?? SEVERITY.warning]++;
  const truncatedChecks = [...truncated];
  return {
    doctorPolicyVersion: DOCTOR_POLICY.doctorPolicyVersion,
    ranAt: now,
    /** §108:「デフォルトは Read-only Report」。 */
    readOnly: true,
    mutations: 0,
    checks: selected,
    findings,
    /** 検出 **総数**（report 表示数ではない）。 */
    counts,
    /** report が実際に載せている findings 数。counts と混同しない。 */
    reportedFindings: findings.length,
    totalFindings: Object.values(counts).reduce((n, v) => n + v, 0),
    truncatedChecks,
    /** 上限で切り詰めたか（§108 report を巨大化させない代わりに必ず明示する）。 */
    truncated: truncatedChecks.length > 0,
    incomplete: truncatedChecks.length > 0,
    maxFindingsPerCheck: DOCTOR_POLICY.maxFindingsPerCheck,
    bySeverity,
    scanned,
    /**
     * 切り詰めが起きた時点で「error 0 だから健康」とは言えない。
     * 表示していない findings に error がある可能性があるため、
     * truncation 中は healthy を立てない。
     */
    healthy: bySeverity.error === 0 && truncatedChecks.length === 0,
    /** B5: plan の staleness 判定に使う DB state identity。 */
    stateIdentity: await captureStateIdentity(db, meta)
  };
}
__name(runDoctorScan, "runDoctorScan");
async function captureStateIdentity(db, meta) {
  const m = effectivePolicyMeta(meta);
  const counts = {};
  await runRead(
    db,
    [STORE.claims, STORE.evidence, STORE.relations, STORE.cache, STORE.jobs],
    async ({ store }) => {
      counts.claims = await requestOf4(store(STORE.claims).count());
      counts.evidence = await requestOf4(store(STORE.evidence).count());
      counts.relations = await requestOf4(store(STORE.relations).count());
      counts.cache = await requestOf4(store(STORE.cache).count());
      counts.jobs = await requestOf4(store(STORE.jobs).count());
    }
  );
  return {
    installationId: m.installationId ?? null,
    userDictionaryRevision: m.userDictionaryRevision ?? 0,
    packageStateRevision: m.packageStateRevision ?? 0,
    schemaCompatibilityEpoch: m.schemaCompatibilityEpoch ?? 0,
    dictionarySchemaVersion: m.dictionarySchemaVersion ?? null,
    keySchemaVersion: m.keySchemaVersion ?? null,
    confidencePolicyVersion: m.confidencePolicyVersion ?? null,
    derivationPolicyVersion: m.derivationPolicyVersion ?? null,
    doctorPolicyVersion: DOCTOR_POLICY.doctorPolicyVersion,
    counts
  };
}
__name(captureStateIdentity, "captureStateIdentity");
async function claimIdSet(db, chunkSize) {
  const ids = /* @__PURE__ */ new Set();
  await forEachChunk(db, STORE.claims, (items) => {
    for (const c of items) ids.add(c.claimId);
  }, { chunkSize });
  return ids;
}
__name(claimIdSet, "claimIdSet");
var CHECK_IMPL = {
  async dangling_evidence(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    await forEachChunk(ctx.db, STORE.evidence, (items) => {
      for (const ev of items) {
        if (!ids.has(ev.claimId)) {
          ctx.emit("dangling_evidence", {
            severity: SEVERITY.error,
            evidenceId: ev.evidenceId,
            claimId: ev.claimId,
            repair: REPAIR_KIND.manualOnly,
            message: "Evidence references a claimId that no longer exists"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async dangling_relation(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    await forEachChunk(ctx.db, STORE.relations, (items) => {
      for (const rel of items) {
        const fromMissing = !ids.has(rel.fromNodeId);
        const toMissing = !ids.has(rel.toNodeId);
        if (fromMissing || toMissing) {
          ctx.emit("dangling_relation", {
            severity: SEVERITY.error,
            relationId: rel.relationId,
            fromNodeId: rel.fromNodeId,
            toNodeId: rel.toNodeId,
            fromMissing,
            toMissing,
            repair: REPAIR_KIND.manualOnly,
            message: "Relation endpoint claim is missing"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async duplicate_semantic_key(ctx) {
    const seen = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (!c.semanticKey) continue;
        if (seen.has(c.semanticKey)) {
          ctx.emit("duplicate_semantic_key", {
            severity: SEVERITY.error,
            semanticKey: c.semanticKey,
            claimIds: [seen.get(c.semanticKey), c.claimId],
            repair: REPAIR_KIND.manualOnly,
            message: "two claims share one semanticKey"
          });
        } else seen.set(c.semanticKey, c.claimId);
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async duplicate_edge_key(ctx) {
    const seen = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.relations, (items) => {
      for (const r of items) {
        if (!r.edgeKey) continue;
        if (seen.has(r.edgeKey)) {
          ctx.emit("duplicate_edge_key", {
            severity: SEVERITY.error,
            edgeKey: r.edgeKey,
            relationIds: [seen.get(r.edgeKey), r.relationId],
            repair: REPAIR_KIND.manualOnly,
            message: "two relations share one edgeKey"
          });
        } else seen.set(r.edgeKey, r.relationId);
      }
    }, { chunkSize: ctx.chunkSize });
  },
  depends_on_cycle: /* @__PURE__ */ __name((ctx) => detectCycle(ctx, RELATION.dependsOn, "depends_on_cycle"), "depends_on_cycle"),
  replaces_cycle: /* @__PURE__ */ __name((ctx) => detectCycle(ctx, RELATION.replaces, "replaces_cycle"), "replaces_cycle"),
  async superseded_replaces_mismatch(ctx) {
    const replaces = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.relations, (items) => {
      for (const r of items) {
        if (r.relation !== RELATION.replaces) continue;
        if (!replaces.has(r.fromNodeId)) replaces.set(r.fromNodeId, /* @__PURE__ */ new Set());
        replaces.get(r.fromNodeId).add(r.toNodeId);
      }
    }, { chunkSize: ctx.chunkSize });
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (!c.supersededByClaimId) continue;
        const declared = replaces.get(c.supersededByClaimId);
        if (!declared || !declared.has(c.claimId)) {
          ctx.emit("superseded_replaces_mismatch", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            supersededByClaimId: c.supersededByClaimId,
            repair: REPAIR_KIND.manualOnly,
            message: "supersededByClaimId has no matching replaces relation"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async evidence_summary_mismatch(ctx) {
    const actual = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.evidence, (items) => {
      for (const ev of items) actual.set(ev.claimId, (actual.get(ev.claimId) ?? 0) + 1);
    }, { chunkSize: ctx.chunkSize });
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const summary = c.evidenceSummary ?? {};
        if (summary.totalEvidence === void 0) continue;
        if (summary.evidenceTruncated) continue;
        const real = actual.get(c.claimId) ?? 0;
        if (summary.totalEvidence !== real) {
          ctx.emit("evidence_summary_mismatch", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            summaryTotal: summary.totalEvidence,
            actualTotal: real,
            // §108.1: 安全に再構築できる Derived Data。
            repair: REPAIR_KIND.rebuildDerived,
            message: "evidenceSummary.totalEvidence does not match the evidence store"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async score_cache_mismatch(ctx) {
    const versions = currentScoreInputVersions(effectivePolicyMeta(ctx.meta), { registry: ctx.registry });
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const stale = isScoreStale(c, versions);
        if (c.scoreDirty === true || stale.stale) {
          ctx.emit("score_cache_mismatch", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            scoreDirty: c.scoreDirty === true,
            reason: stale.reason,
            repair: REPAIR_KIND.rebuildDerived,
            message: "claim score cache is dirty or was computed under an older policy version"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async multiple_eligible_locked(ctx) {
    const byGroup = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (c.locked !== true) continue;
        if (!isEligible(c)) continue;
        const key = `${c.claimGroupKey}`;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key).push(c.claimId);
      }
    }, { chunkSize: ctx.chunkSize });
    for (const [claimGroupKey2, ids] of byGroup) {
      if (ids.length > 1) {
        ctx.emit("multiple_eligible_locked", {
          severity: SEVERITY.error,
          claimGroupKey: claimGroupKey2,
          claimIds: ids.sort(),
          // §108:「Manual/Locked Claim を自動削除しない」
          repair: REPAIR_KIND.manualOnly,
          message: "more than one eligible locked claim in the same claimGroupKey"
        });
      }
    }
  },
  async cache_selects_deleted_claim(ctx) {
    const bad = /* @__PURE__ */ new Set();
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) if (!isEligible(c)) bad.add(c.claimId);
    }, { chunkSize: ctx.chunkSize });
    await forEachChunk(ctx.db, STORE.cache, (items) => {
      for (const entry of items) {
        const selected = selectedClaimIdsOf(entry);
        const hit = selected.filter((id) => bad.has(id));
        if (hit.length) {
          ctx.emit("cache_selects_deleted_claim", {
            severity: SEVERITY.error,
            resolutionKey: entry.resolutionKey,
            claimIds: hit,
            // §108.1「stale resolution_cache 削除」は安全。
            repair: REPAIR_KIND.safeGc,
            message: "resolution cache entry selects a deleted/archived/disabled claim"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async stale_cache_dependency(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    await forEachChunk(ctx.db, STORE.cache, (items) => {
      for (const entry of items) {
        const missing = (entry.dependencyClaimIds ?? []).filter((id) => !ids.has(id));
        if (missing.length) {
          ctx.emit("stale_cache_dependency", {
            severity: SEVERITY.warning,
            resolutionKey: entry.resolutionKey,
            missing,
            repair: REPAIR_KIND.safeGc,
            message: "cache entry depends on claims that no longer exist"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async cache_policy_fingerprint_mismatch(ctx) {
    const current = await resolutionPolicyFingerprint(effectivePolicyMeta(ctx.meta));
    await forEachChunk(ctx.db, STORE.cache, (items) => {
      for (const entry of items) {
        if (entry.resolutionPolicyFingerprint !== current) {
          ctx.emit("cache_policy_fingerprint_mismatch", {
            severity: SEVERITY.info,
            resolutionKey: entry.resolutionKey,
            entryFingerprint: entry.resolutionPolicyFingerprint,
            currentFingerprint: current,
            repair: REPAIR_KIND.safeGc,
            message: "cache entry was computed under a different resolution policy"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async invalid_entity_key(ctx) {
    await forEachChunk(ctx.db, STORE.entities, (items) => {
      for (const e of items) {
        const ok = typeof e.entityKey === "string" && /^(club|comp|player|stadium):[^:]+$/.test(e.entityKey) && typeof e.fmId === "string";
        if (!ok) {
          ctx.emit("invalid_entity_key", {
            severity: SEVERITY.error,
            entityKey: e.entityKey,
            fmId: e.fmId,
            fmIdType: typeof e.fmId,
            repair: REPAIR_KIND.manualOnly,
            message: "entityKey is malformed or fmId is not a String (§4.1.1)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async invalid_typed_value(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const v = c.value;
        const empty = v === null || v === void 0 || typeof v === "string" && v.trim() === "";
        if (empty) {
          ctx.emit("invalid_typed_value", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            valueType: c.valueType,
            repair: REPAIR_KIND.manualOnly,
            message: "claim has an empty/invalid typed value"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async invalid_applicability_constraints(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const ac = c.applicabilityConstraints;
        if (ac === null || ac === void 0) continue;
        if (typeof ac !== "object" || Array.isArray(ac)) {
          ctx.emit("invalid_applicability_constraints", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            repair: REPAIR_KIND.manualOnly,
            message: "applicabilityConstraints must be an object (§13.4)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async invalid_source_name_guard(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const g = c.sourceNameGuard;
        if (g === null || g === void 0) continue;
        if (typeof g !== "object" || Array.isArray(g)) {
          ctx.emit("invalid_source_name_guard", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            repair: REPAIR_KIND.manualOnly,
            message: "sourceNameGuard must be an object (§6)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async source_name_fingerprint_version_mismatch(ctx) {
    const current = ctx.meta.sourceNameFingerprintVersion;
    await forEachChunk(ctx.db, STORE.entities, (items) => {
      for (const e of items) {
        const v = e.sourceNameFingerprint?.version ?? e.sourceNameFingerprintVersion;
        if (v !== void 0 && v !== null && v !== current) {
          ctx.emit("source_name_fingerprint_version_mismatch", {
            severity: SEVERITY.info,
            entityKey: e.entityKey,
            recordVersion: v,
            currentVersion: current,
            // §120-19: version mismatch は rename Evidence ではない。人が見る。
            repair: REPAIR_KIND.manualOnly,
            message: "sourceNameFingerprint version differs from current (not a rename signal, §120-19)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async orphan_entity_claim(ctx) {
    const entityKeys = /* @__PURE__ */ new Set();
    await forEachChunk(ctx.db, STORE.entities, (items) => {
      for (const e of items) entityKeys.add(e.entityKey);
    }, { chunkSize: ctx.chunkSize });
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (c.subjectKind !== "entity") continue;
        const key = entityKeyFromSubjectKey(c.subjectKey);
        if (key && !entityKeys.has(key)) {
          ctx.emit("orphan_entity_claim", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            entityKey: key,
            repair: REPAIR_KIND.manualOnly,
            message: "entity claim has no observed entity record"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async duplicate_retry_evidence(ctx) {
    await forEachChunk(ctx.db, STORE.evidence, (items) => {
      for (const ev of items) {
        if ((ev.duplicateSeenCount ?? 0) >= DOCTOR_POLICY.duplicateRetryThreshold) {
          ctx.emit("duplicate_retry_evidence", {
            severity: SEVERITY.info,
            evidenceId: ev.evidenceId,
            claimId: ev.claimId,
            duplicateSeenCount: ev.duplicateSeenCount,
            // §101:「初回実装では自動Compaction OFF」— 消さない。
            repair: REPAIR_KIND.manualOnly,
            message: "evidence has a very high duplicate retry count (diagnostic only, §19.1)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async native_script_mismatch(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (!c.script) continue;
        if (c.script === "Hans" || c.script === "Hant") {
          const basis = c.scriptEvidenceBasis ?? c.creationHints?.scriptBasis ?? null;
          if (basis === "unicode_script_only") {
            ctx.emit("native_script_mismatch", {
              severity: SEVERITY.error,
              claimId: c.claimId,
              script: c.script,
              basis,
              repair: REPAIR_KIND.manualOnly,
              message: "§79.1/§120-31: Hans/Hant asserted from Unicode script detection alone"
            });
          }
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async source_alias_invalid_subject(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (c.valueType !== "source_alias") continue;
        const ok = typeof c.subjectKey === "string" && c.subjectKey.length > 0;
        if (!ok) {
          ctx.emit("source_alias_invalid_subject", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            subjectKey: c.subjectKey,
            repair: REPAIR_KIND.manualOnly,
            message: "source_alias claim has an invalid subject"
          });
          continue;
        }
        const canonical = c.canonicalSubjectKey ?? c.value;
        if (typeof canonical === "string" && canonical.startsWith("claim:") && !ids.has(canonical)) {
          ctx.emit("source_alias_invalid_subject", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            canonical,
            repair: REPAIR_KIND.manualOnly,
            message: "source_alias points at a missing claim"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async derived_claim_missing_dependency(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    const dependsOn = /* @__PURE__ */ new Map();
    await forEachChunk(ctx.db, STORE.relations, (items) => {
      for (const r of items) {
        if (r.relation !== RELATION.dependsOn && r.relation !== RELATION.derivedFrom) continue;
        if (!dependsOn.has(r.fromNodeId)) dependsOn.set(r.fromNodeId, []);
        dependsOn.get(r.fromNodeId).push(r.toNodeId);
      }
    }, { chunkSize: ctx.chunkSize });
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (!c.derivation) continue;
        const deps = dependsOn.get(c.claimId) ?? [];
        if (deps.length === 0) {
          ctx.emit("derived_claim_missing_dependency", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            repair: REPAIR_KIND.manualOnly,
            message: "derived claim has no depends_on/derived_from relation (§34)"
          });
          continue;
        }
        const missing = deps.filter((d) => !ids.has(d));
        if (missing.length) {
          ctx.emit("derived_claim_missing_dependency", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            missing,
            repair: REPAIR_KIND.manualOnly,
            message: "derived claim depends on missing claims"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async derived_claim_policy_version_stale(ctx) {
    const current = effectivePolicyMeta(ctx.meta).derivationPolicyVersion;
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (!c.derivation) continue;
        if (c.scoreDerivationPolicyVersion !== current) {
          ctx.emit("derived_claim_policy_version_stale", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            recordVersion: c.scoreDerivationPolicyVersion,
            currentVersion: current,
            repair: REPAIR_KIND.rebuildDerived,
            message: "derived claim score was computed under an older derivation policy (§28.2)"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async import_quarantine_residue(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (c.quarantined === true || c.stagingSessionId != null) {
          ctx.emit("import_quarantine_residue", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            quarantined: c.quarantined === true,
            stagingSessionId: c.stagingSessionId ?? null,
            repair: REPAIR_KIND.manualOnly,
            message: "claim is still quarantined / attached to an import staging session"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async expired_lease(ctx) {
    const lock = ctx.meta.maintenanceLock;
    if (lock && lock.owner && !(lock.expiresAt > ctx.now)) {
      ctx.emit("expired_lease", {
        severity: SEVERITY.warning,
        scope: "maintenance",
        owner: lock.owner,
        leaseEpoch: lock.leaseEpoch ?? null,
        expiresAt: lock.expiresAt ?? null,
        // §101 安全自動GC:「expired leases」。
        repair: REPAIR_KIND.safeGc,
        message: "maintenance lease is expired but still recorded"
      });
    }
    await forEachChunk(ctx.db, STORE.jobs, (items) => {
      for (const j of items) {
        if (j.leaseOwner && !(j.leaseExpiresAt > ctx.now)) {
          ctx.emit("expired_lease", {
            severity: SEVERITY.warning,
            scope: "job",
            jobId: j.jobId,
            state: j.state,
            leaseOwner: j.leaseOwner,
            leaseEpoch: j.leaseEpoch ?? null,
            repair: REPAIR_KIND.safeGc,
            message: "job lease is expired; the job can be resumed by another owner"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async max_phrase_tokens_underestimate(ctx) {
    const declared = ctx.meta.maxPhraseTokensByTarget ?? {};
    const actual = {};
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        if (c.subjectKind !== "phrase") continue;
        const target = c.target ?? null;
        const tokens = countTokens(c.normalizedSource ?? c.sourceText ?? "");
        const key = target ?? "*";
        actual[key] = Math.max(actual[key] ?? 0, tokens);
      }
    }, { chunkSize: ctx.chunkSize });
    for (const [target, max] of Object.entries(actual)) {
      const bound = declared[target];
      if (bound !== void 0 && max > bound) {
        ctx.emit("max_phrase_tokens_underestimate", {
          severity: SEVERITY.error,
          target,
          declared: bound,
          actual: max,
          // §108.1:「maxPhraseTokensByTarget」は安全に再構築できる。
          repair: REPAIR_KIND.rebuildDerived,
          message: "§89.2 violated: declared maxPhraseTokensByTarget is smaller than a stored phrase"
        });
      }
    }
  },
  async key_schema_version_mismatch(ctx) {
    const current = KEY_SCHEMA_VERSION;
    for (const storeName of [STORE.claims, STORE.evidence, STORE.relations, STORE.rejections]) {
      await forEachChunk(ctx.db, storeName, (items) => {
        for (const r of items) {
          if (r.keySchemaVersion !== void 0 && r.keySchemaVersion !== current) {
            ctx.emit("key_schema_version_mismatch", {
              severity: SEVERITY.warning,
              store: storeName,
              recordId: r.claimId ?? r.evidenceId ?? r.relationId ?? r.rejectionId,
              recordVersion: r.keySchemaVersion,
              currentVersion: current,
              repair: REPAIR_KIND.manualOnly,
              message: "record derived keys were built under a different keySchemaVersion"
            });
          }
        }
      }, { chunkSize: ctx.chunkSize });
    }
  },
  async invalid_score_revision_state(ctx) {
    await forEachChunk(ctx.db, STORE.claims, (items) => {
      for (const c of items) {
        const from = c.scoreComputedFromInputRevision ?? 0;
        const input = c.scoreInputRevision ?? 0;
        if (from > input) {
          ctx.emit("invalid_score_revision_state", {
            severity: SEVERITY.error,
            claimId: c.claimId,
            scoreComputedFromInputRevision: from,
            scoreInputRevision: input,
            repair: REPAIR_KIND.rebuildDerived,
            message: "scoreComputedFromInputRevision is ahead of scoreInputRevision (§28.1.1)"
          });
        }
        if (c.scoreDirty === false && from !== input) {
          ctx.emit("invalid_score_revision_state", {
            severity: SEVERITY.warning,
            claimId: c.claimId,
            scoreComputedFromInputRevision: from,
            scoreInputRevision: input,
            repair: REPAIR_KIND.rebuildDerived,
            message: "claim is marked clean but its score was computed from another revision"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async dangling_transitive_dependency(ctx) {
    const ids = await claimIdSet(ctx.db, ctx.chunkSize);
    await forEachChunk(ctx.db, STORE.cache, (items) => {
      for (const entry of items) {
        if (entry.dependencyClosureComplete === false) {
          ctx.emit("dangling_transitive_dependency", {
            severity: SEVERITY.warning,
            resolutionKey: entry.resolutionKey,
            repair: REPAIR_KIND.safeGc,
            message: "cache entry declares an incomplete dependency closure (§120-45)"
          });
          continue;
        }
        const missing = (entry.dependencyClaimIds ?? []).filter((id) => !ids.has(id));
        if (missing.length) {
          ctx.emit("dangling_transitive_dependency", {
            severity: SEVERITY.warning,
            resolutionKey: entry.resolutionKey,
            missing,
            repair: REPAIR_KIND.safeGc,
            message: "transitive dependency closure references missing claims"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  },
  async unknown_model_lineage_classification(ctx) {
    await forEachChunk(ctx.db, STORE.evidence, (items) => {
      for (const ev of items) {
        if (ev.provider == null) continue;
        const lineage = resolveEvidenceLineage(ev, ctx.registry);
        if (lineage.lineageClassification === LINEAGE_CLASSIFICATION.unknown) {
          ctx.emit("unknown_model_lineage_classification", {
            severity: SEVERITY.info,
            evidenceId: ev.evidenceId,
            claimId: ev.claimId,
            rawModelIdentity: lineage.rawModelIdentity,
            repair: REPAIR_KIND.manualOnly,
            message: "AI evidence has an unknown model lineage (§120-42: not cross-lineage independent)"
          });
        } else if (ev.modelLineageRegistryVersion !== ctx.registry.modelLineageRegistryVersion) {
          ctx.emit("unknown_model_lineage_classification", {
            severity: SEVERITY.info,
            evidenceId: ev.evidenceId,
            claimId: ev.claimId,
            recordRegistryVersion: ev.modelLineageRegistryVersion,
            currentRegistryVersion: ctx.registry.modelLineageRegistryVersion,
            repair: REPAIR_KIND.rebuildDerived,
            message: "evidence lineage was materialised under an older registry version"
          });
        }
      }
    }, { chunkSize: ctx.chunkSize });
  }
};
function isEligible(claim) {
  if (!claim) return false;
  if (claim.deletedAt != null) return false;
  if (claim.disabled === true) return false;
  if (claim.quarantined === true) return false;
  if (claim.lifecycleState === LIFECYCLE_STATE.archived) return false;
  return true;
}
__name(isEligible, "isEligible");
function selectedClaimIdsOf(entry) {
  const out = [];
  if (Array.isArray(entry.selectedClaimIds)) out.push(...entry.selectedClaimIds);
  if (typeof entry.selectedClaimId === "string") out.push(entry.selectedClaimId);
  for (const seg of entry.sourceMap?.segments ?? []) {
    if (typeof seg?.claimId === "string") out.push(seg.claimId);
  }
  return out;
}
__name(selectedClaimIdsOf, "selectedClaimIdsOf");
function entityKeyFromSubjectKey(subjectKey) {
  if (typeof subjectKey !== "string") return null;
  const m = /^entity:((?:club|comp|player|stadium):[^:]+)/.exec(subjectKey);
  return m ? m[1] : null;
}
__name(entityKeyFromSubjectKey, "entityKeyFromSubjectKey");
function countTokens(text) {
  const s = String(text ?? "").trim();
  if (!s) return 0;
  return s.split(/\s+/).length;
}
__name(countTokens, "countTokens");
async function detectCycle(ctx, relation, checkName) {
  const edges = /* @__PURE__ */ new Map();
  await forEachChunk(ctx.db, STORE.relations, (items) => {
    for (const r of items) {
      if (r.relation !== relation) continue;
      if (!edges.has(r.fromNodeId)) edges.set(r.fromNodeId, []);
      edges.get(r.fromNodeId).push(r.toNodeId);
    }
  }, { chunkSize: ctx.chunkSize });
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = /* @__PURE__ */ new Map();
  for (const start of edges.keys()) {
    if ((colour.get(start) ?? WHITE) !== WHITE) continue;
    const stack = [{ node: start, path: [start], depth: 0 }];
    colour.set(start, GREY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (edges.get(top.node) ?? [])[top.i ?? 0];
      top.i = (top.i ?? 0) + 1;
      if (next === void 0) {
        colour.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      if (colour.get(next) === GREY) {
        ctx.emit(checkName, {
          severity: SEVERITY.error,
          relation,
          cycle: [...top.path, next],
          repair: REPAIR_KIND.manualOnly,
          message: `${relation} relation graph contains a cycle (§36)`
        });
        continue;
      }
      if ((colour.get(next) ?? WHITE) === BLACK) continue;
      if (top.depth + 1 > DOCTOR_POLICY.maxCycleDepth) continue;
      colour.set(next, GREY);
      stack.push({ node: next, path: [...top.path, next], depth: top.depth + 1 });
    }
  }
}
__name(detectCycle, "detectCycle");
var SAFE_GC_TARGETS = Object.freeze([
  "expired_resolution_cache",
  "completed_old_jobs",
  "expired_leases"
]);
var NEVER_AUTO_GC = Object.freeze([
  "manual_correction_evidence",
  "active_rejections",
  "manual_history",
  "active_claims"
]);
async function planSafeGc(db, {
  now = Date.now(),
  retentionDays = DOCTOR_POLICY.completedJobRetentionDays,
  /** Phase 10 Feature Flag。未指定なら `CACHE_RETENTION_DEFAULT_ON`。 */
  cacheRetentionEnabled
} = {}) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1e3;
  const jobs = [];
  await forEachChunk(db, STORE.jobs, (items) => {
    for (const j of items) {
      const terminal = j.state === JOB_STATE.completed || j.state === JOB_STATE.cancelled;
      if (terminal && (j.finishedAt ?? j.updatedAt ?? 0) < cutoff) jobs.push(j.jobId);
    }
  }, { chunkSize: DOCTOR_POLICY.chunkSize });
  const cacheRetention = await planCacheRetentionGc(db, { now, enabled: cacheRetentionEnabled });
  return {
    readOnly: true,
    mutations: 0,
    completedOldJobs: jobs,
    cutoff,
    retentionDays,
    cacheRetention
  };
}
__name(planSafeGc, "planSafeGc");
async function runSafeGc(db, plan, { confirm = false, now = Date.now() } = {}) {
  if (confirm !== true) throw new DoctorError("§101: safe GC requires an explicit confirm:true");
  let removedJobs = 0;
  const skipped = [];
  const ids = plan?.completedOldJobs ?? [];
  const cutoff = plan?.cutoff ?? now - DOCTOR_POLICY.completedJobRetentionDays * 24 * 3600 * 1e3;
  for (let i = 0; i < ids.length; i += DOCTOR_POLICY.chunkSize) {
    const slice = ids.slice(i, i + DOCTOR_POLICY.chunkSize);
    await runSemanticMutation(db, [STORE.jobs], async ({ tx }) => {
      for (const jobId of slice) {
        const job = await requestOf4(tx.objectStore(STORE.jobs).get(jobId));
        if (!job) continue;
        if (job.state !== JOB_STATE.completed && job.state !== JOB_STATE.cancelled) {
          skipped.push({ jobId, reason: "not_terminal", state: job.state });
          continue;
        }
        const finishedAt = job.finishedAt ?? job.updatedAt ?? 0;
        if (!(finishedAt < cutoff)) {
          skipped.push({ jobId, reason: "within_retention", finishedAt });
          continue;
        }
        await requestOf4(tx.objectStore(STORE.jobs).delete(jobId));
        removedJobs++;
      }
    }, { bumpRevision: false });
  }
  let cacheRetention = null;
  const cachePlan = plan?.cacheRetention ?? null;
  if (cachePlan && cachePlan.enabled === true && (cachePlan.deletes?.length ?? 0) > 0) {
    cacheRetention = await runCacheRetentionGc(db, cachePlan, {
      confirm: true,
      enabled: true,
      now
    });
  }
  return { removedJobs, skipped, cutoff, ranAt: now, readOnly: false, cacheRetention };
}
__name(runSafeGc, "runSafeGc");
function summariseReport(report) {
  const byCheck = {};
  for (const f of report.findings) {
    byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
  }
  return {
    healthy: report.healthy,
    errors: report.bySeverity.error,
    warnings: report.bySeverity.warning,
    info: report.bySeverity.info,
    byCheck,
    truncatedChecks: report.truncatedChecks
  };
}
__name(summariseReport, "summariseReport");

// dictionary-manager.js
function requestOf5(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf5, "requestOf");
var MANAGER_POLICY = Object.freeze({
  managerPolicyVersion: 1,
  /** §110.1「Search result は例 50〜200 件/page」。既定 page。 */
  pageSize: 100,
  maxPageSize: 200,
  /**
   * §110.1「100k DOM row を生成しない」。UI がページを跨いで累積してよい行数の
   * 上限。search session はこれを超えると capReached を立て、force なしでは
   * 次ページを返さない。テストが「bounded result count / render 上限」を固定する。
   */
  maxResultRows: 2e3,
  /** §110 詳細パネルの各 Collection の1ページ。 */
  detailEvidencePageSize: 50,
  detailHistoryPageSize: 50,
  detailRelationPageSize: 50,
  /**
   * §110.1「contains substring / fuzzy は別の詳細検索とし debounce + chunk +
   * result cap を許容」。詳細検索が走査してよい最大 record 数（これを超えたら
   * partial=true で打ち切る）。全件 scan を通常経路にしない（§89.1）。
   */
  detailedSearchScanCap: 2e4,
  /** §111 健康状態 deep scan の chunk。全件を Memory へ載せない。 */
  healthChunkSize: 500,
  /** §111 deep scan の走査上限。これを超えたら partial=true。 */
  healthDeepScanCap: 2e5,
  /** §109 再検証 overview で bounded に読む候補数。 */
  revalidationOverviewLimit: 500
});
var ManagerError = class extends Error {
  static {
    __name(this, "ManagerError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ManagerError";
    this.details = details;
  }
};
function clampPageSize(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : MANAGER_POLICY.pageSize;
  if (v <= 0) throw new ManagerError("pageSize must be positive", { pageSize: n });
  return Math.min(v, MANAGER_POLICY.maxPageSize);
}
__name(clampPageSize, "clampPageSize");
var SEARCH_MODE = Object.freeze({
  exactSource: "exact_source",
  prefixSource: "prefix_source",
  prefixValue: "prefix_value",
  aliasExact: "alias_exact",
  aliasPrefix: "alias_prefix",
  entityKey: "entity_key",
  recent: "recent"
});
var HIGH_SENTINEL = "￿";
function prefixRange(prefix) {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new ManagerError("prefix search requires a non-empty prefix (use SEARCH_MODE.recent for a full listing)", {});
  }
  return IDBKeyRange.bound(prefix, prefix + HIGH_SENTINEL, false, false);
}
__name(prefixRange, "prefixRange");
function planSearch(spec) {
  const { mode, term } = spec;
  switch (mode) {
    case SEARCH_MODE.exactSource:
      return { storeName: STORE.claims, indexName: "normalizedSource", query: IDBKeyRange.only(term), direction: "next" };
    case SEARCH_MODE.prefixSource:
      return { storeName: STORE.claims, indexName: "normalizedSource", query: prefixRange(term), direction: "next" };
    case SEARCH_MODE.prefixValue:
      return { storeName: STORE.claims, indexName: "normalizedValue", query: prefixRange(term), direction: "next" };
    case SEARCH_MODE.aliasExact:
      return {
        storeName: STORE.claims,
        indexName: "valueType_normalizedValue",
        query: IDBKeyRange.only(["source_alias", term]),
        direction: "next"
      };
    case SEARCH_MODE.aliasPrefix:
      return {
        storeName: STORE.claims,
        indexName: "valueType_normalizedValue",
        query: IDBKeyRange.bound(["source_alias", term], ["source_alias", term + HIGH_SENTINEL], false, false),
        direction: "next"
      };
    case SEARCH_MODE.recent:
      return { storeName: STORE.claims, indexName: "updatedAt", query: null, direction: "prev" };
    default:
      throw new ManagerError(`unknown search mode: ${mode}`, { mode });
  }
}
__name(planSearch, "planSearch");
function toManagerRow(claim) {
  return {
    claimId: claim.claimId,
    subjectKind: claim.subjectKind,
    sourceText: claim.sourceText ?? null,
    normalizedSource: claim.normalizedSource ?? null,
    valueType: claim.valueType,
    value: claim.value,
    script: claim.script ?? null,
    trustTier: claim.trustTier ?? null,
    lifecycleState: claim.lifecycleState ?? null,
    conflictState: claim.conflictState ?? null,
    revalidationState: claim.revalidationState ?? null,
    verificationState: claim.verificationState ?? null,
    locked: Boolean(claim.locked),
    disabled: Boolean(claim.disabled),
    deletedAt: claim.deletedAt ?? null,
    useCount: claim.useCount ?? 0,
    updatedAt: claim.updatedAt ?? null,
    semanticRevision: claim.semanticRevision ?? 0
  };
}
__name(toManagerRow, "toManagerRow");
function createManagerSearch(db, { pageSize } = {}) {
  const size = clampPageSize(pageSize);
  let latestQueryId = 0;
  let active = null;
  async function runPage(state) {
    if (state.done) return { queryId: state.queryId, items: [], nextCursor: null, done: true, capReached: state.capReached, deliveredRows: state.deliveredRows };
    if (state.deliveredRows >= MANAGER_POLICY.maxResultRows) {
      state.capReached = true;
      return { queryId: state.queryId, items: [], nextCursor: null, done: false, capReached: true, deliveredRows: state.deliveredRows };
    }
    const remaining = MANAGER_POLICY.maxResultRows - state.deliveredRows;
    const limit = Math.min(size, remaining);
    const page = await iterateIndex(db, {
      storeName: state.plan.storeName,
      indexName: state.plan.indexName,
      query: state.cursor ? void 0 : state.plan.query,
      direction: state.plan.direction,
      limit,
      cursor: state.cursor
    });
    state.cursor = page.nextCursor;
    state.done = page.done;
    state.deliveredRows += page.items.length;
    if (!page.done && state.deliveredRows >= MANAGER_POLICY.maxResultRows) state.capReached = true;
    return {
      queryId: state.queryId,
      items: page.items.map(toManagerRow),
      nextCursor: page.nextCursor ? { queryId: state.queryId } : null,
      done: page.done,
      capReached: state.capReached,
      deliveredRows: state.deliveredRows
    };
  }
  __name(runPage, "runPage");
  return {
    get latestQueryId() {
      return latestQueryId;
    },
    /** 現在の結果が最新の検索によるものかを UI が確認する。 */
    isStale(queryId) {
      return queryId !== latestQueryId;
    },
    async search(spec) {
      const plan = planSearch(spec);
      latestQueryId += 1;
      active = { queryId: latestQueryId, plan, cursor: null, done: false, deliveredRows: 0, capReached: false, spec };
      return runPage(active);
    },
    async nextPage(token) {
      if (!active) throw new ManagerError("nextPage called before search", {});
      if (token && token.queryId !== active.queryId) {
        return { queryId: active.queryId, items: [], nextCursor: null, done: true, stale: true, deliveredRows: active.deliveredRows };
      }
      if (active.queryId !== latestQueryId) {
        return { queryId: active.queryId, items: [], nextCursor: null, done: true, stale: true, deliveredRows: active.deliveredRows };
      }
      return runPage(active);
    }
  };
}
__name(createManagerSearch, "createManagerSearch");
async function getClaimDetail(db, claimId, {
  evidencePageSize = MANAGER_POLICY.detailEvidencePageSize,
  historyPageSize = MANAGER_POLICY.detailHistoryPageSize,
  relationPageSize = MANAGER_POLICY.detailRelationPageSize
} = {}) {
  const claim = await getClaim(db, claimId);
  if (!claim) throw new ManagerError(`claim not found: ${claimId}`, { claimId });
  const evidenceCount = await countEvidenceForClaim(db, claimId);
  const evidencePage = await collectEvidenceForClaim(db, claimId, { maxRecords: evidencePageSize });
  const dependents = await collectDependents(db, { toNodeId: claimId, relation: RELATION.dependsOn, maxRecords: relationPageSize });
  const dependencies = await iterateIndex(db, {
    storeName: STORE.relations,
    indexName: "fromNodeId_relation",
    query: IDBKeyRange.only([claimId, RELATION.dependsOn]),
    limit: relationPageSize
  });
  const replaces = await iterateIndex(db, {
    storeName: STORE.relations,
    indexName: "fromNodeId_relation",
    query: IDBKeyRange.only([claimId, RELATION.replaces]),
    limit: relationPageSize
  });
  const historyPage = await iterateHistoryForNode(db, claimId, { limit: historyPageSize });
  const rejections = await iterateIndex(db, {
    storeName: STORE.rejections,
    indexName: "claimGroupKey",
    query: IDBKeyRange.only(claim.claimGroupKey),
    limit: relationPageSize
  });
  return {
    claim,
    evidence: {
      total: evidenceCount,
      page: evidencePage.items,
      truncated: Boolean(evidencePage.truncated) || evidencePage.items.length < evidenceCount
    },
    relations: {
      dependents: dependents.items,
      dependencies: dependencies.items,
      replaces: replaces.items,
      truncated: Boolean(dependents.truncated || dependencies.nextCursor || replaces.nextCursor)
    },
    rejections: { page: rejections.items, nextCursor: rejections.nextCursor },
    history: { page: historyPage.items, nextCursor: historyPage.nextCursor },
    /** §110 Source Trace: この Claim の provenance 要約（record 由来。再計算しない）。 */
    sourceTrace: {
      createdBy: claim.provenance?.createdBy ?? null,
      firstEvidenceRootId: claim.provenance?.firstEvidenceRootId ?? null,
      derivation: claim.derivation ?? null,
      verificationState: claim.verificationState ?? null,
      keySchemaVersion: claim.keySchemaVersion ?? null
    }
  };
}
__name(getClaimDetail, "getClaimDetail");
function requireUserActor(actor) {
  if (typeof actor !== "string" || !actor) {
    throw new ManagerError("Manager mutation requires an explicit actor string", {});
  }
  return actor;
}
__name(requireUserActor, "requireUserActor");
function managerLockClaim(db, claimId, { actor, reason = "manager_lock", mutationId = null, now = Date.now() } = {}) {
  requireUserActor(actor);
  return patchClaimExplicit(db, claimId, {
    locked: true,
    lockMetadata: { lockedBy: actor, reason, lockedAt: now }
  }, { actor, mutationId, now });
}
__name(managerLockClaim, "managerLockClaim");
function managerUnlockClaim(db, claimId, { actor, mutationId = null, now = Date.now() } = {}) {
  requireUserActor(actor);
  return patchClaimExplicit(db, claimId, { locked: false, lockMetadata: null }, { actor, mutationId, now });
}
__name(managerUnlockClaim, "managerUnlockClaim");
function managerSoftDeleteClaim(db, claimId, { actor, mutationId = null, now = Date.now() } = {}) {
  requireUserActor(actor);
  return patchClaimExplicit(db, claimId, { disabled: true, deletedAt: now }, { actor, mutationId, now });
}
__name(managerSoftDeleteClaim, "managerSoftDeleteClaim");
function managerDisableClaim(db, claimId, { actor, mutationId = null, now = Date.now() } = {}) {
  requireUserActor(actor);
  return patchClaimExplicit(db, claimId, { disabled: true }, { actor, mutationId, now });
}
__name(managerDisableClaim, "managerDisableClaim");
async function managerReviveClaim(db, claimId, {
  actor,
  confirm = false,
  allowArchived = false,
  mutationId = null,
  now = Date.now()
} = {}) {
  requireUserActor(actor);
  if (confirm !== true) {
    throw new ManagerError("§100.1: reviving a deleted/disabled Claim requires an explicit confirm:true", { claimId });
  }
  const current = await getClaim(db, claimId);
  if (!current) throw new ManagerError(`claim not found: ${claimId}`, { claimId });
  if (current.lifecycleState === LIFECYCLE_STATE.archived && !allowArchived) {
    throw new ManagerError(
      "§100.1: this Claim was archived (superseded). Reviving it needs allowArchived:true and creates no new Evidence.",
      { claimId }
    );
  }
  const patch = { disabled: false, deletedAt: null };
  if (current.lifecycleState !== LIFECYCLE_STATE.active) patch.lifecycleState = LIFECYCLE_STATE.active;
  return patchClaimExplicit(db, claimId, patch, { actor, mutationId, now });
}
__name(managerReviveClaim, "managerReviveClaim");
async function managerEditClaimValue(db, claimId, {
  actor,
  newValue,
  script = void 0,
  applicabilityConstraints = void 0,
  mutationId = null,
  now = Date.now()
} = {}) {
  requireUserActor(actor);
  const current = await getClaim(db, claimId);
  if (!current) throw new ManagerError(`claim not found: ${claimId}`, { claimId });
  if (typeof newValue !== "string" && typeof newValue !== "boolean") {
    throw new ManagerError("managerEditClaimValue: newValue must be a string or boolean", {});
  }
  const newClaimSpec = {
    subjectKind: current.subjectKind,
    subjectKey: current.subjectKey,
    valueType: current.valueType,
    value: newValue,
    script: script === void 0 ? current.script ?? null : script,
    sourceText: current.sourceText,
    applicabilityConstraints: applicabilityConstraints === void 0 ? current.applicabilityConstraints : applicabilityConstraints,
    sourceNameGuard: current.sourceNameGuard ?? null,
    provenance: { createdBy: actor, firstEvidenceRootId: null },
    verificationState: VERIFICATION_STATE.manualCorrected
  };
  return replaceClaimSemantics(db, {
    oldClaimId: claimId,
    newClaimSpec,
    actor,
    mutationId,
    now,
    completeReplacement: true
  });
}
__name(managerEditClaimValue, "managerEditClaimValue");
async function indexCount(db, storeName, indexName, key) {
  return runRead(db, [storeName], ({ store }) => requestOf5(store(storeName).index(indexName).count(key === void 0 ? void 0 : IDBKeyRange.only(key))));
}
__name(indexCount, "indexCount");
async function dictionaryHealth(db, { deep = false, chunkSize = MANAGER_POLICY.healthChunkSize, yieldFn = null } = {}) {
  const total = await runRead(db, [STORE.claims], ({ store }) => requestOf5(store(STORE.claims).count()));
  const byTrustTier = {};
  for (const t of Object.values(TRUST_TIER)) byTrustTier[t] = await indexCount(db, STORE.claims, "trustTier", t);
  const byLifecycle = {};
  for (const s of Object.values(LIFECYCLE_STATE)) byLifecycle[s] = await indexCount(db, STORE.claims, "lifecycleState", s);
  const byVerification = {};
  for (const s of Object.values(VERIFICATION_STATE)) byVerification[s] = await indexCount(db, STORE.claims, "verificationState", s);
  const conflicted = await indexCount(db, STORE.claims, "conflictState", CONFLICT_STATE.conflicted);
  const needsRevalidation = await indexCount(db, STORE.claims, "revalidationState", REVALIDATION_STATE.needed);
  const out = {
    generatedAt: Date.now(),
    total,
    byTrustTier,
    byLifecycle,
    byVerification,
    conflicted,
    needsRevalidation,
    dormant: byLifecycle[LIFECYCLE_STATE.dormant] ?? 0,
    archived: byLifecycle[LIFECYCLE_STATE.archived] ?? 0,
    softDeleted: null,
    disabled: null,
    highRisk: null,
    deep: false,
    partial: false
  };
  if (!deep) return out;
  let softDeleted = 0;
  let disabled = 0;
  let highRisk = 0;
  let scanned = 0;
  let partial = false;
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, { storeName: STORE.claims, limit: chunkSize, cursor });
    for (const c of page.items) {
      scanned += 1;
      if (c.deletedAt != null) softDeleted += 1;
      if (c.disabled === true) disabled += 1;
      const risk = claimRiskFromMaterializedFields(c);
      if (typeof risk === "number" ? risk >= 0.66 : Boolean(risk?.high)) highRisk += 1;
    }
    if (yieldFn) await yieldFn();
    if (page.done) break;
    if (scanned >= MANAGER_POLICY.healthDeepScanCap) {
      partial = true;
      break;
    }
    cursor = page.nextCursor;
  }
  out.softDeleted = softDeleted;
  out.disabled = disabled;
  out.highRisk = highRisk;
  out.deep = true;
  out.partial = partial;
  out.deepScanned = scanned;
  return out;
}
__name(dictionaryHealth, "dictionaryHealth");
async function managerDoctorSummary(db, { checks = DOCTOR_CHECKS, now = Date.now() } = {}) {
  const report = await runDoctorScan(db, { checks, now });
  return {
    ranAt: report.ranAt,
    readOnly: report.readOnly,
    mutations: report.mutations,
    ...summariseReport(report),
    totalFindings: report.findings.length
  };
}
__name(managerDoctorSummary, "managerDoctorSummary");
async function managerRevalidationOverview(db, {
  selector = "needs_revalidation",
  limit = MANAGER_POLICY.revalidationOverviewLimit
} = {}) {
  const selection = await selectRevalidationCandidates(db, { selector, limit });
  let estimatedInputTokens = 0;
  for (const c of selection.items) {
    estimatedInputTokens += estimatePromptTokensForClaim(c, { mode: REVALIDATION_MODE.blindAi });
  }
  return {
    selector,
    candidateCount: selection.items.length,
    scanned: selection.scanned,
    bounded: !selection.done,
    estimatedInputTokens,
    /** 開くだけでは AI を呼ばないことの宣言。 */
    aiCalls: 0
  };
}
__name(managerRevalidationOverview, "managerRevalidationOverview");
var LEARNING_EVENT_TO_FIELD = Object.freeze({
  dict_only: "dictOnly",
  dict_plus_ai: "dictPlusAi",
  ai_only: "aiOnly",
  user_only: "userOnly",
  ai_avoided: "aiAvoided",
  new_claim: "newClaims",
  new_evidence: "newEvidence",
  reused_claim: "reusedClaims",
  promotion: "promotions",
  conflict_raised: "conflictsRaised",
  revalidation_target: "revalidationTargets",
  native_recovery_success: "nativeRecoverySuccess"
});

// dictionary-backup.js
function requestOf6(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf6, "requestOf");
var BACKUP_POLICY = Object.freeze({
  backupPolicyVersion: 1,
  /** §107.1「1 page/chunk の上限を Config 化」。cursor page / write chunk。 */
  chunkSize: 500,
  /** §107.1 Blob fallback の明示 size 上限。超えたら BackupSizeLimitError。 */
  blobFallbackMaxBytes: 256 * 1024 * 1024,
  /**
   * checksum のアルゴリズム識別子。
   * order-independent per-store XOR of cyrb128(canonicalSerialize(record))。
   * これは「payload が truncate / 破損 / 並べ替わっていないか」の整合性検査であり、
   * 署名ではない（Full Backup の署名は §102.3.15 / Phase 9B の範囲）。
   * 同期 hash にすることで 1M record でも await を積まずに回る。
   */
  checksumAlgo: "cyrb128-xor-v1",
  /** Restore / Merge の1 fenced transaction で書く record の上限（巨大 tx にしない）。 */
  restoreChunkSize: 1e3,
  mergeChunkSize: 1e3,
  /** 長時間 Restore/Merge の Maintenance Lease TTL（chunk コスト増でも切れない余裕）。 */
  restoreLeaseTtlMs: 12e4,
  mergeLeaseTtlMs: 12e4,
  snapshotLeaseTtlMs: 6e4,
  /** 長時間 Restore/Merge/Snapshot 中に Maintenance Lease を renew する chunk / record 間隔。 */
  leaseRenewEveryChunks: 1,
  snapshotHeartbeatEveryRecords: 5e3,
  /** §102.1 v2: versioned streaming framing の version 番号。 */
  streamVersion: 2,
  /** staging DB 名（Full Restore の破壊前 ingest 先。main DB とは別）。 */
  stagingDbName: "FMlncGenImportStaging",
  /** staging → main の copy で1回に読む bounded page（getAll(range, count)）。 */
  stagingCopyPageSize: 2e3
});
var BACKUP_STREAM = Object.freeze({
  version: 2,
  marker: "@",
  sectionManifest: "@manifest",
  sectionEnd: "@end"
});
var KNOWN_CHECKSUM_ALGOS = Object.freeze(["cyrb128-xor-v1"]);
var BACKUP_SAFETY_LIMITS = Object.freeze({
  maxBytes: 1500 * 1024 * 1024,
  maxRecordsPerStore: 5e6,
  maxStringLength: 1e6,
  maxDepth: 64
});
var RESTORE_CONFIRMATION = "REPLACE-LOCAL-DICTIONARY";
var MERGE_CONFIRMATION = "MERGE-INTO-LOCAL-DICTIONARY";
var BackupError = class extends Error {
  static {
    __name(this, "BackupError");
  }
  constructor(message, details) {
    super(message);
    this.name = "BackupError";
    this.details = details;
  }
};
var BackupSizeLimitError = class extends BackupError {
  static {
    __name(this, "BackupSizeLimitError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "BackupSizeLimitError";
  }
};
var RestoreConfirmationError = class extends BackupError {
  static {
    __name(this, "RestoreConfirmationError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "RestoreConfirmationError";
  }
};
var RestoreValidationError = class extends BackupError {
  static {
    __name(this, "RestoreValidationError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "RestoreValidationError";
  }
};
var MergeError = class extends BackupError {
  static {
    __name(this, "MergeError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "MergeError";
  }
};
var BACKUP_STORES = Object.freeze([
  [STORE.entities, "entities", "entityKey"],
  [STORE.claims, "claims", "claimId"],
  [STORE.evidence, "evidence", "evidenceId"],
  [STORE.relations, "relations", "relationId"],
  [STORE.history, "history", "historyId"],
  [STORE.rejections, "rejections", "rejectionId"],
  [STORE.packages, "packages", "packageKey"]
]);
var BACKUP_FIELDS = Object.freeze(BACKUP_STORES.map(([, field]) => field));
function xorHex(a, b) {
  if (!a) return b;
  if (!b) return a;
  const n = Math.max(a.length, b.length);
  const pa = a.padStart(n, "0");
  const pb = b.padStart(n, "0");
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += (parseInt(pa[i], 16) ^ parseInt(pb[i], 16)).toString(16);
  }
  return out;
}
__name(xorHex, "xorHex");
function recordDigest(record) {
  return cyrb128Hex(stableSerialize(record));
}
__name(recordDigest, "recordDigest");
function cyrb128Hex(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i += 1) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ h1 >>> 18, 597399067);
  h2 = Math.imul(h4 ^ h2 >>> 22, 2869860233);
  h3 = Math.imul(h1 ^ h3 >>> 17, 951274213);
  h4 = Math.imul(h2 ^ h4 >>> 19, 2716044179);
  h1 = (h1 ^ h2 ^ h3 ^ h4) >>> 0;
  h2 = (h2 ^ h1) >>> 0;
  h3 = (h3 ^ h1) >>> 0;
  h4 = (h4 ^ h1) >>> 0;
  const hx = /* @__PURE__ */ __name((x) => x.toString(16).padStart(8, "0"), "hx");
  return hx(h1) + hx(h2) + hx(h3) + hx(h4);
}
__name(cyrb128Hex, "cyrb128Hex");
function createStoreDigestAccumulator() {
  let count = 0;
  let digest = "";
  return {
    add(record) {
      count += 1;
      digest = xorHex(digest, recordDigest(record));
    },
    finish() {
      return { count, digest: digest || "0" };
    }
  };
}
__name(createStoreDigestAccumulator, "createStoreDigestAccumulator");
function manifestChecksum(perStore) {
  let c = "";
  for (const field of BACKUP_FIELDS) {
    const s = perStore[field];
    if (s) c = xorHex(c, s.digest);
  }
  return c || "0";
}
__name(manifestChecksum, "manifestChecksum");
function createBlobSink({ maxBytes = BACKUP_POLICY.blobFallbackMaxBytes, mime = "application/json" } = {}) {
  const parts = [];
  let bytes = 0;
  let closed = false;
  let aborted = false;
  return {
    kind: "blob",
    async write(chunk) {
      if (closed || aborted) throw new BackupError("sink is closed");
      const s = typeof chunk === "string" ? chunk : String(chunk);
      bytes += byteLength(s);
      if (bytes > maxBytes) {
        aborted = true;
        throw new BackupSizeLimitError(
          `Blob fallback backup exceeded ${maxBytes} bytes; use a File System writable stream`,
          { bytes, maxBytes }
        );
      }
      parts.push(s);
    },
    async close() {
      closed = true;
    },
    async abort() {
      aborted = true;
      parts.length = 0;
    },
    get bytesWritten() {
      return bytes;
    },
    get aborted() {
      return aborted;
    },
    toBlob() {
      if (!closed) throw new BackupError("sink not closed");
      if (aborted) throw new BackupError("sink was aborted; no blob");
      return new Blob(parts, { type: mime });
    },
    toString() {
      if (aborted) throw new BackupError("sink was aborted");
      return parts.join("");
    }
  };
}
__name(createBlobSink, "createBlobSink");
function byteLength(s) {
  if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    n += c < 128 ? 1 : c < 2048 ? 2 : 3;
  }
  return n;
}
__name(byteLength, "byteLength");
function whitelistMetaForBackup(meta) {
  const out = {};
  for (const k of BACKUP_META_WHITELIST) if (meta[k] !== void 0) out[k] = meta[k];
  return out;
}
__name(whitelistMetaForBackup, "whitelistMetaForBackup");
async function backupToSink(db, {
  sink,
  mode = BACKUP_MODE.optimisticRevisionCheck,
  chunkSize = BACKUP_POLICY.chunkSize,
  owner = void 0,
  leaseTtlMs = BACKUP_POLICY.snapshotLeaseTtlMs,
  now = Date.now(),
  onProgress = null
} = {}) {
  if (!sink || typeof sink.write !== "function" || typeof sink.close !== "function") {
    throw new BackupError("backupToSink: sink must have write() and close()");
  }
  if (!Object.values(BACKUP_MODE).includes(mode)) {
    throw new BackupError(`backupToSink: unknown mode ${mode}`, { mode });
  }
  let lease = null;
  let leaseRenewCount = 0;
  let recordsSinceHeartbeat = 0;
  const startMeta = await getMeta(db);
  const startRevision = startMeta.userDictionaryRevision;
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_STREAM.version,
    backupId: newOpaqueId("backup"),
    createdAt: new Date(now).toISOString(),
    sourceInstallationId: startMeta.installationId,
    capturedUserDictionaryRevision: startRevision,
    keySchemaVersion: startMeta.keySchemaVersion ?? KEY_SCHEMA_VERSION,
    checksumAlgo: BACKUP_POLICY.checksumAlgo,
    mode
  };
  const heartbeat = /* @__PURE__ */ __name(async (force = false) => {
    if (!lease) return;
    recordsSinceHeartbeat += 1;
    if (!force && recordsSinceHeartbeat < 1) return;
    recordsSinceHeartbeat = 0;
    const next = await renewMaintenanceLease(db, {
      ...owner ? { owner } : {},
      leaseEpoch: lease.leaseEpoch,
      ttlMs: leaseTtlMs
    });
    leaseRenewCount += 1;
    lease = next;
  }, "heartbeat");
  const perStore = {};
  let recordCount = 0;
  let failed = null;
  try {
    if (mode === BACKUP_MODE.maintenanceSnapshot) {
      lease = await acquireMaintenanceLease(db, {
        type: "full_backup_snapshot",
        ttlMs: leaseTtlMs,
        ...owner ? { owner } : {},
        now
      });
    }
    await sink.write(`${JSON.stringify(header)}
`);
    for (const [storeName, field] of BACKUP_STORES) {
      if (BACKUP_EXCLUDED_STORES.includes(storeName)) continue;
      const acc = createStoreDigestAccumulator();
      await sink.write(`${BACKUP_STREAM.marker}${field}
`);
      await heartbeat(true);
      await forEachChunk(db, storeName, async (items) => {
        for (const rec of items) {
          await sink.write(`${JSON.stringify(rec)}
`);
          acc.add(rec);
          recordCount += 1;
          if (lease && recordCount % BACKUP_POLICY.snapshotHeartbeatEveryRecords === 0) {
            await heartbeat(true);
          }
        }
        if (onProgress) await onProgress({ field, recordCount });
      }, { chunkSize });
      perStore[field] = acc.finish();
    }
    const endMeta = await getMeta(db);
    if (endMeta.userDictionaryRevision !== startRevision) {
      throw new BackupConsistencyError(
        "userDictionaryRevision changed during export; backup is not consistent",
        {
          startRevision,
          endRevision: endMeta.userDictionaryRevision,
          mode
        }
      );
    }
    const meta = whitelistMetaForBackup({
      ...startMeta,
      sourceInstallationId: startMeta.installationId,
      capturedUserDictionaryRevision: startRevision
    });
    const manifest = {
      checksumAlgo: BACKUP_POLICY.checksumAlgo,
      totalRecords: recordCount,
      perStore,
      checksum: manifestChecksum(perStore)
    };
    await sink.write(`${BACKUP_STREAM.marker}meta
${JSON.stringify(meta)}
`);
    await sink.write(`${BACKUP_STREAM.sectionManifest}
${JSON.stringify(manifest)}
`);
    await sink.write(`${BACKUP_STREAM.sectionEnd}
`);
    await sink.close();
    return {
      header,
      manifest,
      mode,
      bytesWritten: sink.bytesWritten ?? null,
      recordCount,
      leaseRenewCount
    };
  } catch (e) {
    failed = e;
    try {
      await sink.abort?.();
    } catch {
    }
    throw e;
  } finally {
    if (lease) {
      try {
        await releaseMaintenanceLease(db, {
          ...owner ? { owner } : {},
          leaseEpoch: lease.leaseEpoch
        });
      } catch {
      }
    }
    if (failed && onProgress) onProgress({ failed: true, error: String(failed) });
  }
}
__name(backupToSink, "backupToSink");
function parseBackupText(text, { limits = BACKUP_SAFETY_LIMITS } = {}) {
  if (typeof text !== "string") throw new BackupError("parseBackupText: expected a string");
  const bytes = byteLength(text);
  if (bytes > limits.maxBytes) {
    throw new BackupSizeLimitError(`backup text exceeds ${limits.maxBytes} bytes`, { bytes });
  }
  const trimmed = text.replace(/^﻿/, "");
  const nl = trimmed.indexOf("\n");
  const firstLine = (nl >= 0 ? trimmed.slice(0, nl) : trimmed).trim();
  let firstObj = null;
  try {
    firstObj = JSON.parse(firstLine);
  } catch {
  }
  if (firstObj && typeof firstObj === "object" && !Array.isArray(firstObj) && (firstObj.version === BACKUP_STREAM.version || nl >= 0 && trimmed.slice(nl + 1).trimStart().startsWith(BACKUP_STREAM.marker))) {
    return backupSourceFromStream({ open: /* @__PURE__ */ __name(() => [trimmed], "open") }, { limits });
  }
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    throw new RestoreValidationError("backup is not valid JSON / not a recognised framing", { error: String(e) });
  }
  return backupSourceFromObject(obj, { limits });
}
__name(parseBackupText, "parseBackupText");
function backupSourceFromObject(obj, { limits = BACKUP_SAFETY_LIMITS } = {}) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new RestoreValidationError("backup must be a JSON object", {});
  }
  for (const field of BACKUP_FIELDS) {
    const arr = obj[field];
    if (arr !== void 0) {
      if (!Array.isArray(arr)) throw new RestoreValidationError(`backup.${field} must be an array`, { field });
      if (arr.length > limits.maxRecordsPerStore) {
        throw new BackupSizeLimitError(`backup.${field} has too many records`, { field, count: arr.length });
      }
    }
  }
  const header = {
    format: obj.format,
    version: obj.version,
    backupId: obj.backupId ?? null,
    createdAt: obj.createdAt ?? null,
    sourceInstallationId: obj.sourceInstallationId ?? null,
    capturedUserDictionaryRevision: obj.capturedUserDictionaryRevision ?? null,
    keySchemaVersion: obj.keySchemaVersion ?? (obj.meta?.keySchemaVersion ?? null),
    checksumAlgo: obj.checksumAlgo ?? obj.manifest?.checksumAlgo ?? null,
    mode: obj.mode ?? null
  };
  return {
    header,
    meta: obj.meta ?? {},
    manifest: obj.manifest ?? null,
    keySchemaVersion: header.keySchemaVersion,
    async *records(field) {
      const arr = obj[field] ?? [];
      for (const r of arr) yield r;
    },
    counts() {
      const c = {};
      for (const field of BACKUP_FIELDS) c[field] = (obj[field] ?? []).length;
      return c;
    }
  };
}
__name(backupSourceFromObject, "backupSourceFromObject");
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function assertBoundedDepth(value, maxDepth, depth = 0) {
  if (depth > maxDepth) throw new BackupSizeLimitError(`record nesting exceeds maxDepth ${maxDepth}`, { maxDepth });
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const v of value) assertBoundedDepth(v, maxDepth, depth + 1);
    } else {
      for (const k of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(k)) throw new RestoreValidationError(`record contains forbidden key: ${k}`, { key: k });
        assertBoundedDepth(value[k], maxDepth, depth + 1);
      }
    }
  }
}
__name(assertBoundedDepth, "assertBoundedDepth");
function parseRecordLine(line, limits) {
  if (line.length > limits.maxStringLength) {
    throw new BackupSizeLimitError(`record line exceeds maxStringLength ${limits.maxStringLength}`, { len: line.length });
  }
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (e) {
    throw new RestoreValidationError("malformed record line (not valid JSON)", { error: String(e) });
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new RestoreValidationError("record line is not a JSON object", {});
  }
  assertBoundedDepth(obj, limits.maxDepth);
  return obj;
}
__name(parseRecordLine, "parseRecordLine");
function openChunks(reopenable) {
  if (reopenable == null) throw new BackupError("streaming reader: source is null");
  if (typeof reopenable === "string") return [reopenable];
  if (typeof reopenable.open === "function") return reopenable.open();
  if (typeof Blob !== "undefined" && reopenable instanceof Blob) {
    if (typeof reopenable.stream === "function") return reopenable.stream();
    return { async *[Symbol.asyncIterator]() {
      yield await reopenable.text();
    } };
  }
  if (typeof reopenable[Symbol.asyncIterator] === "function" || typeof reopenable[Symbol.iterator] === "function") return reopenable;
  throw new BackupError("streaming reader: unsupported source (need Blob | {open} | string | iterable)");
}
__name(openChunks, "openChunks");
async function* iterateLines(reopenable, { maxBytes, maxStringLength, signal = null } = {}) {
  const src = openChunks(reopenable);
  const decoder = typeof TextDecoder === "function" ? new TextDecoder("utf-8", { fatal: true }) : null;
  const decodeChunk = /* @__PURE__ */ __name((value, stream) => {
    try {
      return decoder.decode(value, { stream });
    } catch (e) {
      throw new RestoreValidationError("backup artifact contains malformed UTF-8 (rejected before checksum)", { error: String(e && e.message || e) });
    }
  }, "decodeChunk");
  let buf = "";
  let total = 0;
  const it = src[Symbol.asyncIterator] ? src[Symbol.asyncIterator]() : src[Symbol.iterator]();
  for (; ; ) {
    if (signal?.aborted) throw new BackupError("streaming reader: aborted");
    const { value, done } = await it.next();
    if (done) break;
    let text;
    if (typeof value === "string") {
      text = value;
      total += byteLength(value);
    } else {
      total += value.byteLength ?? value.length ?? 0;
      text = decoder ? decodeChunk(value, true) : String.fromCharCode(...value);
    }
    if (maxBytes && total > maxBytes) {
      throw new BackupSizeLimitError(`backup artifact exceeds maxBytes ${maxBytes}`, { total, maxBytes });
    }
    buf += text;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (maxStringLength && line.length > maxStringLength) {
        throw new BackupSizeLimitError(`backup line exceeds maxStringLength ${maxStringLength}`, { len: line.length });
      }
      yield line;
    }
    if (maxStringLength && buf.length > maxStringLength * 2) {
      throw new BackupSizeLimitError("backup line buffer overflow (no newline within bound)", { buffered: buf.length });
    }
  }
  if (decoder) buf += decodeChunk(void 0, false);
  if (buf.length) {
    if (buf.endsWith("\r")) buf = buf.slice(0, -1);
    yield buf;
  }
}
__name(iterateLines, "iterateLines");
function backupSourceFromStream(reopenable, { limits = BACKUP_SAFETY_LIMITS } = {}) {
  if (typeof reopenable !== "string" && typeof reopenable?.open !== "function" && !(typeof Blob !== "undefined" && reopenable instanceof Blob)) {
    throw new BackupError(
      "backupSourceFromStream needs a re-openable source (Blob | {open} | string). For a one-shot stream, stage it first (restoreFullBackup handles this)."
    );
  }
  let cachedHeader;
  let cachedMeta;
  let cachedManifest;
  let cachedStructure;
  const lineOpts = { maxBytes: limits.maxBytes, maxStringLength: limits.maxStringLength };
  async function readHeader() {
    if (cachedHeader !== void 0) return cachedHeader;
    for await (const line of iterateLines(reopenable, lineOpts)) {
      if (line.trim() === "") continue;
      let h;
      try {
        h = JSON.parse(line);
      } catch (e) {
        throw new RestoreValidationError("backup header line is not valid JSON", { error: String(e) });
      }
      if (!h || typeof h !== "object") throw new RestoreValidationError("backup header is not an object", {});
      if (h.format !== BACKUP_FORMAT) throw new RestoreValidationError(`unknown backup format: ${h.format}`, { format: h.format });
      if (h.version !== BACKUP_STREAM.version) {
        throw new RestoreValidationError(`unsupported streaming backup version ${h.version}`, { version: h.version });
      }
      if (h.checksumAlgo != null && !KNOWN_CHECKSUM_ALGOS.includes(h.checksumAlgo)) {
        throw new RestoreValidationError(`unknown checksum algorithm: ${h.checksumAlgo}`, { checksumAlgo: h.checksumAlgo });
      }
      cachedHeader = {
        format: h.format,
        version: h.version,
        backupId: h.backupId ?? null,
        createdAt: h.createdAt ?? null,
        sourceInstallationId: h.sourceInstallationId ?? null,
        capturedUserDictionaryRevision: h.capturedUserDictionaryRevision ?? null,
        keySchemaVersion: h.keySchemaVersion ?? null,
        checksumAlgo: h.checksumAlgo ?? null,
        mode: h.mode ?? null
      };
      return cachedHeader;
    }
    throw new RestoreValidationError("backup artifact is empty / has no header line", {});
  }
  __name(readHeader, "readHeader");
  async function readStructure() {
    if (cachedStructure !== void 0) return cachedStructure;
    const ORDER = [...BACKUP_FIELDS, "meta", "manifest", "end"];
    const STORE_SET = new Set(BACKUP_FIELDS);
    const seen = /* @__PURE__ */ new Set();
    let sawHeader = false;
    let orderIdx = -1;
    let current = null;
    let ended = false;
    const perStore = {};
    for await (const line of iterateLines(reopenable, lineOpts)) {
      if (!sawHeader) {
        sawHeader = true;
        continue;
      }
      if (line.trim() === "") continue;
      if (ended) {
        throw new RestoreValidationError("backup artifact has content after @end", { line: line.slice(0, 64) });
      }
      if (line.startsWith(BACKUP_STREAM.marker)) {
        const name = line.slice(BACKUP_STREAM.marker.length).trim();
        const idx = ORDER.indexOf(name);
        if (idx < 0) throw new RestoreValidationError(`unknown backup section marker: @${name}`, { marker: name });
        if (seen.has(name)) throw new RestoreValidationError(`duplicated backup section: @${name}`, { marker: name });
        if (idx <= orderIdx) {
          throw new RestoreValidationError(
            `out-of-order backup section: @${name} after @${ORDER[orderIdx]}`,
            { marker: name, afterIndex: orderIdx }
          );
        }
        for (let k = orderIdx + 1; k < idx; k += 1) {
          throw new RestoreValidationError(`missing backup section: @${ORDER[k]} (before @${name})`, { missing: ORDER[k] });
        }
        seen.add(name);
        orderIdx = idx;
        if (name === "end") {
          ended = true;
          current = null;
          continue;
        }
        if (name === "meta" || name === "manifest") {
          current = null;
          continue;
        }
        current = name;
        perStore[name] = 0;
        continue;
      }
      if (current === null) {
        if (orderIdx >= 0 && (ORDER[orderIdx] === "meta" || ORDER[orderIdx] === "manifest")) continue;
        throw new RestoreValidationError("backup record line outside any section", { line: line.slice(0, 64) });
      }
      if (!STORE_SET.has(current)) throw new RestoreValidationError("backup record line outside any store section", {});
      perStore[current] = (perStore[current] ?? 0) + 1;
      if (perStore[current] > limits.maxRecordsPerStore) {
        throw new BackupSizeLimitError(`section @${current} exceeds maxRecordsPerStore ${limits.maxRecordsPerStore}`, { field: current });
      }
    }
    if (!ended) throw new RestoreValidationError("backup artifact is truncated (@end marker missing)", {});
    if (!seen.has("manifest")) throw new RestoreValidationError("backup artifact has no @manifest section", {});
    for (const f of BACKUP_FIELDS) {
      if (!seen.has(f)) throw new RestoreValidationError(`missing backup section: @${f}`, { missing: f });
    }
    cachedStructure = { sections: [...seen].filter((s) => STORE_SET.has(s)), perStore, sawManifest: true, sawEnd: true };
    return cachedStructure;
  }
  __name(readStructure, "readStructure");
  async function readTaggedObject(sectionName, cacheSetter) {
    let hit = false;
    for await (const line of iterateLines(reopenable, lineOpts)) {
      if (hit) {
        if (line.trim() === "") continue;
        if (line.startsWith(BACKUP_STREAM.marker)) break;
        let o;
        try {
          o = JSON.parse(line);
        } catch (e) {
          throw new RestoreValidationError(`@${sectionName} payload is not valid JSON`, { error: String(e) });
        }
        assertBoundedDepth(o, limits.maxDepth);
        return cacheSetter(o);
      }
      if (line.trim() === `${BACKUP_STREAM.marker}${sectionName}`) hit = true;
    }
    if (hit) return cacheSetter(sectionName === "meta" ? {} : null);
    return cacheSetter(sectionName === "meta" ? {} : null);
  }
  __name(readTaggedObject, "readTaggedObject");
  const src = {
    get header() {
      return cachedHeader ?? null;
    },
    get meta() {
      return cachedMeta ?? {};
    },
    get manifest() {
      return cachedManifest ?? null;
    },
    get keySchemaVersion() {
      return (cachedHeader ?? {}).keySchemaVersion ?? null;
    },
    async ready() {
      await readHeader();
      await readTaggedObject("meta", (o) => {
        cachedMeta = o ?? {};
        return cachedMeta;
      });
      await readTaggedObject("manifest", (o) => {
        cachedManifest = o ?? null;
        return cachedManifest;
      });
      return src;
    },
    async validateStructure() {
      return readStructure();
    },
    async *records(field, { onProgress = null, signal = null } = {}) {
      if (!BACKUP_FIELDS.includes(field)) throw new BackupError(`records(): unknown field ${field}`);
      let inSection = false;
      let n = 0;
      for await (const line of iterateLines(reopenable, { ...lineOpts, signal })) {
        if (line.trim() === "") continue;
        if (line.startsWith(BACKUP_STREAM.marker)) {
          if (inSection) break;
          if (line.trim() === `${BACKUP_STREAM.marker}${field}`) inSection = true;
          continue;
        }
        if (!inSection) continue;
        n += 1;
        if (n > limits.maxRecordsPerStore) {
          throw new BackupSizeLimitError(`section @${field} exceeds maxRecordsPerStore`, { field });
        }
        const rec = parseRecordLine(line, limits);
        yield rec;
        if (onProgress && n % 5e3 === 0) onProgress({ field, count: n });
      }
    },
    counts() {
      const c = {};
      for (const field of BACKUP_FIELDS) c[field] = cachedManifest?.perStore?.[field]?.count ?? null;
      return c;
    }
  };
  return src;
}
__name(backupSourceFromStream, "backupSourceFromStream");
function backupSourceFromBlob(blob, { limits = BACKUP_SAFETY_LIMITS } = {}) {
  return backupSourceFromStream(blob, { limits });
}
__name(backupSourceFromBlob, "backupSourceFromBlob");
var SUPPORTED_BACKUP_VERSIONS = Object.freeze([BACKUP_VERSION, BACKUP_STREAM.version]);
function assertBackupCompatible(source) {
  const h = source.header ?? {};
  if (h.format !== BACKUP_FORMAT) {
    throw new RestoreValidationError(`unknown backup format: ${h.format}`, { format: h.format });
  }
  if (!SUPPORTED_BACKUP_VERSIONS.includes(h.version)) {
    throw new RestoreValidationError(
      `unsupported backup version ${h.version}; no format adapter for it`,
      { version: h.version }
    );
  }
  if (h.checksumAlgo != null && !KNOWN_CHECKSUM_ALGOS.includes(h.checksumAlgo)) {
    throw new RestoreValidationError(`unknown checksum algorithm: ${h.checksumAlgo}`, { checksumAlgo: h.checksumAlgo });
  }
  const ks = source.keySchemaVersion ?? h.keySchemaVersion;
  if (ks != null && ks !== KEY_SCHEMA_VERSION) {
    throw new RestoreValidationError(
      `backup keySchemaVersion ${ks} != current ${KEY_SCHEMA_VERSION}; a logical key migration is required first (§120-41)`,
      { backup: ks, current: KEY_SCHEMA_VERSION }
    );
  }
  return true;
}
__name(assertBackupCompatible, "assertBackupCompatible");
function detectReplacementCycle(edges) {
  const g = /* @__PURE__ */ new Map();
  for (const [a, b] of edges) {
    if (!g.has(a)) g.set(a, []);
    g.get(a).push(b);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  const stack = [];
  function dfs(u) {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of g.get(u) ?? []) {
      if ((color.get(v) ?? WHITE) === GRAY) return [...stack, v];
      if ((color.get(v) ?? WHITE) === WHITE) {
        const c = dfs(v);
        if (c) return c;
      }
    }
    color.set(u, BLACK);
    stack.pop();
    return null;
  }
  __name(dfs, "dfs");
  for (const u of g.keys()) {
    if ((color.get(u) ?? WHITE) === WHITE) {
      const c = dfs(u);
      if (c) return c;
    }
  }
  return null;
}
__name(detectReplacementCycle, "detectReplacementCycle");
var SEMANTIC_RESTORE_STORES = Object.freeze([
  STORE.entities,
  STORE.claims,
  STORE.evidence,
  STORE.relations,
  STORE.history,
  STORE.rejections,
  STORE.packages
]);
var STAGING_SESSION_STORE = "_session";
var RESTORE_PHASE = Object.freeze({
  validating: "validating",
  // artifact を staging DB へ ingest + 検証中（main は不変）
  staged: "staged",
  // ingest+検証 完了。main はまだ不変（ここまでは rollback 可能）
  replacing: "replacing",
  // main を clear → staging から copy 中（half-state 期間）
  finalizing: "finalizing",
  // main への copy 完了。integrity + meta 反映中
  completed: "completed"
  // activation 済み。currentKnowledgeStable へ戻る
});
var RestoreConflictError = class extends BackupError {
  static {
    __name(this, "RestoreConflictError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "RestoreConflictError";
  }
};
var MergeConflictError = class extends BackupError {
  static {
    __name(this, "MergeConflictError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "MergeConflictError";
  }
};
var ABANDON_STUCK_CONFIRMATION = "ABANDON-STUCK-IMPORT";
function stagingDbNameFor(sessionId) {
  return `${BACKUP_POLICY.stagingDbName}_${sessionId}`;
}
__name(stagingDbNameFor, "stagingDbNameFor");
function checkConfirmation(confirm, expected, ErrorType, what) {
  const token = typeof confirm === "string" ? confirm : confirm?.acknowledge;
  if (token !== expected) {
    throw new ErrorType(
      `${what} requires explicit confirmation: pass confirm: ${JSON.stringify(expected)}`,
      { got: token ?? null }
    );
  }
}
__name(checkConfirmation, "checkConfirmation");
function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(idbReq, "idbReq");
function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("staging tx aborted"));
  });
}
__name(idbTxDone, "idbTxDone");
async function openStagingDb(env, sessionId) {
  const factory = env?.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new BackupError("import staging: IndexedDB unavailable");
  if (!sessionId) throw new BackupError("openStagingDb: sessionId is required");
  const name = stagingDbNameFor(sessionId);
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {
      const sdb = open.result;
      for (const [, field, keyPath] of BACKUP_STORES) {
        if (!sdb.objectStoreNames.contains(field)) sdb.createObjectStore(field, { keyPath });
      }
      if (!sdb.objectStoreNames.contains(STAGING_SESSION_STORE)) {
        sdb.createObjectStore(STAGING_SESSION_STORE, { keyPath: "k" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
__name(openStagingDb, "openStagingDb");
async function deleteStagingDb(env, sessionId) {
  const factory = env?.indexedDB ?? globalThis.indexedDB;
  if (!factory || !sessionId) return;
  await new Promise((resolve) => {
    const r = factory.deleteDatabase(stagingDbNameFor(sessionId));
    r.onsuccess = () => resolve();
    r.onerror = () => resolve();
    r.onblocked = () => resolve();
  });
}
__name(deleteStagingDb, "deleteStagingDb");
async function readStagingSession(sdb) {
  const tx = sdb.transaction([STAGING_SESSION_STORE], "readonly");
  const s = await idbReq(tx.objectStore(STAGING_SESSION_STORE).get("current"));
  await idbTxDone(tx);
  return s ?? null;
}
__name(readStagingSession, "readStagingSession");
async function writeStagingSession(sdb, session) {
  const tx = sdb.transaction([STAGING_SESSION_STORE], "readwrite");
  await idbReq(tx.objectStore(STAGING_SESSION_STORE).put({ k: "current", ...session }));
  await idbTxDone(tx);
}
__name(writeStagingSession, "writeStagingSession");
async function guardNewImport(db, { env, kind, ErrorType, recoverStuck = null }) {
  const meta = await getMeta(db);
  const rm = meta[RESTORE_MARKER_META_KEY] ?? null;
  const mm = meta[MERGE_MARKER_META_KEY] ?? null;
  const running = [rm, mm].find((m) => m && m.state === "running");
  if (!running) return;
  const token = typeof recoverStuck === "string" ? recoverStuck : recoverStuck?.acknowledge;
  const wantSession = recoverStuck?.sessionId ?? null;
  if (token === ABANDON_STUCK_CONFIRMATION && wantSession && wantSession === running.sessionId) {
    const key = running.operation === "merge" ? MERGE_MARKER_META_KEY : RESTORE_MARKER_META_KEY;
    await setImportMarker(db, null, key, { ...running, state: "abandoned", abandonedAt: Date.now() });
    await deleteStagingDb(env, running.sessionId);
    return;
  }
  throw new ErrorType(
    `cannot start a new ${kind}: another import operation is in progress (operation=${running.operation}, session=${running.sessionId}, phase=${running.phase}). Resume it, or pass recoverStuck:{acknowledge:${JSON.stringify(ABANDON_STUCK_CONFIRMATION)}, sessionId:"${running.sessionId}"} to explicitly abandon it.`,
    { running }
  );
}
__name(guardNewImport, "guardNewImport");
function detectAdjacencyCycle(edges, { maxDepth = 128 } = {}) {
  const g = /* @__PURE__ */ new Map();
  for (const [a, b] of edges) {
    if (!g.has(a)) g.set(a, []);
    g.get(a).push(b);
  }
  const state = /* @__PURE__ */ new Map();
  const dfs = /* @__PURE__ */ __name((u, depth) => {
    if (depth > maxDepth) return null;
    state.set(u, 1);
    for (const v of g.get(u) ?? []) {
      const s = state.get(v);
      if (s === 1) return [u, v];
      if (!s) {
        const c = dfs(v, depth + 1);
        if (c) return c;
      }
    }
    state.set(u, 2);
    return null;
  }, "dfs");
  for (const u of g.keys()) if (!state.get(u) && (g.get(u) ?? []).length) {
    const c = dfs(u, 0);
    if (c) return c;
  }
  return null;
}
__name(detectAdjacencyCycle, "detectAdjacencyCycle");
async function stageAndValidate(sdb, source, { limits, onProgress = null, signal = null, danglingFatal = true, renew = null } = {}) {
  if (typeof source.validateStructure === "function") {
    await source.validateStructure();
  }
  {
    const tx = sdb.transaction(BACKUP_FIELDS, "readwrite");
    for (const f of BACKUP_FIELDS) tx.objectStore(f).clear();
    await idbTxDone(tx);
  }
  const problems = [];
  const add = /* @__PURE__ */ __name((p) => {
    if (problems.length < 500) problems.push(p);
  }, "add");
  const perStore = {};
  const counts = {};
  const entityKeys = /* @__PURE__ */ new Set();
  const nodeIds = /* @__PURE__ */ new Set();
  const claimIds = /* @__PURE__ */ new Set();
  const semanticKeys = /* @__PURE__ */ new Set();
  const dedupeKeys = /* @__PURE__ */ new Set();
  const edgeKeys = /* @__PURE__ */ new Set();
  const supersedes = [];
  const dependsEdges = [];
  let danglingCount = 0;
  for (const [, field] of BACKUP_STORES) {
    const acc = createStoreDigestAccumulator();
    let n = 0;
    let batch = [];
    const flush = /* @__PURE__ */ __name(async () => {
      if (!batch.length) return;
      const items = batch;
      batch = [];
      const tx = sdb.transaction([field], "readwrite");
      const os = tx.objectStore(field);
      for (const r of items) os.put(r);
      await idbTxDone(tx);
    }, "flush");
    for await (const rec of source.records(field, { signal })) {
      n += 1;
      if (n > limits.maxRecordsPerStore) throw new BackupSizeLimitError(`section @${field} exceeds maxRecordsPerStore`, { field });
      acc.add(rec);
      if (renew && n % 2e4 === 0) await renew();
      if (field === "entities") {
        if (typeof rec.entityKey !== "string" || !rec.entityKey) add({ kind: "invalid_entity_key", entityKey: rec.entityKey ?? null });
        else {
          if (entityKeys.has(rec.entityKey)) add({ kind: "duplicate_entity_key", entityKey: rec.entityKey });
          entityKeys.add(rec.entityKey);
        }
        if (typeof rec.nodeId === "string") nodeIds.add(rec.nodeId);
      } else if (field === "claims") {
        if (typeof rec.claimId === "string" && rec.claimId) {
          claimIds.add(rec.claimId);
          nodeIds.add(rec.claimId);
        } else add({ kind: "invalid_claim_id", claimId: rec.claimId ?? null });
        if (typeof rec.semanticKey === "string") {
          if (semanticKeys.has(rec.semanticKey)) add({ kind: "duplicate_semantic_key", semanticKey: rec.semanticKey });
          semanticKeys.add(rec.semanticKey);
        } else add({ kind: "missing_semantic_key", claimId: rec.claimId ?? null });
        try {
          if (rec.valueType && rec.value !== void 0) {
            validateClaimValue({ valueType: rec.valueType, value: rec.value, script: rec.script ?? null, normalizedValue: rec.normalizedValue, foldedValue: rec.foldedValue });
          } else add({ kind: "invalid_typed_value", claimId: rec.claimId ?? null, error: "missing valueType/value" });
        } catch (err) {
          add({ kind: "invalid_typed_value", claimId: rec.claimId ?? null, error: err.message });
        }
        if (typeof rec.supersededByClaimId === "string") supersedes.push([rec.claimId, rec.supersededByClaimId]);
      } else if (field === "evidence") {
        if (typeof rec.evidenceId !== "string" || !rec.evidenceId) add({ kind: "invalid_evidence_id", evidenceId: rec.evidenceId ?? null });
        if (typeof rec.dedupeKey === "string") {
          if (dedupeKeys.has(rec.dedupeKey)) add({ kind: "duplicate_dedupe_key", dedupeKey: rec.dedupeKey });
          dedupeKeys.add(rec.dedupeKey);
        }
        if (rec.claimId != null && !claimIds.has(rec.claimId)) {
          add({ kind: "dangling_evidence_claim", evidenceId: rec.evidenceId, claimId: rec.claimId });
          danglingCount += 1;
        }
      } else if (field === "relations") {
        if (typeof rec.edgeKey === "string") {
          if (edgeKeys.has(rec.edgeKey)) add({ kind: "duplicate_edge_key", edgeKey: rec.edgeKey });
          edgeKeys.add(rec.edgeKey);
        }
        if (rec.fromNodeId != null && !nodeIds.has(rec.fromNodeId)) {
          add({ kind: "dangling_relation_from", relationId: rec.relationId, node: rec.fromNodeId });
          danglingCount += 1;
        }
        if (rec.toNodeId != null && !nodeIds.has(rec.toNodeId)) {
          add({ kind: "dangling_relation_to", relationId: rec.relationId, node: rec.toNodeId });
          danglingCount += 1;
        }
        if (rec.relation === "depends_on" && rec.fromNodeId && rec.toNodeId) dependsEdges.push([rec.fromNodeId, rec.toNodeId]);
      } else if (field === "history") {
        if (rec.nodeId != null && !nodeIds.has(rec.nodeId)) {
          add({ kind: "dangling_history_node", historyId: rec.historyId, node: rec.nodeId });
          danglingCount += 1;
        }
      } else if (field === "rejections") {
        if (rec.replacementClaimId != null && !claimIds.has(rec.replacementClaimId)) {
          add({ kind: "dangling_rejection_replacement", rejectionId: rec.rejectionId, claimId: rec.replacementClaimId });
          danglingCount += 1;
        }
      }
      batch.push(rec);
      if (batch.length >= BACKUP_POLICY.stagingCopyPageSize) await flush();
      if (onProgress && n % 5e3 === 0) onProgress({ phase: "staging", field, count: n });
    }
    await flush();
    perStore[field] = acc.finish();
    counts[field] = n;
  }
  const rc = detectReplacementCycle(supersedes);
  if (rc) add({ kind: "replacement_cycle", cycle: rc });
  const dc = detectAdjacencyCycle(dependsEdges);
  if (dc) add({ kind: "relation_depends_on_cycle", cycle: dc });
  const checksumMismatches = [];
  const manifest = source.manifest;
  if (manifest?.perStore) {
    for (const field of BACKUP_FIELDS) {
      const exp = manifest.perStore[field];
      const got = perStore[field];
      if (exp) {
        if (exp.count !== got.count) checksumMismatches.push(`${field}: count ${got.count} != manifest ${exp.count}`);
        if (exp.digest !== got.digest) checksumMismatches.push(`${field}: digest mismatch`);
      } else if (got.count > 0) checksumMismatches.push(`${field}: ${got.count} records but no manifest entry`);
    }
    if (manifest.checksum && manifest.checksum !== manifestChecksum(perStore)) checksumMismatches.push("manifest.checksum mismatch");
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (typeof manifest.totalRecords === "number" && manifest.totalRecords !== total) checksumMismatches.push(`totalRecords ${total} != manifest ${manifest.totalRecords}`);
  } else {
    checksumMismatches.push("backup has no manifest");
  }
  const fatalProblems = danglingFatal ? problems : problems.filter((p) => !String(p.kind).startsWith("dangling_"));
  return {
    ok: fatalProblems.length === 0 && checksumMismatches.length === 0,
    problems,
    fatalProblems,
    perStore,
    counts,
    checksum: { ok: checksumMismatches.length === 0, mismatches: checksumMismatches },
    danglingCount
  };
}
__name(stageAndValidate, "stageAndValidate");
async function pageStagingField(sdb, field, keyPath, after) {
  return new Promise((resolve, reject) => {
    const tx = sdb.transaction([field], "readonly");
    const range = after == null ? null : IDBKeyRange.lowerBound(after, true);
    const r = tx.objectStore(field).getAll(range, BACKUP_POLICY.stagingCopyPageSize);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
__name(pageStagingField, "pageStagingField");
async function* iterateStagingField(sdb, field, keyPath) {
  let after = null;
  for (; ; ) {
    const page = await pageStagingField(sdb, field, keyPath, after);
    if (!page.length) return;
    for (const rec of page) yield rec;
    if (page.length < BACKUP_POLICY.stagingCopyPageSize) return;
    after = page[page.length - 1][keyPath];
  }
}
__name(iterateStagingField, "iterateStagingField");
async function copyStagingField(mainDb, sdb, field, storeName, keyPath, { fence, sourceInstallationId, renew }) {
  let after = null;
  let copied = 0;
  for (; ; ) {
    const page = await new Promise((resolve, reject) => {
      const tx = sdb.transaction([field], "readonly");
      const range = after == null ? null : IDBKeyRange.lowerBound(after, true);
      const r = tx.objectStore(field).getAll(range, BACKUP_POLICY.stagingCopyPageSize);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!page.length) break;
    await runSemanticMutation(mainDb, [storeName], async ({ tx }) => {
      const os = tx.objectStore(storeName);
      for (const rec of page) {
        const out = { ...rec };
        if (field === "evidence" && out.originInstallationId == null) out.originInstallationId = sourceInstallationId ?? null;
        await requestOf6(os.put(out));
        copied += 1;
      }
    }, { fence, bumpRevision: false });
    await renew();
    after = page[page.length - 1][keyPath];
    if (page.length < BACKUP_POLICY.stagingCopyPageSize) break;
  }
  return copied;
}
__name(copyStagingField, "copyStagingField");
async function setImportMarker(db, fence, key, marker) {
  await runSemanticMutation(db, [], async ({ patchMeta }) => {
    patchMeta({ [key]: marker });
  }, { fence, bumpRevision: false });
}
__name(setImportMarker, "setImportMarker");
async function applyRestoredMeta(db, fence, source, phaseMarker) {
  await runSemanticMutation(db, [], async ({ patchMeta, meta }) => {
    const incoming = source.meta ?? {};
    const patch = {};
    for (const k of BACKUP_META_WHITELIST) {
      if (k === "sourceInstallationId" || k === "capturedUserDictionaryRevision") continue;
      if (incoming[k] !== void 0) patch[k] = incoming[k];
    }
    patch.installationId = meta.installationId;
    patch.maintenanceLock = meta.maintenanceLock;
    patch[RESTORE_MARKER_META_KEY] = phaseMarker;
    patchMeta(patch);
  }, { fence, bumpRevision: false });
}
__name(applyRestoredMeta, "applyRestoredMeta");
async function postCopyDefense(db, sdb, { manifest, sessionId, markerKey, fence, requiredDone }) {
  const problems = [];
  const ss = await readStagingSession(sdb).catch(() => null);
  if (!ss || ss.sessionId !== sessionId) problems.push(`staging session mismatch (got ${ss?.sessionId ?? "none"})`);
  const meta = await getMeta(db);
  const m = meta[markerKey] ?? null;
  if (!m || m.sessionId !== sessionId) problems.push(`main marker session mismatch (got ${m?.sessionId ?? "none"})`);
  if (m && m.state !== "running") problems.push(`main marker state is ${m.state}, expected running`);
  const done = new Set(m?.checkpoint?.done ?? []);
  for (const f of requiredDone) if (!done.has(f)) problems.push(`checkpoint missing store: ${f}`);
  try {
    assertFenceMeta(meta, fence);
  } catch (e) {
    problems.push(`maintenance fence invalid: ${e.message}`);
  }
  if (manifest?.perStore) {
    for (const [storeName, field] of BACKUP_STORES) {
      const c = await runRead(db, [storeName], ({ store }) => new Promise((res, rej) => {
        const rq = store(storeName).count();
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      }));
      const exp = manifest.perStore[field]?.count ?? 0;
      if (c !== exp) problems.push(`${field}: main count ${c} != manifest ${exp}`);
    }
  } else problems.push("no verified manifest to check against");
  const dangling = await countDanglingReferences(db);
  if (dangling.total !== 0) problems.push(`dangling references: ${dangling.total}`);
  return { ok: problems.length === 0, problems, dangling };
}
__name(postCopyDefense, "postCopyDefense");
function assertFenceMeta(meta, fence) {
  const lock = meta?.maintenanceLock;
  const owner = fence.owner;
  if (!lock || owner !== void 0 && lock.owner !== owner || lock.leaseEpoch !== fence.leaseEpoch || !(lock.expiresAt > Date.now())) {
    throw new Error("fence owner/epoch/expiry mismatch");
  }
}
__name(assertFenceMeta, "assertFenceMeta");
async function inspectRestoreState(db) {
  const meta = await getMeta(db);
  const marker = meta[RESTORE_MARKER_META_KEY] ?? null;
  const ms = dictionaryMaintenanceState(meta, { now: Date.now() });
  const phase = marker?.phase ?? null;
  const st = marker?.state ?? null;
  return {
    inProgress: Boolean(marker && st && st !== "completed" && st !== "abandoned"),
    operation: marker?.operation ?? (marker ? "restore" : null),
    phase,
    state: st,
    restoreSessionId: marker?.sessionId ?? marker?.restoreSessionId ?? null,
    sessionId: marker?.sessionId ?? marker?.restoreSessionId ?? null,
    stagingDbName: marker?.stagingDbName ?? null,
    backupId: marker?.backupId ?? null,
    startedAt: marker?.startedAt ?? null,
    checkpoint: marker?.checkpoint ?? null,
    leaseLive: ms.maintenanceActive,
    knowledgeReplacementInProgress: ms.knowledgeReplacementInProgress,
    // preparing/staged: まだ main を触っていない → 完全 rollback 可能
    canRollback: st === "preparing" && (phase === RESTORE_PHASE.staged || phase === RESTORE_PHASE.validating),
    // running: main は clear 済み → staging から resume-forward のみ
    canResume: st === "running" || st === "preparing" && phase === RESTORE_PHASE.staged
  };
}
__name(inspectRestoreState, "inspectRestoreState");
async function restoreFullBackup(db, sourceLike, {
  confirm,
  owner = void 0,
  env = {},
  leaseTtlMs = BACKUP_POLICY.restoreLeaseTtlMs,
  limits = BACKUP_SAFETY_LIMITS,
  strict = true,
  recoverStuck = null,
  faultInjector = null,
  onProgress = null,
  signal = null,
  now = Date.now()
} = {}) {
  checkConfirmation(confirm, RESTORE_CONFIRMATION, RestoreConfirmationError, "Full Restore (destructive replace)");
  const fault = /* @__PURE__ */ __name(async (p) => {
    if (faultInjector) await faultInjector(p);
  }, "fault");
  const source = await normalizeSource(sourceLike, { limits });
  assertBackupCompatible(source);
  await fault("parse");
  await guardNewImport(db, { env, kind: "restore", ErrorType: RestoreConflictError, recoverStuck });
  const sessionId = newOpaqueId("restore");
  const stagingDbName = stagingDbNameFor(sessionId);
  let sdb = null;
  let lease = null;
  let leaseRenewCount = 0;
  let mainTouched = false;
  let markedOwn = false;
  let fence = null;
  let renew = null;
  const done = [];
  const mkMarker = /* @__PURE__ */ __name((state, phase) => ({
    state,
    operation: "restore",
    sessionId,
    stagingDbName,
    phase,
    backupId: source.header.backupId,
    startedAt: now,
    checkpoint: { done: [...done] },
    finishedAt: state === "completed" ? Date.now() : null
  }), "mkMarker");
  const mark = /* @__PURE__ */ __name(async (state, phase) => {
    await setImportMarker(db, fence, RESTORE_MARKER_META_KEY, mkMarker(state, phase));
    markedOwn = true;
  }, "mark");
  try {
    sdb = await openStagingDb(env, sessionId);
    await writeStagingSession(sdb, {
      sessionId,
      operation: "restore",
      phase: RESTORE_PHASE.validating,
      header: source.header,
      manifest: source.manifest,
      meta: source.meta ?? {},
      startedAt: now
    });
    await fault("validation");
    const v = await stageAndValidate(sdb, source, { limits, onProgress, signal, renew: null });
    if (strict && !v.ok) {
      try {
        sdb.close();
      } catch {
      }
      await deleteStagingDb(env, sessionId);
      sdb = null;
      throw new RestoreValidationError(
        "backup validation failed before any destructive change (old dictionary is untouched)",
        {
          problems: v.problems.slice(0, 50),
          problemCount: v.problems.length,
          checksum: v.checksum,
          danglingCount: v.danglingCount
        }
      );
    }
    lease = await acquireMaintenanceLease(db, {
      type: "full_restore",
      ttlMs: leaseTtlMs,
      ...owner ? { owner } : {},
      now: Date.now()
    });
    fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
    renew = /* @__PURE__ */ __name(async () => {
      lease = await renewMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch, ttlMs: leaseTtlMs });
      leaseRenewCount += 1;
    }, "renew");
    await guardNewImport(db, { env, kind: "restore", ErrorType: RestoreConflictError, recoverStuck });
    await writeStagingSession(sdb, { ...await readStagingSession(sdb), phase: RESTORE_PHASE.staged });
    await mark("preparing", RESTORE_PHASE.staged);
    await fault("preClear");
    await mark("running", RESTORE_PHASE.replacing);
    await fault("preMainClear");
    mainTouched = true;
    await runSemanticMutation(db, [...SEMANTIC_RESTORE_STORES, STORE.cache], async ({ tx }) => {
      for (const s of SEMANTIC_RESTORE_STORES) await requestOf6(tx.objectStore(s).clear());
      await requestOf6(tx.objectStore(STORE.cache).clear());
    }, { fence, bumpRevision: false });
    await fault("postMainClear");
    const restored = {};
    for (const [storeName, field, keyPath] of BACKUP_STORES) {
      await fault(`loading:${field}`);
      restored[field] = await copyStagingField(db, sdb, field, storeName, keyPath, {
        fence,
        sourceInstallationId: source.header.sourceInstallationId,
        renew
      });
      done.push(field);
      await mark("running", RESTORE_PHASE.replacing);
    }
    await fault("preFinalIntegrity");
    await mark("running", RESTORE_PHASE.finalizing);
    const defense = await postCopyDefense(db, sdb, {
      manifest: source.manifest,
      sessionId,
      markerKey: RESTORE_MARKER_META_KEY,
      fence,
      requiredDone: BACKUP_FIELDS
    });
    if (!defense.ok) {
      throw new RestoreValidationError("post-copy defense verification failed; restore NOT activated (read gate stays)", {
        problems: defense.problems
      });
    }
    await applyRestoredMeta(db, fence, source, mkMarker("running", RESTORE_PHASE.finalizing));
    await fault("preActivation");
    const activation = await runSemanticMutation(db, [STORE.cache], async ({ tx, patchMeta }) => {
      await requestOf6(tx.objectStore(STORE.cache).clear());
      patchMeta({ [RESTORE_MARKER_META_KEY]: mkMarker("completed", RESTORE_PHASE.completed) });
    }, { fence, bumpRevision: true });
    try {
      sdb.close();
    } catch {
    }
    await deleteStagingDb(env, sessionId);
    sdb = null;
    const finalMeta = await getMeta(db);
    return {
      restored,
      installationId: finalMeta.installationId,
      userDictionaryRevision: activation.userDictionaryRevision,
      restoreSessionId: sessionId,
      sessionId,
      stagingDbName,
      leaseEpoch: lease.leaseEpoch,
      leaseRenewCount,
      referenceProblems: v.problems,
      broadcast: { type: "bulkDictionaryChanged", scope: "all", revision: activation.userDictionaryRevision }
    };
  } catch (e) {
    if (!markedOwn && !mainTouched) {
      try {
        if (sdb) sdb.close();
      } catch {
      }
      try {
        await deleteStagingDb(env, sessionId);
      } catch {
      }
      sdb = null;
    }
    throw e;
  } finally {
    if (lease) {
      try {
        await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
      } catch {
      }
    }
    if (sdb) {
      try {
        sdb.close();
      } catch {
      }
    }
  }
}
__name(restoreFullBackup, "restoreFullBackup");
async function resumeRestore(db, { owner = void 0, env = {}, faultInjector = null } = {}) {
  const fault = /* @__PURE__ */ __name(async (p) => {
    if (faultInjector) await faultInjector(p);
  }, "fault");
  const meta0 = await getMeta(db);
  const marker = meta0[RESTORE_MARKER_META_KEY] ?? null;
  if (!marker || marker.state === "completed" || marker.state === "abandoned") return { resumed: false, reason: "nothing_to_resume" };
  const sessionId = marker.sessionId ?? marker.restoreSessionId;
  if (!sessionId) return { resumed: false, reason: "marker_has_no_session" };
  let sdb;
  try {
    sdb = await openStagingDb(env, sessionId);
  } catch {
    return { resumed: false, reason: "staging_unavailable" };
  }
  const session = await readStagingSession(sdb);
  if (!session || session.sessionId !== sessionId || session.operation !== "restore") {
    try {
      sdb.close();
    } catch {
    }
    return { resumed: false, reason: "staging_lost", markerPhase: marker.phase };
  }
  const source = { header: session.header, meta: session.meta ?? {}, manifest: session.manifest };
  let lease = await acquireMaintenanceLease(db, {
    type: "full_restore",
    ttlMs: BACKUP_POLICY.restoreLeaseTtlMs,
    ...owner ? { owner } : {},
    steal: true,
    now: Date.now()
  });
  const fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
  let leaseRenewCount = 0;
  const renew = /* @__PURE__ */ __name(async () => {
    lease = await renewMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch, ttlMs: BACKUP_POLICY.restoreLeaseTtlMs });
    leaseRenewCount += 1;
  }, "renew");
  const done = [...marker.checkpoint?.done ?? []];
  const doneSet = new Set(done);
  const mkMarker = /* @__PURE__ */ __name((state, phase) => ({
    state,
    operation: "restore",
    sessionId,
    stagingDbName: marker.stagingDbName ?? stagingDbNameFor(sessionId),
    phase,
    backupId: marker.backupId,
    startedAt: marker.startedAt,
    checkpoint: { done: [...done] },
    finishedAt: state === "completed" ? Date.now() : null
  }), "mkMarker");
  const mark = /* @__PURE__ */ __name((state, phase) => setImportMarker(db, fence, RESTORE_MARKER_META_KEY, mkMarker(state, phase)), "mark");
  try {
    if (marker.state === "preparing" && marker.phase === RESTORE_PHASE.staged) {
      await mark("running", RESTORE_PHASE.replacing);
      await runSemanticMutation(db, [...SEMANTIC_RESTORE_STORES, STORE.cache], async ({ tx }) => {
        for (const s of SEMANTIC_RESTORE_STORES) await requestOf6(tx.objectStore(s).clear());
        await requestOf6(tx.objectStore(STORE.cache).clear());
      }, { fence, bumpRevision: false });
      doneSet.clear();
      done.length = 0;
    }
    await mark("running", RESTORE_PHASE.replacing);
    await fault("resume:replacing");
    const restored = {};
    for (const [storeName, field, keyPath] of BACKUP_STORES) {
      if (doneSet.has(field)) continue;
      await runSemanticMutation(db, [storeName], async ({ tx }) => {
        await requestOf6(tx.objectStore(storeName).clear());
      }, { fence, bumpRevision: false });
      restored[field] = await copyStagingField(db, sdb, field, storeName, keyPath, {
        fence,
        sourceInstallationId: source.header?.sourceInstallationId,
        renew
      });
      doneSet.add(field);
      done.push(field);
      await mark("running", RESTORE_PHASE.replacing);
    }
    await mark("running", RESTORE_PHASE.finalizing);
    const defense = await postCopyDefense(db, sdb, {
      manifest: source.manifest,
      sessionId,
      markerKey: RESTORE_MARKER_META_KEY,
      fence,
      requiredDone: BACKUP_FIELDS
    });
    if (!defense.ok) throw new RestoreValidationError("resume: post-copy defense failed; NOT activated", { problems: defense.problems });
    await applyRestoredMeta(db, fence, source, mkMarker("running", RESTORE_PHASE.finalizing));
    const activation = await runSemanticMutation(db, [STORE.cache], async ({ tx, patchMeta }) => {
      await requestOf6(tx.objectStore(STORE.cache).clear());
      patchMeta({ [RESTORE_MARKER_META_KEY]: mkMarker("completed", RESTORE_PHASE.completed) });
    }, { fence, bumpRevision: true });
    try {
      sdb.close();
    } catch {
    }
    await deleteStagingDb(env, sessionId);
    return { resumed: true, restoreSessionId: sessionId, sessionId, leaseRenewCount, userDictionaryRevision: activation.userDictionaryRevision, broadcast: { type: "bulkDictionaryChanged", scope: "all", revision: activation.userDictionaryRevision } };
  } finally {
    try {
      await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
    } catch {
    }
    try {
      sdb.close();
    } catch {
    }
  }
}
__name(resumeRestore, "resumeRestore");
async function rollbackRestore(db, { env = {} } = {}) {
  const meta = await getMeta(db);
  const marker = meta[RESTORE_MARKER_META_KEY] ?? null;
  if (!marker || marker.state === "completed" || marker.state === "abandoned") return { rolledBack: false, reason: "nothing_to_rollback" };
  if (marker.state === "running") return { rolledBack: false, reason: "already_replacing_use_resume", markerPhase: marker.phase };
  const sessionId = marker.sessionId ?? marker.restoreSessionId;
  await deleteStagingDb(env, sessionId);
  await runSemanticMutation(db, [], async ({ patchMeta }) => {
    patchMeta({ [RESTORE_MARKER_META_KEY]: null });
  }, { bumpRevision: false });
  return { rolledBack: true };
}
__name(rollbackRestore, "rollbackRestore");
var RESTORE_RECOVERY_HISTORY_META_KEY = "maintenanceRestoreHistory";
var RECOVERY_HISTORY_MAX = 10;
var STAGING_PROBE = Object.freeze({
  present: "present",
  // DB があり、必要 store があり、_session が marker と一致
  missing: "missing",
  // DB そのものが存在しない
  mismatch: "mismatch",
  // DB はあるが session/store が marker と一致しない
  unavailable: "unavailable"
  // blocked / open error 等で判定不能（破壊的判断をしない）
});
function probeStagingDb(env, name, { sessionId, operation }) {
  const factory = env?.indexedDB ?? globalThis.indexedDB;
  if (!factory) return Promise.resolve({ status: STAGING_PROBE.unavailable, reason: "no_indexeddb" });
  if (!name) return Promise.resolve({ status: STAGING_PROBE.missing, reason: "no_staging_db_name" });
  return new Promise((resolve) => {
    let sawCreate = false;
    let settled = false;
    const done = /* @__PURE__ */ __name((v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    }, "done");
    let rq;
    try {
      rq = factory.open(name);
    } catch (e) {
      done({ status: STAGING_PROBE.unavailable, reason: "open_threw", detail: { error: String(e?.message ?? e) } });
      return;
    }
    rq.onupgradeneeded = (ev) => {
      if ((ev?.oldVersion ?? 0) === 0) {
        sawCreate = true;
        try {
          rq.transaction.abort();
        } catch {
        }
      }
    };
    rq.onblocked = () => done({ status: STAGING_PROBE.unavailable, reason: "blocked" });
    rq.onerror = () => {
      const err = rq.error?.name ?? null;
      if (sawCreate) done({ status: STAGING_PROBE.missing, reason: "not_created" });
      else done({ status: STAGING_PROBE.unavailable, reason: "open_error", detail: { error: err } });
    };
    rq.onsuccess = async () => {
      const sdb = rq.result;
      if (sawCreate) {
        let removed = false;
        try {
          sdb.close();
        } catch {
        }
        try {
          removed = await new Promise((res) => {
            const dr = factory.deleteDatabase(name);
            dr.onsuccess = () => res(true);
            dr.onerror = () => res(false);
            dr.onblocked = () => res(false);
          });
        } catch {
          removed = false;
        }
        done({ status: STAGING_PROBE.missing, reason: "probe_created_shell", createdShell: !removed });
        return;
      }
      try {
        const names = sdb.objectStoreNames;
        const missingStore = [STAGING_SESSION_STORE, ...BACKUP_FIELDS].find((s2) => !names.contains(s2));
        if (missingStore) {
          try {
            sdb.close();
          } catch {
          }
          done({ status: STAGING_PROBE.mismatch, reason: "missing_store", detail: { store: missingStore } });
          return;
        }
        const s = await readStagingSession(sdb);
        try {
          sdb.close();
        } catch {
        }
        if (!s) {
          done({ status: STAGING_PROBE.mismatch, reason: "no_session_record" });
          return;
        }
        if (s.sessionId !== sessionId) {
          done({ status: STAGING_PROBE.mismatch, reason: "session_id_mismatch", detail: { found: s.sessionId ?? null } });
          return;
        }
        if (s.operation !== operation) {
          done({ status: STAGING_PROBE.mismatch, reason: "operation_mismatch", detail: { found: s.operation ?? null } });
          return;
        }
        done({ status: STAGING_PROBE.present });
      } catch (e) {
        try {
          sdb.close();
        } catch {
        }
        done({ status: STAGING_PROBE.unavailable, reason: "session_read_error", detail: { error: String(e?.message ?? e) } });
      }
    };
  });
}
__name(probeStagingDb, "probeStagingDb");
async function probeStuckImport(db, { env = {} } = {}) {
  const meta = await getMeta(db);
  const factory = env?.indexedDB ?? globalThis.indexedDB;
  const out = { restore: null, merge: null };
  for (const [kind, key] of [["restore", RESTORE_MARKER_META_KEY], ["merge", MERGE_MARKER_META_KEY]]) {
    const marker = meta[key] ?? null;
    if (!marker || marker.state !== "running") continue;
    const sessionId = marker.sessionId ?? marker.restoreSessionId ?? marker.mergeSessionId ?? null;
    const name = marker.stagingDbName ?? (sessionId ? stagingDbNameFor(sessionId) : null);
    let probe = null;
    if (name && typeof factory?.databases === "function") {
      try {
        const all = await factory.databases();
        if (!all.some((d) => d && d.name === name)) probe = { status: STAGING_PROBE.missing, reason: "not_listed" };
      } catch {
      }
    }
    if (!probe) probe = await probeStagingDb(env, name, { sessionId, operation: kind });
    const unavailable = probe.status === STAGING_PROBE.unavailable;
    const present = probe.status === STAGING_PROBE.present;
    const stagingLost = probe.status === STAGING_PROBE.missing || probe.status === STAGING_PROBE.mismatch;
    out[kind] = {
      operation: kind,
      sessionId,
      stagingDbName: name,
      phase: marker.phase ?? null,
      probeStatus: probe.status,
      probeReason: probe.reason ?? null,
      ...probe.createdShell ? { probeCreatedShell: true } : {},
      stagingPresent: present,
      stagingLost,
      // 判定不能のときは Resume も Recover も出さない（誤誘導しない）。再試行を案内する。
      probeUnavailable: unavailable,
      canResume: present,
      // staging を失った running import は restore / merge どちらも、新しい Full Backup からの
      // 復旧（continuous-gate handoff で restore へ移行）だけが安全な出口になる。
      canRecoverFromBackup: stagingLost
    };
  }
  return out;
}
__name(probeStuckImport, "probeStuckImport");
async function recoverStuckRestoreFromBackup(db, sourceLike, {
  confirm,
  recoverStuck = null,
  owner = void 0,
  env = {},
  leaseTtlMs = BACKUP_POLICY.restoreLeaseTtlMs,
  limits = BACKUP_SAFETY_LIMITS,
  faultInjector = null,
  onProgress = null,
  signal = null,
  now = Date.now()
} = {}) {
  const fault = /* @__PURE__ */ __name(async (p) => {
    if (faultInjector) await faultInjector(p);
  }, "fault");
  checkConfirmation(
    confirm,
    RESTORE_CONFIRMATION,
    RestoreConfirmationError,
    "Stuck Restore recovery from a new backup (destructive replace)"
  );
  const ack = typeof recoverStuck === "string" ? recoverStuck : recoverStuck?.acknowledge;
  const wantSession = typeof recoverStuck === "object" && recoverStuck ? recoverStuck.sessionId ?? null : null;
  if (ack !== ABANDON_STUCK_CONFIRMATION || !wantSession) {
    throw new RestoreConflictError(
      `stuck-import recovery requires recoverStuck: {acknowledge:${JSON.stringify(ABANDON_STUCK_CONFIRMATION)}, sessionId:"<stuck session id>"}`,
      { got: ack ?? null, sessionId: wantSession }
    );
  }
  const meta0 = await getMeta(db);
  const oldRestore = meta0[RESTORE_MARKER_META_KEY] ?? null;
  const oldMerge = meta0[MERGE_MARKER_META_KEY] ?? null;
  const oldKind = oldRestore?.state === "running" ? "restore" : oldMerge?.state === "running" ? "merge" : null;
  if (!oldKind) {
    throw new RestoreConflictError(
      "there is no stuck import to recover (no running restore/merge marker); use restoreFullBackup instead",
      { restoreState: oldRestore?.state ?? null, mergeState: oldMerge?.state ?? null }
    );
  }
  const oldMarkerKey = oldKind === "merge" ? MERGE_MARKER_META_KEY : RESTORE_MARKER_META_KEY;
  const oldMarker = oldKind === "merge" ? oldMerge : oldRestore;
  const oldSessionId = oldMarker.sessionId ?? oldMarker.restoreSessionId ?? oldMarker.mergeSessionId ?? null;
  if (oldSessionId !== wantSession) {
    throw new RestoreConflictError(
      `recoverStuck.sessionId does not match the running ${oldKind} marker; nothing was changed`,
      { expected: oldSessionId, got: wantSession, operation: oldKind }
    );
  }
  const oldStartedAt = oldMarker.startedAt ?? null;
  const source = await normalizeSource(sourceLike, { limits });
  assertBackupCompatible(source);
  await fault("recover:parse");
  const sessionId = newOpaqueId("recover");
  const stagingDbName = stagingDbNameFor(sessionId);
  let sdb = null;
  let lease = null;
  let leaseRenewCount = 0;
  let handedOff = false;
  let fence = null;
  let renew = null;
  const done = [];
  const mkMarker = /* @__PURE__ */ __name((state, phase) => ({
    state,
    operation: "restore",
    sessionId,
    stagingDbName,
    phase,
    backupId: source.header.backupId,
    startedAt: now,
    checkpoint: { done: [...done] },
    recoveredFromSessionId: oldSessionId,
    finishedAt: state === "completed" ? Date.now() : null
  }), "mkMarker");
  const mark = /* @__PURE__ */ __name((state, phase) => setImportMarker(db, fence, RESTORE_MARKER_META_KEY, mkMarker(state, phase)), "mark");
  try {
    sdb = await openStagingDb(env, sessionId);
    await writeStagingSession(sdb, {
      sessionId,
      operation: "restore",
      phase: RESTORE_PHASE.validating,
      header: source.header,
      manifest: source.manifest,
      meta: source.meta ?? {},
      startedAt: now,
      recoveredFromSessionId: oldSessionId
    });
    await fault("recover:validation");
    const v = await stageAndValidate(sdb, source, { limits, onProgress, signal, renew: null });
    if (!v.ok) {
      throw new RestoreValidationError(
        "recovery backup validation failed; the stuck restore marker and the read gate are unchanged",
        {
          problems: v.problems.slice(0, 50),
          problemCount: v.problems.length,
          checksum: v.checksum,
          danglingCount: v.danglingCount
        }
      );
    }
    await writeStagingSession(sdb, { ...await readStagingSession(sdb), phase: RESTORE_PHASE.staged });
    await fault("recover:preLease");
    lease = await acquireMaintenanceLease(db, {
      type: "full_restore",
      ttlMs: leaseTtlMs,
      ...owner ? { owner } : {},
      now: Date.now()
    });
    fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
    renew = /* @__PURE__ */ __name(async () => {
      lease = await renewMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch, ttlMs: leaseTtlMs });
      leaseRenewCount += 1;
    }, "renew");
    const sameOldMarker = /* @__PURE__ */ __name((m) => Boolean(
      m && m.state === "running" && (m.sessionId ?? m.restoreSessionId ?? m.mergeSessionId ?? null) === oldSessionId && (m.startedAt ?? null) === oldStartedAt
    ), "sameOldMarker");
    const metaUnderLease = await getMeta(db);
    const cur = metaUnderLease[oldMarkerKey] ?? null;
    if (!sameOldMarker(cur)) {
      throw new RestoreConflictError(
        `the stuck ${oldKind} marker changed while the recovery backup was being staged; recovery aborted`,
        {
          expected: { sessionId: oldSessionId, startedAt: oldStartedAt, operation: oldKind },
          found: { sessionId: cur?.sessionId ?? null, state: cur?.state ?? null, startedAt: cur?.startedAt ?? null }
        }
      );
    }
    await fault("recover:preHandoff");
    await runSemanticMutation(db, [], async ({ meta, patchMeta }) => {
      const inTx = meta[oldMarkerKey] ?? null;
      if (!sameOldMarker(inTx)) {
        throw new RestoreConflictError("marker handoff aborted: the stuck marker changed inside the transaction", {
          found: { sessionId: inTx?.sessionId ?? null, state: inTx?.state ?? null },
          operation: oldKind
        });
      }
      await fault("recover:handoffTx");
      const history = Array.isArray(meta[RESTORE_RECOVERY_HISTORY_META_KEY]) ? meta[RESTORE_RECOVERY_HISTORY_META_KEY] : [];
      patchMeta({
        // 旧 operation の marker を退避（merge からの復旧ならここで merge marker が落ちるが、
        // 同じ patch で restore marker が running になるので gate は途切れない）
        [oldMarkerKey]: null,
        // current marker: running(old) → running(new)。中間状態なし。
        [RESTORE_MARKER_META_KEY]: mkMarker("running", RESTORE_PHASE.replacing),
        // 旧 session の abandon 記録は read-gate を見ない audit key へ
        [RESTORE_RECOVERY_HISTORY_META_KEY]: [...history, {
          sessionId: oldSessionId,
          operation: oldKind,
          phase: oldMarker.phase ?? null,
          stagingDbName: oldMarker.stagingDbName ?? null,
          startedAt: oldStartedAt,
          abandonedAt: Date.now(),
          supersededBySessionId: sessionId,
          supersededByOperation: "restore",
          reason: "recovered_from_backup"
        }].slice(-RECOVERY_HISTORY_MAX)
      });
    }, { fence, bumpRevision: false });
    handedOff = true;
    await fault("recover:postHandoff");
    if (oldSessionId && oldSessionId !== sessionId) await deleteStagingDb(env, oldSessionId);
    await fault("recover:preMainClear");
    await runSemanticMutation(db, [...SEMANTIC_RESTORE_STORES, STORE.cache], async ({ tx }) => {
      for (const s of SEMANTIC_RESTORE_STORES) await requestOf6(tx.objectStore(s).clear());
      await requestOf6(tx.objectStore(STORE.cache).clear());
    }, { fence, bumpRevision: false });
    await fault("recover:postMainClear");
    const restored = {};
    for (const [storeName, field, keyPath] of BACKUP_STORES) {
      await fault(`recover:loading:${field}`);
      restored[field] = await copyStagingField(db, sdb, field, storeName, keyPath, {
        fence,
        sourceInstallationId: source.header.sourceInstallationId,
        renew
      });
      done.push(field);
      await mark("running", RESTORE_PHASE.replacing);
    }
    await fault("recover:preFinalIntegrity");
    await mark("running", RESTORE_PHASE.finalizing);
    const defense = await postCopyDefense(db, sdb, {
      manifest: source.manifest,
      sessionId,
      markerKey: RESTORE_MARKER_META_KEY,
      fence,
      requiredDone: BACKUP_FIELDS
    });
    if (!defense.ok) {
      throw new RestoreValidationError("recovery post-copy defense failed; NOT activated (read gate stays)", {
        problems: defense.problems
      });
    }
    await applyRestoredMeta(db, fence, source, mkMarker("running", RESTORE_PHASE.finalizing));
    await fault("recover:preActivation");
    const activation = await runSemanticMutation(db, [STORE.cache], async ({ tx, patchMeta }) => {
      await requestOf6(tx.objectStore(STORE.cache).clear());
      patchMeta({ [RESTORE_MARKER_META_KEY]: mkMarker("completed", RESTORE_PHASE.completed) });
    }, { fence, bumpRevision: true });
    try {
      sdb.close();
    } catch {
    }
    await deleteStagingDb(env, sessionId);
    sdb = null;
    const finalMeta = await getMeta(db);
    return {
      recovered: true,
      restored,
      installationId: finalMeta.installationId,
      userDictionaryRevision: activation.userDictionaryRevision,
      recoveredFromSessionId: oldSessionId,
      restoreSessionId: sessionId,
      sessionId,
      stagingDbName,
      leaseEpoch: lease.leaseEpoch,
      leaseRenewCount,
      referenceProblems: v.problems,
      // (17) 成功時にだけ Broadcast する
      broadcast: { type: "bulkDictionaryChanged", scope: "all", revision: activation.userDictionaryRevision }
    };
  } catch (e) {
    if (!handedOff) {
      try {
        if (sdb) sdb.close();
      } catch {
      }
      try {
        await deleteStagingDb(env, sessionId);
      } catch {
      }
      sdb = null;
    }
    throw e;
  } finally {
    if (lease) {
      try {
        await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
      } catch {
      }
    }
    if (sdb) {
      try {
        sdb.close();
      } catch {
      }
    }
  }
}
__name(recoverStuckRestoreFromBackup, "recoverStuckRestoreFromBackup");
function symmetricRelation(relation) {
  return RELATION_TYPE_POLICIES[relation]?.directed === false;
}
__name(symmetricRelation, "symmetricRelation");
var MERGE_PHASE = Object.freeze({
  validating: "validating",
  staged: "staged",
  merging: "merging",
  finalizing: "finalizing",
  completed: "completed"
});
var MERGE_STORE_ORDER = Object.freeze([
  ["entities", STORE.entities],
  ["claims", STORE.claims],
  ["evidence", STORE.evidence],
  ["relations", STORE.relations],
  ["history", STORE.history],
  ["rejections", STORE.rejections],
  ["packages", STORE.packages]
]);
var MERGE_KEYPATH = Object.freeze({
  entities: "entityKey",
  claims: "claimId",
  evidence: "evidenceId",
  relations: "relationId",
  history: "historyId",
  rejections: "rejectionId",
  packages: "packageKey"
});
async function applyMergeStore(db, sdb, field, { fence, nodeRemap, added, deduped, counters, mergeSessionId, renew }) {
  const keyPath = MERGE_KEYPATH[field];
  const remap = /* @__PURE__ */ __name((id) => id != null && nodeRemap.has(id) ? nodeRemap.get(id) : id, "remap");
  let batch = [];
  const flush = /* @__PURE__ */ __name(async () => {
    if (!batch.length) return;
    let items = batch;
    batch = [];
    if (field === "relations") {
      const prepared = [];
      for (const inc of items) {
        const from = remap(inc.fromNodeId);
        const to = remap(inc.toNodeId);
        let ek = inc.edgeKey;
        if (from !== inc.fromNodeId || to !== inc.toNodeId || !ek) {
          if (symmetricRelation(inc.relation)) {
            const [a, b] = from <= to ? [from, to] : [to, from];
            ek = await edgeKey({ relation: inc.relation, fromNodeId: a, toNodeId: b });
          } else {
            ek = await edgeKey({ relation: inc.relation, fromNodeId: from, toNodeId: to });
          }
        }
        prepared.push({ ...inc, fromNodeId: from, toNodeId: to, edgeKey: ek });
      }
      items = prepared;
    }
    const storeName = STORE[field === "entities" ? "entities" : field];
    await runSemanticMutation(db, [storeName], async ({ tx }) => {
      const os = tx.objectStore(storeName);
      for (const inc of items) {
        if (field === "entities") {
          const ex = await requestOf6(os.get(inc.entityKey));
          if (ex) {
            deduped.entities += 1;
            if (inc.nodeId && ex.nodeId && inc.nodeId !== ex.nodeId) {
              nodeRemap.set(inc.nodeId, ex.nodeId);
              counters.remapped += 1;
            }
          } else {
            await requestOf6(os.add(inc));
            added.entities += 1;
          }
        } else if (field === "claims") {
          const ex = inc.semanticKey ? await requestOf6(os.index("semanticKey").get(inc.semanticKey)) : null;
          if (ex) {
            deduped.claims += 1;
            if (ex.claimId !== inc.claimId) {
              nodeRemap.set(inc.claimId, ex.claimId);
              counters.remapped += 1;
            }
          } else {
            await requestOf6(os.add({ ...inc, quarantined: true, stagingSessionId: mergeSessionId }));
            added.claims += 1;
          }
        } else if (field === "evidence") {
          const rec = { ...inc, claimId: remap(inc.claimId) };
          if (Array.isArray(rec.seededByClaimIds)) rec.seededByClaimIds = rec.seededByClaimIds.map(remap);
          if (Array.isArray(rec.conditioningClaimIds)) rec.conditioningClaimIds = rec.conditioningClaimIds.map(remap);
          const ex = rec.dedupeKey ? await requestOf6(os.index("dedupeKey").get(rec.dedupeKey)) : null;
          if (ex) deduped.evidence += 1;
          else {
            await requestOf6(os.add(rec));
            added.evidence += 1;
          }
        } else if (field === "relations") {
          const ex = inc.edgeKey ? await requestOf6(os.index("edgeKey").get(inc.edgeKey)) : null;
          if (ex) deduped.relations += 1;
          else {
            await requestOf6(os.add(inc));
            added.relations += 1;
          }
        } else if (field === "history") {
          const ex = await requestOf6(os.get(inc.historyId));
          if (ex) deduped.history += 1;
          else {
            await requestOf6(os.add({ ...inc, nodeId: remap(inc.nodeId) }));
            added.history += 1;
          }
        } else if (field === "rejections") {
          const rec = { ...inc, replacementClaimId: remap(inc.replacementClaimId) };
          const ex = rec.rejectionKey ? await requestOf6(os.index("rejectionKey").get(rec.rejectionKey)) : null;
          if (ex) deduped.rejections += 1;
          else {
            await requestOf6(os.add(rec));
            added.rejections += 1;
          }
        } else if (field === "packages") {
          const ex = inc.packageId ? await requestOf6(os.index("packageId").get(inc.packageId)) : null;
          if (ex) deduped.packages += 1;
          else {
            await requestOf6(os.add(inc));
            added.packages += 1;
          }
        }
      }
    }, { fence, bumpRevision: false });
    await renew();
  }, "flush");
  for await (const rec of iterateStagingField(sdb, field, keyPath)) {
    batch.push(rec);
    if (batch.length >= BACKUP_POLICY.mergeChunkSize) await flush();
  }
  await flush();
}
__name(applyMergeStore, "applyMergeStore");
async function clearMergeQuarantine(db, fence, mergeSessionId) {
  let after = null;
  for (; ; ) {
    const page = await runRead(db, [STORE.claims], ({ store }) => new Promise((res, rej) => {
      const range = after == null ? IDBKeyRange.only(mergeSessionId) : IDBKeyRange.only(mergeSessionId);
      const idx = store(STORE.claims).index("stagingSessionId");
      const r = idx.getAll(range, BACKUP_POLICY.stagingCopyPageSize);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const pending = page.filter((c) => c.stagingSessionId === mergeSessionId);
    if (!pending.length) break;
    await runSemanticMutation(db, [STORE.claims], async ({ tx }) => {
      const os = tx.objectStore(STORE.claims);
      for (const c of pending) {
        await requestOf6(os.put({ ...c, quarantined: false, stagingSessionId: null }));
      }
    }, { fence, bumpRevision: false });
    if (pending.length < BACKUP_POLICY.stagingCopyPageSize) break;
  }
}
__name(clearMergeQuarantine, "clearMergeQuarantine");
async function postMergeDefense(db, sdb, { manifest, sessionId, fence, requiredDone, added, deduped }) {
  const problems = [];
  const ss = await readStagingSession(sdb).catch(() => null);
  if (!ss || ss.sessionId !== sessionId) problems.push(`staging session mismatch (got ${ss?.sessionId ?? "none"})`);
  const meta = await getMeta(db);
  const m = meta[MERGE_MARKER_META_KEY] ?? null;
  if (!m || m.sessionId !== sessionId) problems.push(`merge marker session mismatch (got ${m?.sessionId ?? "none"})`);
  if (m && m.state !== "running") problems.push(`merge marker state is ${m.state}, expected running`);
  const done = new Set(m?.checkpoint?.done ?? []);
  for (const f of requiredDone) if (!done.has(f)) problems.push(`checkpoint missing store: ${f}`);
  try {
    assertFenceMeta(meta, fence);
  } catch (e) {
    problems.push(`maintenance fence invalid: ${e.message}`);
  }
  if (manifest?.perStore) {
    for (const [, field] of BACKUP_STORES) {
      const exp = manifest.perStore[field]?.count ?? 0;
      const got = (added[field] ?? 0) + (deduped[field] ?? 0);
      if (got < exp) problems.push(`${field}: processed ${got} < manifest ${exp}`);
    }
  }
  const dangling = await countDanglingReferences(db);
  if (dangling.total !== 0) problems.push(`dangling references: ${dangling.total}`);
  return { ok: problems.length === 0, problems, dangling };
}
__name(postMergeDefense, "postMergeDefense");
async function mergeBackup(db, sourceLike, {
  confirm,
  owner = void 0,
  env = {},
  leaseTtlMs = BACKUP_POLICY.mergeLeaseTtlMs,
  limits = BACKUP_SAFETY_LIMITS,
  dryRun = false,
  recoverStuck = null,
  faultInjector = null,
  onProgress = null,
  now = Date.now()
} = {}) {
  const fault = /* @__PURE__ */ __name(async (p) => {
    if (faultInjector) await faultInjector(p);
  }, "fault");
  if (!dryRun) checkConfirmation(confirm, MERGE_CONFIRMATION, MergeError, "Merge into local dictionary");
  const source = await normalizeSource(sourceLike, { limits });
  assertBackupCompatible(source);
  if (dryRun) {
    const dsid = newOpaqueId("mergedry");
    const dsdb = await openStagingDb(env, dsid);
    try {
      await writeStagingSession(dsdb, { sessionId: dsid, operation: "merge", phase: MERGE_PHASE.validating, header: source.header, manifest: source.manifest, meta: source.meta ?? {}, startedAt: now });
      const v = await stageAndValidate(dsdb, source, { limits, onProgress, danglingFatal: false });
      return { dryRun: true, validation: v };
    } finally {
      try {
        dsdb.close();
      } catch {
      }
      await deleteStagingDb(env, dsid);
    }
  }
  const sessionId = newOpaqueId("merge");
  const stagingDbName = stagingDbNameFor(sessionId);
  let sdb = null;
  let lease = null;
  let leaseRenewCount = 0;
  let mainTouched = false;
  let markedOwn = false;
  let fence = null;
  let renew = null;
  const done = [];
  const added = { entities: 0, claims: 0, evidence: 0, relations: 0, history: 0, rejections: 0, packages: 0 };
  const deduped = { ...added };
  const mkMarker = /* @__PURE__ */ __name((state, phase) => ({
    state,
    operation: "merge",
    sessionId,
    stagingDbName,
    phase,
    startedAt: now,
    // checkpoint に累積 counts も永続化 → resumeMerge が per-store 完了検証を継続できる。
    checkpoint: { done: [...done], counts: { added: { ...added }, deduped: { ...deduped } } },
    finishedAt: state === "completed" ? Date.now() : null
  }), "mkMarker");
  const mark = /* @__PURE__ */ __name(async (state, phase) => {
    await setImportMarker(db, fence, MERGE_MARKER_META_KEY, mkMarker(state, phase));
    markedOwn = true;
  }, "mark");
  const counters = { remapped: 0 };
  const nodeRemap = /* @__PURE__ */ new Map();
  try {
    sdb = await openStagingDb(env, sessionId);
    await writeStagingSession(sdb, { sessionId, operation: "merge", phase: MERGE_PHASE.validating, header: source.header, manifest: source.manifest, meta: source.meta ?? {}, startedAt: now });
    await fault("validation");
    const v = await stageAndValidate(sdb, source, { limits, onProgress, danglingFatal: false, renew: null });
    const report = { validation: v, counts: v.counts };
    if (!v.ok) {
      try {
        sdb.close();
      } catch {
      }
      await deleteStagingDb(env, sessionId);
      sdb = null;
      throw new MergeError("merge source validation failed (no change to local dictionary)", {
        problems: v.fatalProblems.slice(0, 50),
        checksum: v.checksum
      });
    }
    lease = await acquireMaintenanceLease(db, { type: "import_merge", ttlMs: leaseTtlMs, ...owner ? { owner } : {}, now: Date.now() });
    fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
    renew = /* @__PURE__ */ __name(async () => {
      lease = await renewMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch, ttlMs: leaseTtlMs });
      leaseRenewCount += 1;
    }, "renew");
    await guardNewImport(db, { env, kind: "merge", ErrorType: MergeConflictError, recoverStuck });
    await writeStagingSession(sdb, { ...await readStagingSession(sdb), phase: MERGE_PHASE.staged });
    await mark("preparing", MERGE_PHASE.staged);
    await fault("preMerge");
    await mark("running", MERGE_PHASE.merging);
    for (const [field] of MERGE_STORE_ORDER) {
      await fault(`merging:${field}`);
      mainTouched = true;
      await applyMergeStore(db, sdb, field, { fence, nodeRemap, added, deduped, counters, mergeSessionId: sessionId, renew });
      done.push(field);
      await mark("running", MERGE_PHASE.merging);
    }
    await fault("preFinalIntegrity");
    await mark("running", MERGE_PHASE.finalizing);
    await clearMergeQuarantine(db, fence, sessionId);
    const defense = await postMergeDefense(db, sdb, {
      manifest: source.manifest,
      sessionId,
      fence,
      requiredDone: BACKUP_FIELDS,
      added,
      deduped
    });
    if (!defense.ok) throw new MergeError("post-merge defense verification failed; merge NOT activated (read gate stays)", { problems: defense.problems });
    await fault("preActivation");
    const activation = await runSemanticMutation(db, [STORE.cache], async ({ tx, patchMeta }) => {
      await requestOf6(tx.objectStore(STORE.cache).clear());
      patchMeta({ [MERGE_MARKER_META_KEY]: mkMarker("completed", MERGE_PHASE.completed) });
    }, { fence, bumpRevision: true });
    try {
      sdb.close();
    } catch {
    }
    await deleteStagingDb(env, sessionId);
    sdb = null;
    return {
      added,
      deduped,
      remapped: counters.remapped,
      danglingReferences: defense.dangling.total,
      danglingDetail: defense.dangling,
      userDictionaryRevision: activation.userDictionaryRevision,
      leaseEpoch: lease.leaseEpoch,
      leaseRenewCount,
      mergeSessionId: sessionId,
      sessionId,
      stagingDbName,
      report,
      broadcast: { type: "bulkDictionaryChanged", scope: "all", revision: activation.userDictionaryRevision }
    };
  } catch (e) {
    if (!markedOwn && !mainTouched) {
      try {
        if (sdb) sdb.close();
      } catch {
      }
      try {
        await deleteStagingDb(env, sessionId);
      } catch {
      }
      sdb = null;
    }
    throw e;
  } finally {
    if (lease) {
      try {
        await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
      } catch {
      }
    }
    if (sdb) {
      try {
        sdb.close();
      } catch {
      }
    }
  }
}
__name(mergeBackup, "mergeBackup");
async function resumeMerge(db, { owner = void 0, env = {}, faultInjector = null } = {}) {
  const fault = /* @__PURE__ */ __name(async (p) => {
    if (faultInjector) await faultInjector(p);
  }, "fault");
  const meta0 = await getMeta(db);
  const marker = meta0[MERGE_MARKER_META_KEY] ?? null;
  if (!marker || marker.state === "completed" || marker.state === "abandoned") return { resumed: false, reason: "nothing_to_resume" };
  const sessionId = marker.sessionId ?? marker.mergeSessionId;
  if (!sessionId) return { resumed: false, reason: "marker_has_no_session" };
  let sdb;
  try {
    sdb = await openStagingDb(env, sessionId);
  } catch {
    return { resumed: false, reason: "staging_unavailable" };
  }
  const session = await readStagingSession(sdb);
  if (!session || session.sessionId !== sessionId || session.operation !== "merge") {
    try {
      sdb.close();
    } catch {
    }
    return { resumed: false, reason: "staging_lost", markerPhase: marker.phase };
  }
  let lease = await acquireMaintenanceLease(db, { type: "import_merge", ttlMs: BACKUP_POLICY.mergeLeaseTtlMs, ...owner ? { owner } : {}, steal: true, now: Date.now() });
  const fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
  let leaseRenewCount = 0;
  const renew = /* @__PURE__ */ __name(async () => {
    lease = await renewMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch, ttlMs: BACKUP_POLICY.mergeLeaseTtlMs });
    leaseRenewCount += 1;
  }, "renew");
  const done = [...marker.checkpoint?.done ?? []];
  const doneSet = new Set(done);
  const baseZero = { entities: 0, claims: 0, evidence: 0, relations: 0, history: 0, rejections: 0, packages: 0 };
  const added = { ...baseZero, ...marker.checkpoint?.counts?.added ?? {} };
  const deduped = { ...baseZero, ...marker.checkpoint?.counts?.deduped ?? {} };
  const mkMarker = /* @__PURE__ */ __name((state, phase) => ({
    state,
    operation: "merge",
    sessionId,
    stagingDbName: marker.stagingDbName ?? stagingDbNameFor(sessionId),
    phase,
    startedAt: marker.startedAt,
    checkpoint: { done: [...done], counts: { added: { ...added }, deduped: { ...deduped } } },
    finishedAt: state === "completed" ? Date.now() : null
  }), "mkMarker");
  const mark = /* @__PURE__ */ __name((state, phase) => setImportMarker(db, fence, MERGE_MARKER_META_KEY, mkMarker(state, phase)), "mark");
  const counters = { remapped: 0 };
  const nodeRemap = /* @__PURE__ */ new Map();
  try {
    await mark("running", MERGE_PHASE.merging);
    await fault("resume:merging");
    for (const [field] of MERGE_STORE_ORDER) {
      if (doneSet.has(field) && field !== "entities" && field !== "claims") continue;
      await applyMergeStore(db, sdb, field, { fence, nodeRemap, added, deduped, counters, mergeSessionId: sessionId, renew });
      if (!doneSet.has(field)) {
        doneSet.add(field);
        done.push(field);
      }
      await mark("running", MERGE_PHASE.merging);
    }
    await mark("running", MERGE_PHASE.finalizing);
    await clearMergeQuarantine(db, fence, sessionId);
    const defense = await postMergeDefense(db, sdb, { manifest: session.manifest, sessionId, fence, requiredDone: BACKUP_FIELDS, added, deduped });
    if (!defense.ok) throw new MergeError("resume: post-merge defense failed; NOT activated", { problems: defense.problems });
    const activation = await runSemanticMutation(db, [STORE.cache], async ({ tx, patchMeta }) => {
      await requestOf6(tx.objectStore(STORE.cache).clear());
      patchMeta({ [MERGE_MARKER_META_KEY]: mkMarker("completed", MERGE_PHASE.completed) });
    }, { fence, bumpRevision: true });
    try {
      sdb.close();
    } catch {
    }
    await deleteStagingDb(env, sessionId);
    return { resumed: true, mergeSessionId: sessionId, sessionId, leaseRenewCount, added, deduped, remapped: counters.remapped, userDictionaryRevision: activation.userDictionaryRevision, broadcast: { type: "bulkDictionaryChanged", scope: "all", revision: activation.userDictionaryRevision } };
  } finally {
    try {
      await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
    } catch {
    }
    try {
      sdb.close();
    } catch {
    }
  }
}
__name(resumeMerge, "resumeMerge");
async function inspectMergeState(db) {
  const meta = await getMeta(db);
  const marker = meta[MERGE_MARKER_META_KEY] ?? null;
  const ms = dictionaryMaintenanceState(meta, { now: Date.now() });
  const st = marker?.state ?? null;
  return {
    inProgress: Boolean(marker && st && st !== "completed" && st !== "abandoned"),
    operation: "merge",
    phase: marker?.phase ?? null,
    state: st,
    mergeSessionId: marker?.sessionId ?? marker?.mergeSessionId ?? null,
    sessionId: marker?.sessionId ?? marker?.mergeSessionId ?? null,
    stagingDbName: marker?.stagingDbName ?? null,
    checkpoint: marker?.checkpoint ?? null,
    knowledgeReplacementInProgress: ms.knowledgeReplacementInProgress,
    leaseLive: ms.maintenanceActive,
    canResume: st === "running",
    canRollback: false
    // merge は additive。preparing でも rollback UI は出さない（no-op）
  };
}
__name(inspectMergeState, "inspectMergeState");
async function countDanglingReferences(db) {
  const scanCursor = /* @__PURE__ */ __name((storeName, onRec) => new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readonly");
    const rq = tx.objectStore(storeName).openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (c) {
        onRec(c.value);
        c.continue();
      } else resolve();
    };
    rq.onerror = () => reject(rq.error);
  }), "scanCursor");
  const claimIds = /* @__PURE__ */ new Set();
  const nodeIds = /* @__PURE__ */ new Set();
  await scanCursor(STORE.claims, (c) => {
    claimIds.add(c.claimId);
    nodeIds.add(c.claimId);
  });
  await scanCursor(STORE.entities, (e) => {
    if (e.nodeId) nodeIds.add(e.nodeId);
  });
  let danglingEvidence = 0;
  await scanCursor(STORE.evidence, (ev) => {
    if (ev.claimId != null && !claimIds.has(ev.claimId)) danglingEvidence += 1;
  });
  let danglingRelations = 0;
  await scanCursor(STORE.relations, (r) => {
    if (r.fromNodeId != null && !nodeIds.has(r.fromNodeId) || r.toNodeId != null && !nodeIds.has(r.toNodeId)) danglingRelations += 1;
  });
  return { total: danglingEvidence + danglingRelations, danglingEvidence, danglingRelations };
}
__name(countDanglingReferences, "countDanglingReferences");
async function normalizeSource(sourceLike, { limits = BACKUP_SAFETY_LIMITS } = {}) {
  let src;
  if (sourceLike && typeof sourceLike.records === "function" && ("header" in sourceLike || typeof sourceLike.ready === "function")) {
    src = sourceLike;
  } else if (typeof sourceLike === "string") {
    src = parseBackupText(sourceLike, { limits });
  } else if (typeof Blob !== "undefined" && sourceLike instanceof Blob) {
    src = backupSourceFromStream(sourceLike, { limits });
  } else if (sourceLike && typeof sourceLike.open === "function") {
    src = backupSourceFromStream(sourceLike, { limits });
  } else if (sourceLike && typeof sourceLike === "object") {
    src = backupSourceFromObject(sourceLike, { limits });
  } else {
    throw new BackupError("unrecognised backup source", {});
  }
  if (typeof src.ready === "function") await src.ready();
  return src;
}
__name(normalizeSource, "normalizeSource");

// dictionary-maintenance.js
function requestOf7(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf7, "requestOf");
var MaintenanceError = class extends Error {
  static {
    __name(this, "MaintenanceError");
  }
  constructor(message, details) {
    super(message);
    this.name = "MaintenanceError";
    this.details = details;
  }
};
var DestructiveResetConfirmationError = class extends MaintenanceError {
  static {
    __name(this, "DestructiveResetConfirmationError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "DestructiveResetConfirmationError";
  }
};
var DESTRUCTIVE_RESET_CONFIRMATION = "DELETE ALL USER DICTIONARY TRUTH";
var PWA_REFRESH_REQUEST = "fmlnc-refresh-precache";
var PWA_REFRESH_TIMEOUT_MS = 12e4;
var MAINTENANCE_OPS = Object.freeze({
  pwa_asset_cache_clear: Object.freeze({
    id: "pwa_asset_cache_clear",
    destructive: false,
    requiresConfirmationPhrase: false,
    label: { ja: "PWA アセットキャッシュを再取得", en: "Re-download PWA asset cache" },
    affects: ["service_worker_cache_storage"],
    preserves: ["claims", "evidence", "relations", "history", "rejections", "user_dictionary", "resolution_cache"]
  }),
  resolution_cache_clear: Object.freeze({
    id: "resolution_cache_clear",
    destructive: false,
    requiresConfirmationPhrase: false,
    label: { ja: "解決キャッシュを消去（辞書は保持）", en: "Clear resolution cache (dictionary kept)" },
    affects: ["resolution_cache"],
    preserves: ["claims", "evidence", "relations", "history", "rejections", "user_dictionary"]
  }),
  job_runtime_cleanup: Object.freeze({
    id: "job_runtime_cleanup",
    destructive: false,
    requiresConfirmationPhrase: false,
    label: { ja: "完了ジョブ・期限切れリースを整理", en: "Clean up completed jobs / expired leases" },
    affects: ["completed_jobs", "expired_leases"],
    preserves: ["claims", "evidence", "relations", "history", "rejections", "active_jobs", "user_dictionary"]
  }),
  destructive_user_dictionary_reset: Object.freeze({
    id: "destructive_user_dictionary_reset",
    destructive: true,
    requiresConfirmationPhrase: true,
    confirmationPhrase: DESTRUCTIVE_RESET_CONFIRMATION,
    label: {
      ja: "ユーザー辞書を完全に削除（元に戻せません）",
      en: "Permanently delete the user dictionary (cannot be undone)"
    },
    deletes: ["entities", "claims", "evidence", "relations", "history", "rejections", "packages", "resolution_cache", "jobs"],
    preserves: ["installationId", "schema_versions", "policy_versions"]
  })
});
async function refreshPwaAssetCache({
  serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker,
  onLine = globalThis.navigator ? globalThis.navigator.onLine : true,
  timeoutMs = PWA_REFRESH_TIMEOUT_MS
} = {}) {
  if (!serviceWorker || typeof serviceWorker.getRegistration !== "function") {
    return { ok: false, supported: false, reason: "unsupported" };
  }
  if (onLine === false) return { ok: false, supported: true, reason: "offline" };
  const registration = await serviceWorker.getRegistration();
  const worker = registration && registration.active;
  if (!worker || worker.state !== "activated") return { ok: false, supported: true, reason: "no-worker" };
  const channel = new MessageChannel();
  let timer;
  try {
    const reply = await new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
      channel.port1.onmessage = (e) => resolve(e.data && typeof e.data === "object" ? e.data : { ok: false, reason: "error" });
      worker.postMessage({ type: PWA_REFRESH_REQUEST }, [channel.port2]);
    });
    return { ...reply, ok: reply.ok === true, supported: true };
  } finally {
    clearTimeout(timer);
    channel.port1.close();
  }
}
__name(refreshPwaAssetCache, "refreshPwaAssetCache");
var PWA_CACHE_PREFIX = "fmlnc-";
var PWA_CACHE_LOCK = "fmlnc-pwa-cache";
async function measurePwaCacheSize(opts = {}) {
  const prefix = opts.prefix || PWA_CACHE_PREFIX;
  let cacheStorage;
  let locks;
  try {
    cacheStorage = "cacheStorage" in opts ? opts.cacheStorage : globalThis.caches;
    locks = "locks" in opts ? opts.locks : globalThis.navigator && globalThis.navigator.locks;
  } catch (err) {
    return { ok: false, supported: false, reason: String(err && err.name || err) };
  }
  if (locks && typeof locks.request === "function") {
    try {
      return await locks.request(PWA_CACHE_LOCK, { mode: "shared" }, () => sumPwaCaches(cacheStorage, prefix));
    } catch (err) {
      return { ok: false, supported: true, reason: String(err && err.name || err) };
    }
  }
  return sumPwaCaches(cacheStorage, prefix);
}
__name(measurePwaCacheSize, "measurePwaCacheSize");
async function sumPwaCaches(cacheStorage, prefix) {
  if (!cacheStorage || typeof cacheStorage.keys !== "function") return { ok: false, supported: false };
  try {
    let bytes = 0;
    const measured = [];
    for (const name of await cacheStorage.keys()) {
      if (typeof name !== "string" || name.indexOf(prefix) !== 0) continue;
      if (!await cacheStorage.has(name)) continue;
      const responses = await (await cacheStorage.open(name)).matchAll();
      for (const res of responses) bytes += (await res.blob()).size;
      measured.push(name);
    }
    return { ok: true, supported: true, bytes, caches: measured };
  } catch (err) {
    return { ok: false, supported: true, reason: String(err && err.name || err) };
  }
}
__name(sumPwaCaches, "sumPwaCaches");
var PWA_OLD_CACHE_PLAN = "fmlnc-old-cache-plan";
var PWA_OLD_CACHE_DELETE = "fmlnc-old-cache-delete";
async function askActiveWorker(serviceWorker, message, timeoutMs) {
  if (!serviceWorker || typeof serviceWorker.getRegistration !== "function") return { ok: false, supported: false, reason: "unsupported" };
  const registration = await serviceWorker.getRegistration();
  const worker = registration && registration.active;
  if (!worker) return { ok: false, supported: true, reason: "no-worker" };
  if (worker.state !== "activated" || registration.installing || registration.waiting) return { ok: false, supported: true, reason: "updating" };
  const channel = new MessageChannel();
  let timer;
  try {
    const reply = await new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
      channel.port1.onmessage = (e) => resolve(e.data && typeof e.data === "object" ? e.data : { ok: false, reason: "error" });
      worker.postMessage(message, [channel.port2]);
    });
    return { ...reply, ok: reply.ok === true, supported: true };
  } finally {
    clearTimeout(timer);
    channel.port1.close();
  }
}
__name(askActiveWorker, "askActiveWorker");
function planOldPwaCaches({ serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker, timeoutMs = 3e4 } = {}) {
  return askActiveWorker(serviceWorker, { type: PWA_OLD_CACHE_PLAN }, timeoutMs);
}
__name(planOldPwaCaches, "planOldPwaCaches");
function deleteOldPwaCaches({ names, serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker, timeoutMs = 3e4 } = {}) {
  return askActiveWorker(serviceWorker, { type: PWA_OLD_CACHE_DELETE, names: Array.isArray(names) ? names.slice() : [] }, timeoutMs);
}
__name(deleteOldPwaCaches, "deleteOldPwaCaches");
async function clearResolutionCacheOnly(db) {
  await clearResolutionCache(db);
  return { cleared: "resolution_cache" };
}
__name(clearResolutionCacheOnly, "clearResolutionCacheOnly");
async function cleanupJobRuntime(db, { confirm = true, now = Date.now() } = {}) {
  const plan = await planSafeGc(db, { now });
  const result = await runSafeGc(db, plan, { confirm, now });
  return { removedJobs: result.removedJobs, skipped: result.skipped, plannedJobs: plan.completedOldJobs.length };
}
__name(cleanupJobRuntime, "cleanupJobRuntime");
var DESTRUCTIVE_RESET_STORES = Object.freeze([
  STORE.entities,
  STORE.claims,
  STORE.evidence,
  STORE.relations,
  STORE.history,
  STORE.rejections,
  STORE.packages,
  STORE.cache,
  STORE.jobs
]);
async function destructiveResetUserDictionary(db, {
  confirmationPhrase,
  expectedInstallationId = null,
  owner = void 0,
  leaseTtlMs = 3e4,
  now = Date.now()
} = {}) {
  if (confirmationPhrase !== DESTRUCTIVE_RESET_CONFIRMATION) {
    throw new DestructiveResetConfirmationError(
      `Destructive reset not performed: confirmationPhrase must be exactly ${JSON.stringify(DESTRUCTIVE_RESET_CONFIRMATION)}. No data was deleted.`,
      { deleted: 0 }
    );
  }
  const meta = await getMeta(db);
  if (expectedInstallationId != null && meta.installationId !== expectedInstallationId) {
    throw new DestructiveResetConfirmationError(
      "Destructive reset not performed: this is a different installation than expected. No data was deleted.",
      { deleted: 0, expected: expectedInstallationId, actual: meta.installationId }
    );
  }
  const lease = await acquireMaintenanceLease(db, {
    type: "destructive_reset",
    ttlMs: leaseTtlMs,
    ...owner ? { owner } : {},
    now
  });
  const fence = { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch };
  try {
    const activation = await runSemanticMutation(db, DESTRUCTIVE_RESET_STORES, async ({ tx, patchMeta }) => {
      for (const s of DESTRUCTIVE_RESET_STORES) await requestOf7(tx.objectStore(s).clear());
      patchMeta({ maintenanceRestore: null });
    }, { fence, bumpRevision: true });
    const finalMeta = await getMeta(db);
    return {
      reset: true,
      clearedStores: DESTRUCTIVE_RESET_STORES.slice(),
      installationId: finalMeta.installationId,
      userDictionaryRevision: activation.userDictionaryRevision,
      leaseEpoch: lease.leaseEpoch
    };
  } finally {
    try {
      await releaseMaintenanceLease(db, { ...owner ? { owner } : {}, leaseEpoch: lease.leaseEpoch });
    } catch {
    }
  }
}
__name(destructiveResetUserDictionary, "destructiveResetUserDictionary");
async function previewDestructiveReset(db, { chunkSize = 500 } = {}) {
  const counts = {};
  for (const s of [STORE.claims, STORE.evidence, STORE.relations, STORE.history, STORE.rejections]) {
    let n = 0;
    await forEachChunk(db, s, (items) => {
      n += items.length;
    }, { chunkSize });
    counts[s] = n;
  }
  return { counts, op: MAINTENANCE_OPS.destructive_user_dictionary_reset };
}
__name(previewDestructiveReset, "previewDestructiveReset");

// dictionary-import-safety.js
var IMPORT_SAFETY_LIMITS = Object.freeze({
  /** file 全体の最大 bytes（UTF-16 code unit 数で近似）。 */
  maxBytes: 64 * 1024 * 1024,
  /** 1 file あたりの最大 record 数（records / entities / rejections 各々）。 */
  maxRecords: 2e5,
  /** 1 string field の最大長。 */
  maxStringLength: 8192,
  /** 1 array field の最大要素数（applicability の各 dimension 等）。 */
  maxArrayLength: 512,
  /** JSON の最大 nest depth。 */
  maxDepth: 24,
  /** object 1個あたりの最大 key 数（unknown field 爆撃対策）。 */
  maxKeysPerObject: 128
});
var ImportSafetyError = class extends Error {
  static {
    __name(this, "ImportSafetyError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ImportSafetyError";
    this.details = details;
  }
};
var FORBIDDEN_KEYS2 = Object.freeze(["__proto__", "constructor", "prototype"]);
var FORBIDDEN_KEY_SET = new Set(FORBIDDEN_KEYS2);
var EXECUTABLE_FIELD_DENYLIST = Object.freeze([
  "script",
  "scripts",
  "code",
  "eval",
  "fn",
  "func",
  "callback",
  "regex",
  "regexp",
  "patternRegex",
  "matcher",
  "prompt",
  "promptTemplate",
  "systemPrompt",
  "aiPrompt",
  "url",
  "fetch",
  "fetchUrl",
  "endpoint",
  "webhook",
  "src",
  "href",
  "importUrl",
  "module",
  "require",
  "html",
  "innerHTML",
  "dangerouslySetInnerHTML",
  "path",
  "filePath",
  "filesystem",
  "command",
  "exec",
  "shell",
  "keyPath",
  "indexDefinition",
  "objectStore",
  "dbSchema"
]);
var EXECUTABLE_FIELD_SET = new Set(EXECUTABLE_FIELD_DENYLIST);
var SCRIPT_ALLOWED_PATHS = Object.freeze(/* @__PURE__ */ new Set(["claim", "record.claim"]));
function approximateByteLength(text) {
  return typeof text === "string" ? text.length : 0;
}
__name(approximateByteLength, "approximateByteLength");
function safeParseJson(text, { limits = IMPORT_SAFETY_LIMITS, what = "import file" } = {}) {
  if (typeof text !== "string") {
    throw new ImportSafetyError(`${what}: expected a JSON string`, { got: typeof text });
  }
  const bytes = approximateByteLength(text);
  if (bytes > limits.maxBytes) {
    throw new ImportSafetyError(`${what}: exceeds max size`, { bytes, maxBytes: limits.maxBytes });
  }
  let parsed;
  try {
    parsed = JSON.parse(text, (key, value) => FORBIDDEN_KEY_SET.has(key) ? void 0 : value);
  } catch (e) {
    throw new ImportSafetyError(`${what}: malformed JSON`, { cause: String(e?.message ?? e) });
  }
  assertBoundedShape(parsed, { limits, what });
  return parsed;
}
__name(safeParseJson, "safeParseJson");
function assertBoundedShape(value, { limits = IMPORT_SAFETY_LIMITS, what = "import file" } = {}) {
  const walk = /* @__PURE__ */ __name((v, depth, path) => {
    if (depth > limits.maxDepth) {
      throw new ImportSafetyError(`${what}: nesting too deep`, { path, maxDepth: limits.maxDepth });
    }
    if (typeof v === "string") {
      if (v.length > limits.maxStringLength) {
        throw new ImportSafetyError(
          `${what}: string too long`,
          { path, length: v.length, max: limits.maxStringLength }
        );
      }
      return;
    }
    if (Array.isArray(v)) {
      if (v.length > limits.maxRecords) {
        throw new ImportSafetyError(
          `${what}: array too large`,
          { path, length: v.length, max: limits.maxRecords }
        );
      }
      for (let i = 0; i < v.length; i += 1) walk(v[i], depth + 1, `${path}[${i}]`);
      return;
    }
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length > limits.maxKeysPerObject) {
        throw new ImportSafetyError(
          `${what}: too many keys on one object`,
          { path, keys: keys.length, max: limits.maxKeysPerObject }
        );
      }
      for (const k of keys) {
        if (FORBIDDEN_KEY_SET.has(k)) {
          throw new ImportSafetyError(`${what}: forbidden key`, { path, key: k });
        }
        walk(v[k], depth + 1, `${path}.${k}`);
      }
    }
  }, "walk");
  walk(value, 0, "$");
  return true;
}
__name(assertBoundedShape, "assertBoundedShape");
function assertNoExecutableFields(value, { what = "record", path = "" } = {}) {
  const walk = /* @__PURE__ */ __name((v, p) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (!v || typeof v !== "object") return;
    for (const k of Object.keys(v)) {
      const child = p ? `${p}.${k}` : k;
      if (EXECUTABLE_FIELD_SET.has(k)) {
        if (k === "script" && SCRIPT_ALLOWED_PATHS.has(p)) {
          if (v[k] !== null && typeof v[k] !== "string") {
            throw new ImportSafetyError(`${what}: claim.script must be a string or null`, { path: child });
          }
        } else {
          throw new ImportSafetyError(
            `${what}: field "${k}" is not an accepted capability (no arbitrary code / regex / prompt / network / filesystem / schema mutation)`,
            { path: child, field: k }
          );
        }
      }
      walk(v[k], child);
    }
  }, "walk");
  walk(value, path);
  return true;
}
__name(assertNoExecutableFields, "assertNoExecutableFields");
function projectAllowedFields(input, allowlist, { what = "record" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ImportSafetyError(
      `${what}: expected an object`,
      { got: Array.isArray(input) ? "array" : typeof input }
    );
  }
  const allowed = new Set(allowlist);
  const out = {};
  const unknownKeys = [];
  for (const k of Object.keys(input)) {
    if (FORBIDDEN_KEY_SET.has(k)) continue;
    if (allowed.has(k)) out[k] = input[k];
    else unknownKeys.push(k);
  }
  return { value: out, unknownKeys };
}
__name(projectAllowedFields, "projectAllowedFields");
function requireString(what, field, v, { limits = IMPORT_SAFETY_LIMITS, allowNull = false } = {}) {
  if (v == null && allowNull) return null;
  if (typeof v !== "string" || v.length === 0) {
    throw new ImportSafetyError(
      `${what}: ${field} must be a non-empty string`,
      { field, got: v === null ? "null" : typeof v }
    );
  }
  if (v.length > limits.maxStringLength) {
    throw new ImportSafetyError(`${what}: ${field} too long`, { field, length: v.length });
  }
  return v;
}
__name(requireString, "requireString");
function requireEnum(what, field, v, allowed) {
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new ImportSafetyError(`${what}: ${field} is not an accepted value`, { field, got: v, allowed });
  }
  return v;
}
__name(requireEnum, "requireEnum");
function requireBoolean(what, field, v, { fallback = void 0 } = {}) {
  if (typeof v === "boolean") return v;
  if (v === void 0 && fallback !== void 0) return fallback;
  throw new ImportSafetyError(`${what}: ${field} must be a boolean`, { field, got: typeof v });
}
__name(requireBoolean, "requireBoolean");
function requireStringArray(what, field, v, { limits = IMPORT_SAFETY_LIMITS } = {}) {
  if (v === void 0 || v === null) return [];
  if (!Array.isArray(v)) {
    throw new ImportSafetyError(`${what}: ${field} must be an array`, { field, got: typeof v });
  }
  if (v.length > limits.maxArrayLength) {
    throw new ImportSafetyError(
      `${what}: ${field} array too long`,
      { field, length: v.length, max: limits.maxArrayLength }
    );
  }
  for (const x of v) {
    if (typeof x !== "string" || x.length > limits.maxStringLength) {
      throw new ImportSafetyError(`${what}: ${field} must contain short strings`, { field });
    }
  }
  return [...v];
}
__name(requireStringArray, "requireStringArray");
var SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;
function requireSafeIdentifier(what, field, v, { limits = IMPORT_SAFETY_LIMITS } = {}) {
  requireString(what, field, v, { limits });
  if (v.includes("..") || v.includes("/") || v.includes("\\") || !SAFE_IDENTIFIER.test(v)) {
    throw new ImportSafetyError(
      `${what}: ${field} is not a safe identifier (no path separators / traversal / control chars)`,
      { field, got: v }
    );
  }
  return v;
}
__name(requireSafeIdentifier, "requireSafeIdentifier");
var SEMVER_LIKE = /^\d{1,6}(\.\d{1,6}){0,3}(-[A-Za-z0-9.]{1,32})?$/;
function requireVersionString(what, field, v) {
  requireString(what, field, v);
  if (!SEMVER_LIKE.test(v)) {
    throw new ImportSafetyError(`${what}: ${field} must look like 1.4.0`, { field, got: v });
  }
  return v;
}
__name(requireVersionString, "requireVersionString");
function compareVersionStrings(a, b) {
  const pa = String(a).split("-")[0].split(".").map((x) => Number(x) || 0);
  const pb = String(b).split("-")[0].split(".").map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
__name(compareVersionStrings, "compareVersionStrings");

// dictionary-portable.js
var PORTABLE_FORMAT = "FMlncGenPortableDictionary";
var PORTABLE_VERSION = 1;
var PORTABLE_STREAM_VERSION = 2;
var PORTABLE_STREAM = Object.freeze({
  marker: "@",
  sectionRecords: "@records",
  sectionEntities: "@entities",
  sectionRejections: "@rejections",
  sectionMeta: "@meta",
  sectionEnd: "@end"
});
var PORTABLE_IMPORT_MODE = Object.freeze({
  /** 既定。locked=false / verificationState=none。provenance だけ保持。 */
  shared: "shared",
  /**
   * §102.2.2:「Userが明示的に『このPortable辞書を自分の確定辞書として取り込む』
   *  モードを選んだ場合のみ強いManual扱いへ昇格可能」。
   *  昇格は **現在の User の操作**が根拠であり、Export 元 metadata が根拠ではない。
   */
  adoptAsManual: "adopt_as_manual"
});
var PORTABLE_ADOPT_CONFIRMATION = "ADOPT-PORTABLE-AS-MY-OWN";
var PORTABLE_POLICY = Object.freeze({
  portablePolicyVersion: 1,
  /** export の cursor page / import の chunk（§106「1 transaction へ詰め込まない」）。 */
  exportPageSize: 200,
  importChunkSize: 200,
  /** 1 Claim の lineage 導出で走査する Evidence の bounded page / 上限。 */
  lineageEvidencePageSize: 200,
  lineageMaxEvidence: 2e3,
  /** lineage に載せる origin group の上限（Evidence 1M でも record は小さいまま）。 */
  maxOriginGroups: 32,
  /**
   * §102.2 Portable Rejection の subject 復元で claimGroupKey index を引くときの
   * bounded 上限。1 group の Claim 数は Cardinality Policy 上small なので十分。
   */
  rejectionSubjectLookupLimit: 50,
  /**
   * §102.2 / §114: Portable artifact から受け入れる sourceNameGuard の
   * `acceptedNormalizedNames` 上限。**名前を増やさない**ための上限であって、
   * ここを超える guard は「過度に広い」として reconstruct 側へ倒す。
   */
  maxGuardAcceptedNames: 32,
  /** Blob fallback 上限。 */
  blobFallbackMaxBytes: 128 * 1024 * 1024
});
var PORTABLE_SAFETY_LIMITS = Object.freeze({
  ...IMPORT_SAFETY_LIMITS,
  maxRecords: 2e5
});
var PortableError = class extends Error {
  static {
    __name(this, "PortableError");
  }
  constructor(message, details) {
    super(message);
    this.name = "PortableError";
    this.details = details;
  }
};
var PortableValidationError = class extends PortableError {
  static {
    __name(this, "PortableValidationError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PortableValidationError";
  }
};
async function computeLineageDigest(lineage) {
  return stableHash({
    schema: "portable-lineage",
    version: 1,
    originGroups: [...lineage.originGroups ?? []].sort(),
    unknownOriginGroups: [...lineage.unknownOriginGroups ?? []].sort(),
    hasExplicitUserConfirmation: Boolean(lineage.hasExplicitUserConfirmation),
    hasOfficialSupport: Boolean(lineage.hasOfficialSupport)
  });
}
__name(computeLineageDigest, "computeLineageDigest");
var USER_EVIDENCE_TYPES = /* @__PURE__ */ new Set([
  EVIDENCE_TYPE.userCorrection,
  EVIDENCE_TYPE.explicitUserConfirmation,
  EVIDENCE_TYPE.manualEntry
]);
async function derivePortableLineage(db, claimId, { policy = PORTABLE_POLICY } = {}) {
  const originGroups = /* @__PURE__ */ new Set();
  const unknownOriginGroups = /* @__PURE__ */ new Set();
  let hasExplicitUserConfirmation = false;
  let hasOfficialSupport = false;
  let carriedOriginRecordKey = null;
  let importedHadUserConfirmation = false;
  let sawImportSnapshot = false;
  let scanned = 0;
  let truncated = false;
  let maxPageBuffer = 0;
  let cursor = null;
  outer: for (; ; ) {
    const page = await iterateEvidenceForClaim(db, claimId, {
      limit: policy.lineageEvidencePageSize,
      cursor
    });
    maxPageBuffer = Math.max(maxPageBuffer, page.items.length);
    for (const ev of page.items) {
      scanned += 1;
      if (scanned > policy.lineageMaxEvidence) {
        truncated = true;
        break outer;
      }
      if (!isDecisionAffecting(ev) || ev.stance !== STANCE.support) continue;
      if (USER_EVIDENCE_TYPES.has(ev.evidenceType)) hasExplicitUserConfirmation = true;
      if (ev.evidenceType === EVIDENCE_TYPE.officialSource) hasOfficialSupport = true;
      if (ev.evidenceType === EVIDENCE_TYPE.portableImportSnapshot) {
        sawImportSnapshot = true;
        if (!carriedOriginRecordKey && ev.originRecordKey) carriedOriginRecordKey = ev.originRecordKey;
        const imported = ev.importedProvenanceLineage;
        if (imported) {
          for (const g of imported.originGroups ?? []) {
            if (originGroups.size < policy.maxOriginGroups) originGroups.add(g);
          }
          for (const g of imported.unknownOriginGroups ?? []) {
            if (unknownOriginGroups.size < policy.maxOriginGroups) unknownOriginGroups.add(g);
          }
          if (imported.hasExplicitUserConfirmation) {
            hasExplicitUserConfirmation = true;
            importedHadUserConfirmation = true;
          }
          if (imported.hasOfficialSupport) hasOfficialSupport = true;
          continue;
        }
        if (unknownOriginGroups.size < policy.maxOriginGroups) {
          unknownOriginGroups.add(ev.independenceGroup ?? `import:${ev.evidenceType}`);
        }
        continue;
      }
      const group = ev.independenceGroup ?? `other:${ev.evidenceType}`;
      const unknown = ev.lineageClassification === "unknown";
      const bucket = unknown ? unknownOriginGroups : originGroups;
      if (bucket.size < policy.maxOriginGroups) bucket.add(group);
    }
    if (page.done) break;
    cursor = page.nextCursor;
  }
  const lineage = {
    originGroups: [...originGroups].sort(),
    unknownOriginGroups: [...unknownOriginGroups].sort(),
    hasExplicitUserConfirmation,
    hasOfficialSupport,
    lineageDigest: null
  };
  lineage.lineageDigest = await computeLineageDigest(lineage);
  return {
    lineage,
    /**
     * §102.6: carry-forward できるのは「意味/Provenance を変えていない」場合だけ。
     * Import 後に **この端末の User が明示確認した**なら provenance class が実質
     * 強くなったので、新しい origin signature を作ってよい（= carry-forward しない）。
     */
    carriedOriginRecordKey: sawImportSnapshot && !(hasExplicitUserConfirmation && !importedHadUserConfirmation) ? carriedOriginRecordKey : null,
    truncated,
    scanned,
    maxPageBuffer
  };
}
__name(derivePortableLineage, "derivePortableLineage");
function portableOriginGroupFor(lineage) {
  const known = [...lineage?.originGroups ?? []].sort();
  if (known.length === 1) return known[0];
  if (known.length > 1) return `portable-lineage:${known.join("|")}`;
  const unknown = [...lineage?.unknownOriginGroups ?? []].sort();
  if (unknown.length) return `portable-unknown:${unknown.join("|")}`;
  return `portable-unknown:${lineage?.lineageDigest ?? "none"}`;
}
__name(portableOriginGroupFor, "portableOriginGroupFor");
function portableRecordSemanticSignature(record) {
  return stableSerialize({
    schema: "portable-record-semantic",
    version: 1,
    subjectKind: record.subject.subjectKind,
    sourceText: record.subject.sourceText,
    valueType: record.claim.valueType,
    value: record.claim.value,
    script: record.claim.script ?? null,
    applicabilityConstraints: record.claim.applicabilityConstraints ?? null
  });
}
__name(portableRecordSemanticSignature, "portableRecordSemanticSignature");
async function portableProvenanceDigest(lineage) {
  return computeLineageDigest(lineage);
}
__name(portableProvenanceDigest, "portableProvenanceDigest");
async function computePortableOriginRecordKey({
  sourceInstallationId,
  record,
  lineage,
  originRecordKeyVersion = 1
}) {
  return originRecordKey({
    sourceKind: "portable",
    sourceId: sourceInstallationId ?? null,
    recordIdentity: {
      semanticSignature: portableRecordSemanticSignature(record),
      provenanceDigest: await portableProvenanceDigest(lineage)
    },
    originRecordKeyVersion
  });
}
__name(computePortableOriginRecordKey, "computePortableOriginRecordKey");
var PortableSizeLimitError = class extends PortableError {
  static {
    __name(this, "PortableSizeLimitError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PortableSizeLimitError";
  }
};
function createPortableSink({
  maxBytes = PORTABLE_POLICY.blobFallbackMaxBytes,
  mime = "application/json"
} = {}) {
  const parts = [];
  let bytes = 0;
  let closed = false;
  let aborted = false;
  return {
    kind: "blob",
    async write(chunk) {
      if (closed || aborted) throw new PortableError("sink is closed");
      const s = typeof chunk === "string" ? chunk : String(chunk);
      bytes += s.length;
      if (bytes > maxBytes) {
        aborted = true;
        throw new PortableSizeLimitError(
          `portable export exceeded ${maxBytes} bytes; use a File System writable stream`,
          { bytes, maxBytes }
        );
      }
      parts.push(s);
    },
    async close() {
      closed = true;
    },
    async abort() {
      aborted = true;
      parts.length = 0;
    },
    get bytesWritten() {
      return bytes;
    },
    get aborted() {
      return aborted;
    },
    toBlob() {
      if (!closed) throw new PortableError("sink not closed");
      if (aborted) throw new PortableError("sink was aborted; no blob");
      return new Blob(parts, { type: mime });
    },
    toString() {
      if (aborted) throw new PortableError("sink was aborted");
      return parts.join("");
    }
  };
}
__name(createPortableSink, "createPortableSink");
function isPortableExportable(claim) {
  return claim.deletedAt == null && claim.disabled !== true && claim.quarantined !== true && claim.supersededByClaimId == null && claim.lifecycleState !== LIFECYCLE_STATE.archived;
}
__name(isPortableExportable, "isPortableExportable");
function portableEntityRef(claim) {
  const key = typeof claim.subjectKey === "string" ? claim.subjectKey : "";
  return /^entity:[a-z_]+:.+$/.test(key) ? key : null;
}
__name(portableEntityRef, "portableEntityRef");
var ENTITY_SUBJECT_REASON = Object.freeze({
  guardCarried: "entity_guard_carried",
  guardReconstructed: "entity_guard_reconstructed_from_metadata",
  metadataMissing: "entity_metadata_missing",
  metadataMismatch: "entity_metadata_target_or_fmid_mismatch",
  metadataUnreferenced: "entity_metadata_unreferenced_by_any_record",
  guardMetadataConflict: "entity_guard_conflicts_with_metadata",
  /** mode 自体が Portable で運べない（id_only 等の authority 表明）。 */
  guardNotTransportable: "entity_guard_mode_not_transportable",
  /** shape が壊れている / 絞れていない / 名前が多すぎる。 */
  guardInvalid: "entity_guard_invalid_or_unbounded",
  unresolvable: "entity_unresolvable_no_guard_and_no_metadata",
  /**
   * shared mode: Entity Claim には有効な `@entities` metadata が必須。
   * artifact の guard **だけ** を根拠に bind すると、artifact 側が適用対象名を
   * 自由に列挙できてしまう（= `id_only` 禁止の迂回）。
   */
  metadataRequired: "entity_metadata_required_for_entity_claim",
  /** artifact guard が metadata 由来の基準名より広かったので狭めた（degraded）。 */
  guardNarrowed: "entity_guard_narrowed_to_metadata_name",
  /** adopt_as_manual で User が明示的に artifact の適用範囲を受け入れた。 */
  guardCarriedAdopt: "entity_guard_carried_after_explicit_adopt",
  /** destination の既存 Observation と基準名が食い違う（rename 疑い）。 */
  localObservationMismatch: "entity_local_observation_name_mismatch"
});
function sanitizePortableSourceNameGuard(guard, { policy = PORTABLE_POLICY } = {}) {
  if (guard == null) return { guard: null, reason: null };
  if (typeof guard !== "object" || Array.isArray(guard)) {
    return { guard: null, reason: ENTITY_SUBJECT_REASON.guardInvalid };
  }
  if (guard.mode === GUARD_MODE.idOnly || guard.mode === GUARD_MODE.unboundEntityId) {
    return { guard: null, reason: ENTITY_SUBJECT_REASON.guardNotTransportable };
  }
  if (guard.mode !== GUARD_MODE.exactOrAlias && guard.mode !== GUARD_MODE.similarStructure) {
    return { guard: null, reason: ENTITY_SUBJECT_REASON.guardInvalid };
  }
  const raw = Array.isArray(guard.acceptedNormalizedNames) ? guard.acceptedNormalizedNames : [];
  const accepted = [];
  for (const n of raw) {
    if (typeof n !== "string") continue;
    const t = n.trim();
    if (!t) continue;
    if (accepted.includes(t)) continue;
    accepted.push(t);
    if (accepted.length > policy.maxGuardAcceptedNames) {
      return { guard: null, reason: ENTITY_SUBJECT_REASON.guardInvalid };
    }
  }
  if (!accepted.length) return { guard: null, reason: ENTITY_SUBJECT_REASON.guardInvalid };
  const minorChangePolicy = guard.minorChangePolicy === MINOR_CHANGE_POLICY.safeStructural ? MINOR_CHANGE_POLICY.safeStructural : MINOR_CHANGE_POLICY.none;
  return {
    guard: {
      mode: guard.mode,
      acceptedNormalizedNames: accepted,
      sourceFingerprint: typeof guard.sourceFingerprint === "string" ? guard.sourceFingerprint : null,
      sourceFingerprintVersion: Number.isInteger(guard.sourceFingerprintVersion) ? guard.sourceFingerprintVersion : null,
      minorChangePolicy,
      sourceNameGuardVersion: Number.isInteger(guard.sourceNameGuardVersion) ? guard.sourceNameGuardVersion : 1
    },
    reason: null
  };
}
__name(sanitizePortableSourceNameGuard, "sanitizePortableSourceNameGuard");
function reconcilePortableEntitySubject({
  ref,
  guard,
  meta,
  policy = PORTABLE_POLICY,
  adopt = false,
  localObservation = null
}) {
  const parsed = /^entity:([a-z_]+):(.+)$/.exec(ref ?? "");
  if (!parsed) return { ok: false, reason: ENTITY_SUBJECT_REASON.unresolvable };
  const [, target, fmId] = parsed;
  let usable = meta ?? null;
  let mismatch = false;
  if (usable && (usable.target !== target || String(usable.fmId) !== String(fmId))) {
    usable = null;
    mismatch = true;
  }
  const rawName = typeof usable?.originalNameRaw === "string" && usable.originalNameRaw.trim() ? usable.originalNameRaw : null;
  const { guard: carried, reason: guardRejectReason } = sanitizePortableSourceNameGuard(
    guard,
    { policy }
  );
  if (!rawName) {
    return {
      ok: false,
      reason: mismatch ? ENTITY_SUBJECT_REASON.metadataMismatch : carried ? ENTITY_SUBJECT_REASON.metadataRequired : ENTITY_SUBJECT_REASON.unresolvable,
      guardRejectReason: guardRejectReason ?? null
    };
  }
  const basis = strictNormalizedSource(rawName);
  if (!basis) return { ok: false, reason: ENTITY_SUBJECT_REASON.guardInvalid };
  if (carried && !carried.acceptedNormalizedNames.includes(basis)) {
    return { ok: false, reason: ENTITY_SUBJECT_REASON.guardMetadataConflict };
  }
  if (adopt && carried) {
    return {
      ok: true,
      sourceText: rawName,
      guard: carried,
      guardSource: "carried",
      reason: ENTITY_SUBJECT_REASON.guardCarriedAdopt,
      narrowedFrom: null
    };
  }
  const rebuilt = buildSourceNameGuard({ origin: "ai", normalizedSourceName: basis });
  let localMismatch = false;
  if (localObservation) {
    const localName = localObservation.normalizedOriginalName ?? (localObservation.currentOriginalName ? strictNormalizedSource(localObservation.currentOriginalName) : null);
    if (localName && localName !== basis) localMismatch = true;
  }
  const extraNames = carried ? carried.acceptedNormalizedNames.filter((n) => n !== basis).length : 0;
  let reason = ENTITY_SUBJECT_REASON.guardReconstructed;
  if (localMismatch) reason = ENTITY_SUBJECT_REASON.localObservationMismatch;
  else if (extraNames > 0) reason = ENTITY_SUBJECT_REASON.guardNarrowed;
  return {
    ok: true,
    sourceText: rawName,
    guard: rebuilt,
    guardSource: extraNames > 0 ? "narrowed" : "reconstructed",
    reason,
    narrowedFrom: extraNames > 0 ? extraNames + 1 : null,
    needsRevalidation: localMismatch,
    guardRejectReason: guardRejectReason ?? null
  };
}
__name(reconcilePortableEntitySubject, "reconcilePortableEntitySubject");
async function buildPortableRecord(db, claim, { policy = PORTABLE_POLICY } = {}) {
  const derived = await derivePortableLineage(db, claim.claimId, { policy });
  const sourceText = claim.subjectKind === SUBJECT_KIND.entity ? portableEntityRef(claim) : claim.sourceText;
  const record = {
    portableRecordId: newOpaqueId("prec"),
    subject: {
      subjectKind: claim.subjectKind,
      sourceText
    },
    claim: {
      valueType: claim.valueType,
      value: claim.value,
      script: claim.script ?? null,
      applicabilityConstraints: normalizeApplicabilityConstraints(claim.applicabilityConstraints),
      sourceNameGuard: claim.sourceNameGuard ?? null
    },
    /**
     * §102.2:「必要な Context Rejection/Verification Snapshot」。
     * これは **Export 元の状態の記述**であって Import 先の権限ではない
     * （§102.2.2 / §139.5）。
     */
    verificationSnapshot: {
      verificationState: claim.verificationState ?? VERIFICATION_STATE.none,
      wasLockedAtSource: claim.locked === true
    },
    provenanceLineage: derived.lineage,
    originRecordKey: null
  };
  return { record, derived };
}
__name(buildPortableRecord, "buildPortableRecord");
async function exportPortableToSink(db, {
  sink,
  filter = null,
  includeEntities = true,
  includeRejections = true,
  pageSize = PORTABLE_POLICY.exportPageSize,
  policy = PORTABLE_POLICY,
  onProgress = null,
  now = Date.now()
} = {}) {
  if (!sink || typeof sink.write !== "function" || typeof sink.close !== "function") {
    throw new PortableError("exportPortableToSink: sink must have write() and close()");
  }
  const meta = await getMeta(db);
  const header = {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    streamVersion: PORTABLE_STREAM_VERSION,
    portableExportId: newOpaqueId("portable"),
    createdAt: new Date(now).toISOString(),
    /**
     * §102.6:「Top-level sourceInstallationId は『今回 Export した端末』の
     *  metadata であり、Record の最初の独立 Truth Source を B/C 端末へ
     *  付け替えるために使わない」。
     */
    sourceInstallationId: meta.installationId
  };
  const counts = {
    records: 0,
    entities: 0,
    rejections: 0,
    skipped: 0,
    lineageTruncated: 0,
    // §102.2:「復元不能な Rejection は明示的な export report へ」
    rejectionsSkipped: 0,
    recordsSkipped: 0
  };
  const skippedRejections = [];
  const skippedRecords = [];
  let sawEntitySubject = false;
  let maxPageBuffer = 0;
  let failed = null;
  try {
    await sink.write(`${JSON.stringify(header)}
`);
    await sink.write(`${PORTABLE_STREAM.sectionRecords}
`);
    let cursor = null;
    for (; ; ) {
      const page = await iterateIndex(db, {
        storeName: STORE.claims,
        indexName: "updatedAt",
        limit: pageSize,
        cursor
      });
      maxPageBuffer = Math.max(maxPageBuffer, page.items.length);
      for (const claim of page.items) {
        if (!isPortableExportable(claim)) {
          counts.skipped += 1;
          continue;
        }
        if (filter && !filter(claim)) {
          counts.skipped += 1;
          continue;
        }
        if (claim.subjectKind === SUBJECT_KIND.entity && portableEntityRef(claim) == null) {
          counts.skipped += 1;
          counts.recordsSkipped += 1;
          skippedRecords.push({
            reason: RECORD_SKIP_REASON.entityRefUnresolvable,
            valueType: claim.valueType,
            subjectKind: claim.subjectKind
          });
          continue;
        }
        const { record, derived } = await buildPortableRecord(db, claim, { policy });
        if (derived.truncated) counts.lineageTruncated += 1;
        record.originRecordKey = derived.carriedOriginRecordKey ?? await computePortableOriginRecordKey({
          sourceInstallationId: header.sourceInstallationId,
          record,
          lineage: derived.lineage,
          originRecordKeyVersion: meta.originRecordKeyVersion ?? 1
        });
        await sink.write(`${JSON.stringify(record)}
`);
        counts.records += 1;
        if (claim.subjectKind === SUBJECT_KIND.entity) sawEntitySubject = true;
      }
      if (onProgress) await onProgress({ section: "records", ...counts });
      if (page.done) break;
      cursor = page.nextCursor;
    }
    await sink.write(`${PORTABLE_STREAM.sectionEntities}
`);
    if (includeEntities && sawEntitySubject) {
      let ccur = null;
      let lastEmittedSubjectKey = null;
      for (; ; ) {
        const page = await iterateIndex(db, {
          storeName: STORE.claims,
          indexName: "subjectKey",
          limit: pageSize,
          cursor: ccur
        });
        maxPageBuffer = Math.max(maxPageBuffer, page.items.length);
        for (const claim of page.items) {
          if (claim.subjectKind !== SUBJECT_KIND.entity) continue;
          if (!isPortableExportable(claim)) continue;
          if (filter && !filter(claim)) continue;
          if (claim.subjectKey === lastEmittedSubjectKey) continue;
          const ref = portableEntityRef(claim);
          if (!ref) continue;
          const parsed = /^entity:([a-z_]+):(.+)$/.exec(ref);
          if (!parsed) continue;
          const [, target, fmId] = parsed;
          lastEmittedSubjectKey = claim.subjectKey;
          const entityStoreKey = ref.slice("entity:".length);
          const obs = await runRead(db, [STORE.entities], ({ store }) => new Promise((res, rej) => {
            const rq = store(STORE.entities).get(entityStoreKey);
            rq.onsuccess = () => res(rq.result ?? null);
            rq.onerror = () => rej(rq.error);
          })).catch(() => null);
          await sink.write(`${JSON.stringify({
            target,
            fmId,
            originalNameRaw: obs?.currentOriginalName ?? claim.sourceText ?? null,
            countryRaw: obs?.countryRaw ?? null,
            worldRegionRaw: obs?.worldRegionRaw ?? null
          })}
`);
          counts.entities += 1;
        }
        if (page.done) break;
        ccur = page.nextCursor;
      }
    }
    await sink.write(`${PORTABLE_STREAM.sectionRejections}
`);
    if (includeRejections) {
      let rcur = null;
      for (; ; ) {
        const page = await iterateIndex(db, {
          storeName: STORE.rejections,
          indexName: "state",
          query: IDBKeyRange.only("active"),
          limit: pageSize,
          cursor: rcur
        });
        maxPageBuffer = Math.max(maxPageBuffer, page.items.length);
        for (const rej of page.items) {
          if (rej.reason !== REJECTION_REASON.userCorrection) continue;
          if (rej.script != null) {
            counts.rejectionsSkipped += 1;
            skippedRejections.push(diagnoseSkippedRejection(rej, REJECTION_SKIP_REASON.scriptQualified));
            continue;
          }
          const resolved = await resolveRejectionSubject(db, rej, { policy });
          if (!resolved.ok) {
            counts.rejectionsSkipped += 1;
            skippedRejections.push(diagnoseSkippedRejection(rej, resolved.reason));
            continue;
          }
          await sink.write(`${JSON.stringify({
            claimSubject: resolved.subject,
            valueType: rej.valueType,
            rejectedValue: rej.rejectedValue,
            replacementValue: resolved.replacementValue,
            contextConstraints: rej.contextConstraints,
            provenanceLineage: { kind: rej.reason, originInstallationId: meta.installationId },
            originRecordKey: rej.originRecordKey ?? null
          })}
`);
          counts.rejections += 1;
        }
        if (page.done) break;
        rcur = page.nextCursor;
      }
    }
    await sink.write(`${PORTABLE_STREAM.sectionMeta}
`);
    await sink.write(`${JSON.stringify({
      keySchemaVersion: meta.keySchemaVersion ?? KEY_SCHEMA_VERSION,
      sourceNormalizerVersion: meta.sourceNormalizerVersion ?? SOURCE_NORMALIZER_VERSION,
      valueNormalizerVersion: meta.valueNormalizerVersion ?? VALUE_NORMALIZER_VERSION,
      originRecordKeyVersion: meta.originRecordKeyVersion ?? 1,
      portablePolicyVersion: policy.portablePolicyVersion
    })}
`);
    await sink.write(`${PORTABLE_STREAM.sectionEnd}
`);
    await sink.close();
  } catch (e) {
    failed = e;
    try {
      await sink.abort?.();
    } catch {
    }
    throw e;
  } finally {
    if (failed && typeof sink.abort === "function") {
    }
  }
  return {
    header,
    counts,
    skippedRejections,
    skippedRecords,
    bytesWritten: sink.bytesWritten ?? null,
    maxPageBuffer
  };
}
__name(exportPortableToSink, "exportPortableToSink");
function requestOf8(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf8, "requestOf");
async function resolveRejectionSubject(db, rej, { policy = PORTABLE_POLICY } = {}) {
  const limit = policy.rejectionSubjectLookupLimit;
  const page = await iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "claimGroupKey",
    query: IDBKeyRange.only(rej.claimGroupKey),
    limit
  });
  const candidates = page.items.filter((c) => c.valueType === rej.valueType);
  if (!candidates.length) {
    return { ok: false, reason: REJECTION_SKIP_REASON.noClaimForGroup };
  }
  const head = candidates[0];
  const consistent = candidates.every((c) => c.subjectKind === head.subjectKind && c.sourceText === head.sourceText);
  if (!consistent) {
    return { ok: false, reason: REJECTION_SKIP_REASON.ambiguousSubject };
  }
  const subject = { subjectKind: head.subjectKind, sourceText: head.sourceText };
  let replacementValue = null;
  const explicit = rej.replacementClaimId ? candidates.find((c) => c.claimId === rej.replacementClaimId) : null;
  if (explicit) {
    replacementValue = explicit.value ?? null;
  } else {
    const alternatives = candidates.filter((c) => c.deletedAt == null && c.disabled !== true && c.supersededByClaimId == null && c.normalizedValue !== rej.normalizedRejectedValue);
    if (alternatives.length === 1) replacementValue = alternatives[0].value ?? null;
  }
  return { ok: true, via: explicit ? "replacement_claim" : "claim_group_index", subject, replacementValue };
}
__name(resolveRejectionSubject, "resolveRejectionSubject");
function diagnoseSkippedRejection(rej, reason) {
  return {
    reason,
    valueType: rej.valueType,
    rejectionReason: rej.reason,
    claimGroupKey: rej.claimGroupKey ?? null,
    rejectionKey: rej.rejectionKey ?? null,
    hasReplacementClaim: rej.replacementClaimId != null,
    scriptQualified: rej.script != null
  };
}
__name(diagnoseSkippedRejection, "diagnoseSkippedRejection");
var RECORD_ALLOWED = Object.freeze([
  "portableRecordId",
  "subject",
  "claim",
  "verificationSnapshot",
  "provenanceLineage",
  "originRecordKey"
]);
var SUBJECT_ALLOWED = Object.freeze(["subjectKind", "sourceText"]);
var CLAIM_ALLOWED = Object.freeze([
  "valueType",
  "value",
  "script",
  "applicabilityConstraints",
  "sourceNameGuard"
]);
var VERIFICATION_ALLOWED = Object.freeze(["verificationState", "wasLockedAtSource"]);
var LINEAGE_ALLOWED = Object.freeze([
  "originGroups",
  "unknownOriginGroups",
  "hasExplicitUserConfirmation",
  "hasOfficialSupport",
  "lineageDigest"
]);
var ENTITY_ALLOWED = Object.freeze([
  "target",
  "fmId",
  "originalNameRaw",
  "countryRaw",
  "worldRegionRaw"
]);
var REJECTION_ALLOWED = Object.freeze([
  "claimSubject",
  "valueType",
  "rejectedValue",
  "replacementValue",
  "contextConstraints",
  "provenanceLineage",
  "originRecordKey"
]);
var REJECTION_SKIP_REASON = Object.freeze({
  scriptQualified: "script_qualified_rejection_not_representable",
  noClaimForGroup: "subject_unresolvable_no_claim_for_claim_group",
  ambiguousSubject: "subject_unresolvable_ambiguous_claim_group",
  notUserCorrection: "not_a_shareable_user_correction"
});
var RECORD_SKIP_REASON = Object.freeze({
  entityRefUnresolvable: "entity_subject_reference_unresolvable"
});
var PORTABLE_SUBJECT_KINDS = Object.freeze(["lexical", "phrase", "entity"]);
function normalizePortableRecord(raw, { limits = PORTABLE_SAFETY_LIMITS, index = -1 } = {}) {
  const what = `portable record[${index}]`;
  assertNoExecutableFields(raw, { what });
  const { value: rec, unknownKeys } = projectAllowedFields(raw, RECORD_ALLOWED, { what });
  const { value: subject } = projectAllowedFields(
    rec.subject ?? {},
    SUBJECT_ALLOWED,
    { what: `${what}.subject` }
  );
  const subjectKind = requireEnum(what, "subject.subjectKind", subject.subjectKind, PORTABLE_SUBJECT_KINDS);
  const sourceText = requireString(what, "subject.sourceText", subject.sourceText, { limits });
  const { value: claim } = projectAllowedFields(
    rec.claim ?? {},
    CLAIM_ALLOWED,
    { what: `${what}.claim` }
  );
  const valueType = requireEnum(
    what,
    "claim.valueType",
    claim.valueType,
    Object.keys(VALUE_TYPE_POLICIES)
  );
  const script = claim.script == null ? null : requireEnum(what, "claim.script", claim.script, SCRIPT_ENUM);
  if (claim.value === void 0 || claim.value === null) {
    throw new PortableValidationError(`${what}: claim.value is required`, { index });
  }
  if (typeof claim.value === "string" && claim.value.length > limits.maxStringLength) {
    throw new PortableValidationError(`${what}: claim.value too long`, { index });
  }
  if (typeof claim.value === "object") {
    throw new PortableValidationError(`${what}: claim.value must be a scalar`, { index });
  }
  const applicabilityConstraints = normalizeApplicabilityConstraints(claim.applicabilityConstraints);
  for (const side of ["include", "exclude"]) {
    for (const dim of Object.keys(applicabilityConstraints[side])) {
      requireStringArray(
        what,
        `claim.applicabilityConstraints.${side}.${dim}`,
        applicabilityConstraints[side][dim],
        { limits }
      );
    }
  }
  const { value: vs } = projectAllowedFields(
    rec.verificationSnapshot ?? {},
    VERIFICATION_ALLOWED,
    { what: `${what}.verificationSnapshot` }
  );
  const { value: lin } = projectAllowedFields(
    rec.provenanceLineage ?? {},
    LINEAGE_ALLOWED,
    { what: `${what}.provenanceLineage` }
  );
  return {
    portableRecordId: rec.portableRecordId == null ? null : requireSafeIdentifier(what, "portableRecordId", rec.portableRecordId, { limits }),
    subject: { subjectKind, sourceText },
    claim: {
      valueType,
      value: claim.value,
      script,
      applicabilityConstraints,
      // §102.2: sourceNameGuard は semantic hint。Import 側で再構成する。
      sourceNameGuard: claim.sourceNameGuard ?? null
    },
    verificationSnapshot: {
      /**
       * §102.2.2 / §139.5: これは **Export 元の記述** であって Import 先の権限では
       * ない。Import 側でこの値を Local verificationState / locked へ写さない。
       */
      verificationState: typeof vs.verificationState === "string" ? vs.verificationState : "none",
      wasLockedAtSource: requireBoolean(
        what,
        "verificationSnapshot.wasLockedAtSource",
        vs.wasLockedAtSource,
        { fallback: false }
      )
    },
    provenanceLineage: {
      originGroups: requireStringArray(what, "provenanceLineage.originGroups", lin.originGroups, { limits }),
      unknownOriginGroups: requireStringArray(
        what,
        "provenanceLineage.unknownOriginGroups",
        lin.unknownOriginGroups,
        { limits }
      ),
      hasExplicitUserConfirmation: requireBoolean(
        what,
        "provenanceLineage.hasExplicitUserConfirmation",
        lin.hasExplicitUserConfirmation,
        { fallback: false }
      ),
      hasOfficialSupport: requireBoolean(
        what,
        "provenanceLineage.hasOfficialSupport",
        lin.hasOfficialSupport,
        { fallback: false }
      ),
      lineageDigest: typeof lin.lineageDigest === "string" ? lin.lineageDigest : null
    },
    originRecordKey: rec.originRecordKey == null ? null : requireString(what, "originRecordKey", rec.originRecordKey, { limits }),
    unknownKeys
  };
}
__name(normalizePortableRecord, "normalizePortableRecord");
function normalizePortableEntity(raw, { limits = PORTABLE_SAFETY_LIMITS, index = -1 } = {}) {
  const what = `portable entity[${index}]`;
  assertNoExecutableFields(raw, { what });
  const { value: e } = projectAllowedFields(raw, ENTITY_ALLOWED, { what });
  return {
    target: requireString(what, "target", e.target, { limits }),
    // §4.1.1 FM ID は String のまま扱う
    fmId: requireSafeIdentifier(what, "fmId", typeof e.fmId === "number" ? String(e.fmId) : e.fmId, { limits }),
    originalNameRaw: requireString(what, "originalNameRaw", e.originalNameRaw, { limits, allowNull: true }),
    countryRaw: requireString(what, "countryRaw", e.countryRaw, { limits, allowNull: true }),
    worldRegionRaw: requireString(what, "worldRegionRaw", e.worldRegionRaw, { limits, allowNull: true })
  };
}
__name(normalizePortableEntity, "normalizePortableEntity");
function normalizePortableRejection(raw, { limits = PORTABLE_SAFETY_LIMITS, index = -1 } = {}) {
  const what = `portable rejection[${index}]`;
  assertNoExecutableFields(raw, { what });
  const { value: r } = projectAllowedFields(raw, REJECTION_ALLOWED, { what });
  const subj = r.claimSubject ?? {};
  return {
    claimSubject: {
      subjectKind: requireEnum(what, "claimSubject.subjectKind", subj.subjectKind, PORTABLE_SUBJECT_KINDS),
      sourceText: requireString(what, "claimSubject.sourceText", subj.sourceText, { limits })
    },
    valueType: requireEnum(what, "valueType", r.valueType, Object.keys(VALUE_TYPE_POLICIES)),
    // §102.2 の shape に script は無い。**key ごと出さない**ので、normalize の
    // 出力をそのまま normalize の入力へ戻せる（round-trip 安全）。
    // script は Rejection 側では常に null として扱う（下の buildRejectionRecord）。
    rejectedValue: requireString(what, "rejectedValue", r.rejectedValue, { limits }),
    replacementValue: requireString(
      what,
      "replacementValue",
      r.replacementValue,
      { limits, allowNull: true }
    ),
    contextConstraints: normalizeContextConstraints(r.contextConstraints),
    originRecordKey: r.originRecordKey == null ? null : requireString(what, "originRecordKey", r.originRecordKey, { limits })
  };
}
__name(normalizePortableRejection, "normalizePortableRejection");
function portableSourceFromText(text, { limits = PORTABLE_SAFETY_LIMITS } = {}) {
  if (typeof text !== "string") throw new PortableError("portableSourceFromText: expected a string");
  if (text.length > limits.maxBytes) {
    throw new PortableSizeLimitError(
      "portable file exceeds max size",
      { bytes: text.length, maxBytes: limits.maxBytes }
    );
  }
  const lines = text.split("\n");
  let i = 0;
  const nextLine = /* @__PURE__ */ __name(() => {
    while (i < lines.length && lines[i] === "") i += 1;
    return i < lines.length ? lines[i++] : null;
  }, "nextLine");
  const headerLine = nextLine();
  if (headerLine == null) throw new PortableValidationError("portable file: empty");
  const header = safeParseJson(headerLine, { limits, what: "portable header" });
  const sections = { records: [], entities: [], rejections: [] };
  let meta = {};
  let sawEnd = false;
  let current = null;
  for (; ; ) {
    const line = nextLine();
    if (line == null) break;
    if (line.startsWith(PORTABLE_STREAM.marker)) {
      if (line === PORTABLE_STREAM.sectionEnd) {
        sawEnd = true;
        break;
      }
      if (line === PORTABLE_STREAM.sectionRecords) current = "records";
      else if (line === PORTABLE_STREAM.sectionEntities) current = "entities";
      else if (line === PORTABLE_STREAM.sectionRejections) current = "rejections";
      else if (line === PORTABLE_STREAM.sectionMeta) current = "meta";
      else throw new PortableValidationError(`portable file: unknown section ${line}`);
      continue;
    }
    if (current === "meta") {
      meta = safeParseJson(line, { limits, what: "portable meta" });
      continue;
    }
    if (!current) throw new PortableValidationError("portable file: record outside a section");
    if (sections[current].length >= limits.maxRecords) {
      throw new PortableSizeLimitError(
        `portable file: too many ${current}`,
        { max: limits.maxRecords }
      );
    }
    sections[current].push(safeParseJson(line, { limits, what: `portable ${current} record` }));
  }
  if (!sawEnd) {
    throw new PortableValidationError("portable file: missing @end marker (truncated?)");
  }
  return makePortableSource({ header, meta, sections, limits });
}
__name(portableSourceFromText, "portableSourceFromText");
function portableSourceFromObject(obj, { limits = PORTABLE_SAFETY_LIMITS } = {}) {
  if (obj && typeof obj === "object" && typeof obj.format === "string" && obj.format !== PORTABLE_FORMAT) {
    throw new PortableValidationError(
      `portable import: expected format ${PORTABLE_FORMAT}, got ${obj.format}. Full Backup / Dictionary Package files use their own import path (§102).`,
      { got: obj.format }
    );
  }
  assertBoundedShape(obj, { limits, what: "portable object" });
  const header = {
    format: obj?.format,
    version: obj?.version,
    streamVersion: obj?.streamVersion ?? null,
    portableExportId: obj?.portableExportId ?? null,
    createdAt: obj?.createdAt ?? null,
    sourceInstallationId: obj?.sourceInstallationId ?? null
  };
  const sections = {
    records: Array.isArray(obj?.records) ? obj.records : [],
    entities: Array.isArray(obj?.entities) ? obj.entities : [],
    rejections: Array.isArray(obj?.rejections) ? obj.rejections : []
  };
  for (const k of Object.keys(sections)) {
    if (sections[k].length > limits.maxRecords) {
      throw new PortableSizeLimitError(`portable object: too many ${k}`, { max: limits.maxRecords });
    }
  }
  return makePortableSource({ header, meta: obj?.meta ?? {}, sections, limits });
}
__name(portableSourceFromObject, "portableSourceFromObject");
function portableSourceFromJsonText(text, { limits = PORTABLE_SAFETY_LIMITS } = {}) {
  return portableSourceFromObject(safeParseJson(text, { limits, what: "portable file" }), { limits });
}
__name(portableSourceFromJsonText, "portableSourceFromJsonText");
function tagged(fn, index) {
  try {
    return { ok: true, index, value: fn() };
  } catch (e) {
    return {
      ok: false,
      index,
      reason: e instanceof ImportSafetyError ? "rejected_by_import_safety" : "invalid_record",
      message: String(e?.message ?? e)
    };
  }
}
__name(tagged, "tagged");
function makePortableSource({ header, meta, sections, limits }) {
  return {
    header,
    meta,
    counts: {
      records: sections.records.length,
      entities: sections.entities.length,
      rejections: sections.rejections.length
    },
    /**
     * async generator。呼び出し側は chunk 単位で消費する（§106）。
     *
     * **tagged result を yield する**: `{ok:true, index, value}` か
     * `{ok:false, index, reason, message}`。
     *
     * generator が throw すると `for await` の header で例外になり、loop body の
     * try/catch を飛び越えて Import 全体が abort する（= claims/evidence を
     * commit した後に report 無しで終了する）。normalize を generator 内の
     * per-item try で包むことで、1件の不正 record が他の有効 record を
     * 巻き添えにしないことを構造的に保証する（§104 Merge:「修復可能→Remap /
     * 不可能→Quarantine/Skip / Import Report」）。
     */
    async *records() {
      for (let idx = 0; idx < sections.records.length; idx += 1) {
        yield tagged(() => normalizePortableRecord(sections.records[idx], { limits, index: idx }), idx);
      }
    },
    async *entities() {
      for (let idx = 0; idx < sections.entities.length; idx += 1) {
        yield tagged(() => normalizePortableEntity(sections.entities[idx], { limits, index: idx }), idx);
      }
    },
    async *rejections() {
      for (let idx = 0; idx < sections.rejections.length; idx += 1) {
        yield tagged(() => normalizePortableRejection(sections.rejections[idx], { limits, index: idx }), idx);
      }
    }
  };
}
__name(makePortableSource, "makePortableSource");
function assertPortableCompatible(source) {
  const h = source?.header ?? {};
  if (h.format !== PORTABLE_FORMAT) {
    throw new PortableValidationError(
      `portable file: expected format ${PORTABLE_FORMAT} (this is not a Full Backup)`,
      { got: h.format ?? null }
    );
  }
  if (h.version !== PORTABLE_VERSION) {
    throw new PortableValidationError(
      "portable file: unsupported version",
      { got: h.version ?? null, supported: PORTABLE_VERSION }
    );
  }
  return true;
}
__name(assertPortableCompatible, "assertPortableCompatible");
async function resolvePortableSubjectKey(record) {
  const { subjectKind, sourceText } = record.subject;
  if (subjectKind === SUBJECT_KIND.lexical) {
    return lexicalSubjectKey(strictNormalizedSource(sourceText));
  }
  if (subjectKind === SUBJECT_KIND.phrase) {
    return phraseSubjectKey(strictNormalizedSource(sourceText));
  }
  const m = /^entity:([a-z_]+):(.+)$/.exec(sourceText);
  if (!m) {
    throw new PortableValidationError(
      'portable entity record: sourceText must be "entity:<target>:<fmId>" to rebind without local IDs',
      { sourceText }
    );
  }
  return entitySubjectKey(m[1], m[2]);
}
__name(resolvePortableSubjectKey, "resolvePortableSubjectKey");
async function importPortableDictionary(db, sourceLike, {
  mode = PORTABLE_IMPORT_MODE.shared,
  confirm = null,
  chunkSize = PORTABLE_POLICY.importChunkSize,
  limits = PORTABLE_SAFETY_LIMITS,
  actor = "portable_import",
  onProgress = null,
  signal = null,
  now = Date.now()
} = {}) {
  if (!Object.values(PORTABLE_IMPORT_MODE).includes(mode)) {
    throw new PortableError(`importPortableDictionary: unknown mode ${mode}`, { mode });
  }
  if (mode === PORTABLE_IMPORT_MODE.adoptAsManual) {
    const token = typeof confirm === "string" ? confirm : confirm?.acknowledge;
    if (token !== PORTABLE_ADOPT_CONFIRMATION) {
      throw new PortableError(
        `§102.2.2: adopt_as_manual requires an explicit user decision; pass confirm: ${JSON.stringify(PORTABLE_ADOPT_CONFIRMATION)}`,
        { got: token ?? null }
      );
    }
  }
  const source = await normalizePortableSource(sourceLike, { limits });
  assertPortableCompatible(source);
  const meta = await getMeta(db);
  const report = {
    mode,
    importSessionId: newOpaqueId("pimport"),
    sourceInstallationId: source.header.sourceInstallationId ?? null,
    /** §102.5: 別端末の installationId を現在端末 ID としてコピーしない。 */
    localInstallationId: meta.installationId,
    portableExportId: source.header.portableExportId ?? null,
    counts: {
      recordsSeen: 0,
      claimsCreated: 0,
      claimsMerged: 0,
      evidenceCreated: 0,
      evidenceDeduped: 0,
      conflictsCoexisting: 0,
      skipped: 0,
      invalid: 0,
      lockedAtSourceIgnored: 0,
      verifiedAtSourceIgnored: 0,
      entitiesSeen: 0,
      rejectionsImported: 0,
      rejectionsDeduped: 0,
      // §104 Import Report: 不正 record は skip して他を完了させる
      invalidRejections: 0,
      // §102.2 Entity metadata の欠陥（重複 / 矛盾 / 不正参照）
      invalidEntities: 0,
      conflictingEntities: 0,
      /**
       * §102.2 / §38.3 Entity Claim の subject 再構成の内訳。
       *   Carried       … artifact の guard をそのまま採用（原名と整合）
       *   Reconstructed … guard 欠落 → metadata の原名から保守的に再構成
       *   Unresolvable  … guard も原名も無く安全に bind できない → skip
       */
      entityGuardCarried: 0,
      entityGuardReconstructed: 0,
      entitiesUnresolvable: 0,
      /** artifact guard を基準名へ狭めた件数（取り込みはできた = degraded）。 */
      entityGuardNarrowed: 0,
      /** destination の既存 Observation と名前が食い違い再検証が要る件数。 */
      entityNeedsRevalidation: 0,
      /**
       * §102.2 / §114: artifact の guard 自体を **適用条件として拒否**した件数
       * （`id_only` / `unbound_entity_id` / 壊れた guard / cap 超過）。
       * record 自体は metadata から再構成して取り込めることがあるので、
       * `entitiesUnresolvable`（取り込めなかった）とは別軸で数える。
       */
      entityGuardRejected: 0
    },
    problems: [],
    maxChunkBuffer: 0
  };
  const mutationId = newOpaqueId("mut");
  let batch = [];
  const flush = /* @__PURE__ */ __name(async () => {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    report.maxChunkBuffer = Math.max(report.maxChunkBuffer, items.length);
    await runSemanticMutation(
      db,
      [STORE.claims, STORE.history, STORE.evidence],
      async ({ tx }) => {
        for (const item of items) {
          const claimOut = await commitClaimUpsertIn(tx, item.preparedClaim, { actor });
          if (claimOut.created) report.counts.claimsCreated += 1;
          else {
            report.counts.claimsMerged += 1;
            if (item.competing) report.counts.conflictsCoexisting += 1;
          }
          const prepared = item.preparedEvidenceFor(claimOut.claim);
          const evOut = await commitEvidenceIn(tx, prepared);
          if (evOut.created) report.counts.evidenceCreated += 1;
          else report.counts.evidenceDeduped += 1;
        }
      },
      { extraStores: [STORE.cache] }
    );
    if (onProgress) await onProgress({ ...report.counts });
  }, "flush");
  const entityMeta = /* @__PURE__ */ new Map();
  const entityMetaUsed = /* @__PURE__ */ new Set();
  for await (const item of source.entities()) {
    if (!item.ok) {
      report.counts.invalidEntities += 1;
      report.problems.push({
        section: "entities",
        index: item.index,
        kind: item.reason,
        message: item.message
      });
      continue;
    }
    const e = item.value;
    const key = `${e.target}:${e.fmId}`;
    const prev = entityMeta.get(key);
    if (prev) {
      const conflicting = prev.originalNameRaw !== e.originalNameRaw || prev.countryRaw !== e.countryRaw || prev.worldRegionRaw !== e.worldRegionRaw;
      if (conflicting) entityMeta.set(key, null);
      report.counts.conflictingEntities += 1;
      report.problems.push({
        section: "entities",
        index: item.index,
        kind: conflicting ? "conflicting_entity_metadata" : "duplicate_entity_metadata",
        target: e.target,
        fmId: e.fmId
      });
      continue;
    }
    entityMeta.set(key, e);
    report.counts.entitiesSeen += 1;
  }
  let index = -1;
  for await (const item of source.records()) {
    index += 1;
    if (signal?.aborted) throw new PortableError("portable import cancelled", { index });
    report.counts.recordsSeen += 1;
    if (!item.ok) {
      report.counts.invalid += 1;
      report.problems.push({ index: item.index, kind: item.reason, message: item.message });
      continue;
    }
    const rec = item.value;
    if (rec.verificationSnapshot.wasLockedAtSource) report.counts.lockedAtSourceIgnored += 1;
    if (rec.verificationSnapshot.verificationState !== "none") report.counts.verifiedAtSourceIgnored += 1;
    let prep;
    try {
      prep = await preparePortableRecordWrite(db, rec, {
        mode,
        meta,
        mutationId,
        now,
        report,
        entityMeta,
        entityMetaUsed,
        index
      });
    } catch (e) {
      report.counts.invalid += 1;
      report.problems.push({ index, kind: "invalid_record", message: String(e?.message ?? e) });
      continue;
    }
    if (!prep) {
      report.counts.skipped += 1;
      continue;
    }
    batch.push(prep);
    if (batch.length >= chunkSize) await flush();
  }
  await flush();
  for (const [key, e] of entityMeta) {
    if (!e || entityMetaUsed.has(key)) continue;
    report.problems.push({
      section: "entities",
      kind: ENTITY_SUBJECT_REASON.metadataUnreferenced,
      target: e.target,
      fmId: e.fmId
    });
  }
  await importPortableRejections(db, source, { report, mutationId, now, limits });
  return report;
}
__name(importPortableDictionary, "importPortableDictionary");
async function preparePortableRecordWrite(db, rec, {
  mode,
  meta,
  mutationId,
  now,
  report,
  entityMeta = /* @__PURE__ */ new Map(),
  entityMetaUsed = /* @__PURE__ */ new Set(),
  index = -1
}) {
  const subjectKey = await resolvePortableSubjectKey(rec);
  const adopt = mode === PORTABLE_IMPORT_MODE.adoptAsManual;
  let sourceText = rec.subject.sourceText;
  let sourceNameGuard = sanitizePortableSourceNameGuard(rec.claim.sourceNameGuard).guard;
  if (rec.subject.subjectKind === SUBJECT_KIND.entity) {
    const parsed = /^entity:([a-z_]+):(.+)$/.exec(rec.subject.sourceText);
    const key = parsed ? `${parsed[1]}:${parsed[2]}` : null;
    const localObservation = key ? await runRead(db, [STORE.entities], ({ store }) => requestOf8(store(STORE.entities).get(key))) : null;
    const resolved = reconcilePortableEntitySubject({
      ref: rec.subject.sourceText,
      guard: rec.claim.sourceNameGuard,
      meta: key ? entityMeta.get(key) ?? null : null,
      adopt,
      localObservation
    });
    if (!resolved.ok) {
      report.counts.entitiesUnresolvable += 1;
      report.problems.push({
        index,
        kind: resolved.reason,
        subject: rec.subject.sourceText
      });
      return null;
    }
    sourceText = resolved.sourceText;
    sourceNameGuard = resolved.guard;
    if (key) entityMetaUsed.add(key);
    if (resolved.guardSource === "carried") report.counts.entityGuardCarried += 1;
    else if (resolved.guardSource === "narrowed") report.counts.entityGuardNarrowed += 1;
    else report.counts.entityGuardReconstructed += 1;
    if (resolved.needsRevalidation) report.counts.entityNeedsRevalidation += 1;
    if (resolved.guardRejectReason) {
      report.counts.entityGuardRejected += 1;
      report.problems.push({
        index,
        kind: resolved.guardRejectReason,
        subject: rec.subject.sourceText,
        guardRejected: true,
        degraded: true
      });
    }
    if (resolved.reason !== ENTITY_SUBJECT_REASON.guardReconstructed) {
      report.problems.push({
        index,
        kind: resolved.reason,
        subject: rec.subject.sourceText,
        // 非機密な診断のみ（raw name / local ID は出さない）
        ...resolved.narrowedFrom ? { narrowedFromNameCount: resolved.narrowedFrom } : {},
        degraded: resolved.guardSource === "narrowed" || Boolean(resolved.needsRevalidation)
      });
    }
  }
  const preparedClaim = await prepareClaimUpsert({
    subjectKind: rec.subject.subjectKind,
    subjectKey,
    valueType: rec.claim.valueType,
    value: rec.claim.value,
    script: rec.claim.script,
    sourceText,
    applicabilityConstraints: rec.claim.applicabilityConstraints,
    /**
     * §38.3 / §120-18: guard は **制約**であって authority ではない。落とすと
     * 緩くなる（rename 後も適用される）ので、必ず持ち越すか安全に再構成する。
     */
    sourceNameGuard,
    provenance: { createdBy: "portable_import", firstEvidenceRootId: null },
    // §102.2.2: 既定は none / unlocked。Import 元 metadata から昇格させない。
    verificationState: adopt ? VERIFICATION_STATE.manualEntered : VERIFICATION_STATE.none,
    locked: false,
    now
  }, { mutationId, invalidateCache: true });
  const competing = await hasCompetingSemanticClaim(db, preparedClaim.record);
  const originRecordKey2 = rec.originRecordKey ?? await computePortableOriginRecordKey({
    sourceInstallationId: report.sourceInstallationId,
    record: rec,
    lineage: rec.provenanceLineage,
    originRecordKeyVersion: meta.originRecordKeyVersion ?? 1
  });
  const portableOriginGroup = portableOriginGroupFor(rec.provenanceLineage);
  const preparedEvidence = await prepareEvidenceWrite(db, {
    evidenceType: EVIDENCE_TYPE.portableImportSnapshot,
    claimId: preparedClaim.record.claimId,
    claimSemanticKey: preparedClaim.record.semanticKey,
    stance: STANCE.support,
    valueType: rec.claim.valueType,
    originRecordKey: originRecordKey2,
    /** §102.5: 元端末を残す。現在端末 ID で上書きしない。 */
    originInstallationId: report.sourceInstallationId,
    portableOriginGroup,
    /** §102.2: 元 lineage を落とさない（再 Export で carry-forward する）。 */
    importedProvenanceLineage: rec.provenanceLineage,
    now
  }, { claimRecordForCache: preparedClaim.record });
  return {
    preparedClaim,
    competing,
    /** commit 済み Claim（新規 or 合流先）へ Evidence の claimId を束ね直す。 */
    preparedEvidenceFor: /* @__PURE__ */ __name((claim) => ({
      ...preparedEvidence,
      record: { ...preparedEvidence.record, claimId: claim.claimId }
    }), "preparedEvidenceFor")
  };
}
__name(preparePortableRecordWrite, "preparePortableRecordWrite");
async function hasCompetingSemanticClaim(db, record) {
  const page = await iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "subjectKey_valueType",
    query: IDBKeyRange.only([record.subjectKey, record.valueType]),
    limit: 25
  });
  return page.items.some((c) => c.normalizedValue !== record.normalizedValue && c.deletedAt == null && c.disabled !== true);
}
__name(hasCompetingSemanticClaim, "hasCompetingSemanticClaim");
async function importPortableRejections(db, source, { report, mutationId, now }) {
  for await (const item of source.rejections()) {
    if (!item.ok) {
      report.counts.invalidRejections += 1;
      report.problems.push({
        section: "rejections",
        index: item.index,
        kind: item.reason,
        message: item.message
      });
      continue;
    }
    const r = item.value;
    let prepared;
    try {
      const subjectKey = await resolvePortableSubjectKey({ subject: r.claimSubject });
      const groupKey = await claimGroupKey({
        subjectKind: r.claimSubject.subjectKind,
        subjectKey,
        valueType: r.valueType,
        script: null
      });
      prepared = await buildRejectionRecord({
        claimGroupKey: groupKey,
        valueType: r.valueType,
        // §102.2 Portable Rejection は script 修飾を運ばない（export 側で skip 済み）
        script: null,
        rejectedValue: r.rejectedValue,
        contextConstraints: r.contextConstraints,
        // §102.2: Local User Correction と同じ Lock 強度へ昇格させない
        reason: REJECTION_REASON.portableImport,
        replacementClaimId: null,
        sourceEvidenceId: null,
        originRecordKey: r.originRecordKey,
        now
      });
    } catch (e) {
      report.counts.invalidRejections += 1;
      report.problems.push({
        section: "rejections",
        index: item.index,
        kind: "invalid_rejection",
        message: String(e?.message ?? e)
      });
      continue;
    }
    await runSemanticMutation(db, [STORE.rejections], async ({ tx }) => {
      const out = await upsertRejectionByKey(tx, {
        rejectionKey: prepared.rejectionKey,
        build: /* @__PURE__ */ __name(() => prepared, "build")
      });
      if (out.created) report.counts.rejectionsImported += 1;
      else report.counts.rejectionsDeduped += 1;
    });
  }
  void mutationId;
}
__name(importPortableRejections, "importPortableRejections");
async function normalizePortableSource(sourceLike, { limits }) {
  if (sourceLike && typeof sourceLike.records === "function" && sourceLike.header) return sourceLike;
  if (typeof sourceLike === "string") {
    const firstLine = sourceLike.slice(0, Math.min(sourceLike.length, limits.maxStringLength)).split("\n", 1)[0];
    if (firstLine) {
      let peeked = null;
      try {
        peeked = JSON.parse(firstLine);
      } catch {
        peeked = null;
      }
      if (peeked && typeof peeked === "object" && typeof peeked.format === "string" && peeked.format !== PORTABLE_FORMAT) {
        throw new PortableValidationError(
          `portable import: expected format ${PORTABLE_FORMAT}, got ${peeked.format}. Full Backup / Dictionary Package files use their own import path (§102).`,
          { got: peeked.format }
        );
      }
    }
    try {
      return portableSourceFromText(sourceLike, { limits });
    } catch (e) {
      if (e instanceof PortableSizeLimitError) throw e;
      return portableSourceFromJsonText(sourceLike, { limits });
    }
  }
  if (sourceLike && typeof sourceLike === "object") return portableSourceFromObject(sourceLike, { limits });
  throw new PortableError("importPortableDictionary: unsupported source");
}
__name(normalizePortableSource, "normalizePortableSource");

// dictionary-package.js
var PACKAGE_FORMAT = "FMlncGenDictionaryPackage";
var PACKAGE_FORMAT_VERSION = 1;
var PACKAGE_MANIFEST_VERSION = 1;
var PACKAGE_STATE = Object.freeze({
  installing: "installing",
  staged: "staged",
  active: "active",
  disabled: "disabled",
  broken: "broken",
  quarantined: "quarantined"
});
var PACKAGE_TRUST_MODE = Object.freeze({
  normal: "normal",
  preferred: "preferred",
  lowPriority: "low_priority"
});
var PUBLISHER_CLASS = Object.freeze({
  communityUnverified: "community_unverified"
});
var SIGNATURE_STATUS = Object.freeze({
  notPresent: "not_present",
  /** 予約値。V1 ではここへ昇格しない（§102.3.15「署名あり != Claim Truth」）。 */
  valid: "valid",
  invalid: "invalid",
  unsupported: "unsupported",
  /** 署名は在るが V1 では検証していない。official/trusted へ昇格させない。 */
  unverified: "unverified"
});
var INTEGRITY_STATUS = Object.freeze({
  /** declared と computed が一致 */
  verified: "verified",
  /** Envelope が hash を宣言していない（§102.3.1 上 null は許容） */
  notDeclared: "not_declared",
  manifestMismatch: "manifest_hash_mismatch",
  contentMismatch: "content_hash_mismatch",
  bothMismatch: "manifest_and_content_hash_mismatch",
  /** Envelope が未知の hash algorithm を宣言した（= 照合を迂回させない）。 */
  unsupportedAlgorithm: "unsupported_hash_algorithm"
});
var DUPLICATE_RECORD_ID_REASON = "duplicate_package_record_id";
var MANIFEST_HASH_ALGO = "sha256-canonical-v1";
var CONTENT_HASH_ALGO = "sha256-sum256-v2";
var SUPPORTED_MANIFEST_HASH_ALGOS = Object.freeze([MANIFEST_HASH_ALGO]);
var SUPPORTED_CONTENT_HASH_ALGOS = Object.freeze([CONTENT_HASH_ALGO]);
var RESERVED_SIGNATURE_SCHEMES = Object.freeze(["ed25519"]);
var SUPPORTED_CAPABILITIES = Object.freeze([
  "claims_v1",
  "entities_v1",
  "native_mapping_v1"
]);
var PACKAGE_SUBJECT_KINDS = Object.freeze(["lexical", "phrase", "entity"]);
var ATTESTATION_KIND = Object.freeze({
  packageCurated: "package_curated",
  packageImported: "package_imported",
  packageDerived: "package_derived"
});
var ATTESTATION_KINDS = Object.freeze(Object.values(ATTESTATION_KIND));
var SNAPSHOT_COMPATIBILITY = Object.freeze({
  /** Entity Identity 一致 + Source Name exact → 通常候補として利用 */
  exact: "exact",
  /** Entity Identity 一致 + safe structural/minor difference → 利用可能 */
  minorChange: "minor_change",
  /** Entity Identity 一致 + 大きな名称差 → blind 確定しない / needs_revalidation */
  renameSuspected: "rename_suspected",
  /** Entity Identity 不一致 + 名前だけ一致 → Entity Claim として bind しない */
  identityMismatch: "identity_mismatch",
  /** Snapshot 無し / Current 観測が無い → 判定材料が無い（推測しない） */
  unknown: "unknown"
});
var PACKAGE_POLICY = Object.freeze({
  packagePolicyVersion: 1,
  /** §106: 1 chunk = 1 transaction。巨大 Package を1 transaction にしない。 */
  importChunkSize: 200,
  /** §107.3 bounded collection read の page。 */
  pageSize: 200,
  /** activation / quarantine 解除の bounded page。 */
  activationPageSize: 500,
  /** §98 activation の Maintenance Lease TTL / renew 間隔。 */
  activationLeaseTtlMs: 12e4,
  leaseRenewEveryChunks: 1,
  /** Blob fallback 上限（Package Export）。 */
  blobFallbackMaxBytes: 128 * 1024 * 1024,
  /**
   * §107 bounded hashing: content hash は 1 record ずつ digest して加算 fold する。
   * 一度に保持するのは accumulator（32 byte）と 1 record 分だけ。
   */
  hashRecordPageSize: 200,
  /** Dry-run で列挙する conflict / problem の上限（UI を固めない）。 */
  maxReportedProblems: 500,
  maxReportedConflicts: 200
});
var PACKAGE_SAFETY_LIMITS = Object.freeze({
  ...IMPORT_SAFETY_LIMITS,
  maxRecords: 5e5,
  maxDepth: 16,
  maxArrayLength: 256
});
var PACKAGE_PURGE_CONFIRMATION = "PURGE-PACKAGE-EVIDENCE";
var PACKAGE_IDENTITY_OVERRIDE_CONFIRMATION = "ACCEPT-DIFFERENT-PACKAGE-IDENTITY";
var PACKAGE_MARKER_META_KEY = "maintenancePackageInstall";
var PACKAGE_PHASE = Object.freeze({
  parsing: "parsing",
  validating: "validating",
  staging: "staging",
  staged: "staged",
  activating: "activating",
  completed: "completed"
});
var PackageError = class extends Error {
  static {
    __name(this, "PackageError");
  }
  constructor(message, details) {
    super(message);
    this.name = "PackageError";
    this.details = details;
  }
};
var PackageValidationError = class extends PackageError {
  static {
    __name(this, "PackageValidationError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PackageValidationError";
  }
};
var PackageSecurityError = class extends PackageError {
  static {
    __name(this, "PackageSecurityError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PackageSecurityError";
  }
};
var PackageIdentityError = class extends PackageError {
  static {
    __name(this, "PackageIdentityError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PackageIdentityError";
  }
};
var PackageConflictError = class extends PackageError {
  static {
    __name(this, "PackageConflictError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PackageConflictError";
  }
};
var PackageIntegrityError = class extends PackageError {
  static {
    __name(this, "PackageIntegrityError");
  }
  constructor(message, details) {
    super(message, details);
    this.name = "PackageIntegrityError";
  }
};
function packageKeyFor(packageId) {
  return `package:${packageId}`;
}
__name(packageKeyFor, "packageKeyFor");
function packageOriginRecordKey(packageId, packageRecordId) {
  return `package:${packageId}:record:${packageRecordId}`;
}
__name(packageOriginRecordKey, "packageOriginRecordKey");
var ENVELOPE_ALLOWED = Object.freeze([
  "format",
  "formatVersion",
  "manifestVersion",
  "package",
  "records",
  "entities",
  "manifestHash",
  "contentHash",
  "signature",
  // §102.3.15: hash algorithm を明示できるようにする（未知値は fail closed）。
  "manifestHashAlgo",
  "contentHashAlgo"
]);
var MANIFEST_ALLOWED = Object.freeze([
  "packageId",
  "name",
  "version",
  "author",
  "publisherId",
  "license",
  "homepage",
  "attribution",
  "authorNote",
  "minDictionarySchemaVersion",
  "requiredCapabilities",
  "optionalCapabilities"
]);
var PKG_RECORD_ALLOWED = Object.freeze([
  "packageRecordId",
  "subject",
  "claim",
  "attestation",
  "sourceSnapshot"
]);
var PKG_SUBJECT_ALLOWED = Object.freeze(["subjectKind", "sourceText"]);
var PKG_CLAIM_ALLOWED = Object.freeze([
  "valueType",
  "value",
  "script",
  "applicabilityConstraints"
]);
var PKG_ATTESTATION_ALLOWED = Object.freeze(["kind", "note"]);
var PKG_SNAPSHOT_ALLOWED = Object.freeze([
  "target",
  "entityIdentity",
  "originalName",
  "normalizedName",
  "countryCode",
  "worldRegionCode",
  "sourceAdapterVersion",
  "sourceSchemaVersion"
]);
var PKG_SIGNATURE_ALLOWED = Object.freeze([
  "scheme",
  "keyId",
  "value",
  "signedManifestHash",
  "signedContentHash"
]);
function normalizePackageManifest(raw, { limits = PACKAGE_SAFETY_LIMITS } = {}) {
  const what = "package manifest";
  assertNoExecutableFields(raw, { what });
  const { value: m, unknownKeys } = projectAllowedFields(raw, MANIFEST_ALLOWED, { what });
  const packageId = requireSafeIdentifier(what, "packageId", m.packageId, { limits });
  const version = requireVersionString(what, "version", m.version);
  const requiredCapabilities = requireStringArray(
    what,
    "requiredCapabilities",
    m.requiredCapabilities,
    { limits }
  );
  const optionalCapabilities = requireStringArray(
    what,
    "optionalCapabilities",
    m.optionalCapabilities,
    { limits }
  );
  const minSchema = m.minDictionarySchemaVersion ?? 1;
  if (!Number.isInteger(minSchema) || minSchema < 1 || minSchema > 1e3) {
    throw new PackageValidationError(
      `${what}: minDictionarySchemaVersion must be a small integer`,
      { got: m.minDictionarySchemaVersion }
    );
  }
  return {
    packageId,
    name: requireString(what, "name", m.name, { limits, allowNull: true }) ?? packageId,
    version,
    author: requireString(what, "author", m.author, { limits, allowNull: true }),
    publisherId: requireString(what, "publisherId", m.publisherId, { limits, allowNull: true }),
    license: requireString(what, "license", m.license, { limits, allowNull: true }),
    /**
     * §102.3.10:「自動外部 URL fetch」禁止。homepage は **表示専用の文字列**として
     * 保持するだけで、この engine は決して fetch しない（§114 URL / Official Source）。
     */
    homepage: requireString(what, "homepage", m.homepage, { limits, allowNull: true }),
    attribution: requireString(what, "attribution", m.attribution, { limits, allowNull: true }),
    /**
     * §102.3.16:「authorNote: "FM27で作成" のような任意文字列を保持してよい。
     *  ただし Resolver はそれを互換判定の Hard Rule に使わない」。
     */
    authorNote: requireString(what, "authorNote", m.authorNote, { limits, allowNull: true }),
    minDictionarySchemaVersion: minSchema,
    requiredCapabilities,
    optionalCapabilities,
    unknownKeys
  };
}
__name(normalizePackageManifest, "normalizePackageManifest");
function normalizePackageSignature(raw, { limits = PACKAGE_SAFETY_LIMITS } = {}) {
  if (raw == null) return { signature: null, signatureStatus: SIGNATURE_STATUS.notPresent };
  const what = "package signature";
  assertNoExecutableFields(raw, { what });
  const { value: s } = projectAllowedFields(raw, PKG_SIGNATURE_ALLOWED, { what });
  const scheme = requireString(what, "scheme", s.scheme, { limits });
  return {
    signature: {
      scheme,
      keyId: requireString(what, "keyId", s.keyId, { limits, allowNull: true }),
      value: requireString(what, "value", s.value, { limits, allowNull: true }),
      signedManifestHash: requireString(
        what,
        "signedManifestHash",
        s.signedManifestHash,
        { limits, allowNull: true }
      ),
      signedContentHash: requireString(
        what,
        "signedContentHash",
        s.signedContentHash,
        { limits, allowNull: true }
      )
    },
    /**
     * §102.3.15 固定 Invariant:
     *   「Hash一致だけ != official / verified / local manual」
     *   「署名あり != Package内Claimが絶対正しい」
     * V1 は検証そのものを実装しないので、既知 scheme でも `unsupported` を返す。
     * **`valid` を返す経路をこの Phase では持たない**（自己申告で verified にしない）。
     */
    signatureStatus: RESERVED_SIGNATURE_SCHEMES.includes(scheme) ? SIGNATURE_STATUS.unsupported : SIGNATURE_STATUS.unsupported
  };
}
__name(normalizePackageSignature, "normalizePackageSignature");
function normalizePackageRecord(raw, { limits = PACKAGE_SAFETY_LIMITS, index = -1 } = {}) {
  const what = `package record[${index}]`;
  assertNoExecutableFields(raw, { what });
  const { value: rec, unknownKeys } = projectAllowedFields(raw, PKG_RECORD_ALLOWED, { what });
  const packageRecordId = requireSafeIdentifier(what, "packageRecordId", rec.packageRecordId, { limits });
  const { value: subject } = projectAllowedFields(
    rec.subject ?? {},
    PKG_SUBJECT_ALLOWED,
    { what: `${what}.subject` }
  );
  const subjectKind = requireEnum(what, "subject.subjectKind", subject.subjectKind, PACKAGE_SUBJECT_KINDS);
  const sourceText = requireString(what, "subject.sourceText", subject.sourceText, { limits });
  const { value: claim } = projectAllowedFields(
    rec.claim ?? {},
    PKG_CLAIM_ALLOWED,
    { what: `${what}.claim` }
  );
  const valueType = requireEnum(what, "claim.valueType", claim.valueType, Object.keys(VALUE_TYPE_POLICIES));
  const script = claim.script == null ? null : requireEnum(what, "claim.script", claim.script, SCRIPT_ENUM);
  if (claim.value === void 0 || claim.value === null) {
    throw new PackageValidationError(`${what}: claim.value is required`, { index });
  }
  if (typeof claim.value === "object") {
    throw new PackageValidationError(`${what}: claim.value must be a scalar`, { index });
  }
  const applicabilityConstraints = normalizeApplicabilityConstraints(claim.applicabilityConstraints);
  for (const side of ["include", "exclude"]) {
    for (const dim of Object.keys(applicabilityConstraints[side])) {
      requireStringArray(
        what,
        `claim.applicabilityConstraints.${side}.${dim}`,
        applicabilityConstraints[side][dim],
        { limits }
      );
    }
  }
  const { value: att } = projectAllowedFields(
    rec.attestation ?? {},
    PKG_ATTESTATION_ALLOWED,
    { what: `${what}.attestation` }
  );
  const attestationKind = att.kind == null ? ATTESTATION_KIND.packageCurated : requireEnum(what, "attestation.kind", att.kind, ATTESTATION_KINDS);
  let sourceSnapshot = null;
  if (rec.sourceSnapshot != null) {
    const { value: sn } = projectAllowedFields(
      rec.sourceSnapshot,
      PKG_SNAPSHOT_ALLOWED,
      { what: `${what}.sourceSnapshot` }
    );
    const ident = sn.entityIdentity ?? {};
    sourceSnapshot = {
      target: requireString(what, "sourceSnapshot.target", sn.target, { limits, allowNull: true }),
      entityIdentity: ident.value == null ? null : {
        namespace: requireString(
          what,
          "sourceSnapshot.entityIdentity.namespace",
          ident.namespace ?? "fm",
          { limits }
        ),
        // §4.1.1 FM ID は String のまま
        value: requireSafeIdentifier(
          what,
          "sourceSnapshot.entityIdentity.value",
          typeof ident.value === "number" ? String(ident.value) : ident.value,
          { limits }
        )
      },
      originalName: requireString(
        what,
        "sourceSnapshot.originalName",
        sn.originalName,
        { limits, allowNull: true }
      ),
      normalizedName: requireString(
        what,
        "sourceSnapshot.normalizedName",
        sn.normalizedName,
        { limits, allowNull: true }
      ),
      countryCode: requireString(
        what,
        "sourceSnapshot.countryCode",
        sn.countryCode,
        { limits, allowNull: true }
      ),
      worldRegionCode: requireString(
        what,
        "sourceSnapshot.worldRegionCode",
        sn.worldRegionCode,
        { limits, allowNull: true }
      ),
      sourceAdapterVersion: Number.isInteger(sn.sourceAdapterVersion) ? sn.sourceAdapterVersion : null,
      sourceSchemaVersion: Number.isInteger(sn.sourceSchemaVersion) ? sn.sourceSchemaVersion : null
    };
  }
  return {
    packageRecordId,
    subject: { subjectKind, sourceText },
    claim: { valueType, value: claim.value, script, applicabilityConstraints },
    /**
     * §102.3.2 / §139.15:「Pack 作者が『確認済み』と書いていても、それを
     *  Local User Confirmation へ変換しない。必要なら package_attestation の
     *  metadata として保存する」。verified/locked/official 相当の field は
     *  allowlist に **存在しない**ので、そもそも読み込まれない。
     */
    attestation: {
      kind: attestationKind,
      note: requireString(what, "attestation.note", att.note, { limits, allowNull: true })
    },
    sourceSnapshot,
    unknownKeys
  };
}
__name(normalizePackageRecord, "normalizePackageRecord");
function packageSourceFromObject(obj, { limits = PACKAGE_SAFETY_LIMITS } = {}) {
  assertBoundedShape(obj, { limits, what: "package file" });
  const { value: env } = projectAllowedFields(obj ?? {}, ENVELOPE_ALLOWED, { what: "package file" });
  if (env.format !== PACKAGE_FORMAT) {
    throw new PackageValidationError(
      `package file: expected format ${PACKAGE_FORMAT} (a Full Backup or Portable Dictionary is not a Package)`,
      { got: env.format ?? null }
    );
  }
  if (env.formatVersion !== PACKAGE_FORMAT_VERSION) {
    throw new PackageValidationError(
      "package file: unsupported formatVersion",
      { got: env.formatVersion ?? null, supported: PACKAGE_FORMAT_VERSION }
    );
  }
  if (env.manifestVersion !== PACKAGE_MANIFEST_VERSION) {
    throw new PackageValidationError(
      "package file: unsupported manifestVersion",
      { got: env.manifestVersion ?? null, supported: PACKAGE_MANIFEST_VERSION }
    );
  }
  const manifest = normalizePackageManifest(env.package ?? {}, { limits });
  const sig = normalizePackageSignature(env.signature ?? null, { limits });
  const records = Array.isArray(env.records) ? env.records : [];
  const entities = Array.isArray(env.entities) ? env.entities : [];
  if (records.length > limits.maxRecords) {
    throw new PackageValidationError(
      "package file: too many records",
      { count: records.length, max: limits.maxRecords }
    );
  }
  return {
    manifest,
    /**
     * §102.3.15:「manifestHash / contentHash = Integrity」。
     * **Publisher Authenticity の証明ではない**（§139.18: checksum だけで
     * Authenticity 判定しない）。
     */
    manifestHash: typeof env.manifestHash === "string" ? env.manifestHash : null,
    contentHash: typeof env.contentHash === "string" ? env.contentHash : null,
    manifestHashAlgo: typeof env.manifestHashAlgo === "string" ? env.manifestHashAlgo : null,
    contentHashAlgo: typeof env.contentHashAlgo === "string" ? env.contentHashAlgo : null,
    signature: sig.signature,
    signatureStatus: sig.signatureStatus,
    counts: { records: records.length, entities: entities.length },
    /**
     * tagged result（`{ok:true,index,value}` / `{ok:false,index,reason,message}`）
     * を yield する。generator 内で throw すると `for await` の header で例外に
     * なり、呼び出し側の per-record try/catch を飛び越えて処理全体が abort する。
     */
    async *records() {
      for (let i = 0; i < records.length; i += 1) {
        yield taggedPackageRecord(records[i], { limits, index: i });
      }
    },
    async *entityRecords() {
      for (let i = 0; i < entities.length; i += 1) {
        yield taggedPackageRecord(entities[i], { limits, index: i });
      }
    }
  };
}
__name(packageSourceFromObject, "packageSourceFromObject");
function taggedPackageRecord(raw, { limits, index }) {
  try {
    return { ok: true, index, value: normalizePackageRecord(raw, { limits, index }) };
  } catch (e) {
    return {
      ok: false,
      index,
      reason: e instanceof ImportSafetyError ? "rejected_by_import_safety" : "invalid_record",
      message: String(e?.message ?? e)
    };
  }
}
__name(taggedPackageRecord, "taggedPackageRecord");
function packageSourceFromText(text, { limits = PACKAGE_SAFETY_LIMITS } = {}) {
  return packageSourceFromObject(safeParseJson(text, { limits, what: "package file" }), { limits });
}
__name(packageSourceFromText, "packageSourceFromText");
async function normalizePackageSource(sourceLike, { limits = PACKAGE_SAFETY_LIMITS } = {}) {
  if (sourceLike && typeof sourceLike.records === "function" && sourceLike.manifest) return sourceLike;
  if (typeof sourceLike === "string") return packageSourceFromText(sourceLike, { limits });
  if (sourceLike && typeof sourceLike === "object") return packageSourceFromObject(sourceLike, { limits });
  throw new PackageError("package source must be a JSON string, an envelope object, or a parsed source");
}
__name(normalizePackageSource, "normalizePackageSource");
function validatePackageCapabilities(manifest, { supported = SUPPORTED_CAPABILITIES } = {}) {
  const unknownRequired = manifest.requiredCapabilities.filter((c) => !supported.includes(c));
  const unknownOptional = manifest.optionalCapabilities.filter((c) => !supported.includes(c));
  return {
    ok: unknownRequired.length === 0,
    unknownRequired,
    /** §102.3.10: optional は「明示 drop」。実行可能機能へ解釈しない。 */
    droppedOptional: unknownOptional,
    supported
  };
}
__name(validatePackageCapabilities, "validatePackageCapabilities");
var B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlToBytes(text) {
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64URL_ALPHABET.indexOf(ch);
    if (v < 0) continue;
    buffer = buffer << 6 | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(buffer >> bits & 255);
    }
  }
  return out;
}
__name(base64UrlToBytes, "base64UrlToBytes");
function createContentDigestAccumulator() {
  const acc = new Array(32).fill(0);
  let count = 0;
  return {
    add(digestBase64Url) {
      const bytes = base64UrlToBytes(digestBase64Url);
      let carry = 0;
      for (let i = acc.length - 1; i >= 0; i -= 1) {
        const sum = acc[i] + (bytes[i] ?? 0) + carry;
        acc[i] = sum & 255;
        carry = sum >>> 8;
      }
      count += 1;
    },
    get count() {
      return count;
    },
    hex() {
      return acc.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  };
}
__name(createContentDigestAccumulator, "createContentDigestAccumulator");
function canonicalManifestProjection(manifest, { formatVersion, manifestVersion }) {
  return {
    schema: "package-manifest",
    algo: MANIFEST_HASH_ALGO,
    formatVersion,
    manifestVersion,
    packageId: manifest.packageId,
    name: manifest.name ?? null,
    version: manifest.version,
    author: manifest.author ?? null,
    publisherId: manifest.publisherId ?? null,
    license: manifest.license ?? null,
    attribution: manifest.attribution ?? null,
    homepage: manifest.homepage ?? null,
    authorNote: manifest.authorNote ?? null,
    minDictionarySchemaVersion: manifest.minDictionarySchemaVersion,
    // capability は順序非依存の集合として扱う
    requiredCapabilities: [...manifest.requiredCapabilities].sort(),
    optionalCapabilities: [...manifest.optionalCapabilities].sort()
  };
}
__name(canonicalManifestProjection, "canonicalManifestProjection");
function canonicalRecordProjection(rec) {
  return {
    schema: "package-record",
    packageRecordId: rec.packageRecordId,
    subject: { subjectKind: rec.subject.subjectKind, sourceText: rec.subject.sourceText },
    claim: {
      valueType: rec.claim.valueType,
      value: rec.claim.value,
      script: rec.claim.script ?? null,
      applicabilityConstraints: normalizeApplicabilityConstraints(rec.claim.applicabilityConstraints)
    },
    attestation: {
      kind: rec.attestation?.kind ?? null,
      note: rec.attestation?.note ?? null
    },
    sourceSnapshot: rec.sourceSnapshot ?? null
  };
}
__name(canonicalRecordProjection, "canonicalRecordProjection");
async function packageRecordDigest(rec) {
  return stableHash(canonicalRecordProjection(rec));
}
__name(packageRecordDigest, "packageRecordDigest");
async function computePackageContentHash(source, { policy = PACKAGE_POLICY } = {}) {
  const recordAcc = createContentDigestAccumulator();
  const entityAcc = createContentDigestAccumulator();
  const problems = [];
  const seenIds = /* @__PURE__ */ new Set();
  const duplicateRecordIds = [];
  const noteId = /* @__PURE__ */ __name((section, item) => {
    const id = item.value.packageRecordId;
    if (seenIds.has(id)) {
      if (duplicateRecordIds.length < policy.maxReportedProblems) {
        duplicateRecordIds.push({ section, index: item.index, packageRecordId: id });
      }
      return;
    }
    seenIds.add(id);
  }, "noteId");
  for await (const item of source.records()) {
    if (!item.ok) {
      problems.push({ section: "records", index: item.index, message: item.message });
      continue;
    }
    noteId("records", item);
    recordAcc.add(await packageRecordDigest(item.value));
  }
  for await (const item of source.entityRecords()) {
    if (!item.ok) {
      problems.push({ section: "entities", index: item.index, message: item.message });
      continue;
    }
    noteId("entities", item);
    entityAcc.add(await packageRecordDigest(item.value));
  }
  const hash = await stableHash({
    schema: "package-content",
    algo: CONTENT_HASH_ALGO,
    recordCount: recordAcc.count,
    entityCount: entityAcc.count,
    // §102.3.15 domain separation: records と entities を別 accumulator + 別ラベルで
    // 覆う（section 入替えを検出できる）。
    recordsDigestSum: recordAcc.hex(),
    entitiesDigestSum: entityAcc.hex()
  });
  return {
    hash,
    recordCount: recordAcc.count,
    entityCount: entityAcc.count,
    problems,
    duplicateRecordIds
  };
}
__name(computePackageContentHash, "computePackageContentHash");
async function computePackageManifestHash(source) {
  return stableHash(canonicalManifestProjection(source.manifest, {
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifestVersion: PACKAGE_MANIFEST_VERSION
  }));
}
__name(computePackageManifestHash, "computePackageManifestHash");
async function verifyPackageIntegrity(source, { policy = PACKAGE_POLICY } = {}) {
  const computedManifestHash = await computePackageManifestHash(source);
  const content = await computePackageContentHash(source, { policy });
  const declaredManifestHash = source.manifestHash ?? null;
  const declaredContentHash = source.contentHash ?? null;
  const declaredManifestAlgo = source.manifestHashAlgo ?? null;
  const declaredContentAlgo = source.contentHashAlgo ?? null;
  const algoUnsupported = declaredManifestAlgo != null && !SUPPORTED_MANIFEST_HASH_ALGOS.includes(declaredManifestAlgo) || declaredContentAlgo != null && !SUPPORTED_CONTENT_HASH_ALGOS.includes(declaredContentAlgo);
  const manifestDeclared = declaredManifestHash != null;
  const contentDeclared = declaredContentHash != null;
  const manifestMatch = manifestDeclared ? declaredManifestHash === computedManifestHash : null;
  const contentMatch = contentDeclared ? declaredContentHash === content.hash : null;
  let status;
  if (algoUnsupported) status = INTEGRITY_STATUS.unsupportedAlgorithm;
  else if (!manifestDeclared && !contentDeclared) status = INTEGRITY_STATUS.notDeclared;
  else if (manifestMatch === false && contentMatch === false) status = INTEGRITY_STATUS.bothMismatch;
  else if (manifestMatch === false) status = INTEGRITY_STATUS.manifestMismatch;
  else if (contentMatch === false) status = INTEGRITY_STATUS.contentMismatch;
  else status = INTEGRITY_STATUS.verified;
  return {
    status,
    ok: (status === INTEGRITY_STATUS.verified || status === INTEGRITY_STATUS.notDeclared) && content.duplicateRecordIds.length === 0,
    duplicateRecordIds: content.duplicateRecordIds,
    declaredManifestHashAlgo: declaredManifestAlgo,
    declaredContentHashAlgo: declaredContentAlgo,
    manifestHashAlgo: MANIFEST_HASH_ALGO,
    contentHashAlgo: CONTENT_HASH_ALGO,
    declaredManifestHash,
    declaredContentHash,
    computedManifestHash,
    computedContentHash: content.hash,
    manifestMatch,
    contentMatch,
    recordCount: content.recordCount,
    entityCount: content.entityCount,
    /**
     * §102.3.15「Hash 一致だけ != official / verified / local manual」。
     * 照合が通っても Truth へは一切影響しないことを Trace で明示する。
     */
    grantsAuthority: false,
    problems: content.problems
  };
}
__name(verifyPackageIntegrity, "verifyPackageIntegrity");
function evaluatePackageSignature(signature, integrity) {
  if (signature == null) {
    return { signatureStatus: SIGNATURE_STATUS.notPresent, signatureReason: null, grantsAuthority: false };
  }
  const scheme = signature.scheme;
  if (typeof scheme !== "string" || !scheme) {
    return { signatureStatus: SIGNATURE_STATUS.invalid, signatureReason: "missing_scheme", grantsAuthority: false };
  }
  if (signature.signedManifestHash != null && signature.signedManifestHash !== integrity.computedManifestHash) {
    return { signatureStatus: SIGNATURE_STATUS.invalid, signatureReason: "signed_manifest_hash_mismatch", grantsAuthority: false };
  }
  if (signature.signedContentHash != null && signature.signedContentHash !== integrity.computedContentHash) {
    return { signatureStatus: SIGNATURE_STATUS.invalid, signatureReason: "signed_content_hash_mismatch", grantsAuthority: false };
  }
  return {
    signatureStatus: SIGNATURE_STATUS.unverified,
    signatureReason: RESERVED_SIGNATURE_SCHEMES.includes(scheme) ? "reserved_scheme_not_verified_in_v1" : "unknown_scheme_not_executed",
    grantsAuthority: false
  };
}
__name(evaluatePackageSignature, "evaluatePackageSignature");
async function computePackageIdentityFingerprint(source) {
  const m = source.manifest;
  return stableHash({
    schema: "package-identity",
    version: 1,
    packageId: m.packageId,
    /**
     * §3.1:「displayName / authorDisplayName は Identity ではない」— しかし
     * **Identity fingerprint の材料**にはする。別物が同じ packageId を名乗った
     * ことを検出して User へ提示するのが目的（§139.18）。
     */
    name: m.name,
    author: m.author ?? null,
    publisherId: m.publisherId ?? null,
    license: m.license ?? null,
    homepage: m.homepage ?? null,
    requiredCapabilities: [...m.requiredCapabilities].sort(),
    signatureScheme: source.signature?.scheme ?? null,
    signatureKeyId: source.signature?.keyId ?? null
  });
}
__name(computePackageIdentityFingerprint, "computePackageIdentityFingerprint");
async function evaluateSourceSnapshotCompatibility(record, currentEntity, { target = null } = {}) {
  const snap = record.sourceSnapshot;
  const isEntitySubject = record.subject.subjectKind === SUBJECT_KIND.entity;
  if (!isEntitySubject) {
    return {
      compatibility: SNAPSHOT_COMPATIBILITY.exact,
      bindable: true,
      needsRevalidation: false,
      reason: "not_entity_subject"
    };
  }
  if (!currentEntity) {
    return {
      compatibility: SNAPSHOT_COMPATIBILITY.unknown,
      bindable: false,
      needsRevalidation: true,
      reason: "no_current_observation"
    };
  }
  const wantId = snap?.entityIdentity?.value ?? null;
  if (wantId != null && String(wantId) !== String(currentEntity.fmId)) {
    return {
      compatibility: SNAPSHOT_COMPATIBILITY.identityMismatch,
      bindable: false,
      needsRevalidation: true,
      reason: "entity_identity_mismatch"
    };
  }
  if (!snap || snap.originalName == null) {
    return {
      compatibility: SNAPSHOT_COMPATIBILITY.unknown,
      bindable: false,
      needsRevalidation: true,
      reason: "no_source_snapshot"
    };
  }
  const snapshotNormalized = snap.normalizedName ?? strictNormalizedSource(snap.originalName);
  const currentNormalized = currentEntity.normalizedOriginalName ?? strictNormalizedSource(currentEntity.currentOriginalName ?? "");
  const guard = buildSourceNameGuard({
    origin: "ai",
    normalizedSourceName: snapshotNormalized
  });
  const verdict = evaluateSourceNameGuard({
    guard,
    currentNormalizedName: currentNormalized,
    target: target ?? snap.target ?? null,
    isManualOrLocked: false
  });
  if (verdict.eligible) {
    return {
      compatibility: snapshotNormalized === currentNormalized ? SNAPSHOT_COMPATIBILITY.exact : SNAPSHOT_COMPATIBILITY.minorChange,
      bindable: true,
      needsRevalidation: false,
      reason: verdict.reason
    };
  }
  return {
    compatibility: SNAPSHOT_COMPATIBILITY.renameSuspected,
    bindable: false,
    needsRevalidation: true,
    reason: verdict.reason ?? "source_name_changed"
  };
}
__name(evaluateSourceSnapshotCompatibility, "evaluateSourceSnapshotCompatibility");
function requestOf9(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf9, "requestOf");
async function getPackage(db, packageId) {
  return runRead(db, [STORE.packages], ({ store }) => requestOf9(store(STORE.packages).index("packageId").get(packageId)));
}
__name(getPackage, "getPackage");
async function listInstalledPackages(db, { limit = PACKAGE_POLICY.pageSize, cursor = null } = {}) {
  const page = await iterateIndex(db, {
    storeName: STORE.packages,
    indexName: "updatedAt",
    direction: "prev",
    limit,
    cursor
  });
  return {
    items: page.items.map((p) => ({
      packageKey: p.packageKey,
      packageId: p.packageId,
      displayName: p.displayName,
      authorDisplayName: p.authorDisplayName,
      publisherType: p.publisherType,
      installedVersion: p.installedVersion,
      activeVersion: p.activeVersion,
      previousVersion: p.previousVersion,
      state: p.state,
      trustMode: p.trustMode,
      claimAttestationCount: p.claimAttestationCount,
      entityBindingCount: p.entityBindingCount,
      invalidRecordCount: p.invalidRecordCount,
      conflictCount: p.conflictCount ?? 0,
      signatureStatus: p.signatureStatus,
      signatureReason: p.signatureReason ?? null,
      /**
       * §102.3.15: UI へ出すのは **computed（再計算した値）**。file の自己申告
       * （declared）をそのまま integrity として表示しない。
       */
      integrityStatus: p.integrityStatus ?? null,
      manifestHash: p.computedManifestHash ?? p.manifestHash,
      contentHash: p.computedContentHash ?? p.contentHash,
      declaredManifestHash: p.declaredManifestHash ?? null,
      declaredContentHash: p.declaredContentHash ?? null,
      license: p.license,
      homepage: p.homepage,
      attribution: p.attribution,
      authorNote: p.authorNote ?? null,
      installedAt: p.installedAt,
      updatedAt: p.updatedAt,
      lastValidatedAt: p.lastValidatedAt,
      /** §102.3.15: Hash 一致だけで official / verified ではないことを UI へ明示する。 */
      integrityOnly: true
    })),
    nextCursor: page.nextCursor,
    done: page.done
  };
}
__name(listInstalledPackages, "listInstalledPackages");
async function dryRunPackageInstall(db, sourceLike, {
  limits = PACKAGE_SAFETY_LIMITS,
  policy = PACKAGE_POLICY,
  signal = null
} = {}) {
  const source = await normalizePackageSource(sourceLike, { limits });
  const manifest = source.manifest;
  const meta = await getMeta(db);
  const capabilities = validatePackageCapabilities(manifest);
  const identityFingerprint = await computePackageIdentityFingerprint(source);
  const integrity = await verifyPackageIntegrity(source);
  const signature = evaluatePackageSignature(source.signature, integrity);
  const existing = await getPackage(db, manifest.packageId);
  const report = {
    packageId: manifest.packageId,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifestVersion: PACKAGE_MANIFEST_VERSION,
    packageIdentityFingerprint: identityFingerprint,
    /**
     * §102.3.15: declared（自己申告）と computed（再計算）を混同せず両方保持する。
     * `integrity.status` だけが判断材料であり、declared 文字列は表示にも使わない。
     */
    integrity,
    signatureStatus: signature.signatureStatus,
    signatureReason: signature.signatureReason,
    /** §102.3.15: 署名の有無は Truth を変えない。表示のためだけに載せる。 */
    signaturePresent: source.signature != null,
    capabilities,
    counts: {
      records: source.counts.records,
      newClaims: 0,
      evidenceOnExistingClaims: 0,
      conflictCandidates: 0,
      entityBindings: 0,
      entityBindingsBlocked: 0,
      invalidRecords: 0,
      unknownRequiredCapabilities: capabilities.unknownRequired.length,
      // §102.3.1: records / entities を通した一意性違反の件数（canonical pass 由来）
      duplicateRecordIds: integrity.duplicateRecordIds.length
    },
    duplicateRecordIds: integrity.duplicateRecordIds,
    conflicts: [],
    problems: [],
    installKind: "install",
    identityMismatch: null,
    sameVersionContentMismatch: null,
    /** §102.3.5 / §102.3.6: Package 操作は広範囲へ影響し得るので推定を返す。 */
    estimatedCacheImpact: "full_resolution_cache_invalidation",
    schemaCompatible: manifest.minDictionarySchemaVersion <= (meta.dictionarySchemaVersion ?? 1)
  };
  if (existing) {
    report.installKind = compareVersionStrings(manifest.version, existing.installedVersion ?? "0") === 0 ? "reinstall_same_version" : compareVersionStrings(manifest.version, existing.installedVersion ?? "0") > 0 ? "update" : "downgrade";
    if (report.installKind === "reinstall_same_version" && existing.computedContentHash && existing.computedContentHash !== integrity.computedContentHash) {
      report.sameVersionContentMismatch = {
        version: manifest.version,
        installedContentHash: existing.computedContentHash,
        incomingContentHash: integrity.computedContentHash,
        /** 汎用 identity token では上書きさせない。新 version か Clone Import を要求する。 */
        requiresNewVersionOrClone: true
      };
    }
    if (existing.packageIdentityFingerprint && existing.packageIdentityFingerprint !== identityFingerprint) {
      report.identityMismatch = {
        storedFingerprint: existing.packageIdentityFingerprint,
        incomingFingerprint: identityFingerprint,
        storedAuthor: existing.authorDisplayName ?? null,
        incomingAuthor: manifest.author ?? null,
        storedName: existing.displayName ?? null,
        incomingName: manifest.name,
        requiresExplicitConfirmation: true
      };
    }
    const before = new Set(existing.requiredCapabilities ?? []);
    const escalated = manifest.requiredCapabilities.filter((c) => !before.has(c));
    if (escalated.length) report.capabilityEscalation = escalated;
  }
  const seenRecordIds = /* @__PURE__ */ new Set();
  let index = -1;
  for await (const item of source.records()) {
    index += 1;
    if (signal?.aborted) throw new PackageError("package dry-run cancelled", { index });
    if (report.problems.length > policy.maxReportedProblems) break;
    if (!item.ok) {
      report.counts.invalidRecords += 1;
      report.problems.push({ index: item.index, kind: item.reason, message: item.message });
      continue;
    }
    const rec = item.value;
    try {
      if (seenRecordIds.has(rec.packageRecordId)) {
        report.problems.push({ index, kind: DUPLICATE_RECORD_ID_REASON, id: rec.packageRecordId });
        continue;
      }
      seenRecordIds.add(rec.packageRecordId);
      const plan = await planPackageRecord(db, rec, { limits });
      if (!plan.ok) {
        report.counts.invalidRecords += 1;
        report.problems.push({ index, kind: plan.reason, id: rec.packageRecordId });
        continue;
      }
      if (plan.existingClaim) {
        report.counts.evidenceOnExistingClaims += 1;
      } else {
        report.counts.newClaims += 1;
      }
      if (plan.competing.length) {
        report.counts.conflictCandidates += 1;
        if (report.conflicts.length < policy.maxReportedConflicts) {
          report.conflicts.push({
            sourceText: rec.subject.sourceText,
            valueType: rec.claim.valueType,
            packageValue: rec.claim.value,
            existingValues: plan.competing.slice(0, 5)
          });
        }
      }
      if (rec.subject.subjectKind === SUBJECT_KIND.entity) {
        if (plan.snapshot.bindable) report.counts.entityBindings += 1;
        else report.counts.entityBindingsBlocked += 1;
      }
    } catch (e) {
      report.counts.invalidRecords += 1;
      report.problems.push({ index, kind: "invalid_record", message: String(e?.message ?? e) });
    }
  }
  const hasDuplicateIds = integrity.duplicateRecordIds.length > 0;
  report.canActivate = capabilities.ok && report.schemaCompatible && report.identityMismatch == null && integrity.ok && !hasDuplicateIds && report.sameVersionContentMismatch == null;
  report.blockedReasons = [
    ...capabilities.ok ? [] : ["unknown_required_capability"],
    ...report.schemaCompatible ? [] : ["min_dictionary_schema_version"],
    ...report.identityMismatch ? ["package_identity_mismatch"] : [],
    // duplicate は integrity.ok にも含まれるが、専用 reason を明示して返す
    ...hasDuplicateIds ? [DUPLICATE_RECORD_ID_REASON] : [],
    ...integrity.ok || hasDuplicateIds ? [] : [integrity.status],
    ...report.sameVersionContentMismatch ? ["same_version_content_mismatch"] : []
  ];
  return report;
}
__name(dryRunPackageInstall, "dryRunPackageInstall");
async function planPackageRecord(db, rec, {
  limits = PACKAGE_SAFETY_LIMITS,
  mutationId = null
} = {}) {
  let subjectKey;
  let currentEntity = null;
  let target = null;
  try {
    if (rec.subject.subjectKind === SUBJECT_KIND.lexical) {
      subjectKey = await lexicalSubjectKey(strictNormalizedSource(rec.subject.sourceText));
    } else if (rec.subject.subjectKind === SUBJECT_KIND.phrase) {
      subjectKey = await phraseSubjectKey(strictNormalizedSource(rec.subject.sourceText));
    } else {
      const m = /^entity:([a-z_]+):(.+)$/.exec(rec.subject.sourceText);
      if (!m) return { ok: false, reason: "entity_subject_text_malformed" };
      target = m[1];
      subjectKey = entitySubjectKey(m[1], m[2]);
      currentEntity = await runRead(db, [STORE.entities], ({ store }) => requestOf9(store(STORE.entities).get(`${m[1]}:${m[2]}`)));
    }
    normalizeClaimValue(rec.claim.valueType, rec.claim.value, rec.claim.script);
  } catch (e) {
    return { ok: false, reason: "invalid_record", message: String(e?.message ?? e) };
  }
  const snapshot = await evaluateSourceSnapshotCompatibility(rec, currentEntity, { target });
  const sourceNameGuard = rec.subject.subjectKind === SUBJECT_KIND.entity ? buildSourceNameGuard({
    origin: "ai",
    normalizedSourceName: rec.sourceSnapshot?.normalizedName ?? (rec.sourceSnapshot?.originalName ? strictNormalizedSource(rec.sourceSnapshot.originalName) : null)
  }) : null;
  const prepared = await prepareClaimUpsert({
    sourceNameGuard,
    subjectKind: rec.subject.subjectKind,
    subjectKey,
    valueType: rec.claim.valueType,
    value: rec.claim.value,
    script: rec.claim.script,
    sourceText: rec.subject.sourceText,
    applicabilityConstraints: rec.claim.applicabilityConstraints,
    provenance: { createdBy: "package_import", firstEvidenceRootId: null },
    /**
     * §102.3.2 最重要 Invariant / §120-51:
     *   「ファイルを Import した ≠ User が中身を1件ずつ確認した」
     * したがって Package Import だけで verificationState / locked を作らない。
     */
    verificationState: VERIFICATION_STATE.none,
    locked: false
  }, { mutationId, invalidateCache: true });
  const existingClaim = await runRead(db, [STORE.claims], ({ store }) => requestOf9(store(STORE.claims).index("semanticKey").get(prepared.record.semanticKey)));
  const groupPage = await iterateIndex(db, {
    storeName: STORE.claims,
    indexName: "subjectKey_valueType",
    query: IDBKeyRange.only([subjectKey, rec.claim.valueType]),
    limit: 25
  });
  const competing = groupPage.items.filter((c) => c.normalizedValue !== prepared.record.normalizedValue && c.deletedAt == null && c.disabled !== true).map((c) => ({
    claimId: c.claimId,
    value: c.value,
    verificationState: c.verificationState,
    locked: c.locked === true
  }));
  void limits;
  return { ok: true, prepared, existingClaim: existingClaim ?? null, competing, snapshot, subjectKey };
}
__name(planPackageRecord, "planPackageRecord");
async function readPackageMarker(db) {
  const meta = await getMeta(db);
  return meta[PACKAGE_MARKER_META_KEY] ?? null;
}
__name(readPackageMarker, "readPackageMarker");
async function writePackageMarker(db, marker, { fence = null } = {}) {
  await runSemanticMutation(db, [], async ({ patchMeta }) => {
    patchMeta({ [PACKAGE_MARKER_META_KEY]: marker });
  }, { fence, bumpRevision: false });
}
__name(writePackageMarker, "writePackageMarker");
async function guardNewPackageOperation(db, { allowSessionId = null } = {}) {
  const marker = await readPackageMarker(db);
  if (!marker || marker.state !== "running") return;
  if (allowSessionId && marker.sessionId === allowSessionId) return;
  throw new PackageConflictError(
    "another package install/update is in progress; resume or roll it back first",
    { marker }
  );
}
__name(guardNewPackageOperation, "guardNewPackageOperation");
async function inspectPackageInstallState(db) {
  const marker = await readPackageMarker(db);
  return {
    inProgress: Boolean(marker && marker.state === "running"),
    sessionId: marker?.sessionId ?? null,
    packageId: marker?.packageId ?? null,
    version: marker?.version ?? null,
    phase: marker?.phase ?? null,
    state: marker?.state ?? null,
    operation: marker?.operation ?? null,
    previousVersion: marker?.previousVersion ?? null,
    previousState: marker?.previousState ?? null,
    checkpoint: marker?.checkpoint ?? null,
    /** activation 前なので rollback は安全（main の Resolver へ未露出）。 */
    canRollback: Boolean(marker && marker.state === "running" && marker.phase !== PACKAGE_PHASE.completed),
    canResume: Boolean(marker && marker.state === "running")
  };
}
__name(inspectPackageInstallState, "inspectPackageInstallState");
async function installPackage(db, sourceLike, {
  limits = PACKAGE_SAFETY_LIMITS,
  policy = PACKAGE_POLICY,
  chunkSize = PACKAGE_POLICY.importChunkSize,
  trustMode = PACKAGE_TRUST_MODE.normal,
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  confirmIdentityChange = null,
  actor = "package_import",
  onProgress = null,
  signal = null,
  now = Date.now(),
  resumeSessionId = null,
  /**
   * §93.1: 中断された install を再開するときに **同じ root mutation ID** を
   * 引き継ぐための内部 option（`resumePackageInstall()` が marker から渡す）。
   * 再開を「別 operation」にしてしまうと、1回の install が2つの Undo 単位へ
   * 割れて §93「意味的に1つの操作へ mut:<ULID>」が壊れる。
   */
  resumeRootMutationId = null,
  broadcast = null
} = {}) {
  if (!Object.values(PACKAGE_TRUST_MODE).includes(trustMode)) {
    throw new PackageError(`installPackage: unknown trustMode ${trustMode}`, { trustMode });
  }
  const source = await normalizePackageSource(sourceLike, { limits });
  const manifest = source.manifest;
  await guardNewPackageOperation(db, { allowSessionId: resumeSessionId });
  const dryRun = await dryRunPackageInstall(db, source, { limits, policy, signal });
  if (!dryRun.capabilities.ok) {
    throw new PackageSecurityError(
      "§102.3.10: package declares unknown required capabilities and must not be activated",
      { unknownRequired: dryRun.capabilities.unknownRequired }
    );
  }
  if (!dryRun.schemaCompatible) {
    throw new PackageValidationError(
      "package requires a newer dictionary schema version",
      { minDictionarySchemaVersion: manifest.minDictionarySchemaVersion }
    );
  }
  if (dryRun.duplicateRecordIds.length > 0) {
    throw new PackageIntegrityError(
      `§102.3.1: package declares duplicate packageRecordId(s) (${dryRun.duplicateRecordIds.map((d) => d.packageRecordId).join(", ")}). packageRecordId must be unique across records and entities, otherwise the content hash and the installed record set cannot be reconciled.`,
      { duplicateRecordIds: dryRun.duplicateRecordIds }
    );
  }
  if (!dryRun.integrity.ok) {
    throw new PackageIntegrityError(
      `§102.3.15: package integrity check failed (${dryRun.integrity.status}). The declared manifest/content hash does not match the recomputed value, so the file has been altered or was produced by an incompatible writer.`,
      { integrity: dryRun.integrity }
    );
  }
  if (dryRun.sameVersionContentMismatch) {
    throw new PackageIntegrityError(
      `§102.3.8: package ${manifest.packageId} v${manifest.version} is already installed with different content. Publish a new version, or import it as a separate package (clone). The installed version is left untouched.`,
      { sameVersionContentMismatch: dryRun.sameVersionContentMismatch }
    );
  }
  if (dryRun.identityMismatch) {
    const token = typeof confirmIdentityChange === "string" ? confirmIdentityChange : confirmIdentityChange?.acknowledge;
    if (token !== PACKAGE_IDENTITY_OVERRIDE_CONFIRMATION) {
      throw new PackageIdentityError(
        `§102.3.8: packageId ${manifest.packageId} is already installed with a different identity fingerprint. This is not automatically a legitimate update. Pass confirmIdentityChange: ${JSON.stringify(PACKAGE_IDENTITY_OVERRIDE_CONFIRMATION)} after reviewing the difference, or import it as a separate package (clone).`,
        { identityMismatch: dryRun.identityMismatch }
      );
    }
  }
  const existing = await getPackage(db, manifest.packageId);
  const sessionId = resumeSessionId ?? newOpaqueId("pkgi");
  const rootMutationId = resumeRootMutationId ?? newOpaqueId(ID_PREFIXES.mutation);
  assertMutationId("installPackage(rootMutationId)", rootMutationId);
  const packageKey = packageKeyFor(manifest.packageId);
  const identityFingerprint = dryRun.packageIdentityFingerprint;
  const marker = {
    operation: existing ? "package_update" : "package_install",
    state: "running",
    sessionId,
    /** §93.1: crash resume が同じ operation を続けられるように永続化する。 */
    rootMutationId,
    packageKey,
    packageId: manifest.packageId,
    version: manifest.version,
    previousVersion: existing?.activeVersion ?? null,
    previousState: existing?.state ?? null,
    phase: PACKAGE_PHASE.staging,
    startedAt: now,
    checkpoint: { records: 0, lastRecordId: null }
  };
  await writePackageMarker(db, marker);
  const registry = {
    packageKey,
    packageId: manifest.packageId,
    displayName: manifest.name,
    authorDisplayName: manifest.author,
    publisherId: manifest.publisherId,
    /** §102.3.2: V1 は常に community_unverified。author 文字列で昇格しない。 */
    publisherType: PUBLISHER_CLASS.communityUnverified,
    installedVersion: manifest.version,
    /** staged 中は activeVersion を **前 version のまま**にする（§102.3.8 / §139.17）。 */
    activeVersion: existing?.activeVersion ?? null,
    previousVersion: existing?.activeVersion ?? null,
    state: PACKAGE_STATE.installing,
    trustMode: existing?.trustMode ?? trustMode,
    packageIdentityFingerprint: identityFingerprint,
    /**
     * §102.3.15: UI / Backup が参照する `manifestHash` / `contentHash` は
     * **computed（この engine が再計算した値）**にする。declared（file の自己申告）は
     * 別 field に残し、両者を混同させない。
     */
    manifestHash: dryRun.integrity.computedManifestHash,
    contentHash: dryRun.integrity.computedContentHash,
    computedManifestHash: dryRun.integrity.computedManifestHash,
    computedContentHash: dryRun.integrity.computedContentHash,
    declaredManifestHash: dryRun.integrity.declaredManifestHash,
    declaredContentHash: dryRun.integrity.declaredContentHash,
    manifestHashAlgo: dryRun.integrity.manifestHashAlgo,
    contentHashAlgo: dryRun.integrity.contentHashAlgo,
    declaredManifestHashAlgo: dryRun.integrity.declaredManifestHashAlgo,
    declaredContentHashAlgo: dryRun.integrity.declaredContentHashAlgo,
    integrityStatus: dryRun.integrity.status,
    signature: source.signature,
    signatureStatus: dryRun.signatureStatus,
    signatureReason: dryRun.signatureReason,
    formatVersion: PACKAGE_FORMAT_VERSION,
    manifestVersion: PACKAGE_MANIFEST_VERSION,
    minDictionarySchemaVersion: manifest.minDictionarySchemaVersion,
    requiredCapabilities: manifest.requiredCapabilities,
    optionalCapabilities: manifest.optionalCapabilities,
    droppedOptionalCapabilities: dryRun.capabilities.droppedOptional,
    claimAttestationCount: existing?.claimAttestationCount ?? 0,
    entityBindingCount: existing?.entityBindingCount ?? 0,
    invalidRecordCount: 0,
    conflictCount: 0,
    license: manifest.license,
    homepage: manifest.homepage,
    attribution: manifest.attribution,
    authorNote: manifest.authorNote,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    lastValidatedAt: now,
    stagingSessionId: sessionId,
    recordVersion: (existing?.recordVersion ?? 0) + 1
  };
  await runSemanticMutation(db, [STORE.packages], async ({ tx }) => {
    const out = await upsertPackageByPackageId(tx, {
      packageId: manifest.packageId,
      build: /* @__PURE__ */ __name(() => registry, "build")
    });
    if (!out.created) {
      await requestOf9(tx.objectStore(STORE.packages).put({
        ...out.record,
        ...registry,
        // 進行中は既存 activeVersion / state を維持する（§102.3.7 失敗時の保持）
        activeVersion: out.record.activeVersion ?? null,
        state: PACKAGE_STATE.installing,
        trustMode: out.record.trustMode ?? trustMode,
        installedAt: out.record.installedAt ?? now,
        recordVersion: (out.record.recordVersion ?? 0) + 1
      }));
    }
  }, { bumpRevision: false });
  const stats = {
    recordsSeen: 0,
    claimsCreated: 0,
    claimsMerged: 0,
    evidenceCreated: 0,
    evidenceDeduped: 0,
    conflictsCoexisting: 0,
    invalidRecords: 0,
    entityBindings: 0,
    entityBindingsBlocked: 0,
    skipped: 0,
    maxChunkBuffer: 0
  };
  const problems = [];
  let batch = [];
  const flush = /* @__PURE__ */ __name(async () => {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    stats.maxChunkBuffer = Math.max(stats.maxChunkBuffer, items.length);
    await runSemanticMutation(
      db,
      [STORE.claims, STORE.history, STORE.evidence],
      async ({ tx }) => {
        for (const item of items) {
          const claimOut = await commitClaimUpsertIn(tx, item.preparedClaim, { actor });
          if (claimOut.created) stats.claimsCreated += 1;
          else {
            stats.claimsMerged += 1;
          }
          if (item.competing) stats.conflictsCoexisting += 1;
          const prepared = item.preparedEvidenceFor(claimOut.claim);
          const evOut = await commitEvidenceIn(tx, prepared);
          if (evOut.created) stats.evidenceCreated += 1;
          else stats.evidenceDeduped += 1;
        }
      },
      { extraStores: [STORE.cache] }
    );
    marker.checkpoint = { records: stats.recordsSeen, lastRecordId: items[items.length - 1].recordId };
    await writePackageMarker(db, marker);
    if (onProgress) await onProgress({ phase: PACKAGE_PHASE.staging, ...stats });
  }, "flush");
  try {
    let index = -1;
    for await (const item of source.records()) {
      index += 1;
      if (signal?.aborted) throw new PackageError("package install cancelled", { index });
      stats.recordsSeen += 1;
      if (!item.ok) {
        stats.invalidRecords += 1;
        problems.push({ index: item.index, kind: item.reason, message: item.message });
        continue;
      }
      const rec = item.value;
      let plan;
      try {
        plan = await planPackageRecord(db, rec, { limits, mutationId: rootMutationId });
      } catch (e) {
        stats.invalidRecords += 1;
        problems.push({ index, kind: "invalid_record", message: String(e?.message ?? e) });
        continue;
      }
      if (!plan.ok) {
        stats.invalidRecords += 1;
        problems.push({ index, kind: plan.reason, id: rec.packageRecordId });
        continue;
      }
      if (rec.subject.subjectKind === SUBJECT_KIND.entity) {
        if (!plan.snapshot.bindable) {
          stats.entityBindingsBlocked += 1;
          stats.skipped += 1;
          problems.push({
            index,
            kind: "source_snapshot_incompatible",
            id: rec.packageRecordId,
            compatibility: plan.snapshot.compatibility,
            reason: plan.snapshot.reason
          });
          continue;
        }
        stats.entityBindings += 1;
      }
      const preparedClaim = plan.existingClaim ? plan.prepared : {
        ...plan.prepared,
        record: {
          ...plan.prepared.record,
          quarantined: true,
          stagingSessionId: sessionId
        }
      };
      const preparedEvidence = await prepareEvidenceWrite(db, {
        evidenceType: EVIDENCE_TYPE.packageAttestation,
        claimId: preparedClaim.record.claimId,
        claimSemanticKey: preparedClaim.record.semanticKey,
        stance: STANCE.support,
        valueType: rec.claim.valueType,
        originPackageKey: packageKey,
        originPackageId: manifest.packageId,
        originPackageVersion: manifest.version,
        originPackageRecordId: rec.packageRecordId,
        originRecordKey: packageOriginRecordKey(manifest.packageId, rec.packageRecordId),
        packageAttestationKind: rec.attestation.kind,
        /** §102.3.2: 署名/Publisher 未検証 → community_unverified 固定。 */
        packagePublisherClass: PUBLISHER_CLASS.communityUnverified,
        /**
         * §93 / §93.1: Package Install/Update の root mutation ID。
         * §19.1: packageRecord dedupe identity の入力ではないので、同じ
         * Package Version の再 Import は依然として同じ dedupeKey になる
         * （§120-53 の「水増ししない」は不変）。
         */
        mutationId: rootMutationId,
        now
      }, { claimRecordForCache: preparedClaim.record });
      batch.push({
        recordId: rec.packageRecordId,
        preparedClaim,
        competing: plan.competing.length > 0,
        preparedEvidenceFor: /* @__PURE__ */ __name((claim) => ({
          ...preparedEvidence,
          record: { ...preparedEvidence.record, claimId: claim.claimId }
        }), "preparedEvidenceFor")
      });
      if (batch.length >= chunkSize) await flush();
    }
    await flush();
  } catch (e) {
    marker.phase = PACKAGE_PHASE.staging;
    marker.error = String(e?.message ?? e);
    await writePackageMarker(db, marker);
    await setPackageState(db, manifest.packageId, PACKAGE_STATE.broken, { now });
    throw e;
  }
  marker.phase = PACKAGE_PHASE.staged;
  await writePackageMarker(db, marker);
  await setPackageState(db, manifest.packageId, PACKAGE_STATE.staged, { now });
  const activation = await activateStagedPackage(db, {
    packageId: manifest.packageId,
    version: manifest.version,
    sessionId,
    marker,
    owner,
    leaseTtlMs,
    policy,
    now,
    stats,
    broadcast
  });
  return {
    packageId: manifest.packageId,
    packageKey,
    version: manifest.version,
    sessionId,
    /** §93.1: UI / Report がこの install を Undo 単位として指せるようにする。 */
    rootMutationId,
    installKind: dryRun.installKind,
    dryRun,
    stats,
    problems,
    activation,
    state: PACKAGE_STATE.active
  };
}
__name(installPackage, "installPackage");
async function activateStagedPackage(db, {
  packageId,
  version,
  sessionId,
  marker,
  owner,
  leaseTtlMs,
  policy,
  now,
  stats,
  broadcast
}) {
  const packageKey = packageKeyFor(packageId);
  let out;
  try {
    out = await withPackageMaintenance(db, {
      leaseType: "package_activation",
      owner,
      leaseTtlMs,
      policy,
      now,
      packageKey,
      // 影響 Claim の収集 / scoreDirty は quarantine 解除の **後** に行いたいので
      // ここでは collect せず、work() 内で明示的に回す。
      collectTouched: false
    }, async ({ fence, renew }) => {
      marker.phase = PACKAGE_PHASE.activating;
      await writePackageMarker(db, marker, { fence });
      const released = await releaseStagedClaims(db, sessionId, { fence, policy, now, renew });
      const touched = await collectClaimIdsForPackage(db, packageKey, { policy, renew });
      const dirty = await markPackageClaimsScoreDirty(db, touched, { fence, policy, renew });
      await renew();
      await runSemanticMutation(
        db,
        [STORE.packages, STORE.cache],
        async ({ tx, meta, patchMeta }) => {
          const os = tx.objectStore(STORE.packages);
          const rec = await requestOf9(os.get(packageKey));
          if (!rec) throw new PackageError("package registry vanished during activation", { packageId });
          await requestOf9(os.put({
            ...rec,
            state: PACKAGE_STATE.active,
            previousVersion: rec.activeVersion ?? null,
            activeVersion: version,
            installedVersion: version,
            claimAttestationCount: stats.evidenceCreated + stats.evidenceDeduped,
            entityBindingCount: stats.entityBindings,
            invalidRecordCount: stats.invalidRecords,
            conflictCount: stats.conflictsCoexisting,
            stagingSessionId: null,
            updatedAt: now,
            lastValidatedAt: now,
            recordVersion: (rec.recordVersion ?? 0) + 1
          }));
          await clearResolutionCacheIn(tx);
          patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
        },
        { fence, bumpRevision: true }
      );
      marker.phase = PACKAGE_PHASE.completed;
      marker.state = "completed";
      marker.completedAt = now;
      await writePackageMarker(db, marker, { fence });
      return {
        released,
        touched: dirty.marked,
        collected: touched.length,
        missingClaimIds: dirty.missing
      };
    });
  } finally {
    if (broadcast && marker.state === "completed") {
      try {
        broadcast.post({ type: "bulkDictionaryChanged", scope: "package_activation" });
      } catch {
      }
    }
  }
  return {
    released: out.released,
    touchedClaims: out.touched,
    collectedClaims: out.collected,
    /** §104: active Attestation が実在しない Claim を指していた場合の正直な報告。 */
    integrityErrors: out.missingClaimIds.length ? { missingClaimIds: out.missingClaimIds } : null,
    leaseRenewCount: out.leaseRenewCount,
    leaseEpoch: out.leaseEpoch
  };
}
__name(activateStagedPackage, "activateStagedPackage");
async function releaseStagedClaims(db, sessionId, { fence, policy, now, renew }) {
  let released = 0;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName: "stagingSessionId",
      query: IDBKeyRange.only(sessionId),
      limit: policy.activationPageSize
    });
    const pending = page.items.filter((c) => c.stagingSessionId === sessionId);
    if (!pending.length) break;
    await runSemanticMutation(db, [STORE.claims], async ({ tx }) => {
      for (const c of pending) {
        await patchClaimQuarantineState(tx, c.claimId, {
          quarantined: false,
          stagingSessionId: null,
          quarantineMetadata: null
        }, { now });
        released += 1;
      }
    }, { fence, bumpRevision: false });
    if (renew) await renew();
    if (pending.length < policy.activationPageSize) break;
  }
  return released;
}
__name(releaseStagedClaims, "releaseStagedClaims");
async function collectClaimIdsForPackage(db, packageKey, { policy = PACKAGE_POLICY, max = 5e4, renew = null, includeInvalidated = false } = {}) {
  const ids = /* @__PURE__ */ new Set();
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.evidence,
      indexName: "originPackageKey",
      query: IDBKeyRange.only(packageKey),
      limit: policy.pageSize,
      cursor
    });
    for (const ev of page.items) {
      if (!includeInvalidated && ev.invalidatedAt != null) continue;
      if (ids.size >= max) return [...ids];
      if (ev.claimId) ids.add(ev.claimId);
    }
    if (renew) await renew();
    if (page.done) break;
    cursor = page.nextCursor;
  }
  return [...ids];
}
__name(collectClaimIdsForPackage, "collectClaimIdsForPackage");
async function markPackageClaimsScoreDirty(db, claimIds, { fence, policy = PACKAGE_POLICY, renew = null } = {}) {
  let marked = 0;
  const missing = [];
  for (let i = 0; i < claimIds.length; i += policy.activationPageSize) {
    const slice = claimIds.slice(i, i + policy.activationPageSize);
    const sliceMissing = [];
    let sliceMarked = 0;
    await runSemanticMutation(db, [STORE.claims], async ({ tx }) => {
      const os = tx.objectStore(STORE.claims);
      for (const claimId of slice) {
        const current = await requestOf9(os.get(claimId));
        if (!current) {
          sliceMissing.push(claimId);
          continue;
        }
        await markClaimScoreInputChanged(tx, claimId);
        sliceMarked += 1;
      }
    }, { fence, bumpRevision: false });
    marked += sliceMarked;
    if (sliceMissing.length) missing.push(...sliceMissing);
    if (renew) await renew();
  }
  return { marked, missing };
}
__name(markPackageClaimsScoreDirty, "markPackageClaimsScoreDirty");
async function withPackageMaintenance(db, {
  leaseType,
  owner,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  packageKey,
  collectTouched = true
}, work) {
  let lease = await acquireMaintenanceLease(db, {
    type: leaseType,
    ttlMs: leaseTtlMs,
    ...owner ? { owner } : {},
    now
  });
  let renewCount = 0;
  const renew = /* @__PURE__ */ __name(async () => {
    lease = await renewMaintenanceLease(db, {
      ...owner ? { owner } : { owner: lease.owner },
      leaseEpoch: lease.leaseEpoch,
      ttlMs: leaseTtlMs
    });
    renewCount += 1;
  }, "renew");
  const fence = { ...owner ? { owner } : { owner: lease.owner }, leaseEpoch: lease.leaseEpoch };
  try {
    const touched = collectTouched ? await collectClaimIdsForPackage(db, packageKey, { policy, renew }) : [];
    let missingClaimIds = [];
    let markedClaims = 0;
    if (touched.length) {
      const dirty = await markPackageClaimsScoreDirty(db, touched, { fence, policy, renew });
      missingClaimIds = dirty.missing;
      markedClaims = dirty.marked;
    }
    await renew();
    const result = await work({ fence, renew, touched });
    return {
      ...result,
      /**
       * report count は実変更件数と一致させる: `touchedClaims` は **実際に
       * scoreDirty にした件数**。収集はできたが Claim が存在しなかった分は
       * `integrityErrors.missingClaimIds` 側へ計上し、二重に数えない
       * （touchedClaims + missingClaimIds.length === collectedClaims）。
       */
      touchedClaims: markedClaims,
      collectedClaims: touched.length,
      leaseRenewCount: renewCount,
      /** §104: 欠損を握り潰さず呼び出し元の report へ上げる。 */
      integrityErrors: missingClaimIds.length ? { missingClaimIds } : null,
      leaseEpoch: lease.leaseEpoch
    };
  } finally {
    try {
      await releaseMaintenanceLease(db, {
        ...owner ? { owner } : { owner: lease.owner },
        leaseEpoch: lease.leaseEpoch
      });
    } catch {
    }
  }
}
__name(withPackageMaintenance, "withPackageMaintenance");
async function setPackageState(db, packageId, state, { now = Date.now(), fence = null } = {}) {
  await runSemanticMutation(db, [STORE.packages], async ({ tx }) => {
    const os = tx.objectStore(STORE.packages);
    const rec = await requestOf9(os.index("packageId").get(packageId));
    if (!rec) return;
    await requestOf9(os.put({ ...rec, state, updatedAt: now, recordVersion: (rec.recordVersion ?? 0) + 1 }));
  }, { fence, bumpRevision: false });
}
__name(setPackageState, "setPackageState");
async function setPackageEnabled(db, packageId, enabled, {
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  broadcast = null
} = {}) {
  const rec = await getPackage(db, packageId);
  if (!rec) throw new PackageError(`package not installed: ${packageId}`, { packageId });
  const nextState = enabled ? PACKAGE_STATE.active : PACKAGE_STATE.disabled;
  if (rec.state === nextState) {
    return { packageId, state: nextState, changed: false, touchedClaims: 0 };
  }
  if (enabled && !rec.activeVersion) {
    throw new PackageError("cannot enable a package that has no activated version", { packageId });
  }
  const packageKey = packageKeyFor(packageId);
  const out = await withPackageMaintenance(db, {
    leaseType: "package_state_change",
    owner,
    leaseTtlMs,
    policy,
    now,
    packageKey
  }, async ({ fence }) => {
    await runSemanticMutation(
      db,
      [STORE.packages, STORE.cache],
      async ({ tx, meta, patchMeta }) => {
        const os = tx.objectStore(STORE.packages);
        const live = await requestOf9(os.get(packageKey));
        if (!live) throw new PackageError("package registry vanished", { packageId });
        await requestOf9(os.put({
          ...live,
          state: nextState,
          updatedAt: now,
          recordVersion: (live.recordVersion ?? 0) + 1
        }));
        await clearResolutionCacheIn(tx);
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      },
      { fence, bumpRevision: true }
    );
    return {};
  });
  if (broadcast) {
    try {
      broadcast.post({ type: "bulkDictionaryChanged", scope: "package_state" });
    } catch {
    }
  }
  return {
    packageId,
    state: nextState,
    changed: true,
    touchedClaims: out.touchedClaims,
    collectedClaims: out.collectedClaims,
    /** §104: active Attestation が実在しない Claim を指していた場合の正直な報告。 */
    integrityErrors: out.integrityErrors ?? null
  };
}
__name(setPackageEnabled, "setPackageEnabled");
function disablePackage(db, packageId, opts = {}) {
  return setPackageEnabled(db, packageId, false, opts);
}
__name(disablePackage, "disablePackage");
function enablePackage(db, packageId, opts = {}) {
  return setPackageEnabled(db, packageId, true, opts);
}
__name(enablePackage, "enablePackage");
async function setPackageTrustMode(db, packageId, trustMode, {
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  broadcast = null
} = {}) {
  if (!Object.values(PACKAGE_TRUST_MODE).includes(trustMode)) {
    throw new PackageError(`unknown trustMode: ${trustMode}`, { trustMode });
  }
  const rec = await getPackage(db, packageId);
  if (!rec) throw new PackageError(`package not installed: ${packageId}`, { packageId });
  if (rec.trustMode === trustMode) return { packageId, trustMode, changed: false, touchedClaims: 0 };
  const packageKey = packageKeyFor(packageId);
  const out = await withPackageMaintenance(db, {
    leaseType: "package_state_change",
    owner,
    leaseTtlMs,
    policy,
    now,
    packageKey
  }, async ({ fence }) => {
    await runSemanticMutation(
      db,
      [STORE.packages, STORE.cache],
      async ({ tx, meta, patchMeta }) => {
        const os = tx.objectStore(STORE.packages);
        const live = await requestOf9(os.get(packageKey));
        if (!live) throw new PackageError("package registry vanished", { packageId });
        await requestOf9(os.put({
          ...live,
          trustMode,
          updatedAt: now,
          recordVersion: (live.recordVersion ?? 0) + 1
        }));
        await clearResolutionCacheIn(tx);
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      },
      { fence, bumpRevision: true }
    );
    return {};
  });
  if (broadcast) {
    try {
      broadcast.post({ type: "bulkDictionaryChanged", scope: "package_trust" });
    } catch {
    }
  }
  return { packageId, trustMode, changed: true, touchedClaims: out.touchedClaims };
}
__name(setPackageTrustMode, "setPackageTrustMode");
async function rollbackPackage(db, packageId, {
  toVersion = null,
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  broadcast = null
} = {}) {
  const rec = await getPackage(db, packageId);
  if (!rec) throw new PackageError(`package not installed: ${packageId}`, { packageId });
  const target = toVersion ?? rec.previousVersion;
  if (!target) {
    throw new PackageError(
      "rollbackPackage: no previous version to roll back to",
      { packageId, activeVersion: rec.activeVersion }
    );
  }
  if (target === rec.activeVersion) {
    return { packageId, activeVersion: target, changed: false, touchedClaims: 0 };
  }
  const available = await hasAttestationsForVersion(db, packageKeyFor(packageId), target, { policy });
  if (!available) {
    throw new PackageValidationError(
      `rollbackPackage: no stored attestations for version ${target}; reinstall that version instead of silently activating an empty version`,
      { packageId, toVersion: target }
    );
  }
  const packageKey = packageKeyFor(packageId);
  const out = await withPackageMaintenance(db, {
    leaseType: "package_rollback",
    owner,
    leaseTtlMs,
    policy,
    now,
    packageKey
  }, async ({ fence }) => {
    await runSemanticMutation(
      db,
      [STORE.packages, STORE.cache],
      async ({ tx, meta, patchMeta }) => {
        const os = tx.objectStore(STORE.packages);
        const live = await requestOf9(os.get(packageKey));
        if (!live) throw new PackageError("package registry vanished", { packageId });
        await requestOf9(os.put({
          ...live,
          previousVersion: live.activeVersion ?? null,
          activeVersion: target,
          state: PACKAGE_STATE.active,
          updatedAt: now,
          recordVersion: (live.recordVersion ?? 0) + 1
        }));
        await clearResolutionCacheIn(tx);
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      },
      { fence, bumpRevision: true }
    );
    return {};
  });
  if (broadcast) {
    try {
      broadcast.post({ type: "bulkDictionaryChanged", scope: "package_rollback" });
    } catch {
    }
  }
  return {
    packageId,
    activeVersion: target,
    previousVersion: rec.activeVersion,
    changed: true,
    touchedClaims: out.touchedClaims,
    collectedClaims: out.collectedClaims,
    integrityErrors: out.integrityErrors ?? null
  };
}
__name(rollbackPackage, "rollbackPackage");
async function hasAttestationsForVersion(db, packageKey, version, { policy = PACKAGE_POLICY } = {}) {
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.evidence,
      indexName: "originPackageKey",
      query: IDBKeyRange.only(packageKey),
      limit: policy.pageSize,
      cursor
    });
    if (page.items.some((ev) => ev.originPackageVersion === version)) return true;
    if (page.done) return false;
    cursor = page.nextCursor;
  }
}
__name(hasAttestationsForVersion, "hasAttestationsForVersion");
async function uninstallPackage(db, packageId, {
  purgeEvidence = false,
  confirm = null,
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  broadcast = null
} = {}) {
  const rec = await getPackage(db, packageId);
  if (!rec) throw new PackageError(`package not installed: ${packageId}`, { packageId });
  if (purgeEvidence) {
    const token = typeof confirm === "string" ? confirm : confirm?.acknowledge;
    if (token !== PACKAGE_PURGE_CONFIRMATION) {
      throw new PackageError(
        `§102.3.9: physically purging package evidence is an explicit maintenance action; pass confirm: ${JSON.stringify(PACKAGE_PURGE_CONFIRMATION)}`,
        { got: token ?? null }
      );
    }
  }
  const packageKey = packageKeyFor(packageId);
  let purged = 0;
  const out = await withPackageMaintenance(db, {
    leaseType: "package_uninstall",
    owner,
    leaseTtlMs,
    policy,
    now,
    packageKey
  }, async ({ fence, renew }) => {
    if (purgeEvidence) {
      purged = await purgePackageEvidence(db, packageKey, { fence, policy, now, renew });
      await renew();
    }
    await runSemanticMutation(
      db,
      [STORE.packages, STORE.cache],
      async ({ tx, meta, patchMeta }) => {
        const os = tx.objectStore(STORE.packages);
        const live = await requestOf9(os.get(packageKey));
        if (live) {
          if (purgeEvidence) {
            await requestOf9(os.delete(packageKey));
          } else {
            await requestOf9(os.put({
              ...live,
              state: PACKAGE_STATE.disabled,
              uninstalledAt: now,
              updatedAt: now,
              recordVersion: (live.recordVersion ?? 0) + 1
            }));
          }
        }
        await clearResolutionCacheIn(tx);
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      },
      { fence, bumpRevision: true }
    );
    return {};
  });
  if (broadcast) {
    try {
      broadcast.post({ type: "bulkDictionaryChanged", scope: "package_uninstall" });
    } catch {
    }
  }
  return {
    packageId,
    mode: purgeEvidence ? "purge" : "soft",
    touchedClaims: out.touchedClaims,
    collectedClaims: out.collectedClaims,
    purgedEvidence: purged,
    integrityErrors: out.integrityErrors ?? null,
    /** §102.3.9: Claim は消していない（他 Evidence が支持している可能性がある）。 */
    claimsDeleted: 0
  };
}
__name(uninstallPackage, "uninstallPackage");
async function purgePackageEvidence(db, packageKey, { fence, policy, now, renew = null }) {
  let purged = 0;
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.evidence,
      indexName: "originPackageKey",
      query: IDBKeyRange.only(packageKey),
      limit: policy.pageSize,
      cursor
    });
    const live = page.items.filter((ev) => ev.invalidatedAt == null);
    if (live.length) {
      await runSemanticMutation(db, [STORE.evidence], async ({ tx }) => {
        const os = tx.objectStore(STORE.evidence);
        for (const ev of live) {
          await requestOf9(os.put({
            ...ev,
            invalidatedAt: now,
            invalidationReason: "package_uninstalled"
          }));
          purged += 1;
        }
      }, { fence, bumpRevision: false });
    }
    if (renew) await renew();
    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return purged;
}
__name(purgePackageEvidence, "purgePackageEvidence");
var STAGED_TEARDOWN_SCAN_CAP = 500;
function collectInTx(tx, storeName, indexName, range, { cap = STAGED_TEARDOWN_SCAN_CAP } = {}) {
  return new Promise((resolve, reject) => {
    const os = tx.objectStore(storeName);
    const src = indexName ? os.index(indexName) : os;
    const items = [];
    const rq = src.openCursor(range);
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c) {
        resolve({ items, truncated: false });
        return;
      }
      if (items.length >= cap) {
        resolve({ items, truncated: true });
        return;
      }
      items.push(c.value);
      c.continue();
    };
    rq.onerror = () => reject(rq.error);
  });
}
__name(collectInTx, "collectInTx");
function makeSessionEvidencePredicate(marker) {
  const rootMutationId = marker.rootMutationId ?? null;
  if (rootMutationId) return (ev) => ev.mutationId === rootMutationId;
  return (ev) => ev.originPackageKey === marker.packageKey && ev.originPackageVersion === marker.version;
}
__name(makeSessionEvidencePredicate, "makeSessionEvidencePredicate");
async function inventoryStagedClaim(tx, claim, { isSessionEvidence }) {
  const ev = await collectInTx(tx, STORE.evidence, "claimId", IDBKeyRange.only(claim.claimId));
  const mine = ev.items.filter(isSessionEvidence);
  const foreign = ev.items.filter((e) => !isSessionEvidence(e));
  const relFrom = await collectInTx(tx, STORE.relations, "fromNodeId", IDBKeyRange.only(claim.claimId));
  const relTo = await collectInTx(tx, STORE.relations, "toNodeId", IDBKeyRange.only(claim.claimId));
  const hist = await collectInTx(tx, STORE.history, "nodeId", IDBKeyRange.only(claim.claimId));
  const reasons = [];
  if (foreign.length) reasons.push("foreign_evidence");
  if (ev.truncated) reasons.push("evidence_scan_truncated");
  if (relFrom.items.length || relTo.items.length) reasons.push("relation_reference");
  if (relFrom.truncated || relTo.truncated) reasons.push("relation_scan_truncated");
  if (hist.truncated) reasons.push("history_scan_truncated");
  if (claim.locked === true) reasons.push("locked");
  if (isManualAuthorityClaim(claim)) reasons.push("manual_verification");
  return { mine, foreign, history: hist.items, removable: reasons.length === 0, reasons };
}
__name(inventoryStagedClaim, "inventoryStagedClaim");
async function teardownStagedSession(db, { sid, marker, fence, policy, now, renew, report }) {
  const isSessionEvidence = makeSessionEvidencePredicate(marker);
  let lastHead = null;
  let stalledRounds = 0;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName: "stagingSessionId",
      query: IDBKeyRange.only(sid),
      limit: policy.activationPageSize
    });
    const pending = page.items.filter((c) => c.stagingSessionId === sid);
    if (!pending.length) break;
    const head = pending[0].claimId;
    if (head === lastHead) {
      stalledRounds += 1;
      if (stalledRounds >= 2) {
        throw new PackageError(
          "rollbackPackageInstall: staging teardown made no progress; refusing to report a half-cleaned rollback as success",
          { sessionId: sid, claimId: head }
        );
      }
    } else {
      stalledRounds = 0;
      lastHead = head;
    }
    await runSemanticMutation(
      db,
      [STORE.claims, STORE.evidence, STORE.history, STORE.relations],
      async ({ tx }) => {
        const claimsOs = tx.objectStore(STORE.claims);
        const evOs = tx.objectStore(STORE.evidence);
        const histOs = tx.objectStore(STORE.history);
        for (const c of pending) {
          const live = await requestOf9(claimsOs.get(c.claimId));
          if (!live || live.stagingSessionId !== sid) continue;
          const inv = await inventoryStagedClaim(tx, live, { isSessionEvidence });
          for (const ev of inv.mine) {
            await requestOf9(evOs.delete(ev.evidenceId));
            report.removedEvidence += 1;
          }
          if (inv.removable) {
            for (const h of inv.history) {
              await requestOf9(histOs.delete(h.historyId));
              report.removedHistory += 1;
            }
            await requestOf9(claimsOs.delete(live.claimId));
            report.removedClaims += 1;
          } else {
            await patchClaimQuarantineState(tx, live.claimId, {
              quarantined: false,
              stagingSessionId: null,
              quarantineMetadata: null
            }, { now });
            await patchClaimRevalidationState(tx, live.claimId, {
              revalidationState: REVALIDATION_STATE.needed
            }, { now });
            await markClaimScoreInputChanged(tx, live.claimId);
            report.retainedClaims += 1;
            if (report.retained.length < 200) {
              report.retained.push({ claimId: live.claimId, reasons: inv.reasons });
            }
          }
        }
      },
      { fence, bumpRevision: false }
    );
    if (renew) await renew();
  }
}
__name(teardownStagedSession, "teardownStagedSession");
async function removeSessionPackageEvidence(db, { marker, fence, policy, renew, now, report }) {
  const hasRoot = Boolean(marker.rootMutationId);
  const isSessionEvidence = makeSessionEvidencePredicate(marker);
  const dirty = /* @__PURE__ */ new Set();
  let cursor = null;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.evidence,
      indexName: "originPackageKey",
      query: IDBKeyRange.only(marker.packageKey),
      limit: policy.pageSize,
      cursor
    });
    const mine = page.items.filter((ev) => isSessionEvidence(ev) && (hasRoot || ev.invalidatedAt == null));
    if (mine.length) {
      await runSemanticMutation(db, [STORE.evidence], async ({ tx }) => {
        const os = tx.objectStore(STORE.evidence);
        for (const ev of mine) {
          if (hasRoot) {
            await requestOf9(os.delete(ev.evidenceId));
            report.removedEvidence += 1;
          } else {
            await requestOf9(os.put({
              ...ev,
              invalidatedAt: now,
              invalidationReason: "package_install_rolled_back"
            }));
            report.invalidatedEvidence += 1;
          }
          if (ev.claimId) dirty.add(ev.claimId);
        }
      }, { fence, bumpRevision: false });
    }
    if (renew) await renew();
    if (page.done || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return [...dirty];
}
__name(removeSessionPackageEvidence, "removeSessionPackageEvidence");
async function rollbackPackageInstall(db, {
  sessionId = null,
  owner = void 0,
  leaseTtlMs = PACKAGE_POLICY.activationLeaseTtlMs,
  policy = PACKAGE_POLICY,
  now = Date.now(),
  broadcast = null
} = {}) {
  const marker = await readPackageMarker(db);
  if (!marker || marker.state !== "running") {
    return { rolledBack: false, reason: "no_running_package_install" };
  }
  const sid = sessionId ?? marker.sessionId;
  if (sid !== marker.sessionId) {
    throw new PackageConflictError(
      "rollbackPackageInstall: sessionId does not match the marker",
      { got: sid, marker }
    );
  }
  if (marker.phase === PACKAGE_PHASE.completed) {
    return { rolledBack: false, reason: "already_completed" };
  }
  const report = {
    removedClaims: 0,
    retainedClaims: 0,
    removedEvidence: 0,
    removedHistory: 0,
    invalidatedEvidence: 0,
    touchedExistingClaims: 0,
    retained: []
  };
  let lease = null;
  let integrityErrors = null;
  try {
    lease = await acquireMaintenanceLease(db, {
      type: "package_rollback",
      ttlMs: leaseTtlMs,
      ...owner ? { owner } : {},
      now
    });
    const fence = { ...owner ? { owner } : { owner: lease.owner }, leaseEpoch: lease.leaseEpoch };
    const renew = /* @__PURE__ */ __name(async () => {
      lease = await renewMaintenanceLease(db, {
        ...owner ? { owner } : { owner: lease.owner },
        leaseEpoch: lease.leaseEpoch,
        ttlMs: leaseTtlMs
      });
    }, "renew");
    await teardownStagedSession(db, { sid, marker, fence, policy, now, renew, report });
    const dirtyClaimIds = await removeSessionPackageEvidence(
      db,
      { marker, fence, policy, renew, now, report }
    );
    const dirty = await markPackageClaimsScoreDirty(db, dirtyClaimIds, { fence, policy, renew });
    report.touchedExistingClaims = dirty.marked;
    if (dirty.missing.length) integrityErrors = { missingClaimIds: dirty.missing };
    await runSemanticMutation(
      db,
      [STORE.packages, STORE.cache],
      async ({ tx, meta, patchMeta }) => {
        const os = tx.objectStore(STORE.packages);
        const live = await requestOf9(os.get(marker.packageKey));
        if (live) {
          if (marker.previousVersion == null && marker.operation === "package_install") {
            await requestOf9(os.delete(marker.packageKey));
          } else {
            await requestOf9(os.put({
              ...live,
              state: marker.previousState ?? PACKAGE_STATE.active,
              activeVersion: marker.previousVersion,
              installedVersion: marker.previousVersion,
              stagingSessionId: null,
              updatedAt: now,
              recordVersion: (live.recordVersion ?? 0) + 1
            }));
          }
        }
        await clearResolutionCacheIn(tx);
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      },
      { fence, bumpRevision: true }
    );
    await writePackageMarker(db, {
      ...marker,
      state: "rolled_back",
      phase: marker.phase,
      rolledBackAt: now
    }, { fence });
  } finally {
    if (lease) {
      try {
        await releaseMaintenanceLease(db, {
          ...owner ? { owner } : { owner: lease.owner },
          leaseEpoch: lease.leaseEpoch
        });
      } catch {
      }
    }
  }
  if (broadcast) {
    try {
      broadcast.post({ type: "bulkDictionaryChanged", scope: "package_install_rollback" });
    } catch {
    }
  }
  return {
    rolledBack: true,
    sessionId: sid,
    removedClaims: report.removedClaims,
    retainedClaims: report.retainedClaims,
    retained: report.retained,
    removedEvidence: report.removedEvidence,
    removedHistory: report.removedHistory,
    invalidatedEvidence: report.invalidatedEvidence,
    touchedExistingClaims: report.touchedExistingClaims,
    integrityErrors
  };
}
__name(rollbackPackageInstall, "rollbackPackageInstall");
function buildPackageImportReport(installResult) {
  const r = installResult;
  return {
    packageId: r.packageId,
    version: r.version,
    installKind: r.installKind,
    state: r.state,
    /** §93.1: この Import 操作の Undo scope key。 */
    rootMutationId: r.rootMutationId ?? null,
    newClaims: r.stats.claimsCreated,
    mergedIntoExistingClaims: r.stats.claimsMerged,
    evidenceAdded: r.stats.evidenceCreated,
    evidenceDeduped: r.stats.evidenceDeduped,
    conflictsCoexisting: r.stats.conflictsCoexisting,
    entityBindings: r.stats.entityBindings,
    entityBindingsBlocked: r.stats.entityBindingsBlocked,
    invalidRecords: r.stats.invalidRecords,
    skipped: r.stats.skipped,
    droppedOptionalCapabilities: r.dryRun.capabilities.droppedOptional,
    integrityStatus: r.dryRun.integrity.status,
    manifestHashVerified: r.dryRun.integrity.manifestMatch,
    contentHashVerified: r.dryRun.integrity.contentMatch,
    signatureStatus: r.dryRun.signatureStatus,
    signatureReason: r.dryRun.signatureReason,
    /** §102.3.15: 表示上、Integrity と Authenticity を混同させない。 */
    integrityOnly: true,
    /** §102.3.14:「後から OFF にできることを Import 時にも明示する」。 */
    canBeDisabledLater: true,
    problems: r.problems
  };
}
__name(buildPackageImportReport, "buildPackageImportReport");

// dictionary-correction-alignment.js
var ALIGNMENT_POLICY_VERSION = 1;
var ALIGNMENT_POLICY = Object.freeze({
  alignmentPolicyVersion: ALIGNMENT_POLICY_VERSION,
  /** §41「alignmentScore >= high threshold → Segment Claimへuser_correction Evidence」 */
  highThreshold: 0.8,
  /** §41「middle threshold → Entity/Phrase修正は保存 / Lexicalは revalidationState=needed」 */
  middleThreshold: 0.5,
  /**
   * §39:「全文を大幅変更した場合は Segment 対応が不明」。変更が触れた
   * source_segment の本数で isolation を落とす。1本=対応を断定できる、
   * 2本=曖昧、3本以上=全文書き換え相当。
   */
  isolationBySegmentCount: Object.freeze({ 1: 1, 2: 0.6, many: 0.15 }),
  /** 変更が output 全体のどれだけ小さい範囲に閉じているか（下限）。 */
  localityFloor: 0.5
});
var ALIGNMENT_BAND = Object.freeze({
  none: "none",
  syntheticOnly: "synthetic_only",
  high: "high",
  middle: "middle",
  low: "low",
  invalid: "invalid"
});
var SEPARATOR_CHARS = /* @__PURE__ */ new Set([
  " ",
  "	",
  "\n",
  "\r",
  " ",
  "　",
  "・",
  "･",
  "·",
  "‧",
  "•",
  "-",
  "‐",
  "‑",
  "–",
  "—",
  "―",
  "－",
  "(",
  ")",
  "（",
  "）",
  "[",
  "]",
  "［",
  "］",
  "{",
  "}",
  "｛",
  "｝",
  "「",
  "」",
  "『",
  "』",
  "〈",
  "〉",
  "《",
  "》",
  "/",
  "／",
  "、",
  "，",
  ","
]);
function isSeparatorOnly(text) {
  if (typeof text !== "string" || text.length === 0) return true;
  for (const ch of text) if (!SEPARATOR_CHARS.has(ch)) return false;
  return true;
}
__name(isSeparatorOnly, "isSeparatorOnly");
var CorrectionAlignmentError = class extends Error {
  static {
    __name(this, "CorrectionAlignmentError");
  }
  constructor(message, details) {
    super(message);
    this.name = "CorrectionAlignmentError";
    this.details = details;
  }
};
var isHighSurrogate = /* @__PURE__ */ __name((c) => c >= 55296 && c <= 56319, "isHighSurrogate");
var isLowSurrogate = /* @__PURE__ */ __name((c) => c >= 56320 && c <= 57343, "isLowSurrogate");
function assertSegmentSpansReproduceSource(sourceText, sourceMap) {
  for (const seg of sourceMap ?? []) {
    if (seg.mapKind !== "source_segment") {
      if (seg.sourceStart !== null || seg.sourceEnd !== null) {
        throw new CorrectionAlignmentError(
          "§40: a synthetic segment must not carry a source span",
          { segmentId: seg.segmentId }
        );
      }
      continue;
    }
    if (sourceText.slice(seg.sourceStart, seg.sourceEnd) !== seg.sourceText) {
      throw new CorrectionAlignmentError(
        `§40/§128.4: source span does not reproduce the raw input at ${seg.sourceStart}-${seg.sourceEnd}`,
        { segmentId: seg.segmentId }
      );
    }
  }
  return true;
}
__name(assertSegmentSpansReproduceSource, "assertSegmentSpansReproduceSource");
function diffOutputRange(before, after) {
  const maxPrefix = Math.min(before.length, after.length);
  let start = 0;
  while (start < maxPrefix && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let back = 0;
  const maxSuffix = Math.min(before.length - start, after.length - start);
  while (back < maxSuffix && before.charCodeAt(before.length - 1 - back) === after.charCodeAt(after.length - 1 - back)) back++;
  if (back > 0 && isLowSurrogate(before.charCodeAt(before.length - back))) back--;
  return { start, beforeEnd: before.length - back, afterEnd: after.length - back };
}
__name(diffOutputRange, "diffOutputRange");
function sourceMapReproducesOutput(sourceMap, originalOutput) {
  let text = "";
  for (const seg of sourceMap ?? []) {
    if (seg.outputStart !== text.length) return false;
    text += seg.outputText ?? "";
    if (seg.outputEnd !== text.length) return false;
  }
  return text === originalOutput;
}
__name(sourceMapReproducesOutput, "sourceMapReproducesOutput");
var EDIT_SCRIPT_POLICY = Object.freeze({
  /**
   * LCS DP の上限セル数。名前1件ぶんの文字列では十分だが、
   * §148.4「N件あるからN件走査」を避けるため上限を持ち、超えたら
   * 安全側（帰属不能 = Lexical 非学習）へ倒す。
   */
  maxCells: 25e4
});
var EDIT_KIND = Object.freeze({
  delete: "delete",
  insert: "insert",
  replace: "replace"
});
function codePointUnits(text) {
  const cps = [];
  const offsets = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    cps.push(cp);
    offsets.push(i);
    i += cp > 65535 ? 2 : 1;
  }
  offsets.push(text.length);
  return { cps, offsets };
}
__name(codePointUnits, "codePointUnits");
function lcsRuns(b, a) {
  const n = b.length;
  const m = a.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      dp[i2 * w + j2] = b[i2] === a[j2] ? dp[(i2 + 1) * w + (j2 + 1)] + 1 : Math.max(dp[(i2 + 1) * w + j2], dp[i2 * w + (j2 + 1)]);
    }
  }
  const runs = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && b[i] === a[j]) {
      i++;
      j++;
      continue;
    }
    const b0 = i;
    const a0 = j;
    while (i < n || j < m) {
      if (i < n && j < m && b[i] === a[j]) break;
      if (j >= m) {
        i++;
        continue;
      }
      if (i >= n) {
        j++;
        continue;
      }
      if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) i++;
      else j++;
    }
    runs.push({ b0, b1: i, a0, a1: j });
  }
  return runs;
}
__name(lcsRuns, "lcsRuns");
function buildEditScript(before, after) {
  if (before === after) return { ops: [], truncated: false };
  const { start, beforeEnd, afterEnd } = diffOutputRange(before, after);
  const midBefore = before.slice(start, beforeEnd);
  const midAfter = after.slice(start, afterEnd);
  const B = codePointUnits(midBefore);
  const A = codePointUnits(midAfter);
  const mkOp = /* @__PURE__ */ __name((b0, b1, a0, a1) => {
    const beforeStart = start + b0;
    const bEnd = start + b1;
    const afterStart = start + a0;
    const aEnd = start + a1;
    const removed = before.slice(beforeStart, bEnd);
    const added = after.slice(afterStart, aEnd);
    const kind = removed.length === 0 ? EDIT_KIND.insert : added.length === 0 ? EDIT_KIND.delete : EDIT_KIND.replace;
    return { kind, beforeStart, beforeEnd: bEnd, afterStart, afterEnd: aEnd, removed, added };
  }, "mkOp");
  if (B.cps.length * A.cps.length > EDIT_SCRIPT_POLICY.maxCells) {
    return {
      ops: [mkOp(0, midBefore.length, 0, midAfter.length)],
      truncated: true
    };
  }
  const runs = lcsRuns(B.cps, A.cps);
  const ops = runs.map((r) => mkOp(B.offsets[r.b0], B.offsets[r.b1], A.offsets[r.a0], A.offsets[r.a1]));
  return { ops, truncated: false };
}
__name(buildEditScript, "buildEditScript");
var ATTRIBUTION_FAILURE = Object.freeze({
  none: null,
  multipleSourceSegments: "edit_extends_outside_segment_window",
  ambiguousBoundaryInsertion: "ambiguous_boundary_insertion",
  replaceSpansSlots: "replace_spans_multiple_slots",
  contentIntoSynthetic: "non_separator_content_in_synthetic_span",
  scriptTruncated: "edit_script_too_large_to_attribute",
  reconstructionMismatch: "reconstruction_does_not_match_corrected_output",
  noSourceSegment: "no_source_segment_touched",
  emptyResult: "corrected_segment_empty_after_attribution",
  separatorOnlyResult: "corrected_segment_is_separator_only"
});
function buildSlots(sourceMap) {
  return (sourceMap ?? []).map((seg, index) => ({
    index,
    isSource: seg.mapKind === "source_segment",
    outputStart: seg.outputStart,
    outputEnd: seg.outputEnd,
    outputText: seg.outputText ?? ""
  }));
}
__name(buildSlots, "buildSlots");
function boundaryIndexAt(slots, p) {
  for (const s of slots) if (s.outputStart === p) return s.index;
  return slots.length;
}
__name(boundaryIndexAt, "boundaryIndexAt");
function applyLocalEdits(text, edits) {
  const sorted = [...edits].sort((x, y) => x.localStart - y.localStart || x.localEnd - y.localEnd);
  let out = "";
  let cursor = 0;
  for (const e of sorted) {
    if (e.localStart < cursor) return { ok: false, text: "" };
    out += text.slice(cursor, e.localStart);
    out += e.added;
    cursor = e.localEnd;
  }
  out += text.slice(cursor);
  return { ok: true, text: out };
}
__name(applyLocalEdits, "applyLocalEdits");
function attributeEditScript({ sourceMap, ops, truncated = false }) {
  const slots = buildSlots(sourceMap);
  const slotEdits = /* @__PURE__ */ new Map();
  const boundaryInserts = /* @__PURE__ */ new Map();
  const contentSegments = /* @__PURE__ */ new Set();
  let failure = truncated ? ATTRIBUTION_FAILURE.scriptTruncated : null;
  let allSyntheticClass = true;
  const pushSlotEdit = /* @__PURE__ */ __name((slot, localStart, localEnd, added, { syntheticClass }) => {
    if (!slotEdits.has(slot.index)) slotEdits.set(slot.index, []);
    slotEdits.get(slot.index).push({ localStart, localEnd, added });
    if (!syntheticClass) allSyntheticClass = false;
    if (slot.isSource) {
      contentSegments.add(slot.index);
      allSyntheticClass = false;
    }
  }, "pushSlotEdit");
  const fail = /* @__PURE__ */ __name((reason) => {
    if (!failure) failure = reason;
  }, "fail");
  for (const op of ops) {
    const sepOnly = isSeparatorOnly(op.removed) && isSeparatorOnly(op.added);
    if (op.beforeStart === op.beforeEnd) {
      const p = op.beforeStart;
      const inside = slots.find((s) => s.outputStart < p && p < s.outputEnd);
      if (inside) {
        pushSlotEdit(
          inside,
          p - inside.outputStart,
          p - inside.outputStart,
          op.added,
          { syntheticClass: sepOnly }
        );
        if (!inside.isSource && !sepOnly) fail(ATTRIBUTION_FAILURE.contentIntoSynthetic);
        continue;
      }
      const L = slots.find((s) => s.outputEnd === p && s.outputStart < s.outputEnd);
      const Rr = slots.find((s) => s.outputStart === p && s.outputStart < s.outputEnd);
      if (sepOnly) {
        const bi2 = boundaryIndexAt(slots, p);
        boundaryInserts.set(bi2, (boundaryInserts.get(bi2) ?? "") + op.added);
        continue;
      }
      if (L?.isSource && !Rr?.isSource) {
        pushSlotEdit(L, L.outputText.length, L.outputText.length, op.added, { syntheticClass: false });
        continue;
      }
      if (Rr?.isSource && !L?.isSource) {
        pushSlotEdit(Rr, 0, 0, op.added, { syntheticClass: false });
        continue;
      }
      if (L?.isSource && Rr?.isSource) {
        contentSegments.add(L.index);
        contentSegments.add(Rr.index);
        allSyntheticClass = false;
        fail(ATTRIBUTION_FAILURE.ambiguousBoundaryInsertion);
        continue;
      }
      const bi = boundaryIndexAt(slots, p);
      boundaryInserts.set(bi, (boundaryInserts.get(bi) ?? "") + op.added);
      allSyntheticClass = false;
      fail(ATTRIBUTION_FAILURE.contentIntoSynthetic);
      continue;
    }
    const touched = slots.filter((s) => s.outputStart < op.beforeEnd && s.outputEnd > op.beforeStart);
    if (touched.length === 0) {
      fail(ATTRIBUTION_FAILURE.reconstructionMismatch);
      continue;
    }
    if (op.added.length === 0) {
      for (const s of touched) {
        const ls = Math.max(op.beforeStart, s.outputStart) - s.outputStart;
        const le = Math.min(op.beforeEnd, s.outputEnd) - s.outputStart;
        pushSlotEdit(s, ls, le, "", { syntheticClass: sepOnly });
      }
      continue;
    }
    if (touched.length === 1) {
      const s = touched[0];
      pushSlotEdit(
        s,
        op.beforeStart - s.outputStart,
        op.beforeEnd - s.outputStart,
        op.added,
        { syntheticClass: sepOnly }
      );
      if (!s.isSource && !sepOnly) fail(ATTRIBUTION_FAILURE.contentIntoSynthetic);
      continue;
    }
    for (const s of touched) {
      if (s.isSource) {
        contentSegments.add(s.index);
        allSyntheticClass = false;
      }
    }
    if (!sepOnly) allSyntheticClass = false;
    fail(ATTRIBUTION_FAILURE.replaceSpansSlots);
  }
  return { slots, slotEdits, boundaryInserts, contentSegments, failure, allSyntheticClass };
}
__name(attributeEditScript, "attributeEditScript");
function reconstructFromAttribution({ slots, slotEdits, boundaryInserts }) {
  let text = "";
  const spans = /* @__PURE__ */ new Map();
  for (let i = 0; i <= slots.length; i++) {
    text += boundaryInserts.get(i) ?? "";
    if (i === slots.length) break;
    const applied = applyLocalEdits(slots[i].outputText, slotEdits.get(i) ?? []);
    if (!applied.ok) return { ok: false, text: "", spans };
    const startOffset = text.length;
    text += applied.text;
    spans.set(i, { start: startOffset, end: text.length, text: applied.text });
  }
  return { ok: true, text, spans };
}
__name(reconstructFromAttribution, "reconstructFromAttribution");
function splitsSurrogatePair(text, offset) {
  return offset > 0 && offset < text.length && isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset));
}
__name(splitsSurrogatePair, "splitsSurrogatePair");
function attributeCorrectedSegment({
  sourceMap,
  originalOutput,
  correctedOutput,
  segment,
  script = null
}) {
  const fail = /* @__PURE__ */ __name((reason) => ({
    ok: false,
    reason,
    correctedSegmentText: "",
    correctedSegmentSpan: null,
    attributionWindow: null
  }), "fail");
  const idx = segment?.mapIndex;
  if (!Number.isInteger(idx) || sourceMap[idx]?.mapKind !== "source_segment") {
    return fail("segment_not_located_in_source_map");
  }
  const edit = script ?? buildEditScript(originalOutput, correctedOutput);
  const att = attributeEditScript({ sourceMap, ops: edit.ops, truncated: edit.truncated });
  if (att.contentSegments.size > 1) return fail(ATTRIBUTION_FAILURE.multipleSourceSegments);
  if (att.contentSegments.size === 0) return fail(ATTRIBUTION_FAILURE.noSourceSegment);
  if (!att.contentSegments.has(idx)) return fail(ATTRIBUTION_FAILURE.multipleSourceSegments);
  if (att.failure) return fail(att.failure);
  const rebuilt = reconstructFromAttribution(att);
  if (!rebuilt.ok || rebuilt.text !== correctedOutput) {
    return fail(ATTRIBUTION_FAILURE.reconstructionMismatch);
  }
  const span = rebuilt.spans.get(idx);
  const text = span?.text ?? "";
  if (!text) return fail(ATTRIBUTION_FAILURE.emptyResult);
  if (isSeparatorOnly(text)) return fail(ATTRIBUTION_FAILURE.separatorOnlyResult);
  if (splitsSurrogatePair(correctedOutput, span.start) || splitsSurrogatePair(correctedOutput, span.end)) {
    return fail("mapped_span_splits_surrogate_pair");
  }
  return {
    ok: true,
    reason: "attributed",
    correctedSegmentText: text,
    correctedSegmentSpan: { start: span.start, end: span.end },
    attributionWindow: { start: sourceMap[idx].outputStart, end: sourceMap[idx].outputEnd }
  };
}
__name(attributeCorrectedSegment, "attributeCorrectedSegment");
function isolationWeight(n) {
  const table = ALIGNMENT_POLICY.isolationBySegmentCount;
  return table[n] ?? table.many;
}
__name(isolationWeight, "isolationWeight");
function alignCorrection({
  sourceText,
  sourceMap,
  originalOutput,
  correctedOutput,
  policy = ALIGNMENT_POLICY
}) {
  const base = {
    alignmentPolicyVersion: policy.alignmentPolicyVersion,
    alignmentScore: 0,
    changedSourceSegments: [],
    syntheticOnly: false,
    removedText: "",
    addedText: "",
    lexicalEligible: false,
    editScript: { ops: [], truncated: false },
    lexicalAttribution: {
      ok: false,
      reason: "not_attempted",
      correctedSegmentText: "",
      correctedSegmentSpan: null,
      attributionWindow: null
    }
  };
  if (typeof originalOutput !== "string" || typeof correctedOutput !== "string") {
    return { ...base, band: ALIGNMENT_BAND.invalid, reason: "output_not_a_string" };
  }
  if (!sourceMapReproducesOutput(sourceMap, originalOutput)) {
    return { ...base, band: ALIGNMENT_BAND.invalid, reason: "source_map_does_not_reproduce_output" };
  }
  assertSegmentSpansReproduceSource(sourceText, sourceMap);
  if (originalOutput === correctedOutput) {
    return { ...base, band: ALIGNMENT_BAND.none, reason: "no_change" };
  }
  const editScript = buildEditScript(originalOutput, correctedOutput);
  const removedText = editScript.ops.map((o) => o.removed).join("");
  const addedText = editScript.ops.map((o) => o.added).join("");
  const att = attributeEditScript({
    sourceMap,
    ops: editScript.ops,
    truncated: editScript.truncated
  });
  if (att.allSyntheticClass) {
    return {
      ...base,
      band: ALIGNMENT_BAND.syntheticOnly,
      syntheticOnly: true,
      removedText,
      addedText,
      editScript,
      reason: "separator_or_synthetic_only_edit"
    };
  }
  const changed = [...att.contentSegments].sort((x, y) => x - y).map((i) => {
    const seg = sourceMap[i];
    return {
      // §40/§41: 編集後座標を導くために Source Map 上の位置を保持する。
      mapIndex: i,
      segmentId: seg.segmentId,
      sourceStart: seg.sourceStart,
      sourceEnd: seg.sourceEnd,
      sourceText: seg.sourceText,
      outputStart: seg.outputStart,
      outputEnd: seg.outputEnd,
      outputText: seg.outputText,
      selectedClaimIds: seg.selectedClaimIds ?? [],
      method: seg.method ?? null
    };
  });
  if (changed.length === 0) {
    return {
      ...base,
      band: ALIGNMENT_BAND.low,
      removedText,
      addedText,
      editScript,
      reason: "no_source_segment_touched"
    };
  }
  const isolation = isolationWeight(changed.length);
  const unchangedRatio = originalOutput.length === 0 ? 0 : Math.max(0, (originalOutput.length - removedText.length) / originalOutput.length);
  const locality = policy.localityFloor + (1 - policy.localityFloor) * unchangedRatio;
  const alignmentScore = isolation * locality;
  const band = alignmentScore >= policy.highThreshold ? ALIGNMENT_BAND.high : alignmentScore >= policy.middleThreshold ? ALIGNMENT_BAND.middle : ALIGNMENT_BAND.low;
  const lexicalAttribution = changed.length === 1 ? attributeCorrectedSegment({
    sourceMap,
    originalOutput,
    correctedOutput,
    segment: changed[0],
    script: editScript
  }) : {
    ok: false,
    reason: ATTRIBUTION_FAILURE.multipleSourceSegments,
    correctedSegmentText: "",
    correctedSegmentSpan: null,
    attributionWindow: null
  };
  return {
    ...base,
    band,
    alignmentScore,
    changedSourceSegments: changed,
    removedText,
    addedText,
    editScript,
    lexicalAttribution,
    // §41:「high → Segment Claimへ user_correction Evidence」。high かつ
    // **1 segment に閉じている**時、かつ編集後の値を完全に再構成できた時だけ
    // Lexical 一般化を許す（§39）。
    lexicalEligible: band === ALIGNMENT_BAND.high && changed.length === 1 && lexicalAttribution.ok,
    reason: `alignment_${band}`
  };
}
__name(alignCorrection, "alignCorrection");

// dictionary-correction.js
var CorrectionError = class extends Error {
  static {
    __name(this, "CorrectionError");
  }
  constructor(message, details) {
    super(message);
    this.name = "CorrectionError";
    this.details = details;
  }
};
var CORRECTION_DISPOSITION = Object.freeze({
  applied: "applied",
  noChange: "no_change",
  staleResolutionIdentity: "stale_resolution_identity",
  invalidSourceMap: "invalid_source_map",
  /**
   * §100 / §119: 行を空にする操作は「この値が正しい」という assertion ではない。
   * Soft Delete（`deletedAt` / `disabled`）は明示的な削除経路の仕事なので、
   * Correction pipeline は空値の Claim を作らずここで止める。
   */
  emptyCorrection: "empty_correction"
});
var LEXICAL_DISPOSITION = Object.freeze({
  /** §41 high: Segment Claimへ user_correction Evidence + 旧値へContext Rejection */
  learned: "learned",
  /** §41 middle: Lexical Claim は revalidationState=needed。新Claim/Rejectionは作らない */
  revalidationNeeded: "revalidation_needed",
  /** §41 low / §41.2 synthetic-only: 単語へ自動一般化しない */
  notPropagated: "not_propagated"
});
var PAGE = 200;
var MAX_PAGES = 50;
async function collectClaimsInGroup(db, claimGroupKey2) {
  const claims = [];
  let cursor = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await findClaimsByGroup(db, claimGroupKey2, { cursor, limit: PAGE });
    claims.push(...page.items);
    if (page.done) break;
    cursor = page.nextCursor;
  }
  return claims;
}
__name(collectClaimsInGroup, "collectClaimsInGroup");
function requestOf10(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf10, "requestOf");
function correctionContextConstraints({
  entityKey: entityKey2 = null,
  target = null,
  countryCode = null,
  worldRegionCode = null
} = {}) {
  const c = emptyContextConstraints();
  if (entityKey2) c.include.entityKeys = [entityKey2];
  if (target) c.include.targets = [target];
  if (countryCode) c.include.countries = [countryCode];
  if (worldRegionCode) c.include.worldRegions = [worldRegionCode];
  for (const dim of Object.keys(c.include)) {
    if (!AUTO_PROMOTABLE_DIMENSIONS.includes(dim) && c.include[dim].length > 0) {
      throw new CorrectionError(`§38.0: ${dim} must not be auto-promoted`, { dim });
    }
  }
  return c;
}
__name(correctionContextConstraints, "correctionContextConstraints");
function entityCorrectionClaimSpec({
  entitySubject,
  valueType,
  script,
  value,
  sourceText,
  countryCode,
  worldRegionCode,
  sourceNameFingerprint,
  normalizedSourceName,
  now
}) {
  return {
    subjectKind: SUBJECT_KIND.entity,
    subjectKey: entitySubject,
    valueType,
    script,
    value,
    sourceText,
    // §6 / §38.3: ユーザー修正の既定 Guard。
    sourceNameGuard: buildSourceNameGuard({
      origin: "user_correction",
      normalizedSourceName,
      sourceFingerprint: sourceNameFingerprint
    }),
    provenance: { createdBy: "user" },
    verificationState: VERIFICATION_STATE.manualCorrected,
    locked: true,
    lockMetadata: {
      lockedBy: "user",
      lockedAt: now,
      reason: "translation_row_correction",
      // §38.4:「翻訳行から得た User Correction は非常に強いが、その観測 Context を
      //  保持する。Manual Evidence を理由に全世界 Global Hard Rule へ勝手に広げない」
      observedContext: { countryCode, worldRegionCode }
    },
    now
  };
}
__name(entityCorrectionClaimSpec, "entityCorrectionClaimSpec");
async function lexicalCorrectionClaimSpec({ segment, valueType, script, value, now }) {
  return {
    subjectKind: SUBJECT_KIND.lexical,
    subjectKey: await lexicalSubjectKey(strictNormalizedSource(segment.sourceText)),
    valueType,
    script,
    value,
    sourceText: segment.sourceText,
    provenance: { createdBy: "user" },
    // §38.3:「自動 global lock しない」— manual_corrected だが locked=false。
    verificationState: VERIFICATION_STATE.manualCorrected,
    locked: false,
    now
  };
}
__name(lexicalCorrectionClaimSpec, "lexicalCorrectionClaimSpec");
function checkResolutionIdentity({ rowInputFingerprint, currentInputFingerprint }) {
  if (typeof rowInputFingerprint !== "string" || !rowInputFingerprint) {
    return { ok: false, reason: "row_input_fingerprint_missing" };
  }
  if (rowInputFingerprint !== currentInputFingerprint) {
    return { ok: false, reason: "input_fingerprint_changed" };
  }
  return { ok: true, reason: null };
}
__name(checkResolutionIdentity, "checkResolutionIdentity");
async function applyUserCorrection(db, spec, {
  actor = "user",
  mutationId = null,
  originInstallationId = "local"
} = {}) {
  const {
    target,
    fmId = null,
    sourceText,
    valueType,
    script = null,
    originalOutput,
    correctedOutput,
    sourceMap = [],
    rowInputFingerprint,
    currentInputFingerprint,
    previousClaimIds = [],
    countryCode = null,
    worldRegionCode = null,
    entityKey: entityKeyIn = null,
    sourceNameFingerprint: sourceNameFingerprintIn = null,
    normalizedSourceName: normalizedSourceNameIn = null,
    inferenceSnapshot = null,
    now = Date.now()
  } = spec;
  const mid = mutationId ?? newOpaqueId("mut");
  const entityKey2 = entityKeyIn ?? (fmId ? entityKey(target, fmId) : null);
  const normalizedSourceName = normalizedSourceNameIn ?? strictNormalizedSource(sourceText);
  const sourceNameFingerprint = sourceNameFingerprintIn ?? (await computeSourceNameFingerprint(sourceText, { target })).sourceNameFingerprint;
  const identity = checkResolutionIdentity({ rowInputFingerprint, currentInputFingerprint });
  if (!identity.ok) {
    return {
      disposition: CORRECTION_DISPOSITION.staleResolutionIdentity,
      reason: identity.reason,
      mutationId: mid,
      alignment: null,
      claimIds: [],
      evidenceIds: [],
      rejectionIds: [],
      dependents: []
    };
  }
  const alignment = alignCorrection({ sourceText, sourceMap, originalOutput, correctedOutput });
  if (alignment.band === ALIGNMENT_BAND.invalid) {
    return {
      disposition: CORRECTION_DISPOSITION.invalidSourceMap,
      reason: alignment.reason,
      mutationId: mid,
      alignment,
      claimIds: [],
      evidenceIds: [],
      rejectionIds: [],
      dependents: []
    };
  }
  if (alignment.band === ALIGNMENT_BAND.none) {
    return {
      disposition: CORRECTION_DISPOSITION.noChange,
      reason: alignment.reason,
      mutationId: mid,
      alignment,
      claimIds: [],
      evidenceIds: [],
      rejectionIds: [],
      dependents: []
    };
  }
  if (strictNormalizedSource(correctedOutput) === "") {
    return {
      disposition: CORRECTION_DISPOSITION.emptyCorrection,
      reason: "corrected_output_is_empty",
      mutationId: mid,
      alignment,
      claimIds: [],
      evidenceIds: [],
      rejectionIds: [],
      dependents: []
    };
  }
  const syntheticOnly = alignment.band === ALIGNMENT_BAND.syntheticOnly;
  const effectiveValueType = syntheticOnly ? "japanese_display" : valueType;
  if (syntheticOnly && valueType !== "japanese_display") {
  }
  const lexicalDisposition = syntheticOnly ? LEXICAL_DISPOSITION.notPropagated : alignment.lexicalEligible ? LEXICAL_DISPOSITION.learned : alignment.band === ALIGNMENT_BAND.high || alignment.band === ALIGNMENT_BAND.middle ? LEXICAL_DISPOSITION.revalidationNeeded : LEXICAL_DISPOSITION.notPropagated;
  const allSegmentClaimIds = /* @__PURE__ */ new Set();
  for (const seg of sourceMap ?? []) {
    for (const id of seg.selectedClaimIds ?? []) allSegmentClaimIds.add(id);
  }
  const changedSegmentClaimIds = /* @__PURE__ */ new Set();
  for (const seg of alignment.changedSourceSegments ?? []) {
    for (const id of seg.selectedClaimIds ?? []) changedSegmentClaimIds.add(id);
  }
  const lexicalPropagationAllowed = lexicalDisposition === LEXICAL_DISPOSITION.learned;
  const candidateOldIds = [...new Set(previousClaimIds.filter(Boolean))];
  const oldClaimIds = candidateOldIds.filter((id) => !allSegmentClaimIds.has(id) || lexicalPropagationAllowed && changedSegmentClaimIds.has(id));
  const oldClaims = oldClaimIds.length ? await runRead(db, [STORE.claims], async ({ store }) => {
    const out = [];
    for (const id of oldClaimIds) {
      const c = await requestOf10(store(STORE.claims).get(id));
      if (c) out.push(c);
    }
    return out;
  }) : [];
  const untouchedClaimIds = candidateOldIds.filter((id) => !oldClaimIds.includes(id));
  const newClaimSpecs = [];
  if (entityKey2) {
    newClaimSpecs.push({
      role: "entity",
      spec: entityCorrectionClaimSpec({
        entitySubject: entitySubjectKey(target, fmId),
        valueType: effectiveValueType,
        script,
        value: correctedOutput,
        sourceText,
        countryCode,
        worldRegionCode,
        sourceNameFingerprint,
        normalizedSourceName,
        now
      })
    });
  } else {
    newClaimSpecs.push({
      role: "phrase",
      spec: {
        subjectKind: SUBJECT_KIND.phrase,
        subjectKey: await phraseSubjectKey(strictNormalizedSource(sourceText)),
        valueType: effectiveValueType,
        script,
        value: correctedOutput,
        sourceText,
        provenance: { createdBy: "user" },
        verificationState: VERIFICATION_STATE.manualCorrected,
        locked: true,
        lockMetadata: { lockedBy: "user", lockedAt: now, reason: "translation_row_correction" },
        now
      }
    });
  }
  if (lexicalDisposition === LEXICAL_DISPOSITION.learned) {
    const seg = alignment.changedSourceSegments[0];
    const { correctedSegmentText } = alignment.lexicalAttribution;
    if (correctedSegmentText) {
      newClaimSpecs.push({
        role: "lexical",
        segment: seg,
        correctedSegmentText,
        spec: await lexicalCorrectionClaimSpec({
          segment: seg,
          valueType: effectiveValueType,
          script,
          value: correctedSegmentText,
          now
        })
      });
    }
  }
  const builtClaims = [];
  for (const entry of newClaimSpecs) {
    builtClaims.push({ ...entry, record: await buildClaimRecord(entry.spec) });
  }
  const supportEvidence = [];
  for (const b of builtClaims) {
    supportEvidence.push({
      target: b,
      record: await buildEvidenceRecord({
        evidenceType: EVIDENCE_TYPE.userCorrection,
        stance: STANCE.support,
        claimId: b.record.claimId,
        claimSemanticKey: b.record.semanticKey,
        valueType: b.record.valueType,
        mutationId: mid,
        originInstallationId,
        // §38.0:「AI推定 language / role は Correction Evidence の Inference
        //  Snapshot として残し、Context overlap 評価に使う」
        context: {
          rawFacts: { sourceText },
          canonicalFacts: { target, entityKey: entityKey2, countryCode, worldRegionCode },
          inference: inferenceSnapshot ?? {}
        },
        target,
        entityKey: entityKey2,
        now
      })
    });
  }
  const contradictEvidence = [];
  for (const oc of oldClaims) {
    contradictEvidence.push({
      claimId: oc.claimId,
      record: await buildEvidenceRecord({
        evidenceType: EVIDENCE_TYPE.userCorrection,
        stance: STANCE.contradict,
        claimId: oc.claimId,
        claimSemanticKey: oc.semanticKey,
        valueType: oc.valueType,
        mutationId: mid,
        originInstallationId,
        context: {
          rawFacts: { sourceText },
          canonicalFacts: { target, entityKey: entityKey2, countryCode, worldRegionCode },
          inference: inferenceSnapshot ?? {}
        },
        target,
        entityKey: entityKey2,
        now
      })
    });
  }
  const constraints = correctionContextConstraints({
    entityKey: entityKey2,
    target,
    countryCode,
    worldRegionCode
  });
  const rejectionSpecs = [];
  for (const oc of oldClaims) {
    if (oc.normalizedValue === void 0 || oc.value == null) continue;
    if (syntheticOnly && oc.valueType !== "japanese_display") continue;
    if (oc.subjectKind === SUBJECT_KIND.lexical && lexicalDisposition !== LEXICAL_DISPOSITION.learned) continue;
    rejectionSpecs.push({
      oldClaim: oc,
      record: await buildRejectionRecord({
        claimGroupKey: oc.claimGroupKey,
        valueType: oc.valueType,
        script: oc.script ?? null,
        rejectedValue: oc.value,
        contextConstraints: constraints,
        // §38.0: 明示 dimension は無い（すべて auto-promotable のみ）
        explicitDimensions: [],
        replacementClaimId: null,
        // transaction 内で winner を入れる
        sourceEvidenceId: null,
        // transaction 内で support Evidence を入れる
        reason: REJECTION_REASON.userCorrection,
        now
      })
    });
  }
  if (lexicalDisposition === LEXICAL_DISPOSITION.learned) {
    const lex = builtClaims.find((b) => b.role === "lexical");
    const seg = alignment.changedSourceSegments[0];
    if (lex && seg.outputText && seg.outputText !== lex.correctedSegmentText) {
      rejectionSpecs.push({
        oldClaim: null,
        record: await buildRejectionRecord({
          claimGroupKey: lex.record.claimGroupKey,
          valueType: lex.record.valueType,
          script: lex.record.script ?? null,
          rejectedValue: seg.outputText,
          contextConstraints: constraints,
          explicitDimensions: [],
          reason: REJECTION_REASON.userCorrection,
          now
        })
      });
    }
  }
  const dependentIds = /* @__PURE__ */ new Set();
  for (const oc of oldClaims) {
    const deps = await collectDependents(db, { toNodeId: oc.claimId, relation: RELATION.dependsOn });
    for (const r of deps.items) dependentIds.add(r.fromNodeId);
  }
  const middleBandLexicalIds = /* @__PURE__ */ new Set();
  if (lexicalDisposition === LEXICAL_DISPOSITION.revalidationNeeded) {
    for (const seg of alignment.changedSourceSegments) {
      for (const id of seg.selectedClaimIds ?? []) middleBandLexicalIds.add(id);
    }
  }
  const newClaimLookupKeys = [];
  for (const b of builtClaims) newClaimLookupKeys.push(await getLookupKeysForClaim(b.record));
  const oldClaimLookupKeys = [];
  for (const oc of oldClaims) oldClaimLookupKeys.push(await getLookupKeysForClaim(oc));
  const rejectionGroupCacheKeys = [];
  for (const rs of rejectionSpecs) {
    const groupClaims = await collectClaimsInGroup(db, rs.record.claimGroupKey);
    const keys = /* @__PURE__ */ new Set();
    const ids = [];
    for (const c of groupClaims) {
      ids.push(c.claimId);
      for (const k of await getLookupKeysForClaim(c)) keys.add(k);
    }
    rejectionGroupCacheKeys.push({ lookupKeys: [...keys], claimIds: ids });
  }
  const { result, userDictionaryRevision } = await runSemanticMutation(
    db,
    [STORE.claims, STORE.evidence, STORE.rejections, STORE.history],
    async ({ tx }) => {
      const claimStore = tx.objectStore(STORE.claims);
      const out = {
        claimIds: [],
        evidenceIds: [],
        rejectionIds: [],
        dependents: [],
        revivalBlocked: [],
        lexicalClaimId: null
      };
      const winners = [];
      for (let i = 0; i < builtClaims.length; i++) {
        const b = builtClaims[i];
        const res = await upsertClaimBySemanticKey(tx, {
          semanticKey: b.record.semanticKey,
          build: /* @__PURE__ */ __name(() => b.record, "build")
        });
        const winner = res.record;
        winners.push({ ...b, winner, created: res.created });
        out.claimIds.push(winner.claimId);
        if (res.created) {
          addHistory(tx, buildHistoryRecord({
            nodeId: winner.claimId,
            action: HISTORY_ACTION.claimCreated,
            changes: [],
            actor,
            mutationId: mid,
            detail: { reason: "user_correction", role: b.role, valueType: winner.valueType },
            now
          }));
        } else {
          const tombstoned = winner.deletedAt != null || winner.disabled === true || winner.supersededByClaimId != null || winner.lifecycleState === LIFECYCLE_STATE.archived;
          if (tombstoned) {
            out.revivalBlocked.push({ claimId: winner.claimId, revivalDisposition: "requires_user" });
          } else if (b.role !== "lexical" && (winner.verificationState !== VERIFICATION_STATE.manualCorrected || winner.locked !== true)) {
            await patchClaimExplicitState(tx, winner.claimId, {
              verificationState: VERIFICATION_STATE.manualCorrected,
              locked: true,
              lockMetadata: b.spec.lockMetadata ?? { lockedBy: "user", lockedAt: now }
            }, { now });
            addHistory(tx, buildHistoryRecord({
              nodeId: winner.claimId,
              action: HISTORY_ACTION.claimLocked,
              changes: [{
                field: "verificationState",
                before: winner.verificationState,
                after: VERIFICATION_STATE.manualCorrected
              }],
              actor,
              mutationId: mid,
              detail: { reason: "user_correction" },
              now
            }));
          }
        }
        const fresh = await requestOf10(claimStore.get(winner.claimId));
        await invalidateForClaimIn(tx, fresh, newClaimLookupKeys[i]);
        if (b.role === "lexical") out.lexicalClaimId = winner.claimId;
      }
      const supportIdByRole = /* @__PURE__ */ new Map();
      for (let i = 0; i < supportEvidence.length; i++) {
        const se = supportEvidence[i];
        const winner = winners[i].winner;
        const record = { ...se.record, claimId: winner.claimId };
        const res = await upsertEvidenceByDedupeKey(tx, {
          dedupeKey: record.dedupeKey,
          build: /* @__PURE__ */ __name(() => record, "build")
        });
        out.evidenceIds.push(res.record.evidenceId);
        supportIdByRole.set(winners[i].role, res.record.evidenceId);
        if (res.created && isDecisionAffecting(res.record)) {
          await markClaimScoreInputChanged(tx, winner.claimId);
        }
      }
      for (let i = 0; i < contradictEvidence.length; i++) {
        const ce = contradictEvidence[i];
        const res = await upsertEvidenceByDedupeKey(tx, {
          dedupeKey: ce.record.dedupeKey,
          build: /* @__PURE__ */ __name(() => ce.record, "build")
        });
        out.evidenceIds.push(res.record.evidenceId);
        if (res.created && isDecisionAffecting(res.record)) {
          await markClaimScoreInputChanged(tx, ce.claimId);
        }
        const oldFresh = await requestOf10(claimStore.get(ce.claimId));
        if (oldFresh) await invalidateForClaimIn(tx, oldFresh, oldClaimLookupKeys[i]);
      }
      const replacementClaimId = winners[0]?.winner?.claimId ?? null;
      const supportEvidenceId = out.evidenceIds[0] ?? null;
      for (let i = 0; i < rejectionSpecs.length; i++) {
        const rs = rejectionSpecs[i];
        const record = {
          ...rs.record,
          replacementClaimId,
          sourceEvidenceId: supportEvidenceId
        };
        const res = await upsertRejectionByKey(tx, {
          rejectionKey: record.rejectionKey,
          build: /* @__PURE__ */ __name(() => record, "build")
        });
        out.rejectionIds.push(res.record.rejectionId);
        if (res.created) {
          addHistory(tx, buildHistoryRecord({
            nodeId: res.record.rejectionId,
            action: HISTORY_ACTION.rejectionCreated,
            changes: [],
            actor,
            mutationId: mid,
            detail: { reason: "user_correction", claimGroupKey: record.claimGroupKey },
            now
          }));
        } else if (res.record.state !== REJECTION_STATE.active) {
          await requestOf10(tx.objectStore(STORE.rejections).put({
            ...res.record,
            state: REJECTION_STATE.active,
            supersededByRejectionId: null,
            invalidatedAt: null
          }));
        }
        await invalidateForRejectionIn(
          tx,
          rejectionGroupCacheKeys[i].lookupKeys,
          rejectionGroupCacheKeys[i].claimIds
        );
      }
      const toMark = /* @__PURE__ */ new Set([...dependentIds, ...middleBandLexicalIds]);
      for (const id of out.claimIds) toMark.delete(id);
      for (const id of toMark) {
        const before = await requestOf10(claimStore.get(id));
        if (!before) continue;
        await patchClaimRevalidationState(
          tx,
          id,
          { revalidationState: REVALIDATION_STATE.needed },
          { now }
        );
        await markClaimScoreInputChanged(tx, id);
        addHistory(tx, buildHistoryRecord({
          nodeId: id,
          action: HISTORY_ACTION.claimExplicitStateChanged,
          changes: [{
            field: "revalidationState",
            before: before.revalidationState,
            after: REVALIDATION_STATE.needed
          }],
          actor,
          mutationId: mid,
          detail: { reason: "user_correction_dependency", mutationId: mid },
          now
        }));
        out.dependents.push(id);
      }
      return out;
    },
    { extraStores: [STORE.cache] }
  );
  return {
    disposition: CORRECTION_DISPOSITION.applied,
    reason: alignment.reason,
    mutationId: mid,
    alignment,
    lexicalDisposition,
    valueType: effectiveValueType,
    userDictionaryRevision,
    // §39/§41 診断: 変更されていない Segment を出した Claim。contradict も
    // Rejection も付けていない（ユーザーはこれらを否定していない）。
    untouchedClaimIds,
    ...result
  };
}
__name(applyUserCorrection, "applyUserCorrection");
var POLLUTION_CLUSTER_POLICY = Object.freeze({
  clusterPolicyVersion: 1,
  /** §120-47 / §148.2: 1回の収集で読む上限。無制限走査しない。 */
  maxEvidencePages: 25,
  maxClusterClaims: 500
});

// dictionary-review-queue.js
function requestOf11(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf11, "requestOf");
var ReviewQueueError = class extends Error {
  static {
    __name(this, "ReviewQueueError");
  }
  constructor(message, details) {
    super(message);
    this.name = "ReviewQueueError";
    this.details = details;
  }
};
var REVIEW_POLICY = Object.freeze({
  reviewPolicyVersion: 1,
  minWeight: 0.25,
  maxWeight: 4,
  /** uncertainty=0（confidenceScore=1）でも reviewImpactScore を完全に0へ潰さない。 */
  minUncertaintyFloor: 0.05,
  /** §146.2「conflict」weight。conflictState=conflicted のとき。 */
  conflictWeight: 1.6,
  /** conflict ではないが revalidationState=needed のとき。 */
  needsRevalidationWeight: 1.3,
  /**
   * §146.2「correction opportunity」— 既に確認/公式化されている Claim ほど
   * 追加確認の価値が低い。verificationState ごとの重み（1.0 = 中立）。
   */
  correctionOpportunityByVerification: Object.freeze({
    none: 1.4,
    legacy_user: 1.3,
    explicit_user_confirmed: 1,
    manual_entered: 0.6,
    manual_corrected: 0.5,
    official: 0.3,
    default: 1
  }),
  /** §146.3: bounded 母集団の生成元 index ごとの上限 page 数 / page size。 */
  candidateSourcePageSize: 200,
  maxPagesPerSource: 8,
  /** 複数 source を merge した後の Pool 総上限（§146.3「巨大 Queue Snapshot を正本化しない」）。 */
  maxCandidatePoolSize: 1500,
  /** §110.1 と同じ既定 page / 上限 page。 */
  defaultPageSize: 50,
  maxPageSize: 200,
  /** Needs Attention の bounded source 設定（Active Review と共有しない別 Pool）。 */
  attentionSourcePageSize: 200,
  maxAttentionPagesPerSource: 8,
  maxAttentionPoolSize: 1500,
  /** Evidence details（bounded）。raw history 全量を見せない。 */
  evidenceDetailPageSize: 20,
  evidenceDetailMaxRecords: 100
});
function clampWeight2(w) {
  if (!Number.isFinite(w)) return 1;
  return Math.min(REVIEW_POLICY.maxWeight, Math.max(REVIEW_POLICY.minWeight, w));
}
__name(clampWeight2, "clampWeight");
function log2Compress2(n) {
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  return 1 + Math.log2(1 + v);
}
__name(log2Compress2, "log2Compress");
function computeReviewImpactScore({
  uncertainty = 0.5,
  useCount = 0,
  dependentCount = 0,
  scopeBreadth = 0,
  conflicted = false,
  needsRevalidation = false,
  verificationState = VERIFICATION_STATE.none
} = {}) {
  const u = Number.isFinite(uncertainty) ? Math.min(1, Math.max(0, uncertainty)) : 0.5;
  const uncertaintyWeight = Math.max(u, REVIEW_POLICY.minUncertaintyFloor);
  const usageWeight = log2Compress2(useCount);
  const dependentImpactWeight = log2Compress2(dependentCount);
  const scopeWeight = log2Compress2(scopeBreadth);
  const conflictWeight = clampWeight2(conflicted ? REVIEW_POLICY.conflictWeight : needsRevalidation ? REVIEW_POLICY.needsRevalidationWeight : 1);
  const correctionOpportunityWeight = clampWeight2(
    REVIEW_POLICY.correctionOpportunityByVerification[verificationState] ?? REVIEW_POLICY.correctionOpportunityByVerification.default
  );
  const reviewImpactScore = uncertaintyWeight * usageWeight * dependentImpactWeight * scopeWeight * conflictWeight * correctionOpportunityWeight;
  return {
    reviewImpactScore,
    reviewPolicyVersion: REVIEW_POLICY.reviewPolicyVersion,
    inputs: {
      uncertainty: u,
      useCount,
      dependentCount,
      scopeBreadth,
      conflicted: Boolean(conflicted),
      needsRevalidation: Boolean(needsRevalidation),
      verificationState
    }
  };
}
__name(computeReviewImpactScore, "computeReviewImpactScore");
function isLiveClaim(claim) {
  return !claim.deletedAt && claim.disabled !== true && claim.lifecycleState !== LIFECYCLE_STATE.archived && !claim.supersededByClaimId;
}
__name(isLiveClaim, "isLiveClaim");
function reviewQueueStateOf(claim) {
  return claim.reviewQueueState ?? null;
}
__name(reviewQueueStateOf, "reviewQueueStateOf");
function isTemporarilySuppressed(claim, now) {
  const s = reviewQueueStateOf(claim);
  if (!s) return false;
  const deferred = Number.isFinite(s.deferredUntil) && s.deferredUntil > now;
  const hidden = Number.isFinite(s.hiddenUntil) && s.hiddenUntil > now;
  return deferred || hidden;
}
__name(isTemporarilySuppressed, "isTemporarilySuppressed");
async function collectBoundedByIndex(db, { indexName, query, pageSize, maxPages }) {
  const items = [];
  let cursor = null;
  let truncated = false;
  let pages = 0;
  for (let p = 0; p < maxPages; p++) {
    const page = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName,
      query: cursor ? void 0 : query,
      limit: pageSize,
      cursor
    });
    pages++;
    items.push(...page.items);
    if (page.done) break;
    cursor = page.nextCursor;
    if (p === maxPages - 1) truncated = true;
  }
  return { items, truncated, pages };
}
__name(collectBoundedByIndex, "collectBoundedByIndex");
async function gatherReviewImpactCandidates(db, {
  policy = REVIEW_POLICY,
  now = Date.now(),
  includeSuppressed = false
} = {}) {
  const sources = {};
  let scanned = 0;
  let truncated = false;
  const merged = /* @__PURE__ */ new Map();
  const conflicted = await collectBoundedByIndex(db, {
    indexName: "conflictState",
    query: IDBKeyRange.only(CONFLICT_STATE.conflicted),
    pageSize: policy.candidateSourcePageSize,
    maxPages: policy.maxPagesPerSource
  });
  sources.conflicted = { count: conflicted.items.length, truncated: conflicted.truncated };
  scanned += conflicted.items.length;
  truncated = truncated || conflicted.truncated;
  for (const c of conflicted.items) merged.set(c.claimId, c);
  const needsReval = await collectBoundedByIndex(db, {
    indexName: "revalidationState",
    query: IDBKeyRange.only(REVALIDATION_STATE.needed),
    pageSize: policy.candidateSourcePageSize,
    maxPages: policy.maxPagesPerSource
  });
  sources.needsRevalidation = { count: needsReval.items.length, truncated: needsReval.truncated };
  scanned += needsReval.items.length;
  truncated = truncated || needsReval.truncated;
  for (const c of needsReval.items) merged.set(c.claimId, c);
  let items = [...merged.values()].filter(isLiveClaim);
  if (!includeSuppressed) items = items.filter((c) => !isTemporarilySuppressed(c, now));
  if (items.length > policy.maxCandidatePoolSize) {
    items = items.slice(0, policy.maxCandidatePoolSize);
    truncated = true;
  }
  return { items, scanned, sources, truncated };
}
__name(gatherReviewImpactCandidates, "gatherReviewImpactCandidates");
async function scoreCandidate(db, claim) {
  const deps = await collectDependents(db, { toNodeId: claim.claimId, relation: RELATION.dependsOn });
  const profile = claim.applicabilityProfile ?? {};
  const scopeBreadth = (profile.distinctEntities ?? 0) + (profile.distinctPhrases ?? 0);
  const scored = computeReviewImpactScore({
    uncertainty: 1 - Math.min(1, Math.max(0, claim.confidenceScore ?? 0)),
    useCount: claim.useCount ?? 0,
    dependentCount: deps.items.length,
    scopeBreadth,
    conflicted: claim.conflictState === CONFLICT_STATE.conflicted,
    needsRevalidation: claim.revalidationState === REVALIDATION_STATE.needed,
    verificationState: claim.verificationState ?? VERIFICATION_STATE.none
  });
  return {
    claimId: claim.claimId,
    subjectKind: claim.subjectKind,
    sourceText: claim.sourceText ?? null,
    value: claim.value,
    valueType: claim.valueType,
    trustTier: claim.trustTier ?? null,
    conflictState: claim.conflictState ?? null,
    revalidationState: claim.revalidationState ?? null,
    verificationState: claim.verificationState ?? null,
    locked: Boolean(claim.locked),
    useCount: claim.useCount ?? 0,
    dependentCount: deps.items.length,
    dependentCountTruncated: deps.truncated,
    updatedAt: claim.updatedAt ?? 0,
    reviewQueueState: reviewQueueStateOf(claim),
    ...scored
  };
}
__name(scoreCandidate, "scoreCandidate");
function createActiveReviewQueueSession(db, { policy = REVIEW_POLICY } = {}) {
  let pool = [];
  let poolMeta = { scanned: 0, sources: {}, truncated: false };
  let view = [];
  let comparator = /* @__PURE__ */ __name((a, b) => b.reviewImpactScore - a.reviewImpactScore || String(a.claimId).localeCompare(String(b.claimId)), "comparator");
  let predicate = null;
  function recompute() {
    let items = pool;
    if (predicate) items = items.filter(predicate);
    view = [...items].sort(comparator);
  }
  __name(recompute, "recompute");
  return {
    /** bounded gather + score（DB を叩く唯一の場所）。 */
    async refresh({ now = Date.now(), includeSuppressed = false } = {}) {
      const gathered = await gatherReviewImpactCandidates(db, { policy, now, includeSuppressed });
      const scored = [];
      for (const claim of gathered.items) scored.push(await scoreCandidate(db, claim));
      pool = scored;
      poolMeta = { scanned: gathered.scanned, sources: gathered.sources, truncated: gathered.truncated };
      recompute();
      return { poolSize: pool.length, ...poolMeta, aiCalls: 0 };
    },
    /** 純粋 in-memory sort。AI call 0 / DB read 0。 */
    sort(cmp) {
      comparator = typeof cmp === "function" ? cmp : comparator;
      recompute();
      return this;
    },
    /** 純粋 in-memory filter。AI call 0 / DB read 0。 */
    filter(pred) {
      predicate = typeof pred === "function" ? pred : null;
      recompute();
      return this;
    },
    /** bounded page（in-memory slice）。 */
    page({ offset = 0, limit = policy.defaultPageSize } = {}) {
      const pageLimit = Math.max(1, Math.min(limit, policy.maxPageSize));
      const items = view.slice(offset, offset + pageLimit);
      const done = offset + items.length >= view.length;
      return {
        items,
        nextCursor: done ? null : { offset: offset + items.length },
        done,
        poolSize: view.length,
        ...poolMeta,
        aiCalls: 0
      };
    },
    get poolSize() {
      return view.length;
    }
  };
}
__name(createActiveReviewQueueSession, "createActiveReviewQueueSession");
function assertFiniteFutureishTimestamp(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new ReviewQueueError(`${fieldName} must be a finite timestamp (ms epoch)`, { value });
  }
}
__name(assertFiniteFutureishTimestamp, "assertFiniteFutureishTimestamp");
async function patchReviewQueueState(db, claimId, patch, { actor, mutationId, now }) {
  if (typeof actor !== "string" || !actor) {
    throw new ReviewQueueError("review queue mutation requires an explicit actor string", {});
  }
  const mid = mutationId ?? newOpaqueId("mut");
  const { result } = await runSemanticMutation(db, [STORE.claims], async ({ tx }) => {
    const current = await requestOf11(tx.objectStore(STORE.claims).get(claimId));
    if (!current) throw new ReviewQueueError(`claim not found: ${claimId}`, { claimId });
    const nextState = { ...current.reviewQueueState ?? {}, ...patch };
    return patchClaimReviewQueueState(tx, claimId, { reviewQueueState: nextState }, { now });
  }, { bumpRevision: false });
  return { claim: result, mutationId: mid };
}
__name(patchReviewQueueState, "patchReviewQueueState");
async function deferClaimReview(db, claimId, {
  actor,
  until,
  reason = null,
  mutationId = null,
  now = Date.now()
} = {}) {
  assertFiniteFutureishTimestamp(until, "until");
  return patchReviewQueueState(db, claimId, {
    deferredUntil: until,
    deferredAt: now,
    deferredBy: actor,
    deferReason: reason
  }, { actor, mutationId, now });
}
__name(deferClaimReview, "deferClaimReview");
async function hideClaimReviewTemporarily(db, claimId, {
  actor,
  until,
  reason = null,
  mutationId = null,
  now = Date.now()
} = {}) {
  assertFiniteFutureishTimestamp(until, "until");
  return patchReviewQueueState(db, claimId, {
    hiddenUntil: until,
    hiddenAt: now,
    hiddenBy: actor,
    hideReason: reason
  }, { actor, mutationId, now });
}
__name(hideClaimReviewTemporarily, "hideClaimReviewTemporarily");
var ATTENTION_REASON = Object.freeze({
  conflict: "conflict",
  quarantine: "quarantine",
  needsRevalidation: "needs_revalidation"
});
async function collectQuarantineCandidates(db, { pageSize, maxPages }) {
  return collectBoundedByIndex(db, { indexName: "stagingSessionId", query: null, pageSize, maxPages });
}
__name(collectQuarantineCandidates, "collectQuarantineCandidates");
async function gatherNeedsAttention(db, { policy = REVIEW_POLICY, now = Date.now() } = {}) {
  const merged = /* @__PURE__ */ new Map();
  let scanned = 0;
  let truncated = false;
  function addReason(claim, reason) {
    const existing = merged.get(claim.claimId);
    if (existing) {
      existing.reasons.add(reason);
      return;
    }
    merged.set(claim.claimId, { claim, reasons: /* @__PURE__ */ new Set([reason]) });
  }
  __name(addReason, "addReason");
  const conflicted = await collectBoundedByIndex(db, {
    indexName: "conflictState",
    query: IDBKeyRange.only(CONFLICT_STATE.conflicted),
    pageSize: policy.attentionSourcePageSize,
    maxPages: policy.maxAttentionPagesPerSource
  });
  scanned += conflicted.items.length;
  truncated = truncated || conflicted.truncated;
  for (const c of conflicted.items) if (isLiveClaim(c)) addReason(c, ATTENTION_REASON.conflict);
  const needsReval = await collectBoundedByIndex(db, {
    indexName: "revalidationState",
    query: IDBKeyRange.only(REVALIDATION_STATE.needed),
    pageSize: policy.attentionSourcePageSize,
    maxPages: policy.maxAttentionPagesPerSource
  });
  scanned += needsReval.items.length;
  truncated = truncated || needsReval.truncated;
  for (const c of needsReval.items) if (isLiveClaim(c)) addReason(c, ATTENTION_REASON.needsRevalidation);
  const quarantined = await collectQuarantineCandidates(db, {
    pageSize: policy.attentionSourcePageSize,
    maxPages: policy.maxAttentionPagesPerSource
  });
  scanned += quarantined.items.length;
  truncated = truncated || quarantined.truncated;
  for (const c of quarantined.items) {
    if (c.quarantined === true && isLiveClaim(c)) addReason(c, ATTENTION_REASON.quarantine);
  }
  let items = [...merged.values()];
  if (items.length > policy.maxAttentionPoolSize) {
    items = items.slice(0, policy.maxAttentionPoolSize);
    truncated = true;
  }
  const REASON_RANK = {
    [ATTENTION_REASON.conflict]: 3,
    [ATTENTION_REASON.quarantine]: 2,
    [ATTENTION_REASON.needsRevalidation]: 1
  };
  const rows = items.map(({ claim, reasons }) => ({
    claimId: claim.claimId,
    subjectKind: claim.subjectKind,
    sourceText: claim.sourceText ?? null,
    value: claim.value,
    valueType: claim.valueType,
    reasons: [...reasons].sort((a, b) => REASON_RANK[b] - REASON_RANK[a]),
    maxReasonRank: Math.max(...[...reasons].map((r) => REASON_RANK[r])),
    updatedAt: claim.updatedAt ?? 0
  }));
  rows.sort((a, b) => b.reasons.length - a.reasons.length || b.maxReasonRank - a.maxReasonRank || b.updatedAt - a.updatedAt || String(a.claimId).localeCompare(String(b.claimId)));
  return { items: rows, scanned, truncated };
}
__name(gatherNeedsAttention, "gatherNeedsAttention");
function pageNeedsAttention(rows, { offset = 0, limit = REVIEW_POLICY.defaultPageSize } = {}) {
  const pageLimit = Math.max(1, Math.min(limit, REVIEW_POLICY.maxPageSize));
  const items = rows.slice(offset, offset + pageLimit);
  const done = offset + items.length >= rows.length;
  return { items, nextCursor: done ? null : { offset: offset + items.length }, done, poolSize: rows.length };
}
__name(pageNeedsAttention, "pageNeedsAttention");
async function getReviewQueueEvidenceDetails(db, claimId, {
  limit = REVIEW_POLICY.evidenceDetailPageSize,
  maxRecords = REVIEW_POLICY.evidenceDetailMaxRecords
} = {}) {
  const claim = await getClaim(db, claimId);
  if (!claim) throw new ReviewQueueError(`claim not found: ${claimId}`, { claimId });
  const collected = await collectEvidenceForClaim(db, claimId, { pageSize: limit, maxRecords });
  const items = collected.items.map((ev) => ({
    evidenceId: ev.evidenceId,
    evidenceType: ev.evidenceType,
    stance: ev.stance,
    provider: ev.provider ?? null,
    modelFamily: ev.modelFamily ?? null,
    lineageClassification: ev.lineageClassification ?? null,
    originPackageKey: ev.originPackageKey ?? null,
    originPackageVersion: ev.originPackageVersion ?? null,
    anchored: Boolean(ev.anchored),
    novelClaim: Boolean(ev.novelClaim),
    invalidatedAt: ev.invalidatedAt ?? null,
    invalidationReason: ev.invalidationReason ?? null,
    createdAt: ev.createdAt,
    // §114: raw contextSnapshot / qualityDiagnostics は出さない。診断に必要な
    // 最小要約だけ（生の originalName / secret / API key を含まない）。
    hasContext: Boolean(ev.contextSnapshot)
  }));
  return { claimId, items, truncated: collected.truncated, total: null };
}
__name(getReviewQueueEvidenceDetails, "getReviewQueueEvidenceDetails");
async function confirmReviewQueueClaim(db, claimId, {
  actor,
  mutationId = null,
  originInstallationId = "local",
  now = Date.now()
} = {}) {
  if (typeof actor !== "string" || !actor) {
    throw new ReviewQueueError("confirmReviewQueueClaim requires an explicit actor string", {});
  }
  const claim = await getClaim(db, claimId);
  if (!claim) throw new ReviewQueueError(`claim not found: ${claimId}`, { claimId });
  const mid = mutationId ?? newOpaqueId("mut");
  const evidence = await recordEvidence(db, {
    evidenceType: EVIDENCE_TYPE.explicitUserConfirmation,
    stance: STANCE.support,
    claimId: claim.claimId,
    claimSemanticKey: claim.semanticKey,
    valueType: claim.valueType,
    mutationId: mid,
    originInstallationId,
    context: { rawFacts: { originalName: claim.sourceText ?? null } },
    now
  });
  return {
    disposition: "confirmed",
    claimId: claim.claimId,
    evidenceId: evidence.evidence.evidenceId,
    duplicate: evidence.duplicate,
    mutationId: mid
  };
}
__name(confirmReviewQueueClaim, "confirmReviewQueueClaim");
function entityIdentityFromSubjectKey(subjectKey) {
  if (typeof subjectKey !== "string" || !subjectKey.startsWith("entity:")) return { target: null, fmId: null };
  const rest = subjectKey.slice("entity:".length);
  const idx = rest.indexOf(":");
  if (idx < 0) return { target: null, fmId: null };
  return { target: rest.slice(0, idx), fmId: rest.slice(idx + 1) };
}
__name(entityIdentityFromSubjectKey, "entityIdentityFromSubjectKey");
function wholeValueSourceMap({ sourceText, originalOutput, claimId }) {
  return [{
    segmentId: "review_queue_whole",
    mapKind: "source_segment",
    sourceStart: 0,
    sourceEnd: sourceText.length,
    sourceText,
    outputStart: 0,
    outputEnd: originalOutput.length,
    outputText: originalOutput,
    selectedClaimIds: [claimId],
    method: "review_queue"
  }];
}
__name(wholeValueSourceMap, "wholeValueSourceMap");
async function applyReviewQueueCorrection(db, claimId, correctedValue, {
  actor,
  mutationId = null,
  originInstallationId = "local",
  target = null,
  countryCode = null,
  worldRegionCode = null,
  now = Date.now()
} = {}) {
  if (typeof actor !== "string" || !actor) {
    throw new ReviewQueueError("applyReviewQueueCorrection requires an explicit actor string", {});
  }
  if (typeof correctedValue !== "string" || correctedValue.length === 0) {
    throw new ReviewQueueError("applyReviewQueueCorrection requires a non-empty correctedValue string", {});
  }
  const claim = await getClaim(db, claimId);
  if (!claim) throw new ReviewQueueError(`claim not found: ${claimId}`, { claimId });
  if (typeof claim.value !== "string") {
    throw new ReviewQueueError("applyReviewQueueCorrection only supports string-valued Claims", { claimId });
  }
  let effectiveTarget = target;
  let fmId = null;
  if (claim.subjectKind === SUBJECT_KIND.entity) {
    const ident = entityIdentityFromSubjectKey(claim.subjectKey);
    effectiveTarget = effectiveTarget ?? ident.target;
    fmId = ident.fmId;
  }
  const sourceText = claim.sourceText;
  const originalOutput = claim.value;
  const sourceMap = wholeValueSourceMap({ sourceText, originalOutput, claimId });
  const fingerprint = `review_queue:${claimId}:${sourceText}`;
  const result = await applyUserCorrection(db, {
    target: effectiveTarget,
    fmId,
    sourceText,
    valueType: claim.valueType,
    script: claim.script ?? null,
    originalOutput,
    correctedOutput: correctedValue,
    sourceMap,
    rowInputFingerprint: fingerprint,
    currentInputFingerprint: fingerprint,
    previousClaimIds: [claimId],
    countryCode,
    worldRegionCode,
    now
  }, { actor, mutationId, originInstallationId });
  return result;
}
__name(applyReviewQueueCorrection, "applyReviewQueueCorrection");

// dictionary-safe-undo.js
function requestOf12(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(requestOf12, "requestOf");
var SafeUndoError = class extends Error {
  static {
    __name(this, "SafeUndoError");
  }
  constructor(message, details) {
    super(message);
    this.name = "SafeUndoError";
    this.details = details;
  }
};
var MUTATION_KIND = Object.freeze({
  aiBatch: "ai_batch",
  packageMutation: "package_mutation",
  revalidation: "revalidation"
});
var SAFE_UNDO_POLICY = Object.freeze({
  safeUndoPolicyVersion: 1,
  chunkSize: 200,
  /** preview は forEachChunk（§102.1 previewDestructiveReset と同じ既定 precedent）。 */
  previewChunkSize: 500,
  maintenanceLeaseTtlMs: 3e4
});
var PROTECTED_VERIFICATION_STATES = /* @__PURE__ */ new Set([
  VERIFICATION_STATE.manualEntered,
  VERIFICATION_STATE.manualCorrected,
  VERIFICATION_STATE.official
]);
function isLaterManualOrLocked(claim) {
  return claim.locked === true || PROTECTED_VERIFICATION_STATES.has(claim.verificationState);
}
__name(isLaterManualOrLocked, "isLaterManualOrLocked");
async function previewPackageMutationUndo(db, {
  packageId,
  packageVersion,
  policy = SAFE_UNDO_POLICY
} = {}) {
  if (typeof packageId !== "string" || !packageId) {
    throw new SafeUndoError("previewPackageMutationUndo requires packageId", {});
  }
  if (typeof packageVersion !== "string" || !packageVersion) {
    throw new SafeUndoError("previewPackageMutationUndo requires packageVersion", {});
  }
  const packageKey = packageKeyFor(packageId);
  const affectedClaimIds = /* @__PURE__ */ new Set();
  const protectedClaimIds = /* @__PURE__ */ new Set();
  let evidenceToInvalidate = 0;
  let cursor = null;
  let truncated = false;
  for (; ; ) {
    const page = await iterateIndex(db, {
      storeName: STORE.evidence,
      indexName: "originPackageKey",
      query: cursor ? void 0 : IDBKeyRange.only(packageKey),
      limit: policy.chunkSize,
      cursor
    });
    for (const ev of page.items) {
      if (ev.originPackageVersion !== packageVersion || ev.invalidatedAt != null) continue;
      evidenceToInvalidate += 1;
      affectedClaimIds.add(ev.claimId);
    }
    if (page.done) break;
    cursor = page.nextCursor;
  }
  if (affectedClaimIds.size > 0) {
    await runRead(db, [STORE.claims], async ({ store }) => {
      for (const id of affectedClaimIds) {
        const c = await requestOf12(store(STORE.claims).get(id));
        if (c && isLaterManualOrLocked(c)) protectedClaimIds.add(id);
      }
    });
  }
  return {
    mutationKind: MUTATION_KIND.packageMutation,
    packageId,
    packageVersion,
    evidenceToInvalidate,
    claimsAffected: affectedClaimIds.size,
    claimsProtected: protectedClaimIds.size,
    truncated
  };
}
__name(previewPackageMutationUndo, "previewPackageMutationUndo");
async function undoPackageMutation(db, {
  packageId,
  packageVersion,
  actor,
  confirm = false,
  owner = void 0,
  now = Date.now(),
  policy = SAFE_UNDO_POLICY
} = {}) {
  if (confirm !== true) {
    throw new SafeUndoError("undoPackageMutation requires explicit confirm:true", {});
  }
  if (typeof actor !== "string" || !actor) {
    throw new SafeUndoError("undoPackageMutation requires an explicit actor string", {});
  }
  if (typeof packageId !== "string" || !packageId) {
    throw new SafeUndoError("undoPackageMutation requires packageId", {});
  }
  if (typeof packageVersion !== "string" || !packageVersion) {
    throw new SafeUndoError("undoPackageMutation requires packageVersion", {});
  }
  const packageKey = packageKeyFor(packageId);
  const undoMutationId = newOpaqueId(ID_PREFIXES.mutation);
  const lease = await acquireMaintenanceLease(db, {
    type: "package_mutation_undo",
    ttlMs: policy.maintenanceLeaseTtlMs,
    ...owner ? { owner } : {},
    now
  });
  const fence = { ...owner ? { owner } : { owner: lease.owner }, leaseEpoch: lease.leaseEpoch };
  const renew = /* @__PURE__ */ __name(async () => {
    await renewMaintenanceLease(db, {
      ...owner ? { owner } : { owner: lease.owner },
      leaseEpoch: lease.leaseEpoch,
      ttlMs: policy.maintenanceLeaseTtlMs
    });
  }, "renew");
  let invalidatedEvidence = 0;
  let recomputedClaims = 0;
  let protectedClaims = 0;
  let failedClaims = 0;
  const touchedClaims = /* @__PURE__ */ new Set();
  try {
    let cursor = null;
    for (; ; ) {
      const page = await iterateIndex(db, {
        storeName: STORE.evidence,
        indexName: "originPackageKey",
        query: cursor ? void 0 : IDBKeyRange.only(packageKey),
        limit: policy.chunkSize,
        cursor
      });
      const targets = page.items.filter((ev) => ev.originPackageVersion === packageVersion && ev.invalidatedAt == null);
      if (!targets.length) {
        if (page.done) break;
        cursor = page.nextCursor;
        await renew();
        continue;
      }
      await runSemanticMutation(db, [STORE.evidence, STORE.claims], async ({ tx }) => {
        const evStore = tx.objectStore(STORE.evidence);
        for (const ev of targets) {
          const current = await requestOf12(evStore.get(ev.evidenceId));
          if (!current || current.invalidatedAt != null) continue;
          await requestOf12(evStore.put({
            ...current,
            invalidatedAt: now,
            invalidationReason: `mutation_undo:${undoMutationId}`
          }));
          invalidatedEvidence += 1;
          if (isDecisionAffecting(current) && !touchedClaims.has(current.claimId)) {
            touchedClaims.add(current.claimId);
            const claim = await requestOf12(tx.objectStore(STORE.claims).get(current.claimId));
            if (!claim) {
              failedClaims += 1;
              continue;
            }
            await markClaimScoreInputChanged(tx, current.claimId);
            await patchClaimRevalidationState(
              tx,
              current.claimId,
              { revalidationState: REVALIDATION_STATE.needed },
              { now }
            );
            recomputedClaims += 1;
            if (isLaterManualOrLocked(claim)) protectedClaims += 1;
          }
        }
      }, { fence, bumpRevision: true });
      await renew();
      if (page.done) break;
      cursor = page.nextCursor;
    }
    if (invalidatedEvidence > 0) {
      await runSemanticMutation(db, [STORE.meta], async ({ meta, patchMeta }) => {
        patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
      }, { fence, bumpRevision: false });
      await clearResolutionCache(db);
    }
  } finally {
    try {
      await releaseMaintenanceLease(db, {
        ...owner ? { owner } : { owner: lease.owner },
        leaseEpoch: lease.leaseEpoch
      });
    } catch {
    }
  }
  return {
    mutationKind: MUTATION_KIND.packageMutation,
    undoMutationId,
    packageId,
    packageVersion,
    invalidatedEvidence,
    claimsRecomputed: recomputedClaims,
    claimsLaterManualOrLocked: protectedClaims,
    claimsFailed: failedClaims,
    partial: false,
    completed: true
  };
}
__name(undoPackageMutation, "undoPackageMutation");
async function previewMutationIdUndo(db, {
  mutationId,
  mutationKind = MUTATION_KIND.aiBatch,
  policy = SAFE_UNDO_POLICY
} = {}) {
  if (typeof mutationId !== "string" || !mutationId) {
    throw new SafeUndoError("previewMutationIdUndo requires mutationId", {});
  }
  const affectedClaimIds = /* @__PURE__ */ new Set();
  const protectedClaimIds = /* @__PURE__ */ new Set();
  let evidenceToInvalidate = 0;
  let scanned = 0;
  await forEachChunk(db, STORE.evidence, (items) => {
    for (const ev of items) {
      scanned += 1;
      if (ev.mutationId === mutationId && ev.invalidatedAt == null) {
        evidenceToInvalidate += 1;
        affectedClaimIds.add(ev.claimId);
      }
    }
  }, { chunkSize: policy.previewChunkSize });
  if (affectedClaimIds.size > 0) {
    await runRead(db, [STORE.claims], async ({ store }) => {
      for (const id of affectedClaimIds) {
        const c = await requestOf12(store(STORE.claims).get(id));
        if (c && isLaterManualOrLocked(c)) protectedClaimIds.add(id);
      }
    });
  }
  return {
    mutationKind,
    mutationId,
    evidenceToInvalidate,
    claimsAffected: affectedClaimIds.size,
    claimsProtected: protectedClaimIds.size,
    scanned
  };
}
__name(previewMutationIdUndo, "previewMutationIdUndo");
async function createMutationIdUndoJob(db, {
  mutationId,
  mutationKind = MUTATION_KIND.aiBatch,
  now = Date.now()
} = {}) {
  if (typeof mutationId !== "string" || !mutationId) {
    throw new SafeUndoError("createMutationIdUndoJob requires mutationId", {});
  }
  return createJob(db, {
    type: JOB_TYPE.mutationUndo,
    mode: JOB_MODE.local,
    query: { mutationId, mutationKind },
    requiresFinalRescan: false,
    now
  });
}
__name(createMutationIdUndoJob, "createMutationIdUndoJob");
async function runMutationIdUndoToCompletion(db, jobId, {
  owner = OWNER_TOKEN,
  leaseEpoch = null,
  maxRuns = 200,
  now = /* @__PURE__ */ __name(() => Date.now(), "now")
} = {}) {
  const job0 = await getJob(db, jobId);
  if (!job0) throw new SafeUndoError(`job not found: ${jobId}`, { jobId });
  const { mutationId } = job0.query ?? {};
  if (typeof mutationId !== "string" || !mutationId) {
    throw new SafeUndoError("mutation undo job is missing query.mutationId", { jobId });
  }
  let packageEvidenceTouched = false;
  let lastOutcome = null;
  for (let i = 0; i < maxRuns; i++) {
    lastOutcome = await runJobChunks(db, jobId, {
      executorKind: EXECUTOR_KIND.local,
      owner,
      leaseEpoch: i === 0 ? leaseEpoch : null,
      // commit() は evidence を invalidate し、影響 Claim の
      // evidenceInvalidation / revalidationWorkflow field を同一 transaction
      // で patch する。両 Store を transaction scope へ入れる。
      commitStores: [STORE.evidence, STORE.claims],
      bumpRevision: true,
      now,
      select: /* @__PURE__ */ __name((cursor) => selectChunk(db, {
        storeName: STORE.evidence,
        cursor,
        filter: /* @__PURE__ */ __name((ev) => ev.mutationId === mutationId && ev.invalidatedAt == null, "filter")
      }), "select"),
      commit: /* @__PURE__ */ __name(async (items, { tx, chunkMutationId }) => {
        let changed = 0;
        const evStore = tx.objectStore(STORE.evidence);
        const touchedThisChunk = /* @__PURE__ */ new Set();
        for (const item of items) {
          const current = await requestOf12(evStore.get(item.evidenceId));
          if (!current || current.invalidatedAt != null) continue;
          await requestOf12(evStore.put({
            ...current,
            invalidatedAt: Date.now(),
            invalidationReason: `mutation_undo:${chunkMutationId}`
          }));
          changed += 1;
          if (current.originPackageKey) packageEvidenceTouched = true;
          if (isDecisionAffecting(current) && !touchedThisChunk.has(current.claimId)) {
            touchedThisChunk.add(current.claimId);
            const claim = await requestOf12(tx.objectStore(STORE.claims).get(current.claimId));
            if (claim) {
              await markClaimScoreInputChanged(tx, current.claimId);
              await patchClaimRevalidationState(
                tx,
                current.claimId,
                { revalidationState: REVALIDATION_STATE.needed },
                { now: Date.now() }
              );
            }
          }
        }
        return { processed: items.length, changed };
      }, "commit")
    });
    if (lastOutcome.stopped === "completed" || lastOutcome.stopped === "paused" || lastOutcome.stopped === "cancelled" || lastOutcome.stopped === "fenced_out") break;
  }
  return { ...lastOutcome, packageEvidenceTouched };
}
__name(runMutationIdUndoToCompletion, "runMutationIdUndoToCompletion");
async function undoMutationById(db, {
  mutationId,
  mutationKind = MUTATION_KIND.aiBatch,
  actor,
  confirm = false,
  now = Date.now()
} = {}) {
  if (confirm !== true) throw new SafeUndoError("undoMutationById requires explicit confirm:true", {});
  if (typeof actor !== "string" || !actor) {
    throw new SafeUndoError("undoMutationById requires an explicit actor string", {});
  }
  const job = await createMutationIdUndoJob(db, { mutationId, mutationKind, now });
  const outcome = await runMutationIdUndoToCompletion(db, job.jobId, { now: /* @__PURE__ */ __name(() => Date.now(), "now") });
  const finalJob = outcome.job;
  if ((finalJob?.counts?.changed ?? 0) > 0) await clearResolutionCache(db);
  if (outcome.packageEvidenceTouched === true) {
    await runSemanticMutation(db, [STORE.meta], async ({ meta, patchMeta }) => {
      patchMeta({ packageStateRevision: (meta.packageStateRevision ?? 0) + 1 });
    }, { bumpRevision: false });
  }
  return {
    mutationKind,
    mutationId,
    jobId: job.jobId,
    completed: outcome.stopped === "completed",
    stopped: outcome.stopped,
    partial: outcome.stopped !== "completed",
    counts: finalJob?.counts ?? null
  };
}
__name(undoMutationById, "undoMutationById");

// dictionary-manager-ui.js
function mbOf(bytes) {
  return (bytes / 1e6).toFixed(1);
}
__name(mbOf, "mbOf");
var KEPT_REASON = {
  ja: { legacy: "旧版 v1.6.0 のキャッシュ", "no-build-id": "build ID の無い開発版のキャッシュ", unverified: "この削除方式への対応を確認できないキャッシュ" },
  en: { legacy: "old v1.6.0 cache", "no-build-id": "development build without a build ID", unverified: "not confirmed to support this safe deletion" }
};
function keptList(lang, kept) {
  if (!kept || !kept.length) return "";
  const total = mbOf(kept.reduce((n, x) => n + x.bytes, 0));
  const why = /* @__PURE__ */ __name((x) => KEPT_REASON[lang][x.reason] || KEPT_REASON[lang].unverified, "why");
  return lang === "ja" ? `
【安全のため残すもの】（削除しません・合計 約 ${total} MB）
${kept.map((x) => `・${x.name}（約 ${mbOf(x.bytes)} MB・${why(x)}）`).join("\n")}` : `
Kept for safety (not deleted, about ${total} MB in total):
${kept.map((x) => `- ${x.name} (about ${mbOf(x.bytes)} MB, ${why(x)})`).join("\n")}`;
}
__name(keptList, "keptList");
var MANAGER_I18N_EN = {
  title: "Dictionary Manager",
  close: "Close",
  search: "Search",
  searchPh: "source or reading prefix…",
  searchMode: "Search by",
  clearSearch: "Clear search",
  searchHint: /* @__PURE__ */ __name((m) => `To find a Japanese reading, choose “${m}”. Enter searches, Esc clears.`, "searchHint"),
  mode_prefix_source: "source (prefix)",
  mode_prefix_value: "reading (prefix)",
  mode_exact: "source (exact)",
  mode_alias: "alias",
  mode_recent: "recent",
  col_source: "Source",
  col_ja: "Japanese",
  col_kind: "Kind",
  col_tier: "Trust",
  col_state: "State",
  col_use: "Uses",
  col_actions: "Actions",
  prev: "Prev",
  next: "Next",
  page: "page",
  rows: "rows",
  capReached: "result cap reached — refine the search",
  detail: "Detail",
  lock: "Lock",
  unlock: "Unlock",
  disable: "Disable",
  del: "Soft delete",
  revive: "Revive",
  edit: "Edit value",
  editPrompt: "New value:",
  health: "Health",
  doctor: "Doctor scan",
  stats: "Learning stats",
  reval: "Revalidation overview",
  ev: "Evidence",
  rel: "Relations",
  hist: "History",
  rej: "Rejections",
  trace: "Source trace",
  backupTitle: "Backup / Restore / Merge / Maintenance",
  downloadBackup: "Download Full Backup",
  restoreBtn: "Full Restore (replace)…",
  mergeBtn: "Merge from file…",
  restoreDesc: "Restore REPLACES your whole dictionary with the backup file.",
  mergeDesc: "Merge ADDS the backup into your dictionary (existing entries are kept).",
  restoreConfirm: "This will REPLACE your entire local dictionary. Download a backup first. Continue?",
  mergeConfirm: "Merge this backup into your local dictionary?",
  clearPwa: "Re-download PWA asset cache",
  clearReso: "Clear resolution cache",
  cleanJobs: "Clean up finished jobs",
  pwaRefreshed: /* @__PURE__ */ __name((n) => `Offline files re-downloaded and verified (${n} files). Your dictionary and settings were not touched.`, "pwaRefreshed"),
  pwaSize: /* @__PURE__ */ __name((bytes) => `FMlncGen PWA cache: about ${(bytes / 1e6).toFixed(1)} MB (an estimate from the total size of the stored file contents, not the browser's exact disk usage)`, "pwaSize"),
  pwaSizeMeasuring: "FMlncGen PWA cache: measuring…",
  oldCacheBtn: "Delete old caches…",
  oldCacheNone: /* @__PURE__ */ __name((kept = []) => `There are no old FMlncGen caches to delete.${keptList("en", kept)}`, "oldCacheNone"),
  oldCacheConfirm: /* @__PURE__ */ __name((list, b, kept = []) => `Delete these old FMlncGen caches (about ${mbOf(b)} MB will be freed)?
To delete:
${list.map((x) => `- ${x.name} (about ${mbOf(x.bytes)} MB)`).join("\n")}${keptList("en", kept)}
The cache of the version you are using, other apps' caches, your dictionary, session and API keys are NOT deleted.`, "oldCacheConfirm"),
  oldCacheCancelled: "Cancelled. Nothing was deleted.",
  oldCacheDone: /* @__PURE__ */ __name((n, b, kept = []) => `Deleted ${n} old FMlncGen cache(s) (about ${mbOf(b)} MB). The current version and your data were not touched.${keptList("en", kept)}`, "oldCacheDone"),
  oldCacheRefused: /* @__PURE__ */ __name((reason) => ({ updating: "Not deleted: an update of the app is in progress. Reload the page and try again.", "no-worker": "Not available: the offline service is not running in this tab. Reload the page while online.", unsupported: "Not available in this browser.", timeout: "No answer from the offline service. It is not confirmed whether anything was deleted." })[reason] || `Not deleted (${reason}).`, "oldCacheRefused"),
  pwaSizeUnavailable: "FMlncGen PWA cache: could not be measured in this browser.",
  pwaPartial: /* @__PURE__ */ __name((n, names) => `Partly re-downloaded: ${n} offline files were re-downloaded and verified, but ${names.length} optional file${names.length === 1 ? "" : "s"} (${names.join(", ")}) could not be downloaded and ${names.length === 1 ? "was" : "were"} left as before. ${names.length === 1 ? "It is an" : "They are"} optional icon file${names.length === 1 ? "" : "s"}, not needed to use the app or the dictionary offline. Your dictionary and settings were not touched.`, "pwaPartial"),
  pwaRefused: /* @__PURE__ */ __name((reason) => ({
    offline: "Not run: you are offline. The current offline files are unchanged. Try again online.",
    network: "Not run: the files could not be downloaded (network error). The current offline files are unchanged. Try again online.",
    unavailable: "Not run: the published site no longer serves this version (an update was probably published). The current offline files are unchanged. Reload the page to update.",
    mismatch: "Not run: the downloaded files do not match this version (an update was probably published). The current offline files are unchanged. Reload the page to update.",
    storage: "Could not finish: not enough storage space. The offline files that worked before are unchanged.",
    "no-worker": "Not run: the offline service is not running in this tab. Reload the page while online, then try again.",
    unsupported: "Not available: this browser does not support offline use.",
    busy: "A re-download is already running.",
    timeout: "No answer from the offline service. The offline files that worked before are unchanged."
  })[reason] || `Not completed (${reason}). The offline files that worked before are unchanged.`, "pwaRefused"),
  resetBtn: "Permanently delete the user dictionary…",
  resetPreview: /* @__PURE__ */ __name((n) => `This will permanently delete ${n} claims and all evidence/relations/history. This CANNOT be undone.`, "resetPreview"),
  resetPrompt: `Type exactly to confirm: ${DESTRUCTIVE_RESET_CONFIRMATION}`,
  resetBackupFirst: "Download a Full Backup first?",
  busy: "An operation is already running…",
  done: "Done.",
  failed: "Failed: ",
  restoreIncomplete: "A restore did not finish. The dictionary is in maintenance mode.",
  mergeIncomplete: "A merge did not finish. The dictionary is in maintenance mode.",
  resume: "Resume restore",
  resumeMergeBtn: "Resume merge",
  rollback: "Roll back",
  maintenanceMode: "Maintenance mode — Manager is read-only",
  stagingLost: "The staging data for this operation is gone, so it cannot be resumed.",
  probeUnavailable: "Could not check this operation’s staging data right now (the database is busy or unreadable). Nothing was changed. Try again in a moment.",
  retryProbe: "Check again",
  opPhase: /* @__PURE__ */ __name((op, ph) => `${op === "merge" ? "Merge" : "Restore"} — phase: ${ph}`, "opPhase"),
  stuckSession: /* @__PURE__ */ __name((id) => `session: ${id}`, "stuckSession"),
  recoverFromBackup: "Recover from a new full backup…",
  recoverHelp: /* @__PURE__ */ __name((op) => op === "merge" ? "This merge cannot be resumed. Pick a Full Backup file: the dictionary will be REPLACED by it (not merged), which also clears this stuck merge." : "Pick a Full Backup file to replace the dictionary and finish this stuck restore.", "recoverHelp"),
  recoverConfirm: /* @__PURE__ */ __name((op, id) => op === "merge" ? `Recover the stuck merge ${id} by REPLACING the whole dictionary with the backup file you picked? Local entries not in that backup will be lost. The stuck merge is superseded only after the new backup has been fully read and verified.` : `Recover the stuck restore ${id} by REPLACING the whole dictionary with the backup file you picked? The stuck restore will be superseded only after the new backup has been fully read and verified.`, "recoverConfirm"),
  recoverPrompt: `Type exactly to confirm: ${RESTORE_CONFIRMATION}`,
  recovering: "Reading and verifying the backup…",
  recoverProgress: /* @__PURE__ */ __name((field, n) => `Verifying ${field}… ${n}`, "recoverProgress"),
  recoverDone: /* @__PURE__ */ __name((n) => `Recovered. ${n} claims restored.`, "recoverDone"),
  savePicker: "Choose where to save…",
  blobCapNote: "Large backups (>256 MB) need a File System writable stream; the in-memory download will refuse them.",
  empty: "No results",
  loading: "Loading…",
  // ---- Phase 9B §102.2 Portable Dictionary ----
  portableTitle: "Portable Dictionary (share / light migration)",
  portableExport: "Export Portable Dictionary",
  portableImport: "Import Portable Dictionary…",
  portableDesc: 'Portable files SHARE knowledge. They never restore locks or "verified" status — imported entries stay unlocked and are re-scored by your own policy.',
  /**
   * §104 Import Report: `recordsSeen` は「読んだ件数」であって成功件数ではない。
   * 一部欠落を全面成功として表示しないよう、作成 / 統合 / 重複 / 不正を分けて出す。
   * 辞書の生値や個人情報は出さない（件数と種別のみ）。
   */
  portableDone: /* @__PURE__ */ __name((r) => {
    const parts = [`created ${r.created}`, `merged ${r.merged}`, `duplicate ${r.deduped}`];
    if (r.invalid > 0) parts.push(`invalid ${r.invalid}`);
    if (r.skipped > 0) parts.push(`skipped ${r.skipped}`);
    if (r.degraded > 0) parts.push(`narrowed scope ${r.degraded}`);
    if (r.guardRejected > 0) parts.push(`file rules refused ${r.guardRejected}`);
    const head = r.invalid > 0 || r.skipped > 0 || r.degraded > 0 || r.guardRejected > 0 ? `Imported with problems — ${parts.join(" · ")}` : `Imported — ${parts.join(" · ")}`;
    return `${head} (no locks were transferred).`;
  }, "portableDone"),
  /**
   * §102.2: 「取り込めなかった」と「取り込んだが適用範囲を狭めた」を混同しない。
   * 旧 portableProblems は degraded import も "could not be imported" と断定していた。
   */
  portableRejected: /* @__PURE__ */ __name((n) => `${n} item(s) were NOT imported (see the import report).`, "portableRejected"),
  portableDegraded: /* @__PURE__ */ __name((n) => `${n} imported entry/entries had their name scope narrowed to the name recorded in the file, so they apply to fewer names than the file asked for.`, "portableDegraded"),
  portableNeedsReview: /* @__PURE__ */ __name((n) => `${n} entry/entries need review: the name in the file does not match what this dictionary has observed.`, "portableNeedsReview"),
  /**
   * §102.2 / §114: artifact 自身が宣言した適用条件（`id_only` や広すぎる別名一覧）
   * を **適用権限として採用しなかった**ことを、取り込み失敗と区別して伝える。
   */
  portableGuardRejected: /* @__PURE__ */ __name((n) => `${n} entry/entries: the rules the file asked for about which names it applies to were refused; they apply only to the name recorded in the file.`, "portableGuardRejected"),
  // ---- Phase 9B §102.3 Dictionary Package ----
  packageTitle: "Dictionary Packages",
  packageInstall: "Install package…",
  packageNone: "No packages installed.",
  packageDisable: "Disable",
  packageEnable: "Enable",
  packageRollback: "Roll back",
  packageUninstall: "Uninstall",
  packageTrust: "Trust",
  packageOffNote: "Community packages are not your own confirmed entries. You can turn any package off later without losing your dictionary. An integrity check only proves the file is unaltered — it never means the package is official, verified, or trusted.",
  packageDryRun: /* @__PURE__ */ __name((r) => `Install "${r.name}" v${r.version}?
new entries: ${r.counts.newClaims}
evidence added to existing entries: ${r.counts.evidenceOnExistingClaims}
conflicting candidates: ${r.counts.conflictCandidates}
invalid records: ${r.counts.invalidRecords}
unknown required capabilities: ${r.counts.unknownRequiredCapabilities}
A package is NOT treated as your own confirmed knowledge.`, "packageDryRun"),
  packageIdentityWarn: /* @__PURE__ */ __name((m) => `This file claims the same package id but a different identity (author "${m.storedAuthor}" → "${m.incomingAuthor}"). A checksum match is NOT proof of authenticity. Install it anyway?`, "packageIdentityWarn"),
  packageBlocked: /* @__PURE__ */ __name((r) => `Cannot activate: ${r.blockedReasons.join(", ")}`, "packageBlocked"),
  packageUninstallConfirm: "Turn this package off? Your dictionary entries are kept.",
  packageStuck: "A package install was interrupted. Roll it back?",
  // ---- Phase 9C §146 Active Review Queue ----
  reviewTitle: "Active Review",
  reviewDesc: "Entries where one check helps most. Opening, sorting or deferring this list never calls the AI.",
  reviewRefresh: "Refresh review queue",
  reviewEmpty: "Nothing needs review right now.",
  reviewImpact: "impact",
  reviewConfirm: "Confirm this reading",
  reviewAlternate: "Use another reading…",
  reviewAlternatePrompt: "Correct reading:",
  reviewDefer: "Defer",
  reviewHide: "Hide for now",
  reviewEvidence: "Evidence details",
  reviewPool: /* @__PURE__ */ __name((n, scanned) => `${n} in queue (scanned ${scanned} · AI calls 0)`, "reviewPool"),
  reviewDeferred: "Deferred. It will come back later — this is NOT marked as wrong.",
  reviewConfirmed: "Recorded your confirmation.",
  reviewCorrected: "Correction applied through the normal correction pipeline.",
  reviewNoChange: "Nothing changed.",
  // ---- Phase 9C Needs Attention ----
  attentionTitle: "Needs Attention",
  attentionDesc: "Conflicts, quarantined imports and entries awaiting re-check, in one list.",
  attentionRefresh: "Refresh",
  attentionEmpty: "Nothing needs attention.",
  attentionReason_conflict: "conflict",
  attentionReason_quarantine: "quarantined",
  attentionReason_needs_revalidation: "needs re-check",
  attentionPool: /* @__PURE__ */ __name((n, scanned) => `${n} item(s) (scanned ${scanned})`, "attentionPool"),
  // ---- Phase 9C §93.1 Safe Mutation Undo ----
  undoTitle: "Undo a bulk operation",
  undoDesc: "Undo neutralises what that one operation contributed. It never removes corrections or locks you made afterwards, and never deletes shared entries.",
  undoPackageBtn: "Undo this package version…",
  undoBatchLabel: "AI batch / revalidation id",
  undoBatchBtn: "Preview undo…",
  undoPreview: /* @__PURE__ */ __name((p) => `Undo preview — evidence to invalidate: ${p.evidenceToInvalidate}, entries affected: ${p.claimsAffected}, of which protected by your later edits/locks: ${p.claimsProtected}. Proceed?`, "undoPreview"),
  undoNothing: "Nothing to undo for that operation.",
  undoResult: /* @__PURE__ */ __name((r) => `Undo done — invalidated ${r.invalidatedEvidence ?? r.counts?.changed ?? 0}${r.claimsRecomputed != null ? `, re-checked ${r.claimsRecomputed}` : ""}${r.claimsLaterManualOrLocked ? `, protected ${r.claimsLaterManualOrLocked}` : ""}${r.claimsFailed ? `, failed ${r.claimsFailed}` : ""}${r.partial ? " (PARTIAL — stopped early)" : ""}`, "undoResult")
};
var JA = {
  title: "辞書マネージャー",
  close: "閉じる",
  search: "検索",
  searchPh: "原語 / 読みの前方一致…",
  searchMode: "検索対象・照合",
  clearSearch: "検索を解除",
  searchHint: /* @__PURE__ */ __name((m) => `日本語の読みで探すときは「${m}」を選びます。Enter で検索、Esc で解除。`, "searchHint"),
  mode_prefix_source: "原語（前方一致）",
  mode_prefix_value: "読み（前方一致）",
  mode_exact: "原語（完全一致）",
  mode_alias: "別名",
  mode_recent: "最近",
  col_source: "原語",
  col_ja: "日本語",
  col_kind: "種類",
  col_tier: "信頼",
  col_state: "状態",
  col_use: "使用",
  col_actions: "操作",
  prev: "前へ",
  next: "次へ",
  page: "ページ",
  rows: "件",
  capReached: "結果上限に到達しました。検索条件を絞ってください",
  detail: "詳細",
  lock: "ロック",
  unlock: "解除",
  disable: "無効化",
  del: "論理削除",
  revive: "復活",
  edit: "値を編集",
  editPrompt: "新しい値:",
  health: "健康状態",
  doctor: "Doctor スキャン",
  stats: "学習統計",
  reval: "再検証の概要",
  ev: "Evidence",
  rel: "Relation",
  hist: "履歴",
  rej: "Rejection",
  trace: "ソース trace",
  backupTitle: "バックアップ / 復元 / 統合 / メンテナンス",
  downloadBackup: "完全バックアップをダウンロード",
  restoreBtn: "完全復元（置換）…",
  mergeBtn: "ファイルから統合…",
  restoreDesc: "復元は辞書全体をバックアップファイルで置き換えます。",
  mergeDesc: "統合はバックアップを辞書へ追加します（既存項目は保持）。",
  restoreConfirm: "辞書全体を置き換えます。先にバックアップを取得してください。続行しますか？",
  mergeConfirm: "このバックアップを辞書へ統合しますか？",
  clearPwa: "PWA アセットキャッシュを再取得",
  clearReso: "解決キャッシュを消去",
  cleanJobs: "完了ジョブを整理",
  pwaRefreshed: /* @__PURE__ */ __name((n) => `オフライン用ファイルを取り直して検証しました（${n} 件）。辞書と設定には触れていません。`, "pwaRefreshed"),
  pwaSize: /* @__PURE__ */ __name((bytes) => `FMlncGenのPWAキャッシュ：約 ${(bytes / 1e6).toFixed(1)} MB（保存ファイル内容の合計による概算。ブラウザ上の正確なディスク占有量ではありません）`, "pwaSize"),
  pwaSizeMeasuring: "FMlncGenのPWAキャッシュ：測定中…",
  oldCacheBtn: "古いキャッシュを削除…",
  oldCacheNone: /* @__PURE__ */ __name((kept = []) => `削除できる古いFMlncGenのキャッシュはありません。${keptList("ja", kept)}`, "oldCacheNone"),
  oldCacheConfirm: /* @__PURE__ */ __name((list, b, kept = []) => `次の古いFMlncGenのキャッシュを削除します（約 ${mbOf(b)} MB を解放）。
【削除対象】
${list.map((x) => `・${x.name}（約 ${mbOf(x.bytes)} MB）`).join("\n")}${keptList("ja", kept)}
使用中の版のキャッシュ、他のアプリのキャッシュ、辞書・セッション・APIキーは削除しません。続行しますか？`, "oldCacheConfirm"),
  oldCacheCancelled: "取り消しました。何も削除していません。",
  oldCacheDone: /* @__PURE__ */ __name((n, b, kept = []) => `古いFMlncGenのキャッシュを ${n} 個削除しました（約 ${mbOf(b)} MB）。使用中の版とデータには触れていません。${keptList("ja", kept)}`, "oldCacheDone"),
  oldCacheRefused: /* @__PURE__ */ __name((reason) => ({ updating: "アプリの更新中のため削除しませんでした。ページを再読み込みしてから実行してください。", "no-worker": "このタブではオフライン機能が動いていないため実行できません。オンラインで再読み込みしてください。", unsupported: "このブラウザでは実行できません。", timeout: "オフライン機能から応答がありません。削除できたかは確認できていません。" })[reason] || `削除しませんでした（${reason}）。`, "oldCacheRefused"),
  pwaSizeUnavailable: "FMlncGenのPWAキャッシュ：このブラウザでは測定できません。",
  pwaPartial: /* @__PURE__ */ __name((n, names) => `一部未取得: オフライン用ファイル ${n} 件は取り直して検証しましたが、任意のファイル ${names.length} 件（${names.join("、")}）は取得できず、再取得前の状態のままです。アイコン用の任意ファイルで、オフラインでアプリと辞書を使うのには不要です。辞書と設定には触れていません。`, "pwaPartial"),
  pwaRefused: /* @__PURE__ */ __name((reason) => ({
    offline: "オフラインのため実行しませんでした。今のオフライン用ファイルはそのままです。オンラインで再実行してください。",
    network: "ファイルを取得できなかったため実行しませんでした（通信エラー）。今のオフライン用ファイルはそのままです。オンラインで再実行してください。",
    unavailable: "公開中のサイトがこの版を配信していないため実行しませんでした（更新が公開された可能性があります）。今のオフライン用ファイルはそのままです。ページを再読み込みすると更新されます。",
    mismatch: "取得したファイルがこの版と一致しないため実行しませんでした（更新が公開された可能性があります）。今のオフライン用ファイルはそのままです。ページを再読み込みすると更新されます。",
    storage: "保存領域が足りないため完了できませんでした。それまで使えていたオフライン用ファイルはそのままです。",
    "no-worker": "このタブではオフライン機能が動いていないため実行できません。オンラインでページを再読み込みしてから実行してください。",
    unsupported: "このブラウザはオフライン機能に対応していません。",
    busy: "別の再取得が実行中です。",
    timeout: "オフライン機能から応答がありません。それまで使えていたオフライン用ファイルはそのままです。"
  })[reason] || `完了しませんでした（${reason}）。それまで使えていたオフライン用ファイルはそのままです。`, "pwaRefused"),
  resetBtn: "ユーザー辞書を完全に削除…",
  resetPreview: /* @__PURE__ */ __name((n) => `${n} 件の Claim と全 Evidence/Relation/履歴を完全に削除します。元に戻せません。`, "resetPreview"),
  resetPrompt: `確認のため次を正確に入力: ${DESTRUCTIVE_RESET_CONFIRMATION}`,
  resetBackupFirst: "先に完全バックアップをダウンロードしますか？",
  busy: "別の操作が実行中です…",
  done: "完了。",
  failed: "失敗: ",
  restoreIncomplete: "復元が完了していません。辞書はメンテナンスモードです。",
  mergeIncomplete: "統合が完了していません。辞書はメンテナンスモードです。",
  resume: "復元を再開",
  resumeMergeBtn: "統合を再開",
  rollback: "ロールバック",
  maintenanceMode: "メンテナンス中 — マネージャーは読み取り専用",
  stagingLost: "この操作の staging データが失われているため、再開はできません。",
  probeUnavailable: "この操作の staging データを今は確認できません（DB が使用中か読み取れません）。何も変更されていません。しばらくしてから再試行してください。",
  retryProbe: "もう一度確認",
  opPhase: /* @__PURE__ */ __name((op, ph) => `${op === "merge" ? "統合" : "復元"} — フェーズ: ${ph}`, "opPhase"),
  stuckSession: /* @__PURE__ */ __name((id) => `セッション: ${id}`, "stuckSession"),
  recoverFromBackup: "新しいフルバックアップから復旧…",
  recoverHelp: /* @__PURE__ */ __name((op) => op === "merge" ? "この統合は再開できません。完全バックアップファイルを選ぶと、辞書はそれで「置き換え」られます（統合ではありません）。中断した統合も解消されます。" : "完全バックアップファイルを選ぶと、辞書を置き換えてこの中断した復元を完了できます。", "recoverHelp"),
  recoverConfirm: /* @__PURE__ */ __name((op, id) => op === "merge" ? `中断した統合 ${id} を、選んだバックアップファイルで辞書全体を置き換えて復旧しますか？ そのバックアップに無いローカル項目は失われます。新しいバックアップを最後まで読み取り検証してからでないと、中断中の統合は引き継がれません。` : `中断した復元 ${id} を、選んだバックアップファイルで辞書全体を置き換えて復旧しますか？ 新しいバックアップを最後まで読み取り検証してからでないと、中断中の復元は引き継がれません。`, "recoverConfirm"),
  recoverPrompt: `確認のため次を正確に入力: ${RESTORE_CONFIRMATION}`,
  recovering: "バックアップを読み取り・検証中…",
  recoverProgress: /* @__PURE__ */ __name((field, n) => `${field} を検証中… ${n}`, "recoverProgress"),
  recoverDone: /* @__PURE__ */ __name((n) => `復旧しました。${n} 件の Claim を復元。`, "recoverDone"),
  savePicker: "保存先を選択…",
  blobCapNote: "大きなバックアップ（256MB 超）はファイルシステムの書き込みストリームが必要です。メモリ上でのダウンロードは拒否されます。",
  empty: "結果なし",
  loading: "読み込み中…",
  // ---- Phase 9B §102.2 Portable Dictionary ----
  portableTitle: "ポータブル辞書（共有 / 軽量移行）",
  portableExport: "ポータブル辞書を書き出す",
  portableImport: "ポータブル辞書を読み込む…",
  portableDesc: "ポータブル辞書は知識を共有するためのものです。ロックや「確認済み」状態は移植されません。取り込んだ項目はロックされず、あなたの辞書のポリシーで再評価されます。",
  portableDone: /* @__PURE__ */ __name((r) => {
    const parts = [`新規 ${r.created}`, `統合 ${r.merged}`, `重複 ${r.deduped}`];
    if (r.invalid > 0) parts.push(`不正 ${r.invalid}`);
    if (r.skipped > 0) parts.push(`スキップ ${r.skipped}`);
    if (r.degraded > 0) parts.push(`適用範囲を狭めた ${r.degraded}`);
    if (r.guardRejected > 0) parts.push(`ファイルの適用条件を拒否 ${r.guardRejected}`);
    const head = r.invalid > 0 || r.skipped > 0 || r.degraded > 0 || r.guardRejected > 0 ? `問題ありで取り込みました — ${parts.join(" · ")}` : `取り込みました — ${parts.join(" · ")}`;
    return `${head}（ロックは移植されません）。`;
  }, "portableDone"),
  portableRejected: /* @__PURE__ */ __name((n) => `${n} 件は取り込みませんでした（詳細はレポートを確認してください）。`, "portableRejected"),
  portableDegraded: /* @__PURE__ */ __name((n) => `${n} 件は取り込みましたが、適用する名称をファイル内の登録名だけに狭めました（ファイルが要求した範囲より狭く適用されます）。`, "portableDegraded"),
  portableNeedsReview: /* @__PURE__ */ __name((n) => `${n} 件は確認が必要です。ファイル内の名称が、この辞書が観測している名称と一致しません。`, "portableNeedsReview"),
  portableGuardRejected: /* @__PURE__ */ __name((n) => `${n} 件は、ファイルが要求した「どの名称へ適用するか」の条件を採用しませんでした（ファイルに記録された名称にだけ適用されます）。`, "portableGuardRejected"),
  // ---- Phase 9B §102.3 Dictionary Package ----
  packageTitle: "辞書パッケージ",
  packageInstall: "パッケージを導入…",
  packageNone: "導入済みパッケージはありません。",
  packageDisable: "無効化",
  packageEnable: "有効化",
  packageRollback: "前の版へ戻す",
  packageUninstall: "取り外す",
  packageTrust: "優先度",
  packageOffNote: "コミュニティ製パッケージはあなた自身が確認した項目ではありません。あとからいつでも OFF にでき、辞書は失われません。整合性チェックはファイルが改変されていないことのみを示し、公式・検証済み・信頼済みであることを意味しません。",
  packageDryRun: /* @__PURE__ */ __name((r) => `「${r.name}」v${r.version} を導入しますか？
新規項目: ${r.counts.newClaims}
既存項目への裏付け追加: ${r.counts.evidenceOnExistingClaims}
競合候補: ${r.counts.conflictCandidates}
不正レコード: ${r.counts.invalidRecords}
未知の必須機能: ${r.counts.unknownRequiredCapabilities}
パッケージは「あなたが確認済みの知識」としては扱われません。`, "packageDryRun"),
  packageIdentityWarn: /* @__PURE__ */ __name((m) => `同じパッケージ ID を名乗っていますが、識別情報が異なります（作者「${m.storedAuthor}」→「${m.incomingAuthor}」）。チェックサムの一致は本物である証明にはなりません。それでも導入しますか？`, "packageIdentityWarn"),
  packageBlocked: /* @__PURE__ */ __name((r) => `有効化できません: ${r.blockedReasons.join(", ")}`, "packageBlocked"),
  packageUninstallConfirm: "このパッケージを OFF にしますか？辞書の項目は保持されます。",
  packageStuck: "パッケージの導入が中断されています。巻き戻しますか？",
  // ---- Phase 9C §146 Active Review Queue ----
  reviewTitle: "要確認キュー",
  reviewDesc: "1件の確認で効果が大きい項目です。開く・並べ替える・保留するだけでは AI を呼びません。",
  reviewRefresh: "キューを更新",
  reviewEmpty: "今は確認が必要な項目はありません。",
  reviewImpact: "影響度",
  reviewConfirm: "この読みで確定",
  reviewAlternate: "別の読みにする…",
  reviewAlternatePrompt: "正しい読み:",
  reviewDefer: "保留",
  reviewHide: "しばらく非表示",
  reviewEvidence: "根拠を見る",
  reviewPool: /* @__PURE__ */ __name((n, scanned) => `キュー ${n} 件（走査 ${scanned} 件 · AI 呼び出し 0）`, "reviewPool"),
  reviewDeferred: "保留しました。あとで再表示されます（「間違い」として記録はしません）。",
  reviewConfirmed: "確認を記録しました。",
  reviewCorrected: "通常の訂正パイプラインを通して修正しました。",
  reviewNoChange: "変更はありません。",
  // ---- Phase 9C Needs Attention ----
  attentionTitle: "要対応",
  attentionDesc: "競合・検疫中の取り込み・再確認待ちを1つの一覧にまとめます。",
  attentionRefresh: "更新",
  attentionEmpty: "対応が必要な項目はありません。",
  attentionReason_conflict: "競合",
  attentionReason_quarantine: "検疫中",
  attentionReason_needs_revalidation: "再確認待ち",
  attentionPool: /* @__PURE__ */ __name((n, scanned) => `${n} 件（走査 ${scanned} 件）`, "attentionPool"),
  // ---- Phase 9C §93.1 Safe Mutation Undo ----
  undoTitle: "一括操作の取り消し",
  undoDesc: "取り消しは、その操作が加えた分だけを無効化します。あとから行った訂正やロックは巻き戻さず、共有されている項目も削除しません。",
  undoPackageBtn: "このパッケージ版を取り消す…",
  undoBatchLabel: "AI 学習 / 再検証の ID",
  undoBatchBtn: "取り消しをプレビュー…",
  undoPreview: /* @__PURE__ */ __name((p) => `取り消しプレビュー — 無効化する根拠: ${p.evidenceToInvalidate} 件、影響する項目: ${p.claimsAffected} 件（うち、あとからの編集・ロックで保護: ${p.claimsProtected} 件）。実行しますか？`, "undoPreview"),
  undoNothing: "その操作に取り消す対象はありません。",
  undoResult: /* @__PURE__ */ __name((r) => `取り消し完了 — 無効化 ${r.invalidatedEvidence ?? r.counts?.changed ?? 0} 件${r.claimsRecomputed != null ? ` / 再確認 ${r.claimsRecomputed} 件` : ""}${r.claimsLaterManualOrLocked ? ` / 保護 ${r.claimsLaterManualOrLocked} 件` : ""}${r.claimsFailed ? ` / 失敗 ${r.claimsFailed} 件` : ""}${r.partial ? "（途中終了 — 部分的に適用）" : ""}`, "undoResult")
};
var MANAGER_I18N = Object.freeze({
  en: MANAGER_I18N_EN,
  ja: { ...MANAGER_I18N_EN, ...JA },
  zh: MANAGER_I18N_EN,
  ko: MANAGER_I18N_EN,
  de: MANAGER_I18N_EN,
  fr: MANAGER_I18N_EN,
  la: MANAGER_I18N_EN,
  he: MANAGER_I18N_EN
});
function strings(lang) {
  const table = MANAGER_I18N[lang] || MANAGER_I18N.en;
  return (key) => table[key] ?? MANAGER_I18N.en[key] ?? key;
}
__name(strings, "strings");
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}
__name(el, "el");
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
__name(clear, "clear");
var searchHintSeq = 0;
var ManagerClosedError = class extends Error {
  static {
    __name(this, "ManagerClosedError");
  }
  constructor() {
    super("manager UI is closed");
    this.name = "ManagerClosedError";
    this.closedUi = true;
  }
};
async function mountManagerUI(container, opts = {}) {
  const t = strings(opts.lang || "en");
  const confirmFn = opts.confirm || ((m) => globalThis.confirm?.(m));
  const promptFn = opts.prompt || ((m, d) => globalThis.prompt?.(m, d));
  const toast = opts.toast || (() => {
  });
  const env = opts.env || {};
  const ownsDb = !opts.db;
  const db = opts.db || await openDictionaryDB({ env });
  const bc = createBroadcast({ env: globalThis });
  let closed = false;
  let dbClosed = false;
  let inflight = 0;
  const pendingTimers = /* @__PURE__ */ new Set();
  const pendingUrls = /* @__PURE__ */ new Set();
  function maybeCloseDb() {
    if (closed && ownsDb && !dbClosed && inflight === 0) {
      dbClosed = true;
      try {
        db.close();
      } catch {
      }
    }
  }
  __name(maybeCloseDb, "maybeCloseDb");
  function later(fn, ms) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      if (!closed) fn();
    }, ms);
    pendingTimers.add(id);
    return id;
  }
  __name(later, "later");
  function trackUrl(u) {
    pendingUrls.add(u);
    return u;
  }
  __name(trackUrl, "trackUrl");
  function releaseUrl(u) {
    try {
      URL.revokeObjectURL(u);
    } catch {
    }
    pendingUrls.delete(u);
  }
  __name(releaseUrl, "releaseUrl");
  function assertLive() {
    if (closed) throw new ManagerClosedError();
  }
  __name(assertLive, "assertLive");
  let busy = false;
  let recovering = false;
  let search = createManagerSearch(db);
  let curSpec = { mode: SEARCH_MODE.recent };
  let curPage = null;
  let renderedQueryId = -1;
  let pageIndex = 0;
  const root = el("section", { class: "dm-root", "aria-label": t("title") });
  const head = el("div", { class: "dm-head" }, [
    el("strong", { text: t("title") }),
    el("button", { class: "dm-close", text: t("close"), type: "button", onclick: /* @__PURE__ */ __name(() => {
      destroy();
      opts.onClose?.();
    }, "onclick") })
  ]);
  const banner = el("div", { class: "dm-banner", hidden: "hidden" });
  const searchRow = el("div", { class: "dm-search" });
  const input = el("input", { type: "search", class: "dm-q", placeholder: t("searchPh"), "aria-label": t("search") });
  const modeSel = el("select", { class: "dm-mode" }, [
    el("option", { value: SEARCH_MODE.prefixSource, text: t("mode_prefix_source") }),
    el("option", { value: SEARCH_MODE.prefixValue, text: t("mode_prefix_value") }),
    el("option", { value: SEARCH_MODE.exactSource, text: t("mode_exact") }),
    el("option", { value: SEARCH_MODE.aliasPrefix, text: t("mode_alias") }),
    el("option", { value: SEARCH_MODE.recent, text: t("mode_recent") })
  ]);
  const modeLabel = el("label", { class: "dm-mode-label" }, [
    el("span", { text: t("searchMode") }),
    modeSel
  ]);
  const searchBtn = el("button", { type: "button", class: "dm-go", text: t("search") });
  const clearBtn = el("button", { type: "button", class: "dm-clear", text: t("clearSearch") });
  const searchHint = el("small", {
    class: "dm-search-hint",
    id: `dm-search-hint-${++searchHintSeq}`,
    text: t("searchHint")(t("mode_prefix_value"))
  });
  input.setAttribute("aria-describedby", searchHint.id);
  searchRow.append(input, modeLabel, searchBtn);
  searchRow.append(clearBtn, searchHint);
  const table = el("table", { class: "dm-table" });
  const thead = el("thead", {}, [el("tr", {}, [
    el("th", { text: t("col_source") }),
    el("th", { text: t("col_ja") }),
    el("th", { text: t("col_kind") }),
    el("th", { text: t("col_tier") }),
    el("th", { text: t("col_state") }),
    el("th", { text: t("col_use") }),
    el("th", { text: t("col_actions") })
  ])]);
  const tbody = el("tbody", { class: "dm-rows" });
  table.append(thead, tbody);
  const tableScroll = el("div", { class: "dm-table-scroll" }, [table]);
  const pager = el("div", { class: "dm-pager" });
  const prevBtn = el("button", { type: "button", text: t("prev") });
  const nextBtn = el("button", { type: "button", text: t("next") });
  const pageInfo = el("span", { class: "dm-pageinfo" });
  pager.append(prevBtn, pageInfo, nextBtn);
  const healthBox = el("div", { class: "dm-health" });
  const toolRow = el("div", { class: "dm-tools" }, [
    el("button", { type: "button", text: t("health"), onclick: /* @__PURE__ */ __name(() => guard(showHealth), "onclick") }),
    el("button", { type: "button", text: t("doctor"), onclick: /* @__PURE__ */ __name(() => guard(showDoctor), "onclick") }),
    el("button", { type: "button", text: t("reval"), onclick: /* @__PURE__ */ __name(() => guard(showReval), "onclick") })
  ]);
  const detailBox = el("div", { class: "dm-detail", hidden: "hidden" });
  const pwaSizeOpts = "pwaCacheStorage" in opts ? { cacheStorage: opts.pwaCacheStorage } : {};
  const pwaSizeLine = el("small", { class: "dm-pwa-size", "aria-live": "polite", text: t("pwaSizeMeasuring") });
  let pwaSizeSeq = 0;
  const backupBox = buildBackupBox();
  const portableBox = buildPortableBox();
  const packageBox = buildPackageBox();
  const packageList = el("div", { class: "dm-pkg-list" });
  packageBox.appendChild(packageList);
  const REVIEW_PAGE_SIZE = Math.min(REVIEW_POLICY.defaultPageSize, MANAGER_POLICY.maxPageSize);
  const REVIEW_DEFER_MS = 7 * 24 * 60 * 60 * 1e3;
  const REVIEW_HIDE_MS = 30 * 24 * 60 * 60 * 1e3;
  let reviewSession = null;
  let reviewOffset = 0;
  let attentionRows = [];
  let attentionScanned = 0;
  const reviewList = el("div", { class: "dm-rq-list" });
  const reviewInfo = el("span", { class: "dm-rq-info" });
  const reviewPrev = el("button", { type: "button", text: t("prev"), onclick: /* @__PURE__ */ __name(() => {
    reviewOffset = Math.max(0, reviewOffset - REVIEW_PAGE_SIZE);
    renderReview();
  }, "onclick") });
  const reviewNext = el("button", { type: "button", text: t("next"), onclick: /* @__PURE__ */ __name(() => {
    reviewOffset += REVIEW_PAGE_SIZE;
    renderReview();
  }, "onclick") });
  const attentionList = el("div", { class: "dm-attn-list" });
  const attentionInfo = el("span", { class: "dm-attn-info" });
  const undoPackageList = el("div", { class: "dm-undo-pkgs" });
  const undoBatchInput = el("input", { type: "text", class: "dm-undo-id", placeholder: "mut:…" });
  const undoResultBox = el("div", { class: "dm-undo-result" });
  const reviewBox = buildReviewBox();
  const attentionBox = buildAttentionBox();
  const undoBox = buildUndoBox();
  root.append(
    head,
    banner,
    searchRow,
    tableScroll,
    pager,
    toolRow,
    healthBox,
    detailBox,
    reviewBox,
    attentionBox,
    backupBox,
    portableBox,
    packageBox,
    undoBox
  );
  clear(container);
  container.appendChild(root);
  async function guard(fn, ...args) {
    if (closed) return;
    if (busy) {
      toast("warn", t("busy"));
      return;
    }
    busy = true;
    setDisabled(true);
    inflight += 1;
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof ManagerClosedError || e?.closedUi) return;
      toast("error", t("failed") + (e?.message || e));
    } finally {
      busy = false;
      inflight -= 1;
      if (!closed) setDisabled(false);
      maybeCloseDb();
    }
  }
  __name(guard, "guard");
  function setDisabled(d) {
    for (const b of root.querySelectorAll("button,select,input")) {
      if (b.classList.contains("dm-close")) continue;
      b.disabled = d && !b.dataset.always;
    }
  }
  __name(setDisabled, "setDisabled");
  async function refreshBanner() {
    if (closed) return { blocked: true };
    const [rst, mst, probe] = await Promise.all([
      inspectRestoreState(db),
      inspectMergeState(db),
      probeStuckImport(db, { env }).catch(() => ({ restore: null, merge: null }))
    ]);
    const st = rst.inProgress ? { ...rst, kind: "restore" } : mst.inProgress ? { ...mst, kind: "merge" } : null;
    if (!st) {
      clear(banner);
      banner.hidden = true;
      return { blocked: false };
    }
    banner.hidden = false;
    clear(banner);
    const p = probe?.[st.kind] ?? null;
    const stagingLost = p ? p.stagingLost : st.kind === "restore" ? !st.canResume && !st.canRollback : !st.canResume;
    const probeUnavailable = Boolean(p?.probeUnavailable);
    const canResume = p ? p.canResume : st.canResume && !stagingLost;
    const canRecover = Boolean(p?.canRecoverFromBackup);
    banner.append(
      el("span", { text: st.kind === "merge" ? t("mergeIncomplete") : t("restoreIncomplete") }),
      el("span", { class: "dm-bphase", text: t("opPhase")(st.operation || st.kind, st.phase) }),
      el("span", { class: "dm-bsession", text: t("stuckSession")(st.sessionId ?? "") })
    );
    if (st.kind === "restore" && canResume) {
      banner.appendChild(el("button", { type: "button", class: "dm-resume", text: t("resume"), dataset: { always: "1" }, onclick: /* @__PURE__ */ __name(() => guard(async () => {
        const r = await resumeRestore(db, { env });
        assertLive();
        if (r.resumed) bc.post(r.broadcast);
        toast(r.resumed ? "success" : "warn", r.resumed ? t("done") : r.reason === "staging_lost" ? t("stagingLost") : r.reason || "");
        await refreshAll();
      }), "onclick") }));
    }
    if (st.kind === "restore" && st.canRollback && !stagingLost) {
      banner.appendChild(el("button", { type: "button", class: "dm-rollback", text: t("rollback"), dataset: { always: "1" }, onclick: /* @__PURE__ */ __name(() => guard(async () => {
        await rollbackRestore(db, { env });
        assertLive();
        toast("success", t("done"));
        await refreshAll();
      }), "onclick") }));
    }
    if (st.kind === "merge" && canResume) {
      banner.appendChild(el("button", { type: "button", class: "dm-resume-merge", text: t("resumeMergeBtn"), dataset: { always: "1" }, onclick: /* @__PURE__ */ __name(() => guard(async () => {
        const r = await resumeMerge(db, { env });
        assertLive();
        if (r.resumed) bc.post(r.broadcast);
        toast(r.resumed ? "success" : "warn", r.resumed ? t("done") : r.reason === "staging_lost" ? t("stagingLost") : r.reason || "");
        await refreshAll();
      }), "onclick") }));
    }
    if (stagingLost) banner.appendChild(el("span", { class: "dm-bstuck", text: t("stagingLost") }));
    if (probeUnavailable) {
      banner.append(
        el("span", { class: "dm-bprobe", text: t("probeUnavailable") }),
        el("button", { type: "button", class: "dm-probe-retry", text: t("retryProbe"), dataset: { always: "1" }, onclick: /* @__PURE__ */ __name(() => guard(async () => {
          await refreshAll();
        }), "onclick") })
      );
    }
    if (canRecover) {
      const stuckSessionId = p.sessionId;
      const stuckKind = st.kind;
      const file = el("input", { type: "file", class: "dm-recover-file", accept: ".fmlbak,.json,.txt", style: "display:none", "aria-label": t("recoverFromBackup") });
      const progress = el("span", { class: "dm-recover-progress" });
      const btn = el("button", {
        type: "button",
        class: "dm-recover",
        text: t("recoverFromBackup"),
        dataset: { always: "1" },
        onclick: /* @__PURE__ */ __name(() => {
          if (!recovering && !btn.disabled) file.click();
        }, "onclick")
        // 二重クリック防止
      });
      file.addEventListener("change", () => {
        const f = file.files?.[0] ?? null;
        file.value = "";
        if (!f) return;
        guard(() => doRecoverFromBackup(f, stuckSessionId, stuckKind, { btn, progress }));
      });
      banner.append(el("div", { class: "dm-recover-box" }, [
        el("small", { text: t("recoverHelp")(stuckKind) }),
        btn,
        progress,
        file
      ]));
    }
    return { blocked: true };
  }
  __name(refreshBanner, "refreshBanner");
  async function doRecoverFromBackup(file, stuckSessionId, stuckKind = "restore", { btn, progress } = {}) {
    if (recovering) return;
    if (!confirmFn(t("recoverConfirm")(stuckKind, stuckSessionId))) return;
    const phrase = promptFn(t("recoverPrompt"), "");
    if (phrase == null) return;
    recovering = true;
    if (btn) btn.disabled = true;
    const setP = /* @__PURE__ */ __name((s) => {
      if (progress && !closed) progress.textContent = s;
    }, "setP");
    setP(t("recovering"));
    try {
      const res = await recoverStuckRestoreFromBackup(db, backupSourceFromBlob(file), {
        confirm: phrase,
        // 一致しなければ engine が throw
        recoverStuck: { acknowledge: ABANDON_STUCK_CONFIRMATION, sessionId: stuckSessionId },
        env,
        onProgress: /* @__PURE__ */ __name((ev) => setP(t("recoverProgress")(ev?.field ?? "", ev?.count ?? 0)), "onProgress")
      });
      assertLive();
      bc.post(res.broadcast);
      toast("success", t("recoverDone")(res.restored?.claims ?? 0));
      await refreshAll();
    } finally {
      recovering = false;
      if (btn && !closed) btn.disabled = false;
      setP("");
    }
  }
  __name(doRecoverFromBackup, "doRecoverFromBackup");
  function runSearch() {
    const term = input.value.trim();
    const mode = modeSel.value;
    return showSpec(mode === SEARCH_MODE.recent ? { mode } : { mode, term });
  }
  __name(runSearch, "runSearch");
  function clearSearch() {
    input.value = "";
    return showSpec({ mode: SEARCH_MODE.recent });
  }
  __name(clearSearch, "clearSearch");
  function showSpec(spec) {
    curSpec = spec;
    pageIndex = 0;
    return guard(async () => {
      curPage = await search.search(curSpec);
      renderedQueryId = curPage.queryId;
      renderRows(curPage);
    });
  }
  __name(showSpec, "showSpec");
  async function goNext() {
    if (!curPage || curPage.done || curPage.capReached) return;
    await guard(async () => {
      const p = await search.nextPage(curPage.nextCursor);
      if (p.stale || search.isStale(renderedQueryId)) return;
      curPage = p;
      pageIndex += 1;
      renderRows(curPage);
    });
  }
  __name(goNext, "goNext");
  function renderRows(page) {
    clear(tbody);
    tbody.dataset.queryId = String(page.queryId);
    const rows = page.items.slice(0, MANAGER_POLICY.maxPageSize);
    if (!rows.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "7", class: "dm-empty", text: t("empty") })]));
    }
    for (const r of rows) tbody.appendChild(rowEl(r));
    pageInfo.textContent = `${t("page")} ${pageIndex + 1} · ${page.deliveredRows ?? rows.length} ${t("rows")}` + (page.capReached ? ` · ${t("capReached")}` : "");
    prevBtn.disabled = pageIndex === 0;
    nextBtn.disabled = Boolean(page.done || page.capReached);
  }
  __name(renderRows, "renderRows");
  function rowEl(r) {
    const st = [r.locked ? "🔒" : "", r.disabled ? "⊘" : "", r.deletedAt ? "🗑" : "", r.lifecycleState].filter(Boolean).join(" ");
    const act = el("td", { class: "dm-act" });
    const mk = /* @__PURE__ */ __name((label, fn) => el("button", { type: "button", text: label, onclick: /* @__PURE__ */ __name(() => guard(fn, r), "onclick") }), "mk");
    act.append(
      mk(t("detail"), openDetail),
      r.locked ? mk(t("unlock"), (x) => doMut(managerUnlockClaim, x)) : mk(t("lock"), (x) => doMut(managerLockClaim, x)),
      mk(t("edit"), doEdit),
      r.deletedAt ? mk(t("revive"), doRevive) : mk(t("del"), (x) => doMut(managerSoftDeleteClaim, x)),
      mk(t("disable"), (x) => doMut(managerDisableClaim, x))
    );
    return el("tr", { dataset: { claimId: r.claimId } }, [
      el("td", { text: r.sourceText ?? "" }),
      el("td", { text: String(r.value ?? "") }),
      el("td", { text: r.subjectKind ?? "" }),
      el("td", { text: r.trustTier ?? "" }),
      el("td", { text: st }),
      el("td", { text: String(r.useCount ?? 0) }),
      act
    ]);
  }
  __name(rowEl, "rowEl");
  async function doMut(fn, row) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    await fn(db, row.claimId, { actor: "user:manager" });
    bc.post({ type: "claimChanged", scope: "claims" });
    await rerunCurrent();
  }
  __name(doMut, "doMut");
  async function doEdit(row) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const v = promptFn(t("editPrompt"), String(row.value ?? ""));
    if (v == null || v === "") return;
    await managerEditClaimValue(db, row.claimId, { actor: "user:manager", newValue: v });
    bc.post({ type: "claimChanged", scope: "claims" });
    await rerunCurrent();
  }
  __name(doEdit, "doEdit");
  async function doRevive(row) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    if (!confirmFn(t("revive") + " ?")) return;
    await managerReviveClaim(db, row.claimId, { actor: "user:manager", confirm: true });
    bc.post({ type: "claimChanged", scope: "claims" });
    await rerunCurrent();
  }
  __name(doRevive, "doRevive");
  async function rerunCurrent() {
    curPage = await search.search(curSpec);
    renderedQueryId = curPage.queryId;
    pageIndex = 0;
    renderRows(curPage);
  }
  __name(rerunCurrent, "rerunCurrent");
  async function openDetail(row) {
    const d = await getClaimDetail(db, row.claimId);
    detailBox.hidden = false;
    clear(detailBox);
    const kv = /* @__PURE__ */ __name((label, val) => el("div", { class: "dm-kv" }, [el("b", { text: label }), el("span", { text: String(val) })]), "kv");
    detailBox.append(
      el("div", { class: "dm-dh" }, [
        el("strong", { text: `${d.claim.sourceText} → ${d.claim.value}` }),
        el("button", { type: "button", text: t("close"), onclick: /* @__PURE__ */ __name(() => {
          detailBox.hidden = true;
        }, "onclick") })
      ]),
      kv(t("trace"), `${d.sourceTrace.createdBy} / ${d.sourceTrace.derivation?.kind ?? "-"} / keySchema ${d.sourceTrace.keySchemaVersion}`),
      kv(t("ev"), `${d.evidence.total} (${d.evidence.page.length} shown${d.evidence.truncated ? ", truncated" : ""})`),
      kv(t("rel"), `deps ${d.relations.dependencies.length} · dependents ${d.relations.dependents.length} · replaces ${d.relations.replaces.length}`),
      kv(t("hist"), `${d.history.page.length}`),
      kv(t("rej"), `${d.rejections.page.length}`)
    );
  }
  __name(openDetail, "openDetail");
  async function showHealth() {
    clear(healthBox);
    healthBox.appendChild(el("span", { text: t("loading") }));
    const h = await dictionaryHealth(db, { deep: false });
    clear(healthBox);
    const row = /* @__PURE__ */ __name((k, v) => el("span", { class: "dm-hchip", text: `${k}: ${v}` }), "row");
    healthBox.append(
      row("total", h.total),
      row("trusted", h.byTrustTier.trusted),
      row("learned", h.byTrustTier.learned),
      row("provisional", h.byTrustTier.provisional),
      row("conflicted", h.conflicted),
      row("needsRevalidation", h.needsRevalidation),
      row("dormant", h.dormant),
      el("button", { type: "button", text: t("stats"), onclick: /* @__PURE__ */ __name(() => guard(showStats), "onclick") })
    );
  }
  __name(showHealth, "showHealth");
  async function showDoctor() {
    const s = await managerDoctorSummary(db);
    toast("info", `Doctor: ${s.errors} errors / ${s.warnings} warnings (read-only, ${s.mutations} mutations)`);
  }
  __name(showDoctor, "showDoctor");
  async function showReval() {
    const o = await managerRevalidationOverview(db);
    toast("info", `Revalidation: ${o.candidateCount} candidates, ~${o.estimatedInputTokens} tokens, aiCalls ${o.aiCalls}`);
  }
  __name(showReval, "showReval");
  async function showStats() {
    const h = await dictionaryHealth(db, { deep: true });
    toast("info", `deep: softDeleted ${h.softDeleted} · disabled ${h.disabled} · highRisk ${h.highRisk}`);
  }
  __name(showStats, "showStats");
  function buildBackupBox() {
    const box = el("fieldset", { class: "dm-backup" }, [el("legend", { text: t("backupTitle") })]);
    const dlBtn = el("button", { type: "button", text: t("downloadBackup"), onclick: /* @__PURE__ */ __name(() => guard(doDownloadBackup), "onclick") });
    const restoreFile = el("input", { type: "file", accept: ".fmlbak,.json,.txt", style: "display:none", "aria-label": t("restoreBtn") });
    const mergeFile = el("input", { type: "file", accept: ".fmlbak,.json,.txt", style: "display:none", "aria-label": t("mergeBtn") });
    restoreFile.addEventListener("change", () => guard(doRestore, restoreFile.files?.[0]));
    mergeFile.addEventListener("change", () => guard(doMerge, mergeFile.files?.[0]));
    box.append(
      dlBtn,
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("restoreBtn"), onclick: /* @__PURE__ */ __name(() => restoreFile.click(), "onclick") }),
        el("small", { text: t("restoreDesc") }),
        restoreFile
      ]),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("mergeBtn"), onclick: /* @__PURE__ */ __name(() => mergeFile.click(), "onclick") }),
        el("small", { text: t("mergeDesc") }),
        mergeFile
      ]),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("clearPwa"), onclick: /* @__PURE__ */ __name(() => guard(doClearPwa), "onclick") }),
        el("button", { type: "button", text: t("clearReso"), onclick: /* @__PURE__ */ __name(() => guard(doClearReso), "onclick") }),
        el("button", { type: "button", text: t("cleanJobs"), onclick: /* @__PURE__ */ __name(() => guard(doCleanJobs), "onclick") }),
        pwaSizeLine,
        el("button", { type: "button", class: "dm-old-cache", text: t("oldCacheBtn"), onclick: /* @__PURE__ */ __name(() => guard(doDeleteOldCaches), "onclick") })
      ]),
      el("div", { class: "dm-op dm-danger" }, [
        el("button", { type: "button", class: "dm-reset", text: t("resetBtn"), onclick: /* @__PURE__ */ __name(() => guard(doReset), "onclick") })
      ])
    );
    return box;
  }
  __name(buildBackupBox, "buildBackupBox");
  function buildPortableBox() {
    const box = el("fieldset", { class: "dm-portable" }, [el("legend", { text: t("portableTitle") })]);
    const importFile = el("input", { type: "file", accept: ".fmlport,.json,.txt", style: "display:none", "aria-label": t("portableImport") });
    importFile.addEventListener("change", () => guard(doPortableImport, importFile.files?.[0]));
    box.append(
      el("small", { text: t("portableDesc") }),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("portableExport"), onclick: /* @__PURE__ */ __name(() => guard(doPortableExport), "onclick") }),
        el("button", { type: "button", text: t("portableImport"), onclick: /* @__PURE__ */ __name(() => importFile.click(), "onclick") }),
        importFile
      ])
    );
    return box;
  }
  __name(buildPortableBox, "buildPortableBox");
  async function doPortableExport() {
    const sink = createPortableSink();
    const info = await exportPortableToSink(db, { sink });
    const blob = sink.toBlob();
    assertLive();
    const href = trackUrl(URL.createObjectURL(blob));
    const a = el("a", { href, download: "fmlncgen-portable.fmlport" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    later(() => releaseUrl(href), 4e3);
    toast("success", `${t("done")} (${info.counts.records} records)`);
  }
  __name(doPortableExport, "doPortableExport");
  async function doPortableImport(file) {
    if (!file) return;
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const text = await file.text();
    const report = await importPortableDictionary(db, text, { mode: PORTABLE_IMPORT_MODE.shared });
    assertLive();
    const c = report.counts;
    const invalid = c.invalid + c.invalidRejections + c.invalidEntities;
    bc.post({ type: "bulkDictionaryChanged", count: c.claimsCreated });
    const rejected = invalid + c.entitiesUnresolvable + c.skipped;
    const degraded = c.entityGuardNarrowed;
    const needsReview = c.entityNeedsRevalidation;
    const guardRejected = c.entityGuardRejected;
    const summary = {
      created: c.claimsCreated,
      merged: c.claimsMerged,
      deduped: c.evidenceDeduped + c.rejectionsDeduped,
      invalid,
      skipped: c.skipped,
      degraded,
      guardRejected
    };
    const hasProblem = rejected > 0 || degraded > 0 || needsReview > 0 || guardRejected > 0;
    toast(hasProblem ? "warn" : "success", t("portableDone")(summary));
    if (rejected > 0) toast("warn", t("portableRejected")(rejected));
    if (degraded > 0) toast("warn", t("portableDegraded")(degraded));
    if (guardRejected > 0) toast("warn", t("portableGuardRejected")(guardRejected));
    if (needsReview > 0) toast("warn", t("portableNeedsReview")(needsReview));
    await refreshAll();
  }
  __name(doPortableImport, "doPortableImport");
  function buildPackageBox() {
    const box = el("fieldset", { class: "dm-package" }, [el("legend", { text: t("packageTitle") })]);
    const pkgFile = el("input", { type: "file", accept: ".fmlpkg,.json,.txt", style: "display:none", "aria-label": t("packageInstall") });
    pkgFile.addEventListener("change", () => guard(doPackageInstall, pkgFile.files?.[0]));
    box.append(
      el("small", { text: t("packageOffNote") }),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("packageInstall"), onclick: /* @__PURE__ */ __name(() => pkgFile.click(), "onclick") }),
        pkgFile
      ])
    );
    return box;
  }
  __name(buildPackageBox, "buildPackageBox");
  async function refreshPackages() {
    const page = await listInstalledPackages(db, { limit: MANAGER_POLICY.pageSize });
    assertLive();
    clear(packageList);
    if (!page.items.length) {
      packageList.appendChild(el("small", { text: t("packageNone") }));
      return;
    }
    for (const p of page.items) {
      const enabled = p.state === PACKAGE_STATE.active;
      const trustSel = el("select", {
        onchange: /* @__PURE__ */ __name((e) => guard(doPackageTrust, p.packageId, e.target.value), "onchange")
      });
      for (const m of Object.values(PACKAGE_TRUST_MODE)) {
        const opt = el("option", { value: m, text: m });
        if (p.trustMode === m) opt.selected = true;
        trustSel.appendChild(opt);
      }
      packageList.appendChild(el("div", { class: "dm-pkg" }, [
        // §114 DOM: Import 文字列は textContent のみ（innerHTML を使わない）
        el("span", { class: "dm-pkg-name", text: `${p.displayName} v${p.activeVersion ?? "-"}` }),
        el("span", {
          class: "dm-pkg-meta",
          /**
           * §102.3.15: integrity は **computed（再計算した値）の照合結果**を出す。
           * file の自己申告（declared hash 文字列）を integrity として表示しない。
           * また integrity / signature はいずれも Publisher Authenticity ではない
           * ので、"verified" と official/trusted を UI 上でも混同させない。
           */
          text: `${p.authorDisplayName ?? "?"} · ${p.publisherType} · ${p.state} · claims ${p.claimAttestationCount} · conflicts ${p.conflictCount} · integrity ${p.integrityStatus ?? "unknown"} · signature ${p.signatureStatus}`
        }),
        el("label", { class: "dm-pkg-trust" }, [el("span", { text: t("packageTrust") }), trustSel]),
        el("button", {
          type: "button",
          text: enabled ? t("packageDisable") : t("packageEnable"),
          onclick: /* @__PURE__ */ __name(() => guard(doPackageToggle, p.packageId, !enabled), "onclick")
        }),
        p.previousVersion ? el("button", {
          type: "button",
          text: t("packageRollback"),
          onclick: /* @__PURE__ */ __name(() => guard(doPackageRollback, p.packageId), "onclick")
        }) : null,
        el("button", {
          type: "button",
          text: t("packageUninstall"),
          onclick: /* @__PURE__ */ __name(() => guard(doPackageUninstall, p.packageId), "onclick")
        })
      ]));
    }
  }
  __name(refreshPackages, "refreshPackages");
  async function doPackageInstall(file) {
    if (!file) return;
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const stuck = await inspectPackageInstallState(db);
    if (stuck.inProgress) {
      if (!confirmFn(t("packageStuck"))) return;
      await rollbackPackageInstall(db);
    }
    const text = await file.text();
    const report = await dryRunPackageInstall(db, text);
    assertLive();
    if (!report.canActivate && !report.identityMismatch) {
      toast("warn", t("packageBlocked")(report));
      return;
    }
    if (!confirmFn(t("packageDryRun")(report))) return;
    let confirmIdentityChange = null;
    if (report.identityMismatch) {
      if (!confirmFn(t("packageIdentityWarn")(report.identityMismatch))) return;
      confirmIdentityChange = PACKAGE_IDENTITY_OVERRIDE_CONFIRMATION;
    }
    const out = await installPackage(db, text, { confirmIdentityChange, env });
    assertLive();
    const summary = buildPackageImportReport(out);
    bc.post({ type: "bulkDictionaryChanged", count: summary.newClaims });
    toast("success", `${t("done")} +${summary.newClaims} / evidence ${summary.evidenceAdded}`);
    await refreshAll();
  }
  __name(doPackageInstall, "doPackageInstall");
  async function doPackageToggle(packageId, enable) {
    if (enable) await enablePackage(db, packageId);
    else await disablePackage(db, packageId);
    assertLive();
    bc.post({ type: "bulkDictionaryChanged" });
    toast("success", t("done"));
    await refreshAll();
  }
  __name(doPackageToggle, "doPackageToggle");
  async function doPackageTrust(packageId, trustMode) {
    await setPackageTrustMode(db, packageId, trustMode);
    assertLive();
    bc.post({ type: "bulkDictionaryChanged" });
    toast("success", t("done"));
    await refreshAll();
  }
  __name(doPackageTrust, "doPackageTrust");
  async function doPackageRollback(packageId) {
    const r = await rollbackPackage(db, packageId);
    assertLive();
    bc.post({ type: "bulkDictionaryChanged" });
    toast("success", `${t("done")} → v${r.activeVersion}`);
    await refreshAll();
  }
  __name(doPackageRollback, "doPackageRollback");
  async function doPackageUninstall(packageId) {
    if (!confirmFn(t("packageUninstallConfirm"))) return;
    await uninstallPackage(db, packageId);
    assertLive();
    bc.post({ type: "bulkDictionaryChanged" });
    toast("success", t("done"));
    await refreshAll();
  }
  __name(doPackageUninstall, "doPackageUninstall");
  async function doDownloadBackup() {
    const fileName = "fmlncgen-backup.fmlbak";
    const picker = globalThis.showSaveFilePicker;
    if (typeof picker === "function") {
      let handle;
      try {
        handle = await picker({ suggestedName: fileName, types: [{ description: "FMlncGen backup", accept: { "application/octet-stream": [".fmlbak"] } }] });
      } catch (e) {
        if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return;
        throw e;
      }
      const writable = await handle.createWritable();
      const sink2 = {
        kind: "fs-stream",
        async write(chunk) {
          await writable.write(typeof chunk === "string" ? chunk : String(chunk));
        },
        async close() {
          await writable.close();
        },
        async abort() {
          try {
            await writable.abort();
          } catch {
          }
        }
      };
      let info2;
      try {
        info2 = await backupToSink(db, { sink: sink2 });
      } catch (e) {
        try {
          await sink2.abort();
        } catch {
        }
        throw e;
      }
      assertLive();
      toast("success", `${t("done")} (${info2.recordCount} records)`);
      return;
    }
    const sink = createBlobSink();
    const info = await backupToSink(db, { sink });
    const blob = sink.toBlob();
    assertLive();
    const href = trackUrl(URL.createObjectURL(blob));
    const a = el("a", { href, download: fileName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    later(() => releaseUrl(href), 4e3);
    toast("success", `${t("done")} (${info.recordCount} records · ${t("blobCapNote")})`);
  }
  __name(doDownloadBackup, "doDownloadBackup");
  async function doRestore(file) {
    if (!file) return;
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    if (!confirmFn(t("restoreConfirm"))) return;
    const res = await restoreFullBackup(db, backupSourceFromBlob(file), { confirm: RESTORE_CONFIRMATION, env });
    bc.post(res.broadcast);
    toast("success", `${t("done")} ${JSON.stringify(res.restored)}`);
    await refreshAll();
  }
  __name(doRestore, "doRestore");
  async function doMerge(file) {
    if (!file) return;
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    if (!confirmFn(t("mergeConfirm"))) return;
    const res = await mergeBackup(db, backupSourceFromBlob(file), { confirm: MERGE_CONFIRMATION, env });
    bc.post(res.broadcast);
    toast("success", `${t("done")} +${JSON.stringify(res.added)}`);
    await refreshAll();
  }
  __name(doMerge, "doMerge");
  async function doClearPwa() {
    const r = await refreshPwaAssetCache({});
    const missing = r.ok && Array.isArray(r.missing) ? r.missing.map((u) => String(u).split("/").pop()) : [];
    if (r.ok && missing.length) toast("warn", t("pwaPartial")(r.entries, missing));
    else if (r.ok) toast("success", t("pwaRefreshed")(r.entries));
    else toast(r.reason === "busy" ? "warn" : "error", t("pwaRefused")(r.reason));
    updatePwaSize();
  }
  __name(doClearPwa, "doClearPwa");
  async function doDeleteOldCaches() {
    const plan = await planOldPwaCaches({});
    if (!plan.ok) {
      toast("error", t("oldCacheRefused")(plan.reason));
      return;
    }
    const kept = Array.isArray(plan.protected) ? plan.protected : [];
    if (!plan.targets.length) {
      toast("success", t("oldCacheNone")(kept));
      updatePwaSize();
      return;
    }
    if (!confirmFn(t("oldCacheConfirm")(plan.targets, plan.bytes, kept))) {
      toast("warn", t("oldCacheCancelled"));
      return;
    }
    const r = await deleteOldPwaCaches({ names: plan.targets.map((x) => x.name) });
    if (r.ok) toast("success", t("oldCacheDone")(r.deleted.length, r.bytes, kept));
    else toast("error", t("oldCacheRefused")(r.reason));
    updatePwaSize();
  }
  __name(doDeleteOldCaches, "doDeleteOldCaches");
  async function updatePwaSize() {
    const seq = ++pwaSizeSeq;
    pwaSizeLine.textContent = t("pwaSizeMeasuring");
    const r = await measurePwaCacheSize(pwaSizeOpts);
    if (closed || seq !== pwaSizeSeq) return;
    pwaSizeLine.textContent = r.ok ? t("pwaSize")(r.bytes) : t("pwaSizeUnavailable");
  }
  __name(updatePwaSize, "updatePwaSize");
  async function doClearReso() {
    await clearResolutionCacheOnly(db);
    toast("success", t("done"));
  }
  __name(doClearReso, "doClearReso");
  async function doCleanJobs() {
    const r = await cleanupJobRuntime(db, { confirm: true });
    toast("success", `${t("done")} (${r.removedJobs} jobs)`);
  }
  __name(doCleanJobs, "doCleanJobs");
  async function doReset() {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const p = await previewDestructiveReset(db);
    const n = p.counts[Object.keys(p.counts).find((k) => k.includes("claims"))] ?? 0;
    if (!confirmFn(t("resetPreview")(n))) return;
    if (confirmFn(t("resetBackupFirst"))) {
      await doDownloadBackup();
    }
    const phrase = promptFn(t("resetPrompt"), "");
    if (phrase == null) return;
    const res = await destructiveResetUserDictionary(db, { confirmationPhrase: phrase });
    bc.post({ type: "bulkDictionaryChanged", scope: "all", revision: res.userDictionaryRevision });
    toast("success", `${t("done")} (reset)`);
    await refreshAll();
  }
  __name(doReset, "doReset");
  function buildReviewBox() {
    const box = el("fieldset", { class: "dm-review" }, [el("legend", { text: t("reviewTitle") })]);
    box.append(
      el("small", { text: t("reviewDesc") }),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("reviewRefresh"), onclick: /* @__PURE__ */ __name(() => guard(refreshReview), "onclick") }),
        reviewInfo
      ]),
      reviewList,
      el("div", { class: "dm-review-pager" }, [reviewPrev, reviewNext])
    );
    return box;
  }
  __name(buildReviewBox, "buildReviewBox");
  async function refreshReview() {
    if (!reviewSession) reviewSession = createActiveReviewQueueSession(db);
    await reviewSession.refresh();
    assertLive();
    reviewOffset = 0;
    renderReview();
  }
  __name(refreshReview, "refreshReview");
  function renderReview() {
    if (!reviewSession) return;
    const page = reviewSession.page({ offset: reviewOffset, limit: REVIEW_PAGE_SIZE });
    clear(reviewList);
    if (!page.items.length) {
      reviewList.appendChild(el("small", { text: t("reviewEmpty") }));
    }
    for (const row of page.items) {
      const act = el("div", { class: "dm-rq-act" });
      act.append(
        el("button", { type: "button", text: t("reviewConfirm"), onclick: /* @__PURE__ */ __name(() => guard(doReviewConfirm, row), "onclick") }),
        el("button", { type: "button", text: t("reviewAlternate"), onclick: /* @__PURE__ */ __name(() => guard(doReviewCorrect, row), "onclick") }),
        el("button", { type: "button", text: t("reviewDefer"), onclick: /* @__PURE__ */ __name(() => guard(doReviewDefer, row), "onclick") }),
        el("button", { type: "button", text: t("reviewHide"), onclick: /* @__PURE__ */ __name(() => guard(doReviewHide, row), "onclick") }),
        el("button", { type: "button", text: t("reviewEvidence"), onclick: /* @__PURE__ */ __name(() => guard(doReviewEvidence, row), "onclick") })
      );
      reviewList.appendChild(el("div", { class: "dm-rq", dataset: { claimId: row.claimId } }, [
        // §114 DOM: すべて textContent（innerHTML を使わない）。
        el("span", { class: "dm-rq-src", text: `${row.sourceText ?? ""} → ${String(row.value ?? "")}` }),
        el("span", {
          class: "dm-rq-meta",
          text: `${t("reviewImpact")} ${row.reviewImpactScore.toFixed(2)} · ${row.conflictState ?? ""} ${row.revalidationState ?? ""} · uses ${row.useCount} · deps ${row.dependentCount}`
        }),
        act
      ]));
    }
    reviewInfo.textContent = t("reviewPool")(page.poolSize, page.scanned ?? 0);
    reviewPrev.disabled = reviewOffset === 0;
    reviewNext.disabled = page.done;
  }
  __name(renderReview, "renderReview");
  async function doReviewConfirm(row) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    await confirmReviewQueueClaim(db, row.claimId, { actor: "user:manager" });
    assertLive();
    bc.post({ type: "evidenceChanged", scope: "claims" });
    toast("success", t("reviewConfirmed"));
    await refreshReview();
  }
  __name(doReviewConfirm, "doReviewConfirm");
  async function doReviewCorrect(row) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const v = promptFn(t("reviewAlternatePrompt"), String(row.value ?? ""));
    if (v == null || v === "") return;
    const res = await applyReviewQueueCorrection(db, row.claimId, v, { actor: "user:manager" });
    assertLive();
    bc.post({ type: "claimChanged", scope: "claims" });
    toast(
      res.disposition === "applied" ? "success" : "warn",
      res.disposition === "applied" ? t("reviewCorrected") : t("reviewNoChange")
    );
    await refreshReview();
  }
  __name(doReviewCorrect, "doReviewCorrect");
  async function doReviewDefer(row) {
    await deferClaimReview(db, row.claimId, {
      actor: "user:manager",
      until: Date.now() + REVIEW_DEFER_MS,
      reason: "manager_defer"
    });
    assertLive();
    toast("info", t("reviewDeferred"));
    await refreshReview();
  }
  __name(doReviewDefer, "doReviewDefer");
  async function doReviewHide(row) {
    await hideClaimReviewTemporarily(db, row.claimId, {
      actor: "user:manager",
      until: Date.now() + REVIEW_HIDE_MS,
      reason: "manager_hide"
    });
    assertLive();
    await refreshReview();
  }
  __name(doReviewHide, "doReviewHide");
  async function doReviewEvidence(row) {
    const d = await getReviewQueueEvidenceDetails(db, row.claimId, {});
    assertLive();
    detailBox.hidden = false;
    clear(detailBox);
    detailBox.append(
      el("div", { class: "dm-dh" }, [
        el("strong", { text: `${row.sourceText ?? ""} → ${String(row.value ?? "")}` }),
        el("button", { type: "button", text: t("close"), onclick: /* @__PURE__ */ __name(() => {
          detailBox.hidden = true;
        }, "onclick") })
      ])
    );
    for (const ev of d.items) {
      detailBox.appendChild(el("div", { class: "dm-kv" }, [
        el("b", { text: ev.evidenceType }),
        el("span", { text: `${ev.stance} · ${ev.provider ?? "-"} · ${ev.modelFamily ?? "-"}${ev.invalidatedAt ? " · invalidated" : ""}` })
      ]));
    }
  }
  __name(doReviewEvidence, "doReviewEvidence");
  function buildAttentionBox() {
    const box = el("fieldset", { class: "dm-attention" }, [el("legend", { text: t("attentionTitle") })]);
    box.append(
      el("small", { text: t("attentionDesc") }),
      el("div", { class: "dm-op" }, [
        el("button", { type: "button", text: t("attentionRefresh"), onclick: /* @__PURE__ */ __name(() => guard(refreshAttention), "onclick") }),
        attentionInfo
      ]),
      attentionList
    );
    return box;
  }
  __name(buildAttentionBox, "buildAttentionBox");
  async function refreshAttention() {
    const gathered = await gatherNeedsAttention(db, {});
    assertLive();
    attentionRows = gathered.items;
    attentionScanned = gathered.scanned;
    renderAttention();
  }
  __name(refreshAttention, "refreshAttention");
  function renderAttention() {
    const page = pageNeedsAttention(attentionRows, { offset: 0, limit: REVIEW_PAGE_SIZE });
    clear(attentionList);
    if (!page.items.length) attentionList.appendChild(el("small", { text: t("attentionEmpty") }));
    for (const row of page.items) {
      const reasons = row.reasons.map((r) => t(`attentionReason_${r}`)).join(" / ");
      attentionList.appendChild(el("div", { class: "dm-attn", dataset: { claimId: row.claimId } }, [
        el("span", { class: "dm-attn-src", text: `${row.sourceText ?? ""} → ${String(row.value ?? "")}` }),
        el("span", { class: "dm-attn-reason", text: reasons })
      ]));
    }
    attentionInfo.textContent = t("attentionPool")(attentionRows.length, attentionScanned);
  }
  __name(renderAttention, "renderAttention");
  function buildUndoBox() {
    const box = el("fieldset", { class: "dm-undo" }, [el("legend", { text: t("undoTitle") })]);
    box.append(
      el("small", { text: t("undoDesc") }),
      undoPackageList,
      el("div", { class: "dm-op" }, [
        el("label", { class: "dm-undo-batch" }, [
          el("span", { text: t("undoBatchLabel") }),
          undoBatchInput
        ]),
        el("button", { type: "button", text: t("undoBatchBtn"), onclick: /* @__PURE__ */ __name(() => guard(doUndoBatch), "onclick") })
      ]),
      undoResultBox
    );
    return box;
  }
  __name(buildUndoBox, "buildUndoBox");
  async function refreshUndoTargets() {
    const page = await listInstalledPackages(db, { limit: MANAGER_POLICY.pageSize });
    assertLive();
    clear(undoPackageList);
    for (const p of page.items) {
      if (!p.activeVersion) continue;
      undoPackageList.appendChild(el("div", { class: "dm-undo-pkg" }, [
        el("span", { text: `${p.displayName} v${p.activeVersion}` }),
        el("button", {
          type: "button",
          text: t("undoPackageBtn"),
          onclick: /* @__PURE__ */ __name(() => guard(doUndoPackage, p.packageId, p.activeVersion), "onclick")
        })
      ]));
    }
  }
  __name(refreshUndoTargets, "refreshUndoTargets");
  async function doUndoPackage(packageId, version) {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const preview = await previewPackageMutationUndo(db, { packageId, packageVersion: version });
    assertLive();
    if (preview.evidenceToInvalidate === 0) {
      toast("info", t("undoNothing"));
      return;
    }
    if (!confirmFn(t("undoPreview")(preview))) return;
    const r = await undoPackageMutation(db, {
      packageId,
      packageVersion: version,
      actor: "user:manager",
      confirm: true
    });
    assertLive();
    bc.post({ type: "bulkDictionaryChanged", scope: "mutation_undo" });
    showUndoResult(r);
    await refreshAll();
  }
  __name(doUndoPackage, "doUndoPackage");
  async function doUndoBatch() {
    if ((await refreshBanner()).blocked) {
      toast("warn", t("maintenanceMode"));
      return;
    }
    const mutationId = undoBatchInput.value.trim();
    if (!mutationId) return;
    const preview = await previewMutationIdUndo(db, { mutationId });
    assertLive();
    if (preview.evidenceToInvalidate === 0) {
      toast("info", t("undoNothing"));
      return;
    }
    if (!confirmFn(t("undoPreview")(preview))) return;
    const r = await undoMutationById(db, {
      mutationId,
      mutationKind: MUTATION_KIND.aiBatch,
      actor: "user:manager",
      confirm: true
    });
    assertLive();
    bc.post({ type: "bulkDictionaryChanged", scope: "mutation_undo" });
    showUndoResult(r);
    await refreshAll();
  }
  __name(doUndoBatch, "doUndoBatch");
  function showUndoResult(r) {
    clear(undoResultBox);
    undoResultBox.appendChild(el("span", { text: t("undoResult")(r) }));
    toast(r.partial ? "warn" : "success", t("undoResult")(r));
  }
  __name(showUndoResult, "showUndoResult");
  async function refreshAll() {
    if (closed) return;
    const b = await refreshBanner();
    if (closed) return;
    setDisabled(false);
    if (b.blocked) return;
    await rerunCurrent();
    if (closed) return;
    await refreshPackages();
    if (closed) return;
    await refreshReview();
    if (closed) return;
    await refreshAttention();
    if (closed) return;
    await refreshUndoTargets();
    if (closed) return;
    await showHealth();
  }
  __name(refreshAll, "refreshAll");
  function destroy() {
    if (closed) return;
    closed = true;
    for (const id of pendingTimers) {
      try {
        clearTimeout(id);
      } catch {
      }
    }
    pendingTimers.clear();
    for (const u of pendingUrls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
      }
    }
    pendingUrls.clear();
    try {
      bc.close();
    } catch {
    }
    maybeCloseDb();
    try {
      clear(container);
    } catch {
    }
  }
  __name(destroy, "destroy");
  function keepFocus(fn) {
    return () => {
      const doc = root.ownerDocument;
      const prev = doc.activeElement;
      return Promise.resolve(fn()).finally(() => {
        if (closed || !prev || !root.contains(prev) || prev.disabled || doc.activeElement === prev) return;
        if (doc.activeElement && doc.activeElement !== doc.body) return;
        prev.focus();
      });
    };
  }
  __name(keepFocus, "keepFocus");
  const doSearch = keepFocus(runSearch);
  const doClear = keepFocus(clearSearch);
  searchBtn.addEventListener("click", () => doSearch());
  clearBtn.addEventListener("click", () => doClear());
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter") doSearch();
    else if (e.key === "Escape" && (input.value !== "" || curSpec.mode !== SEARCH_MODE.recent)) {
      e.preventDefault();
      doClear();
    }
  });
  prevBtn.addEventListener("click", () => guard(async () => {
    if (pageIndex === 0) return;
    curPage = await search.search(curSpec);
    renderedQueryId = curPage.queryId;
    for (let i = 0; i < pageIndex - 1; i += 1) {
      if (curPage.done) break;
      curPage = await search.nextPage(curPage.nextCursor);
    }
    pageIndex = Math.max(0, pageIndex - 1);
    renderRows(curPage);
  }));
  nextBtn.addEventListener("click", () => goNext());
  updatePwaSize();
  await refreshAll();
  return {
    el: root,
    destroy,
    // 開き直し（index.html が既存 handle を再表示する）でも容量を測り直す
    refresh: /* @__PURE__ */ __name(() => {
      updatePwaSize();
      return refreshAll();
    }, "refresh"),
    get closed() {
      return closed;
    },
    _internals: { db, get closed() {
      return closed;
    }, pendingTimers, pendingUrls, search: /* @__PURE__ */ __name(() => search, "search"), MANAGER_POLICY, MAINTENANCE_OPS }
  };
}
__name(mountManagerUI, "mountManagerUI");
var dictionary_manager_ui_default = mountManagerUI;
export {
  MANAGER_I18N,
  ManagerClosedError,
  dictionary_manager_ui_default as default,
  mountManagerUI
};
