import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { organization, user } from "../../auth-schema";
import { dailyDigestDelivery } from "../daily-digest-delivery";
import { telegramDigestDelivery } from "../telegram-integration";

function sqlText(value: SQL): string {
	return new PgDialect().sqlToQuery(value).sql;
}

describe("digest delivery schema", () => {
	it("models the journaled Telegram updated_at default and status check", () => {
		const config = getTableConfig(telegramDigestDelivery);
		const updatedAt = config.columns.find(
			(column) => column.name === "updated_at",
		);
		const statusCheck = config.checks.find(
			(check) => check.name === "telegram_digest_delivery_status_check",
		);

		expect(updatedAt?.default).toBeDefined();
		expect(sqlText(updatedAt?.default as SQL)).toBe("now()");
		expect(statusCheck).toBeDefined();
		expect(sqlText(statusCheck?.value as SQL)).toContain(
			"IN ('sending', 'sent', 'failed')",
		);
	});

	it("models the historical daily digest status check", () => {
		const statusCheck = getTableConfig(dailyDigestDelivery).checks.find(
			(check) => check.name === "daily_digest_delivery_status_check",
		);

		expect(statusCheck).toBeDefined();
		expect(sqlText(statusCheck?.value as SQL)).toContain(
			"IN ('processing', 'sent', 'failed')",
		);
	});

	it("uses the historical implicit names for daily digest foreign keys", () => {
		const foreignKeys = new Map(
			getTableConfig(dailyDigestDelivery).foreignKeys.map((foreignKey) => [
				foreignKey.getName(),
				foreignKey,
			]),
		);
		const organizationForeignKey = foreignKeys.get(
			"daily_digest_delivery_organization_id_fkey",
		);
		const recipientForeignKey = foreignKeys.get(
			"daily_digest_delivery_recipient_user_id_fkey",
		);
		const organizationReference = organizationForeignKey?.reference();
		const recipientReference = recipientForeignKey?.reference();

		expect([...foreignKeys.keys()].sort()).toEqual([
			"daily_digest_delivery_organization_id_fkey",
			"daily_digest_delivery_recipient_user_id_fkey",
		]);
		expect(organizationReference?.columns.map((column) => column.name)).toEqual(
			["organization_id"],
		);
		expect(organizationReference?.foreignColumns).toEqual([organization.id]);
		expect(organizationForeignKey?.onDelete).toBe("cascade");
		expect(recipientReference?.columns.map((column) => column.name)).toEqual([
			"recipient_user_id",
		]);
		expect(recipientReference?.foreignColumns).toEqual([user.id]);
		expect(recipientForeignKey?.onDelete).toBe("cascade");
	});
});
