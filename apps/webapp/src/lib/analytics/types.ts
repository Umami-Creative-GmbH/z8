/**
 * Analytics Type Definitions
 *
 * Comprehensive types for analytics data structures used throughout
 * the analytics system for team performance, vacation trends, work hours, etc.
 */

// Re-export DateRange and PeriodPreset from reports module for consistency
export type { DateRange, PeriodPreset } from "@/lib/reports/types";

/**
 * Team Performance Analytics
 */
export type TeamPerformanceData = {
	teams: Array<{
		teamId: string;
		teamName: string;
		totalHours: number;
		avgHoursPerEmployee: number;
		employeeCount: number;
		employees: Array<{
			employeeId: string;
			employeeName: string;
			totalHours: number;
			expectedHours: number;
			variance: number;
			percentageOfExpected: number;
		}>;
	}>;
	organizationTotal: number;
	dateRange: DateRange;
};

/**
 * Vacation Trends Analytics
 */
export type VacationTrendsData = {
	overall: {
		totalDaysAllocated: number;
		totalDaysTaken: number;
		totalDaysRemaining: number;
		utilizationRate: number;
	};
	byMonth: Array<{
		month: string;
		daysTaken: number;
		daysRemaining: number;
	}>;
	byEmployee: Array<{
		employeeId: string;
		employeeName: string;
		allocated: number;
		taken: number;
		remaining: number;
		utilizationRate: number;
	}>;
	patterns: {
		peakMonths: string[];
		averageDaysPerRequest: number;
		clusteringScore: number;
	};
};

/**
 * Work Hours Analytics
 */
export type WorkHoursAnalyticsData = {
	summary: {
		totalHours: number;
		avgHoursPerWeek: number;
		overtimeHours: number;
		undertimeHours: number;
	};
	distribution: Array<{
		date: string;
		hours: number;
		expectedHours: number;
		isOvertime: boolean;
		isUndertime: boolean;
	}>;
	byEmployee: Array<{
		employeeId: string;
		employeeName: string;
		totalHours: number;
		overtimeHours: number;
		undertimeHours: number;
		avgHoursPerWeek: number;
	}>;
};

/**
 * Absence Patterns Analytics
 */
export type AbsencePatternsData = {
	summary: {
		totalAbsences: number;
		totalDays: number;
		avgDaysPerAbsence: number;
		absenceRate: number;
	};
	byType: Array<{
		categoryName: string;
		count: number;
		totalDays: number;
		percentage: number;
	}>;
	byTeam: Array<{
		teamId: string;
		teamName: string;
		absenceCount: number;
		totalDays: number;
		absenceRate: number;
	}>;
	patterns: {
		sickLeavePatterns: {
			avgDuration: number;
			peakMonths: string[];
			frequentEmployees: Array<{
				employeeId: string;
				count: number;
			}>;
		};
		vacationClustering: {
			score: number;
			hotspots: Array<{
				date: string;
				count: number;
			}>;
		};
	};
	timeline: Array<{
		date: string;
		absenceCount: number;
		sickLeaveCount: number;
		vacationCount: number;
	}>;
};

/**
 * Manager Effectiveness Analytics
 */
export type ManagerEffectivenessData = {
	approvalMetrics: {
		avgResponseTime: number;
		totalApprovals: number;
		totalRejections: number;
		approvalRate: number;
	};
	byManager: Array<{
		managerId: string;
		managerName: string;
		avgResponseTime: number;
		totalApprovals: number;
		totalRejections: number;
		approvalRate: number;
		teamSize: number;
	}>;
	responseTimeDistribution: Array<{
		bucket: string;
		count: number;
		percentage: number;
	}>;
	trends: Array<{
		month: string;
		avgResponseTime: number;
		approvalCount: number;
	}>;
};

/**
 * Parameters for analytics service methods
 */
export type TeamPerformanceParams = {
	organizationId: string;
	dateRange: DateRange;
	teamId?: string;
};

export type VacationTrendsParams = {
	organizationId: string;
	dateRange: DateRange;
};

export type WorkHoursParams = {
	organizationId: string;
	dateRange: DateRange;
	employeeId?: string;
};

export type AbsencePatternsParams = {
	organizationId: string;
	dateRange: DateRange;
};

export type ManagerEffectivenessParams = {
	organizationId: string;
	dateRange: DateRange;
	managerId?: string;
};

/**
 * Export configuration types
 */
export type ExportFormat = "csv" | "excel";

export type ExportHeader<T = any> = {
	key: keyof T;
	label: string;
};

export type ExportRequest = {
	type: string;
	format: ExportFormat;
	data: any[];
	headers: Array<{ key: string; label: string }>;
};
