/** Fixture-only native-get fault and numeric process resource probe; never stores cache keys. */
const { isMainThread, threadId } = require("node:worker_threads");
// NODE_OPTIONS is inherited by workers, which share a PID but have different globals/heaps.
// Only the HTTP server's main thread owns this replica's hook and resource snapshot.
if (isMainThread) {
	const fs = require("node:fs");
	const path = require("node:path");
	const { createRequire } = require("node:module");
	const directory = process.env.Z8_MULTI_FIXTURE_DIRECTORY;
	const replica = process.env.Z8_MULTI_FIXTURE_REPLICA;
	if (!directory || !["a", "b"].includes(replica))
		throw new Error("Missing owned fixture replica.");
	const fixture = JSON.parse(
		fs.readFileSync(path.join(directory, "multi-private.json"), "utf8"),
	);
	if (
		fixture.kind !== "disposable-multi-instance-1472" ||
		!fixture.prepared ||
		process.env.POSTGRES_HOST !== "127.0.0.1" ||
		process.env.POSTGRES_DB !== fixture.env.POSTGRES_DB ||
		!/^approval_workflow_repository_test_multi_/.test(process.env.POSTGRES_DB)
	)
		throw new Error("Refusing nonfixture preload.");
	const appRequire = createRequire(
		path.join(fixture.artifactApp, "package.json"),
	);
	let installed = false,
		gets = 0,
		faults = 0,
		maxRss = 0,
		maxHeapUsed = 0;
	const timer = setInterval(() => {
		try {
			// Loading Next's handlers before Node bootstrap breaks its async-local stores.
			if (!installed && typeof globalThis.AsyncLocalStorage === "function") {
				const handlers = appRequire("next/dist/server/use-cache/handlers");
				const handler = handlers.getCacheHandler("default");
				if (handler && handlers.isBuiltInCacheHandler("default")) {
					const original = handler.get;
					handler.get = async function (...args) {
						gets++;
						if (
							fs.existsSync(path.join(directory, `fault-${replica}.enabled`))
						) {
							faults++;
							throw new Error("Isolated fixture native cache-read outage");
						}
						return original.apply(this, args);
					};
					installed = true;
				}
			}
			const memory = process.memoryUsage();
			maxRss = Math.max(maxRss, memory.rss);
			maxHeapUsed = Math.max(maxHeapUsed, memory.heapUsed);
			const destination = path.join(
				directory,
				`replica-${replica}-metrics.json`,
			);
			const temporary = `${destination}.${process.pid}.tmp`;
			fs.writeFileSync(
				temporary,
				JSON.stringify({
					pid: process.pid,
					samplerThreadId: threadId,
					replica,
					installed,
					gets,
					faults,
					rss: memory.rss,
					heapUsed: memory.heapUsed,
					maxRss,
					maxHeapUsed,
					sourceBuild: fixture.sourceBuild,
					backend: "installed-default-process-memory",
				}),
			);
			fs.renameSync(temporary, destination);
		} catch {
			/* Retry bootstrap observation without initializing framework globals. */
		}
	}, 100);
	timer.unref();
}
