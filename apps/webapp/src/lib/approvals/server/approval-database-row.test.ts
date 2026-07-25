import { describe, expect, it } from "vitest";
import {
	decodeApprovalDatabaseInstant,
	decodeApprovalDatabaseTimestamp,
} from "../approval-database-row";

describe("approval database row decoding", () => {
	it("distinguishes explicit-offset instants from UTC timestamp-without-zone values", () => {
		expect(
			decodeApprovalDatabaseInstant("2026-07-25 20:39:41.104+00").toISOString(),
		).toBe("2026-07-25T20:39:41.104Z");
		expect(
			decodeApprovalDatabaseTimestamp("2026-07-22 16:00:00").toISOString(),
		).toBe("2026-07-22T16:00:00.000Z");
		expect(() =>
			decodeApprovalDatabaseTimestamp("2026-07-25 20:39:41.104+00"),
		).toThrow("Invalid PostgreSQL timestamp without time zone");
	});
});
