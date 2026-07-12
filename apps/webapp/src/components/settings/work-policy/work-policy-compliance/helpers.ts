import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";

type EmployeeRecord =
	| {
			firstName?: string | null;
			lastName?: string | null;
			user?: {
				firstName?: string | null;
				lastName?: string | null;
				name?: string | null;
				email?: string | null;
			} | null;
	  }
	| null
	| undefined;

type Translate = (key: string, fallback: string) => string;

export const violationTypeColors: Record<string, "destructive" | "secondary" | "outline"> = {
	max_daily: "destructive",
	max_weekly: "destructive",
	max_uninterrupted: "secondary",
	break_required: "outline",
	schedule_deviation: "outline",
};

export function formatEmployeeName(employeeRecord: EmployeeRecord, fallback: string) {
	return employeeRecord
		? buildAuthUserDisplayName({
				firstName: employeeRecord.user?.firstName,
				lastName: employeeRecord.user?.lastName,
				name: employeeRecord.user?.name,
				email: employeeRecord.user?.email,
			}) || fallback
		: fallback;
}

export function getViolationTypeLabel(type: string, t: Translate): string {
	switch (type) {
		case "max_daily":
			return t("settings.workPolicies.violationType.maxDaily", "Max Daily Exceeded");
		case "max_weekly":
			return t("settings.workPolicies.violationType.maxWeekly", "Max Weekly Exceeded");
		case "max_uninterrupted":
			return t("settings.workPolicies.violationType.maxUninterrupted", "Max Continuous Exceeded");
		case "break_required":
			return t("settings.workPolicies.violationType.breakRequired", "Required Break Missing");
		case "schedule_deviation":
			return t("settings.workPolicies.violationType.scheduleDeviation", "Schedule Deviation");
		default:
			return type;
	}
}

export function buildCsvContent(headers: string[], rows: Array<Array<string | number>>) {
	return [headers, ...rows]
		.map((row) =>
			row
				.map((cell) => {
					const value = String(cell);
					return value.includes(",") || value.includes('"') || value.includes("\n")
						? `"${value.replace(/"/g, '""')}"`
						: value;
				})
				.join(","),
		)
		.join("\n");
}
