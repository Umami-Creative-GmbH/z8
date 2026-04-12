import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
	scriptDir,
	"../../.github/workflows/publish-marketing-image.yml",
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

function includesAll(text, snippets, context) {
	for (const snippet of snippets) {
		expect(text.includes(snippet), `${context} missing: ${snippet}`);
	}
}

const buildNativeJob = getJobBlock("build-native");
const publishManifestJob = getJobBlock("publish-manifest");

expect(buildNativeJob, "Missing build-native job");
expect(publishManifestJob, "Missing publish-manifest job");

if (buildNativeJob) {
	const verifyStep = getStepBlock(buildNativeJob, "Verify workflow contract");
	expect(verifyStep, "Missing workflow contract verification step");

	if (verifyStep) {
		expect(
			verifyStep.includes("run: node scripts/ci/verify-publish-marketing-image-workflow.mjs"),
			"Workflow contract verification step must run the marketing verifier",
		);
	}

	const buildStep = getStepBlock(buildNativeJob, "Build and push marketing image by digest");
	expect(buildStep, "Missing marketing image build step");

	if (buildStep) {
		expect(
			buildStep.includes("file: ./docker/Dockerfile.marketing"),
			"Marketing image build step must use file: ./docker/Dockerfile.marketing",
		);
	}
}

if (publishManifestJob) {
	includesAll(
		publishManifestJob,
		[
			"name: Publish Manifest",
			"needs: build-native",
			"uses: docker/setup-buildx-action@v3",
			"uses: docker/login-action@v3",
			"name: Download amd64 digest",
			"name: digests-marketing-amd64",
			"path: /tmp/digests/amd64",
			"name: Download arm64 digest",
			"name: digests-marketing-arm64",
			"path: /tmp/digests/arm64",
			"uses: docker/metadata-action@v5",
			"images: ghcr.io/umami-creative-gmbh/z8-marketing",
			"type=raw,value=latest,enable={{is_default_branch}}",
			"type=sha,prefix=sha-",
			"type=semver,pattern=v{{version}}",
			"type=semver,pattern=v{{major}}.{{minor}}",
			"type=semver,pattern=v{{major}}",
			"IMAGE_NAME: ghcr.io/umami-creative-gmbh/z8-marketing",
			"TAGS: ${{ steps.meta.outputs.tags }}",
			'set -- /tmp/digests/amd64/*',
			'AMD64_DIGEST="sha256:${1##*/}"',
			'set -- /tmp/digests/arm64/*',
			'ARM64_DIGEST="sha256:${1##*/}"',
			'for tag in $TAGS; do',
			'docker buildx imagetools create \\',
			'-t "$tag" \\',
			'"$IMAGE_NAME@$AMD64_DIGEST" \\',
			'"$IMAGE_NAME@$ARM64_DIGEST"',
		],
		"publish-manifest",
	);

	const publishStep = getStepBlock(
		publishManifestJob,
		"Create and push multi-arch manifests",
	);
	expect(publishStep, "Missing multi-arch manifest publish step");
}

if (errors.length > 0) {
	console.error("Publish marketing image workflow contract failed:");
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log("Publish marketing image workflow contract OK");
