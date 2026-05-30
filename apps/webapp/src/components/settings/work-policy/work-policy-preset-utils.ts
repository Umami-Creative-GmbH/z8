import type {
	BreakRuleInput,
	WorkPolicyPresetInput,
} from "@/app/[locale]/(app)/settings/work-policies/actions";

export type PresetSourceFilter = "all" | "system" | "custom";

type PresetSource = Exclude<PresetSourceFilter, "all">;
type ScheduleCycle = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
type WorkingDaysPreset = "weekdays" | "weekends" | "all_days" | "custom";

interface PresetSourceInput {
	organizationId?: string | null;
}

interface WorkPolicyPresetListItem extends PresetSourceInput {
	name: string;
	description?: string | null;
	countryCode?: string | null;
}

interface WorkPolicyPresetReviewSource extends WorkPolicyPresetListItem {
	scheduleCycle?: ScheduleCycle | null;
	workingDaysPreset?: WorkingDaysPreset | null;
	hoursPerCycle?: string | null;
	maxDailyMinutes?: number | null;
	maxWeeklyMinutes?: number | null;
	maxUninterruptedMinutes?: number | null;
	breakRulesJson?: unknown;
}

interface PresetFilters {
	search?: string;
	source?: PresetSourceFilter;
	countryCode?: string | null;
}

function isNumberOrNull(value: unknown): value is number | null {
	return typeof value === "number" || value === null;
}

export function getPresetSource(preset: PresetSourceInput): PresetSource {
	return preset.organizationId ? "custom" : "system";
}

export function summarizeMinutes(minutes: number | null | undefined): string {
	if (minutes == null) return "-";

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	if (hours === 0) return `${remainingMinutes}m`;
	if (remainingMinutes === 0) return `${hours}h`;
	return `${hours}h ${remainingMinutes}m`;
}

function isBreakOption(value: unknown): value is BreakRuleInput["options"][number] {
	if (!value || typeof value !== "object") return false;

	const option = value as Partial<BreakRuleInput["options"][number]>;
	return (
		isNumberOrNull(option.splitCount) &&
		isNumberOrNull(option.minimumSplitMinutes) &&
		isNumberOrNull(option.minimumLongestSplitMinutes)
	);
}

function isBreakRule(value: unknown): value is BreakRuleInput {
	if (!value || typeof value !== "object") return false;

	const rule = value as Partial<BreakRuleInput>;
	return (
		typeof rule.workingMinutesThreshold === "number" &&
		typeof rule.requiredBreakMinutes === "number" &&
		Array.isArray(rule.options) &&
		rule.options.every(isBreakOption)
	);
}

export function parsePresetBreakRules(value: unknown): BreakRuleInput[] {
	if (!value) return [];

	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		if (!parsed || typeof parsed !== "object") return [];

		const rules = (parsed as { rules?: unknown }).rules;
		if (!Array.isArray(rules)) return [];

		return rules.filter(isBreakRule);
	} catch {
		return [];
	}
}

export function summarizeBreakRules(rules: BreakRuleInput[]): string {
	if (rules.length === 0) return "No break rules";

	return rules
		.map(
			(rule) =>
				`${summarizeMinutes(rule.requiredBreakMinutes)} after ${summarizeMinutes(rule.workingMinutesThreshold)}`,
		)
		.join(", ");
}

export function buildPresetReviewValues(
	preset?: WorkPolicyPresetReviewSource | null,
): WorkPolicyPresetInput {
	const breakRules = parsePresetBreakRules(preset?.breakRulesJson);
	const scheduleEnabled = Boolean(
		preset?.scheduleCycle || preset?.workingDaysPreset || preset?.hoursPerCycle,
	);
	const regulationEnabled = Boolean(
		preset?.maxDailyMinutes ||
			preset?.maxWeeklyMinutes ||
			preset?.maxUninterruptedMinutes ||
			breakRules.length,
	);

	return {
		name: preset?.name ?? "",
		description: preset?.description ?? undefined,
		countryCode: preset?.countryCode ?? null,
		scheduleEnabled,
		regulationEnabled,
		schedule: {
			scheduleCycle: preset?.scheduleCycle ?? "weekly",
			workingDaysPreset: preset?.workingDaysPreset ?? "weekdays",
			hoursPerCycle: preset?.hoursPerCycle ?? "40",
		},
		regulation: {
			maxDailyMinutes: preset?.maxDailyMinutes ?? undefined,
			maxWeeklyMinutes: preset?.maxWeeklyMinutes ?? undefined,
			maxUninterruptedMinutes: preset?.maxUninterruptedMinutes ?? undefined,
			breakRules,
		},
	};
}

export function filterWorkPolicyPresets<TPreset extends WorkPolicyPresetListItem>(
	presets: TPreset[],
	filters: PresetFilters,
): TPreset[] {
	const search = filters.search?.trim().toLowerCase();
	const source = filters.source ?? "all";
	const countryCode = filters.countryCode?.trim().toLowerCase();

	return presets.filter((preset) => {
		if (source !== "all" && getPresetSource(preset) !== source) return false;

		if (countryCode && preset.countryCode?.toLowerCase() !== countryCode) return false;

		if (!search) return true;

		return (
			preset.name.toLowerCase().includes(search) ||
			(preset.description?.toLowerCase().includes(search) ?? false)
		);
	});
}
