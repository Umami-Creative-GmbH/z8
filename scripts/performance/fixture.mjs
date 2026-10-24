#!/usr/bin/env node
/** Label-owned local services only. No .env/Phase configuration is read or copied. */
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticateFixture } from "./fixture-auth.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const app = join(root, "apps/webapp");
const [command, inputDirectory, ...args] = process.argv.slice(2);
const label = "z8-performance-fixture-1450";
const docker = (...args) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const save = (path, value) =>
	writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const pnpm = process.env.npm_execpath;
// The caller may use Phase for normal dev tooling; every service used by this fixture is overridden locally.
const toolEnvironment = Object.fromEntries(
	Object.entries(process.env).filter(([name]) =>
		/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|NODE_OPTIONS|SWC_NATIVE_BINDING_CACHE)$/i.test(
			name,
		),
	),
);
const isolatedEnv = (env) =>
	Object.fromEntries(
		Object.entries({
			...toolEnvironment,
			...env,
			TELEMETRY_ENABLED: "false",
			BILLING_ENABLED: "false",
			SKIP_ENV_VALIDATION: "0",
			REDIS_COMMAND_TIMEOUT_MS: env.REDIS_COMMAND_TIMEOUT_MS || "2000",
			CIRCLE_NODE_TOTAL: env.CIRCLE_NODE_TOTAL || "3",
			POSTHOG_API_KEY: "",
			POSTHOG_PROJECT_ID: "",
			NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "",
			NEXT_PUBLIC_POSTHOG_HOST: "",
			OTEL_EXPORTER_OTLP_ENDPOINT: "",
			OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
			OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
			SMTP_HOST: "",
			SMTP_USERNAME: "",
			SMTP_PASSWORD: "",
			RESEND_API_KEY: "",
			EMAIL_PROVIDER: "",
			ENABLE_CRON_JOBS: "false",
			VAULT_ADDR: "",
			VAULT_TOKEN: "",
			SCALEWAY_ACCESS_KEY: "",
			SCALEWAY_SECRET_KEY: "",
			S3_PRIVATE_BUCKET: env.S3_PUBLIC_BUCKET,
			S3_PRIVATE_ACCESS_KEY_ID: env.S3_PUBLIC_ACCESS_KEY_ID,
			S3_PRIVATE_SECRET_ACCESS_KEY: env.S3_PUBLIC_SECRET_ACCESS_KEY,
			S3_PRIVATE_ENDPOINT: env.S3_PUBLIC_ENDPOINT,
			S3_PRIVATE_REGION: env.S3_PUBLIC_REGION,
			S3_PRIVATE_FORCE_PATH_STYLE: "true",
		}).filter(([, value]) => value !== "" && value !== undefined),
	);
const run = (args, env, log) =>
	new Promise((done, reject) => {
		if (!pnpm) throw new Error("Run this command through pnpm.");
		const child = spawn(pnpm, ["--config.verifyDepsBeforeRun=false", ...args], {
			cwd: app,
			env: isolatedEnv(env),
			stdio: ["ignore", log, log],
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? done()
				: reject(
						new Error("Fixture command failed; inspect private runtime.log."),
					),
		);
	});

async function unusedPort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}

async function prepare(directory) {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const suffix = randomBytes(6).toString("hex");
	const secret = randomBytes(32).toString("hex");
	const database = `approval_workflow_repository_test_perf_${suffix}`;
	const containers = [];
	await save(join(directory, "services.json"), { label, containers });
	const service = (name, port, image, environment, extra = []) => {
		const container = `z8_perf_${suffix}_${name}`;
		docker(
			"run",
			"--detach",
			"--name",
			container,
			"--label",
			`z8.agent-owned=${label}`,
			"--publish",
			`127.0.0.1::${port}`,
			...Object.entries(environment).flatMap(([key, value]) => [
				"--env",
				`${key}=${value}`,
			]),
			image,
			...extra,
		);
		containers.push(container);
		return container;
	};
	// Each image's actual ID is retained as public runtime metadata, not inferred from a mutable tag.
	try {
		const postgres = service("postgres", 5432, "postgres:16", {
			POSTGRES_PASSWORD: secret,
		});
		await save(join(directory, "services.json"), { label, containers });
		const redis = service("redis", 6379, "valkey/valkey:9-alpine", {}, [
			"valkey-server",
			"--save",
			"",
			"--appendonly",
			"no",
		]);
		await save(join(directory, "services.json"), { label, containers });
		const storage = service("storage", 9000, "rustfs/rustfs:latest", {
			RUSTFS_ROOT_USER: "fixture-access",
			RUSTFS_ROOT_PASSWORD: secret,
			RUSTFS_VOLUMES: "/data",
			RUSTFS_CONSOLE_ENABLE: "false",
		});
		await save(join(directory, "services.json"), { label, containers });
		const port = (container, internal) =>
			docker(
				"inspect",
				"--format",
				`{{(index (index .NetworkSettings.Ports "${internal}/tcp") 0).HostPort}}`,
				container,
			);
		for (let attempt = 0; ; attempt++) {
			try {
				docker("exec", postgres, "pg_isready", "--username", "postgres");
				break;
			} catch {
				if (attempt >= 59)
					throw new Error("Fixture PostgreSQL did not become ready.");
				await pause(500);
			}
		}
		docker("exec", postgres, "createdb", "--username", "postgres", database);
		const appPort = await unusedPort();
		const origin = `http://localhost:${appPort}`;
		const storageOrigin = `http://127.0.0.1:${port(storage, 9000)}`;
		const vapid = generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		}).privateKey.export({ format: "jwk" });
		const env = {
			NODE_ENV: "production",
			TZ: "UTC",
			SKIP_ENV_VALIDATION: "0",
			CIRCLE_NODE_TOTAL: "3",
			BILLING_ENABLED: "false",
			TELEMETRY_ENABLED: "false",
			BETTER_AUTH_SECRET: secret,
			SCIM_CREDENTIAL_HASH_SECRET: randomBytes(32).toString("hex"),
			BETTER_AUTH_URL: origin,
			APP_URL: origin,
			NEXT_PUBLIC_APP_URL: origin,
			POSTGRES_HOST: "127.0.0.1",
			POSTGRES_PORT: port(postgres, 5432),
			POSTGRES_DB: database,
			POSTGRES_USER: "postgres",
			POSTGRES_PASSWORD: secret,
			POSTGRES_SSL_MODE: "disable",
			POSTGRES_POOL_MAX: "10",
			POSTGRES_POOL_MIN: "2",
			APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:${port(postgres, 5432)}/${database}`,
			APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:
				"approval-workflow-repository-test",
			REDIS_HOST: "127.0.0.1",
			REDIS_PORT: port(redis, 6379),
			REDIS_TLS: "false",
			REDIS_COMMAND_TIMEOUT_MS: "2000",
			VAPID_PUBLIC_KEY: Buffer.concat([
				Buffer.from([4]),
				Buffer.from(vapid.x, "base64url"),
				Buffer.from(vapid.y, "base64url"),
			]).toString("base64url"),
			VAPID_PRIVATE_KEY: vapid.d,
			VAPID_SUBJECT: "mailto:fixture@example.test",
			S3_PUBLIC_BUCKET: "performance-fixture",
			S3_PUBLIC_ACCESS_KEY_ID: "fixture-access",
			S3_PUBLIC_SECRET_ACCESS_KEY: secret,
			S3_PUBLIC_ENDPOINT: storageOrigin,
			S3_PUBLIC_REGION: "us-east-1",
			S3_PUBLIC_FORCE_PATH_STYLE: "true",
			S3_PUBLIC_URL: `${storageOrigin}/performance-fixture`,
		};
		await save(join(directory, "runtime-private.json"), {
			env,
			origin,
			port: appPort,
			images: containers.map((container) => ({
				name: container.split("_").at(-1),
				id: docker("inspect", "--format", "{{.Image}}", container),
			})),
		});
		const log = createWriteStream(join(directory, "runtime.log"), {
			mode: 0o600,
		});
		await once(log, "open");
		try {
			await run(
				["exec", "tsx", "scripts/verify-approval-migration-recovery.ts"],
				env,
				log,
			);
			await run(
				[
					"exec",
					"tsx",
					"scripts/performance-fixture.ts",
					"--write-private-manifest",
					join(directory, "fixture-private.json"),
				],
				env,
				log,
			);
		} finally {
			log.end();
		}
		console.log(
			"Owned disposable services and synthetic fixture prepared. Run fixture start, then baseline. Keep this private directory out of artifacts.",
		);
	} catch (error) {
		await save(join(directory, "services.json"), { label, containers });
		await cleanup(directory);
		throw error;
	}
}

async function cleanup(directory) {
	const owned = JSON.parse(
		await readFile(join(directory, "services.json"), "utf8"),
	);
	if (owned.label !== label || !Array.isArray(owned.containers))
		throw new Error("Fixture ownership manifest is invalid.");
	for (const container of owned.containers) {
		if (!/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/.test(container))
			throw new Error("Fixture container name is invalid.");
		let actual;
		try {
			actual = docker(
				"inspect",
				"--format",
				'{{ index .Config.Labels "z8.agent-owned" }}',
				container,
			);
		} catch {
			continue;
		}
		if (actual !== label)
			throw new Error(
				"Refusing to remove a container without the fixture ownership label.",
			);
		docker("rm", "--force", container);
	}
	console.log(
		"Removed verified fixture-owned containers. Private manifests remain local for operator removal.",
	);
}

async function checkRuntime(directory) {
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	await run(
		["exec", "tsx", "scripts/check-performance-runtime.ts"],
		{ ...runtime.env, CI: "false" },
		"inherit",
	);
}

async function upgrade(directory) {
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const vapid = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	}).privateKey.export({ format: "jwk" });
	Object.assign(runtime.env, {
		SKIP_ENV_VALIDATION: "0",
		REDIS_COMMAND_TIMEOUT_MS: "2000",
		CIRCLE_NODE_TOTAL: "3",
	});
	if (!runtime.env.VAPID_PUBLIC_KEY || !runtime.env.VAPID_PRIVATE_KEY)
		Object.assign(runtime.env, {
			VAPID_PUBLIC_KEY: Buffer.concat([
				Buffer.from([4]),
				Buffer.from(vapid.x, "base64url"),
				Buffer.from(vapid.y, "base64url"),
			]).toString("base64url"),
			VAPID_PRIVATE_KEY: vapid.d,
			VAPID_SUBJECT: "mailto:fixture@example.test",
		});
	await save(join(directory, "runtime-private.json"), runtime);
	await run(
		[
			"exec",
			"tsx",
			"scripts/performance-fixture.ts",
			"--upgrade-private-fixture",
			join(directory, "fixture-private.json"),
		],
		runtime.env,
		"inherit",
	);
	await checkRuntime(directory);
	console.log(
		"Fixture version 2 configuration prepared. Existing servers must be restarted deliberately to apply new runtime keys.",
	);
}

async function start(directory) {
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const log = createWriteStream(join(directory, "runtime.log"), {
		flags: "a",
		mode: 0o600,
	});
	await once(log, "open");
	if (args.includes("--build"))
		await run(["run", "build"], { ...runtime.env, CI: "true" }, log);
	await readFile(join(app, ".next/BUILD_ID")); // no dev server or implicit fallback
	const child = spawn(
		process.execPath,
		[
			join(app, "node_modules/next/dist/bin/next"),
			"start",
			"--hostname",
			"127.0.0.1",
			"--port",
			String(runtime.port),
		],
		{
			cwd: app,
			env: isolatedEnv({ ...runtime.env, CI: "false" }),
			stdio: ["ignore", log, log],
			windowsHide: true,
		},
	);
	const stop = () => child.kill();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				const response = await fetch(`${runtime.origin}/en/sign-in`);
				if (response.ok) break;
			} catch {
				/* wait for actual server readiness */
			}
			if (child.exitCode !== null || attempt >= 119)
				throw new Error("Production fixture did not become ready.");
			await pause(500);
		}
		await authenticateFixture(directory);
		console.log(
			`Production fixture ready at ${runtime.origin}. Private authentication is prepared. Stop this command before cleanup.`,
		);
		await new Promise((done, reject) => {
			child.once("exit", (code) =>
				code === 0 || code === null
					? done()
					: reject(new Error("Production fixture exited.")),
			);
			child.once("error", reject);
		});
	} finally {
		stop();
		log.end();
	}
}

async function plan(directory) {
	if (!args[0]) throw new Error("Fixture plan output path required.");
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const fixture = JSON.parse(
		await readFile(join(directory, "fixture-private.json"), "utf8"),
	);
	const toolingBuild = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	const sourceBuild = args.includes("--source-build")
		? args[args.indexOf("--source-build") + 1]
		: null;
	const build = args.includes("--binary-build")
		? args[args.indexOf("--binary-build") + 1]
		: null;
	const routes = [
		["dashboard", "/{locale}"],
		["time-tracking", "/{locale}/time-tracking"],
		["employee-directory", "/{locale}/settings/employees"],
		["employee-detail", "/{locale}/settings/employees/{employee}"],
		["reports", "/{locale}/reports"],
		["analytics", "/{locale}/analytics/work-hours"],
	].map(([name, path]) => ({
		name,
		path,
		...(name.startsWith("employee-") ||
		name === "analytics" ||
		name === "reports"
			? { roles: ["admin", "manager"] }
			: {}),
		ranges:
			name === "analytics" || name === "reports"
				? ["month", "quarter", "year"]
				: ["default"],
		ready: "REPLACE_WITH_USABLE_CONTENT_SELECTOR",
		clockReady: "REPLACE_WITH_KNOWN_ENABLED_CLOCK_SELECTOR",
		link: `a[href="${path}"]`,
		refresh: 'button[aria-label="Refresh data"]',
		mutation: {
			steps: [{ click: "REPLACE_WITH_DISPOSABLE_ACCEPTED_MUTATION" }],
			ready: "REPLACE_WITH_CHANGED_ACCEPTED_VALUE_SELECTOR",
		},
	}));
	const conditions = Object.keys(fixture.actors).map((name) => {
		const [size, role] = name.split("-");
		return {
			name,
			size,
			role,
			organization: size,
			employees: fixture.organizations.find((o) => o.label === size).employees,
			timezone: "Europe/Berlin",
			locale: "en",
			viewport:
				size === "small"
					? { width: 390, height: 844 }
					: { width: 1280, height: 900 },
			budgets: {
				usableContentP95Ms: null,
				clockReadyP95Ms: null,
				javascriptP95Bytes: null,
				queryCountP95: null,
			},
		};
	});
	await save(resolve(args[0]), {
		schema: 1,
		origin: runtime.origin,
		samples: 20,
		concurrency: 1,
		timeoutMs: 30000,
		awayPath: "/{locale}/settings",
		fixture: {
			kind: fixture.kind,
			version: fixture.version ?? 1,
			journeysVerified: false,
			organizations: fixture.organizations,
		},
		runtime: {
			mode: "production",
			build,
			sourceBuild,
			toolingBuild,
			buildWorkers: 2,
			redisCommandTimeoutMs: Number(
				runtime.env.REDIS_COMMAND_TIMEOUT_MS || 2000,
			),
			poolMax: Number(runtime.env.POSTGRES_POOL_MAX),
			images: runtime.images,
		},
		ranges: [{ name: "default", start: "", end: "" }, ...fixture.ranges],
		conditions,
		routes,
	});
	console.log(
		"Public comparison-plan draft written. Verify selectors/range controls/mutations and record numerical budgets before measurement.",
	);
}

if (
	![
		"prepare",
		"start",
		"cleanup",
		"plan",
		"authenticate",
		"check-runtime",
		"upgrade",
	].includes(command) ||
	!inputDirectory
) {
	console.error(
		"Usage: pnpm performance:fixture <prepare|start|cleanup|plan|authenticate|check-runtime|upgrade> <private-directory> [--build|plan-output.json]",
	);
	process.exitCode = 2;
} else {
	const directory = resolve(inputDirectory);
	({
		prepare,
		start,
		cleanup,
		plan,
		authenticate: authenticateFixture,
		"check-runtime": checkRuntime,
		upgrade,
	})
		[command](directory)
		.catch((error) => {
			console.error(
				error.message?.startsWith("Fixture") ||
					error.message?.startsWith("Synthetic") ||
					error.message?.startsWith("Production") ||
					error.message?.startsWith("Refusing")
					? error.message
					: "Fixture operation failed. Inspect private local runtime.log; no credentials are printed.",
			);
			process.exitCode = 1;
		});
}
