import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBuildInvocation } from "./build.mjs";

test("ordinary builds retain Turbo cache reuse and CI mode", () => {
	assert.deepEqual(createBuildInvocation(["--filter=webapp"], {}), {
		command: ["exec", "turbo", "build", "--filter=webapp"],
		env: { CI: "true" },
	});
});

test("sourcemap uploads execute even when the build task has a matching cache entry", () => {
	const environment = {
		NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "public-project",
		POSTHOG_PROJECT_ID: "project",
		POSTHOG_API_KEY: "upload-credential",
	};
	assert.deepEqual(createBuildInvocation([], environment).command, [
		"exec",
		"turbo",
		"build",
		"--force",
	]);
	for (const key of Object.keys(environment)) {
		assert.ok(
			!createBuildInvocation([], { ...environment, [key]: "" }).command.includes("--force"),
		);
	}
	assert.deepEqual(createBuildInvocation(["--dir", "apps/webapp"], environment).command, [
		"--dir",
		"apps/webapp",
		"build",
	]);
});

test("the Turbo hash includes private build identity and key inputs, not the upload credential", async () => {
	const config = JSON.parse(await readFile(new URL("../turbo.json", import.meta.url), "utf8"));
	const inputNames = config.tasks.build.env;
	for (const name of [
		"NEXT_DEPLOYMENT_ID",
		"BUILD_HASH",
		"VERCEL_GIT_COMMIT_SHA",
		"GITHUB_SHA",
		"CI_COMMIT_SHA",
		"NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
		"POSTHOG_PROJECT_ID",
		"SKIP_ENV_VALIDATION",
		"Z8_INSTANT_NAV_TEST",
	]) {
		assert.ok(inputNames.includes(name), `${name} affects build output`);
	}
	assert.ok(config.tasks.build.passThroughEnv.includes("POSTHOG_API_KEY"));
	assert.ok(!inputNames.includes("POSTHOG_API_KEY"));
});
