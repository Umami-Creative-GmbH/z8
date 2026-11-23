/**
 * #1992: the batched reference-period listing payroll preparation uses. A long-running sick leave
 * of one employee is dated from its own start without widening every other employee's load.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import * as resolveContract from "@/lib/contracts/resolve-contract";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	calculateOnCallReferencePeriod,
	earliestSickStarts,
	listOnCallReferenceEventsBatch,
} from "./reference-period";
import { onCallFixture } from "./testing/on-call-fixture";
import { listOnCallPayrollReferenceRows } from "./views";

vi.mock("@/lib/contracts/resolve-contract", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/contracts/resolve-contract")>();
	return { ...original, loadEffectiveContractsBatch: vi.fn(original.loadEffectiveContractsBatch) };
});
vi.mock("./reference-period", async (importOriginal) => {
	const original = await importOriginal<typeof import("./reference-period")>();
	return { ...original, earliestSickStarts: vi.fn(original.earliestSickStarts) };
});

describe("§ 12 TzBfG reference periods in a batch (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-reference-batch");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("dates a long sick leave from its own start without widening the other employees' load", async () => {
		const org = await onCall.organization("a");
		const longSick = await fx.employee(org, "long-sick");
		const colleague = await fx.employee(org, "colleague");
		for (const who of [longSick, colleague]) {
			const periodId = await onCall.employmentPeriod(org, who, "2024-12-31T23:00:00Z");
			await onCall.onCallTerms(org, who, { kind: "unspecified", employmentPeriodId: periodId });
		}
		await onCall.work(org, longSick, { date: "2025-04-01", startTime: "09:00", endTime: "13:00" });
		await onCall.absence(org, longSick, {
			type: "sick",
			startDate: "2025-06-02",
			endDate: "2026-07-31",
		});
		await onCall.work(org, colleague, { date: "2026-05-05", startTime: "09:00", endTime: "13:00" });
		await onCall.holiday(org, colleague, "2026-06-15");
		const loads = vi.mocked(resolveContract.loadEffectiveContractsBatch);
		loads.mockClear();

		const events = await listOnCallReferenceEventsBatch(db, {
			organizationId: org.id,
			employeeIds: [longSick.employeeId, colleague.employeeId],
			from: "2026-06-01",
			untilExclusive: "2026-07-01",
			method: "three_months",
		});

		const sick = events.get(longSick.employeeId) ?? [];
		expect(sick.map((event) => [event.kind, event.eventDate])).toEqual([
			["sick_leave", "2025-06-02"],
		]);
		expect(sick[0]?.breakdown).toEqual(
			await calculateOnCallReferencePeriod(db, {
				organizationId: org.id,
				employeeId: longSick.employeeId,
				eventDate: "2025-06-02",
				method: "three_months",
			}),
		);
		expect(sick[0]?.breakdown.numeratorMinutes).toBe(240);

		const holiday = events.get(colleague.employeeId) ?? [];
		expect(holiday.map((event) => [event.kind, event.eventDate])).toEqual([
			["public_holiday", "2026-06-15"],
		]);
		expect(holiday[0]?.breakdown).toMatchObject({
			referenceStart: "2026-03-15",
			numeratorMinutes: 240,
		});

		// The colleague's days are resolved from their own earliest reference start only.
		const colleagueFirstDays = loads.mock.calls
			.filter(([, input]) => input.employeeIds.includes(colleague.employeeId))
			.map(([, input]) => input.dates[0]?.toString());
		expect(colleagueFirstDays).toEqual(["2026-03-01"]);
	});

	it("walks back through sick leave of on-call employees only when listing a payroll period", async () => {
		const org = await onCall.organization("a");
		const onCallWorker = await fx.employee(org, "on-call");
		const regular = await fx.employee(org, "regular");
		const periodId = await onCall.employmentPeriod(org, onCallWorker, "2024-12-31T23:00:00Z");
		await onCall.onCallTerms(org, onCallWorker, {
			kind: "unspecified",
			employmentPeriodId: periodId,
		});
		await onCall.regularTerms(org, regular);
		// Both ill in back-to-back leave running into the period.
		for (const who of [onCallWorker, regular]) {
			await onCall.absence(org, who, {
				type: "sick",
				startDate: "2026-05-25",
				endDate: "2026-05-31",
			});
			await onCall.absence(org, who, {
				type: "sick",
				startDate: "2026-06-01",
				endDate: "2026-06-05",
			});
		}
		const walks = vi.mocked(earliestSickStarts);
		walks.mockClear();

		const rows = await listOnCallPayrollReferenceRows(db, {
			organizationId: org.id,
			startDate: "2026-06-01",
			endDate: "2026-06-30",
			method: "three_months",
		});

		expect(rows.map((row) => [row.employeeId, row.kind, row.eventDate])).toEqual([
			[onCallWorker.employeeId, "sick_leave", "2026-05-25"],
		]);
		const walked = walks.mock.calls.map(([, input]) => input.employeeIds);
		expect(walked.length).toBeGreaterThan(0);
		for (const employeeIds of walked) {
			expect(employeeIds).toEqual([onCallWorker.employeeId]);
		}
	});
});
