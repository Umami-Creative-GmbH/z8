import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createUtcDateTime } from "./time-utils";

const modularSource = readFileSync(
	fileURLToPath(new URL("./corrections.ts", import.meta.url)),
	"utf8",
);
const legacySource = readFileSync(fileURLToPath(new URL("../actions.ts", import.meta.url)), "utf8");

const { resolveCorrectionApprovalManager } = await import("./corrections");

function createManagerLinkDb(managerLinks: unknown[]) {
	return {
		query: {
			employee: {
				findMany: vi.fn(async () => [
					{ id: "employee-1", organizationId: "org-1", isActive: true, role: "employee" },
					{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
				]),
			},
			employeeManagers: {
				findMany: vi.fn(async () => managerLinks),
			},
			teamMembership: {
				findMany: vi.fn(async () => []),
			},
			team: {
				findMany: vi.fn(async () => []),
			},
		},
	};
}

function functionBody(source: string, name: string) {
	const match = new RegExp(`(?:export\\s+)?async function ${name}\\s*\\(`).exec(source);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("time correction request safety", () => {
	it("uses explicit correction endpoint dates instead of stored work period endpoint dates", () => {
		expect(modularSource).toContain("newClockInDate: data.newClockInDate");
		expect(modularSource).toContain("newClockOutDate: data.newClockOutDate");
		expect(modularSource).not.toContain("periodStart:");
		expect(modularSource).not.toContain("periodEnd:");
		expect(modularSource).not.toContain("setTimeOnStoredDate");
	});

	it("rejects partial explicit clock-out endpoint inputs", () => {
		expect(modularSource).toContain("if (params.newClockOutDate || params.newClockOutTime)");
		expect(modularSource).toContain('return { error: "Invalid clock out date or time" } as const;');
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("scopes %s work period lookup to the current employee and organization", (_name, source) => {
		const body = functionBody(source, "requestTimeCorrectionEffect");

		expect(body).toContain("eq(workPeriod.id, data.workPeriodId)");
		expect(body).toContain("eq(workPeriod.employeeId, currentEmployee.id)");
		expect(body).toContain("eq(workPeriod.organizationId, currentEmployee.organizationId)");
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("creates %s inactive correction entries and approval workflow in one transaction", (_name, source) => {
		const body = functionBody(source, "requestTimeCorrectionEffect");
		const transactionIndex = body.indexOf("dbService.db.transaction");
		const clockInIndex = Math.max(
			body.indexOf("createTimeEntry("),
			body.indexOf("createCorrectionEntry"),
		);
		const approvalIndex = body.indexOf(
			"createTimeCorrectionApprovalWorkflow(transactionalDbService",
		);
		const emailIndex = body.indexOf("emailService.send");

		expect(transactionIndex).toBeGreaterThanOrEqual(0);
		expect(clockInIndex).toBeGreaterThan(transactionIndex);
		expect(approvalIndex).toBeGreaterThan(transactionIndex);
		expect(emailIndex).toBeGreaterThan(approvalIndex);
		expect(body).toContain("isSuperseded: true");
		expect(body).not.toContain("markTimeEntrySuperseded");
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("passes %s created correction entry IDs into the approval workflow", (_name, source) => {
		const body = functionBody(source, "requestTimeCorrectionEffect");

		expect(body).toContain("correctionEntryIds");
		expect(body).toContain("clockInCorrectionId: clockInCorrection.id");
		expect(body).toContain("clockOutCorrectionId");
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("blocks %s direct same-day edits when a correction approval is pending", (_name, source) => {
		const body = functionBody(source, "editSameDayTimeEntry");

		expect(body).toContain("approvalRequest");
		expect(body).toContain("pending_time_correction_approval");
		expect(body).toContain("A time correction approval is already pending for this work period");
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("fails closed for %s same-day edits when policy verification fails", (_name, source) => {
		const body = functionBody(source, "editSameDayTimeEntry");

		expect(body).toContain("Failed to verify edit policy. Please try again.");
		expect(body).not.toContain(
			'editCapability = { type: "direct", reason: "within_self_service" };',
		);
	});

	it.each([
		["modular", modularSource, "selectedWorkPeriod.endTime"],
		["legacy", legacySource, "period.endTime"],
	])("rejects %s direct clock-in-only edits after the existing clock-out", (_name, source, existingClockOutExpression) => {
		const body = functionBody(source, "editSameDayTimeEntry");

		expect(body).toContain(
			`const effectiveClockOut = correctedClockOutDate ?? ${existingClockOutExpression}`,
		);
		expect(body).toContain("if (effectiveClockOut && effectiveClockOut <= correctedClockInDate)");
		expect(body).toContain("Clock out time must be after clock in time");
	});

	it.each([
		["modular", modularSource, "selectedWorkPeriod.endTime"],
		["legacy", legacySource, "period.endTime"],
	])("rejects %s approval requests when clock-in-only correction is after the existing clock-out", (_name, source, existingClockOutExpression) => {
		const body = functionBody(source, "requestTimeCorrectionEffect");

		expect(body).toContain(
			`const effectiveClockOut = correctedClockOutDate ?? ${existingClockOutExpression}`,
		);
		expect(body).toContain("if (effectiveClockOut && effectiveClockOut <= correctedClockInDate)");
		expect(body).toContain("Clock out time must be after clock in time");
	});
});

describe("createUtcDateTime", () => {
	it("builds a UTC instant from an employee local date and time", () => {
		const result = createUtcDateTime("2026-06-03", "18:15", "Europe/Berlin");

		expect(result?.toISOString()).toBe("2026-06-03T16:15:00.000Z");
	});

	it("allows a corrected clock-out date to be the same local date as clock-in", () => {
		const start = createUtcDateTime("2026-06-03", "09:00", "Europe/Berlin");
		const end = createUtcDateTime("2026-06-03", "17:00", "Europe/Berlin");

		expect(start?.toISOString()).toBe("2026-06-03T07:00:00.000Z");
		expect(end?.toISOString()).toBe("2026-06-03T15:00:00.000Z");
		expect(end!.getTime()).toBeGreaterThan(start!.getTime());
	});
});

describe("resolveCorrectionApprovalManager", () => {
	it("resolves the approver from primary manager links when the employee fixture omits managerId", async () => {
		const db = createManagerLinkDb([
			{ employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
		]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ ok: true, managerId: "manager-1" });
	});

	it("returns the existing no-manager correction validation decision", async () => {
		const db = createManagerLinkDb([]);

		await expect(
			resolveCorrectionApprovalManager({
				db,
				requesterEmployeeId: "employee-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({
			ok: false,
			message: "No manager assigned to approve corrections",
			field: "managerId",
		});
	});
});
