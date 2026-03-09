"use server";

export type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "@/lib/approvals/server/types";
export { approveAbsenceEffect, rejectAbsenceEffect } from "@/lib/approvals/server/absence-approvals";
export {
	approveTimeCorrectionEffect,
	rejectTimeCorrectionEffect,
	syncCanonicalWorkCorrection,
} from "@/lib/approvals/server/time-correction-approvals";
export { getPendingApprovalCounts, getPendingApprovals, getCurrentEmployee } from "@/lib/approvals/server/queries";

export { approveAbsenceEffect as approveAbsence } from "@/lib/approvals/server/absence-approvals";
export { rejectAbsenceEffect as rejectAbsence } from "@/lib/approvals/server/absence-approvals";
export { approveTimeCorrectionEffect as approveTimeCorrection } from "@/lib/approvals/server/time-correction-approvals";
export { rejectTimeCorrectionEffect as rejectTimeCorrection } from "@/lib/approvals/server/time-correction-approvals";
