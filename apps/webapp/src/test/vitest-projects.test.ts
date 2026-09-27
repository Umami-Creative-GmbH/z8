import { glob } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";

const appDirectory = fileURLToPath(new URL("../..", import.meta.url));

async function discoveredFilesByProject() {
	const vitest = await createVitest("test", {
		config: path.join(appDirectory, "vitest.config.ts"),
		root: appDirectory,
		watch: false,
	});
	try {
		const specifications = await vitest.globTestSpecifications();
		const files = new Map<string, string[]>();
		for (const specification of specifications) {
			const name = specification.project.name;
			const relative = path.relative(appDirectory, specification.moduleId).replaceAll("\\", "/");
			files.set(name, [...(files.get(name) ?? []), relative]);
		}
		return files;
	} finally {
		await vitest.close();
	}
}

async function integrationSuitesOnDisk() {
	const files: string[] = [];
	for await (const file of glob("src/**/*.integration.test.ts", { cwd: appDirectory })) {
		files.push(file.replaceAll("\\", "/"));
	}
	return files;
}

const redisSuite = "src/lib/cron/legacy-escalation-schedulers.redis.integration.test.ts";

describe("vitest projects", () => {
	it("discovers every PostgreSQL integration suite by glob and keeps it out of the unit run", async () => {
		const [projects, onDisk] = await Promise.all([
			discoveredFilesByProject(),
			integrationSuitesOnDisk(),
		]);
		const postgresSuites = onDisk.filter((file) => file !== redisSuite);
		const unit = projects.get("unit") ?? [];
		const integration = projects.get("integration") ?? [];

		expect(postgresSuites.length).toBeGreaterThanOrEqual(86);
		expect([...integration].sort()).toEqual([...postgresSuites].sort());
		expect(unit.filter((file) => integration.includes(file))).toEqual([]);
		expect(unit).toContain(redisSuite);
		expect(unit).toContain("src/test/vitest-projects.test.ts");
	}, 60_000);
});
