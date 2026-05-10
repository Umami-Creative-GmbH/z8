import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
	scriptDir,
	"../../.github/workflows/publish-deploy-webhook-image.yml",
);

const errors = [];

function expect(condition, message) {
	if (!condition) {
		errors.push(message);
	}
}

let workflow = "";
try {
	workflow = await readFile(workflowPath, "utf8");
} catch (error) {
	expect(false, `Unable to read workflow: ${error.message}`);
}

function getJobBlock(jobName) {
	const lines = workflow.split(/\r?\n/);
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
	const lines = jobBlock.split(/\r?\n/);
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

function getPushBlock() {
	const lines = workflow.split(/\r?\n/);
	const startIndex = lines.findIndex((line) => line === "  push:");
	if (startIndex === -1) {
		return "";
	}

	let endIndex = lines.length;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		if (/^ {2}[a-zA-Z0-9_-]+:$/.test(lines[index])) {
			endIndex = index;
			break;
		}
	}

	return lines.slice(startIndex, endIndex).join("\n");
}

function getPushPaths(pushBlock) {
	const lines = pushBlock.split(/\r?\n/);
	const startIndex = lines.findIndex((line) => line === "    paths:");
	if (startIndex === -1) {
		return [];
	}

	const paths = [];
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		const match = line.match(/^ {6}- (?:"([^"]+)"|(.+?))\s*$/);
		if (match) {
			paths.push(match[1] ?? match[2].trim());
			continue;
		}

		if (/^ {0,6}\S/.test(line) || line.trim() === "") {
			break;
		}
	}

	return paths;
}

function expectPushPathFilters(expectedPaths) {
	const pushBlock = getPushBlock();

	includesAll(
		pushBlock,
		[
			"  push:",
			"    branches:",
			"      - main",
			"    tags:",
			'      - "v*.*.*"',
			"    paths:",
		],
		"push trigger path filters",
	);

	const actualPaths = getPushPaths(pushBlock);
	const expectedPathSet = new Set(expectedPaths);
	const actualPathSet = new Set(actualPaths);

	for (const expectedPath of [...expectedPathSet].sort()) {
		expect(actualPathSet.has(expectedPath), `push trigger paths missing: ${expectedPath}`);
	}

	for (const actualPath of [...actualPathSet].sort()) {
		expect(expectedPathSet.has(actualPath), `push trigger paths extra: ${actualPath}`);
	}
}

const buildNativeJob = getJobBlock("build-native");
const publishManifestJob = getJobBlock("publish-manifest");
const cleanupPackageVersionsJob = getJobBlock("cleanup-package-versions");

expect(buildNativeJob, "Missing build-native job");
expect(publishManifestJob, "Missing publish-manifest job");
expect(cleanupPackageVersionsJob, "Missing cleanup-package-versions job");

expectPushPathFilters([
	".dockerignore",
	"apps/deploy-webhook/**",
	"docker/Dockerfile.deploy-webhook",
	"packages/**",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"turbo.json",
]);

if (buildNativeJob) {
	includesAll(
		buildNativeJob,
		[
			"runner: ubuntu-latest",
			"platform: linux/amd64",
			"runner: ubuntu-24.04-arm",
			"platform: linux/arm64",
		],
		"build-native matrix",
	);

	const verifyStep = getStepBlock(buildNativeJob, "Verify workflow contract");
	expect(verifyStep, "Missing workflow contract verification step");

	if (verifyStep) {
		expect(
			verifyStep.includes("run: node scripts/ci/verify-publish-deploy-webhook-image-workflow.mjs"),
			"Workflow contract verification step must run the deploy webhook verifier",
		);
	}

	const buildStep = getStepBlock(buildNativeJob, "Build and push deploy webhook image by digest");
	expect(buildStep, "Missing deploy webhook image build step");

	if (buildStep) {
		includesAll(
			buildStep,
			[
				"file: ./docker/Dockerfile.deploy-webhook",
				"outputs: type=image,name=ghcr.io/umami-creative-gmbh/z8-deploy-webhook,push-by-digest=true,name-canonical=true,push=true",
				"labels: |",
				"org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}",
			],
			"deploy webhook image build step",
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
			"name: digests-deploy-webhook-amd64",
			"path: /tmp/digests/amd64",
			"name: Download arm64 digest",
			"name: digests-deploy-webhook-arm64",
			"path: /tmp/digests/arm64",
			"uses: docker/metadata-action@v5",
			"images: ghcr.io/umami-creative-gmbh/z8-deploy-webhook",
			"type=raw,value=latest,enable={{is_default_branch}}",
			"type=sha,prefix=sha-",
			"type=semver,pattern=v{{version}}",
			"type=semver,pattern=v{{major}}.{{minor}}",
			"type=semver,pattern=v{{major}}",
			"IMAGE_NAME: ghcr.io/umami-creative-gmbh/z8-deploy-webhook",
			"TAGS: ${{ steps.meta.outputs.tags }}",
		],
		"publish-manifest",
	);

	includesAll(
		publishManifestJob,
		[
			'set -- /tmp/digests/amd64/*',
			'AMD64_DIGEST="sha256:${1##*/}"',
			'set -- /tmp/digests/arm64/*',
			'ARM64_DIGEST="sha256:${1##*/}"',
			'for tag in $TAGS; do',
			'docker buildx imagetools create \\',
			'--annotation "index:org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}"',
			'-t "$tag" \\',
			'"$IMAGE_NAME@$AMD64_DIGEST" \\',
			'"$IMAGE_NAME@$ARM64_DIGEST"',
		],
		"publish-manifest",
	);
}

if (cleanupPackageVersionsJob) {
	includesAll(
		cleanupPackageVersionsJob,
		[
			"name: Cleanup Package Versions",
			"needs: publish-manifest",
			"if: ${{ github.event_name != 'pull_request' }}",
			"uses: actions/delete-package-versions@v5",
			"owner: umami-creative-gmbh",
			"package-name: z8-deploy-webhook",
			"package-type: container",
			"min-versions-to-keep: 10",
			"ignore-versions: '^(latest|v.*)$'",
		],
		"cleanup-package-versions",
	);
}

if (errors.length > 0) {
	console.error("Publish deploy webhook image workflow contract failed:");
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log("Publish deploy webhook image workflow contract OK");
