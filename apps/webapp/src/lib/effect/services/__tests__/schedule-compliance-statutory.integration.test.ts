/**
 * #1988 seam: statutory contributors registered in `@/lib/statutory/scheduling/contributors`
 * reach the schedule compliance evaluation (publish handshake and banner) as wage-free
 * `statutory` findings, counted and fingerprinted like the regulation findings.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import type { StatutoryFinding } from "@/lib/statutory/finding";
import type { StatutoryScheduleContext } from "@/lib/statutory/scheduling/contributor";
import { DatabaseServiceLive } from "../database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "../schedule-compliance.service";
import { WorkPolicyService } from "../work-policy.service";

const contributor = vi.hoisted(() => ({ contexts: [] as unknown[] }));

vi.mock("@/lib/statutory/scheduling/contributors", () => ({
	statutoryScheduleContributors: [
		{
			domain: "minijob",
			evaluate: async (context: StatutoryScheduleContext): Promise<StatutoryFinding[]> => {
				contributor.contexts.push(context);
				return context.employeeIds.map((employeeId) => ({
					id: `minijob_monthly_cap:${employeeId}:2026-03`,
					organizationId: context.organizationId,
					employeeId,
					domain: "minijob",
					kind: "minijob_monthly_cap",
					severity: "critical",
					subjectKey: "2026-03",
					periodStart: "2026-03-01",
					periodEnd: "2026-04-01",
					legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
					summary: { tier: "exceeded", usedPercent: 104 },
					adminDetail: { currency: "EUR", amountsCents: { earned: 62_700, cap: 60_300 } },
					inputFingerprint: "v1:test",
					acknowledgementKind: "minijob_unforeseeable_exceedance",
				}));
			},
		},
	],
}));

const workPolicyLayer = Layer.succeed(WorkPolicyService, {
	getEffectivePolicy: () => Effect.succeed(null),
} as never);

const serviceLayer = ScheduleComplianceServiceLive.pipe(
	Layer.provide(workPolicyLayer),
	Layer.provide(DatabaseServiceLive),
);

describe("schedule compliance with statutory contributors (PostgreSQL)", () => {
	const timezone = "Europe/Berlin";
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("adds wage-free statutory findings for assigned employees to the evaluation", async () => {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [
			organizationId,
			timezone,
		]);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const person = await fixture.seedEmployee({ organizationId });
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '09:00', '17:00', 'draft', $6, now())`,
			[
				randomUUID(),
				organizationId,
				person.employeeId,
				subareaId,
				shiftDateBounds("2026-03-04", timezone).start,
				creator.userId,
			],
		);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ScheduleComplianceService;
				return yield* service.evaluateScheduleWindow({
					organizationId,
					startDate: shiftDateBounds("2026-03-02", timezone).start,
					endDateExclusive: shiftDateBounds("2026-03-09", timezone).start,
					timezone,
				});
			}).pipe(Effect.provide(serviceLayer)),
		);

		expect(contributor.contexts).toHaveLength(1);
		expect(contributor.contexts[0]).toMatchObject({
			organizationId,
			timezone,
			window: { start: "2026-03-02", endExclusive: "2026-03-09" },
			employeeIds: [person.employeeId],
			proposedShifts: [],
		});
		expect(result.summary).toEqual({
			totalFindings: 1,
			byType: { restTime: 0, maxHours: 0, overtime: 0, statutory: 1 },
		});
		expect(result.findings).toEqual([
			expect.objectContaining({
				type: "statutory",
				employeeId: person.employeeId,
				statutoryKind: "minijob_monthly_cap",
				severity: "critical",
				// Earnings-derived: a percentage of the public Minijob cap would reveal earnings.
				summary: { tier: "exceeded" },
				acknowledgementStatus: "none",
				blocksPublication: false,
			}),
		]);
		expect(JSON.stringify(result.findings)).not.toMatch(/62700|60300|EUR/);
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});
});
