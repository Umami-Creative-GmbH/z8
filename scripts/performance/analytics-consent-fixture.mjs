/** Head-only configured analytics fixture. Never changes the parity fixture. */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const fixtureToken = "phc_z8_disposable_consent_1470_only";
export function localOrigin(value) {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1"].includes(url.hostname) ||
		!url.port ||
		Number(url.port) < 1024 ||
		url.pathname !== "/" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"Explicit loopback HTTP origin with a private port required.",
		);
	return url.origin;
}
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
export function pnpmInvocation(
	args,
	pnpmPath = process.env.npm_execpath,
	nodePath = process.execPath,
) {
	if (!pnpmPath) throw new Error("pnpm required.");
	const options = ["--config.verifyDepsBeforeRun=false", ...args];
	return /\.(?:cjs|mjs|js)$/i.test(pnpmPath)
		? { file: nodePath, args: [pnpmPath, ...options] }
		: { file: pnpmPath, args: options };
}
const sourceFiles = [
	"src/components/posthog-provider.tsx",
	"next.config.ts",
	"node_modules/posthog-js/package.json",
	"node_modules/posthog-js/lib/src/remote-config.js",
	"node_modules/posthog-js/lib/src/feature-flags-config.js",
];
async function sourceHashes(app) {
	return Object.fromEntries(
		await Promise.all(
			sourceFiles.map(async (file) => [
				file,
				sha(await readFile(join(app, file))),
			]),
		),
	);
}
async function forbidDotEnv(app) {
	for (const file of [
		".env",
		".env.local",
		".env.production",
		".env.production.local",
	]) {
		try {
			await access(join(app, file));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		throw new Error(
			"Generated fixture environment requires no app dotenv files.",
		);
	}
}
export async function readAnalyticsFixture(directory) {
	const fixture = await json(
		join(resolve(directory), "analytics-private.json"),
	);
	if (
		fixture.kind !== "disposable-consent-1470" ||
		fixture.version !== 1 ||
		localOrigin(fixture.origin) === localOrigin(fixture.sinkOrigin) ||
		fixture.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN !== fixtureToken ||
		fixture.env.NEXT_PUBLIC_POSTHOG_HOST !== fixture.sinkOrigin ||
		fixture.env.POSTHOG_API_KEY ||
		fixture.env.POSTHOG_PROJECT_ID ||
		["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"].some(
			(name) => fixture.env[name] !== fixture.origin,
		) ||
		fixture.env.POSTGRES_HOST !== "127.0.0.1" ||
		!/^approval_workflow_repository_test_[a-z0-9_]+$/.test(
			fixture.env.POSTGRES_DB,
		)
	)
		throw new Error("Invalid fixture.");
	return fixture;
}
async function* files(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else if (entry.isFile() && entry.name.endsWith(".js")) yield path;
	}
}
export async function verifyAnalyticsArtifact(directory) {
	const fixture = await readAnalyticsFixture(directory);
	const manifest = await json(
		join(fixture.artifactApp, ".next/routes-manifest.json"),
	);
	const rewrites = Array.isArray(manifest.rewrites)
		? manifest.rewrites
		: Object.values(manifest.rewrites ?? {}).flat();
	const expected = new Map([
		["/ingest/static/:path*", `${fixture.sinkOrigin}/static/:path*`],
		["/ingest/:path*", `${fixture.sinkOrigin}/:path*`],
	]);
	const ingest = rewrites.filter((rule) => rule.source?.startsWith("/ingest"));
	if (
		rewrites.length !== 2 ||
		ingest.length !== 2 ||
		ingest.some((rule) => expected.get(rule.source) !== rule.destination)
	)
		throw new Error("Unsafe compiled rewrite.");
	const required = await json(
		join(fixture.artifactApp, ".next/required-server-files.json"),
	);
	if (
		required.config.deploymentId !== fixture.sourceBuild ||
		required.config.env?.NEXT_PUBLIC_BUILD_HASH !==
			fixture.sourceBuild.slice(0, 7) ||
		fixture.env.NEXT_DEPLOYMENT_ID !== fixture.sourceBuild
	)
		throw new Error("Wrong compiled source build.");
	const hashes = await sourceHashes(fixture.artifactApp);
	if (JSON.stringify(hashes) !== JSON.stringify(fixture.sourceHashes))
		throw new Error("Source changed since preparation.");
	let tokenChunks = 0;
	const tokenChunkHashes = {};
	const sdkChunks = {};
	for await (const path of files(
		join(fixture.artifactApp, ".next/static/chunks"),
	)) {
		const content = await readFile(path, "utf8");
		if (content.includes(fixtureToken)) {
			tokenChunks++;
			tokenChunkHashes[
				`/_next/${relative(join(fixture.artifactApp, ".next"), path).split(sep).join("/")}`
			] = sha(content);
		}
		if (content.includes("__PosthogExtensions__"))
			sdkChunks[
				`/_next/${relative(join(fixture.artifactApp, ".next"), path).split(sep).join("/")}`
			] = sha(content);
	}
	if (!tokenChunks) throw new Error("Fixture token absent from browser build.");
	if (!Object.keys(sdkChunks).length)
		throw new Error("Real installed SDK chunk not found.");
	return {
		fixture,
		report: {
			kind: "head-only-configured-consent-1470",
			sourceBuild: fixture.sourceBuild,
			compiledBuildHash: fixture.sourceBuild.slice(0, 7),
			sourceHashes: hashes,
			sdkChunks,
			tokenChunkHashes,
			routesManifestSha256: sha(
				await readFile(join(fixture.artifactApp, ".next/routes-manifest.json")),
			),
			buildIdSha256: sha(
				await readFile(join(fixture.artifactApp, ".next/BUILD_ID")),
			),
			tokenChunks,
			configuredBrowserVerified: false,
		},
	};
}
async function launch(directory, command) {
	const fixture =
		command === "start"
			? (await verifyAnalyticsArtifact(directory)).fixture
			: await readAnalyticsFixture(directory);
	await forbidDotEnv(fixture.artifactApp);
	if (
		JSON.stringify(await sourceHashes(fixture.artifactApp)) !==
		JSON.stringify(fixture.sourceHashes)
	)
		throw new Error("Source changed since preparation.");
	if (!process.env.npm_execpath) throw new Error("pnpm required.");
	const tools = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|SWC_NATIVE_BINDING_CACHE)$/i.test(
				key,
			),
		),
	);
	const log = createWriteStream(join(directory, `${command}-private.log`), {
		mode: 0o600,
	});
	const args =
		command === "build"
			? ["run", "build"]
			: [
					"exec",
					"next",
					"start",
					"--hostname",
					"127.0.0.1",
					"--port",
					new URL(fixture.origin).port,
				];
	const invocation = pnpmInvocation(args);
	const child = spawn(invocation.file, invocation.args, {
		cwd: fixture.artifactApp,
		env: { ...tools, ...fixture.env },
		stdio: ["ignore", log, log],
		windowsHide: true,
	});
	if (command === "start")
		await writeFile(
			join(directory, "launch-private.json"),
			JSON.stringify(
				{
					...(await verifyAnalyticsArtifact(directory)).report,
					origin: fixture.origin,
					pid: child.pid,
				},
				null,
				2,
			),
			{ mode: 0o600 },
		);
	for (const signal of ["SIGINT", "SIGTERM"])
		process.once(signal, () => child.kill(signal));
	await new Promise((done, reject) => {
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? done()
				: reject(new Error("Private fixture command failed.")),
		);
	});
	log.end();
	if (command === "build")
		await writeFile(
			join(directory, "artifact-manifest.json"),
			JSON.stringify(
				(await verifyAnalyticsArtifact(directory)).report,
				null,
				2,
			),
		);
}
async function main() {
	const [command, input, output, artifactApp, sinkOrigin, origin, sourceBuild] =
		process.argv.slice(2);
	if (command === "verify") {
		console.log(JSON.stringify((await verifyAnalyticsArtifact(input)).report));
		return;
	}
	if (["build", "start"].includes(command)) {
		await launch(resolve(input), command);
		return;
	}
	if (command !== "prepare") throw new Error("Use prepare.");
	const sink = localOrigin(sinkOrigin);
	const appOrigin = localOrigin(origin);
	const parent = await json(input);
	if (
		parent.env?.POSTGRES_HOST !== "127.0.0.1" ||
		!/^approval_workflow_repository_test_[a-z0-9_]+$/.test(
			parent.env.POSTGRES_DB,
		)
	)
		throw new Error("Disposable fixture database required.");
	if (sink === appOrigin || !/^[a-f0-9]{7,40}$/.test(sourceBuild))
		throw new Error("Distinct ports and explicit source commit required.");
	localOrigin(parent.origin);
	await forbidDotEnv(resolve(artifactApp));
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: resolve(artifactApp),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	if (!head.startsWith(sourceBuild))
		throw new Error("Source commit does not match artifact worktree.");
	try {
		await access(join(resolve(artifactApp), ".next"));
		throw new Error(
			"Use a separate artifact app without an existing .next tree.",
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const env = {
		...parent.env,
		NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: fixtureToken,
		NEXT_PUBLIC_POSTHOG_HOST: sink,
		POSTHOG_API_KEY: "",
		POSTHOG_PROJECT_ID: "",
		NEXT_DEPLOYMENT_ID: sourceBuild,
		BETTER_AUTH_URL: appOrigin,
		APP_URL: appOrigin,
		NEXT_PUBLIC_APP_URL: appOrigin,
		NODE_ENV: "production",
		CI: "true",
		CIRCLE_NODE_TOTAL: "3",
		TELEMETRY_ENABLED: "false",
		BILLING_ENABLED: "false",
		ENABLE_CRON_JOBS: "false",
		SMTP_HOST: "",
		SMTP_USERNAME: "",
		SMTP_PASSWORD: "",
		RESEND_API_KEY: "",
		EMAIL_PROVIDER: "",
		VAULT_ADDR: "",
		VAULT_TOKEN: "",
		SCALEWAY_ACCESS_KEY: "",
		SCALEWAY_SECRET_KEY: "",
		S3_PRIVATE_BUCKET: parent.env.S3_PUBLIC_BUCKET,
		S3_PRIVATE_ENDPOINT: parent.env.S3_PUBLIC_ENDPOINT,
		S3_PRIVATE_REGION: parent.env.S3_PUBLIC_REGION,
		S3_PRIVATE_ACCESS_KEY_ID: parent.env.S3_PUBLIC_ACCESS_KEY_ID,
		S3_PRIVATE_SECRET_ACCESS_KEY: parent.env.S3_PUBLIC_SECRET_ACCESS_KEY,
		S3_PRIVATE_FORCE_PATH_STYLE: "true",
		NODE_OPTIONS: "",
		Z8_PERFORMANCE_OBSERVER: "0",
		Z8_CACHE_FAULT_DIRECTORY: "",
		OTEL_EXPORTER_OTLP_ENDPOINT: "",
		OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
		OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
	};
	const hashes = await sourceHashes(resolve(artifactApp));
	await mkdir(resolve(output), { recursive: true });
	await writeFile(
		join(resolve(output), "analytics-private.json"),
		JSON.stringify(
			{
				kind: "disposable-consent-1470",
				version: 1,
				artifactApp: resolve(artifactApp),
				origin: appOrigin,
				sinkOrigin: sink,
				sourceBuild,
				sourceHashes: hashes,
				env,
			},
			null,
			2,
		),
		{ flag: "wx", mode: 0o600 },
	);
	console.log("Configured variant prepared; build and browser proof pending.");
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch(() => {
		console.error(
			"Configured fixture rejected: loopback, disposable provenance or compiled rewrite/build verification failed. Inspect inputs privately.",
		);
		process.exitCode = 1;
	});
