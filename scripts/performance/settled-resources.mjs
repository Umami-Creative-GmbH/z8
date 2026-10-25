#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { companionProtocolIdentity } from "./protocol-fingerprints.mjs";
import {
  nextStreamCompletionPatch,
  isNextStreamCompletionPatch,
  matchingNextStreamCompletionPatch,
} from "./next-stream-completion-patch.mjs";
import {
  operatorReloadQuiescencePolicy,
  operatorReloadQuiescenceComplete,
} from "./operator-reload-quiescence.mjs";
import {
  awaitPrerequisiteQuiescence,
  prerequisiteQuiescencePolicy,
  prerequisiteQuiescenceComplete,
} from "./prerequisite-quiescence.mjs";
const installedCompanionProtocol = await companionProtocolIdentity();
import {
  fixtureBrowserPolicy,
  fixtureTransportIsComplete,
  initializeFixtureBrowserContext,
  launchFixtureBrowser,
} from "./fixture-browser.mjs";
import {
  clickVisible,
  fixtureBrowserPermissions,
  historicalRangeSteps,
  performSteps,
  prepareFixtureBrowserContext,
  waitVisible,
} from "./journey-steps.mjs";
import {
  createSettledObserver,
  settledPolicy,
} from "./settled-resource-observer.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => JSON.stringify(value, null, 2) + "\n";
const key = (s) => [s.condition, s.route, s.range, s.mode].join("/");
const metrics = [
  "queryCount",
  "queryDurationMs",
  "rowsRetrieved",
  "poolWaitMs",
  "cacheHits",
  "cacheMisses",
  "eventLoopDelayMs",
];
export const companionWireContract = Object.freeze({
  protocol: "context-proxy-wire-v1",
  byteUnits:
    "http-response-body-bytes-before-content-decoding-excludes-headers",
  traceTransport: "context-loopback-proxy-v1",
});
export const beforeFailurePolicy = Object.freeze({
  version: 4,
  amendedAt: "2026-10-25T09:24:58Z",
  source:
    "parent-authorized prospective amendment before controlled head capture",
  proofSource: "67362fef1dab6bb22e0aa9060ab699fbbe8f0609",
  proofPath:
    "docs/performance/evidence/1450-next-stream-fixed-before-proof.json",
  proofSha256:
    "b9931f415342ecc2c09e6576779f3b0f384ea571fdc7741d26aa9a2f8f09fbe3",
  proofHashEncoding: "sha256 of UTF-8 JSON.stringify(parsed public proof)",
  cause:
    "original annual DatabaseError from pool-acquire-timeout; pool10/10000ms; zero statement errors",
  resourceClaim:
    "complete observed traffic for FAILED baseline behavior; not successful-before-route cost",
});
const causeProof = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/performance/evidence/1450-next-stream-fixed-before-proof.json",
      import.meta.url,
    ),
  ),
);
if (hash(JSON.stringify(causeProof)) !== beforeFailurePolicy.proofSha256)
  throw Error(
    "The fixed before failure cause proof changed; review a new prospective policy before capture.",
  );
export const companionPolicy = Object.freeze({
  ...settledPolicy,
  version: 8,
  nextStreamCompletionPatch,
  operatorReloadQuiescencePolicy,
  prerequisiteQuiescencePolicy,
  scope:
    "all finite page and ServiceWorker proxy response bodies from navigation start through post-readiness quiet; inherited, explicit prefetch and long-lived traffic counted separately",
  wire: companionWireContract,
  beforeFailure: beforeFailurePolicy,
});
/** Select a resource observation without changing failed UI or its timing ledger. */
export function settledWireEvidence(sample) {
  return sample.failed ? sample.wireFailureDrain : sample.wireSettled;
}
export function eligibleOriginalAnnualFailure(plan, sample, native) {
  const route = plan.routes.find((r) => r.name === sample.route),
    condition = plan.conditions.find((c) => c.name === sample.condition),
    cause = causeProof.annualUnderlyingCause;
  return (
    plan.phase === "baseline" &&
    sample.failed === true &&
    plan.runtime.build === causeProof.originalBinarySource &&
    plan.runtime.sourceBuild === causeProof.originalBusinessSource &&
    matchingNextStreamCompletionPatch(
      causeProof.nextStreamCompletionPatch,
      plan.runtime.nextStreamCompletionPatch,
    ) &&
    sample.failureStage === "verify-expected-content" &&
    sample.failureKind === "timeout" &&
    Number.isFinite(sample.elapsedUntilFailureMs) &&
    sample.elapsedUntilFailureMs >= plan.timeoutMs &&
    !sample.secondaryFailures?.length &&
    sample.range === "year" &&
    route?.name === "analytics" &&
    route.result === "work-hours" &&
    route.rangeRecipe === "fixture-2025" &&
    condition?.role === "admin" &&
    condition.employees === 200 &&
    (route.expectedRowsByCondition?.[condition.name] ?? condition.employees) ===
      200 &&
    plan.runtime.poolMax === 10 &&
    plan.timeoutMs === 30000 &&
    cause.underlyingKind === "pool-acquire-timeout" &&
    cause.originalConnectionTimeoutMs === 10000 &&
    native?.observedQueryErrors === 0 &&
    Number.isSafeInteger(native.observedPoolAcquisitionErrors) &&
    native.observedPoolAcquisitionErrors > 0 &&
    Number.isSafeInteger(native.observedPoolAcquisitions) &&
    Number.isSafeInteger(native.observedQueryCount) &&
    native.observedQueryCount === native.queryCount &&
    native.observedPoolAcquisitions ===
      native.observedQueryCount + native.observedPoolAcquisitionErrors
  );
}
function eligibleBeforeFailure(plan, sample, native) {
  return (
    eligibleOriginalAnnualFailure(plan, sample, native) &&
    sample.censored === true &&
    sample.readyMs === null &&
    sample.measurementStarted === true &&
    sample.prerequisiteComplete === true &&
    sample.targetRangePrepared === true &&
    sample.wireFailureDrain?.scope === "post-failed-journey-diagnostic" &&
    sample.wireFailureDrain.usableContentClaim === false
  );
}
/** A failure boundary is a resource observation anchor, never a usable-content timestamp. */
export async function observeFailedJourneyWire(
  wire,
  {
    now = () => performance.now(),
    pause = () =>
      new Promise((done) => setTimeout(done, companionPolicy.pollMs)),
  } = {},
) {
  const start = now();
  wire.ready(start);
  do {
    const at = now(),
      state = wire.state(at);
    if (
      state.complete ||
      state.capped ||
      at - start >= companionPolicy.postReadyCapMs
    )
      return {
        ...state,
        ...(!state.complete && at - start >= companionPolicy.postReadyCapMs
          ? { complete: false, censored: true, capped: true }
          : {}),
        scope: "post-failed-journey-diagnostic",
        usableContentClaim: false,
      };
    await pause();
  } while (true);
}
/** Whole-run wire proof includes opening IO, every registered phase and browser shutdown. */
export async function runCompanionCapture({
  collector,
  control,
  artifact,
  openBrowser,
  capture,
  checkpoint,
}) {
  artifact.nativeRunCoverage = { complete: false };
  const before = await collector.readCollectorCounters(control);
  if (
    before.activeTraces !== 0 ||
    before.started.queries !== before.ended.queries
  )
    throw Error(
      "Native work is pending before companion capture; use a settled isolated fixture.",
    );
  let browser,
    closed = false;
  try {
    browser = await openBrowser();
    await capture(browser);
  } catch (error) {
    artifact.interrupted = true;
    artifact.interruption = { kind: "capture-error" };
    throw error;
  } finally {
    try {
      await browser?.close();
      closed = true;
    } catch {
      artifact.interrupted = true;
      artifact.interruption = { kind: "browser-close-error" };
    }
    try {
      artifact.nativeRunCoverage = await collector.reconcileCollectorRun({
        control,
        before,
        traceIds: artifact.samples.flatMap((s) => [
          s.traceId,
          s.prerequisiteTraceId,
          s.backgroundTraceId,
        ]),
      });
    } catch {
      artifact.nativeRunCoverage = { complete: false };
    }
    if (!closed) artifact.nativeRunCoverage.complete = false;
    await checkpoint();
  }
}
export function settledCohorts(plan) {
  if (!Number.isInteger(plan.samples) || plan.samples < 20)
    throw Error("At least twenty samples are required.");
  if (
    !["baseline", "release"].includes(plan.phase) ||
    plan.fixture?.kind !== "disposable" ||
    plan.fixture.journeysVerified !== true ||
    plan.runtime?.mode !== "production" ||
    plan.runtime?.collectorProtocol !== "z8-fixture-otlp-collector-v2" ||
    plan.runtime?.traceTransport !== companionWireContract.traceTransport ||
    plan.runtime?.browserPolicy !== fixtureBrowserPolicy ||
    plan.runtime?.prerequisiteQuiescencePolicy !==
      prerequisiteQuiescencePolicy ||
    plan.runtime?.operatorReloadQuiescencePolicy !==
      operatorReloadQuiescencePolicy ||
    !isNextStreamCompletionPatch(plan.runtime?.nextStreamCompletionPatch) ||
    plan.runtime.browserPermissions !== fixtureBrowserPermissions ||
    !Number.isInteger(plan.concurrency) ||
    plan.concurrency < 1
  )
    throw Error("Use the verified exact production fixture plan.");
  const result = [];
  for (const condition of plan.conditions)
    for (const range of plan.ranges)
      for (const route of plan.routes) {
        if (
          (route.roles && !route.roles.includes(condition.role)) ||
          (route.conditions && !route.conditions.includes(condition.name)) ||
          (route.ranges && !route.ranges.includes(range.name))
        )
          continue;
        for (const mode of ["first-document", "repeat-link"]) {
          const count = plan.samplesByMode?.[mode] ?? plan.samples;
          if (!Number.isInteger(count) || count < 20)
            throw Error(
              "At least twenty first-document and repeat-link samples are required.",
            );
          if (
            (route.modes && !route.modes.includes(mode)) ||
            !route.path ||
            !route.ready ||
            !route.link
          )
            throw Error(
              "Each settled route requires the identical first-document and Link recipes.",
            );
          result.push({
            condition: condition.name,
            route: route.name,
            range: range.name,
            mode,
            count,
          });
        }
      }
  if (!result.length || new Set(result.map(key)).size !== result.length)
    throw Error("Settled cohort matrix must be nonempty and unique.");
  return result;
}
export function settledEvidenceGates(plan, artifact, native, planSha) {
  const gates = [];
  if (
    JSON.stringify(artifact.protocol) !==
    JSON.stringify(installedCompanionProtocol)
  )
    gates.push(
      "Companion transitive source fingerprints differ, including browser-performance.mjs.",
    );
  if (artifact.nativeRunCoverage?.complete !== true)
    gates.push("Whole-run wire/native/collector reconciliation is incomplete.");
  if (artifact.interrupted === true || artifact.interruption != null)
    gates.push("Interrupted companion evidence cannot fulfill resource gates.");
  if (
    artifact.kind !== "settled-resource-companion" ||
    artifact.phase !== plan.phase ||
    artifact.planSha256 !== planSha ||
    JSON.stringify(artifact.policy) !== JSON.stringify(companionPolicy) ||
    !artifact.runtime?.buildVerified ||
    artifact.runtime.collectorProtocol !== plan.runtime.collectorProtocol ||
    artifact.runtime.traceTransport !== plan.runtime.traceTransport ||
    artifact.runtime.browserPolicy !== plan.runtime.browserPolicy ||
    artifact.runtime.prerequisiteQuiescencePolicy !==
      plan.runtime.prerequisiteQuiescencePolicy ||
    artifact.runtime.operatorReloadQuiescencePolicy !==
      plan.runtime.operatorReloadQuiescencePolicy ||
    !matchingNextStreamCompletionPatch(
      plan.runtime.nextStreamCompletionPatch,
      artifact.runtime.nextStreamCompletionPatch,
    ) ||
    artifact.runtime.build !== plan.runtime.build ||
    artifact.runtime.sourceBuild !== plan.runtime.sourceBuild ||
    artifact.runtime.toolingBuild !== plan.runtime.toolingBuild
  )
    gates.push("Companion plan, policy or actual build identity differs.");
  const cohorts = settledCohorts(plan),
    expected = new Set(cohorts.map(key)),
    ids = new Set();
  for (const c of cohorts) {
    const samples = artifact.samples.filter((s) => key(s) === key(c));
    if (
      samples.length !== c.count ||
      new Set(samples.map((s) => s.iteration)).size !== c.count ||
      samples.some(
        (s) =>
          !Number.isInteger(s.iteration) ||
          s.iteration < 0 ||
          s.iteration >= c.count,
      )
    )
      gates.push("Companion cohort sample coverage is incomplete.");
  }
  for (const s of artifact.samples) {
    if (!operatorReloadQuiescenceComplete(plan, s))
      gates.push("Operator reload proof applicability differs.");
    if (!prerequisiteQuiescenceComplete(s, plan.timeoutMs ?? 30000))
      gates.push("Unmeasured prerequisite transfer proof is incomplete.");
    if (!expected.has(key(s)) || ids.has(s.traceId) || !s.traceId)
      gates.push("Unexpected companion cohort or reused trace.");
    ids.add(s.traceId);
    if (
      s.traceTransport?.kind !== companionWireContract.traceTransport ||
      !fixtureTransportIsComplete(s.traceTransport) ||
      JSON.stringify(s.browserInitialization) !==
        JSON.stringify(s.traceTransport?.browserInitialization)
    )
      gates.push(
        "The matching shared context trace transport is missing or refused traffic.",
      );
    if (
      settledWireEvidence(s)?.protocol !== companionWireContract.protocol ||
      settledWireEvidence(s)?.byteUnits !== companionWireContract.byteUnits ||
      settledWireEvidence(s)?.complete !== true
    )
      gates.push("Complete all-context proxy wire-body evidence is missing.");
    const evidence = native.filter((e) => e.traceId === s.traceId),
      e = evidence[0];
    if (
      evidence.length !== 1 ||
      !["observer", "pg", "rows", "cache", "eventLoop"].every(
        (k) => e.coverage?.[k] === true,
      ) ||
      e.coverage.rejectedBatches !== 0 ||
      e.coverage.registration !== true ||
      e.coverage.closed !== true ||
      e.coverage.unattributedNativeSpans !== 0 ||
      e.coverage.incomplete !== false ||
      e.coverage.nativeProof !== true ||
      e.coverage.lateSpans !== 0
    )
      gates.push("Native companion coverage is incomplete.");
    if (
      metrics.some(
        (k) => !Number.isFinite(e?.[k]) || e[k] < 0 || s.backend?.[k] !== e[k],
      )
    )
      gates.push("Correlated companion metrics are incomplete or differ.");
  }
  return [...new Set(gates)];
}
export function requireSettledEvidence(plan, artifact, native, planSha) {
  const gates = settledEvidenceGates(plan, artifact, native, planSha);
  if (
    !artifact.finalized ||
    artifact.evidenceComplete !== true ||
    artifact.resourceComplete !== true ||
    gates.length
  )
    throw Error(
      "Require finalized, matched, complete settled-resource and native evidence.",
    );
  for (const s of artifact.samples) {
    const wire = settledWireEvidence(s),
      e = native.find((e) => e.traceId === s.traceId),
      knownBeforeFailure = eligibleBeforeFailure(plan, s, e);
    if (
      (!knownBeforeFailure &&
        (s.failed !== false ||
          s.censored !== false ||
          !Number.isFinite(s.readyMs) ||
          s.readyMs < 0)) ||
      wire?.complete !== true ||
      wire.capped !== false ||
      wire.mandatoryErrors !== 0 ||
      wire.mandatoryPending !== 0 ||
      wire.censored !== false ||
      wire.observationOverflows !== 0 ||
      wire.unknownInheritedRedirects !== 0 ||
      !Number.isFinite(wire.quietObservedMs) ||
      wire.quietObservedMs < companionPolicy.quietMs ||
      !Number.isFinite(wire.postReadyMs) ||
      wire.postReadyMs < companionPolicy.quietMs ||
      wire.postReadyMs > companionPolicy.postReadyCapMs ||
      !Array.isArray(wire.byTrace)
    )
      throw Error("Settled resource cohort is failed or censored.");
    if (
      ["javascript", "document", "rsc", "otherFinite"].some(
        (k) => !Number.isFinite(wire.bytes?.[k]) || wire.bytes[k] < 0,
      ) ||
      (s.mode === "first-document" &&
        (!Number.isFinite(s.inlineRscDecodedBytes) ||
          s.inlineRscDecodedBytes < 0))
    )
      throw Error("Settled byte evidence is missing.");
    const groupNames = [
      "javascript",
      "document",
      "rsc",
      "otherFinite",
      "prefetch",
      "longLived",
    ];
    const countNames = [
      "requests",
      "completed",
      "pending",
      "errors",
      "completedBytes",
      "observedBodyBytes",
      "inheritedRequests",
      "inheritedCompletedBytes",
    ];
    for (const name of groupNames) {
      const group = wire.groups?.[name];
      if (
        !group ||
        countNames.some((k) => !Number.isSafeInteger(group[k]) || group[k] < 0)
      )
        throw Error("Proxy wire group coverage is missing.");
      if (
        ["javascript", "document", "rsc", "otherFinite"].includes(name) &&
        (group.pending !== 0 ||
          group.errors !== 0 ||
          group.completedBytes !== wire.bytes[name])
      )
        throw Error(
          "Mandatory proxy wire group is incomplete or differs from its byte total.",
        );
      for (const count of countNames)
        if (
          wire.byTrace.reduce(
            (n, t) => n + (t.groups?.[name]?.[count] ?? NaN),
            0,
          ) !== group[count]
        )
          throw Error("Proxy per-trace wire groups do not reconcile.");
    }
    if (
      wire.byTrace.some(
        (t) =>
          ![s.traceId, s.prerequisiteTraceId, s.backgroundTraceId].includes(
            t.traceId,
          ),
      )
    )
      throw Error(
        "Proxy wire evidence contains an unregistered context identity.",
      );
    if (
      e.observedQueryErrors !== 0 ||
      (!knownBeforeFailure && e.observedPoolAcquisitionErrors !== 0)
    )
      throw Error("Settled backend observed errors.");
  }
}
async function protocolIdentity() {
  return companionProtocolIdentity();
}
export async function measureFixtureResources(
  browser,
  auth,
  plan,
  condition,
  range,
  route,
  mode,
  iteration,
  collectorControl,
  collector,
) {
  const traceId = randomBytes(16).toString("hex"),
    prerequisiteTraceId = randomBytes(16).toString("hex"),
    backgroundTraceId = randomBytes(16).toString("hex");
  const observer = createSettledObserver();
  let context,
    transport,
    collectorVisit,
    page,
    client,
    stage = "authentication-context",
    active = false,
    started;
  const s = {
    condition: condition.name,
    role: condition.role,
    organization: condition.organization,
    organizationSize: condition.employees,
    timezone: condition.timezone,
    locale: condition.locale,
    viewport: condition.viewport,
    concurrency: plan.concurrency,
    range: range.name,
    route: route.name,
    mode,
    iteration,
    traceId,
    prerequisiteTraceId,
    backgroundTraceId,
    failed: false,
    censored: true,
    readyMs: null,
    clockReadyMs: null,
    inlineRscDecodedBytes: null,
    settled: null,
    wireSettled: null,
    measurementStarted: false,
    prerequisiteComplete: false,
    targetRangePrepared: false,
    prerequisiteQuiescence: [],
    operatorReloadQuiescence: [],
    backend: null,
    failureStage: null,
    failureKind: null,
  };
  const cleanupFailure = (failureStage, failureKind) => {
    s.failed = true;
    s.censored = true;
    if (s.failureStage)
      (s.secondaryFailures ??= []).push({ failureStage, failureKind });
    else {
      s.failureStage = failureStage;
      s.failureKind = failureKind;
      s.elapsedUntilFailureMs =
        started === undefined ? null : performance.now() - started;
    }
  };
  try {
    stage = "collector-registration";
    collectorVisit = await collector.beginCollectorVisit({
      control: collectorControl,
      traceIds: [traceId, prerequisiteTraceId, backgroundTraceId],
    });
    s.collectorVisit = {
      protocol: collectorVisit.protocol,
      registered: true,
      closed: false,
    };
    const transportApi = await import("./trace-transport.mjs");
    if (transportApi.fixtureTraceTransport !== plan.runtime.traceTransport)
      throw Error(
        "Context trace transport protocol differs from the frozen plan.",
      );
    transport = await transportApi.createFixtureTraceTransport({
      origin: plan.origin,
      getTraceId: ({ headers = {} } = {}) => {
        const explicitBackground =
          headers["next-router-prefetch"] === "1" ||
          /prefetch/i.test(String(headers.purpose ?? "")) ||
          /prefetch/i.test(String(headers["sec-purpose"] ?? "")) ||
          /text\/event-stream/i.test(String(headers.accept ?? "")) ||
          String(headers.upgrade ?? "").toLowerCase() === "websocket";
        return active
          ? explicitBackground
            ? backgroundTraceId
            : traceId
          : prerequisiteTraceId;
      },
    });
    if (
      !transport.wire?.begin ||
      !transport.wire?.ready ||
      !transport.wire?.state
    )
      throw Error("All-context proxy wire-body observation is unavailable.");
    context = await browser.createBrowserContext(
      transport.browserContextOptions,
    );
    stage = "empty-browser-initialization";
    ({ page, browserInitialization: s.browserInitialization } =
      await initializeFixtureBrowserContext({ context, transport }));
    stage = "authentication-context";
    await prepareFixtureBrowserContext(context, plan.origin);
    if (!Array.isArray(auth[condition.name]?.cookies))
      throw Error("Missing fixture authentication.");
    await context.setCookie(...auth[condition.name].cookies);
    await page.setViewport(condition.viewport);
    await page.emulateTimezone(condition.timezone);
    await page.setExtraHTTPHeaders({ "Accept-Language": condition.locale });
    client = await page.createCDPSession();
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", (e) =>
      observer.request(e, performance.now()),
    );
    client.on("Network.responseReceived", (e) =>
      observer.response(e, performance.now()),
    );
    client.on("Network.loadingFinished", (e) =>
      observer.finished(e, performance.now()),
    );
    client.on("Network.loadingFailed", (e) =>
      observer.failed(e, performance.now()),
    );
    client.on("Network.webSocketCreated", (e) =>
      observer.request(
        { requestId: e.requestId, type: "WebSocket", request: { headers: {} } },
        performance.now(),
      ),
    );
    client.on("Network.webSocketClosed", (e) =>
      observer.finished({ requestId: e.requestId }, performance.now()),
    );
    client.on("Network.webSocketFrameError", (e) =>
      observer.failed(e, performance.now()),
    );
    const employee =
      route.target === "directory-target"
        ? auth[condition.name].targetEmployeeId
        : auth[condition.name].employeeId;
    const path = route.path
        .replaceAll("{locale}", condition.locale)
        .replaceAll("{employee}", employee)
        .replaceAll("{start}", range.start)
        .replaceAll("{end}", range.end),
      url = new URL(path, plan.origin).href;
    const bindings = {
      origin: plan.origin,
      path,
      locale: condition.locale,
      employee,
      employeeSearch: auth[condition.name].targetEmployeeSearch,
      start: range.start,
      end: range.end,
    };
    const verify = async () => {
      stage = "verify-expected-content";
      const hours = { month: 168, quarter: 512, year: 2088 }[range.name];
      if (route.result === "employee-report")
        await performSteps(
          page,
          [
            { card: { title: "Total Work Hours", contains: `${hours}h` } },
            {
              card: {
                title: "Home Office Days",
                contains: `${{ month: 32, quarter: 96, year: 416 }[range.name]}h worked from home`,
              },
            },
          ],
          bindings,
          plan.timeoutMs,
        );
      else if (route.result === "work-hours")
        await performSteps(
          page,
          [
            {
              table: {
                title: "Employee Work Hours",
                rows:
                  route.expectedRowsByCondition?.[condition.name] ??
                  condition.employees,
                column: 1,
                value: `${hours.toFixed(1)}h`,
              },
            },
          ],
          bindings,
          plan.timeoutMs,
        );
      await performSteps(page, route.verify, bindings, plan.timeoutMs);
    };
    const prepare = async (verifyExpected = true) => {
      stage = "prepare-range";
      await performSteps(page, route.prepare, bindings, plan.timeoutMs);
      if (route.rangeRecipe === "fixture-2025")
        await performSteps(
          page,
          historicalRangeSteps(range.name),
          bindings,
          plan.timeoutMs,
        );
      if (route.result === "employee-report")
        await performSteps(
          page,
          [
            {
              clickText: { selector: "button", text: "Generate Report" },
              response: { path: "{path}", method: "POST" },
            },
          ],
          bindings,
          plan.timeoutMs,
        );
      if (active) s.targetRangePrepared = true;
      if (verifyExpected) await verify();
    };
    const ready = () =>
      page.waitForSelector(route.ready, {
        visible: true,
        timeout: plan.timeoutMs,
      });
    if (mode === "repeat-link") {
      stage = "prime-route";
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await prepare(false);
      await ready();
      stage = "prerequisite-quiescence-primed-target";
      await awaitPrerequisiteQuiescence({
        transport,
        sample: s,
        phase: "primed-target",
        timeoutMs: plan.timeoutMs ?? 30000,
      });
      stage = "prepare-away-navigation";
      await page.goto(
        new URL(
          (route.awayPath ?? plan.awayPath).replaceAll(
            "{locale}",
            condition.locale,
          ),
          plan.origin,
        ).href,
        { waitUntil: "domcontentloaded" },
      );
      await performSteps(page, route.navigationSteps, bindings, plan.timeoutMs);
      await waitVisible(
        page,
        route.link
          .replaceAll("{locale}", condition.locale)
          .replaceAll("{employee}", employee),
        plan.timeoutMs,
      );
      stage = "prerequisite-quiescence-away-navigation";
      await awaitPrerequisiteQuiescence({
        transport,
        sample: s,
        phase: "away-navigation",
        timeoutMs: plan.timeoutMs ?? 30000,
      });
    }
    s.prerequisiteComplete = true;
    active = true;
    s.measurementStarted = true;
    started = performance.now();
    observer.begin(started);
    transport.wire.begin(started);
    stage = "navigate";
    const clock = route.clockReady
      ? page
          .waitForSelector(route.clockReady, {
            visible: true,
            timeout: plan.timeoutMs,
          })
          .then(() => (s.clockReadyMs = performance.now() - started))
          .catch(() => null)
      : Promise.resolve(null);
    if (mode === "first-document")
      await page.goto(url, { waitUntil: "domcontentloaded" });
    else {
      await clickVisible(
        page,
        route.link
          .replaceAll("{locale}", condition.locale)
          .replaceAll("{employee}", employee),
        plan.timeoutMs,
      );
      await page.waitForFunction(
        (expected) => location.pathname + location.search === expected,
        { timeout: plan.timeoutMs },
        path,
      );
      await performSteps(page, route.navigationAfter, bindings, plan.timeoutMs);
    }
    await prepare();
    await verify();
    await ready();
    s.readyMs = performance.now() - started;
    await clock;
    if (route.clockReady && s.clockReadyMs === null)
      throw Error("Clock readiness missing.");
    s.notificationPermission = await page.evaluate(
      () => Notification.permission,
    );
    if (s.notificationPermission !== "denied")
      throw Error("Fixture permission changed.");
    observer.ready(performance.now());
    transport.wire.ready(performance.now());
    s.atReady = observer.state(performance.now());
    s.wireAtReady = transport.wire.state(performance.now());
    stage = "settle-resources";
    do {
      s.wireSettled = transport.wire.state(performance.now());
      if (s.wireSettled.complete || s.wireSettled.capped) break;
      await new Promise((resolve) => setTimeout(resolve, settledPolicy.pollMs));
    } while (true);
    if (mode === "first-document")
      s.inlineRscDecodedBytes = await page.evaluate(() =>
        [...document.scripts]
          .filter((script) => script.textContent.includes("__next_f"))
          .reduce(
            (n, script) =>
              n + new TextEncoder().encode(script.textContent).length,
            0,
          ),
      );
    s.settled = observer.state(performance.now());
    s.censored = !s.wireSettled.complete;
  } catch (error) {
    s.failed = true;
    s.censored = true;
    s.failureStage = stage;
    s.failureKind =
      error?.name === "TimeoutError" ? "timeout" : "journey-error";
    s.elapsedUntilFailureMs =
      started === undefined ? null : performance.now() - started;
    s.settled = observer.state(performance.now());
    s.wireSettled = transport?.wire?.state(performance.now()) ?? null;
    if (started !== undefined && transport?.wire) {
      try {
        s.wireFailureDrain = await observeFailedJourneyWire(transport.wire);
      } catch {
        s.wireFailureDrain = {
          scope: "post-failed-journey-diagnostic",
          usableContentClaim: false,
          complete: false,
          censored: true,
        };
        (s.secondaryFailures ??= []).push({
          failureStage: "failure-resource-observation",
          failureKind: "observation-error",
        });
      }
      if (mode === "first-document") {
        try {
          s.inlineRscDecodedBytes = await page.evaluate(() =>
            [...document.scripts]
              .filter((script) => script.textContent.includes("__next_f"))
              .reduce(
                (n, script) =>
                  n + new TextEncoder().encode(script.textContent).length,
                0,
              ),
          );
        } catch {
          s.inlineRscDecodedBytes = null;
          (s.secondaryFailures ??= []).push({
            failureStage: "failure-inline-observation",
            failureKind: "observation-error",
          });
        }
      }
    }
  } finally {
    await client?.detach().catch(() => {});
    try {
      await context?.close();
    } catch {
      cleanupFailure("close-browser-context", "browser-close-error");
    }
    if (collectorVisit) {
      try {
        const closed = await collector.endCollectorVisit(collectorVisit);
        s.collectorVisit.nativeCloseProof = closed.nativeCloseProof ?? null;
        s.collectorVisit.nativeCloseElapsedMs =
          closed.nativeCloseElapsedMs ?? null;
        if (
          closed.protocol !== "z8-fixture-otlp-collector-v2" ||
          !closed.traces?.some((e) => e.traceId === traceId)
        )
          throw Error(
            "Collector close proof protocol or measured trace is missing.",
          );
        s.collectorVisit.closed =
          closed.protocol === "z8-fixture-otlp-collector-v2";
        s.collectorVisit.coverage =
          closed.traces?.find((e) => e.traceId === traceId)?.coverage ?? null;
      } catch {
        cleanupFailure("collector-close", "collector-proof-error");
      }
    }
    if (transport) {
      s.traceTransport = {
        kind: companionWireContract.traceTransport,
        ...transport.snapshot(),
      };
      s.wireAfterClose = transport.wire?.state(performance.now()) ?? null;
      try {
        await transport.close();
      } catch {
        cleanupFailure("trace-transport-close", "transport-error");
      }
    }
  }
  return s;
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift(),
    options = {};
  const allowed =
    command === "capture"
      ? ["--plan", "--auth", "--chrome", "--out", "--collector"]
      : ["--plan", "--artifact", "--backend"];
  for (let i = 0; i < args.length; i += 2) {
    if (
      !allowed.includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      options[args[i]]
    )
      throw Error(
        "Use documented nonduplicate option/value pairs; cohort filtering is forbidden.",
      );
    options[args[i]] = args[i + 1];
  }
  if (!options["--plan"]) throw Error("Missing --plan.");
  const bytes = await readFile(options["--plan"]),
    plan = JSON.parse(bytes),
    cohorts = settledCohorts(plan),
    planSha256 = hash(bytes);
  if (command === "capture" && !options["--collector"])
    throw Error("Capture requires registered --collector control.");
  const protocol = await protocolIdentity();
  if (command === "finalize") {
    if (!options["--artifact"] || !options["--backend"])
      throw Error("Require artifact and flushed native backend evidence.");
    const artifact = JSON.parse(await readFile(options["--artifact"])),
      native = JSON.parse(await readFile(options["--backend"]));
    if (JSON.stringify(artifact.protocol) !== JSON.stringify(protocol))
      throw Error("Companion protocol changed after capture.");
    for (const s of artifact.samples) {
      const e = native.find((e) => e.traceId === s.traceId);
      s.backend = Object.fromEntries(
        metrics.map((k) => [
          k,
          artifact.nativeRunCoverage?.complete === true &&
          Number.isFinite(e?.[k]) &&
          e[k] >= 0
            ? e[k]
            : null,
        ]),
      );
    }
    artifact.gates = settledEvidenceGates(plan, artifact, native, planSha256);
    artifact.finalized = true;
    artifact.evidenceComplete = artifact.gates.length === 0;
    artifact.nativeSha256 = hash(await readFile(options["--backend"]));
    artifact.behaviorComplete = artifact.samples.every(
      (s) => !s.failed && !s.censored,
    );
    artifact.resourceComplete = artifact.evidenceComplete;
    artifact.resourceGates = [];
    if (artifact.resourceComplete) {
      try {
        requireSettledEvidence(plan, artifact, native, planSha256);
      } catch {
        artifact.resourceComplete = false;
        artifact.resourceGates.push(
          "Settled traffic, byte fields or backend error evidence is incomplete.",
        );
      }
    } else
      artifact.resourceGates.push(
        "A required cohort is failed, censored, capped or lacks complete evidence.",
      );
    artifact.resourceObservationBasis = !artifact.resourceComplete
      ? "unfulfilled resource observation; no complete cost claim"
      : artifact.behaviorComplete
        ? "complete observed traffic for successful behavior"
        : beforeFailurePolicy.resourceClaim;
    artifact.acceptance = artifact.resourceComplete
      ? "settled-resources-recorded"
      : "unfulfilled";
    await writeFile(options["--artifact"], encode(artifact));
    console.log(`Settled resource acceptance: ${artifact.acceptance}.`);
    process.exitCode = artifact.resourceComplete ? 0 : 1;
    return;
  }
  if (
    command !== "capture" ||
    !options["--auth"] ||
    !options["--chrome"] ||
    !options["--out"]
  )
    throw Error("Capture requires --auth, --chrome and --out.");
  const collector = await import("./collector-client.mjs");
  let auth;
  const artifact = {
    schema: 1,
    kind: "settled-resource-companion",
    phase: plan.phase,
    planSha256,
    policy: companionPolicy,
    protocol,
    runtime: {
      ...plan.runtime,
      node: process.version,
      observedBuild: null,
      buildVerified: false,
    },
    hardware: {
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryBytes: totalmem(),
    },
    browser: null,
    samples: [],
    finalized: false,
    evidenceComplete: false,
    resourceComplete: false,
    acceptance: "unfulfilled",
    nativeRunCoverage: { complete: false },
  };
  await mkdir(dirname(options["--out"]), { recursive: true });
  await writeFile(options["--out"], encode(artifact), { flag: "wx" });
  let checkpoint = Promise.resolve();
  await runCompanionCapture({
    collector,
    control: options["--collector"],
    artifact,
    openBrowser: async () => {
      const version = await fetch(new URL("/api/app-version", plan.origin), {
          signal: AbortSignal.timeout(10000),
        }),
        observed = (await version.json()).buildHash;
      if (
        !version.ok ||
        !/^[a-f0-9]{7,40}$/.test(observed ?? "") ||
        !plan.runtime.build.startsWith(observed)
      )
        throw Error("Actual fixture build identity differs before capture.");
      artifact.runtime.observedBuild = observed;
      artifact.runtime.buildVerified = true;
      auth = JSON.parse(await readFile(options["--auth"]));
      const { default: puppeteer } = await import("puppeteer-core");
      return launchFixtureBrowser(puppeteer, options["--chrome"]);
    },
    capture: async (browser) => {
      artifact.browser = await browser.version();
      for (const c of cohorts) {
        let index = 0;
        await Promise.all(
          Array.from({ length: plan.concurrency }, async () => {
            while (index < c.count) {
              const iteration = index++;
              artifact.samples.push(
                await measureFixtureResources(
                  browser,
                  auth,
                  plan,
                  plan.conditions.find((x) => x.name === c.condition),
                  plan.ranges.find((x) => x.name === c.range),
                  plan.routes.find((x) => x.name === c.route),
                  c.mode,
                  iteration,
                  options["--collector"],
                  collector,
                ),
              );
              checkpoint = checkpoint.then(() =>
                writeFile(options["--out"], encode(artifact)),
              );
              await checkpoint;
            }
          }),
        );
      }
    },
    checkpoint: async () => {
      await checkpoint;
      await writeFile(options["--out"], encode(artifact));
    },
  });
  console.log(
    "Companion samples recorded. Flush native collector, then finalize.",
  );
  process.exitCode = 1;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(pathToFileURL(process.argv[1]))
)
  main().catch((error) => {
    console.error(
      error.code
        ? "Companion input/runtime unavailable."
        : error instanceof SyntaxError
          ? "Invalid companion JSON."
          : error.message,
    );
    process.exitCode = 2;
  });
