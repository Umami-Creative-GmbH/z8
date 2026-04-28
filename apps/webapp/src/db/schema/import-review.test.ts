import { describe, expect, it } from "vitest";
import {
	importBatch,
	importBatchJob,
	importIssue,
	importJobSecret,
	importRejectedExport,
	importStagedRow,
} from "./index";

describe("import review schema exports", () => {
	it("exports all import review tables", () => {
		expect(importBatch).toBeDefined();
		expect(importBatchJob).toBeDefined();
		expect(importStagedRow).toBeDefined();
		expect(importIssue).toBeDefined();
		expect(importRejectedExport).toBeDefined();
		expect(importJobSecret).toBeDefined();
	});
});
