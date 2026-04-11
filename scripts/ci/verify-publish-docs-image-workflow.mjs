import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
	scriptDir,
	"../../.github/workflows/publish-docs-image.yml",
);

const workflow = await readFile(workflowPath, "utf8");
const errors = [];

function expect(condition, message) {
	if (!condition) {
		errors.push(message);
	}
}

function getJobBlock(jobName) {
	const lines = workflow.split("\n");
	const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);
	if (startIndex === -1) {
		return null;
	}

	let endIndex = lines.length;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		if (/^ {2}[a-z0-9-]+:$/.test(lines[index])) {
			endIndex = index;
			break;
		}
	}

	return lines.slice(startIndex, endIndex).join("\n");
}

function getStepBlock(jobBlock, stepName) {
	const lines = jobBlock.split("\n");
	const startIndex = lines.findIndex((line) => line === `      - name: ${stepName}`);
	if (startIndex === -1) {
		return null;
	}

	let endIndex = lines.length;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		if (lines[index].startsWith("      - name: ")) {
			endIndex = index;
			break;
		}
	}

	return lines.slice(startIndex, endIndex).join("\n");
}

const buildNativeJob = getJobBlock("build-native");
const publishManifestJob = getJobBlock("publish-manifest");

expect(buildNativeJob, "Missing build-native job");
expect(publishManifestJob, "Missing publish-manifest job");

if (buildNativeJob) {
	const buildStep = getStepBlock(buildNativeJob, "Build and push docs image by digest");
	expect(buildStep, "Missing docs image build step");

	if (buildStep) {
		expect(
			buildStep.includes("labels: |"),
			"Docs image build step must define OCI labels for GHCR package association",
		);
		expect(
			buildStep.includes(
				"org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}",
			),
			"Docs image build step must set org.opencontainers.image.source to the workflow repository",
		);
	}
}

if (publishManifestJob) {
	const publishStep = getStepBlock(
		publishManifestJob,
		"Create and push multi-arch manifests",
	);
	expect(publishStep, "Missing multi-arch manifest publish step");

	if (publishStep) {
		expect(
			publishStep.includes(
				'--annotation "index:org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}"',
			),
			"Multi-arch manifest publish step must set the index source annotation to the workflow repository",
		);
	}
}

if (errors.length > 0) {
	console.error("Publish docs image workflow contract failed:");
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log("Publish docs image workflow contract OK");
