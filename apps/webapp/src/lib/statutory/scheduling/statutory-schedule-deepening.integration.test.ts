/**
 * #1991 review: Staffing must warn when a proposal deepens a limit that is already exceeded, even
 * though the finding keeps its id, severity and tier. The rule is generic across monitors.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import type { StatutoryScheduleContributor } from "./contributor";
import { addedStatutoryScheduleFindings } from "./evaluate";

describe("added statutory findings for a deepened breach (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1991-deepening");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/**
	 * A stand-in monitor that always reports its finding, with `used` growing by 480 minutes per
	 * proposed shift; severity and tier never change, so the change key stays the same.
	 */
	function minutesContributor(options: {
		readonly baseUsed: number;
		readonly limit: number;
		readonly earningsDerived?: boolean;
	}): StatutoryScheduleContributor {
		return {
			domain: "working_student",
			async evaluate(context) {
				return context.employeeIds.map((employeeId): StatutoryFinding => {
					const proposed = context.proposedShifts.filter((s) => s.employeeId === employeeId).length;
					const used = options.baseUsed + 480 * proposed;
					return {
						id: statutoryFindingId("working_student_lecture_week", employeeId, "2026-W10"),
						organizationId: context.organizationId,
						employeeId,
						domain: "working_student",
						kind: "working_student_lecture_week",
						severity: "warning",
						subjectKey: "2026-W10",
						periodStart: "2026-03-02",
						periodEnd: "2026-03-09",
						legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
						summary: {
							tier: used > options.limit ? "exceeded" : "warning",
							used: { unit: "minutes", value: used },
							limit: { unit: "minutes", value: options.limit },
						},
						adminDetail: null,
						inputFingerprint: `v1:${used}`,
						acknowledgementKind: null,
						...(options.earningsDerived ? { earningsDerived: true } : {}),
					};
				});
			},
		};
	}

	async function added(contributor: StatutoryScheduleContributor) {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker");
		const result = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-09" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
				proposedShift: { date: "2026-03-05", startTime: "09:00", endTime: "17:00" },
				replacesShiftId: null,
			},
			[contributor],
		);
		return result.get(worker.employeeId) ?? [];
	}

	it("reports a proposal that deepens an already exceeded limit", async () => {
		const findings = await added(minutesContributor({ baseUsed: 1_320, limit: 1_200 }));

		expect(findings.map((f) => f.summary.used)).toEqual([{ unit: "minutes", value: 1_800 }]);
	});

	it("does not report a change that stays within the limit", async () => {
		// E.g. an on-call under-band: the finding exists below the limit; more work is no new breach.
		expect(await added(minutesContributor({ baseUsed: 300, limit: 1_200 }))).toEqual([]);
	});

	it("does not report a deepened earnings-derived finding, which shows its tier only", async () => {
		expect(
			await added(minutesContributor({ baseUsed: 1_320, limit: 1_200, earningsDerived: true })),
		).toEqual([]);
	});
});
