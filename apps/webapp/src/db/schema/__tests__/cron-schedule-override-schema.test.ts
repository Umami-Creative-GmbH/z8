import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cronScheduleOverride } from "../cron-job";

describe("cronScheduleOverride schema", () => {
	it("uses the expected table and column names", () => {
		expect(getTableName(cronScheduleOverride)).toBe("cron_schedule_override");
		expect(cronScheduleOverride.jobName.name).toBe("job_name");
		expect(cronScheduleOverride.presetId.name).toBe("preset_id");
		expect(cronScheduleOverride.pattern.name).toBe("pattern");
		expect(cronScheduleOverride.updatedBy.name).toBe("updated_by");
	});
});
