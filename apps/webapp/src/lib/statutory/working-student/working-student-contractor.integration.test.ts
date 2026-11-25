/**
 * #2010 (spec #1935): the working-student monitor reads employee time only. An External
 * Contractor on working-student terms is judged by neither the 20 h lecture-week rule nor the
 * rolling 26-week ceiling; a person converted mid-week counts only the work after the conversion
 * instant, a work period across it included.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import { evaluateWorkingStudents } from "./monitor";
import { weekdays, workingStudentFixture } from "./working-student.test.fixture";

// Mon 2026-03-02 … Sun 2026-03-08 is ISO week 2026-W10.
const W10 = "2026-03-02";
const AFTER_W10 = "2026-03-09";
const LATER = Temporal.Instant.from("2026-06-01T00:00:00Z");

describe("working students who are External Contractors (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const fx = workingStudentFixture(integrationAdminPool(), "t2010-ws");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	function evaluate(organizationId: string, employeeIds: string[]) {
		return evaluateWorkingStudents(db, {
			organizationId,
			timezone: "Europe/Berlin",
			window: { start: W10, endExclusive: AFTER_W10 },
			employeeIds,
			now: LATER,
		});
	}

	it("judges no lecture week of a contractor; the same employee breaches it", async () => {
		const org = await fx.organization("a");
		const contractor = await fx.workingStudent(org, "contractor");
		const employee = await fx.workingStudent(org, "employee");
		await fx.stint(contractor, "contractor", "2023-12-31T23:00:00Z");
		for (const person of [contractor, employee]) {
			await fx.work(org, person, weekdays(W10, "09:00", "14:00")); // 25 h daytime
		}

		const evaluations = await evaluate(org.id, [contractor.employeeId, employee.employeeId]);

		expect(evaluations.map((evaluation) => evaluation.employeeId)).toEqual([employee.employeeId]);
		expect(evaluations[0]?.findings).toEqual([
			expect.objectContaining({
				kind: "working_student_lecture_week",
				subjectKey: "2026-W10",
				summary: expect.objectContaining({ used: { unit: "minutes", value: 1500 } }),
			}),
		]);
	});

	it("counts a person converted on Wednesday at noon only from the conversion instant on", async () => {
		const org = await fx.organization("a");
		const converted = await fx.workingStudent(org, "converted");
		const contractorStint = await fx.stint(converted, "contractor", "2023-12-31T23:00:00Z");
		await fx.endStint(contractorStint, "2026-03-04T11:00:00Z");
		await fx.stint(converted, "employee", "2026-03-04T11:00:00Z");
		await fx.work(org, converted, weekdays(W10, "09:00", "14:00"));

		const [evaluation] = await evaluate(org.id, [converted.employeeId]);

		// Wednesday 12:00–14:00, Thursday and Friday 09:00–14:00: 12 h.
		expect(evaluation?.weeks.at(-1)).toMatchObject({
			subjectKey: "2026-W10",
			totalMinutes: 720,
			coreMinutes: 720,
			otherProfileMinutes: 0,
			overLimit: false,
			lectureBreach: false,
		});
		expect(evaluation?.findings).toEqual([]);
	});
});
