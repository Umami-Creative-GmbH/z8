"use client";

import { useTranslate } from "@tolgee/react";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import type {
	ContractFieldSource,
	EffectivePresenceStatus,
	WorkModel,
} from "@/lib/contracts/types";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import type { ContractType } from "@/lib/validations/employee";

/** Formats integer weekly or daily minutes as hours + minutes (e.g. `40h`, `37h 30m`). */
export function formatContractMinutes(minutes: number | null | undefined): string {
	if (minutes === null || minutes === undefined) return "—";
	const safe = Math.max(0, Math.round(minutes));
	const hours = Math.floor(safe / 60);
	const mins = safe % 60;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

/** Converts a decimal hours string (e.g. "38.5") to integer minutes. */
export function hoursInputToIntegerMinutes(raw: string): number | null {
	const trimmed = raw.trim().replace(",", ".");
	if (!trimmed) return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed * 60);
}

/** Converts integer minutes to a clean decimal hours string for form inputs. */
export function integerMinutesToHoursInput(minutes: number | null | undefined): string {
	if (minutes === null || minutes === undefined) return "";
	const hours = minutes / 60;
	return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
}

/**
 * Returns today's ISO calendar date (`YYYY-MM-DD`) in the organization's explicit IANA timezone
 * via Temporal — never from the viewer's browser timezone.
 */
export function todayIsoDateInTimezone(organizationTimezone: string): string {
	const zone = organizationTimezone || "UTC";
	try {
		return plainDateAt(systemClock.nowInstant(), zone).toString();
	} catch {
		return plainDateAt(systemClock.nowInstant(), "UTC").toString();
	}
}

export function useContractLabels() {
	const { t } = useTranslate();

	const fieldSource = (source: ContractFieldSource): string => {
		switch (source) {
			case "org_default":
				return t("settings.contracts.sources.orgDefault", "Org Default");
			case "team_default":
				return t("settings.contracts.sources.teamDefault", "Primary Team Default");
			case "employee_override":
				return t("settings.contracts.sources.employeeOverride", "Employee Override");
			case "employee_term":
				return t("settings.contracts.sources.employeeTerm", "Employee Term");
			case "legacy_assignment":
				return t("settings.contracts.sources.legacyAssignment", "Direct Policy Assignment");
			case "default":
				return t("settings.contracts.sources.systemDefault", "System Default");
		}
	};

	const workModel = (model: WorkModel | null | undefined): string => {
		switch (model) {
			case "onsite":
				return t("settings.contracts.workModel.onsite", "On-site");
			case "hybrid":
				return t("settings.contracts.workModel.hybrid", "Hybrid");
			case "remote":
				return t("settings.contracts.workModel.remote", "Remote");
			case "flexible":
				return t("settings.contracts.workModel.flexible", "Flexible");
			default:
				return t("settings.contracts.values.notSet", "Not set");
		}
	};

	const scheduleMode = (mode: ScheduleMode | null | undefined): string => {
		switch (mode) {
			case "inherit":
				return t("settings.contracts.scheduleMode.inherit", "Inherit from default");
			case "policy":
				return t("settings.contracts.scheduleMode.policy", "Follow work policy");
			case "hours_only":
				return t("settings.contracts.scheduleMode.hoursOnly", "Weekly hours target only");
			case "custom_days":
				return t("settings.contracts.scheduleMode.customDays", "Custom working days");
			default:
				return t("settings.contracts.values.notSet", "Not set");
		}
	};

	const presenceOverride = (override: PresenceOverride | null | undefined): string => {
		switch (override) {
			case "inherit":
				return t("settings.contracts.presenceOverride.inherit", "Inherit");
			case "exempt":
				return t("settings.contracts.presenceOverride.exempt", "Exempt from on-site requirement");
			case "require_onsite":
				return t("settings.contracts.presenceOverride.requireOnsite", "Require on-site presence");
			default:
				return t("settings.contracts.presenceOverride.inherit", "Inherit");
		}
	};

	const presenceStatus = (status: EffectivePresenceStatus): string => {
		switch (status) {
			case "required":
				return t("settings.contracts.presenceStatus.required", "On-site required");
			case "exempt":
				return t("settings.contracts.presenceStatus.exempt", "Exempt");
			case "not_configured":
				return t("settings.contracts.presenceStatus.notConfigured", "Not configured");
		}
	};

	const balanceMode = (mode: BalanceMode | null | undefined): string => {
		switch (mode) {
			case "tracked":
				return t("settings.contracts.balanceMode.tracked", "Tracked balance");
			case "trust_based":
				return t("settings.contracts.balanceMode.trustBased", "Trust-based working time");
			default:
				return t("settings.contracts.values.notSet", "Not set");
		}
	};

	const scheduleSource = (source: ScheduleSource | null | undefined): string => {
		switch (source) {
			case "policy":
				return t("settings.contracts.scheduleSource.policy", "Work policy / contract");
			case "published_shifts":
				return t("settings.contracts.scheduleSource.publishedShifts", "Published shifts");
			case "on_call":
				return t("settings.contracts.scheduleSource.onCall", "On-call (§ 12 TzBfG)");
			default:
				return t("settings.contracts.values.notSet", "Not set");
		}
	};

	const contractType = (type: ContractType): string => {
		switch (type) {
			case "fixed":
				return t("settings.contracts.contractType.fixed", "Fixed salary");
			case "hourly":
				return t("settings.contracts.contractType.hourly", "Hourly wage");
		}
	};

	const employmentProfile = (profile: EmploymentProfile): string => {
		switch (profile) {
			case "regular":
				return t("settings.contracts.employmentProfile.regular", "Regular employment");
			case "minijob":
				return t("settings.contracts.employmentProfile.minijob", "Minijob");
			case "short_term":
				return t("settings.contracts.employmentProfile.shortTerm", "Short-term employment");
			case "working_student":
				return t("settings.contracts.employmentProfile.workingStudent", "Working student");
			case "apprentice":
				return t("settings.contracts.employmentProfile.apprentice", "Apprentice");
		}
	};

	const arbzgScope = (scope: ArbzgScope): string => {
		switch (scope) {
			case "standard":
				return t("settings.contracts.arbzgScope.standard", "Standard (ArbZG applies)");
			case "executive_exempt":
				return t("settings.contracts.arbzgScope.executiveExempt", "Executive exempt (§ 18 ArbZG)");
		}
	};

	const onCallHoursKind = (kind: OnCallHoursKind): string => {
		switch (kind) {
			case "exact":
				return t("settings.contracts.onCall.exact", "Exact agreed weekly hours");
			case "minimum":
				return t("settings.contracts.onCall.minimum", "Minimum weekly hours (+25% call-in band)");
			case "maximum":
				return t("settings.contracts.onCall.maximum", "Maximum weekly hours (−20% call-in band)");
			case "unspecified":
				return t(
					"settings.contracts.onCall.unspecified",
					"Unspecified (20h/week statutory default)",
				);
		}
	};

	const operationalFieldName = (field: string): string => {
		switch (field) {
			case "workPolicy":
				return t("settings.contracts.fields.workPolicy", "Work policy");
			case "weeklyContractMinutes":
				return t("settings.contracts.fields.weeklyHours", "Weekly hours");
			case "scheduleMode":
				return t("settings.contracts.fields.scheduleMode", "Schedule mode");
			case "workModel":
				return t("settings.contracts.fields.workModel", "Work model");
			case "presenceOverride":
				return t("settings.contracts.fields.presenceOverride", "Presence override");
			case "presenceStatus":
				return t("settings.contracts.fields.presenceStatus", "On-site presence");
			case "balanceMode":
				return t("settings.contracts.fields.balanceMode", "Balance mode");
			case "scheduleSource":
				return t("settings.contracts.fields.scheduleSource", "Schedule source");
			case "migratedLegacyTerms":
				return t("settings.contracts.fields.migratedLegacyTerms", "Legacy terms inheritance");
			case "contractType":
				return t("settings.contracts.fields.contractType", "Contract type");
			case "hourlyRate":
				return t("settings.contracts.fields.hourlyRate", "Hourly rate");
			default:
				return field;
		}
	};

	return {
		fieldSource,
		workModel,
		scheduleMode,
		presenceOverride,
		presenceStatus,
		balanceMode,
		scheduleSource,
		contractType,
		employmentProfile,
		arbzgScope,
		onCallHoursKind,
		operationalFieldName,
	};
}
