#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
export function settledCohorts(plan) {
  if (!Number.isInteger(plan.samples) || plan.samples < 20)
    throw Error("At least twenty samples are required.");
  if (
    !["baseline", "release"].includes(plan.phase) ||
    plan.fixture?.kind !== "disposable" ||
    plan.fixture.journeysVerified !== true ||
    plan.runtime?.mode !== "production" ||
    plan.runtime?.collectorProtocol !== "z8-fixture-otlp-collector-v2" ||
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
  if (artifact.interrupted === true || artifact.interruption != null)
    gates.push("Interrupted companion evidence cannot fulfill resource gates.");
  if (
    artifact.kind !== "settled-resource-companion" ||
    artifact.phase !== plan.phase ||
    artifact.planSha256 !== planSha ||
    JSON.stringify(artifact.policy) !== JSON.stringify(settledPolicy) ||
    !artifact.runtime?.buildVerified ||
    artifact.runtime.collectorProtocol !== plan.runtime.collectorProtocol ||
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
    if (!expected.has(key(s)) || ids.has(s.traceId) || !s.traceId)
      gates.push("Unexpected companion cohort or reused trace.");
    ids.add(s.traceId);
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
    if (
      s.failed ||
      s.censored ||
      s.settled?.complete !== true ||
      s.settled.capped ||
      s.settled.mandatoryErrors !== 0 ||
      s.settled.mandatoryPending !== 0
    )
      throw Error("Settled resource cohort is failed or censored.");
    if (
      ["javascript", "document", "rsc", "otherFinite"].some(
        (k) => !Number.isFinite(s.settled.bytes?.[k]) || s.settled.bytes[k] < 0,
      ) ||
      (s.mode === "first-document" &&
        (!Number.isFinite(s.inlineRscDecodedBytes) ||
          s.inlineRscDecodedBytes < 0))
    )
      throw Error("Settled byte evidence is missing.");
    const e = native.find((e) => e.traceId === s.traceId);
    if (e.observedQueryErrors !== 0 || e.observedPoolAcquisitionErrors !== 0)
      throw Error("Settled backend observed errors.");
  }
}
async function protocolIdentity() {
  const files = [
    "settled-resources.mjs",
    "settled-resource-observer.mjs",
    "journey-steps.mjs",
    "run-baseline.mjs",
    "collector-client.mjs",
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name,
        hash(await readFile(new URL(name, import.meta.url))),
      ]),
    ),
  );
}
async function measure(
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
    backend: null,
    failureStage: null,
    failureKind: null,
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
    context = await browser.createBrowserContext();
    stage = "authentication-context";
    await prepareFixtureBrowserContext(context, plan.origin);
    if (!Array.isArray(auth[condition.name]?.cookies))
      throw Error("Missing fixture authentication.");
    await context.setCookie(...auth[condition.name].cookies);
    page = await context.newPage();
    await page.setViewport(condition.viewport);
    await page.emulateTimezone(condition.timezone);
    await page.setExtraHTTPHeaders({ "Accept-Language": condition.locale });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const headers = request.headers(),
        prefetch =
          headers["next-router-prefetch"] === "1" ||
          /prefetch/i.test(headers.purpose ?? "") ||
          /prefetch/i.test(headers["sec-purpose"] ?? ""),
        longLived =
          ["eventsource", "websocket"].includes(request.resourceType()) ||
          /text\/event-stream/i.test(headers.accept ?? "");
      const id = active
        ? prefetch || longLived
          ? backgroundTraceId
          : traceId
        : prerequisiteTraceId;
      request
        .continue(
          new URL(request.url()).origin === plan.origin
            ? {
                headers: {
                  ...headers,
                  traceparent: `00-${id}-${randomBytes(8).toString("hex")}-01`,
                },
              }
            : {},
        )
        .catch(() => {});
    });
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
    }
    active = true;
    started = performance.now();
    observer.begin(started);
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
    s.atReady = observer.state(performance.now());
    stage = "settle-resources";
    do {
      s.settled = observer.state(performance.now());
      if (s.settled.complete || s.settled.capped) break;
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
    s.censored = !s.settled.complete;
  } catch (error) {
    s.failed = true;
    s.failureStage = stage;
    s.failureKind =
      error?.name === "TimeoutError" ? "timeout" : "journey-error";
    s.elapsedUntilFailureMs =
      started === undefined ? null : performance.now() - started;
    s.settled = observer.state(performance.now());
  } finally {
    await client?.detach().catch(() => {});
    try {
      await context?.close();
    } catch {
      s.failed = true;
      s.censored = true;
      s.failureStage = "close-browser-context";
      s.failureKind = "browser-close-error";
    }
    if (collectorVisit) {
      try {
        const closed = await collector.endCollectorVisit(collectorVisit);
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
        s.failed = true;
        s.censored = true;
        s.failureStage = "collector-close";
        s.failureKind = "collector-proof-error";
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
          Number.isFinite(e?.[k]) && e[k] >= 0 ? e[k] : null,
        ]),
      );
    }
    artifact.gates = settledEvidenceGates(plan, artifact, native, planSha256);
    artifact.finalized = true;
    artifact.evidenceComplete = artifact.gates.length === 0;
    artifact.nativeSha256 = hash(await readFile(options["--backend"]));
    artifact.resourceComplete =
      artifact.evidenceComplete &&
      artifact.samples.every(
        (s) => !s.failed && !s.censored && s.settled?.complete === true,
      );
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
  const auth = JSON.parse(await readFile(options["--auth"]));
  const artifact = {
    schema: 1,
    kind: "settled-resource-companion",
    phase: plan.phase,
    planSha256,
    policy: settledPolicy,
    protocol,
    runtime: {
      ...plan.runtime,
      node: process.version,
      observedBuild: observed,
      buildVerified: true,
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
  };
  await mkdir(dirname(options["--out"]), { recursive: true });
  await writeFile(options["--out"], encode(artifact), { flag: "wx" });
  const { default: puppeteer } = await import("puppeteer-core"),
    browser = await puppeteer.launch({
      executablePath: options["--chrome"],
      headless: true,
    });
  artifact.browser = await browser.version();
  let checkpoint = Promise.resolve();
  try {
    for (const c of cohorts) {
      let index = 0;
      await Promise.all(
        Array.from({ length: plan.concurrency }, async () => {
          while (index < c.count) {
            const iteration = index++;
            artifact.samples.push(
              await measure(
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
  } finally {
    await checkpoint;
    await browser.close();
  }
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
