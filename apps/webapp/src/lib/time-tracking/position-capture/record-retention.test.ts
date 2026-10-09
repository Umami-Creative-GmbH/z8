import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_LOG_RETENTION_DAYS } from "@/lib/audit/retention";

describe("position access-log retention guard", () => {
	it("lets deletes through only past the audit-log lifetime the cleanup uses", () => {
		const migration = readFileSync(
			path.resolve(__dirname, "../../../../drizzle/0145_position_access_log_retention.sql"),
			"utf8",
		);

		expect(AUDIT_LOG_RETENTION_DAYS).toBe(365);
		expect(migration).toContain(
			`OLD.accessed_at < (now() AT TIME ZONE 'UTC') - interval '${AUDIT_LOG_RETENTION_DAYS} days'`,
		);
		// Parent-deletion cascades pass by checking the parent, never through a session flag.
		expect(migration).not.toContain("current_setting(");
	});
});
