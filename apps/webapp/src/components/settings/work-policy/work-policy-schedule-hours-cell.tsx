import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";

export function WorkPolicyScheduleHoursCell({ policy }: { policy: WorkPolicyWithDetails }) {
	if (!policy.scheduleEnabled || !policy.schedule) {
		return <div className="text-center text-muted-foreground">-</div>;
	}
	if (policy.schedule.scheduleType === "simple" && policy.schedule.hoursPerCycle) {
		return <div className="text-center tabular-nums">{policy.schedule.hoursPerCycle}h</div>;
	}
	if (policy.schedule.scheduleType === "detailed" && policy.schedule.days) {
		const totalHours = policy.schedule.days
			.filter((day) => day.isWorkDay)
			.reduce((sum, day) => sum + Number.parseFloat(day.hoursPerDay || "0"), 0);
		return <div className="text-center tabular-nums">{totalHours.toFixed(1)}h</div>;
	}
	return <div className="text-center text-muted-foreground">-</div>;
}
