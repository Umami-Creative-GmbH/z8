export interface ApprovalTriagePolicy {
 staleAfterHours: number;
 smallCorrectionMinutes: number;
}
export const DEFAULT_APPROVAL_TRIAGE_POLICY: Readonly<ApprovalTriagePolicy> = Object.freeze({ staleAfterHours: 72, smallCorrectionMinutes: 15 });
/** Organization-scoped policy boundary. Saved settings replace defaults in #1353. */
export async function getEffectiveApprovalTriagePolicy(_input: { organizationId: string }): Promise<ApprovalTriagePolicy> {
 return { ...DEFAULT_APPROVAL_TRIAGE_POLICY };
}
