import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(scriptDir, "../../.github/workflows/publish-images.yml");

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

const publishTargetsJob = getJobBlock("publish-targets");
const publishManifestsJob = getJobBlock("publish-manifests");

expect(publishTargetsJob, "Missing publish-targets job");
expect(publishManifestsJob, "Missing publish-manifests job");

if (publishTargetsJob) {
	const verifyStep = getStepBlock(publishTargetsJob, "Verify workflow contract");
	expect(verifyStep, "publish-targets missing Verify workflow contract step");

	if (verifyStep) {
		expect(
			verifyStep.includes("run: node scripts/ci/verify-publish-images-workflow.mjs"),
			"publish-targets Verify workflow contract step must run the publish images verifier",
		);
	}

	includesAll(
		publishTargetsJob,
		[
			"name: Publish Target (${{ matrix.repository }} ${{ matrix.arch }})",
			"name: Checkout",
			"uses: docker/setup-buildx-action@v3",
			"uses: docker/login-action@v3",
			"name: target-digest-${{ matrix.repository }}-${{ matrix.arch }}",
			'echo "::error::target artifact digest is empty"',
		],
		"publish-targets",
	);

	const includeMatches = [
		...publishTargetsJob.matchAll(
			/repository: (z8-webapp|z8-worker|z8-migration)\n\s+dockerfile: (docker\/Dockerfile\.webapp|docker\/Dockerfile\.worker|docker\/Dockerfile\.migration)\n\s+arch: (amd64|arm64)/g,
		),
	];
	expect(
		includeMatches.length === 6,
		`publish-targets expected 6 matrix entries, found ${includeMatches.length}`,
	);

	const expectedMatrixEntries = new Set([
		"z8-webapp:docker/Dockerfile.webapp:amd64",
		"z8-webapp:docker/Dockerfile.webapp:arm64",
		"z8-worker:docker/Dockerfile.worker:amd64",
		"z8-worker:docker/Dockerfile.worker:arm64",
		"z8-migration:docker/Dockerfile.migration:amd64",
		"z8-migration:docker/Dockerfile.migration:arm64",
	]);

	for (const match of includeMatches) {
		expectedMatrixEntries.delete(`${match[1]}:${match[2]}:${match[3]}`);
	}

	expect(
		publishTargetsJob.includes("file: ./${{ matrix.dockerfile }}"),
		"publish-targets build step must use file: ./${{ matrix.dockerfile }}",
	);

	expect(
		expectedMatrixEntries.size === 0,
		`publish-targets missing matrix entries: ${[...expectedMatrixEntries].join(", ")}`,
	);

	expect(
		!publishTargetsJob.includes("build-shared"),
		"publish-targets still references removed build-shared job",
	);
	expect(
		!publishTargetsJob.includes("shared-runtime-${{ matrix.arch }}"),
		"publish-targets still references shared-runtime artifacts",
	);
	expect(
		!publishTargetsJob.includes("RUNTIME_BASE_IMAGE=${{ env.RUNTIME_BASE_IMAGE }}"),
		"publish-targets still passes shared runtime build arg",
	);
}

if (publishManifestsJob) {
	includesAll(
		publishManifestsJob,
		[
			"name: Publish Manifests (${{ matrix.repository }})",
			"needs: publish-targets",
			"uses: docker/setup-buildx-action@v3",
			"uses: docker/login-action@v3",
			"name: target-digest-${{ matrix.repository }}-amd64",
			"name: target-digest-${{ matrix.repository }}-arm64",
			"uses: docker/metadata-action@v5",
			"type=raw,value=latest,enable={{is_default_branch}}",
			"type=sha,prefix=sha-",
			"type=semver,pattern=v{{version}}",
			"type=semver,pattern=v{{major}}.{{minor}}",
			"type=semver,pattern=v{{major}}",
			'AMD64_REFERENCE="$(tr -d \'\\n\' < "${DIGEST_ROOT}/targets/amd64/reference.txt")"',
			'ARM64_REFERENCE="$(tr -d \'\\n\' < "${DIGEST_ROOT}/targets/arm64/reference.txt")"',
			'"$AMD64_REFERENCE"',
			'"$ARM64_REFERENCE"',
		],
		"publish-manifests",
	);

	expect(
		!publishManifestsJob.includes("if: ${{ false }}"),
		"publish-manifests still has temporary false gate",
	);

	const validateTargetArtifactsStep = getStepBlock(
		publishManifestsJob,
		"Validate target artifacts",
	);
	expect(validateTargetArtifactsStep, "publish-manifests missing Validate target artifacts step");

	if (validateTargetArtifactsStep) {
		includesAll(
			validateTargetArtifactsStep,
			[
				"reference.txt",
				"digest.txt",
				"repository.txt",
				"arch.txt",
				'ARTIFACT_REFERENCE="$(tr -d \'\\n\' < "${artifact_dir}/reference.txt")"',
				'ARTIFACT_DIGEST="$(tr -d \'\\n\' < "${artifact_dir}/digest.txt")"',
				'ARTIFACT_REPOSITORY="$(tr -d \'\\n\' < "${artifact_dir}/repository.txt")"',
				'if [ "${ARTIFACT_REFERENCE}" != "${ARTIFACT_REPOSITORY}@${ARTIFACT_DIGEST}" ]; then',
			],
			"publish-manifests Validate target artifacts",
		);
	}
}

expect(
	!workflow.includes("name: Build Native (${{ matrix.repository }} ${{ matrix.arch }})"),
	"Legacy Build Native job name still present",
);
expect(!workflow.includes("  build-shared:"), "Removed build-shared job still present");
expect(!workflow.includes("file: ./Dockerfile"), "Retired root Dockerfile reference still present");
expect(!workflow.includes("SHARED_RUNTIME_REPOSITORY"), "Shared runtime repository env still present");
expect(
	!workflow.includes("name: digests-${{ matrix.repository }}-${{ matrix.arch }}"),
	"Legacy digest artifact name still present",
);

if (errors.length > 0) {
	console.error("Publish images workflow contract failed:");
	for (const error of errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

console.log("Publish images workflow contract OK");
