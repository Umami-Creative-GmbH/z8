import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ledgerPath = new URL("./digest-delivery-ledger.ts", import.meta.url);

describe("Telegram digest delivery ledger", () => {
	it("atomically claims only a new or failed recipient-local digest", async () => {
		const source = await readFile(ledgerPath, "utf8");

		expect(source).toContain(
			'ON CONFLICT ("organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date")',
		);
		expect(source).toContain('WHERE "telegram_digest_delivery"."status" = \'failed\'');
		expect(source).toContain('RETURNING "id"');
	});

	it("keeps recipients, tenants, and recipient-local dates in the delivery key", async () => {
		const source = await readFile(ledgerPath, "utf8");

		expect(source).toContain("organizationId: string");
		expect(source).toContain("recipientEmployeeId: string");
		expect(source).toContain("recipientUserId: string");
		expect(source).toContain("logicalDate: string");
		expect(source).not.toContain("digestTimezone");
	});
});
