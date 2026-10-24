#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  beforeFailurePolicy,
  eligibleOriginalAnnualFailure,
  requireSettledEvidence,
  settledWireEvidence,
} from "./settled-resources.mjs";
import {
  primaryProtocolIdentity,
  budgetProtocolIdentity,
} from "./protocol-fingerprints.mjs";
import {
  fixtureBrowserPolicy,
  fixtureTransportIsComplete,
} from "./fixture-browser.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const primaryProtocol = await primaryProtocolIdentity();
const budgetProtocol = await budgetProtocolIdentity();
const paintProof = JSON.parse(
  await readFile(
    new URL(
      "../../docs/performance/evidence/1450-observer-v4-before-proof.json",
      import.meta.url,
    ),
  ),
);
const paintProofSha256 =
  "ec1f85b2a63393b2ccf41edcd99162259a33803e059bbf9cb65fbcf134cee050";
if (sha(JSON.stringify(paintProof)) !== paintProofSha256)
  throw Error("Fixed raw native paint diagnostic proof changed.");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const p95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const modes = [
  "first-document",
  "repeat-link",
  "return-visit",
  "manual-refresh",
  "mutation-refresh",
];
const backendMetrics = [
  "queryCount",
  "queryDurationMs",
  "rowsRetrieved",
  "poolWaitMs",
  "cacheHits",
  "cacheMisses",
  "eventLoopDelayMs",
];
const policy = {
  version: 4,
  beforeResourceFailure: beforeFailurePolicy,
  observedNativePaint: {
    amendedAt: "2026-10-24T22:51:03Z",
    source: "5031575cc8c40db7d5e306ecb54c641c150c3846",
    proofSha256: paintProofSha256,
    proofHashEncoding: "sha256 of UTF-8 JSON.stringify(parsed public proof)",
    scope:
      "native first-document paint observation independent of eligible FAILED baseline UI behavior; never successful-route readiness",
    completeness:
      "all planned first-document samples (minimum20) finite with completed native read and at least1actual LCP entry; no prerequisite observation",
  },
  latency: { multiplier: 1.25, allowance: 250, floor: 500 },
  bytes: { multiplier: 1.1, allowance: 16384, floor: 16384 },
  resources: {
    multiplier: 1.25,
    floors: {
      queryCount: 10,
      queryDurationMs: 100,
      rowsRetrieved: 100,
      poolWaitMs: 25,
      cacheMisses: 5,
      eventLoopDelayMs: 10,
    },
  },
  failedCohort: "absolute plan.timeoutMs; no finite before usable-content p95",
  resourceScope:
    "condition-wide maximum full-request telemetry; no claimed per-cohort reduction",
};
const ceiling = (value, p) =>
  Math.ceil(Math.max(value * p.multiplier, value + p.allowance, p.floor));
const key = (s) => [s.condition, s.route, s.range, s.mode].join("/");
function cohorts(plan) {
  const result = [];
  for (const condition of plan.conditions)
    for (const route of plan.routes) {
      if (
        (route.roles && !route.roles.includes(condition.role)) ||
        (route.conditions && !route.conditions.includes(condition.name))
      )
        continue;
      for (const range of plan.ranges) {
        if (route.ranges && !route.ranges.includes(range.name)) continue;
        for (const mode of route.modes ?? modes)
          result.push({
            condition: condition.name,
            route: route.name,
            range: range.name,
            mode,
            count: plan.samplesByMode?.[mode] ?? plan.samples,
            clock: !!route.clockReady,
          });
      }
    }
  return result;
}
function observedPaintComplete(samples) {
  return (
    samples.length >= 20 &&
    samples.every(
      (s) =>
        s.mode === "first-document" &&
        s.resourceScope === "measured-visit" &&
        (s.backendTraceId ?? s.traceId) === s.traceId &&
        Number.isFinite(s.lcpMs) &&
        s.lcpMs >= 0 &&
        s.nativePerformanceObservation?.readCompleted === true &&
        Number.isSafeInteger(s.nativePerformanceObservation.lcpEntries) &&
        s.nativePerformanceObservation.lcpEntries > 0,
    )
  );
}
function derive(plan, before, releaseRuntime, native) {
  const releasePlan = structuredClone(plan);
  releasePlan.phase = "release";
  Object.assign(releasePlan.runtime, releaseRuntime);
  const conditions = {};
  for (const condition of plan.conditions) {
    const samples = before.samples.filter(
      (s) => s.condition === condition.name,
    );
    conditions[condition.name] = Object.fromEntries(
      Object.entries(policy.resources.floors).map(([metric, floor]) => [
        metric,
        Math.ceil(
          Math.max(
            Math.max(...samples.map((s) => s.backend[metric])) *
              policy.resources.multiplier,
            Math.max(...samples.map((s) => s.backend[metric])) + floor,
          ),
        ),
      ]),
    );
  }
  const limits = cohorts(plan).map((c) => {
    const samples = before.samples.filter((s) => key(s) === key(c));
    const failed = samples.filter((s) => s.failed || s.censored).length;
    const result = {
      key: key(c),
      samples: samples.length,
      failed,
      censored: samples.filter((s) => s.censored).length,
    };
    for (const name of [
      "usableContentMs",
      "clockReadyMs",
      "javascriptBytes",
      "rscBytes",
      "totalBytes",
      "inlineRscDecodedBytes",
      "lcpMs",
    ]) {
      if (
        (name === "clockReadyMs" && !c.clock) ||
        (["inlineRscDecodedBytes", "lcpMs"].includes(name) &&
          c.mode !== "first-document")
      )
        continue;
      const values = samples.map((s) => s[name]);
      const unavailable = values.some((v) => !Number.isFinite(v));
      const resourceCensored = byteCensored(samples, name);
      const completeNativePaint =
        name === "lcpMs" &&
        observedPaintComplete(samples) &&
        samples.every(
          (s) =>
            !s.failed ||
            (s.usableContentMs === null &&
              eligibleOriginalAnnualFailure(
                plan,
                s,
                native.find(
                  (e) => e.traceId === (s.backendTraceId ?? s.traceId),
                ),
              )),
        );
      const beforeP95 =
        name === "lcpMs"
          ? completeNativePaint
            ? p95(values)
            : null
          : failed || unavailable || resourceCensored
            ? null
            : p95(values);
      result[name] = {
        beforeP95,
        ceiling:
          beforeP95 === null
            ? failed && ["usableContentMs", "clockReadyMs"].includes(name)
              ? plan.timeoutMs
              : null
            : ceiling(
                beforeP95,
                name.endsWith("Ms") ? policy.latency : policy.bytes,
              ),
        basis:
          name === "lcpMs"
            ? completeNativePaint
              ? failed
                ? "observed-native-paint-of-FAILED-baseline-behavior"
                : "complete-observed-native-first-document-paint"
              : "unavailable-native-first-document-observation-coverage"
            : failed
              ? "censored-before"
              : resourceCensored
                ? "incomplete-before-resource-window"
                : unavailable
                  ? "unavailable-before"
                  : "complete-before",
      };
    }
    return result;
  });
  const primaryResourceBudgetProvenance = {};
  for (const condition of releasePlan.conditions) {
    const relevant = limits.filter((c) =>
      c.key.startsWith(condition.name + "/"),
    );
    const cdp = before.samples
      .filter((s) => s.condition === condition.name)
      .map((s) => s.javascriptBytes)
      .filter((v) => Number.isFinite(v) && v >= 0);
    if (!cdp.length)
      throw Error(
        "No known CDP JavaScript observations exist for a required compatibility budget.",
      );
    const maxObserved = Math.max(...cdp);
    primaryResourceBudgetProvenance[condition.name] = {
      javascriptP95Bytes: {
        byteUnits: "cdp-encoded-response-bytes-includes-headers",
        scope: "completed transfers through readiness only",
        basis: "maximum observed lower bound; not a complete before percentile",
        maximumObservedBytes: maxObserved,
        beforeFullCostP95: null,
        diagnosticOnly: true,
      },
    };
    condition.budgets = {
      usableContentP95Ms: Math.max(
        ...relevant.map((c) => c.usableContentMs.ceiling),
      ),
      clockReadyP95Ms: Math.max(
        0,
        ...relevant
          .filter((c) => c.clockReadyMs)
          .map((c) => c.clockReadyMs.ceiling),
      ),
      javascriptP95Bytes: ceiling(maxObserved, policy.bytes),
      queryCountP95: conditions[condition.name].queryCount,
    };
  }
  return {
    releasePlan,
    policy,
    cohorts: limits,
    conditions,
    primaryResourceBudgetProvenance,
  };
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift();
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !args[i]?.startsWith("--") ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      options[args[i]]
    )
      throw Error("Use explicit nonduplicate option/value pairs.");
    options[args[i]] = args[i + 1];
  }
  const allowed =
    command === "derive"
      ? [
          "--before-plan",
          "--before",
          "--backend",
          "--release-build",
          "--release-source",
          "--release-tooling",
          "--out",
        ]
      : [
          "--before-plan",
          "--before",
          "--backend",
          "--plan",
          "--budgets",
          "--head",
          "--head-backend",
          "--out",
        ];
  allowed.push("--before-settled", "--before-settled-backend");
  if (command === "compare")
    allowed.push("--head-settled", "--head-settled-backend");
  for (const name of Object.keys(options))
    if (!allowed.includes(name))
      throw Error(
        `Unsupported ${command} option ${name}. Derivation accepts original before evidence only.`,
      );
  const input = async (name) => {
    if (!options[name]) throw Error(`Missing ${name}.`);
    const bytes = await readFile(options[name]);
    return { bytes, value: JSON.parse(bytes) };
  };
  const bp = await input("--before-plan"),
    b = await input("--before"),
    backend = await input("--backend");
  if (!["derive", "compare"].includes(command))
    throw Error("Use derive or compare.");
  requireEvidence(bp.value, b.value, backend.value, sha(bp.bytes), "baseline");
  const settledInputs =
    options["--before-settled"] || options["--before-settled-backend"]
      ? {
          artifact: await input("--before-settled"),
          backend: await input("--before-settled-backend"),
        }
      : null;
  if (settledInputs)
    requireSettledEvidence(
      bp.value,
      settledInputs.artifact.value,
      settledInputs.backend.value,
      sha(bp.bytes),
    );
  const settledLimits = settledInputs
    ? deriveSettled(
        settledInputs.artifact.value,
        settledInputs.artifact.bytes,
        settledInputs.backend.bytes,
      )
    : null;
  if (
    settledInputs &&
    settledInputs.artifact.value.nativeSha256 !==
      sha(settledInputs.backend.bytes)
  )
    throw Error(
      "Original companion native snapshot hash differs from finalization.",
    );
  if (command === "compare") {
    const rp = await input("--plan"),
      limits = await input("--budgets"),
      h = await input("--head"),
      hn = await input("--head-backend");
    const budget = limits.value;
    if (
      budget.schema !== 1 ||
      budget.kind !== "controlled-release-budgets" ||
      budget.beforePlanSha256 !== sha(bp.bytes) ||
      budget.beforeArtifactSha256 !== sha(b.bytes) ||
      budget.beforeBackendSha256 !== sha(backend.bytes) ||
      budget.operatorSha256 !== sha(await readFile(new URL(import.meta.url))) ||
      json(budget.sourceFingerprints) !== json(budgetProtocol) ||
      budget.releasePlanSha256 !== sha(rp.bytes)
    )
      throw Error(
        "Comparison hashes differ from the registered budget inputs.",
      );
    const regenerated = derive(
      bp.value,
      b.value,
      {
        build: rp.value.runtime.build,
        sourceBuild: rp.value.runtime.sourceBuild,
        toolingBuild: rp.value.runtime.toolingBuild,
      },
      backend.value,
    );
    if (
      json(regenerated.releasePlan) !== json(rp.value) ||
      json(regenerated.policy) !== json(budget.policy) ||
      json(regenerated.cohorts) !== json(budget.cohorts) ||
      json(regenerated.conditions) !== json(budget.conditions) ||
      json(regenerated.primaryResourceBudgetProvenance) !==
        json(budget.primaryResourceBudgetProvenance) ||
      json(settledLimits) !== json(budget.settled ?? null)
    )
      throw Error(
        "Registered policy, workload or numerical budgets were changed.",
      );
    requireEvidence(rp.value, h.value, hn.value, sha(rp.bytes), "release");
    if (
      json(b.value.hardware) !== json(h.value.hardware) ||
      json(b.value.browser) !== json(h.value.browser) ||
      b.value.runtime.node !== h.value.runtime.node
    )
      throw Error("Machine, browser or Node comparison conditions changed.");
    let settledComparison = null;
    if (budget.settled) {
      const hs = await input("--head-settled"),
        hsn = await input("--head-settled-backend");
      requireSettledEvidence(rp.value, hs.value, hsn.value, sha(rp.bytes));
      if (hs.value.nativeSha256 !== sha(hsn.bytes))
        throw Error(
          "Head companion native snapshot hash differs from finalization.",
        );
      if (
        json(hs.value.protocol) !==
          json(settledInputs.artifact.value.protocol) ||
        json(hs.value.hardware) !==
          json(settledInputs.artifact.value.hardware) ||
        json(hs.value.browser) !== json(settledInputs.artifact.value.browser) ||
        hs.value.runtime.node !== settledInputs.artifact.value.runtime.node
      )
        throw Error(
          "Settled companion protocol or runtime comparison conditions changed.",
        );
      settledComparison = compareSettled(
        settledInputs.artifact.value,
        hs.value,
        budget.settled,
      );
      settledComparison.hashes = {
        beforeArtifact: sha(settledInputs.artifact.bytes),
        beforeBackend: sha(settledInputs.backend.bytes),
        headArtifact: sha(hs.bytes),
        headBackend: sha(hsn.bytes),
      };
    } else if (options["--head-settled"] || options["--head-settled-backend"])
      throw Error("Head companion cannot be added after budget registration.");
    const report = compare(
      rp.value,
      b.value,
      h.value,
      budget,
      hn.value,
      settledComparison,
    );
    report.hashes = {
      beforePlan: sha(bp.bytes),
      beforeArtifact: sha(b.bytes),
      beforeBackend: sha(backend.bytes),
      releasePlan: sha(rp.bytes),
      budgets: sha(limits.bytes),
      headArtifact: sha(h.bytes),
      headBackend: sha(hn.bytes),
    };
    if (!options["--out"]) throw Error("Missing --out.");
    await writeFile(options["--out"], json(report), { flag: "wx" });
    console.log(
      `Numerical acceptance: ${report.numericalAcceptance}; whole-release acceptance: unfulfilled.`,
    );
    process.exitCode = report.gates.length ? 1 : 0;
    return;
  }
  for (const option of [
    "--release-build",
    "--release-source",
    "--release-tooling",
  ])
    if (!/^[a-f0-9]{7,40}$/.test(options[option] ?? ""))
      throw Error("Record exact release build/source/tooling identities.");
  if (
    options["--release-build"] === bp.value.runtime.build ||
    options["--release-source"] === bp.value.runtime.sourceBuild
  )
    throw Error(
      "Release identities must differ from original before identities.",
    );
  const result = derive(
    bp.value,
    b.value,
    {
      build: options["--release-build"],
      sourceBuild: options["--release-source"],
      toolingBuild: options["--release-tooling"],
    },
    backend.value,
  );
  const releasePlanBytes = json(result.releasePlan);
  const budget = {
    schema: 1,
    kind: "controlled-release-budgets",
    operatorSha256: sha(await readFile(new URL(import.meta.url))),
    sourceFingerprints: budgetProtocol,
    policy: result.policy,
    beforePlanSha256: sha(bp.bytes),
    beforeArtifactSha256: sha(b.bytes),
    beforeBackendSha256: sha(backend.bytes),
    releasePlanSha256: sha(releasePlanBytes),
    cohorts: result.cohorts,
    conditions: result.conditions,
    primaryResourceBudgetProvenance: result.primaryResourceBudgetProvenance,
    settled: settledLimits,
  };
  if (!options["--out"]) throw Error("Missing --out.");
  await mkdir(options["--out"], { recursive: true });
  await writeFile(
    join(options["--out"], "release-plan.json"),
    releasePlanBytes,
    { flag: "wx" },
  );
  await writeFile(
    join(options["--out"], "release-budgets.json"),
    json(budget),
    { flag: "wx" },
  );
  console.log(
    "Release budgets derived; release acceptance remains unfulfilled.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});

function requireEvidence(plan, artifact, native, planHash, phase) {
  if (json(artifact.protocol) !== json(primaryProtocol))
    throw Error(
      "Primary source fingerprints differ, including native browser observer helper.",
    );
  if (artifact.nativeRunCoverage?.complete !== true)
    throw Error(
      "Whole-run wire/native/collector reconciliation is incomplete.",
    );
  if (artifact.interrupted === true || artifact.interruption != null)
    throw Error(
      "Interrupted benchmark evidence cannot register a completed before or release comparison.",
    );
  if (
    plan.phase !== phase ||
    artifact.phase !== phase ||
    artifact.kind !== "benchmark" ||
    artifact.planSha256 !== planHash
  )
    throw Error(
      "Require the exact planned controlled benchmark phase and plan hash.",
    );
  if (
    plan.fixture?.kind !== "disposable" ||
    plan.fixture.journeysVerified !== true ||
    plan.runtime?.mode !== "production" ||
    plan.runtime?.collectorProtocol !== "z8-fixture-otlp-collector-v2" ||
    plan.runtime?.traceTransport !== "context-loopback-proxy-v1" ||
    plan.runtime?.browserPolicy !== fixtureBrowserPolicy ||
    !Number.isFinite(plan.timeoutMs) ||
    plan.timeoutMs <= 0
  )
    throw Error(
      "Require the verified production fixture and explicit timeout.",
    );
  if (
    !artifact.evidenceComplete ||
    artifact.evidenceGates?.length !== 0 ||
    !Array.isArray(artifact.missingMetrics) ||
    artifact.missingMetrics.length
  )
    throw Error(
      "Require finalized complete evidence, including all backend metrics.",
    );
  if (phase === "baseline" && artifact.acceptance !== "baseline-recorded")
    throw Error("Before artifact must be finalized baseline-recorded.");
  if (
    !artifact.runtime?.buildVerified ||
    artifact.runtime.collectorProtocol !== plan.runtime.collectorProtocol ||
    artifact.runtime.traceTransport !== plan.runtime.traceTransport ||
    artifact.runtime.browserPolicy !== plan.runtime.browserPolicy ||
    artifact.runtime.build !== plan.runtime.build ||
    artifact.runtime.sourceBuild !== plan.runtime.sourceBuild ||
    artifact.runtime.toolingBuild !== plan.runtime.toolingBuild
  )
    throw Error("Artifact build identity differs from its exact plan.");
  if (!Array.isArray(native) || !Array.isArray(artifact.samples))
    throw Error("Require raw samples and native backend evidence.");
  const expected = cohorts(plan),
    seen = new Set(),
    traceIds = new Set();
  for (const c of expected) {
    const samples = artifact.samples.filter((s) => key(s) === key(c));
    if (
      !Number.isInteger(c.count) ||
      c.count < (["first-document", "repeat-link"].includes(c.mode) ? 20 : 1) ||
      samples.length !== c.count ||
      new Set(samples.map((s) => s.iteration)).size !== c.count ||
      samples.some(
        (s) =>
          !Number.isInteger(s.iteration) ||
          s.iteration < 0 ||
          s.iteration >= c.count,
      )
    )
      throw Error("A planned cohort has missing, extra or duplicate samples.");
    if (
      c.clock &&
      samples.some(
        (s) =>
          !s.failed && (!Number.isFinite(s.clockReadyMs) || s.clockReadyMs < 0),
      )
    )
      throw Error("Successful sample lacks required clock readiness.");
    seen.add(key(c));
  }
  for (const s of artifact.samples) {
    if (
      !fixtureTransportIsComplete(s.traceTransport) ||
      JSON.stringify(s.browserInitialization) !==
        JSON.stringify(s.traceTransport?.browserInitialization)
    )
      throw Error(
        "Complete empty-context browser initialization and post-initialization transport proof are required.",
      );
    if (!seen.has(key(s))) throw Error("Unexpected cohort in artifact.");
    const id = s.backendTraceId ?? s.traceId;
    if (!id || traceIds.has(id))
      throw Error("Missing or reused backend correlation identifier.");
    traceIds.add(id);
    const entries = native.filter((e) => e.traceId === id),
      e = entries[0];
    if (
      entries.length !== 1 ||
      !["observer", "pg", "rows", "cache", "eventLoop"].every(
        (name) => e.coverage?.[name] === true,
      ) ||
      e.coverage.rejectedBatches !== 0 ||
      e.coverage.registration !== true ||
      e.coverage.closed !== true ||
      e.coverage.unattributedNativeSpans !== 0 ||
      e.coverage.incomplete !== false ||
      e.coverage.nativeProof !== true ||
      e.coverage.lateSpans !== 0
    )
      throw Error("Native backend correlation coverage is incomplete.");
    for (const metric of backendMetrics)
      if (
        !Number.isFinite(s.backend?.[metric]) ||
        s.backend[metric] < 0 ||
        s.backend[metric] !== e[metric]
      )
        throw Error(
          "Missing, invalid or mismatched correlated backend metric.",
        );
    if (typeof s.failed !== "boolean" || typeof s.censored !== "boolean")
      throw Error("Failure and censoring status must be explicit.");
    if (
      !s.failed &&
      (!Number.isFinite(s.usableContentMs) || s.usableContentMs < 0)
    )
      throw Error("Successful sample lacks usable-content readiness.");
    if (
      s.failed &&
      (!Number.isFinite(s.elapsedUntilFailureMs) || s.elapsedUntilFailureMs < 0)
    )
      throw Error("Failed sample lacks censored elapsed time.");
  }
}

function statistics(values) {
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 0))
    return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(values.length * 0.5) - 1],
    p95: p95(values),
    min: sorted[0],
    max: sorted.at(-1),
  };
}
function describe(samples) {
  const failed = samples.filter((s) => s.failed || s.censored).length;
  const sum = (metric) =>
    samples.every((s) => Number.isFinite(s[metric]))
      ? samples.reduce((n, s) => n + s[metric], 0)
      : null;
  const result = {
    samples: samples.length,
    failed,
    censored: samples.filter((s) => s.censored).length,
    pendingScriptRequests: sum("pendingScriptRequests"),
    pendingRscRequests: sum("pendingRscRequests"),
    pendingRequests: sum("resourcePendingRequests"),
    incompleteResourceWindows: samples.filter(
      (s) => s.resourceWindowComplete !== true,
    ).length,
    failures: samples
      .filter((s) => s.failed)
      .map((s) => ({
        iteration: s.iteration,
        censored: s.censored,
        stage: s.failureStage ?? null,
        kind: s.failureKind ?? null,
        elapsedUntilFailureMs: s.elapsedUntilFailureMs,
      })),
    nativeFirstDocumentPaint:
      samples[0]?.mode === "first-document"
        ? {
            complete: observedPaintComplete(samples),
            samples: samples.length,
            completedReads: samples.filter(
              (s) => s.nativePerformanceObservation?.readCompleted === true,
            ).length,
            samplesWithNativeEntries: samples.filter(
              (s) =>
                Number.isSafeInteger(
                  s.nativePerformanceObservation?.lcpEntries,
                ) && s.nativePerformanceObservation.lcpEntries > 0,
            ).length,
            scope: failed
              ? "observed native paint of FAILED behavior; not usable-content readiness"
              : "observed native first-document paint",
          }
        : null,
  };
  for (const metric of [
    "usableContentMs",
    "clockReadyMs",
    "lcpMs",
    "interactionMaxMs",
    "elapsedUntilFailureMs",
    "requests",
    "failedRequests",
    "javascriptBytes",
    "rscBytes",
    "totalBytes",
    "inlineRscDecodedBytes",
    ...backendMetrics,
  ]) {
    result[metric] =
      (["usableContentMs", "clockReadyMs"].includes(metric) && failed) ||
      (metric === "lcpMs" && !observedPaintComplete(samples)) ||
      byteCensored(samples, metric)
        ? null
        : statistics(
            samples.map((s) =>
              backendMetrics.includes(metric) ? s.backend[metric] : s[metric],
            ),
          );
  }
  return result;
}
function compare(plan, before, head, budget, native, settledComparison) {
  const retainedPrimaryGates = [
    ...(head.gates ?? []),
    ...(head.releaseGates ?? []),
  ];
  const gates = retainedPrimaryGates.filter(
      (g) =>
        !settledComparison ||
        !/Script transfer was incomplete|Exceeded javascriptP95Bytes/.test(g),
    ),
    rows = [];
  for (const c of cohorts(plan)) {
    const old = before.samples.filter((s) => key(s) === key(c)),
      current = head.samples.filter((s) => key(s) === key(c));
    const limit = budget.cohorts.find((l) => l.key === key(c));
    const summary = describe(current);
    if (summary.failed) gates.push(`${key(c)}: failed/censored journeys.`);
    if (
      !settledComparison &&
      current.some((s) => s.pendingScriptRequests !== 0)
    )
      gates.push(`${key(c)}: missing or pending script coverage.`);
    if (!settledComparison && current.some((s) => s.pendingRscRequests !== 0))
      gates.push(`${key(c)}: missing or pending external RSC coverage.`);
    if (current.some((s) => s.failedRequests !== 0))
      gates.push(`${key(c)}: missing or failed browser requests.`);
    if (
      c.mode === "mutation-refresh" &&
      current.some((s) => s.restored !== true)
    )
      gates.push(`${key(c)}: incomplete mutation restoration.`);
    const metrics = {};
    for (const [metric, rule] of Object.entries(limit).filter(
      ([, v]) => v && typeof v === "object" && "ceiling" in v,
    )) {
      const value = summary[metric]?.p95 ?? null;
      if (settledComparison && metric.endsWith("Bytes")) {
        metrics[metric] = {
          ...rule,
          headP95: value,
          passed: null,
          diagnosticOnly: true,
          comparisonUnavailableReason:
            rule.beforeP95 === null
              ? rule.basis
              : "different page-CDP observation window; full body cost is evaluated separately",
          status: byteCensored(current, metric)
            ? "censored-primary-resource-window"
            : "primary-readiness-window-only",
          resourceContract: ["first-document", "repeat-link"].includes(c.mode)
            ? "separate matched settled companion"
            : "functional-mode timing/structural check",
        };
        continue;
      }
      const available = Number.isFinite(value) && Number.isFinite(rule.ceiling);
      const passed = available && value <= rule.ceiling;
      metrics[metric] = { ...rule, headP95: value, passed };
      if (!passed)
        gates.push(
          `${key(c)}: ${metric} ${available ? "exceeds ceiling" : "has unavailable complete evidence/budget"}.`,
        );
    }
    rows.push({
      key: key(c),
      before: describe(old),
      head: summary,
      budgets: metrics,
    });
  }
  const resources = {};
  for (const condition of plan.conditions) {
    const current = head.samples.filter((s) => s.condition === condition.name),
      old = before.samples.filter((s) => s.condition === condition.name);
    resources[condition.name] = {};
    for (const [metric, limit] of Object.entries(
      budget.conditions[condition.name],
    )) {
      const measured = statistics(current.map((s) => s.backend[metric]));
      const passed = !!measured && measured.p95 <= limit;
      resources[condition.name][metric] = {
        before: statistics(old.map((s) => s.backend[metric])),
        head: measured,
        ceiling: limit,
        passed,
      };
      if (!passed)
        gates.push(
          `${condition.name}: ${metric} exceeds the conservative condition resource ceiling.`,
        );
    }
  }
  if (
    native.some(
      (e) =>
        head.samples.some(
          (s) => (s.backendTraceId ?? s.traceId) === e.traceId,
        ) &&
        (!Number.isInteger(e.observedQueryErrors) ||
          e.observedQueryErrors !== 0 ||
          !Number.isInteger(e.observedPoolAcquisitionErrors) ||
          e.observedPoolAcquisitionErrors !== 0),
    )
  )
    gates.push("Backend query/acquisition errors are missing or nonzero.");
  if (settledComparison) gates.push(...settledComparison.gates);
  return {
    schema: 1,
    kind: "controlled-release-comparison",
    numericalAcceptance: gates.length ? "unfulfilled" : "fulfilled",
    releaseAcceptance: "unfulfilled",
    nativeRunCoverage: {
      before: before.nativeRunCoverage,
      head: head.nativeRunCoverage,
    },
    resourceAcceptance:
      settledComparison?.gates.length === 0 ? "fulfilled" : "unfulfilled",
    retainedPrimaryGates,
    primaryResourceBudgetProvenance: budget.primaryResourceBudgetProvenance,
    settledResources: settledComparison,
    gates,
    cohorts: rows,
    conditionResources: resources,
    coverage: {
      samples: head.samples.length,
      correlatedNativeSamples: head.samples.length,
      nativeRequired: ["observer", "pg", "rows", "cache", "eventLoop"],
      rejectedBatches: 0,
    },
    limitations: [
      "This gate evaluates the controlled release comparison; it does not establish prospective phase budgets before source implementation.",
      "Structural reader contracts (15-query batch ceiling, no employee/week or home-office/day fan-out, request-context counts), mixed-load isolation, authorization, totals, cache invalidation, ingress and required quality checks remain separate #1475 gates.",
      "Fresh contexts do not imply cold runtime caches. Priming prepare(false) can leave reads in flight; Last Year then Custom Range includes prior annual work. Timings describe the holistic journey, not isolated month calculation or guaranteed warm data.",
      "Backend telemetry covers full correlated RSC requests; browser resources stop at readiness. Condition resource ceilings do not require each cohort to drop queries when work moves earlier.",
      "LCP is native first-document evidence only. interactionMaxMs is the largest observed Event Timing duration; full page-lifetime INP is unavailable.",
      "Inline RSC is decoded script bytes; external RSC and JavaScript are completed transfer bytes. Unknown values and pending requests remain explicit; these units are not added.",
      "The root implementer has seen functional candidate observations. These fixed rules are for the controlled release comparison and must be recorded before its first head timings.",
    ],
  };
}

function byteCensored(samples, metric) {
  if (
    ![
      "javascriptBytes",
      "rscBytes",
      "totalBytes",
      "inlineRscDecodedBytes",
    ].includes(metric)
  )
    return false;
  return samples.some(
    (s) =>
      s.censored ||
      s.failed ||
      (metric === "javascriptBytes" && s.pendingScriptRequests !== 0) ||
      (metric === "rscBytes" && s.pendingRscRequests !== 0) ||
      (metric === "totalBytes" && s.resourceWindowComplete !== true) ||
      (metric === "inlineRscDecodedBytes" &&
        s.mode === "first-document" &&
        s.resourceWindowComplete !== true),
  );
}
function settledByteValue(sample, metric) {
  return metric === "inlineRscDecodedBytes"
    ? sample.inlineRscDecodedBytes
    : settledWireEvidence(sample).bytes[metric];
}
function settledBehavior(samples, native = []) {
  return {
    failed: samples.filter((s) => s.failed).length,
    censored: samples.filter((s) => s.censored).length,
    usableContentP95: samples.some((s) => s.failed || s.censored)
      ? null
      : (statistics(samples.map((s) => s.readyMs))?.p95 ?? null),
    resourceObservationBasis: samples.some((s) => s.failed)
      ? beforeFailurePolicy.resourceClaim
      : "complete observed traffic for successful behavior",
    failures: samples
      .filter((s) => s.failed)
      .map((s) => ({
        iteration: s.iteration,
        stage: s.failureStage,
        kind: s.failureKind,
        elapsedUntilFailureMs: s.elapsedUntilFailureMs,
        measurementStarted: s.measurementStarted,
        prerequisiteComplete: s.prerequisiteComplete,
        targetRangePrepared: s.targetRangePrepared,
        cause: beforeFailurePolicy.cause,
        proofSha256: beforeFailurePolicy.proofSha256,
        observedQueryErrors: native.find((e) => e.traceId === s.traceId)
          ?.observedQueryErrors,
        observedPoolAcquisitionErrors: native.find(
          (e) => e.traceId === s.traceId,
        )?.observedPoolAcquisitionErrors,
      })),
  };
}
function deriveSettled(artifact, bytes, nativeBytes) {
  const keys = [...new Set(artifact.samples.map(key))],
    native = JSON.parse(nativeBytes);
  return {
    beforeArtifactSha256: sha(bytes),
    beforeBackendSha256: sha(nativeBytes),
    policy: artifact.policy,
    protocol: artifact.protocol,
    byteUnits: artifact.policy.wire.byteUnits,
    wireProtocol: artifact.policy.wire.protocol,
    cohorts: keys.map((cohort) => {
      const samples = artifact.samples.filter((s) => key(s) === cohort),
        metrics = [
          "javascript",
          "document",
          "rsc",
          "otherFinite",
          ...(samples[0].mode === "first-document"
            ? ["inlineRscDecodedBytes"]
            : []),
        ];
      return {
        key: cohort,
        samples: samples.length,
        beforeBehavior: settledBehavior(samples, native),
        metrics: Object.fromEntries(
          metrics.map((metric) => {
            const measured = p95(
              samples.map((s) => settledByteValue(s, metric)),
            );
            return [
              metric,
              {
                beforeP95: measured,
                ceiling: ceiling(measured, policy.bytes),
                byteUnits:
                  metric === "inlineRscDecodedBytes"
                    ? "decoded-utf8-inline-flight-script-bytes"
                    : artifact.policy.wire.byteUnits,
              },
            ];
          }),
        ),
      };
    }),
  };
}
function compareSettled(before, head, limits) {
  const gates = [];
  const cohorts = limits.cohorts.map((c) => {
    const samples = head.samples.filter((s) => key(s) === c.key),
      old = before.samples.filter((s) => key(s) === c.key),
      metrics = {};
    for (const [metric, rule] of Object.entries(c.metrics)) {
      const measured = statistics(
          samples.map((s) => settledByteValue(s, metric)),
        ),
        passed = !!measured && measured.p95 <= rule.ceiling;
      metrics[metric] = {
        ...rule,
        before: statistics(old.map((s) => settledByteValue(s, metric))),
        head: measured,
        passed,
        byteUnits:
          metric === "inlineRscDecodedBytes"
            ? "decoded-utf8-inline-flight-script-bytes"
            : limits.byteUnits,
      };
      if (!passed)
        gates.push(
          `${c.key}: settled ${metric} byte ceiling exceeded or unavailable.`,
        );
    }
    return {
      key: c.key,
      samples: samples.length,
      beforeBehavior: c.beforeBehavior,
      headBehavior: settledBehavior(samples),
      metrics,
      beforeBackground: old.map((s) => ({
        iteration: s.iteration,
        prefetch: settledWireEvidence(s).groups.prefetch,
        longLived: settledWireEvidence(s).groups.longLived,
        byTrace: settledWireEvidence(s).byTrace,
      })),
      headBackground: samples.map((s) => ({
        iteration: s.iteration,
        prefetch: settledWireEvidence(s).groups.prefetch,
        longLived: settledWireEvidence(s).groups.longLived,
        byTrace: settledWireEvidence(s).byTrace,
      })),
      cdpObservations: {
        scope:
          "page CDP readiness/settling observations; incomplete and ServiceWorker inner transfers are not full wire cost",
        before: old.map((s) => ({
          iteration: s.iteration,
          atReady: s.atReady ?? null,
          settled: s.settled ?? null,
        })),
        head: samples.map((s) => ({
          iteration: s.iteration,
          atReady: s.atReady ?? null,
          settled: s.settled ?? null,
        })),
      },
    };
  });
  return {
    scope: limits.policy.scope,
    nativeRunCoverage: {
      before: before.nativeRunCoverage,
      head: head.nativeRunCoverage,
    },
    policy: limits.policy,
    byteUnits: limits.byteUnits,
    wireProtocol: limits.wireProtocol,
    gates,
    cohorts,
    limitations: [
      "A fixed one-second quiet interval and ten-second post-readiness cap bound this finite-resource observation. This is not all future page-lifetime cost.",
      "Explicit Next/purpose prefetch and WebSocket/EventSource are counted separately; unfinished mandatory traffic, failures, unknown lengths and caps cannot fulfill the settled gate.",
      "Inherited priming requests are drained and reported separately, without being charged to measured navigation bytes.",
      "Wire byte ceilings use compressed HTTP response-body bytes before content decoding and exclude headers. CDP encoded lengths and decoded inline Flight remain different units and are never substituted or added.",
    ],
  };
}
