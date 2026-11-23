/**
 * #1977: the `/compliance` command center counts the pending compliance exceptions the Approval
 * inbox it links to lists, so one whose validity window has passed is not counted.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { getWorkforceComplianceSection } from "./workforce-compliance";

describe("workforce compliance section on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	it("counts only pending exceptions whose validity window is still open", async () => {
		const { organizationId, ownerUserId } = await fixture.organization("Europe/Berlin");
		const { employeeId } = await fixture.employee({ organizationId });
		const now = systemClock.nowInstant();
		const exception = async (input: { createdAt: Instant; validUntil: Instant }) => {
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason, valid_from, valid_until,
				  created_at, created_by, updated_at)
				 values ($1, $2, $3, 'overtime_daily', 'pending', 'Inventory', $4, $5, $4, $6, $4)`,
				[
					randomUUID(),
					organizationId,
					employeeId,
					dateFromInstant(input.createdAt),
					dateFromInstant(input.validUntil),
					ownerUserId,
				],
			);
		};
		await exception({ createdAt: now.subtract({ hours: 2 }), validUntil: now.add({ hours: 22 }) });
		await exception({
			createdAt: now.subtract({ hours: 48 }),
			validUntil: now.subtract({ hours: 24 }),
		});

		const section = await getWorkforceComplianceSection(organizationId);

		expect(section.card.facts).toContainEqual({
			key: "compliance.commandCenter.facts.workforce.pendingExceptions",
			params: { count: 1 },
		});
	});
});
