import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "@/lib/cron/registry";
import {
	BATCH_HEARTBEAT_INTERVAL_ITEMS,
	BATCH_LEASE_DURATION_MS,
	computeBatchRequestFingerprint,
	contractChangeBatchJobId,
	INLINE_BATCH_THRESHOLD,
	RECOVERY_PENDING_AGE_MS,
} from "./bulk-batch-engine";

describe("contract change batch engine invariants (#1928)", () => {
	it("computes identical canonical fingerprints regardless of key or employee item order", () => {
		const a = computeBatchRequestFingerprint({
			organizationId: "org-1",
			operationKind: "bulk_terms_update",
			payload: { b: 2, a: 1, nested: { z: true, y: false } },
			items: [
				{ employeeId: "00000000-0000-4000-8000-000000000002", payload: { x: 2, a: 1 } },
				{ employeeId: "00000000-0000-4000-8000-000000000001", payload: { k: "v" } },
			],
		});
		const b = computeBatchRequestFingerprint({
			organizationId: "org-1",
			operationKind: "bulk_terms_update",
			payload: { nested: { y: false, z: true }, a: 1, b: 2 },
			items: [
				{ employeeId: "00000000-0000-4000-8000-000000000001", payload: { k: "v" } },
				{ employeeId: "00000000-0000-4000-8000-000000000002", payload: { a: 1, x: 2 } },
			],
		});
		const different = computeBatchRequestFingerprint({
			organizationId: "org-1",
			operationKind: "bulk_terms_update",
			payload: { a: 1, b: 3, nested: { y: false, z: true } },
			items: [
				{ employeeId: "00000000-0000-4000-8000-000000000001", payload: { k: "v" } },
				{ employeeId: "00000000-0000-4000-8000-000000000002", payload: { a: 1, x: 2 } },
			],
		});

		expect(a).toBe(b);
		expect(a).toHaveLength(64);
		expect(a).not.toBe(different);
	});

	it("matches spec #1928 thresholds, lease timings, job id format, and cron registration", () => {
		expect(INLINE_BATCH_THRESHOLD).toBe(200);
		expect(BATCH_LEASE_DURATION_MS).toBe(60_000);
		expect(BATCH_HEARTBEAT_INTERVAL_ITEMS).toBe(10);
		expect(RECOVERY_PENDING_AGE_MS).toBe(10_000);
		expect(contractChangeBatchJobId("abc-123")).toBe("contract-change-batch-abc-123");
		expect(CRON_JOBS["cron:contract-batch-recovery"]).toMatchObject({
			schedule: "* * * * *",
			defaultJobOptions: { attempts: 1, priority: 8 },
		});
	});
});
