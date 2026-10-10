/**
 * PostgreSQL contract (#1000): time off in lieu reaches new organizations active and
 * organizations that existed before it inactive, with one in-app notice for each of their
 * owners and admins.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { deliverAbsenceCategoryNotices } from "./category-notices";
import { ensureDefaultAbsenceCategoriesForOrganization } from "./default-absence-categories";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

const NOW = parseInstant("2026-10-10T08:00:00Z");

describe("time off in lieu for new and existing organizations", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An organization that existed before #1000: seeded the way migration 0195 seeds it. */
	async function existingOrganization() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const member = await fixture.seedEmployee({ organizationId });
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_work_time, requires_approval,
				counts_against_vacation, draws_on_work_balance, is_active, updated_at)
			 values ($1, $2, 'time_off_in_lieu', 'Time off in lieu', false, true, false, true, false, now())`,
			[categoryId, organizationId],
		);
		await fixture.pool.query(
			"insert into absence_category_notice (organization_id, category_id) values ($1, $2)",
			[organizationId, categoryId],
		);
		return { organizationId, owner, admin, member, categoryId };
	}

	async function noticesFor(userId: string, organizationId: string) {
		const { rows } = await fixture.pool.query<{
			type: string;
			action_url: string;
			metadata: string;
		}>(
			`select type, action_url, metadata from notification
			 where user_id = $1 and organization_id = $2 and type = 'time_off_in_lieu_available'`,
			[userId, organizationId],
		);
		return rows;
	}

	it("tells each owner and admin of an existing organization once, in-app", async () => {
		const org = await existingOrganization();

		await deliverAbsenceCategoryNotices(fixture.db, { now: NOW });
		await deliverAbsenceCategoryNotices(fixture.db, { now: NOW });

		for (const recipient of [org.owner, org.admin]) {
			const notices = await noticesFor(recipient.userId, org.organizationId);
			expect(notices).toHaveLength(1);
			expect(notices[0]?.action_url).toBe("/settings/vacation");
			expect(JSON.parse(notices[0]?.metadata ?? "{}").i18n).toMatchObject({
				titleKey: "common:notifications.content.timeOffInLieuAvailable.title",
				messageKey: "common:notifications.content.timeOffInLieuAvailable.message",
			});
		}
		expect(await noticesFor(org.member.userId, org.organizationId)).toEqual([]);
		const { rows } = await fixture.pool.query<{ delivered_at: Date | null }>(
			"select delivered_at from absence_category_notice where category_id = $1",
			[org.categoryId],
		);
		expect(rows[0]?.delivered_at).not.toBeNull();
	});

	it("never tells an admin of another organization", async () => {
		const org = await existingOrganization();
		const other = await fixture.createOrganization();
		const otherAdmin = await fixture.seedEmployee({ organizationId: other, role: "admin" });

		await deliverAbsenceCategoryNotices(fixture.db, { now: NOW });

		expect(await noticesFor(otherAdmin.userId, other)).toEqual([]);
		expect(await noticesFor(otherAdmin.userId, org.organizationId)).toEqual([]);
	});

	it("gives a new organization the built-in category active, without a notice", async () => {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });

		await ensureDefaultAbsenceCategoriesForOrganization(organizationId);
		await deliverAbsenceCategoryNotices(fixture.db, { now: NOW });

		const { rows } = await fixture.pool.query<{
			is_active: boolean;
			draws_on_work_balance: boolean;
			requires_approval: boolean;
		}>(
			`select is_active, draws_on_work_balance, requires_approval from absence_category
			 where organization_id = $1 and type = 'time_off_in_lieu'`,
			[organizationId],
		);
		expect(rows).toEqual([
			{ is_active: true, draws_on_work_balance: true, requires_approval: true },
		]);
		expect(await noticesFor(owner.userId, organizationId)).toEqual([]);
	});

	it("seeds an organization that existed before the migration inactive, with one pending notice", async () => {
		const organizationId = await fixture.createOrganization();
		const migration = await readFile(
			fileURLToPath(new URL("../../../drizzle/0195_time_off_in_lieu.sql", import.meta.url)),
			"utf8",
		);
		const seeding = migration.split("--> statement-breakpoint").at(-1) ?? "";
		const client = await fixture.pool.connect();
		try {
			// The statement seeds every organization: look inside the transaction, then undo it.
			await client.query("begin");
			await client.query(seeding);
			await client.query(seeding);
			const categories = await client.query<{ id: string; is_active: boolean }>(
				"select id, is_active from absence_category where organization_id = $1",
				[organizationId],
			);
			const notices = await client.query<{ category_id: string }>(
				"select category_id from absence_category_notice where organization_id = $1",
				[organizationId],
			);
			expect(categories.rows).toEqual([{ id: expect.any(String), is_active: false }]);
			expect(notices.rows).toEqual([{ category_id: categories.rows[0]?.id }]);
		} finally {
			await client.query("rollback");
			client.release();
		}
	});
});
