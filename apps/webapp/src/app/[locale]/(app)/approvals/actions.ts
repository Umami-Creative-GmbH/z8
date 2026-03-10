"use server";

import {
	approveAbsenceEffect as approveAbsenceAction,
	rejectAbsenceEffect as rejectAbsenceAction,
} from "@/lib/approvals/server/absence-approvals";
import {
	getCurrentEmployee as getCurrentEmployeeAction,
	getPendingApprovalCounts as getPendingApprovalCountsAction,
	getPendingApprovals as getPendingApprovalsAction,
} from "@/lib/approvals/server/queries";
import {
	approveTimeCorrectionEffect as approveTimeCorrectionAction,
	rejectTimeCorrectionEffect as rejectTimeCorrectionAction,
	syncCanonicalWorkCorrection,
} from "@/lib/approvals/server/time-correction-approvals";

export type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "@/lib/approvals/server/types";
export { syncCanonicalWorkCorrection };

export async function approveAbsence(...args: Parameters<typeof approveAbsenceAction>) {
	return approveAbsenceAction(...args);
}

export async function rejectAbsence(...args: Parameters<typeof rejectAbsenceAction>) {
	return rejectAbsenceAction(...args);
}

export async function approveTimeCorrection(
	...args: Parameters<typeof approveTimeCorrectionAction>
) {
	return approveTimeCorrectionAction(...args);
}

export async function rejectTimeCorrection(
	...args: Parameters<typeof rejectTimeCorrectionAction>
) {
	return rejectTimeCorrectionAction(...args);
}

export async function getPendingApprovalCounts() {
	return getPendingApprovalCountsAction();
}

export async function getPendingApprovals() {
	return getPendingApprovalsAction();
}

export async function getCurrentEmployee() {
	return getCurrentEmployeeAction();
}
