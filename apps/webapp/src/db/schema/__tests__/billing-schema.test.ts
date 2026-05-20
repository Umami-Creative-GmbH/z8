import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { subscription } from "@/db/schema/billing";

const migrationSql = readFileSync(
	new URL("../../../../drizzle/0023_billing_local_trials.sql", import.meta.url),
	"utf8",
);

const migrationJournal = JSON.parse(
	readFileSync(new URL("../../../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

const migrationSnapshot = JSON.parse(
	readFileSync(
		new URL("../../../../drizzle/meta/0023_snapshot.json", import.meta.url),
		"utf8",
	),
) as {
	tables: {
		"public.subscription": {
			columns: { stripe_customer_id: { notNull: boolean } };
			indexes: { subscription_stripe_customer_id_idx: { where?: string } };
		};
	};
};

describe("billing schema", () => {
	it("allows local trial rows without a Stripe customer", () => {
		const trialRow: typeof subscription.$inferInsert = {
			organizationId: "org_123",
			status: "trialing",
			trialStart: new Date("2026-05-20T00:00:00.000Z"),
			trialEnd: new Date("2026-06-03T00:00:00.000Z"),
			currentSeats: 0,
		};

		expect(trialRow.stripeCustomerId).toBeUndefined();
		expect(trialRow.status).toBe("trialing");
	});

	it("marks Stripe customer IDs nullable in Drizzle metadata", () => {
		expect(subscription.stripeCustomerId.notNull).toBe(false);
	});

	it("keeps the local trial migration metadata in sync", () => {
		expect(migrationSql).toContain(
			'ALTER COLUMN "stripe_customer_id" DROP NOT NULL',
		);
		expect(migrationSql).toMatch(
			/WHERE\s+"stripe_customer_id"\s+IS\s+NOT\s+NULL/i,
		);
		expect(migrationJournal.entries).toContainEqual(
			expect.objectContaining({ idx: 23, tag: "0023_billing_local_trials" }),
		);
		expect(
			migrationSnapshot.tables["public.subscription"].columns.stripe_customer_id
				.notNull,
		).toBe(false);
		expect(
			migrationSnapshot.tables["public.subscription"].indexes
				.subscription_stripe_customer_id_idx.where,
		).toBe("stripe_customer_id IS NOT NULL");
	});
});
