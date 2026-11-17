import type { ComplianceAlert, RestPeriodCheckResult } from "@/db/schema";
import type { ExceptionWithDetails } from "@/lib/effect/services/compliance-guardrail.service";

export type ClockComplianceMode = "idle" | "active";

export interface ClockComplianceScope {
	userId: string;
	organizationId: string;
	employeeId: string;
}

/** Advisory display data only; clock commands enforce current compliance themselves. */
export interface ClockComplianceSnapshot {
	scope: ClockComplianceScope;
	mode: ClockComplianceMode;
	restPeriod: RestPeriodCheckResult | null;
	alerts: ComplianceAlert[];
	myExceptions: ExceptionWithDetails[];
}
