"use client";

import type { DateRange } from "@daypicker/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type ExistingDataCounts,
	fetchClockodoUsers,
	fetchZ8Employees,
	getExistingDataCounts,
	saveUserMappings,
	validateClockodoCredentials,
	type Z8EmployeeInfo,
} from "@/app/[locale]/(app)/settings/clockodo-import/actions";
import { startImportReviewScan } from "@/app/[locale]/(app)/settings/import/review-actions";
import type {
	ClockodoDataPreview,
	DateRangePreset,
	ImportSelections,
	UserMappingEntry,
	UserMappingType,
} from "@/lib/clockodo/types";
import type { ImportEntityType } from "@/lib/import-review/types";

export type ClockodoWizardStep =
	| "credentials"
	| "preview"
	| "user-mapping"
	| "selection"
	| "importing"
	| "complete";

export const CLOCKODO_IMPORT_ENTITIES = [
	{ key: "users", label: "Users / Employees", icon: "users" },
	{ key: "teams", label: "Teams", icon: "users-group" },
	{ key: "services", label: "Services / Work Categories", icon: "tag" },
	{
		key: "entries",
		label: "Time Entries / Work Periods",
		icon: "clock",
		dependsOn: ["users", "services"],
	},
	{
		key: "absences",
		label: "Absences",
		icon: "calendar-off",
		dependsOn: ["users"],
	},
	{
		key: "targetHours",
		label: "Target Hours / Work Policies",
		icon: "clock-edit",
		dependsOn: ["users"],
	},
	{
		key: "holidayQuotas",
		label: "Holiday Quotas / Vacation Allowances",
		icon: "beach",
		dependsOn: ["users"],
	},
	{
		key: "nonBusinessDays",
		label: "Non-Business Days / Holidays",
		icon: "calendar-event",
	},
	{ key: "surcharges", label: "Surcharges", icon: "percentage" },
] as const;

export type ClockodoEntityKey =
	(typeof CLOCKODO_IMPORT_ENTITIES)[number]["key"];

const entityTypeBySelection = {
	users: "employee",
	teams: "team",
	services: "work_category",
	entries: "work_period",
	absences: "absence",
	targetHours: "target_hours",
	holidayQuotas: "holiday_quota",
	nonBusinessDays: "holiday",
	surcharges: "surcharge",
} satisfies Record<ClockodoEntityKey, ImportEntityType>;

export const CLOCKODO_DATE_RANGE_PRESETS: {
	value: DateRangePreset;
	label: string;
}[] = [
	{ value: "all_data", label: "All data (last 10 years)" },
	{ value: "this_year", label: "This year" },
	{ value: "this_year_and_last", label: "This year + last year" },
	{ value: "last_6_months", label: "Last 6 months" },
	{ value: "last_12_months", label: "Last 12 months" },
	{ value: "custom", label: "Custom date range" },
];

function isoDate(value: string) {
	try {
		return Temporal.Instant.from(value)
			.toZonedDateTimeISO("UTC")
			.toPlainDate()
			.toString();
	} catch {
		return Temporal.PlainDate.from(value.slice(0, 10)).toString();
	}
}

function resolveReviewDateRange(dateRange: ImportSelections["dateRange"]) {
	const now = Temporal.Now.plainDateISO("UTC");
	if (
		dateRange.preset === "custom" &&
		dateRange.startDate &&
		dateRange.endDate
	) {
		return {
			startDate: isoDate(dateRange.startDate),
			endDate: isoDate(dateRange.endDate),
		};
	}
	const starts = {
		all_data: now.subtract({ years: 10 }),
		this_year: now.with({ month: 1, day: 1 }),
		this_year_and_last: now.subtract({ years: 1 }).with({ month: 1, day: 1 }),
		last_6_months: now.subtract({ months: 6 }),
		last_12_months: now.subtract({ years: 1 }),
		custom: now.subtract({ years: 10 }),
	};
	return {
		startDate: starts[dateRange.preset].toString(),
		endDate: now.toString(),
	};
}

function selectedClockodoUserIds(
	userMappings: UserMappingEntry[],
	onlyImportMapped: boolean,
) {
	return userMappings.flatMap((mapping) =>
		mapping.mappingType !== "skipped" &&
		(!onlyImportMapped || mapping.employeeId != null)
			? [String(mapping.clockodoUserId)]
			: [],
	);
}

function hasSelectedUserScopedEntity(selections: ImportSelections) {
	return (
		selections.users ||
		selections.entries ||
		selections.absences ||
		selections.targetHours ||
		selections.holidayQuotas
	);
}

function buildUserMappings(
	users: Array<{ id: number; name: string; email: string }>,
	employees: Z8EmployeeInfo[],
) {
	const employeeByEmail = new Map(
		employees.map((employee) => [employee.email.toLowerCase(), employee]),
	);
	return users.map((user): UserMappingEntry => {
		const employee = employeeByEmail.get(user.email.toLowerCase());
		return {
			clockodoUserId: user.id,
			clockodoUserName: user.name,
			clockodoUserEmail: user.email,
			mappingType: employee ? "auto_email" : "new_employee",
			employeeId: employee?.id ?? null,
			userId: employee?.userId ?? null,
			employeeName: employee?.name ?? null,
		};
	});
}

export function useClockodoImportController(organizationId: string) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [step, setStep] = useState<ClockodoWizardStep>("credentials");
	const [email, setEmail] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [preview, setPreview] = useState<ClockodoDataPreview | null>(null);
	const [existingCounts, setExistingCounts] =
		useState<ExistingDataCounts | null>(null);
	const [z8Employees, setZ8Employees] = useState<Z8EmployeeInfo[]>([]);
	const [userMappings, setUserMappings] = useState<UserMappingEntry[]>([]);
	const [onlyImportMapped, setOnlyImportMapped] = useState(false);
	const [reviewBatchId, setReviewBatchId] = useState<string | null>(null);
	const [selections, setSelections] = useState<ImportSelections>({
		users: true,
		teams: true,
		services: true,
		entries: true,
		absences: true,
		targetHours: true,
		holidayQuotas: true,
		nonBusinessDays: true,
		surcharges: true,
		dateRange: { preset: "all_data", startDate: null, endDate: null },
	});

	const validateMutation = useMutation({
		mutationFn: async () => {
			const [credResult, countsResult] = await Promise.all([
				validateClockodoCredentials(email, apiKey, organizationId),
				getExistingDataCounts(organizationId),
			]);
			return { credResult, countsResult };
		},
		onSuccess: ({ credResult, countsResult }) => {
			if (!credResult.success) return toast.error(credResult.error);
			queryClient.invalidateQueries();
			setPreview(credResult.data);
			if (countsResult.success) setExistingCounts(countsResult.data);
			setStep("preview");
		},
		onError: () =>
			toast.error(
				t(
					"settings.clockodoImport.errors.connectionFailed",
					"Failed to connect to Clockodo",
				),
			),
	});

	const fetchUsersMutation = useMutation({
		mutationFn: async () => {
			const [usersResult, employeesResult] = await Promise.all([
				fetchClockodoUsers(email, apiKey, organizationId),
				fetchZ8Employees(organizationId),
			]);
			return { usersResult, employeesResult };
		},
		onSuccess: ({ usersResult, employeesResult }) => {
			if (!usersResult.success) {
				toast.error(usersResult.error);
				return;
			}
			if (!employeesResult.success) {
				toast.error(employeesResult.error);
				return;
			}
			queryClient.invalidateQueries();
			setZ8Employees(employeesResult.data);
			setUserMappings(
				buildUserMappings(usersResult.data, employeesResult.data),
			);
			setStep("user-mapping");
		},
		onError: () =>
			toast.error(
				t(
					"settings.clockodoImport.errors.fetchUsersFailed",
					"Failed to fetch user data",
				),
			),
	});

	const saveMappingsMutation = useMutation({
		mutationFn: () => saveUserMappings(organizationId, userMappings),
		onSuccess: (result) => {
			if (!result.success) return toast.error(result.error);
			queryClient.invalidateQueries();
			setStep("selection");
		},
		onError: () =>
			toast.error(
				t(
					"settings.clockodoImport.errors.saveMappingsFailed",
					"Failed to save user mappings",
				),
			),
	});

	const selectedEmployeeIds = selectedClockodoUserIds(
		userMappings,
		onlyImportMapped,
	);
	const importMutation = useMutation({
		mutationFn: () =>
			startImportReviewScan({
				organizationId,
				provider: "clockodo",
				credential: JSON.stringify({ email, apiKey }),
				selectedScope: selections,
				dateRange: resolveReviewDateRange(selections.dateRange),
				employeeIds: selectedEmployeeIds,
				entityTypes: CLOCKODO_IMPORT_ENTITIES.flatMap((entity) =>
					selections[entity.key] ? [entityTypeBySelection[entity.key]] : [],
				),
			}),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(result.error);
				setStep("selection");
				return;
			}
			queryClient.invalidateQueries();
			setReviewBatchId(result.data.batchId);
			toast.success(
				t(
					"settings.clockodoImport.review.startedToast",
					"Import review scan started. Review is required before records are committed.",
				),
			);
			setStep("complete");
		},
		onError: () => {
			toast.error(
				t(
					"settings.clockodoImport.errors.importFailed",
					"Import review scan failed",
				),
			);
			setStep("selection");
		},
	});

	const updateMappingType = (id: number, mappingType: UserMappingType) =>
		setUserMappings((current) =>
			current.map((mapping) =>
				mapping.clockodoUserId !== id
					? mapping
					: mappingType === "skipped" || mappingType === "new_employee"
						? {
								...mapping,
								mappingType,
								employeeId: null,
								userId: null,
								employeeName: null,
							}
						: { ...mapping, mappingType },
			),
		);
	const updateMappingEmployee = (id: number, employeeId: string) => {
		const employee = z8Employees.find((entry) => entry.id === employeeId);
		if (!employee) return;
		setUserMappings((current) =>
			current.map((mapping) =>
				mapping.clockodoUserId === id
					? {
							...mapping,
							mappingType: "manual",
							employeeId: employee.id,
							userId: employee.userId,
							employeeName: employee.name,
						}
					: mapping,
			),
		);
	};
	const updateDateRange = (preset: DateRangePreset) =>
		setSelections((current) => ({
			...current,
			dateRange: {
				preset,
				startDate: current.dateRange.startDate,
				endDate: current.dateRange.endDate,
			},
		}));
	const updateCustomDateRange = (range: DateRange | undefined) =>
		setSelections((current) => ({
			...current,
			dateRange: {
				preset: "custom",
				startDate: range?.from?.toISOString() ?? null,
				endDate: range?.to?.toISOString() ?? null,
			},
		}));
	const isCustomDateRangeIncomplete =
		selections.dateRange.preset === "custom" &&
		(!selections.dateRange.startDate || !selections.dateRange.endDate);
	const isUserScopedSelectionEmpty =
		userMappings.length > 0 &&
		hasSelectedUserScopedEntity(selections) &&
		selectedEmployeeIds.length === 0;
	const hasSelectedEntities = Object.entries(selections).some(
		([key, value]) => key !== "dateRange" && value === true,
	);

	return {
		apiKey,
		email,
		existingCounts,
		fetchUsersMutation,
		hasSelectedEntities,
		importMutation,
		isCustomDateRangeIncomplete,
		isUserScopedSelectionEmpty,
		onlyImportMapped,
		preview,
		reviewBatchId,
		saveMappingsMutation,
		selections,
		setApiKey,
		setEmail,
		setOnlyImportMapped,
		setSelections,
		setStep,
		step,
		updateCustomDateRange,
		updateDateRange,
		updateMappingEmployee,
		updateMappingType,
		userMappings,
		validateMutation,
		z8Employees,
	};
}

export type ClockodoImportController = ReturnType<
	typeof useClockodoImportController
>;
