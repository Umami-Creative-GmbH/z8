import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const approvalsDir = dirname(fileURLToPath(import.meta.url));

describe("approvals actions module structure", () => {
	it("keeps only the shared current-employee action once the legacy workspace is retired (#1976)", () => {
		const actionsSource = readFileSync(join(approvalsDir, "actions.ts"), "utf8");

		expect(actionsSource).toMatch(/getCurrentEmployee as getCurrentEmployeeAction/);
		expect(actionsSource.match(/export async function \w+/g)).toEqual([
			"export async function getCurrentEmployee",
		]);
		expect(actionsSource).not.toMatch(/export\s*\{[^}]+\}\s*from\s*"@\/lib\/approvals\/server\//);
		expect(actionsSource).not.toContain("@opentelemetry/api");
		expect(actionsSource).not.toContain("drizzle-orm");
	});

	it("retires the legacy two-tab approvals workspace and its tables (#1976)", () => {
		const componentsDir = join(approvalsDir, "../../../../components/approvals");
		for (const retired of [
			"legacy-approvals-workspace.tsx",
			"absence-approvals-table.tsx",
			"absence-approval-columns.tsx",
			"use-absence-approval-mutations.ts",
			"time-correction-approvals-table.tsx",
			"time-correction-approval-format.ts",
			"approval-action-dialog.tsx",
		]) {
			expect(existsSync(join(componentsDir, retired)), retired).toBe(false);
		}
	});

	it("routes travel expense approvals through the unified inbox entry point", () => {
		// The travel expenses page shows this entry under its header (#688).
		const travelExpensesPageSource = readFileSync(
			join(approvalsDir, "../../../../components/travel-expenses/approvals-entry.tsx"),
			"utf8",
		);

		expect(existsSync(join(approvalsDir, "../travel-expenses/approvals/page.tsx"))).toBe(false);
		// Reports (#602) and legacy claims (#617) share one filtered inbox entry.
		expect(travelExpensesPageSource).toContain(
			'"/approvals/inbox?types=travel_expense_report,travel_expense_claim"',
		);
	});

	it("routes payroll readiness travel expense actions through the filtered unified inbox", () => {
		const payrollReadinessSource = readFileSync(
			join(approvalsDir, "../../../../lib/payroll-readiness/get-payroll-readiness.ts"),
			"utf8",
		);

		expect(payrollReadinessSource).toContain(
			'actionHref: "/approvals/inbox?types=travel_expense_report,travel_expense_claim"',
		);
		expect(payrollReadinessSource).not.toContain('actionHref: "/travel-expenses/approvals"');
	});

	it("removes the legacy travel expense approval queue implementation", () => {
		const travelExpenseActionsSource = readFileSync(
			join(approvalsDir, "../travel-expenses/actions.ts"),
			"utf8",
		);

		expect(travelExpenseActionsSource).not.toContain("getTravelExpenseApprovalQueue");
		expect(travelExpenseActionsSource).not.toContain("TravelExpenseApprovalQueueItem");
		expect(
			existsSync(
				join(approvalsDir, "../../../components/travel-expenses/travel-expense-approval-queue.tsx"),
			),
		).toBe(false);
		expect(
			existsSync(
				join(
					approvalsDir,
					"../../../components/travel-expenses/travel-expense-approval-queue.test.tsx",
				),
			),
		).toBe(false);
	});

	it("exposes no server action that creates or submits a legacy travel expense claim", () => {
		const travelExpenseActionsSource = readFileSync(
			join(approvalsDir, "../travel-expenses/actions.ts"),
			"utf8",
		);

		// New expenses are reports; legacy drafts are converted, never submitted (#621).
		expect(travelExpenseActionsSource).not.toContain("createTravelExpenseDraft");
		expect(travelExpenseActionsSource).not.toContain("submitTravelExpenseClaim");
		expect(travelExpenseActionsSource).not.toContain(".insert(");
	});
});
