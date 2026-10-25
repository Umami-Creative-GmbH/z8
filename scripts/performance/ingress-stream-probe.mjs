#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
/** Local operator experiment; no artificial delays in public product routes. */
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCollectorCounters } from "./collector-client.mjs";
import { launchFixtureBrowser } from "./fixture-browser.mjs";
import { observeIngress, readDashboardDom } from "./ingress-browser.mjs";
import {
	ingressFailureAlertSelector,
	installIngressFailureTimeline,
	readIngressFailureTimeline,
} from "./ingress-failure-timeline.mjs";
import {
	clickVisible,
	prepareFixtureBrowserContext,
	waitVisible,
} from "./journey-steps.mjs";
import { readMultiInstanceFixture } from "./multi-instance-fixture.mjs";
import {
	beginMultiInstanceObservation,
	multiInstanceObservationProtocol,
} from "./multi-instance-observation.mjs";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = (path, value, exclusive = false) =>
	writeFile(path, JSON.stringify(value, null, 2), {
		mode: 0o600,
		flag: exclusive ? "wx" : "w",
	});
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function clockActionReference(artifactApp) {
	const directory = join(artifactApp, ".next/static/chunks");
	const references = new Set();
	for (const name of await readdir(directory, { recursive: true })) {
		if (!name.endsWith(".js")) continue;
		const source = await readFile(join(directory, name), "utf8");
		for (const match of source.matchAll(
			/createServerReference\)\("([a-f0-9]{40,64})",[^;]{0,150}"getTimeClockStatus"\)/g,
		))
			references.add(match[1]);
	}
	assert(
		references.size === 1,
		"The compiled clock read reference is ambiguous or absent.",
	);
	return [...references][0];
}
async function saveIngressEvidence(path, value) {
	const immutable = path.replace(
		/\.json$/,
		`-${Date.now()}-${randomBytes(4).toString("hex")}.json`,
	);
	await save(immutable, value, true);
	await save(path, value);
}
const processOutput = (program, args) =>
	execFileSync(program, args, {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};
const allWidgets = [
	"manager-today",
	"managed-employees",
	"pending-approvals",
	"team-overview",
	"quick-stats",
	"upcoming-shifts",
	"presence-status",
	"covering-for",
	"whos-out-today",
	"upcoming-time-off",
	"recently-approved",
	"birthday-reminders",
	"hydration",
	"vacation-balance",
];

export async function ingressPlan(directory, expectedSource) {
	const fixture = await readMultiInstanceFixture(directory);
	if (
		!/^[a-f0-9]{7,40}$/.test(expectedSource ?? "") ||
		!/^[a-f0-9]{7,40}$/.test(fixture.sourceBuild ?? "")
	)
		throw new Error("Pin the actual final compiled source commit.");
	const git = (...args) =>
		execFileSync("git", args, {
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const source = git("rev-parse", "--verify", `${expectedSource}^{commit}`);
	if (
		source !== git("rev-parse", "--verify", `${fixture.sourceBuild}^{commit}`)
	)
		throw new Error(
			"The expected source does not match the fixture's compiled source.",
		);
	git(
		"merge-base",
		"--is-ancestor",
		"db51c13fa3583b11d5701e12231fa3cb3285698c",
		source,
	);
	const controls = Object.fromEntries(
		["a", "b"].map((replica) => [
			replica,
			join(resolve(directory), `observer-${replica}`, "collector-control.json"),
		]),
	);
	const manifests = await Promise.all(
		Object.values(controls).map(async (path) => {
			const collector = await json(path);
			assert(
				collector.kind === "z8-fixture-otlp-collector-v2" &&
					collector.observerControl,
				"Ingress requires two registered V2 collectors.",
			);
			const native = await json(collector.observerControl);
			assert(
				native.protocol === "z8-fixture-native-observer-v2",
				"Ingress requires native V2 controls.",
			);
			for (const endpoint of [collector.endpoint, native.endpoint]) {
				const url = new URL(endpoint);
				assert(
					url.protocol === "http:" &&
						["localhost", "127.0.0.1"].includes(url.hostname),
					"Collector/native controls must be loopback-only.",
				);
			}
			return { collector, native };
		}),
	);
	assert(
		manifests[0].collector.endpoint !== manifests[1].collector.endpoint &&
			manifests[0].native.endpoint !== manifests[1].native.endpoint &&
			resolve(manifests[0].collector.observerControl) !==
				resolve(manifests[1].collector.observerControl),
		"Ingress requires independent per-replica collector/native controls.",
	);
	return {
		fixture,
		controls,
		publicPlan: {
			sourceBuild: source,
			proxy: "Docker HAProxy 2.8",
			holdTable: "shift",
			observationProtocol: multiInstanceObservationProtocol,
			maximumHoldMs: 12000,
			runtimeVerified: false,
			productionTopologyVerified: false,
			cdnVerified: false,
		},
	};
}

async function runtimeInputs(directory, source, actor) {
	const { fixture, publicPlan, controls } = await ingressPlan(
		directory,
		source,
	);
	assert(
		fixture.prepared &&
			fixture.containers.includes(fixture.postgres) &&
			fixture.containers.includes(fixture.proxy),
		"Prepare the owned multi-instance fixture before runtime verification.",
	);
	for (const container of [fixture.postgres, fixture.proxy, fixture.storage]) {
		assert(
			processOutput("docker", [
				"inspect",
				"--format",
				'{{ index .Config.Labels "z8.agent-owned" }}',
				container,
			]) === fixture.label,
			"Actual Docker ownership does not match the fixture.",
		);
	}
	const mappedPort = processOutput("docker", [
		"inspect",
		"--format",
		'{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
		fixture.postgres,
	]);
	assert(
		mappedPort === String(fixture.env.POSTGRES_PORT),
		"The configured database is not the owned Docker port.",
	);
	const storagePort = processOutput("docker", [
		"inspect",
		"--format",
		'{{(index (index .NetworkSettings.Ports "9000/tcp") 0).HostPort}}',
		fixture.storage,
	]);
	const storageOrigin = new URL(fixture.env.S3_PUBLIC_ENDPOINT);
	assert(
		storageOrigin.protocol === "http:" &&
			storageOrigin.hostname === "127.0.0.1" &&
			storageOrigin.port === storagePort &&
			!storageOrigin.username &&
			!storageOrigin.password &&
			storageOrigin.pathname === "/",
		"Only this fixture's exact owned S3 origin is allowed.",
	);
	const manifest = await readFile(
		join(fixture.artifactApp, ".next/required-server-files.json"),
	);
	assert(
		createHash("sha256").update(manifest).digest("hex") ===
			fixture.artifactManifestSha256 &&
			(
				await readFile(join(fixture.artifactApp, ".next/BUILD_ID"), "utf8")
			).trim() === fixture.artifactBuildId,
		"The compiled artifact changed after preparation.",
	);
	const people = await json(join(directory, "fixture-private.json"));
	const auth = await json(join(directory, "auth-private.json"));
	assert(
		people.kind === "disposable" &&
			people.actors[actor] &&
			auth[actor]?.cookies?.length,
		"A real authenticated disposable actor is required.",
	);
	const require = createRequire(join(fixture.artifactApp, "package.json"));
	const { Client } = require("pg");
	const connection = {
		host: "127.0.0.1",
		port: Number(mappedPort),
		database: fixture.env.POSTGRES_DB,
		user: fixture.env.POSTGRES_USER || "postgres",
		password: fixture.env.POSTGRES_PASSWORD,
		application_name: "z8_ingress_probe_1473",
		connectionTimeoutMillis: 5000,
		query_timeout: 5000,
	};
	const admin = new Client(connection);
	admin.on("error", () => {});
	await admin.connect();
	try {
		assert(
			(await admin.query("select current_database() as name")).rows[0].name ===
				fixture.env.POSTGRES_DB,
			"Actual database is outside the fixture.",
		);
		const subject = people.actors[actor];
		const row = (
			await admin.query(
				"select user_id from employee where id=$1 and organization_id=$2 and is_active=true",
				[subject.employeeId, subject.organizationId],
			)
		).rows[0];
		assert(
			row?.user_id,
			"The synthetic actor is not an eligible fixture employee.",
		);
		const proxyConfig = await readFile(
			join(directory, "haproxy-private.cfg"),
			"utf8",
		);
		return {
			fixture,
			controls,
			allowedOrigins: [fixture.origin, storageOrigin.origin],
			publicPlan,
			auth: auth[actor],
			subject: { ...subject, userId: row.user_id },
			require,
			admin,
			connection,
			topology: {
				proxy: "Docker HAProxy 2.8",
				proxyImage: fixture.images.proxy,
				configSha256: createHash("sha256").update(proxyConfig).digest("hex"),
				compressionDirective: /\bcompression\s/.test(proxyConfig),
				filterDirective: /^\s*filter\s/m.test(proxyConfig),
				productionTopologyVerified: false,
				cdnVerified: false,
			},
		};
	} catch (error) {
		await admin.end();
		throw error;
	}
}

async function enableVariant(inputs, directory, onBackup) {
	const { subject, admin, fixture } = inputs;
	const settings = (
		await admin.query(
			"select dashboard_widget_order from user_settings where user_id=$1",
			[subject.userId],
		)
	).rows[0];
	const flags = (
		await admin.query("select shifts_enabled from organization where id=$1", [
			subject.organizationId,
		])
	).rows[0];
	const backup = {
		kind: "local-ingress-variant-1473",
		label: fixture.label,
		organizationId: subject.organizationId,
		userId: subject.userId,
		settingsExisted: Boolean(settings),
		layout: settings?.dashboard_widget_order ?? null,
		shiftsEnabled: flags.shifts_enabled,
	};
	// An unfinished earlier variant must be restored explicitly, never overwritten.
	await save(join(directory, "ingress-variant-private.json"), backup, true);
	onBackup();
	await admin.query("update organization set shifts_enabled=true where id=$1", [
		subject.organizationId,
	]);
	const layout = {
		order: ["quick-stats", "upcoming-shifts"],
		hidden: allWidgets.filter(
			(id) => !["quick-stats", "upcoming-shifts"].includes(id),
		),
		version: 1,
	};
	await admin.query(
		"insert into user_settings (user_id,dashboard_widget_order,updated_at) values ($1,$2::jsonb,now()) on conflict (user_id) do update set dashboard_widget_order=excluded.dashboard_widget_order",
		[subject.userId, JSON.stringify(layout)],
	);
}

async function restoreVariant(inputs, directory) {
	const path = join(directory, "ingress-variant-private.json");
	let backup;
	try {
		backup = await json(path);
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	assert(
		backup.kind === "local-ingress-variant-1473" &&
			backup.label === inputs.fixture.label &&
			backup.userId === inputs.subject.userId &&
			backup.organizationId === inputs.subject.organizationId,
		"Variant restoration scope does not match its owner.",
	);
	await inputs.admin.query("begin");
	try {
		const admission = backup.admission;
		if (admission?.kind === "sso") {
			if (admission.setup)
				await inputs.admin.query(
					"update enterprise_identity_setup set activated=$1,enforcement=$2::jsonb,provider_id=$3 where organization_id=$4",
					[
						admission.setup.activated,
						JSON.stringify(admission.setup.enforcement),
						admission.setup.provider_id,
						backup.organizationId,
					],
				);
			else
				await inputs.admin.query(
					"delete from enterprise_identity_setup where organization_id=$1",
					[backup.organizationId],
				);
		}
		if (admission?.kind === "mfa") {
			if (admission.policy)
				await inputs.admin.query(
					"update organization_mfa_policy set enabled=$1,grace_period_days=$2 where organization_id=$3",
					[
						admission.policy.enabled,
						admission.policy.grace_period_days,
						backup.organizationId,
					],
				);
			else
				await inputs.admin.query(
					"delete from organization_mfa_policy where organization_id=$1",
					[backup.organizationId],
				);
			if (admission.window)
				await inputs.admin.query(
					"update organization_mfa_window set starts_at=$1,grace_period_days=$2,deadline=$3,last_qualifying_access_at=$4 where organization_id=$5 and user_id=$6",
					[
						admission.window.starts_at,
						admission.window.grace_period_days,
						admission.window.deadline,
						admission.window.last_qualifying_access_at,
						backup.organizationId,
						backup.userId,
					],
				);
			else
				await inputs.admin.query(
					"delete from organization_mfa_window where organization_id=$1 and user_id=$2",
					[backup.organizationId, backup.userId],
				);
		}
		await inputs.admin.query(
			"update organization set shifts_enabled=$1 where id=$2",
			[backup.shiftsEnabled, backup.organizationId],
		);
		if (backup.settingsExisted)
			await inputs.admin.query(
				"update user_settings set dashboard_widget_order=$1::jsonb where user_id=$2",
				[JSON.stringify(backup.layout), backup.userId],
			);
		else
			await inputs.admin.query("delete from user_settings where user_id=$1", [
				backup.userId,
			]);
		await inputs.admin.query("commit");
		await unlink(path);
	} catch (error) {
		await inputs.admin.query("rollback").catch(() => {});
		throw error;
	}
}

async function blockedReaders(admin, holderPid) {
	// Observe a real app query waiting on our exact lock; do not write raw SQL/IDs.
	return (
		await admin.query(
			`select pid, case when query like '%"shift"."employee_id"%' and query like '%"shift"."organization_id"%' and query like '%"shift"."date"%' and query like '%"subarea"%' then 'upcoming-shifts' else 'other-shift-select' end as family from pg_stat_activity where datname=current_database() and pid<>$1 and wait_event_type='Lock' and $1=any(pg_blocking_pids(pid)) and query ~* 'select.*shift'`,
			[holderPid],
		)
	).rows;
}

async function waitBlocked(admin, holderPid, deadline) {
	while (performance.now() < deadline) {
		const rows = await blockedReaders(admin, holderPid);
		if (rows.length) return rows;
		await pause(40);
	}
	throw new Error(
		"No real secondary application read was observed waiting on the owned lock.",
	);
}

export function verifiedCancelledRead(result, rows) {
	const witnessed = result.cancelAcknowledged;
	return (
		result.scenario === "failed" &&
		result.applicationPassed === true &&
		result.failed?.secondaryFailed === true &&
		result.after?.secondaryComplete === true &&
		Array.isArray(witnessed) &&
		witnessed.length > 0 &&
		witnessed.every(
			(row) => row.family === "upcoming-shifts" && row.cancelled === true,
		) &&
		rows.length > 0 &&
		rows.every(
			(row) =>
				Number.isSafeInteger(row.observedQueryErrors) &&
				row.observedQueryErrors >= 0 &&
				row.coverage?.nativeProof === true &&
				row.coverage.closed === true &&
				row.coverage.incomplete === false,
		) &&
		rows.reduce((sum, row) => sum + row.observedQueryErrors, 0) ===
			witnessed.length
	);
}

/** Fixed fail-closed outcomes; a successful HTTP response with clock fields is never denial. */
export function clockAdmissionDenied(allowed, direct, response) {
	if (
		allowed?.status !== 200 ||
		allowed.hasEmployee !== true ||
		!response ||
		response.hasEmployee === true ||
		response.employeeIdMaterialized === true ||
		response.clockedIn === true ||
		response.activePeriodMaterialized === true
	)
		return false;
	return (
		[401, 403].includes(response.status) ||
		(response.status === 400 &&
			response.clockStateField !== true &&
			response.json === true &&
			response.errorField === true &&
			direct?.status === 400 &&
			direct.noActiveOrganization === true)
	);
}

async function finishObservation(observation, contexts, visits, result) {
	let failures = 0;
	for (const context of contexts)
		try {
			await context.close();
		} catch {
			failures++;
		}
	result.backend = [];
	result.measuredCoverage = [];
	for (const visit of visits)
		try {
			const closed = await observation.endVisit(visit);
			for (const id of visit.traceIds) {
				const rows = Object.values(closed.replicas).flatMap((list) =>
					list.filter((row) => row.traceId === id),
				);
				const allowCacheError = verifiedCancelledRead(result, rows);
				result.measuredCoverage.push({
					intentionalCancellation: allowCacheError,
					replicas: rows.map((row) => ({
						observedQueryErrors: row.observedQueryErrors,
						observedQueryCount: row.observedQueryCount,
						cacheHits: row.cacheHits,
						cacheMisses: row.cacheMisses,
						coverage: row.coverage,
					})),
				});
				result.backend.push({
					...observation.metrics(closed, id, { allowCacheError }),
					intentionalCancellation: allowCacheError,
				});
			}
		} catch {
			failures++;
		}
	try {
		await observation.closeRemainingVisits();
		result.nativeProof = await observation.finish();
	} catch {
		failures++;
		result.nativeProof = await observation
			.reconcile()
			.catch(() => ({ complete: false }));
	}
	result.observationClosureFailures = failures;
	result.passed =
		result.applicationPassed === true &&
		failures === 0 &&
		result.nativeProof.complete === true;
}

/** Only called explicitly by the parent after its runtime capture window is free. */
export async function runIngress(
	directory,
	source,
	viewport,
	mode,
	scenario = "held",
	actor = "small-employee",
	diagnostic = null,
) {
	const passiveColdDiagnostic = diagnostic === "passive-cold-20s";
	const failedAlertDiagnostic = diagnostic === "failed-alert-timeline";
	assert(
		diagnostic === null ||
			(passiveColdDiagnostic &&
				viewport === "desktop" &&
				mode === "first-document" &&
					scenario === "held") ||
			(failedAlertDiagnostic && viewport === "desktop" && mode === "first-document" && scenario === "failed"),
		"The passive diagnostic is bounded to desktop first-document held reads.",
	);
	assert(
		["desktop", "mobile"].includes(viewport) &&
			["first-document", "repeat-link"].includes(mode) &&
			["held", "failed"].includes(scenario),
		"Choose a bounded viewport, navigation mode and held/failed scenario.",
	);
	const inputs = await runtimeInputs(directory, source, actor);
	const { admin, fixture, require } = inputs;
	const { Client } = require("pg");
	const holder = new Client(inputs.connection);
	let clockAction;
	holder.on("error", () => {});
	let browser,
		context,
		page,
		observedContext,
		observation,
		network,
		timer,
		navigation;
	const measuredVisits = [];
	let releasedAt = null,
		lockStarted = null,
		release;
	let variantTouched = false;
	let diagnosticPolling, stopDiagnosticPolling = false;
	const observations = {
		scenario,
		viewport,
		mode,
		sourceBuild: inputs.publicPlan.sourceBuild,
		artifactBuildId: fixture.artifactBuildId,
		topology: inputs.topology,
		nativePaintMeasured: false,
		prefetchSuppressed: true,
		browserCacheDisabled: true,
		passed: false,
		diagnosticOnly: passiveColdDiagnostic || failedAlertDiagnostic,
		clockRequests: [],
	};
	const screenshot = async (stage) => {
		if (process.env.Z8_INGRESS_SCREENSHOTS !== "1" || !page) return;
		const name = `ingress-${viewport}-${mode}-${scenario}-${stage}-${Date.now()}-${randomBytes(4).toString("hex")}.png`;
		await page.screenshot({ path: join(directory, name), fullPage: false });
		observations.privateScreenshots ??= {};
		observations.privateScreenshots[stage] = name;
	};
	const stop = () => {
		void browser?.close().catch(() => {});
		void holder.end().catch(() => {});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		clockAction = await clockActionReference(fixture.artifactApp);
		observation = await beginMultiInstanceObservation({
			controls: inputs.controls,
			allowedOrigins: inputs.allowedOrigins,
		});
		await enableVariant(inputs, directory, () => {
			variantTouched = true;
		});
		browser = await launchFixtureBrowser(
			require("puppeteer-core"),
			process.env.Z8_FIXTURE_CHROME ||
				"C:/Program Files/Google/Chrome/Application/chrome.exe",
		);
		observedContext = await observation.createContext(browser, fixture.origin);
		context = observedContext.context;
		observations.browserInitialization = observedContext.browserInitialization;
		await prepareFixtureBrowserContext(context, fixture.origin);
		await context.setCookie(...inputs.auth.cookies);
		page = observedContext.page;
		await page.setViewport(
			viewport === "desktop"
				? { width: 1280, height: 900 }
				: { width: 390, height: 844, isMobile: true, hasTouch: true },
		);
		await page.emulateTimezone("Europe/Berlin");
		if (failedAlertDiagnostic) await page.evaluateOnNewDocument(installIngressFailureTimeline);
		await page.setCacheEnabled(false);
		await page.setRequestInterception(true);
		const trace = randomBytes(16).toString("hex");
		let measuredTrace = null;
		let requestCount = 0;
		const clockRequests = new WeakMap();
		page.on("response", (response) => {
			const row = clockRequests.get(response.request());
			if (row) {
				row.status = response.status();
				row.responseMs = performance.now() - network.started;
			}
		});
		page.on("requestfinished", (request) => {
			const row = clockRequests.get(request);
			if (row) row.finishedMs = performance.now() - network.started;
		});
		page.on("request", (request) => {
			const headers = { ...request.headers() };
			if (network && headers["next-action"] === clockAction) {
				const row = {
					startedMs: performance.now() - network.started,
					responseMs: null,
					finishedMs: null,
					status: null,
				};
				observations.clockRequests.push(row);
				clockRequests.set(request, row);
			}
			if (new URL(request.url()).origin === fixture.origin) {
				requestCount++;
				if (
					headers["next-router-prefetch"] ||
					headers.purpose === "prefetch" ||
					headers["sec-purpose"]?.includes("prefetch")
				) {
					void request.abort().catch(() => {});
					return;
				}
				headers["x-z8-fixture-replica"] = "a";
				if (measuredTrace)
					headers.traceparent = `00-${measuredTrace}-${randomBytes(8).toString("hex")}-01`;
			}
			void request.continue({ headers }).catch(() => {});
		});
		if (mode === "repeat-link") {
			await page.goto(`${fixture.origin}/en/time-tracking`, {
				waitUntil: "domcontentloaded",
				timeout: 45000,
			});
			await waitVisible(
				page,
				'header [data-clock-status="ready"] button[aria-label]',
			);
		}
		observedContext.background();
		measuredVisits.push(await observation.beginVisit([trace]));
		measuredTrace = trace;
		network = await observeIngress(page, fixture.origin, mode);
		if (failedAlertDiagnostic) observations.nodeClockAnchor = { epochMs: Date.now(), elapsedMs: performance.now() - network.started };
		await holder.connect();
		await holder.query("begin");
		await holder.query("set local lock_timeout='2s'");
		await holder.query(
			passiveColdDiagnostic
				? "set local idle_in_transaction_session_timeout='25s'"
				: "set local idle_in_transaction_session_timeout='15s'",
		);
		await holder.query('lock table public."shift" in access exclusive mode');
		lockStarted = performance.now();
		const holderPid = (await holder.query("select pg_backend_pid() as pid"))
			.rows[0].pid;
		let releasePromise;
		release = (reason = "explicit") =>
			(releasePromise ??= (async () => {
				if (failedAlertDiagnostic) observations.releaseWitness = { reason, startedMs: performance.now() - network.started };
				await holder.query("rollback");
				releasedAt = performance.now() - network.started;
				if (failedAlertDiagnostic) observations.releaseWitness.completedMs = releasedAt;
			})());
		// Safety release remains armed even if navigation, telemetry or DOM polling fails.
		timer = setTimeout(
			() => {
				void release("safety").catch(() => {});
			},
			passiveColdDiagnostic ? 21000 : 12000,
		);
		if (mode === "first-document")
			navigation = page.goto(`${fixture.origin}/en`, {
				waitUntil: "domcontentloaded",
				timeout: 45000,
			});
		else {
			if (viewport === "mobile")
				await clickVisible(page, 'button[data-sidebar="trigger"]');
			navigation = clickVisible(page, 'a[href="/en"], a[href="/en/"]');
		}
		navigation.catch(() => {});
		const waiters = await waitBlocked(admin, holderPid, lockStarted + 9000);
		observations.blockedApplicationReads = waiters.length;
		if (passiveColdDiagnostic) {
			observations.applicationPassed = false;
			observations.passiveClockFirstReadyMs = null;
			while (performance.now() - lockStarted < 20000 && releasedAt === null) {
				const dom = await readDashboardDom(page);
				const elapsed = performance.now() - lockStarted;
				if (dom.clockReady && observations.passiveClockFirstReadyMs === null)
					observations.passiveClockFirstReadyMs =
						performance.now() - network.started;
				if (elapsed >= 9000 && !observations.nineSecondDiagnostic)
					observations.nineSecondDiagnostic = {
						observedMs: performance.now() - network.started,
						dom,
						network: network.snapshot(),
						clockRequests: structuredClone(observations.clockRequests),
					};
				await pause(100);
			}
			observations.passiveBeforeRelease = {
				observedMs: performance.now() - network.started,
				dom: await readDashboardDom(page),
				blockedReaders: (await blockedReaders(admin, holderPid)).length,
				network: network.snapshot(),
			};
			await release();
			clearTimeout(timer);
			observations.diagnosticReleaseMs = releasedAt;
			await navigation.catch(() => {});
			await page
				.waitForFunction(
					() => document.querySelector('header [data-clock-status="ready"]'),
					{ timeout: 5000 },
				)
				.catch(() => {});
			observations.postReleaseDiagnosticDom = await readDashboardDom(page);
			throw new Error(
				"Passive diagnostic complete; original nine-second acceptance is not reclassified.",
			);
		}
		await page.waitForFunction(
			() => {
				const quick = document.querySelector('[data-widget-id="quick-stats"]');
				return (
					quick?.getClientRects().length &&
					quick.textContent.includes("This Week") &&
					[
						...document.querySelectorAll(
							'header [data-clock-status="ready"] button[aria-label]',
						),
					].some((button) => button.getClientRects().length && !button.disabled)
				);
			},
			{ timeout: Math.max(1, 9000 - (performance.now() - lockStarted)) },
		);
		const early = await readDashboardDom(page);
		observations.early = early;
		observations.earlyDomObservedMs = performance.now() - network.started;
		assert(
			releasedAt === null &&
				early.usefulSibling &&
				early.clockReady &&
				early.secondaryPending,
			"Useful sibling, known clock and secondary placeholder were not independently visible while the read was held.",
		);
		const status = await page.evaluate(async () => {
			const response = await fetch("/api/time-entries/status", {
				cache: "no-store",
			});
			const body = await response.json();
			return {
				ok: response.ok,
				hasEmployee: body.hasEmployee === true,
				isClockedIn: body.isClockedIn === true,
			};
		});
		assert(
			status.ok &&
				status.hasEmployee &&
				!status.isClockedIn &&
				early.clockLabel === "Clock In",
			"Clock trigger disagrees with the fresh authorized fixture status.",
		);
		network.assertAvailable();
		for (
			let attempt = 0;
			attempt < 20 &&
			!network.snapshot().some((row) => row.usefulContentMs !== null);
			attempt++
		)
			await pause(25);
		const earlyNetwork = network.snapshot();
		assert(
			earlyNetwork.some(
				(row) =>
					row.headers["x-z8-fixture-instance"] === "a" &&
					row.usefulContentMs !== null &&
					row.completeMs === null,
			),
			"Actual useful response content was not observed through the proxy before secondary completion.",
		);
		observations.earlyNetwork = earlyNetwork;
		await screenshot("loading");
		// Keyboard opening proves the actual full SiteHeader trigger is interactive,
		// without issuing a clock command or changing canonical work.
		await (
			await waitVisible(
				page,
				'header [data-clock-status="ready"] button[aria-label="Clock In"]',
			)
		).focus();
		await page.keyboard.press("Enter");
		await page.waitForSelector('[data-slot="popover-content"][data-open]', {
			visible: true,
			timeout: 3000,
		});
		observations.clockPopoverOpenedWithKeyboard = true;
		await page.waitForFunction(
			() =>
				document.activeElement?.closest(
					'[data-slot="popover-content"][data-open]',
				),
			{ timeout: 2000 },
		);
		observations.clockOpenFocus = (await readDashboardDom(page)).focus;
		await page.keyboard.press("Escape");
		const escapeClosed = await page
			.waitForSelector('[data-slot="popover-content"][data-open]', {
				hidden: true,
				timeout: 500,
			})
			.then(
				() => true,
				() => false,
			);
		observations.clockKeyboardEscape = { autofocusClosed: escapeClosed };
		if (!escapeClosed) {
			observations.clockKeyboardEscape.tooltipCount = await page.evaluate(
				() => document.querySelectorAll('[role="tooltip"]').length,
			);
			// Distinguish a nested location tooltip from root popover dismissal. Focus only;
			// never activate the primary clock command during this read experiment.
			let primaryFocused = false;
			for (let tab = 1; tab <= 8; tab++) {
				await page.keyboard.press("Tab");
				primaryFocused = await page.evaluate(() =>
					Boolean(
						document.activeElement?.closest(
							'[data-slot="popover-content"][data-open]',
						) && document.activeElement.textContent.trim() === "Clock In",
					),
				);
				if (primaryFocused) {
					observations.clockKeyboardEscape.tabsToPrimary = tab;
					break;
				}
			}
			assert(
				primaryFocused,
				"Keyboard Tab could not reach the clock popover primary control.",
			);
			await page.keyboard.press("Escape");
			observations.clockKeyboardEscape.primaryFocusClosed = await page
				.waitForSelector('[data-slot="popover-content"][data-open]', {
					hidden: true,
					timeout: 1000,
				})
				.then(
					() => true,
					() => false,
				);
			if (!observations.clockKeyboardEscape.primaryFocusClosed) {
				await (
					await page.$(
						'header [data-clock-status="ready"] button[aria-label="Clock In"]',
					)
				).focus();
				await page.keyboard.press("Enter");
				await page.waitForSelector('[data-slot="popover-content"][data-open]', {
					hidden: true,
					timeout: 1000,
				});
				observations.clockKeyboardEscape.triggerToggleClosed = true;
			}
		}
		await page.waitForFunction(
			() =>
				document.activeElement?.closest('header [data-clock-status="ready"]'),
			{ timeout: 1000 },
		);
		observations.clockEscapeFocus = (await readDashboardDom(page)).focus;
		assert(
			observations.clockEscapeFocus.kind === "header-clock",
			"Closing the clock popover did not return focus to its header trigger.",
		);
		if (scenario === "failed") {
			observations.cancelStartedMs = performance.now() - network.started;
			observations.cancelAcknowledged = [];
			for (const waiter of await blockedReaders(admin, holderPid)) {
				const cancelled = await admin.query(
					"select pg_cancel_backend($1) as cancelled",
					[waiter.pid],
				);
				observations.cancelAcknowledged.push({
					family: waiter.family,
					cancelled: cancelled.rows[0].cancelled === true,
					...(failedAlertDiagnostic ? { acknowledgedMs: performance.now() - network.started } : {}),
				});
			}
			if (failedAlertDiagnostic) {
				observations.postCancelWaiters = [];
				diagnosticPolling = (async () => {
					for (let count = 0; count < 32 && !stopDiagnosticPolling; count++) {
						try {
							const rows = await blockedReaders(admin, holderPid);
							observations.postCancelWaiters.push({ observedMs: performance.now() - network.started,
								upcoming: rows.filter((row) => row.family === "upcoming-shifts").length,
								other: rows.filter((row) => row.family !== "upcoming-shifts").length, released: releasedAt !== null });
						} catch { observations.waiterWitnessFailed = true; break; }
						await pause(250);
					}
				})();
				observations.normalAlertWaitStartedMs = performance.now() - network.started;
				observations.normalFourSecondAlertObserved = await page.waitForSelector(ingressFailureAlertSelector, { timeout: 4000 }).then(() => true, () => false);
				observations.normalAlertWaitFinishedMs = performance.now() - network.started;
				observations.normalFourSecondDom = await readDashboardDom(page);
				observations.applicationPassed = false;
				// Passive tail only: the original twelve-second safety release remains armed.
				await pause(Math.max(0, Math.min(8000, lockStarted + 14000 - performance.now())));
				observations.alertTimeline = await page.evaluate(readIngressFailureTimeline);
				observations.passiveTailDom = await readDashboardDom(page);
				throw new Error("Failed-alert diagnostic complete; no application acceptance or retry claimed.");
			}
			await page.waitForSelector(
				ingressFailureAlertSelector,
				{ timeout: 4000 },
			);
			observations.errorObservedMs = performance.now() - network.started;
			observations.failed = await readDashboardDom(page);
			await screenshot("error");
			assert(
				observations.failed.usefulSibling && observations.failed.clockReady,
				"Failed secondary read hid completed content.",
			);
		} else {
			await pause(Math.max(0, 8000 - (performance.now() - lockStarted)));
			assert(
				(await blockedReaders(admin, holderPid)).length > 0 &&
					releasedAt === null,
				"The read was no longer held before its planned release.",
			);
		}
		await release();
		clearTimeout(timer);
		if (scenario === "failed") {
			await (
				await waitVisible(page, 'button[aria-label="Retry Upcoming Shifts"]')
			).focus();
			observations.retryKeyboardFocus = (await readDashboardDom(page)).focus;
			await page.keyboard.press("Enter");
		}
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-widget-id="upcoming-shifts"]')
					?.textContent.includes("No upcoming shifts"),
			{ timeout: 15000 },
		);
		await navigation;
		observations.after = await readDashboardDom(page);
		await screenshot("completed");
		if (scenario === "failed") {
			await page.keyboard.press("Tab");
			observations.nextTabAfterRecovery = (await readDashboardDom(page)).focus;
		}
		observations.releasedAtMs = releasedAt;
		observations.network = network.snapshot();
		observations.requestCount = requestCount;
		measuredTrace = null;
		observations.applicationPassed =
			observations.after.secondaryComplete &&
			observations.after.usefulSibling &&
			observations.after.clockReady;
		assert(
			observations.applicationPassed,
			"The released or retried secondary read did not recover alongside the successful sibling and clock.",
		);
	} catch (error) {
		// Retain only bounded signals, never document text, cookies or tenant IDs.
		observations.failureDom = await readDashboardDom(page).catch(() => null);
		observations.failureNetwork = network?.snapshot() ?? [];
		observations.failedWhileReadHeld = releasedAt === null;
		observations.failureObservedMs = network
			? performance.now() - network.started
			: null;
		await screenshot("failed-acceptance").catch(() => {});
		if (
			!passiveColdDiagnostic &&
			page &&
			releasedAt === null &&
			observations.failureDom?.clockStates?.pending === 1
		) {
			observations.pendingHeaderInteraction = await (async () => {
				const startedMs = performance.now() - network.started;
				const selector =
					viewport === "mobile"
						? 'header button[aria-label="More actions"]'
						: 'header button[data-sidebar="trigger"]';
				const state = () =>
					page.evaluate(
						(mobile) =>
							mobile
								? document.querySelectorAll(
										'[data-slot="popover-content"][data-open]',
									).length
								: document
										.querySelector('[data-slot="sidebar"][data-state]')
										?.getAttribute("data-state"),
						viewport === "mobile",
					);
				const before = await state();
				await (await page.$(selector)).focus();
				await page.keyboard.press("Enter");
				await pause(200);
				const changed = (await state()) !== before;
				if (changed)
					await page.keyboard.press(viewport === "mobile" ? "Escape" : "Enter");
				return {
					changed,
					whileReadHeld: releasedAt === null,
					startedMs,
					finishedMs: performance.now() - network.started,
				};
			})().catch(() => ({
				changed: false,
				whileReadHeld: releasedAt === null,
			}));
			// Later signals diagnose release coupling without changing failed acceptance.
			await release();
			observations.diagnosticReleaseMs = releasedAt;
			await page
				.waitForFunction(
					() => document.querySelector('header [data-clock-status="ready"]'),
					{ timeout: 5000 },
				)
				.catch(() => {});
			observations.postReleaseDiagnosticDom = await readDashboardDom(
				page,
			).catch(() => null);
		}
		throw error;
	} finally {
		stopDiagnosticPolling = true;
		await diagnosticPolling?.catch(() => {});
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		clearTimeout(timer);
		if (release) await release().catch(() => {});
		await holder.end().catch(() => {});
		if (observation)
			observations.nativeBeforeContextClose = Object.fromEntries(
				await Promise.all(
					["a", "b"].map(async (node) => [
						node,
						await readCollectorCounters(inputs.controls[node]).catch(() => ({
							available: false,
						})),
					]),
				),
			);
		await network?.close().catch(() => {});
		if (observation)
			await finishObservation(
				observation,
				observedContext ? [observedContext] : [],
				measuredVisits,
				observations,
			);
		if (observation)
			observations.nativeAfterContextClose = Object.fromEntries(
				await Promise.all(
					["a", "b"].map(async (node) => [
						node,
						await readCollectorCounters(inputs.controls[node]).catch(() => ({
							available: false,
						})),
					]),
				),
			);
		await browser?.close().catch(() => {});
		try {
			await saveIngressEvidence(
				join(
					directory,
					`ingress-${viewport}-${mode}-${scenario}${passiveColdDiagnostic ? "-passive-cold-diagnostic" : failedAlertDiagnostic ? "-failed-alert-diagnostic" : ""}.json`,
				),
				observations,
			);
		} finally {
			// Restore even if the variant mutation or evidence write failed partway.
			try {
				if (variantTouched) await restoreVariant(inputs, directory);
			} finally {
				await admin.end();
			}
		}
	}
	assert(
		observations.passed,
		"Ingress V2 native or strict transport proof did not reconcile.",
	);
	return observations;
}

/** Exercise real admission policy, not a fake session or browser response. */
export async function runAdmission(
	directory,
	source,
	scenario,
	viewport = "desktop",
	actor = "small-employee",
) {
	assert(
		["signed-out", "mfa", "sso"].includes(scenario) &&
			["desktop", "mobile"].includes(viewport),
		"Choose signed-out, mfa or sso admission and a bounded viewport.",
	);
	const inputs = await runtimeInputs(directory, source, actor);
	let browser,
		observation,
		touched = false;
	const observedContexts = [],
		measuredVisits = [];
	const result = {
		scenario,
		viewport,
		sourceBuild: inputs.publicPlan.sourceBuild,
		topology: inputs.topology,
		nativePaintMeasured: false,
		protectedContentEmitted: null,
		passed: false,
	};
	const stop = () => {
		void browser?.close().catch(() => {});
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		observation = await beginMultiInstanceObservation({
			controls: inputs.controls,
			allowedOrigins: inputs.allowedOrigins,
		});
		await enableVariant(inputs, directory, () => {
			touched = true;
		});
		browser = await launchFixtureBrowser(
			inputs.require("puppeteer-core"),
			process.env.Z8_FIXTURE_CHROME ||
				"C:/Program Files/Google/Chrome/Application/chrome.exe",
		);
		const observedControl = await observation.createContext(
			browser,
			inputs.fixture.origin,
		);
		observedContexts.push(observedControl);
		const control = observedControl.context;
		await prepareFixtureBrowserContext(control, inputs.fixture.origin);
		await control.setCookie(...inputs.auth.cookies);
		const allowed = observedControl.page;
		await allowed.setExtraHTTPHeaders({ "x-z8-fixture-replica": "a" });
		await allowed.goto(`${inputs.fixture.origin}/en`, {
			waitUntil: "domcontentloaded",
			timeout: 45000,
		});
		await waitVisible(
			allowed,
			'header [data-clock-status="ready"] button[aria-label]',
		);
		assert(
			(await readDashboardDom(allowed)).protectedContent,
			"The allowed control did not exercise the actual protected application.",
		);
		result.allowedClockResponse = await allowed.evaluate(async () => {
			const response = await fetch("/api/time-entries/status", {
				cache: "no-store",
			});
			const body = await response.json();
			return {
				status: response.status,
				hasEmployee: body?.hasEmployee === true,
			};
		});
		assert(
			result.allowedClockResponse.status === 200 &&
				result.allowedClockResponse.hasEmployee,
			"Allowed control must exercise a selected, authorized clock actor before admission is restricted.",
		);
		const admittedCookies = await control.cookies();
		observedControl.background();
		await observedControl.close();
		const { admin, subject } = inputs;
		const path = join(directory, "ingress-variant-private.json");
		const backup = await json(path);
		if (scenario === "sso") {
			backup.admission = {
				kind: "sso",
				setup:
					(
						await admin.query(
							"select activated,enforcement,provider_id from enterprise_identity_setup where organization_id=$1",
							[subject.organizationId],
						)
					).rows[0] ?? null,
			};
			await save(path, backup);
			await admin.query(
				"insert into enterprise_identity_setup (organization_id,activated,enforcement) values ($1,true,'{\"ssoRequired\":true,\"domainRestrictionEnabled\":false,\"inviteRestrictionEnabled\":false}'::jsonb) on conflict (organization_id) do update set activated=true,enforcement=jsonb_set(enterprise_identity_setup.enforcement,'{ssoRequired}','true'::jsonb),provider_id=null",
				[subject.organizationId],
			);
		}
		if (scenario === "mfa") {
			backup.admission = {
				kind: "mfa",
				policy:
					(
						await admin.query(
							"select enabled,grace_period_days from organization_mfa_policy where organization_id=$1",
							[subject.organizationId],
						)
					).rows[0] ?? null,
				window:
					(
						await admin.query(
							"select starts_at,grace_period_days,deadline,last_qualifying_access_at from organization_mfa_window where organization_id=$1 and user_id=$2",
							[subject.organizationId, subject.userId],
						)
					).rows[0] ?? null,
			};
			await save(path, backup);
			await admin.query(
				"insert into organization_mfa_policy (organization_id,enabled,grace_period_days,updated_by) values ($1,true,0,$2) on conflict (organization_id) do update set enabled=true,grace_period_days=0",
				[subject.organizationId, subject.userId],
			);
			await admin.query(
				"insert into organization_mfa_window (organization_id,user_id,starts_at,grace_period_days,deadline) values ($1,$2,now()-interval '1 day',0,now()-interval '1 hour') on conflict (organization_id,user_id) do update set starts_at=excluded.starts_at,grace_period_days=0,deadline=excluded.deadline",
				[subject.organizationId, subject.userId],
			);
		}
		const observedDenied = await observation.createContext(
			browser,
			inputs.fixture.origin,
		);
		observedContexts.push(observedDenied);
		const context = observedDenied.context;
		await prepareFixtureBrowserContext(context, inputs.fixture.origin);
		if (scenario !== "signed-out") await context.setCookie(...admittedCookies);
		const page = observedDenied.page;
		await page.setViewport(
			viewport === "desktop"
				? { width: 1280, height: 900 }
				: { width: 390, height: 844, isMobile: true, hasTouch: true },
		);
		await page.setExtraHTTPHeaders({ "x-z8-fixture-replica": "a" });
		// Inspect a real protected document response before following its redirect.
		// Chrome may omit redirect bodies from responseReceived; native fetch keeps
		// this denial check independent of that browser diagnostic limitation.
		// This context's measured ID is already registered at both native controls.
		// A signed-out denial may legitimately perform no SQL and emit no PG row;
		// its acceptance is the paired closure + exact whole-run oracle, not an
		// invented per-request five-flag metric for a zero-query response.
		const nodeTrace = observedDenied.traceIds[1];
		const headers = {
			"x-z8-fixture-replica": "a",
			traceparent: `00-${nodeTrace}-${randomBytes(8).toString("hex")}-01`,
		};
		if (scenario !== "signed-out")
			headers.Cookie = admittedCookies
				.map((cookie) => `${cookie.name}=${cookie.value}`)
				.join("; ");
		// Check the original authenticated cookies before challenge UI can alter selection.
		const directClock = await fetch(
			`${inputs.fixture.origin}/api/time-entries/status`,
			{ headers, redirect: "manual", signal: AbortSignal.timeout(15000) },
		);
		let directClockBody;
		try {
			directClockBody = await directClock.json();
		} catch {
			directClockBody = null;
		}
		result.directClockResponse = {
			status: directClock.status,
			json: directClockBody !== null,
			hasEmployee: directClockBody?.hasEmployee === true,
			employeeIdMaterialized: typeof directClockBody?.employeeId === "string",
			clockStateField: typeof directClockBody?.isClockedIn === "boolean",
			activePeriodMaterialized: Boolean(directClockBody?.activeWorkPeriod),
			errorField: typeof directClockBody?.error === "string",
			noActiveOrganization: directClockBody?.error === "No active organization",
		};
		const document = await fetch(`${inputs.fixture.origin}/en`, {
			redirect: "manual",
			headers,
			signal: AbortSignal.timeout(15000),
		});
		const body = await document.text();
		assert(
			document.headers.get("x-z8-fixture-instance") === "a",
			"Denied document bypassed the selected owned proxy backend.",
		);
		result.document = {
			status: document.status,
			bytes: Buffer.byteLength(body),
			cacheControl: document.headers.get("cache-control"),
			contentEncoding: document.headers.get("content-encoding"),
			contentType: document.headers.get("content-type"),
			protectedContentSeen:
				/data-widget-id=|data-clock-status=|"initialSnapshot":/.test(body),
		};
		await page.goto(`${inputs.fixture.origin}/en`, {
			waitUntil: "domcontentloaded",
			timeout: 45000,
		});
		await pause(250);
		const dom = await readDashboardDom(page);
		result.protectedContentEmitted =
			dom.protectedContent || result.document.protectedContentSeen;
		result.redirected = new URL(page.url()).pathname !== "/en";
		const expectedPath =
			scenario === "mfa" ? "/en/mfa" : scenario === "sso" ? "/en/init" : null;
		assert(
			!expectedPath || new URL(page.url()).pathname === expectedPath,
			"Admission did not reach its expected challenge.",
		);
		const deniedClock = await page.evaluate(async () => {
			const response = await fetch("/api/time-entries/status", {
				cache: "no-store",
			});
			let body;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			return {
				status: response.status,
				redirected: response.redirected,
				json: body !== null,
				hasEmployeeField: Boolean(body && "hasEmployee" in body),
				hasEmployee: body?.hasEmployee === true,
				employeeIdMaterialized: typeof body?.employeeId === "string",
				clockStateField: typeof body?.isClockedIn === "boolean",
				clockedIn: body?.isClockedIn === true,
				activePeriodMaterialized: Boolean(body?.activeWorkPeriod),
				failureEnvelope: body?.success === false,
				errorField: typeof body?.error === "string",
			};
		});
		result.clockResponse = deniedClock;
		result.clockStatusDenied = clockAdmissionDenied(
			result.allowedClockResponse,
			result.directClockResponse,
			deniedClock,
		);
		result.clockStatusHttpStatus = deniedClock.status;
		result.applicationPassed =
			!result.protectedContentEmitted &&
			result.redirected &&
			result.clockStatusDenied;
		assert(
			result.applicationPassed,
			"Denied admission emitted protected data or enabled the clock.",
		);
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		if (observation)
			await finishObservation(
				observation,
				observedContexts,
				measuredVisits,
				result,
			);
		await browser?.close().catch(() => {});
		try {
			await saveIngressEvidence(
				join(directory, `ingress-admission-${viewport}-${scenario}.json`),
				result,
			);
		} finally {
			try {
				if (touched) await restoreVariant(inputs, directory);
			} finally {
				await inputs.admin.end();
			}
		}
	}
	assert(
		result.passed,
		"Admission V2 native or strict transport proof did not reconcile.",
	);
	return result;
}

async function main() {
	const [
		command,
		directory,
		source,
		viewport,
		mode,
		scenario,
		actor,
		diagnostic,
	] = process.argv.slice(2);
	if (!directory || !["plan", "run", "restore", "admission"].includes(command))
		throw new Error(
			"Use plan|run|restore|admission DIRECTORY EXPECTED_SOURCE [desktop|mobile MODE SCENARIO ACTOR].",
		);
	if (command === "plan")
		console.log(
			JSON.stringify(
				(await ingressPlan(resolve(directory), source)).publicPlan,
			),
		);
	else if (command === "restore") {
		const inputs = await runtimeInputs(
			resolve(directory),
			source,
			viewport || "small-employee",
		);
		try {
			await restoreVariant(inputs, resolve(directory));
			console.log("Owned ingress variant restored.");
		} finally {
			await inputs.admin.end();
		}
	} else if (command === "admission") {
		const result = await runAdmission(
			resolve(directory),
			source,
			mode,
			viewport,
			scenario || "small-employee",
		);
		console.log(
			JSON.stringify({
				passed: result.passed,
				scenario: result.scenario,
				viewport: result.viewport,
				productionTopologyVerified: false,
				cdnVerified: false,
			}),
		);
	} else {
		const result = await runIngress(
			resolve(directory),
			source,
			viewport,
			mode,
			scenario,
			actor,
			diagnostic ?? null,
		);
		console.log(
			JSON.stringify({
				passed: result.passed,
				scenario: result.scenario,
				viewport: result.viewport,
				mode: result.mode,
				productionTopologyVerified: false,
				cdnVerified: false,
			}),
		);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch(async (error) => {
		const directory = process.argv[3];
		if (directory)
			await writeFile(
				join(resolve(directory), "ingress-error-private.txt"),
				error?.stack ?? String(error),
				{ mode: 0o600 },
			).catch(() => {});
		console.error(
			"Ingress experiment refused or failed; private diagnostics retained. No runtime acceptance claimed.",
		);
		process.exitCode = 1;
	});
}
