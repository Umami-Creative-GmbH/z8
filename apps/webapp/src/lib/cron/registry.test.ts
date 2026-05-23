import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "./registry";

describe("CRON_JOBS execution cleanup", () => {
	it("registers the daily execution cleanup cron with tracking metadata", () => {
		expect(CRON_JOBS["cron:execution-cleanup"]).toMatchObject({
			schedule: "30 2 * * *",
			description: "Delete cron execution records older than 90 days",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});
	});
});
