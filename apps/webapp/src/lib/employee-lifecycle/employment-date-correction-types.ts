import type { TrackingDateImpact } from "@/lib/time-tracking/tracking-date-review-types";
export interface EmploymentDateCorrectionImpact extends TrackingDateImpact {
 employeeId:string;
 employmentStartDate:string;
 previousEmploymentStartDate:string|null;
 employmentPeriodId:string|null;
 employmentBlockers:Array<{code:string;message:string}>;
 vacation:Array<{year:number;before:VacationCorrectionBalance|null;after:VacationCorrectionBalance|null}>;
}
export interface VacationCorrectionBalance {allowanceDays:number;totalDays:number;remainingDays:number;usedDays:number;pendingDays:number;overdrawnDays:number;carryoverDays:number}
