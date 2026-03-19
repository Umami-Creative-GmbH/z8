import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dockerfilePath = path.resolve(scriptDir, "../../Dockerfile");

const requiredSnippets = [
	"ARG RUNTIME_BASE_IMAGE=app-runtime",
	"FROM ${RUNTIME_BASE_IMAGE} AS webapp",
	"FROM ${RUNTIME_BASE_IMAGE} AS migration",
	"FROM ${RUNTIME_BASE_IMAGE} AS worker",
];

const forbiddenSnippets = [
	"FROM app-runtime AS webapp",
	"FROM app-runtime AS migration",
	"FROM app-runtime AS worker",
];

const dockerfile = await readFile(dockerfilePath, "utf8");
const dockerfileLines = dockerfile.split(/\r?\n/);

const missingRequired = requiredSnippets.filter((snippet) => !dockerfile.includes(snippet));
const presentForbidden = forbiddenSnippets.filter((snippet) => dockerfile.includes(snippet));
const hasSyntaxOnLine1 = dockerfileLines[0] === "# syntax=docker/dockerfile:1.4";
const hasArgOnLine2 = dockerfileLines[1] === "ARG RUNTIME_BASE_IMAGE=app-runtime";

if (
	missingRequired.length > 0 ||
	presentForbidden.length > 0 ||
	!hasSyntaxOnLine1 ||
	!hasArgOnLine2
) {
	if (missingRequired.length > 0) {
		console.error("Missing required snippets:");
		for (const snippet of missingRequired) {
			console.error(`- ${snippet}`);
		}
	}

	if (!hasSyntaxOnLine1) {
		console.error("Dockerfile syntax directive must be on line 1.");
	}

	if (!hasArgOnLine2) {
		console.error("RUNTIME_BASE_IMAGE arg must be on line 2.");
	}

	if (presentForbidden.length > 0) {
		console.error("Forbidden snippets still present:");
		for (const snippet of presentForbidden) {
			console.error(`- ${snippet}`);
		}
	}

	process.exit(1);
}

console.log("Docker runtime base contract OK");
