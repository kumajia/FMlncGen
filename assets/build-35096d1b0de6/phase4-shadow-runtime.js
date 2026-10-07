import {
  resolveName
} from "./shared-dictionary-resolver.js";
import {
  BUILTIN_DICTIONARY_VERSION,
  EVIDENCE_TYPE,
  HISTORY_ACTION,
  LEASE_POLICY,
  LIFECYCLE_STATE,
  LeaseError,
  OWNER_TOKEN,
  PARSER_VERSION,
  SOURCE_NORMALIZER_VERSION,
  STANCE,
  STORE,
  SUBJECT_KIND,
  VALUE_NORMALIZER_VERSION,
  VERIFICATION_STATE,
  __name,
  acquireMaintenanceLease,
  addHistory,
  buildClaimRecord,
  buildEvidenceDedupeKey,
  buildEvidenceRecord,
  buildHistoryRecord,
  builtinContentFingerprint,
  claimGroupKey,
  classifyLegacyRecordValue,
  classifyLegacySourceKind,
  clearResolutionCacheIn,
  dictionaryMaintenanceState,
  foldedNormalizedSource,
  getMeta,
  isKnownTarget,
  isLegacyReachableSourceKey,
  iterateIndex,
  lexicalSubjectKey,
  markClaimScoreInputChanged,
  newOpaqueId,
  normalizeClaimValue,
  openDictionaryDB,
  originRecordKey,
  parseLegacyDictionaryJson,
  patchClaimQuarantineState,
  phraseSubjectKey,
  releaseMaintenanceLease,
  renewMaintenanceLease,
  runRead,
  runSemanticMutation,
  semanticKey,
  stableHash,
  strictNormalizedSource,
  upsertClaimBySemanticKey,
  upsertEvidenceByDedupeKey
} from "./shared-dictionary-core.js";

// dictionary-legacy-migration.js
var LEGACY_MIGRATION_VERSION = 1;
var LEGACY_MIGRATION_STATE = Object.freeze({
  notStarted: "not_started",
  running: "running",
  completed: "completed",
  failed: "failed"
});
var LEGACY_MIGRATION_PHASE = Object.freeze({
  writing: "writing",
  // §106-5 Chunk write / §106-6 Checkpoint（staged）
  verifying: "verifying",
  // §106-8 Integrity check（**まだ quarantined のまま**）
  activating: "activating",
  // §106.2 staging 解除（Maintenance Lease 下）
  finalizing: "finalizing",
  // §106-9 completed marker 直前
  done: "done"
  // finalization marker 済み
});
var LEGACY_MIGRATION_LEASE_TYPE = "legacy_migration";
var LEGACY_SOURCE_KIND = Object.freeze({
  localStorageV1: "fm_user_dict",
  localStorageV2: "fm_user_dict_v2",
  jsonFile: "legacy_json_file"
});
var LEGACY_SOURCE_KINDS = new Set(Object.values(LEGACY_SOURCE_KIND));
function legacyApplicabilitySignature(sourceKey, valueType, value) {
  const norm = normalizeClaimValue(valueType, value, null);
  return JSON.stringify([strictNormalizedSource(sourceKey), valueType, norm.normalizedValue]);
}
__name(legacyApplicabilitySignature, "legacyApplicabilitySignature");
var LEGACY_ORIGIN_SOURCE_KIND = "legacy_user_dictionary";
var LEGACY_MIGRATION_ACTOR = "legacy_migration";
var LEGACY_MIGRATION_POLICY = Object.freeze({
  // §106:「100k件を1Transactionへ詰め込まない」
  chunkSize: 200,
  // 1 record は最大 3 slot（t / l3 / l6）なので transaction あたりの上限はこの式。
  maxSlotsPerRecord: 3,
  // §120-47: integrity / staging 解除も bounded page で回す
  integrityChunkSize: 200,
  stagingReleaseChunkSize: 200,
  // digest fold の 1 chunk あたり record 数（§107 bounded memory）
  digestChunkSize: 200,
  // 診断用に保持する invalid record の上限。件数自体は別カウンタで全件数える。
  maxInvalidReported: 200,
  // dry-run report の collapse 検出で保持する key 数の上限（§148.2 bounded）
  dryRunMaxTrackedKeys: 5e4,
  // 返却する Broadcast event の保持件数（診断用。送信自体は毎 chunk 行う）
  maxBroadcastEventsKept: 50,
  // §106.2:「新規 imported Claim だけを一時 quarantined + stagingSessionId」
  stagingEnabled: true,
  // §105:「黙って completed marker だけを信用して新 record を無視しない」
  rerunOnSourceChange: true
});
var LegacyMigrationError = class extends Error {
  static {
    __name(this, "LegacyMigrationError");
  }
  constructor(message, details) {
    super(message);
    this.name = "LegacyMigrationError";
    this.details = details;
  }
};
function readLegacyStorageSources(storage) {
  if (!storage || typeof storage.getItem !== "function") {
    throw new LegacyMigrationError("readLegacyStorageSources: storage.getItem is required", {});
  }
  const out = [];
  for (const sourceKind of [LEGACY_SOURCE_KIND.localStorageV2, LEGACY_SOURCE_KIND.localStorageV1]) {
    let rawJsonText = null;
    try {
      rawJsonText = storage.getItem(sourceKind);
    } catch (e) {
      out.push({
        sourceKind,
        sourceId: sourceKind,
        present: false,
        rawJsonText: null,
        unreadable: true,
        error: String(e?.message ?? e)
      });
      continue;
    }
    out.push({
      sourceKind,
      sourceId: sourceKind,
      // localStorage key 名 = stable source identity
      present: typeof rawJsonText === "string" && rawJsonText.length > 0,
      rawJsonText
    });
  }
  return out;
}
__name(readLegacyStorageSources, "readLegacyStorageSources");
async function buildLegacySourcePlan({
  sourceKind,
  sourceId = null,
  rawJsonText,
  policy = LEGACY_MIGRATION_POLICY
} = {}) {
  if (!LEGACY_SOURCE_KINDS.has(sourceKind)) {
    throw new LegacyMigrationError(`unknown legacy sourceKind: ${sourceKind}`, { sourceKind });
  }
  const parsed = parseLegacyDictionaryJson(rawJsonText);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, error: parsed.error ?? null, sourceKind };
  }
  const raw = parsed.value;
  const keys = Object.keys(raw).sort();
  const counts = {
    records: keys.length,
    stringRecords: 0,
    objectRecords: 0,
    slots: 0,
    byValueType: { japanese_display: 0, club_3letter_display: 0, club_6letter_display: 0 },
    lexical: 0,
    phrase: 0,
    emptyValue: 0,
    invalidKey: 0,
    unsupportedValue: 0,
    rejectedObjectFields: 0,
    unknownObjectFields: 0
  };
  const invalid = [];
  let invalidTotal = 0;
  const legacyApplicability = /* @__PURE__ */ new Map();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const rec = classifyLegacyRecordValue(key, raw[key]);
    if (rec.kind === "string") counts.stringRecords++;
    else if (rec.kind === "object") counts.objectRecords++;
    else if (rec.kind === "empty") counts.emptyValue++;
    else if (rec.kind === "invalid_key") counts.invalidKey++;
    else if (rec.kind === "unsupported") counts.unsupportedValue++;
    if (rec.kind === "empty" || rec.kind === "invalid_key" || rec.kind === "unsupported" || rec.kind === "object" && rec.fields.length === 0) {
      invalidTotal++;
      if (invalid.length < policy.maxInvalidReported) {
        invalid.push({ sourceText: key, kind: rec.kind, reason: rec.kind });
      }
    }
    counts.rejectedObjectFields += rec.rejected?.length ?? 0;
    counts.unknownObjectFields += rec.unknownFields?.length ?? 0;
    for (const f of rec.fields) {
      counts.slots++;
      counts.byValueType[f.valueType] = (counts.byValueType[f.valueType] ?? 0) + 1;
      if (!isLegacyReachableSourceKey(key)) continue;
      let signature;
      try {
        signature = legacyApplicabilitySignature(key, f.valueType, f.value);
      } catch {
        continue;
      }
      const bucket = legacyApplicability.get(signature);
      if (bucket) {
        if (!bucket.includes(key)) bucket.push(key);
      } else {
        legacyApplicability.set(signature, [key]);
      }
    }
    if (rec.fields.length > 0) {
      const kindInfo = classifyLegacySourceKind(key, PARSER_VERSION);
      counts[kindInfo.kind]++;
    }
  }
  for (const bucket of legacyApplicability.values()) bucket.sort();
  const sourceFingerprint = await foldSourceFingerprint({
    sourceKind,
    sourceId: sourceId ?? sourceKind,
    raw,
    keys,
    policy
  });
  return {
    ok: true,
    sourceKind,
    sourceId: sourceId ?? sourceKind,
    sourceFingerprint,
    raw,
    keys,
    // CR-10 derived compatibility metadata。sourceFingerprint には入れない
    // （raw source そのものは変わっていないので re-migration を誘発させない）。
    legacyApplicability,
    recordCount: keys.length,
    slotCount: counts.slots,
    counts,
    invalid,
    invalidTotal,
    chunkSize: policy.chunkSize,
    policy
  };
}
__name(buildLegacySourcePlan, "buildLegacySourcePlan");
async function foldSourceFingerprint({ sourceKind, sourceId, raw, keys, policy }) {
  let digest = await stableHash({
    schema: "legacy-source-digest",
    version: LEGACY_MIGRATION_VERSION,
    sourceKind,
    sourceId,
    recordCount: keys.length
  });
  for (let i = 0; i < keys.length; i += policy.digestChunkSize) {
    const part = [];
    for (let j = i; j < Math.min(i + policy.digestChunkSize, keys.length); j++) {
      part.push([keys[j], raw[keys[j]] === void 0 ? null : raw[keys[j]]]);
    }
    digest = await stableHash({
      schema: "legacy-source-digest",
      version: LEGACY_MIGRATION_VERSION,
      prev: digest,
      from: i,
      part
    });
  }
  return digest;
}
__name(foldSourceFingerprint, "foldSourceFingerprint");
function legacyOriginRecordKey({
  sourceKind,
  subjectSignature,
  normalizedSource,
  valueType,
  normalizedValue,
  originRecordKeyVersion = 1
}) {
  if (!LEGACY_SOURCE_KINDS.has(sourceKind)) {
    throw new LegacyMigrationError(`unknown legacy sourceKind: ${sourceKind}`, { sourceKind });
  }
  return originRecordKey({
    sourceKind: LEGACY_ORIGIN_SOURCE_KIND,
    // §102.6「migration source name」/「sourceKind」。file 名ではない。
    sourceId: sourceKind,
    recordIdentity: {
      migrationVersion: LEGACY_MIGRATION_VERSION,
      subjectSignature,
      normalizedSource,
      valueType,
      normalizedValue
    },
    originRecordKeyVersion
  });
}
__name(legacyOriginRecordKey, "legacyOriginRecordKey");
async function buildSlot(plan, legacySourceKey, field, ctx) {
  const kindInfo = classifyLegacySourceKind(legacySourceKey, PARSER_VERSION);
  const strict = strictNormalizedSource(legacySourceKey);
  const subjectKind = kindInfo.kind === "phrase" ? SUBJECT_KIND.phrase : SUBJECT_KIND.lexical;
  const subjectKey = subjectKind === SUBJECT_KIND.phrase ? await phraseSubjectKey(strict) : await lexicalSubjectKey(strict);
  const applicability = plan.legacyApplicability?.get(
    legacyApplicabilitySignature(legacySourceKey, field.valueType, field.value)
  );
  const legacySourceKeys = applicability ? [...applicability] : isLegacyReachableSourceKey(legacySourceKey) ? [legacySourceKey] : [];
  const claimRecord = await buildClaimRecord({
    subjectKind,
    subjectKey,
    valueType: field.valueType,
    value: field.value,
    script: null,
    sourceText: legacySourceKey,
    legacySourceKeys,
    provenance: { createdBy: LEGACY_MIGRATION_ACTOR, firstEvidenceRootId: null },
    // §105.1 Fixed Contract
    verificationState: VERIFICATION_STATE.legacyUser,
    locked: false,
    lifecycleState: LIFECYCLE_STATE.active,
    // §106.2 新規 imported Claim だけ staging する
    quarantined: ctx.stagingEnabled,
    quarantineMetadata: ctx.stagingEnabled ? { reason: "legacy_migration_staging", stagingSessionId: ctx.sessionId } : null,
    stagingSessionId: ctx.stagingEnabled ? ctx.sessionId : null,
    now: ctx.now
  });
  const originRecordKey2 = await legacyOriginRecordKey({
    sourceKind: plan.sourceKind,
    subjectSignature: claimRecord.claimGroupKey,
    normalizedSource: claimRecord.normalizedSource,
    valueType: claimRecord.valueType,
    normalizedValue: claimRecord.normalizedValue,
    originRecordKeyVersion: ctx.originRecordKeyVersion
  });
  const evidenceRecord = await buildEvidenceRecord({
    evidenceType: EVIDENCE_TYPE.legacyImport,
    // §19.1: claimId は dedupeKey の入力ではない。既存 Canonical Claim が居れば
    //        transaction 内で winner の claimId へ remap する（§139.7）。
    claimId: claimRecord.claimId,
    claimSemanticKey: claimRecord.semanticKey,
    stance: STANCE.support,
    valueType: field.valueType,
    originRecordKey: originRecordKey2,
    originRecordKeyVersion: ctx.originRecordKeyVersion,
    originInstallationId: ctx.installationId,
    context: {
      rawFacts: { originalName: legacySourceKey },
      canonicalFacts: {},
      inference: {}
    },
    parserVersion: PARSER_VERSION,
    sourceNormalizerVersion: SOURCE_NORMALIZER_VERSION,
    now: ctx.now
  });
  return {
    legacySourceKey,
    legacyField: field.legacyField,
    valueType: field.valueType,
    subjectKind,
    originRecordKey: originRecordKey2,
    semanticKey: claimRecord.semanticKey,
    dedupeKey: evidenceRecord.dedupeKey,
    claimRecord,
    evidenceRecord
  };
}
__name(buildSlot, "buildSlot");
async function buildChunk(plan, fromIndex, ctx) {
  const slots = [];
  let i = fromIndex;
  while (i < plan.keys.length && slots.length < plan.chunkSize) {
    const key = plan.keys[i];
    const rec = classifyLegacyRecordValue(key, plan.raw[key]);
    for (const f of rec.fields) {
      slots.push(await buildSlot(plan, key, f, ctx));
    }
    i++;
  }
  return { slots, nextIndex: i };
}
__name(buildChunk, "buildChunk");
function newCheckpoint({ plan, sessionId, rootMutationId, now }) {
  return {
    version: LEGACY_MIGRATION_VERSION,
    state: LEGACY_MIGRATION_STATE.running,
    sourceFingerprint: plan.sourceFingerprint,
    completedAt: null,
    phase: LEGACY_MIGRATION_PHASE.writing,
    sessionId,
    rootMutationId,
    sourceKind: plan.sourceKind,
    sourceId: plan.sourceId,
    chunkSize: plan.chunkSize,
    totalRecords: plan.recordCount,
    expectedSlots: plan.slotCount,
    nextIndex: 0,
    chunksCommitted: 0,
    processedSlots: 0,
    activatedClaims: 0,
    counts: {
      createdClaims: 0,
      reusedClaims: 0,
      revivalBlocked: 0,
      createdEvidence: 0,
      dedupedEvidence: 0
    },
    startedAt: now,
    updatedAt: now,
    failure: null
  };
}
__name(newCheckpoint, "newCheckpoint");
function assertCheckpointExpectation(current, expect) {
  if (!expect) return;
  if (expect.sessionId !== void 0 && current?.sessionId !== expect.sessionId) {
    throw new LegacyMigrationError(
      "legacy migration checkpoint belongs to a different session; refusing to overwrite",
      { expected: expect.sessionId, current: current?.sessionId ?? null }
    );
  }
  if (expect.phase !== void 0 && current?.phase !== expect.phase) {
    throw new LegacyMigrationError(
      "legacy migration phase moved on; refusing to overwrite",
      { expected: expect.phase, current: current?.phase ?? null }
    );
  }
  if (expect.nextIndex !== void 0 && (current?.nextIndex ?? 0) !== expect.nextIndex) {
    throw new LegacyMigrationError(
      "legacy migration checkpoint moved on; refusing to rewind",
      { expected: expect.nextIndex, current: current?.nextIndex ?? null }
    );
  }
  if (expect.notCompleted && current?.state === LEGACY_MIGRATION_STATE.completed) {
    throw new LegacyMigrationError(
      "legacy migration is already completed; refusing to rewind the marker",
      { current: current.state }
    );
  }
}
__name(assertCheckpointExpectation, "assertCheckpointExpectation");
async function patchMigrationMeta(db, patch, {
  bumpRevision = false,
  fence = null,
  expect = null,
  clearCache = false
} = {}) {
  const extraStores = clearCache ? [STORE.cache] : [];
  const { result } = await runSemanticMutation(db, [STORE.meta], async ({ meta, patchMeta, tx }) => {
    const current = meta.legacyMigration ?? {};
    assertCheckpointExpectation(current, expect);
    const next = { ...current, ...patch };
    patchMeta({ legacyMigration: next });
    if (clearCache) await clearResolutionCacheIn(tx);
    return next;
  }, { bumpRevision, fence, extraStores });
  return result;
}
__name(patchMigrationMeta, "patchMigrationMeta");
function isTombstoned(claim) {
  return claim.deletedAt != null || claim.disabled === true || claim.supersededByClaimId != null || claim.lifecycleState === LIFECYCLE_STATE.archived;
}
__name(isTombstoned, "isTombstoned");
function reqOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
__name(reqOf, "reqOf");
function countIndexUpTo(index, key, max) {
  return new Promise((resolve, reject) => {
    const request = index.openKeyCursor(IDBKeyRange.only(key));
    let n = 0;
    request.onsuccess = () => {
      const c = request.result;
      if (!c) {
        resolve(n);
        return;
      }
      n++;
      if (n >= max) {
        resolve(n);
        return;
      }
      c.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
__name(countIndexUpTo, "countIndexUpTo");
async function commitChunk(db, { slots, checkpoint, chunkMutationId, now, faultInjector, fence }) {
  return runSemanticMutation(
    db,
    [STORE.claims, STORE.evidence, STORE.history],
    async ({ tx, meta, patchMeta }) => {
      assertCheckpointExpectation(meta.legacyMigration, {
        sessionId: checkpoint.sessionId,
        phase: LEGACY_MIGRATION_PHASE.writing,
        nextIndex: checkpoint.nextIndex,
        notCompleted: true
      });
      const delta = {
        createdClaims: 0,
        reusedClaims: 0,
        revivalBlocked: 0,
        createdEvidence: 0,
        dedupedEvidence: 0
      };
      for (const slot of slots) {
        if (faultInjector) faultInjector({ stage: "slot", slot });
        const claimOut = await upsertClaimBySemanticKey(tx, {
          semanticKey: slot.claimRecord.semanticKey,
          build: /* @__PURE__ */ __name(() => slot.claimRecord, "build")
        });
        const claim = claimOut.record;
        if (claimOut.created) {
          delta.createdClaims++;
          addHistory(tx, buildHistoryRecord({
            nodeId: claim.claimId,
            action: HISTORY_ACTION.claimCreated,
            changes: [],
            actor: LEGACY_MIGRATION_ACTOR,
            mutationId: chunkMutationId,
            detail: {
              valueType: slot.valueType,
              legacyField: slot.legacyField,
              originRecordKey: slot.originRecordKey
            },
            now
          }));
        } else {
          delta.reusedClaims++;
          if (isTombstoned(claim)) delta.revivalBlocked++;
        }
        const evidence = { ...slot.evidenceRecord, claimId: claim.claimId };
        const evOut = await upsertEvidenceByDedupeKey(tx, {
          dedupeKey: evidence.dedupeKey,
          build: /* @__PURE__ */ __name(() => evidence, "build")
        });
        if (evOut.created) {
          delta.createdEvidence++;
          if (!claimOut.created) await markClaimScoreInputChanged(tx, claim.claimId);
        } else {
          delta.dedupedEvidence++;
          const winner = evOut.record;
          await reqOf(tx.objectStore(STORE.evidence).put({
            ...winner,
            duplicateSeenCount: (winner.duplicateSeenCount ?? 0) + 1,
            lastSeenAt: now
          }));
        }
      }
      if (faultInjector) faultInjector({ stage: "beforeCheckpoint" });
      const next = {
        ...checkpoint,
        nextIndex: checkpoint.pendingNextIndex,
        chunksCommitted: checkpoint.chunksCommitted + 1,
        processedSlots: checkpoint.processedSlots + slots.length,
        counts: {
          createdClaims: checkpoint.counts.createdClaims + delta.createdClaims,
          reusedClaims: checkpoint.counts.reusedClaims + delta.reusedClaims,
          revivalBlocked: checkpoint.counts.revivalBlocked + delta.revivalBlocked,
          createdEvidence: checkpoint.counts.createdEvidence + delta.createdEvidence,
          dedupedEvidence: checkpoint.counts.dedupedEvidence + delta.dedupedEvidence
        },
        updatedAt: now
      };
      delete next.pendingNextIndex;
      patchMeta({ legacyMigration: next });
      return { delta, checkpoint: next };
    },
    { fence }
  );
}
__name(commitChunk, "commitChunk");
async function activateStagedClaims(db, checkpoint, {
  now,
  policy,
  faultInjector,
  fence,
  heartbeat = null
}) {
  let activated = checkpoint.activatedClaims ?? 0;
  let activatedNow = 0;
  const pages = [];
  for (; ; ) {
    if (heartbeat) await heartbeat();
    const page = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName: "stagingSessionId",
      query: IDBKeyRange.only(checkpoint.sessionId),
      limit: policy.stagingReleaseChunkSize
    });
    if (page.items.length === 0) break;
    if (faultInjector) faultInjector({ stage: "beforeActivationPage", count: page.items.length });
    const committed = await runSemanticMutation(
      db,
      [STORE.claims],
      async ({ meta, tx, patchMeta }) => {
        assertCheckpointExpectation(meta.legacyMigration, {
          sessionId: checkpoint.sessionId,
          phase: LEGACY_MIGRATION_PHASE.activating,
          notCompleted: true
        });
        for (const claim of page.items) {
          await patchClaimQuarantineState(tx, claim.claimId, {
            quarantined: false,
            quarantineMetadata: null,
            stagingSessionId: null
          }, { now });
        }
        activated += page.items.length;
        activatedNow += page.items.length;
        const next = {
          ...meta.legacyMigration,
          activatedClaims: activated,
          updatedAt: now
        };
        patchMeta({ legacyMigration: next });
        return next;
      },
      { fence }
    );
    pages.push(page.items.length);
    if (faultInjector) faultInjector({ stage: "afterActivationPage", count: page.items.length });
    checkpoint = committed.result;
  }
  return { activated, activatedNow, pages, checkpoint };
}
__name(activateStagedClaims, "activateStagedClaims");
var VERIFY_STAGE = Object.freeze({
  /** activation **前**。この session の新規 Claim は quarantine されたままが正しい。 */
  preActivation: "pre_activation",
  /** activation **後**。staging は 1 件も残っていないのが正しい。 */
  postActivation: "post_activation"
});
async function verifyLegacyMigration(db, plan, {
  sessionId = null,
  stage = VERIFY_STAGE.postActivation,
  /** §98 長時間 integrity 中に Maintenance Lease を維持するための heartbeat。 */
  onChunk = null,
  policy = LEGACY_MIGRATION_POLICY
} = {}) {
  const problems = [];
  const ctx = await buildSlotContext(db, { sessionId: sessionId ?? "verify", stagingEnabled: false });
  let checkedSlots = 0;
  let stagedSessionClaims = 0;
  const verifyPlan = { ...plan, chunkSize: policy.integrityChunkSize };
  let index = 0;
  while (index < verifyPlan.keys.length) {
    if (onChunk) await onChunk();
    const { slots, nextIndex } = await buildChunk(verifyPlan, index, ctx);
    index = nextIndex;
    if (slots.length === 0) continue;
    const observed = await runRead(db, [STORE.evidence, STORE.claims], async ({ store }) => {
      const evStore = store(STORE.evidence);
      const claimStore = store(STORE.claims);
      const rows = [];
      for (const slot of slots) {
        const ev = await reqOf(evStore.index("dedupeKey").get(slot.dedupeKey));
        const claim = ev ? await reqOf(claimStore.get(ev.claimId)) : null;
        const originCount = await countIndexUpTo(
          evStore.index("originRecordKey"),
          slot.originRecordKey,
          2
        );
        rows.push({ ev, claim, originCount });
      }
      return rows;
    });
    for (let k = 0; k < slots.length; k++) {
      const slot = slots[k];
      const { ev, claim, originCount } = observed[k];
      checkedSlots++;
      if (!ev) {
        problems.push({
          kind: "missing_evidence",
          originRecordKey: slot.originRecordKey,
          legacySourceKey: slot.legacySourceKey,
          valueType: slot.valueType
        });
        continue;
      }
      if (!claim) {
        problems.push({
          kind: "dangling_claim_reference",
          evidenceId: ev.evidenceId,
          claimId: ev.claimId
        });
        continue;
      }
      if (ev.evidenceType !== EVIDENCE_TYPE.legacyImport) {
        problems.push({
          kind: "wrong_evidence_type",
          evidenceId: ev.evidenceId,
          evidenceType: ev.evidenceType
        });
      }
      if (ev.originRecordKey !== slot.originRecordKey) {
        problems.push({ kind: "origin_record_key_mismatch", evidenceId: ev.evidenceId });
      }
      if (ev.claimSemanticKey !== slot.semanticKey || claim.semanticKey !== slot.semanticKey) {
        problems.push({
          kind: "semantic_key_mismatch",
          evidenceId: ev.evidenceId,
          claimId: claim.claimId
        });
      }
      const recomputed = await buildEvidenceDedupeKey(
        ev.evidenceType,
        { ...ev, valueType: slot.valueType }
      );
      if (recomputed !== ev.dedupeKey) {
        problems.push({ kind: "dedupe_key_mismatch", evidenceId: ev.evidenceId });
      }
      const stagedByThisSession = sessionId != null && claim.stagingSessionId === sessionId;
      if (stagedByThisSession) stagedSessionClaims++;
      if (stage === VERIFY_STAGE.postActivation) {
        if (claim.stagingSessionId != null || claim.quarantined === true) {
          problems.push({
            kind: "staging_not_released",
            claimId: claim.claimId,
            stagingSessionId: claim.stagingSessionId
          });
        }
      } else if (stagedByThisSession && claim.quarantined !== true) {
        problems.push({ kind: "staged_claim_prematurely_active", claimId: claim.claimId });
      }
      if (claim.value !== slot.claimRecord.value) {
        problems.push({ kind: "value_mismatch", claimId: claim.claimId });
      }
      if (stagedByThisSession) {
        if (claim.locked !== false) {
          problems.push({ kind: "new_legacy_claim_locked_at_creation", claimId: claim.claimId });
        }
        if (claim.verificationState !== VERIFICATION_STATE.legacyUser) {
          problems.push({
            kind: "new_legacy_claim_wrong_creation_authority",
            claimId: claim.claimId,
            verificationState: claim.verificationState
          });
        }
      }
      if (originCount > 1) {
        problems.push({
          kind: "duplicate_origin_record_key",
          originRecordKey: slot.originRecordKey,
          count: originCount
        });
      }
    }
  }
  if (sessionId && stage === VERIFY_STAGE.postActivation) {
    const leftover = await iterateIndex(db, {
      storeName: STORE.claims,
      indexName: "stagingSessionId",
      query: IDBKeyRange.only(sessionId),
      limit: 1
    });
    if (leftover.items.length > 0) {
      problems.push({ kind: "staging_session_leftover", sessionId });
    }
  }
  return { ok: problems.length === 0, problems, checkedSlots, stage, stagedSessionClaims };
}
__name(verifyLegacyMigration, "verifyLegacyMigration");
async function buildSlotContext(db, { sessionId, stagingEnabled, now = Date.now() }) {
  const meta = await getMeta(db);
  return {
    sessionId,
    stagingEnabled,
    now,
    installationId: meta?.installationId ?? null,
    originRecordKeyVersion: meta?.originRecordKeyVersion ?? 1
  };
}
__name(buildSlotContext, "buildSlotContext");
async function migrateLegacyDictionary(db, plan, {
  policy = LEGACY_MIGRATION_POLICY,
  now = Date.now(),
  broadcast = null,
  faultInjector = null,
  onChunkCommitted = null,
  lease = null,
  leaseTtlMs = LEASE_POLICY.defaultTtlMs,
  owner = OWNER_TOKEN
} = {}) {
  if (!plan?.ok) {
    throw new LegacyMigrationError("migrateLegacyDictionary: plan is not usable", { plan });
  }
  const runPlan = plan.chunkSize === policy.chunkSize ? plan : { ...plan, chunkSize: policy.chunkSize };
  const ownsLease = lease == null;
  let activeLease = lease;
  if (ownsLease) {
    activeLease = await acquireMaintenanceLease(db, {
      type: LEGACY_MIGRATION_LEASE_TYPE,
      ttlMs: leaseTtlMs,
      owner
    });
  }
  const fence = { owner: activeLease.owner, leaseEpoch: activeLease.leaseEpoch };
  let leaseExpiresAt = activeLease.expiresAt ?? null;
  const renewIfNeeded = /* @__PURE__ */ __name(async () => {
    const t = Date.now();
    if (leaseExpiresAt != null && t < leaseExpiresAt - LEASE_POLICY.heartbeatIntervalMs) return;
    const renewed = await renewMaintenanceLease(db, {
      owner: fence.owner,
      leaseEpoch: fence.leaseEpoch,
      ttlMs: leaseTtlMs,
      now: t
    });
    leaseExpiresAt = renewed.expiresAt;
  }, "renewIfNeeded");
  const events = [];
  let checkpoint = null;
  let maxSlotsInOneTransaction = 0;
  let integrity = null;
  let activatedClaims = 0;
  let activationPages = [];
  try {
    const meta = await getMeta(db);
    const prev = meta?.legacyMigration ?? null;
    const sameSource = prev?.sourceFingerprint === plan.sourceFingerprint;
    let resumed = false;
    if (prev?.state === LEGACY_MIGRATION_STATE.completed && sameSource && prev?.phase === LEGACY_MIGRATION_PHASE.done) {
      return {
        ok: true,
        skipped: true,
        reason: "already_completed",
        checkpoint: prev,
        integrity: null,
        activatedClaims: 0,
        activationPages: [],
        lease: fence,
        events: []
      };
    }
    const inFlight = prev?.state === LEGACY_MIGRATION_STATE.running || prev?.state === LEGACY_MIGRATION_STATE.failed || prev?.state === LEGACY_MIGRATION_STATE.completed && prev?.phase !== LEGACY_MIGRATION_PHASE.done;
    if (inFlight && !sameSource) {
      throw new LegacyMigrationError(
        "an unfinished legacy migration exists for a different source fingerprint; resolve it explicitly before starting a new one",
        {
          previous: {
            state: prev.state,
            phase: prev.phase,
            sourceFingerprint: prev.sourceFingerprint,
            sessionId: prev.sessionId
          },
          requested: plan.sourceFingerprint
        }
      );
    }
    if (inFlight && sameSource) {
      resumed = true;
      checkpoint = {
        ...prev,
        state: LEGACY_MIGRATION_STATE.running,
        // phase は保持する。activating 途中で crash したら activating から再開する。
        phase: prev.phase ?? LEGACY_MIGRATION_PHASE.writing,
        failure: null,
        updatedAt: now
      };
      checkpoint = await patchMigrationMeta(
        db,
        checkpoint,
        { fence, expect: { sessionId: prev.sessionId } }
      );
    } else {
      checkpoint = newCheckpoint({
        plan,
        sessionId: newOpaqueId("legacymig"),
        rootMutationId: newOpaqueId("mut"),
        now
      });
      checkpoint = await patchMigrationMeta(db, checkpoint, { fence });
    }
    const ctx = await buildSlotContext(db, {
      sessionId: checkpoint.sessionId,
      stagingEnabled: policy.stagingEnabled,
      now
    });
    if (checkpoint.phase === LEGACY_MIGRATION_PHASE.writing) {
      while (checkpoint.nextIndex < runPlan.keys.length) {
        await renewIfNeeded();
        const { slots, nextIndex } = await buildChunk(runPlan, checkpoint.nextIndex, ctx);
        if (slots.length === 0) {
          checkpoint = await patchMigrationMeta(
            db,
            { ...checkpoint, nextIndex, updatedAt: now },
            { fence, expect: {
              sessionId: checkpoint.sessionId,
              phase: LEGACY_MIGRATION_PHASE.writing,
              nextIndex: checkpoint.nextIndex
            } }
          );
          continue;
        }
        maxSlotsInOneTransaction = Math.max(maxSlotsInOneTransaction, slots.length);
        const chunkMutationId = newOpaqueId("mut");
        const committed = await commitChunk(db, {
          slots,
          checkpoint: { ...checkpoint, pendingNextIndex: nextIndex },
          chunkMutationId,
          now,
          faultInjector,
          fence
        });
        checkpoint = committed.result.checkpoint;
        const event = {
          type: "bulkDictionaryChanged",
          revision: committed.userDictionaryRevision,
          scope: "claims",
          reason: "legacy_migration_chunk"
        };
        if (events.length < policy.maxBroadcastEventsKept) events.push(event);
        if (broadcast) broadcast(event);
        if (onChunkCommitted) await onChunkCommitted({ checkpoint, slots: slots.length });
      }
      checkpoint = await patchMigrationMeta(
        db,
        { ...checkpoint, phase: LEGACY_MIGRATION_PHASE.verifying, updatedAt: now },
        { fence, expect: {
          sessionId: checkpoint.sessionId,
          phase: LEGACY_MIGRATION_PHASE.writing
        } }
      );
    }
    if (checkpoint.phase === LEGACY_MIGRATION_PHASE.verifying) {
      await renewIfNeeded();
      if (faultInjector) faultInjector({ stage: "beforeIntegrity" });
      integrity = await verifyLegacyMigration(db, runPlan, {
        sessionId: checkpoint.sessionId,
        stage: VERIFY_STAGE.preActivation,
        onChunk: renewIfNeeded,
        policy
      });
      if (!integrity.ok) {
        checkpoint = await patchMigrationMeta(db, {
          ...checkpoint,
          state: LEGACY_MIGRATION_STATE.failed,
          completedAt: null,
          failure: {
            kind: "integrity_check_failed",
            problems: integrity.problems.slice(0, 20),
            problemCount: integrity.problems.length,
            at: now
          },
          updatedAt: now
        }, { fence, expect: { sessionId: checkpoint.sessionId } });
        return {
          ok: false,
          skipped: false,
          resumed,
          checkpoint,
          integrity,
          activatedClaims: 0,
          activationPages: [],
          events,
          maxSlotsInOneTransaction,
          lease: fence
        };
      }
      checkpoint = await patchMigrationMeta(
        db,
        { ...checkpoint, phase: LEGACY_MIGRATION_PHASE.activating, updatedAt: now },
        { fence, expect: {
          sessionId: checkpoint.sessionId,
          phase: LEGACY_MIGRATION_PHASE.verifying
        } }
      );
    }
    if (checkpoint.phase === LEGACY_MIGRATION_PHASE.activating) {
      await renewIfNeeded();
      const activation = await activateStagedClaims(
        db,
        checkpoint,
        { now, policy, faultInjector, fence, heartbeat: renewIfNeeded }
      );
      checkpoint = activation.checkpoint;
      activatedClaims = activation.activated;
      activationPages = activation.pages;
      if (activation.pages.length > 0) {
        const event = {
          type: "bulkDictionaryChanged",
          revision: null,
          scope: "claims",
          reason: "legacy_migration_activation"
        };
        if (events.length < policy.maxBroadcastEventsKept) events.push(event);
        if (broadcast) broadcast(event);
      }
      checkpoint = await patchMigrationMeta(
        db,
        { ...checkpoint, phase: LEGACY_MIGRATION_PHASE.finalizing, updatedAt: now },
        { fence, expect: {
          sessionId: checkpoint.sessionId,
          phase: LEGACY_MIGRATION_PHASE.activating
        } }
      );
    }
    await renewIfNeeded();
    const finalIntegrity = await verifyLegacyMigration(db, runPlan, {
      sessionId: checkpoint.sessionId,
      stage: VERIFY_STAGE.postActivation,
      onChunk: renewIfNeeded,
      policy
    });
    integrity = finalIntegrity;
    if (!finalIntegrity.ok) {
      checkpoint = await patchMigrationMeta(db, {
        ...checkpoint,
        state: LEGACY_MIGRATION_STATE.failed,
        completedAt: null,
        failure: {
          kind: "post_activation_integrity_failed",
          problems: finalIntegrity.problems.slice(0, 20),
          problemCount: finalIntegrity.problems.length,
          at: now
        },
        updatedAt: now
      }, { fence, expect: { sessionId: checkpoint.sessionId } });
      return {
        ok: false,
        skipped: false,
        resumed,
        checkpoint,
        integrity,
        activatedClaims,
        activationPages,
        events,
        maxSlotsInOneTransaction,
        lease: fence
      };
    }
    if (faultInjector) faultInjector({ stage: "beforeCompletedMarker" });
    checkpoint = await patchMigrationMeta(db, {
      ...checkpoint,
      state: LEGACY_MIGRATION_STATE.completed,
      phase: LEGACY_MIGRATION_PHASE.done,
      completedAt: now,
      failure: null,
      updatedAt: now
    }, { bumpRevision: true, fence, expect: { sessionId: checkpoint.sessionId }, clearCache: true });
    const finalEvent = {
      type: "bulkDictionaryChanged",
      revision: null,
      scope: "claims",
      reason: "legacy_migration_completed"
    };
    events.push(finalEvent);
    if (broadcast) broadcast(finalEvent);
    if (faultInjector) faultInjector({ stage: "beforeLeaseRelease" });
    return {
      ok: true,
      skipped: false,
      resumed,
      checkpoint,
      integrity,
      activatedClaims,
      activationPages,
      events,
      maxSlotsInOneTransaction,
      lease: fence
    };
  } catch (e) {
    if (checkpoint && !(e instanceof LeaseError)) {
      try {
        await patchMigrationMeta(db, {
          state: LEGACY_MIGRATION_STATE.failed,
          completedAt: null,
          failure: { kind: "exception", message: String(e?.message ?? e), at: now },
          updatedAt: now
        }, { fence, expect: { sessionId: checkpoint.sessionId, notCompleted: true } });
      } catch {
      }
    }
    throw e;
  } finally {
    if (ownsLease) {
      try {
        await releaseMaintenanceLease(db, { owner: fence.owner, leaseEpoch: fence.leaseEpoch });
      } catch {
      }
    }
  }
}
__name(migrateLegacyDictionary, "migrateLegacyDictionary");
async function recoverStaleMigrationLease(db, {
  now = Date.now(),
  owner = OWNER_TOKEN,
  ttlMs = LEASE_POLICY.defaultTtlMs
} = {}) {
  const meta = await getMeta(db);
  const state = dictionaryMaintenanceState(meta, { now, owner });
  if (state.maintenanceActive) {
    return { recovered: false, reason: "lease_still_live", state };
  }
  const lock = meta?.maintenanceLock ?? null;
  if (!lock || lock.owner == null) {
    return { recovered: false, reason: "no_stale_lease", state };
  }
  if (lock.type !== LEGACY_MIGRATION_LEASE_TYPE) {
    return { recovered: false, reason: "not_a_legacy_migration_lease", state };
  }
  const stolen = await acquireMaintenanceLease(db, {
    type: LEGACY_MIGRATION_LEASE_TYPE,
    ttlMs,
    owner,
    now
  });
  await releaseMaintenanceLease(db, { owner, leaseEpoch: stolen.leaseEpoch });
  const after = await getMeta(db);
  return {
    recovered: true,
    reason: "stale_lease_released",
    previousEpoch: lock.leaseEpoch,
    newEpoch: stolen.leaseEpoch,
    // completed marker は触っていない
    legacyMigration: after.legacyMigration,
    state: dictionaryMaintenanceState(after, { now, owner })
  };
}
__name(recoverStaleMigrationLease, "recoverStaleMigrationLease");

// dictionary-bootstrap.js
var BOOTSTRAP_VERSION = 1;
var LEGACY_BOOTSTRAP_META_FIELD = "legacyBootstrap";
var BOOTSTRAP_OUTCOME = Object.freeze({
  /** Legacy source が無い、または全て migration 済み。 */
  ready: "ready",
  /** Legacy source はあるが migration が失敗/未完了。 */
  legacyMigrationIncomplete: "legacy_migration_incomplete",
  /** localStorage を読めない（Storage 無効 / SecurityError 等）。 */
  legacySourceUnreadable: "legacy_source_unreadable",
  /** IndexedDB を開けない。New Resolver 自体が使えない。 */
  databaseUnavailable: "database_unavailable"
});
var SOURCE_OUTCOME = Object.freeze({
  absent: "absent",
  // localStorage に key が無い
  alreadyCompleted: "already_completed",
  // 同一 fingerprint が完了済み（冪等 skip）
  migrated: "migrated",
  unusableSource: "unusable_source",
  // JSON として読めない（Legacy も読めない）
  failed: "failed"
});
var MIGRATION_ORDER = Object.freeze([
  LEGACY_SOURCE_KIND.localStorageV1,
  LEGACY_SOURCE_KIND.localStorageV2
]);
function readOnlyLegacyStorage(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  return { getItem: /* @__PURE__ */ __name((k) => storage.getItem(k), "getItem") };
}
__name(readOnlyLegacyStorage, "readOnlyLegacyStorage");
function defaultStorage(env) {
  if (env && "localStorage" in env) return readOnlyLegacyStorage(env.localStorage);
  try {
    return typeof localStorage === "undefined" ? null : readOnlyLegacyStorage(localStorage);
  } catch {
    return null;
  }
}
__name(defaultStorage, "defaultStorage");
function readBootstrapMeta(meta) {
  const v = meta?.[LEGACY_BOOTSTRAP_META_FIELD];
  if (!v || typeof v !== "object") return { version: BOOTSTRAP_VERSION, sources: {} };
  const sources = v.sources && typeof v.sources === "object" ? v.sources : {};
  return { version: v.version ?? BOOTSTRAP_VERSION, sources };
}
__name(readBootstrapMeta, "readBootstrapMeta");
async function recordSourceCompleted(db, sourceKind, sourceFingerprint, now) {
  await runSemanticMutation(db, [STORE.meta], async ({ meta, patchMeta }) => {
    const current = readBootstrapMeta(meta);
    patchMeta({
      [LEGACY_BOOTSTRAP_META_FIELD]: {
        version: BOOTSTRAP_VERSION,
        sources: {
          ...current.sources,
          [sourceKind]: { sourceFingerprint, state: "completed", completedAt: now }
        }
      }
    });
    return true;
  }, { bumpRevision: false });
}
__name(recordSourceCompleted, "recordSourceCompleted");
async function ensureDictionaryReady({
  db = null,
  env = null,
  storage = void 0,
  openDb = openDictionaryDB,
  migrateFn = migrateLegacyDictionary,
  buildPlanFn = buildLegacySourcePlan,
  readSourcesFn = readLegacyStorageSources,
  recoverLeaseFn = recoverStaleMigrationLease,
  broadcast = null,
  now = /* @__PURE__ */ __name(() => Date.now(), "now")
} = {}) {
  const startedAt = Date.now();
  const errors = [];
  const sources = [];
  let ownsDb = false;
  let activeDb = db;
  if (!activeDb) {
    try {
      activeDb = await openDb(env ? { env } : {});
      ownsDb = true;
    } catch (e) {
      errors.push({ stage: "open_database", message: String(e?.message ?? e) });
      return {
        ok: false,
        outcome: BOOTSTRAP_OUTCOME.databaseUnavailable,
        db: null,
        ownsDb: false,
        legacyMigrationReady: false,
        sources,
        errors,
        durationMs: Date.now() - startedAt
      };
    }
  }
  try {
    await recoverLeaseFn(activeDb, {});
  } catch (e) {
    errors.push({ stage: "recover_stale_lease", message: String(e?.message ?? e) });
  }
  const legacyStorage = storage === void 0 ? defaultStorage(env) : storage;
  if (!legacyStorage) {
    return {
      ok: true,
      outcome: BOOTSTRAP_OUTCOME.ready,
      db: activeDb,
      ownsDb,
      legacyMigrationReady: true,
      sources,
      errors,
      durationMs: Date.now() - startedAt
    };
  }
  let available;
  try {
    available = readSourcesFn(legacyStorage);
  } catch (e) {
    errors.push({ stage: "read_legacy_sources", message: String(e?.message ?? e) });
    return {
      ok: false,
      outcome: BOOTSTRAP_OUTCOME.legacySourceUnreadable,
      db: activeDb,
      ownsDb,
      legacyMigrationReady: false,
      sources,
      errors,
      durationMs: Date.now() - startedAt
    };
  }
  const byKind = new Map(available.map((s) => [s.sourceKind, s]));
  const meta = await getMeta(activeDb).catch(() => null);
  const bootstrapMeta = readBootstrapMeta(meta);
  let allReady = true;
  for (const sourceKind of MIGRATION_ORDER) {
    const entry = byKind.get(sourceKind);
    if (!entry || entry.unreadable) {
      if (entry?.unreadable) {
        errors.push({ stage: "read_legacy_sources", sourceKind, message: entry.error ?? null });
      }
      sources.push({ sourceKind, outcome: SOURCE_OUTCOME.absent, sourceFingerprint: null });
      continue;
    }
    if (!entry.present) {
      sources.push({ sourceKind, outcome: SOURCE_OUTCOME.absent, sourceFingerprint: null });
      continue;
    }
    let plan;
    try {
      plan = await buildPlanFn({
        sourceKind,
        sourceId: entry.sourceId ?? sourceKind,
        rawJsonText: entry.rawJsonText
      });
    } catch (e) {
      errors.push({ stage: "build_plan", sourceKind, message: String(e?.message ?? e) });
      sources.push({ sourceKind, outcome: SOURCE_OUTCOME.failed, sourceFingerprint: null });
      allReady = false;
      continue;
    }
    if (!plan?.ok) {
      sources.push({
        sourceKind,
        outcome: SOURCE_OUTCOME.unusableSource,
        sourceFingerprint: null,
        reason: plan?.reason ?? "unusable"
      });
      continue;
    }
    const known = bootstrapMeta.sources[sourceKind];
    if (known?.state === "completed" && known.sourceFingerprint === plan.sourceFingerprint) {
      sources.push({
        sourceKind,
        outcome: SOURCE_OUTCOME.alreadyCompleted,
        sourceFingerprint: plan.sourceFingerprint,
        records: plan.counts?.records ?? null
      });
      continue;
    }
    try {
      const result = await migrateFn(activeDb, plan, { broadcast });
      if (!result?.ok) {
        errors.push({
          stage: "migrate",
          sourceKind,
          message: result?.checkpoint?.failure?.kind ?? "migration_not_ok"
        });
        sources.push({
          sourceKind,
          outcome: SOURCE_OUTCOME.failed,
          sourceFingerprint: plan.sourceFingerprint
        });
        allReady = false;
        continue;
      }
      await recordSourceCompleted(activeDb, sourceKind, plan.sourceFingerprint, now());
      sources.push({
        sourceKind,
        outcome: result.skipped ? SOURCE_OUTCOME.alreadyCompleted : SOURCE_OUTCOME.migrated,
        sourceFingerprint: plan.sourceFingerprint,
        records: plan.counts?.records ?? null,
        resumed: result.resumed === true
      });
    } catch (e) {
      errors.push({ stage: "migrate", sourceKind, message: String(e?.message ?? e) });
      sources.push({
        sourceKind,
        outcome: SOURCE_OUTCOME.failed,
        sourceFingerprint: plan.sourceFingerprint
      });
      allReady = false;
    }
  }
  return {
    ok: allReady,
    outcome: allReady ? BOOTSTRAP_OUTCOME.ready : BOOTSTRAP_OUTCOME.legacyMigrationIncomplete,
    db: activeDb,
    ownsDb,
    // Cutover 後の呼び出し側はこれを見て New Resolver / Legacy fallback を選ぶ。
    legacyMigrationReady: allReady,
    sources,
    errors,
    durationMs: Date.now() - startedAt
  };
}
__name(ensureDictionaryReady, "ensureDictionaryReady");

// dictionary-builtin-loader.js
var BUILTIN_FORMAT_V2 = "FMlncGenBuiltinDictionary";
var BuiltinLoaderError = class extends Error {
  static {
    __name(this, "BuiltinLoaderError");
  }
  constructor(message, details) {
    super(message);
    this.name = "BuiltinLoaderError";
    this.details = details;
  }
};
function detectBuiltinFormat(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { format: "unknown", version: null };
  }
  if (json.format === BUILTIN_FORMAT_V2) {
    return { format: "v2", version: json.version ?? null };
  }
  const values = Object.values(json);
  if (values.length > 0 && values.every((v) => typeof v === "string")) {
    return { format: "v1", version: 1 };
  }
  if (values.length === 0) return { format: "v1", version: 1 };
  return { format: "unknown", version: null };
}
__name(detectBuiltinFormat, "detectBuiltinFormat");
async function buildSyntheticClaim({
  sourceText,
  value,
  valueType,
  builtinDictionaryVersion,
  index,
  script = null
}) {
  const kindInfo = classifyLegacySourceKind(sourceText, PARSER_VERSION);
  const strict = strictNormalizedSource(sourceText);
  const folded = foldedNormalizedSource(sourceText);
  const subjectKind = kindInfo.kind;
  const subjectKey = subjectKind === "lexical" ? await lexicalSubjectKey(strict) : await phraseSubjectKey(strict);
  const normalized = normalizeClaimValue(valueType, value, script);
  const groupKey = await claimGroupKey({
    subjectKind,
    subjectKey,
    valueType,
    script,
    explicitConstraintSignature: null,
    sourceNameGuardSignature: null
    // Builtin は Entity Guard を持たない
  });
  const semKey = await semanticKey({ claimGroupKey: groupKey, normalizedValue: normalized.normalizedValue });
  const candidateFingerprint = await stableHash({
    schema: "builtin-candidate",
    version: 1,
    subjectKind,
    subjectKey,
    valueType,
    script,
    normalizedValue: normalized.normalizedValue
  });
  return {
    // §66:「Builtin Claim は synthetic ID: builtin:<version>:... で Resolver内だけ扱える」
    syntheticId: `builtin:${builtinDictionaryVersion}:${index}`,
    origin: "builtin",
    builtinDictionaryVersion,
    subjectKind,
    subjectKey,
    sourceText,
    // §66.1.1「Raw sourceText は必ず残す」
    normalizedSource: strict,
    foldedSource: folded,
    sourceNormalizerVersion: SOURCE_NORMALIZER_VERSION,
    parserVersion: PARSER_VERSION,
    valueType,
    value: normalized.value,
    normalizedValue: normalized.normalizedValue,
    foldedValue: normalized.foldedValue,
    valueNormalizerVersion: VALUE_NORMALIZER_VERSION,
    script,
    claimGroupKey: groupKey,
    semanticKey: semKey,
    candidateFingerprint
  };
}
__name(buildSyntheticClaim, "buildSyntheticClaim");
async function loadBuiltinDictionary(json, { builtinDictionaryVersion = BUILTIN_DICTIONARY_VERSION } = {}) {
  const detected = detectBuiltinFormat(json);
  const warnings = [];
  const claims = [];
  if (detected.format === "v1") {
    let i = 0;
    for (const [sourceText, value] of Object.entries(json)) {
      if (typeof sourceText !== "string" || !sourceText) {
        warnings.push({ kind: "empty_source", index: i });
        i++;
        continue;
      }
      if (typeof value !== "string" || !value) {
        warnings.push({ kind: "empty_value", sourceText });
        i++;
        continue;
      }
      try {
        claims.push(await buildSyntheticClaim({
          sourceText,
          value,
          valueType: "japanese_display",
          builtinDictionaryVersion,
          index: i
        }));
      } catch (e) {
        warnings.push({ kind: "rejected_entry", sourceText, error: String(e.message ?? e) });
      }
      i++;
    }
  } else if (detected.format === "v2") {
    const entries = Array.isArray(json.claims) ? json.claims : [];
    if (!Array.isArray(json.claims)) warnings.push({ kind: "v2_missing_claims_array" });
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || typeof e !== "object") {
        warnings.push({ kind: "invalid_entry", index: i });
        continue;
      }
      const { sourceText, valueType = "japanese_display", value, script = null } = e;
      if (typeof sourceText !== "string" || !sourceText) {
        warnings.push({ kind: "empty_source", index: i });
        continue;
      }
      try {
        claims.push(await buildSyntheticClaim({
          sourceText,
          value,
          valueType,
          script,
          builtinDictionaryVersion,
          index: i
        }));
      } catch (err) {
        warnings.push({ kind: "rejected_entry", sourceText, error: String(err.message ?? err) });
      }
    }
  } else {
    throw new BuiltinLoaderError("unrecognised builtin dictionary format", { detected });
  }
  const counts = { total: claims.length, lexical: 0, phrase: 0 };
  for (const c of claims) counts[c.subjectKind] = (counts[c.subjectKind] ?? 0) + 1;
  const contentFingerprint = await builtinContentFingerprint(claims);
  return {
    builtinDictionaryVersion,
    format: detected.format,
    claims,
    warnings,
    counts,
    contentFingerprint
  };
}
__name(loadBuiltinDictionary, "loadBuiltinDictionary");
function indexBuiltinClaims(loaded) {
  const byNormalizedSource = /* @__PURE__ */ new Map();
  const byFoldedSource = /* @__PURE__ */ new Map();
  for (const c of loaded.claims) {
    push(byNormalizedSource, c.normalizedSource, c);
    if (c.foldedSource !== c.normalizedSource) push(byFoldedSource, c.foldedSource, c);
  }
  return {
    builtinDictionaryVersion: loaded.builtinDictionaryVersion,
    /** 内容 identity（resolveName が cache key と Hit 検証に使う）。 */
    contentFingerprint: loaded.contentFingerprint,
    size: loaded.claims.length,
    /** exact → folded の順（§58 の Alias lookup と同じ順序）。 */
    lookup(sourceText) {
      const strict = strictNormalizedSource(sourceText);
      const exact = byNormalizedSource.get(strict);
      if (exact) return { hits: exact, matchedBy: "normalized_source" };
      const folded = byFoldedSource.get(foldedNormalizedSource(sourceText));
      if (folded) return { hits: folded, matchedBy: "folded_source" };
      return { hits: [], matchedBy: null };
    }
  };
}
__name(indexBuiltinClaims, "indexBuiltinClaims");
function push(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
__name(push, "push");

// fm-source-adapter.js
var ADAPTER_ID = "fm-default";
var ADAPTER_VERSION = 1;
var SOURCE_SCHEMA_VERSION = 1;
var CANONICALIZER_VERSION = 1;
var ENTITY_ID_NAMESPACE = "fm";
var SourceAdapterError = class extends Error {
  static {
    __name(this, "SourceAdapterError");
  }
  constructor(message, details) {
    super(message);
    this.name = "SourceAdapterError";
    this.details = details;
  }
};
var KNOWN_RAW_FIELDS = Object.freeze([
  "target",
  "fmId",
  "originalName",
  "prefix",
  "country",
  "worldRegion"
]);
function hasFmId(rawInput) {
  return typeof rawInput?.fmId === "string" && /^\d+$/.test(rawInput.fmId);
}
__name(hasFmId, "hasFmId");
function toCanonicalInput(rawInput, { countryProfiles = null } = {}) {
  if (rawInput === null || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new SourceAdapterError("raw input must be a plain object", { got: typeof rawInput });
  }
  const degradations = [];
  const target = typeof rawInput.target === "string" && rawInput.target.trim() ? rawInput.target.trim() : null;
  if (!target) degradations.push({ field: "target", reason: "missing", effect: "generic_name_resolution" });
  else if (!isKnownTarget(target)) {
    degradations.push({ field: "target", reason: "unknown", value: target, effect: "generic_name_resolution" });
  }
  let entityIdentity = null;
  if (hasFmId(rawInput)) {
    entityIdentity = { namespace: ENTITY_ID_NAMESPACE, value: rawInput.fmId };
  } else if (rawInput.fmId !== void 0 && rawInput.fmId !== null) {
    degradations.push({
      field: "entityIdentity",
      reason: "invalid_fm_id",
      value: String(rawInput.fmId),
      effect: "entity_exact_lookup_skipped"
    });
  } else {
    degradations.push({ field: "entityIdentity", reason: "missing", effect: "entity_exact_lookup_skipped" });
  }
  const originalName = typeof rawInput.originalName === "string" ? rawInput.originalName : null;
  if (originalName === null) {
    degradations.push({ field: "originalName", reason: "missing", effect: "generic_name_resolution_unavailable" });
  }
  const countryRaw = typeof rawInput.country === "string" && rawInput.country.trim() ? rawInput.country : null;
  const worldRegionRaw = typeof rawInput.worldRegion === "string" && rawInput.worldRegion.trim() ? rawInput.worldRegion : null;
  if (!countryRaw) degradations.push({ field: "country", reason: "missing", effect: "no_country_context" });
  if (!worldRegionRaw) {
    degradations.push({ field: "worldRegion", reason: "missing", effect: "no_world_region_evidence" });
  }
  let countryCanonical = {
    countryRaw,
    countryCode: null,
    countryCanonicalizationVersion: null,
    ambiguous: false,
    candidates: null
  };
  let regionCanonical = {
    worldRegionRaw,
    worldRegionCode: null,
    worldRegionCanonicalizationVersion: null,
    ambiguous: false,
    candidates: null
  };
  if (countryProfiles) {
    countryCanonical = countryProfiles.canonicalizeCountry(countryRaw);
    regionCanonical = countryProfiles.canonicalizeWorldRegion(worldRegionRaw);
    if (countryRaw && countryCanonical.countryCode === null && !countryCanonical.ambiguous) {
      degradations.push({
        field: "country",
        reason: "unrecognised_alias",
        value: countryRaw,
        effect: "country_code_null_raw_preserved"
      });
    }
    if (countryCanonical.ambiguous) {
      degradations.push({
        field: "country",
        reason: "ambiguous_alias",
        value: countryRaw,
        candidates: countryCanonical.candidates,
        effect: "country_code_null_needs_doctor"
      });
    }
    if (worldRegionRaw && regionCanonical.worldRegionCode === null && !regionCanonical.ambiguous) {
      degradations.push({
        field: "worldRegion",
        reason: "unrecognised_alias",
        value: worldRegionRaw,
        effect: "world_region_code_null_raw_preserved"
      });
    }
  } else {
    degradations.push({
      field: "countryProfiles",
      reason: "not_loaded",
      effect: "raw_country_and_region_preserved_without_codes"
    });
  }
  const rawSnapshot = {};
  const unknownFields = {};
  for (const [k, v] of Object.entries(rawInput)) {
    if (KNOWN_RAW_FIELDS.includes(k)) rawSnapshot[k] = v;
    else unknownFields[k] = v;
  }
  const canonical = {
    originalName,
    normalizedOriginalName: originalName === null ? null : strictNormalizedSource(originalName),
    foldedOriginalName: originalName === null ? null : foldedNormalizedSource(originalName),
    sourceNormalizerVersion: SOURCE_NORMALIZER_VERSION,
    countryCode: countryCanonical.countryCode,
    countryCanonicalizationVersion: countryCanonical.countryCanonicalizationVersion,
    worldRegionCode: regionCanonical.worldRegionCode,
    worldRegionCanonicalizationVersion: regionCanonical.worldRegionCanonicalizationVersion
  };
  const capabilities = {
    entityIdentity: entityIdentity !== null,
    originalName: originalName !== null,
    prefix: typeof rawInput.prefix === "string",
    country: countryRaw !== null,
    countryCode: canonical.countryCode !== null,
    worldRegion: worldRegionRaw !== null,
    worldRegionCode: canonical.worldRegionCode !== null,
    knownTarget: target !== null && isKnownTarget(target)
  };
  return {
    source: {
      provider: "football_manager",
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
      canonicalizerVersion: CANONICALIZER_VERSION
      // §145.3: edition は推測しないので、そもそも field を持たない
    },
    target,
    entityIdentity,
    raw: {
      originalName: rawInput.originalName ?? null,
      fmId: rawInput.fmId ?? null,
      prefix: rawInput.prefix ?? null,
      country: countryRaw,
      worldRegion: worldRegionRaw
    },
    rawSnapshot,
    // §145.4 実際に取れた値をそのまま
    unknownFields,
    // §145.4 forward-compatible metadata
    canonical,
    capabilities,
    degradations
    // §145.2 何が取れなかったかを Fatal にせず伝える
  };
}
__name(toCanonicalInput, "toCanonicalInput");

// dictionary-shadow.js
var NEW_RESOLVER_DEFAULT_ON = true;
var SHADOW_COMPARISON_CATEGORY = Object.freeze({
  exactCompatible: "exact_compatible",
  intendedImprovement: "intended_improvement",
  compatibilityRegression: "compatibility_regression",
  newResolverUnresolved: "new_resolver_unresolved",
  newResolverConflict: "new_resolver_conflict"
});
function compareLegacyVsNew(legacyOutput, newResult, {
  intendedImprovementPredicate = null
} = {}) {
  if (newResult.resolutionState === "conflicted") {
    return {
      category: SHADOW_COMPARISON_CATEGORY.newResolverConflict,
      legacyOutput,
      newOutput: newResult.output ?? null,
      resolutionConflict: newResult.decisionTrace?.resolutionConflict ?? null
    };
  }
  if (newResult.resolutionState === "unresolved" || newResult.resolutionState === "partial") {
    return {
      category: SHADOW_COMPARISON_CATEGORY.newResolverUnresolved,
      legacyOutput,
      newOutput: newResult.output ?? null
    };
  }
  const newOutput = newResult.output;
  if (newOutput === legacyOutput) {
    return { category: SHADOW_COMPARISON_CATEGORY.exactCompatible, legacyOutput, newOutput };
  }
  if (typeof intendedImprovementPredicate === "function" && intendedImprovementPredicate(legacyOutput, newOutput)) {
    return {
      category: SHADOW_COMPARISON_CATEGORY.intendedImprovement,
      legacyOutput,
      newOutput,
      reason: "explicit_intended_improvement_predicate"
    };
  }
  return { category: SHADOW_COMPARISON_CATEGORY.compatibilityRegression, legacyOutput, newOutput };
}
__name(compareLegacyVsNew, "compareLegacyVsNew");
function summarizeShadowComparisons(comparisons) {
  const counts = {
    [SHADOW_COMPARISON_CATEGORY.exactCompatible]: 0,
    [SHADOW_COMPARISON_CATEGORY.intendedImprovement]: 0,
    [SHADOW_COMPARISON_CATEGORY.compatibilityRegression]: 0,
    [SHADOW_COMPARISON_CATEGORY.newResolverUnresolved]: 0,
    [SHADOW_COMPARISON_CATEGORY.newResolverConflict]: 0
  };
  for (const c of comparisons) counts[c.category] = (counts[c.category] ?? 0) + 1;
  return { total: comparisons.length, ...counts };
}
__name(summarizeShadowComparisons, "summarizeShadowComparisons");

// phase4-shadow-runtime.js
var SHADOW_RUNTIME_POLICY = Object.freeze({
  /** 1 run で shadow する最大 record 数。巨大貼り付けで UI を圧迫しない。 */
  maxRecordsPerRun: 200,
  /** 診断用に保持する divergence sample の最大数（raw name の巨大履歴を持たない）。 */
  maxDivergenceSamples: 20,
  /** sample へ載せる文字列の最大長。 */
  maxSampleTextLength: 80
});
function trimOrNull(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
__name(trimOrNull, "trimOrNull");
function buildShadowRawFacts(row, defaultTarget = null) {
  const rawName = typeof row?.originalNameRaw === "string" && row.originalNameRaw.length > 0 ? row.originalNameRaw : null;
  const prefix = trimOrNull(row?.prefix);
  const body = typeof row?.originalName === "string" ? row.originalName : "";
  const reconstructed = prefix ? `${prefix} ${body}` : body;
  const originalName = rawName ?? (reconstructed || null);
  return {
    target: trimOrNull(row?.entity) ?? trimOrNull(defaultTarget),
    fmId: row?.id === null || row?.id === void 0 ? null : String(row.id),
    originalName,
    /**
     * CR-3 診断: この record の originalName が raw source 由来か、Legacy の
     * parse 結果からの再構築かを区別する。false の record は
     * `rawUnavailable` として数え、raw boundary の evidence には数えない。
     */
    rawInputAvailable: rawName !== null,
    // 現行UIが実際に取得できるのは club の [国名] ヒントだけ。無ければ捏造しない。
    country: trimOrNull(row?.country),
    // 現行UIに world region 入力は存在しない（Phase 0 fixture 記載どおり）。
    worldRegion: null
  };
}
__name(buildShadowRawFacts, "buildShadowRawFacts");
function legacyVisibleOutput(row) {
  const translated = typeof row?.translated === "string" ? row.translated : "";
  if (!translated) return null;
  const prefix = trimOrNull(row?.prefix);
  return prefix ? `${prefix} ${translated}` : translated;
}
__name(legacyVisibleOutput, "legacyVisibleOutput");
function shadowRecordKey(rawFacts) {
  return [rawFacts.target ?? "", rawFacts.fmId ?? "", rawFacts.originalName ?? ""].join("\0");
}
__name(shadowRecordKey, "shadowRecordKey");
function emptyCounters() {
  return {
    attempted: 0,
    deduped: 0,
    skippedOverCap: 0,
    comparable: 0,
    exactCompatible: 0,
    intendedImprovement: 0,
    compatibilityRegression: 0,
    newUnresolved: 0,
    newConflict: 0,
    legacyUnresolved: 0,
    shadowError: 0,
    /** CR-3: originalName が raw source 由来だった record 数。 */
    rawInput: 0,
    /** CR-3: raw が取れず Legacy parse 結果から再構築した record 数。 */
    rawUnavailable: 0,
    /** CR-1: bootstrap が Legacy Migration を ready にできなかった run。 */
    legacyMigrationNotReady: 0
  };
}
__name(emptyCounters, "emptyCounters");
function truncate(s) {
  if (typeof s !== "string") return null;
  const max = SHADOW_RUNTIME_POLICY.maxSampleTextLength;
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}
__name(truncate, "truncate");
async function runShadowForVisibleRows(rows, {
  target = null,
  builtinDictionary = null,
  db = null,
  countryProfiles = null,
  policy = SHADOW_RUNTIME_POLICY,
  bootstrap = ensureDictionaryReady
} = {}) {
  const counters = emptyCounters();
  const divergences = [];
  const startedAt = Date.now();
  let ownDb = null;
  let bootstrapResult = null;
  try {
    const list = Array.isArray(rows) ? rows : [];
    let builtinIndex = null;
    if (builtinDictionary && typeof builtinDictionary === "object") {
      const loaded = await loadBuiltinDictionary(
        builtinDictionary,
        { builtinDictionaryVersion: BUILTIN_DICTIONARY_VERSION }
      );
      builtinIndex = indexBuiltinClaims(loaded);
    }
    bootstrapResult = await bootstrap({ db });
    if (!bootstrapResult.legacyMigrationReady) counters.legacyMigrationNotReady++;
    const activeDb = bootstrapResult.db ?? db ?? (ownDb = await openDictionaryDB());
    if (bootstrapResult.ownsDb) ownDb = bootstrapResult.db;
    const seen = /* @__PURE__ */ new Set();
    for (const row of list) {
      const rawFacts = buildShadowRawFacts(row, target);
      if (!rawFacts.originalName || !rawFacts.target) continue;
      if (rawFacts.rawInputAvailable) counters.rawInput++;
      else counters.rawUnavailable++;
      const key = shadowRecordKey(rawFacts);
      if (seen.has(key)) {
        counters.deduped++;
        continue;
      }
      seen.add(key);
      if (counters.attempted >= policy.maxRecordsPerRun) {
        counters.skippedOverCap++;
        continue;
      }
      counters.attempted++;
      const legacyOutput = legacyVisibleOutput(row);
      if (legacyOutput === null) counters.legacyUnresolved++;
      try {
        const canonicalInput = toCanonicalInput(rawFacts, { countryProfiles });
        const canonical = canonicalInput.canonical;
        const result = await resolveName(activeDb, {
          // D-1b: full canonical original name（prefix 込み）
          sourceText: canonical.originalName,
          target: canonicalInput.target ?? rawFacts.target,
          fmId: canonicalInput.entityIdentity?.value ?? null,
          countryCode: canonical.countryCode ?? null,
          worldRegionCode: canonical.worldRegionCode ?? null,
          requestedValueTypes: ["japanese_display"],
          builtinIndex
        });
        const newResult = result.values.japanese_display;
        if (legacyOutput === null || !rawFacts.rawInputAvailable) {
          if (newResult.resolutionState === "conflicted") counters.newConflict++;
          continue;
        }
        counters.comparable++;
        const cmp = compareLegacyVsNew(legacyOutput, newResult);
        switch (cmp.category) {
          case SHADOW_COMPARISON_CATEGORY.exactCompatible:
            counters.exactCompatible++;
            break;
          case SHADOW_COMPARISON_CATEGORY.intendedImprovement:
            counters.intendedImprovement++;
            break;
          case SHADOW_COMPARISON_CATEGORY.newResolverUnresolved:
            counters.newUnresolved++;
            break;
          case SHADOW_COMPARISON_CATEGORY.newResolverConflict:
            counters.newConflict++;
            break;
          default:
            counters.compatibilityRegression++;
            break;
        }
        if (cmp.category !== SHADOW_COMPARISON_CATEGORY.exactCompatible && divergences.length < policy.maxDivergenceSamples) {
          divergences.push({
            category: cmp.category,
            fmId: rawFacts.fmId,
            legacy: truncate(legacyOutput),
            shadow: truncate(newResult.output),
            state: newResult.resolutionState
          });
        }
      } catch (e) {
        counters.shadowError++;
        if (divergences.length < policy.maxDivergenceSamples) {
          divergences.push({
            category: "shadow_error",
            fmId: rawFacts.fmId,
            reason: truncate(String(e?.message ?? e))
          });
        }
      }
    }
    return {
      ok: true,
      defaultOn: NEW_RESOLVER_DEFAULT_ON,
      counters,
      divergences,
      // CR-1 診断: Legacy Migration が ready かどうかを Shadow の戻り値から見る。
      // Cutover 後はこの値が Legacy fallback 判定の入力になる（logic は同じ）。
      legacyMigration: bootstrapResult ? {
        ready: bootstrapResult.legacyMigrationReady,
        outcome: bootstrapResult.outcome,
        sources: bootstrapResult.sources,
        errorCount: bootstrapResult.errors.length
      } : null,
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (ownDb && typeof ownDb.close === "function") {
      try {
        ownDb.close();
      } catch {
      }
    }
  }
}
__name(runShadowForVisibleRows, "runShadowForVisibleRows");
var VISIBLE_ROUTE_REASON = Object.freeze({
  flagOff: "flag_off",
  bootstrapFailed: "bootstrap_failed",
  bootstrapTimeout: "bootstrap_timeout",
  legacyMigrationNotReady: "legacy_migration_not_ready",
  visibleRunError: "visible_run_error",
  /** B-A: ユーザーが停止を押した。**失敗ではない**（migration failure と混ぜない）。 */
  cancelled: "cancelled",
  /** B-A: index.html 側の module load timeout。呼び出し側が使う reason 名。 */
  moduleLoadTimeout: "module_load_timeout"
});
var VISIBLE_ROUTE_POLICY = Object.freeze({
  /** index.html 側の visible module load timeout（同じ値を index.html が持つ）。 */
  moduleLoadTimeoutMs: 8e3,
  /**
   * bootstrap（DB open + Legacy Migration）全体の hard timeout。
   * **正常な cold migration を殺さない値**であること（B-A-2）。
   * 待機中の中断は timeout ではなく cancel race が担う。
   */
  bootstrapTimeoutMs: 9e4,
  /** 1 record の `resolveName()` 上限。超えたらその行だけ Legacy へ倒す。 */
  resolveTimeoutMs: 3e3,
  /**
   * B-A-1: `shouldCancel()` だけを渡す呼び出し側のための polling 間隔。
   * `AbortSignal` を渡す場合は listener が即座に反応するので polling は
   * 保険にすぎない。busy loop にしないため必ず interval（timer）で行い、
   * 決着時に必ず解除する。
   */
  cancelPollMs: 25,
  /** event loop へ制御を返す間隔（件数 / 経過 ms のどちらか早い方）。 */
  yieldEveryRecords: 25,
  yieldEveryMs: 50,
  /** progress callback の throttle（件数 / 経過 ms のどちらか早い方）。 */
  progressEveryRecords: 25,
  progressEveryMs: 120,
  /** 逐次処理。速度目的の無制限並列化はしない。 */
  maxConcurrency: 1
});
function splitPreservedPrefixDisplay(output, sourceMap, legacyPrefix = "") {
  if (typeof output !== "string" || output.length === 0) return null;
  const legacy = typeof legacyPrefix === "string" ? legacyPrefix.trim() : "";
  let prefixEnd = -1;
  let bodyStart = -1;
  const preservedSource = [];
  if (Array.isArray(sourceMap)) {
    for (const seg of sourceMap) {
      if (!seg || seg.mapKind !== "source_segment") continue;
      if (bodyStart === -1 && seg.preserved === true) {
        prefixEnd = seg.outputEnd;
        preservedSource.push(typeof seg.sourceText === "string" ? seg.sourceText : "");
        continue;
      }
      if (bodyStart === -1) bodyStart = seg.outputStart;
    }
  }
  if (prefixEnd <= 0 || bodyStart <= prefixEnd) {
    return legacy === "" ? { prefix: "", body: output } : null;
  }
  const prefix = output.slice(0, prefixEnd);
  const body = output.slice(bodyStart);
  if (prefix + " " + body !== output) return null;
  const preservedWords = preservedSource.join(" ").replace(/\s+/g, " ").trim();
  if (preservedWords.toUpperCase() !== legacy.toUpperCase()) return null;
  return { prefix, body };
}
__name(splitPreservedPrefixDisplay, "splitPreservedPrefixDisplay");
function buildVisibleRawFacts(row, defaultTarget = null) {
  const rawName = typeof row?.originalNameRaw === "string" && row.originalNameRaw.length > 0 ? row.originalNameRaw : null;
  const target = trimOrNull(row?.entity) ?? trimOrNull(defaultTarget);
  if (rawName === null || target === null) return null;
  return {
    target,
    fmId: row?.id === null || row?.id === void 0 ? null : String(row.id),
    originalName: rawName,
    rawInputAvailable: true,
    country: trimOrNull(row?.country),
    worldRegion: null
  };
}
__name(buildVisibleRawFacts, "buildVisibleRawFacts");
function isCancelRequested(shouldCancel, signal, counters = null) {
  try {
    if (signal && signal.aborted === true) return true;
    if (typeof shouldCancel === "function" && shouldCancel() === true) return true;
  } catch {
    if (counters) counters.callbackError++;
  }
  return false;
}
__name(isCancelRequested, "isCancelRequested");
function yieldToEventLoop() {
  return new Promise((resolveYield) => {
    if (typeof MessageChannel === "function") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolveYield();
      };
      channel.port2.postMessage(0);
      return;
    }
    if (typeof setImmediate === "function") {
      setImmediate(resolveYield);
      return;
    }
    if (typeof setTimeout === "function") {
      setTimeout(resolveYield, 0);
      return;
    }
    resolveYield();
  });
}
__name(yieldToEventLoop, "yieldToEventLoop");
var BOUNDED_WAIT_STATUS = Object.freeze({
  fulfilled: "fulfilled",
  rejected: "rejected",
  timedOut: "timed_out",
  cancelled: "cancelled"
});
function raceOperationWithTimeoutAndCancel({
  operation,
  timeoutMs = 0,
  signal = null,
  shouldCancel = null,
  pollIntervalMs = VISIBLE_ROUTE_POLICY.cancelPollMs,
  counters = null
} = {}) {
  if (isCancelRequested(shouldCancel, signal, counters)) {
    return Promise.resolve({ status: BOUNDED_WAIT_STATUS.cancelled });
  }
  return new Promise((settle) => {
    let timer = null;
    let poll = null;
    let onAbort = null;
    let settled = false;
    const finish = /* @__PURE__ */ __name((outcome) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
      if (onAbort !== null && signal && typeof signal.removeEventListener === "function") {
        try {
          signal.removeEventListener("abort", onAbort);
        } catch {
        }
      }
      onAbort = null;
      settle(outcome);
    }, "finish");
    Promise.resolve().then(() => typeof operation === "function" ? operation() : operation).then(
      (value) => finish({ status: BOUNDED_WAIT_STATUS.fulfilled, value }),
      (error) => finish({ status: BOUNDED_WAIT_STATUS.rejected, error })
    );
    if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        finish({ status: BOUNDED_WAIT_STATUS.timedOut });
      }, timeoutMs);
    }
    if (signal && typeof signal.addEventListener === "function") {
      onAbort = /* @__PURE__ */ __name(() => finish({ status: BOUNDED_WAIT_STATUS.cancelled }), "onAbort");
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (typeof shouldCancel === "function" && typeof pollIntervalMs === "number" && Number.isFinite(pollIntervalMs) && pollIntervalMs > 0) {
      poll = setInterval(() => {
        if (isCancelRequested(shouldCancel, null, counters)) {
          finish({ status: BOUNDED_WAIT_STATUS.cancelled });
        }
      }, pollIntervalMs);
    }
  });
}
__name(raceOperationWithTimeoutAndCancel, "raceOperationWithTimeoutAndCancel");
function releaseAbandonedBootstrap(promise) {
  if (!promise || typeof promise.then !== "function") return;
  promise.then((r) => {
    if (r && r.ownsDb && r.db && typeof r.db.close === "function") {
      try {
        r.db.close();
      } catch {
      }
    }
  }, () => {
  });
}
__name(releaseAbandonedBootstrap, "releaseAbandonedBootstrap");
function createProgressEmitter(onProgress, total, policy, counters) {
  let lastCount = -1;
  let lastAt = 0;
  let high = 0;
  return /* @__PURE__ */ __name(function emit(state, force = false) {
    const processed = Math.min(total, Math.max(high, state.processed | 0));
    high = processed;
    const now = Date.now();
    if (!force && processed - lastCount < policy.progressEveryRecords && now - lastAt < policy.progressEveryMs) return false;
    lastCount = processed;
    lastAt = now;
    counters.progressEvents++;
    if (typeof onProgress !== "function") return true;
    try {
      onProgress({
        processed,
        total,
        resolved: state.resolved,
        fallback: processed - state.resolved,
        deduped: state.deduped,
        timedOut: state.timedOut,
        cancelled: state.cancelled === true,
        phase: state.phase
      });
    } catch {
      counters.callbackError++;
    }
    return true;
  }, "emit");
}
__name(createProgressEmitter, "createProgressEmitter");
function emptyVisibleCounters() {
  return {
    rows: 0,
    attempted: 0,
    deduped: 0,
    resolved: 0,
    rawUnavailable: 0,
    unresolved: 0,
    conflicted: 0,
    prefixSplitRejected: 0,
    resolveError: 0,
    bootstraps: 0,
    // --- B-A ---------------------------------------------------------------
    /** 入力行のうち処理し終えた数（cancel 時は全件未満で止まる）。 */
    processed: 0,
    /** `resolveName()` が timeout した **record** 数（その行だけ Legacy）。 */
    timedOut: 0,
    /** bootstrap が timeout した run（1 or 0。run 全体が Legacy）。 */
    bootstrapTimedOut: 0,
    /** cancel 後に届いて **破棄** した New 結果の数。 */
    lateDiscarded: 0,
    /** event loop へ制御を返した回数。 */
    yields: 0,
    /** progress callback を発火した回数。 */
    progressEvents: 0,
    /** 呼び出し側 callback（shouldCancel / onProgress）が投げた例外の数。 */
    callbackError: 0,
    /**
     * B-A-1: cancel を捕まえた地点。
     * `'pre' | 'bootstrap' | 'resolve' | 'loop' | null`
     * `'bootstrap'` / `'resolve'` は **待機中の race で** 捕まえたことを意味する
     * （await 前後の polling ではなく）。
     */
    cancelledPhase: null
  };
}
__name(emptyVisibleCounters, "emptyVisibleCounters");
async function runVisibleResolveForRows(rows, {
  target = null,
  builtinDictionary = null,
  db = null,
  countryProfiles = null,
  storage = void 0,
  env = null,
  bootstrap = ensureDictionaryReady,
  resolve = resolveName,
  defaultOn = NEW_RESOLVER_DEFAULT_ON,
  shouldCancel = null,
  signal = null,
  onProgress = null,
  policy = VISIBLE_ROUTE_POLICY
} = {}) {
  const counters = emptyVisibleCounters();
  const resolved = /* @__PURE__ */ Object.create(null);
  const list = Array.isArray(rows) ? rows : [];
  counters.rows = list.length;
  const state = {
    processed: 0,
    resolved: 0,
    deduped: 0,
    timedOut: 0,
    cancelled: false,
    phase: "start"
  };
  const emit = createProgressEmitter(onProgress, list.length, policy, counters);
  const cancelled = /* @__PURE__ */ __name(() => isCancelRequested(shouldCancel, signal, counters), "cancelled");
  const done = /* @__PURE__ */ __name((extra) => Object.assign({
    ok: false,
    defaultOn,
    ready: false,
    cancelled: false,
    reason: null,
    resolved: {},
    counters,
    legacyMigration: null
  }, extra), "done");
  if (defaultOn !== true) return done({ reason: VISIBLE_ROUTE_REASON.flagOff });
  if (cancelled()) {
    state.cancelled = true;
    state.phase = "cancelled";
    counters.cancelledPhase = "pre";
    emit(state, true);
    return done({ cancelled: true, reason: VISIBLE_ROUTE_REASON.cancelled });
  }
  state.phase = "bootstrap";
  emit(state, true);
  let ownDb = null;
  let bootstrapResult = null;
  try {
    counters.bootstraps++;
    let bootstrapPromise = null;
    const bootOutcome = await raceOperationWithTimeoutAndCancel({
      operation: /* @__PURE__ */ __name(() => {
        bootstrapPromise = bootstrap(Object.assign(
          { db },
          env ? { env } : {},
          storage === void 0 ? {} : { storage }
        ));
        return bootstrapPromise;
      }, "operation"),
      timeoutMs: policy.bootstrapTimeoutMs,
      signal,
      shouldCancel,
      counters,
      pollIntervalMs: policy.cancelPollMs
    });
    if (bootOutcome.status === BOUNDED_WAIT_STATUS.cancelled || cancelled()) {
      state.cancelled = true;
      state.phase = "cancelled";
      counters.cancelledPhase = "bootstrap";
      releaseAbandonedBootstrap(bootstrapPromise);
      emit(state, true);
      return done({ cancelled: true, reason: VISIBLE_ROUTE_REASON.cancelled });
    }
    if (bootOutcome.status === BOUNDED_WAIT_STATUS.timedOut) {
      counters.bootstrapTimedOut++;
      state.phase = "fallback";
      releaseAbandonedBootstrap(bootstrapPromise);
      emit(state, true);
      return done({
        reason: VISIBLE_ROUTE_REASON.bootstrapTimeout,
        legacyMigration: {
          ready: false,
          outcome: null,
          sources: [],
          errorCount: 0,
          lastError: "bootstrap_timeout"
        }
      });
    }
    if (bootOutcome.status === BOUNDED_WAIT_STATUS.rejected) throw bootOutcome.error;
    bootstrapResult = bootOutcome.value;
    const migration = {
      ready: bootstrapResult.legacyMigrationReady,
      outcome: bootstrapResult.outcome,
      sources: bootstrapResult.sources,
      errorCount: bootstrapResult.errors.length
    };
    if (!bootstrapResult.legacyMigrationReady) {
      if (bootstrapResult.ownsDb && bootstrapResult.db) ownDb = bootstrapResult.db;
      state.phase = "fallback";
      emit(state, true);
      return done({
        reason: bootstrapResult.db ? VISIBLE_ROUTE_REASON.legacyMigrationNotReady : VISIBLE_ROUTE_REASON.bootstrapFailed,
        legacyMigration: migration
      });
    }
    let builtinIndex = null;
    if (builtinDictionary && typeof builtinDictionary === "object") {
      const loaded = await loadBuiltinDictionary(
        builtinDictionary,
        { builtinDictionaryVersion: BUILTIN_DICTIONARY_VERSION }
      );
      builtinIndex = indexBuiltinClaims(loaded);
    }
    const activeDb = bootstrapResult.db ?? db ?? (ownDb = await openDictionaryDB());
    if (bootstrapResult.ownsDb) ownDb = bootstrapResult.db;
    state.phase = "resolve";
    emit(state, true);
    const byKey = /* @__PURE__ */ new Map();
    let sinceYieldRecords = 0;
    let lastYieldAt = Date.now();
    for (const row of list) {
      if (cancelled()) {
        state.cancelled = true;
        counters.cancelledPhase = "loop";
        break;
      }
      const rawFacts = buildVisibleRawFacts(row, target);
      if (!rawFacts) {
        counters.rawUnavailable++;
        counters.processed = ++state.processed;
        emit(state);
        continue;
      }
      const key = shadowRecordKey(rawFacts);
      if (byKey.has(key)) {
        counters.deduped++;
        state.deduped++;
        const cached = byKey.get(key);
        if (cached) {
          resolved[row.index] = cached;
          state.resolved++;
        }
        counters.processed = ++state.processed;
        emit(state);
        continue;
      }
      counters.attempted++;
      let visible = null;
      let resolveCancelled = false;
      try {
        const canonicalInput = toCanonicalInput(rawFacts, { countryProfiles });
        const canonical = canonicalInput.canonical;
        const outcome = await raceOperationWithTimeoutAndCancel({
          operation: /* @__PURE__ */ __name(() => resolve(activeDb, {
            sourceText: canonical.originalName,
            target: canonicalInput.target ?? rawFacts.target,
            fmId: canonicalInput.entityIdentity?.value ?? null,
            countryCode: canonical.countryCode ?? null,
            worldRegionCode: canonical.worldRegionCode ?? null,
            requestedValueTypes: ["japanese_display"],
            builtinIndex
          }), "operation"),
          timeoutMs: policy.resolveTimeoutMs,
          signal,
          shouldCancel,
          counters,
          pollIntervalMs: policy.cancelPollMs
        });
        if (outcome.status === BOUNDED_WAIT_STATUS.cancelled) {
          resolveCancelled = true;
        } else if (outcome.status === BOUNDED_WAIT_STATUS.timedOut) {
          counters.timedOut++;
          state.timedOut++;
        } else if (outcome.status === BOUNDED_WAIT_STATUS.rejected) {
          throw outcome.error;
        } else {
          const v = outcome.value.values.japanese_display;
          if (v.resolutionState === "conflicted") counters.conflicted++;
          else if (v.resolutionState !== "resolved") counters.unresolved++;
          if (v.resolutionState === "resolved" && typeof v.output === "string" && v.output) {
            const split = splitPreservedPrefixDisplay(v.output, v.sourceMap, row?.prefix ?? "");
            const rejoined = split === null ? null : split.prefix ? split.prefix + " " + split.body : split.body;
            if (rejoined === v.output) {
              visible = {
                prefix: split.prefix,
                translated: split.body,
                output: v.output,
                resolutionState: v.resolutionState
              };
            } else {
              counters.prefixSplitRejected++;
            }
          }
        }
      } catch {
        counters.resolveError++;
        visible = null;
      }
      if (resolveCancelled || cancelled()) {
        state.cancelled = true;
        counters.cancelledPhase = resolveCancelled ? "resolve" : "loop";
        if (visible) counters.lateDiscarded++;
        break;
      }
      byKey.set(key, visible);
      if (visible) {
        resolved[row.index] = visible;
        state.resolved++;
        counters.resolved++;
      }
      counters.processed = ++state.processed;
      emit(state);
      sinceYieldRecords++;
      const now = Date.now();
      if (sinceYieldRecords >= policy.yieldEveryRecords || now - lastYieldAt >= policy.yieldEveryMs) {
        sinceYieldRecords = 0;
        lastYieldAt = now;
        counters.yields++;
        await yieldToEventLoop();
      }
    }
    if (state.cancelled) {
      state.phase = "cancelled";
      emit(state, true);
      return done({
        cancelled: true,
        reason: VISIBLE_ROUTE_REASON.cancelled,
        resolved,
        legacyMigration: migration
      });
    }
    state.phase = "done";
    emit(state, true);
    return {
      ok: true,
      defaultOn,
      ready: true,
      cancelled: false,
      reason: null,
      resolved,
      counters,
      legacyMigration: migration
    };
  } catch (e) {
    state.phase = "fallback";
    emit(state, true);
    return done({
      reason: VISIBLE_ROUTE_REASON.visibleRunError,
      legacyMigration: {
        ready: bootstrapResult ? bootstrapResult.legacyMigrationReady : false,
        outcome: bootstrapResult ? bootstrapResult.outcome : null,
        sources: bootstrapResult ? bootstrapResult.sources : [],
        errorCount: bootstrapResult ? bootstrapResult.errors.length : 1,
        lastError: String(e && e.message || e)
      }
    });
  } finally {
    if (ownDb && typeof ownDb.close === "function") {
      try {
        ownDb.close();
      } catch {
      }
    }
  }
}
__name(runVisibleResolveForRows, "runVisibleResolveForRows");
export {
  BOUNDED_WAIT_STATUS,
  NEW_RESOLVER_DEFAULT_ON,
  SHADOW_COMPARISON_CATEGORY,
  SHADOW_RUNTIME_POLICY,
  VISIBLE_ROUTE_POLICY,
  VISIBLE_ROUTE_REASON,
  buildShadowRawFacts,
  buildVisibleRawFacts,
  isCancelRequested,
  legacyVisibleOutput,
  raceOperationWithTimeoutAndCancel,
  runShadowForVisibleRows,
  runVisibleResolveForRows,
  shadowRecordKey,
  splitPreservedPrefixDisplay,
  summarizeShadowComparisons
};
