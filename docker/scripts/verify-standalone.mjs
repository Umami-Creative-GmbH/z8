import { createRequire } from "node:module";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimePackages = [
	"next",
	"react",
	"pg",
	"sharp",
	"pino",
	"pino-opentelemetry-transport",
	"@opentelemetry/sdk-node",
	"@tus/server",
	"exceljs",
	"@react-pdf/renderer",
];

function isWithin(root, filename) {
	const relative = path.relative(root, filename);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Validate the assembled image root, never the builder's dependency tree. */
export async function verifyStandalone(root, { native = false, packages = runtimePackages } = {}) {
	const artifactRoot = await realpath(root);
	const appRoot = path.join(artifactRoot, "apps/webapp");
	for (const filename of [
		"server.js",
		".next/BUILD_ID",
		".next/static",
		"public/fonts/avv/NotoSans-Regular.ttf",
		"public/fonts/avv/DroidSansFallbackFull.ttf",
	]) {
		const resolved = await realpath(path.join(appRoot, filename));
		if (!isWithin(artifactRoot, resolved))
			throw new Error(`Standalone asset escapes artifact: ${filename}`);
		await stat(resolved);
	}
	const require = createRequire(path.join(appRoot, "package.json"));
	const resolvedPackages = {};
	for (const name of packages) {
		const resolved = await realpath(require.resolve(name));
		if (!isWithin(artifactRoot, resolved))
			throw new Error(`Standalone dependency escapes artifact: ${name}`);
		resolvedPackages[name] = resolved;
	}
	if (packages.includes("pino-opentelemetry-transport")) {
		const transportRequire = createRequire(resolvedPackages["pino-opentelemetry-transport"]);
		const logs = await realpath(transportRequire.resolve("@opentelemetry/sdk-logs"));
		if (!isWithin(artifactRoot, logs))
			throw new Error("Standalone transport dependency escapes artifact");
	}
	if (native) {
		// Loading and encoding exercises the target architecture's Sharp binary without network/DB.
		const sharp = require("sharp");
		await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
			.png()
			.toBuffer();
	}
	return { packages: Object.keys(resolvedPackages).length, native };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await verifyStandalone(process.argv[2] ?? ".", {
		native: process.argv.includes("--native"),
	});
	console.log(
		`Standalone artifact verified (${result.packages} runtime packages; native=${result.native}).`,
	);
}
