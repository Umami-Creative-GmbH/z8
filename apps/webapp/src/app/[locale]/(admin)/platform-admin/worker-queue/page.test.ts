import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("WorkerQueueContent request boundary", () => {
	it("authorizes before entering the live Effect-backed stats operation", () => {
		const contentStart = source.indexOf("async function WorkerQueueContent");
		const contentEnd = source.indexOf(
			"\nfunction WorkerQueueLoading",
			contentStart,
		);
		const contentSource = source.slice(contentStart, contentEnd);
		const authorizationIndex = contentSource.indexOf(
			"await requirePlatformAdmin();",
		);
		const connectionIndex = contentSource.indexOf("await connection();");
		const statsIndex = contentSource.indexOf(
			"const statsResult = await getWorkerQueueStats();",
		);

		expect(authorizationIndex).toBeGreaterThanOrEqual(0);
		expect(connectionIndex).toBeGreaterThan(authorizationIndex);
		expect(statsIndex).toBeGreaterThan(connectionIndex);
		expect(contentSource).not.toMatch(/["']use cache/);
	});
});
