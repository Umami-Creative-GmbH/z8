import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

type InlineProject = {
	extends?: boolean;
	test?: {
		name?: string;
		include?: string[];
		exclude?: string[];
		fileParallelism?: boolean;
		setupFiles?: string[];
		env?: Record<string, string>;
	};
};

function project(name: string) {
	const projects = (vitestConfig.test?.projects ?? []) as InlineProject[];
	const match = projects.find((entry) => entry.test?.name === name);
	if (!match?.test) throw new Error(`Vitest project ${name} is not declared`);
	return { ...match, test: match.test };
}

async function readPackageScripts() {
	const packagePath = fileURLToPath(
		new URL("../../package.json", import.meta.url),
	);
	const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
		scripts: Record<string, string>;
	};
	return packageJson.scripts;
}

describe("vitest projects", () => {
	it("discovers PostgreSQL suites by suffix, never from a list", () => {
		const unit = project("unit");
		const integration = project("integration");

		expect(vitestConfig.test?.include).toBeUndefined();
		expect(unit.extends).toBe(true);
		expect(unit.test.include).toEqual(["src/**/*.test.{ts,tsx}"]);
		expect(unit.test.exclude).toContain("**/*.integration.test.ts");
		expect(integration.extends).toBe(true);
		expect(integration.test.include).toEqual(["src/**/*.integration.test.ts"]);
	});

	it("marks the unit project so database gates can refuse misnamed suites", () => {
		expect(project("unit").test.env).toEqual({ Z8_TEST_PROJECT: "unit" });
	});

	it("runs integration suites serially in UTC", () => {
		const integration = project("integration").test;

		expect(integration.fileParallelism).toBe(false);
		expect(integration.env).toEqual({
			Z8_TEST_PROJECT: "integration",
			TZ: "UTC",
			PGOPTIONS: "-c statement_timeout=15000 -c timezone=UTC",
		});
	});

	it("gives every integration suite the one database gate, pool and @/db binding", () => {
		expect(project("integration").test.setupFiles).toEqual([
			"./src/test/integration-setup.ts",
		]);
		expect(project("unit").test.setupFiles).not.toContain(
			"./src/test/integration-setup.ts",
		);
	});

	it("keeps pnpm test database-free and routes test:integration through the Docker runner", async () => {
		const scripts = await readPackageScripts();

		expect(scripts.test).toBe(
			"pnpm run i18n:metadata && vitest run --project unit",
		);
		expect(scripts["test:integration"]).toBe(
			"bash ./scripts/run-approval-workflow-repository-integration.sh",
		);
	});
});
