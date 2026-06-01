import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "reliability-charts.tsx");

describe("WorkerReliabilityCharts", () => {
	it("does not wrap lazy chart UI exports in next/dynamic", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).not.toContain('import("@/components/ui/chart")');
	});
});
