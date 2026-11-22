import type { ComplianceFindingSeverity } from "@/db/schema/compliance-finding";
import type { Instant } from "@/lib/datetime/temporal-core";

export interface EmployeePolicy {
	policyId: string;
	policyName: string;
	maxDailyMinutes: number;
	maxWeeklyMinutes: number;
	minRestPeriodMinutes: number;
	maxConsecutiveDays: number;
}

export interface EmployeeWithPolicy {
	id: string;
	organizationId: string;
	firstName: string;
	lastName: string;
	timezone: string;
	policy: EmployeePolicy | null;
}

export interface WorkPeriodData {
	id: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number;
	isActive: boolean;
}

export interface RuleDetectionInput {
	employee: EmployeeWithPolicy;
	workPeriods: WorkPeriodData[];
	dateRange: {
		start: Instant;
		end: Instant;
	};
	thresholdOverrides: unknown;
}

export interface ComplianceFindingResult {
	employeeId: string;
	type: string;
	severity: ComplianceFindingSeverity;
	occurrenceDate: Date;
	periodStart: Date;
	periodEnd: Date;
	evidence: unknown;
	workPolicyId: string | null;
}

export interface ComplianceRule {
	readonly name: string;
	readonly type: string;
	readonly description: string;
	detectViolations(input: RuleDetectionInput): Promise<ComplianceFindingResult[]>;
}
