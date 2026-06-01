import { describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "./registry";

const runBillingSeatReconciliation = vi.fn(async () => ({
	success: true,
	billingEnabled: true,
	processed: 0,
	synced: 0,
	skipped: 0,
	errors: [],
}));

vi.mock("@/lib/jobs/billing-seat-reconciliation", () => ({
	runBillingSeatReconciliation,
}));

describe("CRON_JOBS execution cleanup", () => {
	it("registers the daily execution cleanup cron with tracking metadata", () => {
		expect(CRON_JOBS["cron:execution-cleanup"]).toMatchObject({
			schedule: "30 2 * * *",
			description: "Delete cron execution records older than 90 days",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});
	});
});

describe("CRON_JOBS billing seat reconciliation", () => {
	it("registers the hourly billing seat reconciliation cron", async () => {
		expect(CRON_JOBS["cron:billing-seat-reconciliation"]).toMatchObject({
			schedule: "0 * * * *",
			defaultJobOptions: { attempts: 2, priority: 8 },
		});
		expect(CRON_JOBS["cron:billing-seat-reconciliation"].description).toContain(
			"billing seat reconciliation",
		);

		await CRON_JOBS["cron:billing-seat-reconciliation"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(runBillingSeatReconciliation).toHaveBeenCalledOnce();
	});
});
