/** Finite operator acceptance stages. Captured HTTP data and tenant IDs never leave RAM. */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ingressPlan } from "./ingress-stream-probe.mjs";
import { openMultiInstanceAnalytics } from "./multi-instance-probe.mjs";

const readers = ["work", "team", "overtime"];
const stages = [
	"fill",
	"mutation",
	"scope",
	"expiry",
	"concurrency",
	"interactive-clock",
	"outage",
	"restart",
];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const check = (condition, message) => {
	if (!condition) throw new Error(message);
};
const save = (path, value) =>
	writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
const processOutput = (...args) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

export async function multiInstanceSuitePlan(directory, source) {
	const { fixture, publicPlan } = await ingressPlan(directory, source);
	return {
		fixture,
		publicPlan: {
			sourceBuild: publicPlan.sourceBuild,
			readers,
			stages,
			concurrentRequestsPerReplica: 8,
			maximumConcurrentComputations: 2,
			expiryWaitMs: 62000,
			restartHandshakeMaximumMs: 45000,
			cacheBytesPerReplica: 52428800,
			clockHelper: "public-header-clock.mjs (#1475)",
			runtimeVerified: false,
			productionTopologyVerified: false,
		},
	};
}

async function inputs(directory, source) {
	const plan = await multiInstanceSuitePlan(directory, source),
		f = plan.fixture;
	check(
		f.prepared &&
			f.containers.includes(f.postgres) &&
			f.containers.includes(f.proxy),
		"Owned fixture preparation is required.",
	);
	for (const container of f.containers)
		check(
			processOutput(
				"inspect",
				"--format",
				'{{ index .Config.Labels "z8.agent-owned" }}',
				container,
			) === f.label,
			"Actual service ownership mismatch.",
		);
	const port = processOutput(
		"inspect",
		"--format",
		'{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
		f.postgres,
	);
	check(
		port === String(f.env.POSTGRES_PORT),
		"Database port does not belong to this fixture.",
	);
	const text = await readFile(
		join(f.artifactApp, ".next/required-server-files.json"),
	);
	check(
		createHash("sha256").update(text).digest("hex") ===
			f.artifactManifestSha256 &&
			(await readFile(join(f.artifactApp, ".next/BUILD_ID"), "utf8")).trim() ===
				f.artifactBuildId,
		"The frozen compiled artifact changed.",
	);
	const people = await json(join(directory, "fixture-private.json"));
	check(people.kind === "disposable", "Only synthetic actors are permitted.");
	for (const replica of ["a", "b"]) {
		const response = await fetch(`${f.origin}/api/app-version`, {
			headers: { "x-z8-fixture-replica": replica },
			signal: AbortSignal.timeout(5000),
		});
		const version = await response.json();
		check(
			response.ok &&
				response.headers.get("x-z8-fixture-instance") === replica &&
				/^[a-f0-9]{7,40}$/.test(version.buildHash ?? "") &&
				publicPlanSource(plan).startsWith(version.buildHash),
			"Actual replica build/routing did not match the frozen source.",
		);
	}
	const require = createRequire(join(f.artifactApp, "package.json"));
	const { Pool } = require("pg");
	const pool = new Pool({
		host: "127.0.0.1",
		port: Number(port),
		database: f.env.POSTGRES_DB,
		user: f.env.POSTGRES_USER || "postgres",
		password: f.env.POSTGRES_PASSWORD,
		max: 1,
		connectionTimeoutMillis: 5000,
		query_timeout: 5000,
		application_name: "z8_multi_acceptance_1472",
	});
	return { ...plan, people, pool };
}

const publicPlanSource = (plan) => plan.publicPlan.sourceBuild;

/** Stages are intentionally separate so the parent can schedule restarts and clock probes. */
export async function runMultiInstanceStage(stage, directory, source) {
	check(stages.includes(stage), "Choose a finite declared stage.");
	directory = resolve(directory);
	const { fixture, publicPlan, people, pool } = await inputs(directory, source);
	const probes = [],
		observations = [];
	const actor = (name) => people.actors[name];
	const open = async (kind = "team", name = "large-admin") => {
		const probe = await openMultiInstanceAnalytics(directory, {
			kind,
			actor: name,
		});
		probes.push(probe);
		return probe;
	};
	const resources = async () =>
		Object.fromEntries(
			await Promise.all(
				["a", "b"].map(async (replica) => {
					const row = await json(
						join(directory, `replica-${replica}-metrics.json`),
					);
					check(
						row.installed && row.sourceBuild === fixture.sourceBuild,
						"The real replica observer must be installed on the frozen build.",
					);
					const {
						pid: _pid,
						sourceBuild: _source,
						backend: _backend,
						...numeric
					} = row;
					return [replica, numeric];
				}),
			),
		);
	const record = (name, kind, result) =>
		observations.push({
			stage: name,
			kind,
			replica: result.replica,
			concurrency: result.concurrency,
			equivalent: result.equivalent,
			summary: result.summary,
			elapsedMs: result.elapsedMs,
			metrics: result.metrics,
		});
	const fresh = async (name = "large-admin") => {
		const person = actor(name);
		const result = await pool.query(
			'update "user" u set name=u.name from employee e where e.user_id=u.id and e.id=$1 and e.organization_id=$2 returning u.id',
			[person.employeeId, person.organizationId],
		);
		check(
			result.rowCount === 1,
			"Synthetic actor revision change was not unique.",
		);
	};
	const baseline = (kind, result, count = 200) => {
		check(
			result.summary.success && result.equivalent,
			"Equivalent successful reader results required.",
		);
		if (kind === "overtime")
			check(
				result.summary.seriesOvertime === 0,
				"Literal baseline overtime must be zero.",
			);
		else
			check(
				result.summary.employees === count &&
					result.summary.totalHours === count * 2088,
				"Literal annual employee/hours fixture changed.",
			);
	};
	const outcome = (result, expected) =>
		check(
			result.metrics.hits === (expected === "hit" ? 1 : 0) &&
				result.metrics.misses === (expected === "miss" ? 1 : 0),
			"Actual native cache outcome differs from this stage's expectation.",
		);
	const read = async (probe, replica, name, expected, options) => {
		const result = await probe.replay(replica, options);
		if (expected) outcome(result, expected);
		record(name, probe.kind, result);
		return result;
	};
	const payloadIds = (kind, result) =>
		(kind === "work"
			? result.payload.data.byEmployee
			: result.payload.data.teams.flatMap((team) => team.employees)
		)
			.map((row) => row.employeeId)
			.sort();
	const warmBoth = async (probe) => {
		for (const replica of ["a", "b"])
			await read(probe, replica, "prepared-warm", undefined);
	};
	let before;
	try {
		before = await resources();
		if (stage === "fill") {
			for (const kind of readers) {
				const probe = await open(kind);
				await fresh();
				for (const replica of ["a", "b"]) {
					baseline(
						kind,
						await read(probe, replica, "independent-fill", "miss"),
					);
					baseline(
						kind,
						await read(probe, replica, "independent-repeat", "hit"),
					);
				}
				// Same captured public request, different effective user and tenant; parameters stay unchanged.
				for (const [name, count] of [
					["small-admin", 8],
					["large-manager", 99],
					["large-admin", 200],
				]) {
					for (const replica of ["a", "b"]) {
						const result = await read(
							probe,
							replica,
							`effective-session-${name}`,
							undefined,
							{ cookies: probe.auth[name].cookies },
						);
						baseline(kind, result, count);
					}
				}
			}
		}
		if (stage === "expiry") {
			for (const kind of readers) {
				const probe = await open(kind);
				await fresh();
				await warmBoth(probe);
				const warmed = performance.now();
				await pause(31000);
				await pause(31000);
				check(
					performance.now() - warmed >= 62000,
					"Expiry must use real elapsed time.",
				);
				for (const replica of ["a", "b"]) {
					baseline(
						kind,
						await read(probe, replica, "expired-after-62s", "miss"),
					);
					baseline(
						kind,
						await read(probe, replica, "post-expiry-repeat", "hit"),
					);
				}
			}
		}
		if (stage === "concurrency") {
			for (const kind of readers) {
				const probe = await open(kind);
				await fresh();
				const cold = [],
					warm = [];
				for (const replica of ["a", "b"]) {
					cold.push(await read(probe, replica, "single-cold-control", "miss"));
					warm.push(await read(probe, replica, "single-warm-control", "hit"));
				}
				await fresh();
				const concurrent = await Promise.all(
					["a", "b"].map((replica) =>
						read(probe, replica, "eight-simultaneous-per-node", undefined, {
							concurrency: 8,
						}),
					),
				);
				check(
					concurrent.reduce((sum, row) => sum + row.metrics.misses, 0) === 2,
					"At most one native computation per process is required.",
				);
				for (let index = 0; index < concurrent.length; index++) {
					baseline(kind, concurrent[index]);
					check(
						concurrent[index].metrics.queries <=
							cold[index].metrics.queries + 7 * warm[index].metrics.queries &&
							concurrent[index].metrics.rows <=
								cold[index].metrics.rows + 7 * warm[index].metrics.rows,
						"Concurrent source work exceeds one cold computation plus eight fresh admission paths per process.",
					);
				}
			}
		}
		if (stage === "interactive-clock") {
			// The #1475 helper owns visible control selection, single-submit writes and unknown-outcome resolution.
			const { openPublicHeaderClock } = await import(
				"./public-header-clock.mjs"
			);
			const active = [];
			for (const kind of readers) active.push(await open(kind));
			const person = actor("small-employee"),
				primary = active[0];
			check(
				person.organizationId !== actor("large-admin").organizationId,
				"Clock actor must be in the independent synthetic tenant.",
			);
			const context = await primary.browser.createBrowserContext();
			let clock;
			try {
				await context.setCookie(...primary.auth["small-employee"].cookies);
				const permissions = await primary.browser.target().createCDPSession();
				await permissions.send("Browser.setPermission", {
					permission: { name: "notifications" },
					setting: "denied",
					origin: fixture.origin,
					browserContextId: context.id,
				});
				const page = await context.newPage();
				await page.setViewport({ width: 1280, height: 900 });
				await page.emulateTimezone("Europe/Berlin");
				let commandTrace,
					pendingResponses = 0,
					overlapped = false,
					actualClockReplica;
				page.on("response", (response) => {
					if (
						new URL(response.url()).pathname === "/api/time-clock" &&
						response.request().method() === "POST"
					)
						actualClockReplica = response.headers()["x-z8-fixture-instance"];
				});
				await page.setRequestInterception(true);
				page.on("request", (request) => {
					const headers = { ...request.headers() },
						url = new URL(request.url());
					if (url.origin === fixture.origin) {
						headers["x-z8-fixture-replica"] = "b";
						if (
							url.pathname === "/api/time-clock" &&
							request.method() === "POST" &&
							commandTrace
						) {
							headers.traceparent = `00-${commandTrace}-${randomBytes(8).toString("hex")}-01`;
							overlapped = pendingResponses > 0;
						}
					}
					request.continue({ headers }).catch(() => {});
				});
				clock = await openPublicHeaderClock(page, {
					origin: fixture.origin,
					expectedActor: {
						email: person.email,
						organizationId: person.organizationId,
					},
					timeoutMs: 30000,
				});
				for (const probe of active)
					for (const loaded of [false, true])
						for (const action of ["in", "out"]) {
							const prepared = await clock.prepare(action);
							commandTrace = randomBytes(16).toString("hex");
							overlapped = false;
							actualClockReplica = undefined;
							if (loaded) await fresh();
							pendingResponses = loaded ? 2 : 0;
							const load = loaded
								? Promise.all(
										["a", "b"].map((replica) =>
											read(
												probe,
												replica,
												"clock-overlap-analytics",
												undefined,
												{
													concurrency: 8,
													onResponse: () => {
														pendingResponses--;
													},
												},
											),
										),
									)
								: Promise.resolve([]);
							load.catch(() => {});
							const result = await prepared.submit();
							const loadResults = await load;
							const metrics = await primary.observeMetrics(commandTrace);
							observations.push({
								stage: loaded
									? "real-clock-under-two-node-load"
									: "real-clock-control",
								kind: probe.kind,
								action,
								replica: "b",
								actualReplicaVerified: actualClockReplica === "b",
								...result,
								requestsInFlightAtCommandDispatch: overlapped,
								metrics,
							});
							check(
								result.success &&
									actualClockReplica === "b" &&
									!result.unknownCommandOutcome &&
									metrics.hits === 0 &&
									metrics.misses === 0,
								"Operational clock must succeed without using the derived analytics cache.",
							);
							if (loaded) {
								check(
									overlapped &&
										loadResults.reduce(
											(sum, row) => sum + row.metrics.misses,
											0,
										) === 2,
									"The actual clock command must overlap two bounded independent cold fills.",
								);
								for (const row of loadResults) baseline(probe.kind, row);
							}
						}
			} finally {
				if (clock) {
					try {
						// Resolve an uncertain outcome first. Never retry the same write.
						if ((await clock.resolveState()) === "in") {
							const cleanup = await (await clock.prepare("out")).submit();
							check(
								cleanup.success,
								"Own synthetic clock session cleanup was not accepted.",
							);
						}
					} finally {
						clock.dispose();
					}
				}
				await context.close();
			}
		}
		if (stage === "mutation") {
			const active = [];
			for (const kind of readers) active.push(await open(kind));
			const other = await open("team", "small-admin");
			const person = actor("large-admin"),
				category = randomUUID(),
				assignment = randomUUID();
			let holiday;
			try {
				await pool.query(
					"insert into holiday_category (id,organization_id,type,name,exclude_from_calculations,updated_at) values ($1,$2,'company_holiday','Synthetic multi consistency',true,now())",
					[category, person.organizationId],
				);
				const created = await active[1].page.evaluate(async (categoryId) => {
					const response = await fetch("/api/org-admin/holidays", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-z8-fixture-replica": "a",
						},
						credentials: "same-origin",
						body: JSON.stringify({
							name: "Synthetic multi consistency",
							categoryId,
							startDate: "2025-01-06T00:00:00Z",
							endDate: "2025-01-06T23:59:59.999Z",
							recurrenceType: "none",
						}),
					});
					return {
						status: response.status,
						by: response.headers.get("x-z8-fixture-instance"),
						body: await response.json(),
					};
				}, category);
				holiday = created.body.holiday?.id;
				check(
					created.status === 201 && created.by === "a" && holiday,
					"Actual public holiday creation on A was not accepted.",
				);
				const user = (
					await pool.query(
						"select user_id from employee where id=$1 and organization_id=$2",
						[person.employeeId, person.organizationId],
					)
				).rows[0].user_id;
				await pool.query(
					"insert into holiday_assignment (id,holiday_id,organization_id,assignment_type,created_by,updated_at) values ($1,$2,$3,'organization',$4,now())",
					[assignment, holiday, person.organizationId, user],
				);
				// Fixture-only assignment is setup; the following actual accepted DELETE is the write under test.
				for (const probe of active)
					for (const replica of ["a", "b"]) {
						const result = await read(
							probe,
							replica,
							"assigned-holiday-precondition",
							"miss",
						);
						check(result.summary.success, "Holiday precondition read failed.");
						if (probe.kind === "team")
							check(
								result.summary.expected === 416000 &&
									result.summary.variance === 1600,
								"Literal assigned-holiday expected hours changed.",
							);
						if (probe.kind === "work")
							check(
								result.summary.overtime === 1600,
								"Literal assigned-holiday protected balance changed.",
							);
						if (probe.kind === "overtime")
							check(
								result.summary.seriesOvertime === 1600,
								"Literal assigned-holiday series changed.",
							);
					}
				await fresh("small-admin");
				await warmBoth(other);
				const started = performance.now();
				const removed = await active[1].page.evaluate(async (id) => {
					const response = await fetch(`/api/org-admin/holidays/${id}`, {
						method: "DELETE",
						credentials: "same-origin",
						headers: { "x-z8-fixture-replica": "a" },
					});
					return {
						status: response.status,
						by: response.headers.get("x-z8-fixture-instance"),
					};
				}, holiday);
				check(
					removed.status === 200 && removed.by === "a",
					"Actual public holiday DELETE on A was not accepted.",
				);
				for (const probe of active) {
					const result = await read(
						probe,
						"b",
						"accepted-delete-A-read-B-before-TTL",
						"miss",
					);
					baseline(probe.kind, result);
					if (probe.kind === "team")
						check(
							result.summary.expected === 417600 &&
								result.summary.variance === 0,
							"B did not use committed deletion before TTL.",
						);
					if (probe.kind === "work")
						check(
							result.summary.overtime === 0 && result.summary.undertime === 0,
							"B retained the deleted holiday balance.",
						);
					outcome(await read(probe, "b", "changed-B-repeat", "hit"), "hit");
				}
				check(
					performance.now() - started < 60000,
					"Cross-instance proof exceeded TTL and cannot prove immediate consistency.",
				);
				for (const replica of ["a", "b"])
					baseline(
						"team",
						await read(other, replica, "unrelated-tenant-retained", "hit"),
						8,
					);
			} finally {
				await pool.query(
					"delete from holiday_assignment where id=$1 and organization_id=$2",
					[assignment, person.organizationId],
				);
				if (holiday)
					await pool.query(
						"delete from holiday where id=$1 and organization_id=$2",
						[holiday, person.organizationId],
					);
				await pool.query(
					"delete from holiday_category where id=$1 and organization_id=$2",
					[category, person.organizationId],
				);
			}
		}
		if (stage === "scope") {
			const person = actor("large-manager");
			const assignments = (
				await pool.query(
					"select m.* from employee_managers m join employee e on e.id=m.employee_id where m.manager_id=$1 and e.organization_id=$2 and e.is_active=true order by m.employee_id",
					[person.employeeId, person.organizationId],
				)
			).rows;
			const ids = assignments.map((row) => row.employee_id).sort();
			check(
				ids.length > 1 && ids.length < 200,
				"Fixture manager assignment restriction required.",
			);
			const active = [];
			for (const kind of readers) {
				const probe = await open(kind, "large-manager");
				active.push(probe);
				await warmBoth(probe);
			}
			const removed = assignments[0];
			let deleted = false,
				downgraded = false;
			const role = randomUUID();
			let roleAdded = false;
			try {
				await pool.query(
					"delete from employee_managers where id=$1 and manager_id=$2",
					[removed.id, person.employeeId],
				);
				deleted = true;
				const expected = ids.filter((id) => id !== removed.employee_id);
				for (const probe of active) {
					const result = await read(
						probe,
						"b",
						"assignment-reduced-current-B-scope",
						"miss",
					);
					baseline(probe.kind, result, expected.length);
					if (probe.kind !== "overtime")
						check(
							JSON.stringify(payloadIds(probe.kind, result)) ===
								JSON.stringify(expected),
							"B leaked a removed manager assignment.",
						);
				}
				const admin = actor("large-admin");
				const user = (
					await pool.query(
						"select user_id from employee where id=$1 and organization_id=$2",
						[admin.employeeId, admin.organizationId],
					)
				).rows[0].user_id;
				await pool.query(
					"insert into custom_role (id,organization_id,name,base_tier,created_by,updated_at) values ($1,$2,'Synthetic multi grant','manager',$3,now())",
					[role, person.organizationId, user],
				);
				roleAdded = true;
				await pool.query(
					"insert into custom_role_permission (custom_role_id,action,subject) values ($1,'read','Report')",
					[role],
				);
				await pool.query(
					"insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)",
					[person.employeeId, role, user],
				);
				for (const probe of active)
					await read(probe, "b", "additive-grant-current-scope", "miss");
				await pool.query(
					"delete from custom_role_permission where custom_role_id=$1",
					[role],
				);
				for (const probe of active)
					baseline(
						probe.kind,
						await read(probe, "b", "grant-reduced-current-scope", "miss"),
						expected.length,
					);
				await pool.query(
					"update employee set role='employee' where id=$1 and organization_id=$2 and role='manager'",
					[person.employeeId, person.organizationId],
				);
				downgraded = true;
				const beforeDenied = await resources();
				for (const probe of active) {
					const result = await read(
						probe,
						"b",
						"base-role-reduced-denied-before-get",
						undefined,
					);
					check(
						result.summary.denied &&
							result.metrics.hits === 0 &&
							result.metrics.misses === 0,
						"Role reduction did not deny before cache.",
					);
				}
				const afterDenied = await resources();
				check(
					afterDenied.b.gets === beforeDenied.b.gets,
					"Denied actor reached the native handler.",
				);
			} finally {
				if (downgraded)
					await pool.query(
						"update employee set role='manager' where id=$1 and organization_id=$2",
						[person.employeeId, person.organizationId],
					);
				if (roleAdded) {
					await pool.query(
						"delete from employee_custom_role where employee_id=$1 and custom_role_id=$2",
						[person.employeeId, role],
					);
					await pool.query(
						"delete from custom_role_permission where custom_role_id=$1",
						[role],
					);
					await pool.query(
						"delete from custom_role where id=$1 and organization_id=$2",
						[role, person.organizationId],
					);
				}
				if (deleted)
					await pool.query(
						"insert into employee_managers (id,employee_id,manager_id,is_primary,assigned_by,assigned_at,created_at) values ($1,$2,$3,$4,$5,$6,$7)",
						[
							removed.id,
							removed.employee_id,
							removed.manager_id,
							removed.is_primary,
							removed.assigned_by,
							removed.assigned_at,
							removed.created_at,
						],
					);
			}
			for (const probe of active) {
				const result = await read(probe, "b", "scope-restored", "miss");
				baseline(probe.kind, result, ids.length);
				if (probe.kind !== "overtime")
					check(
						JSON.stringify(payloadIds(probe.kind, result)) ===
							JSON.stringify(ids),
						"Exact manager scope was not restored.",
					);
			}
		}
		if (stage === "outage") {
			const probe = await open("work");
			await fresh();
			await warmBoth(probe);
			const warm = await read(probe, "a", "healthy-control", "hit"),
				state = await resources();
			const flag = join(directory, "fault-a.enabled");
			let flagCreated = false;
			try {
				await writeFile(flag, "isolated operator native-get fault", {
					flag: "wx",
					mode: 0o600,
				});
				flagCreated = true;
				await pause(250);
				const result = await read(
					probe,
					"a",
					"eight-isolated-cache-errors",
					undefined,
					{ concurrency: 8 },
				);
				check(
					result.summary.cacheError &&
						result.equivalent &&
						result.metrics.queries <= 8 * warm.metrics.queries &&
						result.metrics.rows <= 8 * warm.metrics.rows,
					"Cache outage caused raw recomputation or unbounded errors.",
				);
				const failed = await resources();
				check(
					failed.a.faults - state.a.faults === 8,
					"Eight real native get faults required.",
				);
				baseline(
					"work",
					await read(probe, "b", "B-healthy-during-A-fault", "hit"),
				);
				const denied = await read(
					probe,
					"a",
					"denied-before-failed-handler",
					undefined,
					{ cookies: probe.auth["large-restricted"].cookies },
				);
				check(
					denied.summary.denied &&
						denied.metrics.hits === 0 &&
						denied.metrics.misses === 0 &&
						(await resources()).a.faults === failed.a.faults,
					"Unauthorized request reached failing cache.",
				);
			} finally {
				if (flagCreated)
					await unlink(flag).catch((error) => {
						if (error.code !== "ENOENT") throw error;
					});
			}
			baseline(
				"work",
				await read(probe, "a", "fault-removed-recovery", "hit", {
					cookies: probe.auth["large-admin"].cookies,
				}),
			);
		}
		if (stage === "restart") {
			const probe = await open("team");
			await fresh();
			await warmBoth(probe);
			const old = await json(join(directory, "replica-a-control-private.json"));
			const ready = {
				phase: "ready-for-parent-restart-A-only",
				sourceBuild: fixture.sourceBuild,
				artifactBuildId: fixture.artifactBuildId,
				maximumMs: 45000,
			};
			await save(join(directory, "restart-handshake.json"), ready);
			console.log(JSON.stringify(ready));
			const started = performance.now();
			let changed = false;
			while (performance.now() - started < 45000) {
				await pause(250);
				const control = await json(
					join(directory, "replica-a-control-private.json"),
				);
				if (
					control.pid !== old.pid &&
					control.sourceBuild === fixture.sourceBuild
				) {
					try {
						const response = await fetch(`${fixture.origin}/api/app-version`, {
							headers: { "x-z8-fixture-replica": "a" },
							signal: AbortSignal.timeout(1000),
						});
						const version = await response.json();
						if (
							response.ok &&
							response.headers.get("x-z8-fixture-instance") === "a" &&
							/^[a-f0-9]{7,40}$/.test(version.buildHash ?? "") &&
							publicPlan.sourceBuild.startsWith(version.buildHash)
						) {
							changed = true;
							break;
						}
					} catch {}
				}
			}
			check(
				changed,
				"Parent did not restart A with the same frozen artifact within the finite handshake window.",
			);
			baseline("team", await read(probe, "a", "restarted-A-cold", "miss"));
			baseline("team", await read(probe, "b", "unrestarted-B-survives", "hit"));
			check(
				performance.now() - started < 60000,
				"Restart survival evidence exceeded TTL.",
			);
			await save(join(directory, "restart-handshake.json"), {
				...ready,
				phase: "completed",
				runtimeVerified: true,
			});
		}
		const report = {
			stage,
			sourceBuild: publicPlan.sourceBuild,
			artifactBuildId: fixture.artifactBuildId,
			configuredCacheBytesPerReplica: publicPlan.cacheBytesPerReplica,
			maximumConcurrentComputations: 2,
			resourcesBefore: before,
			resourcesAfter: await resources(),
			observations,
			runtimeVerified: true,
			productionTopologyVerified: false,
		};
		await save(join(directory, `multi-${stage}-metrics.json`), report);
		console.log(
			JSON.stringify({
				stage,
				observations: observations.length,
				runtimeVerified: true,
			}),
		);
		return report;
	} finally {
		await Promise.allSettled(probes.map((probe) => probe.close()));
		await pool.end();
	}
}

async function main() {
	const [stage, directory, source] = process.argv.slice(2);
	if (stage === "plan") {
		console.log(
			JSON.stringify(
				(await multiInstanceSuitePlan(directory, source)).publicPlan,
			),
		);
		return;
	}
	await runMultiInstanceStage(stage, directory, source);
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch(() => {
		console.error(
			"Multi-instance stage failed; raw requests, identities and records were not exported.",
		);
		process.exitCode = 1;
	});
