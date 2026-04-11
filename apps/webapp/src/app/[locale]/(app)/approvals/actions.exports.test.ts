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

	it("routes travel expense approvals through the unified inbox entry point", () => {
		const legacyApprovalsPageSource = readFileSync(
			join(approvalsDir, "../travel-expenses/approvals/page.tsx"),
			"utf8",
		);
		const travelExpensesPageSource = readFileSync(
			join(approvalsDir, "../travel-expenses/page.tsx"),
			"utf8",
		);

		expect(legacyApprovalsPageSource).toContain("params: Promise<{ locale: string }>");
		expect(legacyApprovalsPageSource).toContain(
			'redirect(`/${locale}/approvals/inbox?types=travel_expense_claim`)',
		);
		expect(travelExpensesPageSource).toContain(
			'"/approvals/inbox?types=travel_expense_claim"',
		);
	});

	it("removes the legacy travel expense approval queue implementation", () => {
		const travelExpenseActionsSource = readFileSync(
			join(approvalsDir, "../travel-expenses/actions.ts"),
			"utf8",
		);

		expect(travelExpenseActionsSource).not.toContain("getTravelExpenseApprovalQueue");
		expect(travelExpenseActionsSource).not.toContain("TravelExpenseApprovalQueueItem");
		expect(
			existsSync(join(approvalsDir, "../../../components/travel-expenses/travel-expense-approval-queue.tsx")),
		).toBe(false);
		expect(
			existsSync(
				join(approvalsDir, "../../../components/travel-expenses/travel-expense-approval-queue.test.tsx"),
			),
		).toBe(false);
	});
});
