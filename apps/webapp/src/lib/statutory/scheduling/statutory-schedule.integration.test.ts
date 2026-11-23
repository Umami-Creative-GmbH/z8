/**
 * #1988: the Scheduling / Staffing seam for statutory monitors. Contributors (one per monitor,
 * #1989–#1993) return shared statutory findings; the seam attaches acknowledgement states and
 * projects them wage-free into the scheduling `ComplianceFinding` union.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import { recordStatutoryAcknowledgement } from "../acknowledgements";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import { saveOrganizationStatutoryPreferences } from "../preferences";
import type { StatutoryScheduleContext, StatutoryScheduleContributor } from "./contributor";
import { addedStatutoryScheduleFindings, evaluateStatutoryScheduleFindings } from "./evaluate";

describe("statutory scheduling seam (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1988-schedule");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/** A stand-in monitor: a finding per employee whose proposed shifts reach 3 or more. */
	function countingContributor(seen: StatutoryScheduleContext[]): StatutoryScheduleContributor {
		return {
			domain: "working_student",
			async evaluate(context) {
				seen.push(context);
				return context.employeeIds.flatMap((employeeId): StatutoryFinding[] => {
					const proposed = context.proposedShifts.filter((s) => s.employeeId === employeeId).length;
					const used = 1 + proposed;
					if (used * 100 < context.preferences.warningThresholdPercent * 3) return [];
					return [
						{
							id: statutoryFindingId("working_student_week", employeeId, "2026-W10"),
							organizationId: context.organizationId,
							employeeId,
							domain: "working_student",
							kind: "working_student_week",
							severity: used > 3 ? "critical" : "warning",
							subjectKey: "2026-W10",
							periodStart: "2026-03-02",
							periodEnd: "2026-03-09",
							legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
							summary: {
								tier: used > 3 ? "exceeded" : "warning",
								usedPercent: Math.floor((used * 100) / 3),
							},
							adminDetail: { amountsCents: { wage: 1_500 } },
							inputFingerprint: `v1:${used}`,
							acknowledgementKind: "working_student_over_20h_week",
						},
					];
				});
			},
		};
	}

	it("projects contributor findings wage-free with their acknowledgement state", async () => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const student = await fx.employee(org, "student");
		await saveOrganizationStatutoryPreferences(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			warningThresholdPercent: 30,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: false,
		});
		await recordStatutoryAcknowledgement(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			employeeId: student.employeeId,
			kind: "working_student_over_20h_week",
			subjectKey: "2026-W10",
			inputFingerprint: "v1:1",
			reason: "Exam preparation week agreed with university",
		});
		const seen: StatutoryScheduleContext[] = [];

		const findings = await evaluateStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-09" },
				employeeIds: [student.employeeId],
				now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
			},
			[countingContributor(seen)],
		);

		expect(seen[0]?.preferences.warningThresholdPercent).toBe(30);
		expect(seen[0]?.proposedShifts).toEqual([]);
		expect(findings).toEqual([
			{
				type: "statutory",
				employeeId: student.employeeId,
				findingId: `working_student_week:${student.employeeId}:2026-W10`,
				statutoryKind: "working_student_week",
				domain: "working_student",
				severity: "warning",
				subjectKey: "2026-W10",
				legalReference: "§ 6 Abs. 1 Nr. 3 SGB V",
				summary: { tier: "warning", usedPercent: 33 },
				acknowledgementStatus: "current",
				blocksPublication: false,
			},
		]);
	});

	it("tells Staffing which findings each candidate's proposed shift would add", async () => {
		const org = await fx.organization("a");
		const busy = await fx.employee(org, "busy");
		const free = await fx.employee(org, "free");
		const seen: StatutoryScheduleContext[] = [];

		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-05" },
				employeeIds: [busy.employeeId, free.employeeId],
				now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
				proposedShift: { date: "2026-03-03", startTime: "09:00", endTime: "17:00" },
				replacesShiftId: null,
			},
			[
				{
					domain: "working_student",
					evaluate: async (context) => {
						// Weigh the busy employee's proposal three times so it crosses the limit.
						const withBusyHistory = {
							...context,
							proposedShifts: context.proposedShifts.flatMap((s) =>
								s.employeeId === busy.employeeId ? [s, s, s] : [s],
							),
						};
						return countingContributor(seen).evaluate(withBusyHistory);
					},
				},
			],
		);

		expect(added.get(busy.employeeId)?.map((f) => f.severity)).toEqual(["critical"]);
		expect(added.get(free.employeeId) ?? []).toEqual([]);
		expect(seen.map((context) => context.proposedShifts.length)).toEqual([0, 4]);
		expect(seen[1]?.proposedShifts[0]).toMatchObject({
			date: "2026-03-03",
			startTime: "09:00",
			endTime: "17:00",
		});
	});

	/** A monitor whose finding keeps its id and severity but moves from 96 % to over the cap. */
	function capContributor(): StatutoryScheduleContributor {
		return {
			domain: "minijob",
			async evaluate(context) {
				return context.employeeIds.map((employeeId): StatutoryFinding => {
					const over = context.proposedShifts.some((s) => s.employeeId === employeeId);
					return {
						id: statutoryFindingId("minijob_monthly_cap", employeeId, "2026-03"),
						organizationId: context.organizationId,
						employeeId,
						domain: "minijob",
						kind: "minijob_monthly_cap",
						severity: "critical",
						subjectKey: "2026-03",
						periodStart: "2026-03-01",
						periodEnd: "2026-04-01",
						legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
						summary: { tier: over ? "exceeded" : "critical", usedPercent: over ? 112 : 96 },
						adminDetail: null,
						inputFingerprint: `v1:${over}`,
						acknowledgementKind: null,
					};
				});
			},
		};
	}

	it("reports a finding the proposal pushes from the critical tier over the cap", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker");

		const added = await addedStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-05" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
				proposedShift: { date: "2026-03-03", startTime: "09:00", endTime: "17:00" },
				replacesShiftId: null,
			},
			[capContributor()],
		);

		expect(added.get(worker.employeeId)?.map((f) => f.summary.tier)).toEqual(["exceeded"]);
	});

	it("passes only the wage-free summary fields to Scheduling", async () => {
		const org = await fx.organization("a");
		const worker = await fx.employee(org, "worker");
		const leaky: StatutoryScheduleContributor = {
			domain: "minijob",
			async evaluate(context) {
				return (await capContributor().evaluate(context)).map((finding) => ({
					...finding,
					summary: {
						...finding.summary,
						used: { unit: "minutes", value: 600, wageCents: 1_500 },
						earningsCents: 58_000,
					} as unknown as StatutoryFinding["summary"],
				}));
			},
		};

		const [finding] = await evaluateStatutoryScheduleFindings(
			db,
			{
				organizationId: org.id,
				timezone: org.timezone,
				window: { start: "2026-03-02", endExclusive: "2026-03-09" },
				employeeIds: [worker.employeeId],
				now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
			},
			[leaky],
		);

		expect(finding?.summary).toEqual({
			tier: "critical",
			usedPercent: 96,
			used: { unit: "minutes", value: 600 },
		});
	});

	it("does no work without contributors", async () => {
		const org = await fx.organization("a");
		expect(
			await evaluateStatutoryScheduleFindings(
				db,
				{
					organizationId: org.id,
					timezone: org.timezone,
					window: { start: "2026-03-02", endExclusive: "2026-03-09" },
					employeeIds: ["00000000-0000-0000-0000-000000000000"],
					now: Temporal.Instant.from("2026-02-27T09:00:00Z"),
				},
				[],
			),
		).toEqual([]);
	});
});
