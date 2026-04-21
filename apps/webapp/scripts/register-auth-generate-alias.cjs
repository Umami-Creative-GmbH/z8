const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const srcRoot = path.resolve(__dirname, "..", "src");
const originalResolveFilename = Module._resolveFilename;

function resolveAliasTarget(request) {
	const requestPath = request.slice(2);
	const basePath = path.resolve(srcRoot, requestPath);
	const candidates = [
		basePath,
		`${basePath}.ts`,
		`${basePath}.tsx`,
		`${basePath}.js`,
		`${basePath}.mjs`,
		`${basePath}.cjs`,
		path.join(basePath, "index.ts"),
		path.join(basePath, "index.tsx"),
		path.join(basePath, "index.js"),
		path.join(basePath, "index.mjs"),
		path.join(basePath, "index.cjs"),
	];

	return candidates.find((candidate) => fs.existsSync(candidate)) ?? basePath;
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
	if (request.startsWith("@/")) {
		request = resolveAliasTarget(request);
	}

	return originalResolveFilename.call(this, request, parent, isMain, options);
};
