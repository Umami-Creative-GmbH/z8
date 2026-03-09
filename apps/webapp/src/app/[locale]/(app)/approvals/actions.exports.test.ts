import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const approvalsDir = dirname(fileURLToPath(import.meta.url));

describe("approvals actions module structure", () => {
	it("exposes extracted approvals server modules", () => {
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
		expect(actionsSource).toMatch(
			/export\s*\{\s*approveAbsenceEffect,\s*rejectAbsenceEffect\s*\}\s*from\s*"@\/lib\/approvals\/server\/absence-approvals";/,
		);
		expect(actionsSource).toContain("approveTimeCorrectionEffect");
		expect(actionsSource).toContain("rejectTimeCorrectionEffect");
		expect(actionsSource).toContain('from "@/lib/approvals/server/time-correction-approvals";');
		expect(actionsSource).toContain(
			'export { getPendingApprovalCounts, getPendingApprovals, getCurrentEmployee } from "@/lib/approvals/server/queries";',
		);
		expect(actionsSource).toContain(
			'export { approveAbsenceEffect as approveAbsence } from "@/lib/approvals/server/absence-approvals";',
		);
		expect(actionsSource).toContain(
			'export { rejectAbsenceEffect as rejectAbsence } from "@/lib/approvals/server/absence-approvals";',
		);
		expect(actionsSource).toContain(
			'export { approveTimeCorrectionEffect as approveTimeCorrection } from "@/lib/approvals/server/time-correction-approvals";',
		);
		expect(actionsSource).toContain(
			'export { rejectTimeCorrectionEffect as rejectTimeCorrection } from "@/lib/approvals/server/time-correction-approvals";',
		);
		expect(actionsSource).not.toContain("@opentelemetry/api");
		expect(actionsSource).not.toContain("drizzle-orm");
	});
});
