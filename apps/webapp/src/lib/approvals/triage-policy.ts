import "server-only";
import { db } from "@/db";
import type { ApprovalTriagePolicy } from "./triage-policy-config";
import { loadApprovalTriageSettings } from "./triage-settings";

export {
	type ApprovalTriagePolicy,
	DEFAULT_APPROVAL_TRIAGE_POLICY,
} from "./triage-policy-config";

/** A fresh organization-scoped read; database failures must not become default policy. */
export async function getEffectiveApprovalTriagePolicy(input: {
	organizationId: string;
}): Promise<ApprovalTriagePolicy> {
	return loadApprovalTriageSettings(db, input.organizationId);
}
