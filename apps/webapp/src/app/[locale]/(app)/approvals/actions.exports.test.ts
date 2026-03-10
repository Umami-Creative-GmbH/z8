import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const approvalsDir = dirname(fileURLToPath(import.meta.url));

	describe("approvals actions module structure", () => {
	it("wraps extracted approvals server modules with async exports", () => {
		const actionsSource = readFileSync(join(approvalsDir, "actions.ts"), "utf8");

		expect(
			existsSync(
				join(approvalsDir, "../../../../lib/approvals/server/absence-approvals.ts"),
			),
		).toBe(true);
		expect(
			existsSync(
				join(approvalsDir, "../../../../lib/approvals/server/time-correction-approvals.ts"),
			),
		).toBe(true);
		expect(existsSync(join(approvalsDir, "../../../../lib/approvals/server/queries.ts"))).toBe(true);
		expect(existsSync(join(approvalsDir, "../../../../lib/approvals/server/types.ts"))).toBe(true);
		expect(existsSync(join(approvalsDir, "../../../../lib/approvals/server/shared.ts"))).toBe(true);

		expect(actionsSource).toContain(
			'export type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "@/lib/approvals/server/types";',
		);
		expect(actionsSource).toMatch(/approveAbsenceEffect as approveAbsenceAction/);
		expect(actionsSource).toMatch(/rejectAbsenceEffect as rejectAbsenceAction/);
		expect(actionsSource).toContain("approveTimeCorrectionAction");
		expect(actionsSource).toContain("rejectTimeCorrectionAction");
		expect(actionsSource).toContain('from "@/lib/approvals/server/time-correction-approvals";');
		expect(actionsSource).toMatch(/getCurrentEmployee as getCurrentEmployeeAction/);
		expect(actionsSource).toMatch(/getPendingApprovalCounts as getPendingApprovalCountsAction/);
		expect(actionsSource).toMatch(/getPendingApprovals as getPendingApprovalsAction/);
		expect(actionsSource).toContain("export async function approveAbsence(");
		expect(actionsSource).toContain("export async function rejectAbsence(");
		expect(actionsSource).toContain("export async function approveTimeCorrection(");
		expect(actionsSource).toContain("export async function rejectTimeCorrection(");
		expect(actionsSource).toContain("export async function getPendingApprovals(");
		expect(actionsSource).not.toMatch(/export\s*\{[^}]+\}\s*from\s*"@\/lib\/approvals\/server\//);
		expect(actionsSource).not.toContain("@opentelemetry/api");
		expect(actionsSource).not.toContain("drizzle-orm");
	});
});
