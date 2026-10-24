#!/usr/bin/env node
/** Operator-owned disposable two-process Cache Components fixture. */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { authenticateFixture } from "./fixture-auth.mjs";

async function readOwnedManifest(directory) {
	const value = JSON.parse(
		await readFile(join(resolve(directory), "multi-private.json"), "utf8"),
	);
	if (
		value.kind !== "disposable-multi-instance-1472" ||
		value.version !== 1 ||
		!/^z8-performance-multi-1472-[a-z0-9]+$/.test(value.label) ||
		!Array.isArray(value.containers)
	)
		throw new Error("Not an owned multi-instance fixture.");
	return value;
}
export async function readMultiInstanceFixture(directory) {
	const value = await readOwnedManifest(directory);
	const origin = new URL(value.origin);
	if (
		origin.protocol !== "http:" ||
		!["localhost", "127.0.0.1"].includes(origin.hostname) ||
		origin.username ||
		origin.password ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		value.env.POSTGRES_HOST !== "127.0.0.1" ||
		!/^approval_workflow_repository_test_multi_[a-z0-9_]+$/.test(
			value.env.POSTGRES_DB,
		) ||
		!/^z8-performance-multi-1472-[a-z0-9]+$/.test(value.label)
	)
		throw new Error("Only local owned disposable services are permitted.");
	const ports = [
		Number(origin.port),
		value.replicas.a.port,
		value.replicas.b.port,
	];
	if (
		new Set(ports).size !== 3 ||
		ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
	)
		throw new Error("Replica and proxy ports must be distinct private ports.");
	return value;
}

export function multiInstancePlan(fixture) {
	return {
		webReplicas: 2,
		webRuntime: "two operator-owned host Next.js production processes",
		proxy: "Docker HAProxy 2.8",
		origin: fixture.origin,
		nextVersion: fixture.nextVersion,
		sourceBuild: fixture.sourceBuild,
		artifactCopies: fixture.artifactCopies,
		isrFlushToDisk: false,
		nextCache: "per-process default Cache Components memory",
		productionTopologyVerified: false,
	};
}

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const save = (path, value, exclusive = false) =>
	writeFile(path, JSON.stringify(value, null, 2), {
		mode: 0o600,
		flag: exclusive ? "wx" : "w",
	});
const docker = (...args) =>
	execFileSync("docker", args, {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const owned = (container, label) => {
	if (
		docker(
			"inspect",
			"--format",
			'{{ index .Config.Labels "z8.agent-owned" }}',
			container,
		) !== label
	)
		throw new Error("Container ownership does not match its private manifest.");
};
async function unusedPort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}

/** No new source database query or dump: copy the previously guarded synthetic snapshot. */
async function prepare(
	directory,
	sourceDirectory,
	originalDirectory,
	artifactApp,
	sourceBuild,
) {
	if (!sourceDirectory || !originalDirectory || !artifactApp)
		throw new Error(
			"Provide source candidate, original manifest directory and compiled app paths.",
		);
	directory = resolve(directory);
	sourceDirectory = resolve(sourceDirectory);
	originalDirectory = resolve(originalDirectory);
	artifactApp = resolve(artifactApp);
	if (
		[sourceDirectory, originalDirectory, artifactApp].some(
			(path) =>
				directory === path ||
				directory.startsWith(`${path}/`) ||
				directory.startsWith(`${path}\\`),
		)
	)
		throw new Error(
			"The new private directory must be separate from source inputs.",
		);
	const source = await json(join(sourceDirectory, "runtime-private.json"));
	sourceBuild ||= source.env.NEXT_DEPLOYMENT_ID;
	if (!/^[a-f0-9]{7,40}$/.test(sourceBuild ?? ""))
		throw new Error(
			"Record the actual compiled artifact source commit explicitly.",
		);
	const parent = await json(join(sourceDirectory, "clone-parent-private.json"));
	const original = await json(join(originalDirectory, "runtime-private.json"));
	const originalServices = await json(join(originalDirectory, "services.json"));
	const people = await json(join(sourceDirectory, "fixture-private.json"));
	if (
		people.kind !== "disposable" ||
		source.origin !== "http://localhost:50754" ||
		source.env.POSTGRES_HOST !== "127.0.0.1" ||
		parent.database !== source.env.POSTGRES_DB ||
		parent.sourceDatabase !== original.env.POSTGRES_DB ||
		!/^approval_workflow_repository_test_/.test(parent.sourceDatabase) ||
		!originalServices.containers.includes(parent.postgres) ||
		originalServices.label !== "z8-performance-fixture-1450" ||
		typeof parent.dump !== "string" ||
		!parent.dump.startsWith("/tmp/") ||
		parent.dump.includes("..")
	)
		throw new Error("Existing synthetic dump provenance is not verified.");
	owned(parent.postgres, originalServices.label);
	const packageInfo = await json(
		join(artifactApp, "node_modules/next/package.json"),
	);
	const requiredText = await readFile(
		join(artifactApp, ".next/required-server-files.json"),
		"utf8",
	);
	const required = JSON.parse(requiredText);
	if (
		packageInfo.version !== "16.4.0" ||
		required.config.cacheHandler ||
		Object.keys(required.config.cacheHandlers ?? {}).length ||
		required.config.cacheMaxMemorySize !== 50 * 1024 * 1024
	)
		throw new Error(
			"Fixture requires the observed installed native Cache Components configuration.",
		);
	const suffix = randomBytes(6).toString("hex"),
		label = `z8-performance-multi-1472-${suffix}`;
	const database = `approval_workflow_repository_test_multi_${suffix}`;
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const value = {
		kind: "disposable-multi-instance-1472",
		version: 1,
		label,
		containers: [],
		origin: source.origin,
		sourceBuild,
		nextVersion: packageInfo.version,
		artifactApp,
		artifactCopies:
			"shared read-only compiled artifact; ISR disk writes disabled",
		artifactBuildId: (
			await readFile(join(artifactApp, ".next/BUILD_ID"), "utf8")
		).trim(),
		artifactManifestSha256: createHash("sha256")
			.update(requiredText)
			.digest("hex"),
		replicas: {
			a: { port: await unusedPort() },
			b: { port: await unusedPort() },
		},
		prepared: false,
		env: { POSTGRES_HOST: "127.0.0.1", POSTGRES_DB: database },
	};
	await save(join(directory, "multi-private.json"), value, true);
	await copyFile(
		join(sourceDirectory, "fixture-private.json"),
		join(directory, "fixture-private.json"),
	);
	docker(
		"cp",
		`${parent.postgres}:${parent.dump}`,
		join(directory, "seed-private.dump"),
	);
	const secret = randomBytes(32).toString("hex");
	const service = async (name, port, image, environment, extra = []) => {
		const container = `z8_multi_${suffix}_${name}`;
		docker(
			"run",
			"--detach",
			"--pull=never",
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
		value.containers.push(container);
		await save(join(directory, "multi-private.json"), value);
		return container;
	};
	value.postgres = await service("postgres", 5432, "postgres:16", {
		POSTGRES_PASSWORD: secret,
	});
	value.redis = await service("redis", 6379, "valkey/valkey:9-alpine", {}, [
		"valkey-server",
		"--save",
		"",
		"--appendonly",
		"no",
	]);
	value.storage = await service("storage", 9000, "rustfs/rustfs:latest", {
		RUSTFS_ROOT_USER: "fixture-access",
		RUSTFS_ROOT_PASSWORD: secret,
		RUSTFS_VOLUMES: "/data",
		RUSTFS_CONSOLE_ENABLE: "false",
	});
	const port = (container, internal) =>
		docker(
			"inspect",
			"--format",
			`{{(index (index .NetworkSettings.Ports "${internal}/tcp") 0).HostPort}}`,
			container,
		);
	for (let attempt = 0; ; attempt++) {
		try {
			docker("exec", value.postgres, "pg_isready", "--username", "postgres");
			break;
		} catch {
			if (attempt >= 59)
				throw new Error("Owned PostgreSQL did not become ready.");
			await pause(500);
		}
	}
	docker(
		"exec",
		value.postgres,
		"createdb",
		"--username",
		"postgres",
		database,
	);
	docker(
		"cp",
		join(directory, "seed-private.dump"),
		`${value.postgres}:/tmp/seed-private.dump`,
	);
	docker(
		"exec",
		value.postgres,
		"pg_restore",
		"--username",
		"postgres",
		"--dbname",
		database,
		"--no-owner",
		"--no-acl",
		"/tmp/seed-private.dump",
	);
	value.env = {
		...source.env,
		NEXT_DEPLOYMENT_ID: sourceBuild,
		POSTGRES_HOST: "127.0.0.1",
		POSTGRES_PORT: port(value.postgres, 5432),
		POSTGRES_DB: database,
		POSTGRES_PASSWORD: secret,
		APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:${port(value.postgres, 5432)}/${database}`,
		REDIS_HOST: "127.0.0.1",
		REDIS_PORT: port(value.redis, 6379),
		REDIS_PASSWORD: "",
		REDIS_TLS: "false",
		REDIS_COMMAND_TIMEOUT_MS: "2000",
		S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${port(value.storage, 9000)}`,
		S3_PUBLIC_ACCESS_KEY_ID: "fixture-access",
		S3_PUBLIC_SECRET_ACCESS_KEY: secret,
		BILLING_ENABLED: "false",
		ENABLE_CRON_JOBS: "false",
		NODE_OPTIONS: "",
		Z8_CACHE_FAULT_DIRECTORY: "",
		Z8_FIXTURE_OTLP_ENDPOINT: "",
		OTEL_EXPORTER_OTLP_ENDPOINT: "",
	};
	value.sourceSnapshot = {
		kind: "existing pre-mutation synthetic dump with 208 real projections",
		sha256: createHash("sha256")
			.update(await readFile(join(directory, "seed-private.dump")))
			.digest("hex"),
	};
	value.images = Object.fromEntries(
		[
			["postgres", value.postgres],
			["redis", value.redis],
			["storage", value.storage],
		].map(([name, container]) => [
			name,
			docker("inspect", "--format", "{{.Image}}", container),
		]),
	);
	value.prepared = true;
	await save(join(directory, "multi-private.json"), value);
	await save(join(directory, "runtime-private.json"), {
		origin: value.origin,
		port: 50754,
		env: value.env,
	});
	await readMultiInstanceFixture(directory);
	console.log(JSON.stringify({ prepared: true, ...multiInstancePlan(value) }));
}

function proxyConfiguration(fixture) {
	return `global\n  maxconn 128\ndefaults\n  mode http\n  timeout connect 5s\n  timeout client 90s\n  timeout server 90s\nfrontend public\n  bind *:8080\n  http-request set-var(txn.replica) req.hdr(x-z8-fixture-replica)\n  http-request del-header x-z8-fixture-replica\n  http-request set-header X-Forwarded-Host %[req.hdr(host)]\n  http-request set-header X-Forwarded-Proto http\n  http-response set-header X-Z8-Fixture-Instance %[srv_name]\n  use_backend pin_a if { var(txn.replica) -m str a }\n  use_backend pin_b if { var(txn.replica) -m str b }\n  default_backend balanced\nbackend balanced\n  balance roundrobin\n  server a host.docker.internal:${fixture.replicas.a.port}\n  server b host.docker.internal:${fixture.replicas.b.port}\nbackend pin_a\n  server a host.docker.internal:${fixture.replicas.a.port}\nbackend pin_b\n  server b host.docker.internal:${fixture.replicas.b.port}\n`;
}

async function startProxy(directory, fixture) {
	if (!fixture.prepared)
		throw new Error("Finish fixture preparation before starting the proxy.");
	const path = join(resolve(directory), "haproxy-private.cfg");
	await writeFile(path, proxyConfiguration(fixture), { mode: 0o600 });
	const container = `z8_multi_${fixture.label.split("-").at(-1)}_proxy`;
	docker(
		"run",
		"--rm",
		"--pull=never",
		"--label",
		`z8.agent-owned=${fixture.label}`,
		"--mount",
		`type=bind,source=${path},target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
		"haproxy:2.8-alpine",
		"haproxy",
		"-c",
		"-f",
		"/usr/local/etc/haproxy/haproxy.cfg",
	);
	docker(
		"run",
		"--detach",
		"--pull=never",
		"--name",
		container,
		"--label",
		`z8.agent-owned=${fixture.label}`,
		"--publish",
		"127.0.0.1:50754:8080",
		"--mount",
		`type=bind,source=${path},target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
		"haproxy:2.8-alpine",
	);
	fixture.containers.push(container);
	fixture.proxy = container;
	fixture.images.proxy = docker("inspect", "--format", "{{.Image}}", container);
	await save(join(directory, "multi-private.json"), fixture);
	console.log("Owned loopback Docker proxy started.");
}

async function startReplica(directory, fixture, replica) {
	if (!fixture.prepared)
		throw new Error("Finish fixture preparation before starting replicas.");
	if (!["a", "b"].includes(replica)) throw new Error("Choose replica a or b.");
	for (const container of fixture.containers) owned(container, fixture.label);
	const text = await readFile(
		join(fixture.artifactApp, ".next/required-server-files.json"),
		"utf8",
	);
	if (
		createHash("sha256").update(text).digest("hex") !==
			fixture.artifactManifestSha256 ||
		(
			await readFile(join(fixture.artifactApp, ".next/BUILD_ID"), "utf8")
		).trim() !== fixture.artifactBuildId
	)
		throw new Error("Compiled artifact changed after fixture preparation.");
	const control = await json(join(directory, "collector-control.json"));
	const endpoint = new URL("/v1/traces", control.endpoint);
	if (
		!["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
		endpoint.protocol !== "http:"
	)
		throw new Error("Collector must be local.");
	const config = JSON.parse(text).config;
	config.experimental.isrFlushToDisk = false;
	const tools = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(
				key,
			),
		),
	);
	const env = Object.fromEntries(
		Object.entries({
			...tools,
			...fixture.env,
			CI: "false",
			SKIP_ENV_VALIDATION: "0",
			NODE_ENV: "production",
			BILLING_ENABLED: "false",
			SWC_NATIVE_BINDING_CACHE:
				process.env.SWC_NATIVE_BINDING_CACHE ||
				"C:/Users/KaiHentschel/.swc-native-cache",
			__NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify(config),
			Z8_PERFORMANCE_OBSERVER: "1",
			Z8_FIXTURE_OTLP_ENDPOINT: endpoint.href,
			OTEL_EXPORTER_OTLP_ENDPOINT: endpoint.href,
			Z8_MULTI_FIXTURE_DIRECTORY: resolve(directory),
			Z8_MULTI_FIXTURE_REPLICA: replica,
			NODE_OPTIONS: `--require="${fileURLToPath(new URL("./multi-instance-preload.cjs", import.meta.url)).replaceAll("\\", "/")}"`,
			S3_PRIVATE_BUCKET: fixture.env.S3_PUBLIC_BUCKET,
			S3_PRIVATE_ENDPOINT: fixture.env.S3_PUBLIC_ENDPOINT,
			S3_PRIVATE_ACCESS_KEY_ID: fixture.env.S3_PUBLIC_ACCESS_KEY_ID,
			S3_PRIVATE_SECRET_ACCESS_KEY: fixture.env.S3_PUBLIC_SECRET_ACCESS_KEY,
			S3_PRIVATE_REGION: fixture.env.S3_PUBLIC_REGION,
			S3_PRIVATE_FORCE_PATH_STYLE: "true",
		}).filter(([, value]) => value !== "" && value !== undefined),
	);
	const log = createWriteStream(
		join(
			directory,
			`replica-${replica}-${randomBytes(4).toString("hex")}-private.log`,
		),
		{ flags: "wx", mode: 0o600 },
	);
	await once(log, "open");
	const child = spawn(
		process.execPath,
		[
			join(fixture.artifactApp, "node_modules/next/dist/bin/next"),
			"start",
			"--hostname",
			"127.0.0.1",
			"--port",
			String(fixture.replicas[replica].port),
		],
		{
			cwd: fixture.artifactApp,
			env,
			stdio: ["ignore", log, log],
			windowsHide: true,
		},
	);
	await save(join(directory, `replica-${replica}-control-private.json`), {
		pid: child.pid,
		replica,
		port: fixture.replicas[replica].port,
		sourceBuild: fixture.sourceBuild,
	});
	process.once("SIGINT", () => child.kill());
	process.once("SIGTERM", () => child.kill());
	console.log(
		`Owned replica ${replica} launched; parent must retain this session.`,
	);
	const [code] = await once(child, "exit");
	log.end();
	process.exitCode = code ?? 1;
}

async function main() {
	const [command, directory, ...args] = process.argv.slice(2);
	if (!directory) throw new Error("Provide a private directory.");
	if (command === "prepare") return prepare(directory, ...args);
	const fixture =
		command === "cleanup"
			? await readOwnedManifest(directory)
			: await readMultiInstanceFixture(directory);
	if (command === "plan")
		return console.log(JSON.stringify(multiInstancePlan(fixture), null, 2));
	if (command === "proxy") return startProxy(directory, fixture);
	if (command === "replica") return startReplica(directory, fixture, args[0]);
	if (command === "authenticate") return authenticateFixture(directory);
	if (command === "cleanup") {
		for (const container of fixture.containers) owned(container, fixture.label);
		for (const container of [...fixture.containers].reverse())
			docker("rm", "--force", container);
		return console.log(
			"Removed only verified owned containers; private artifacts remain for the operator.",
		);
	}
	throw new Error(
		"Choose prepare, proxy, replica, authenticate, plan or cleanup.",
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch(async (error) => {
		try {
			await readOwnedManifest(process.argv[3]);
			await writeFile(
				join(resolve(process.argv[3]), "operator-error-private.log"),
				error.stderr ?? error.stack ?? "Fixture command failed",
				{ mode: 0o600 },
			);
		} catch {
			/* Invalid/unowned inputs must not create a diagnostics directory. */
		}
		console.error(
			"Multi-instance fixture command failed; inspect private operator diagnostics.",
		);
		process.exitCode = 1;
	});
