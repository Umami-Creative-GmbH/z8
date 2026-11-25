/**
 * #1988 seam: statutory contributors registered in `@/lib/statutory/scheduling/contributors`
 * reach Staffing suggestions as wage-free compliance warnings for the candidates a proposed shift
 * would push over a limit, and an edited shift is evaluated as replacing its saved version.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import type { StaffingShiftInput } from "@/lib/scheduling/staffing/types";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import type { StatutoryFinding } from "@/lib/statutory/finding";
import type { StatutoryScheduleContext } from "@/lib/statutory/scheduling/contributor";
import { DatabaseServiceLive } from "../database.service";
import {
	type StaffingCandidate,
	StaffingSuggestionService,
	StaffingSuggestionServiceLive,
} from "../staffing-suggestion.service";
import { WorkPolicyService } from "../work-policy.service";

const contributor = vi.hoisted(() => ({
	contexts: [] as StatutoryScheduleContext[],
	/** Employees one more shift would push over the limit. */
	nearLimit: new Set<string>(),
}));

vi.mock("@/lib/statutory/scheduling/contributors", () => ({
	statutoryScheduleContributors: [
		{
			domain: "working_student",
			evaluate: async (context: StatutoryScheduleContext): Promise<StatutoryFinding[]> => {
				contributor.contexts.push(context);
				return context.employeeIds.flatMap((employeeId): StatutoryFinding[] => {
					const proposed = context.proposedShifts.some((s) => s.employeeId === employeeId);
					if (!proposed || !contributor.nearLimit.has(employeeId)) return [];
					return [
						{
							id: `working_student_week:${employeeId}:2026-W41`,
							organizationId: context.organizationId,
							employeeId,
							domain: "working_student",
							kind: "working_student_week",
							severity: "critical",
							subjectKey: "2026-W41",
							periodStart: "2026-10-05",
							periodEnd: "2026-10-12",
							legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
							summary: { tier: "exceeded", usedPercent: 110 },
							adminDetail: { hourlyWageCents: 1_500 },
							inputFingerprint: "v1:test",
							acknowledgementKind: null,
						},
					];
				});
			},
		},
	],
}));

vi.mock("@/lib/calendar/work-policy-requirements", async () => {
	const { Effect } = await import("effect");
	return { loadDailyWorkRequirementsForEmployee: () => Effect.succeed({}) };
});

const TZ = "Europe/Berlin";

const serviceLayer = StaffingSuggestionServiceLive.pipe(
	Layer.provide(
		Layer.succeed(WorkPolicyService, {
			getEffectivePolicyAt: () => Effect.succeed(null),
		} as never),
	),
	Layer.provide(DatabaseServiceLive),
);

describe("staffing suggestions with statutory contributors (PostgreSQL)", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		contributor.contexts.length = 0;
		contributor.nearLimit.clear();
	});

	function suggest(
		org: ShiftTestOrganization,
		candidates: StaffingCandidate[],
		shift: Partial<StaffingShiftInput> = {},
	) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* StaffingSuggestionService;
				return yield* service.suggestForShift({
					organizationId: org.organizationId,
					timezone: TZ,
					candidates,
					shift: {
						subareaId: org.subareaId,
						date: SHIFT_DAY,
						startTime: "08:00",
						endTime: "16:00",
						...shift,
					},
				});
			}).pipe(Effect.provide(serviceLayer)),
		);
	}

	function candidate(person: SeededEmployee, displayName: string): StaffingCandidate {
		return { employeeId: person.employeeId, displayName, isActive: true };
	}

	it("warns only about the candidates the shift would push over a statutory limit", async () => {
		const org = await fixture.organization(TZ);
		const student = await fixture.seedEmployee({ organizationId: org.organizationId });
		const other = await fixture.seedEmployee({ organizationId: org.organizationId });
		contributor.nearLimit.add(student.employeeId);

		const suggestions = await suggest(org, [
			candidate(student, "Student"),
			candidate(other, "Other"),
		]);

		const byName = new Map(suggestions.map((suggestion) => [suggestion.displayName, suggestion]));
		expect(byName.get("Student")?.warnings).toEqual([
			{
				type: "compliance",
				findingType: "statutory",
				finding: expect.objectContaining({
					type: "statutory",
					employeeId: student.employeeId,
					statutoryKind: "working_student_week",
					summary: { tier: "exceeded", usedPercent: 110 },
				}),
			},
		]);
		expect(byName.get("Other")?.warnings).toEqual([]);
		expect(JSON.stringify(suggestions)).not.toMatch(/hourlyWage|1500/);
		expect(contributor.contexts.map((context) => context.proposedShifts.length)).toEqual([0, 2]);
		expect(contributor.contexts[1]?.proposedShifts).toContainEqual(
			expect.objectContaining({
				employeeId: student.employeeId,
				date: SHIFT_DAY,
				startTime: "08:00",
				endTime: "16:00",
			}),
		);
	});

	it("evaluates an edited shift as replacing its saved version", async () => {
		const org = await fixture.organization(TZ);
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const shiftId = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: shiftStoredDate(SHIFT_DAY, TZ).toISOString(),
		});

		await suggest(org, [candidate(person, "Person")], { shiftId });

		expect(contributor.contexts.map((context) => context.replacesShiftId)).toEqual([
			shiftId,
			shiftId,
		]);
	});
});
