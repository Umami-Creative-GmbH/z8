"use client";

import { useTranslate } from "@tolgee/react";
import {
	startTransition,
	useEffect,
	useEffectEvent,
	useReducer,
	useState,
} from "react";
import { toast } from "sonner";
import {
	bulkAddHolidaysToPreset,
	createHolidayPreset,
	createPresetAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { buildPresetHolidayImportValue, isHolidayType } from "../holiday-import-utils";
import {
	createRequestVersionGuard,
	getHolidayIdentity,
	getPresetNameWithYear,
	getYearAssignmentRange,
} from "./holiday-import-helpers";
import {
	type CountryOption,
	type HolidayImportSetState,
	type HolidayImportState,
	type HolidayPreview,
	type HolidayType,
	holidayImportReducer,
	initialHolidayImportState,
	setHolidayImportState,
} from "./holiday-import-state";

type ImportValue = NonNullable<ReturnType<typeof buildPresetHolidayImportValue>>;
type OperationResult = { success: boolean; error?: string };
type PresetInput = {
	name: string;
	description: string;
	countryCode: string;
	stateCode?: string;
	regionCode?: string;
	year: number;
	color: string;
	isActive: boolean;
};
type AssignmentInput = {
	presetId: string;
	assignmentType: "organization";
	effectiveFrom: Date;
	effectiveUntil: Date;
	isActive: boolean;
};

type RequestVersionGuard = {
	invalidate: () => unknown;
};

export function invalidateLocationRequests(guard: RequestVersionGuard, set: HolidayImportSetState) {
	guard.invalidate();
	set("statesLoading", false);
	set("regionsLoading", false);
}

export function invalidatePreviewRequests(guard: RequestVersionGuard, set: HolidayImportSetState) {
	guard.invalidate();
	set("previewLoading", false);
}

export function changePreviewInput<K extends "selectedYear" | "selectedTypes">(
	guard: RequestVersionGuard,
	set: HolidayImportSetState,
	key: K,
	value: HolidayImportState[K] | ((current: HolidayImportState[K]) => HolidayImportState[K]),
) {
	invalidatePreviewRequests(guard, set);
	set(key, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isLocationOption(value: unknown): value is CountryOption {
	return isRecord(value) && typeof value.code === "string" && typeof value.name === "string";
}

function isHolidayPreview(value: unknown): value is HolidayPreview {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.date === "string" &&
		typeof value.startDate === "string" &&
		typeof value.endDate === "string" &&
		typeof value.type === "string" &&
		isHolidayType(value.type) &&
		(value.region === undefined || typeof value.region === "string") &&
		typeof value.isDuplicate === "boolean"
	);
}

async function readJson(response: Response): Promise<unknown | null> {
	return response.json().catch(() => null);
}

function getLocationOptions(data: unknown, key: "countries" | "states" | "regions") {
	if (!isRecord(data) || !Array.isArray(data[key]) || !data[key].every(isLocationOption))
		return null;
	return data[key];
}

function getPreviewHolidays(data: unknown) {
	if (!isRecord(data) || !Array.isArray(data.holidays) || !data.holidays.every(isHolidayPreview))
		return null;
	return data.holidays;
}

export async function runHolidayImport({
	organizationId,
	preset,
	holidays,
	setAsOrgDefault,
	messages,
	actions,
	toast: notifications,
	onSuccess,
	onClose,
}: {
	organizationId: string;
	preset: PresetInput;
	holidays: ImportValue[];
	setAsOrgDefault: boolean;
	messages: { assignmentWarning: string; success: string };
	actions: {
		createPreset: (
			organizationId: string,
			preset: PresetInput,
		) => Promise<{ success: boolean; error?: string; data?: { id: string } }>;
		addHolidays: (presetId: string, holidays: ImportValue[]) => Promise<OperationResult>;
		createAssignment: (
			organizationId: string,
			assignment: AssignmentInput,
		) => Promise<OperationResult>;
	};
	toast: {
		error: (message: string) => void;
		warning: (message: string) => void;
		success: (message: string) => void;
	};
	onSuccess: () => void;
	onClose: () => void;
}): Promise<{ success: boolean }> {
	const presetResult = await actions.createPreset(organizationId, preset).catch((error) => {
		console.error("Failed to create preset:", error);
		return null;
	});
	if (!presetResult?.success || !presetResult.data) {
		notifications.error(presetResult?.error || "Failed to create preset");
		return { success: false };
	}

	const operations: Promise<OperationResult>[] = [];
	if (holidays.length > 0) operations.push(actions.addHolidays(presetResult.data.id, holidays));
	if (setAsOrgDefault) {
		const range = getYearAssignmentRange(preset.year);
		operations.push(
			actions.createAssignment(organizationId, {
				presetId: presetResult.data.id,
				assignmentType: "organization",
				...range,
				isActive: true,
			}),
		);
	}
	const results = await Promise.all(operations).catch((error) => {
		console.error("Failed to complete import operations:", error);
		return null;
	});
	if (!results) {
		notifications.error("Failed to create preset");
		return { success: false };
	}

	const bulkResult = holidays.length > 0 ? results[0] : undefined;
	if (bulkResult && !bulkResult.success) {
		notifications.error(bulkResult.error || "Failed to add holidays to preset");
		return { success: false };
	}
	const assignmentResult = setAsOrgDefault ? results[holidays.length > 0 ? 1 : 0] : undefined;
	if (assignmentResult && !assignmentResult.success)
		notifications.warning(messages.assignmentWarning);
	notifications.success(messages.success);
	onSuccess();
	onClose();
	return { success: true };
}

export function useHolidayImportController({
	open,
	organizationId,
	onOpenChange,
	onSuccess,
}: {
	open: boolean;
	organizationId: string;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}) {
	const { t } = useTranslate();
	const [state, dispatch] = useReducer(holidayImportReducer, undefined, initialHolidayImportState);
	const [locationRequests] = useState(createRequestVersionGuard);
	const [previewRequests] = useState(createRequestVersionGuard);
	const set: HolidayImportSetState = (key, value) => {
		dispatch(setHolidayImportState(key, value));
	};
	const invalidateRequests = () => {
		invalidateLocationRequests(locationRequests, set);
		invalidatePreviewRequests(previewRequests, set);
	};
	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) invalidateRequests();
		onOpenChange(nextOpen);
	};
	const close = () => handleOpenChange(false);
	const reset = useEffectEvent(() => {
		invalidateRequests();
		dispatch(() => initialHolidayImportState());
	});
	const loadCountries = useEffectEvent(async () => {
		const requestVersion = locationRequests.start();
		set("countriesLoading", true);
		const response = await fetch("/api/location/countries").catch((error) => {
			console.error("Failed to load countries:", error);
			return null;
		});
		if (!locationRequests.isCurrent(requestVersion)) return;
		if (!response) {
			toast.error("Failed to load countries");
			set("countriesLoading", false);
			return;
		}
		const countries = response.ok
			? getLocationOptions(await readJson(response), "countries")
			: null;
		if (!locationRequests.isCurrent(requestVersion)) return;
		if (countries) set("countries", countries);
		set("countriesLoading", false);
	});
	useEffect(() => {
		if (!open) {
			startTransition(reset);
			return;
		}
		if (state.countries.length === 0) {
			const timeout = setTimeout(() => void loadCountries(), 0);
			return () => clearTimeout(timeout);
		}
	}, [open, state.countries.length]);

	async function loadLocation(kind: "states" | "regions", country: string, selectedState = "") {
		const requestVersion = locationRequests.start();
		set(kind === "states" ? "statesLoading" : "regionsLoading", true);
		const query =
			kind === "states"
				? `states?country=${encodeURIComponent(country)}`
				: `regions?country=${encodeURIComponent(country)}&state=${encodeURIComponent(selectedState)}`;
		const response = await fetch(`/api/location/${query}`).catch((error) => {
			console.error(`Failed to load ${kind}:`, error);
			return null;
		});
		if (!locationRequests.isCurrent(requestVersion)) return;
		const options = response?.ok ? getLocationOptions(await readJson(response), kind) : null;
		if (!locationRequests.isCurrent(requestVersion)) return;
		if (options) set(kind, options);
		set(kind === "states" ? "statesLoading" : "regionsLoading", false);
	}

	async function loadPreview() {
		const requestVersion = previewRequests.start();
		set("previewLoading", true);
		const params = new URLSearchParams({
			country: state.selectedCountry,
			year: state.selectedYear.toString(),
			types: state.selectedTypes.join(","),
		});
		if (state.selectedState) params.set("state", state.selectedState);
		if (state.selectedRegion) params.set("region", state.selectedRegion);
		const response = await fetch(`/api/org-admin/holidays/preview?${params}`).catch((error) => {
			console.error("Failed to load preview:", error);
			return null;
		});
		if (!previewRequests.isCurrent(requestVersion)) return;
		const data = response ? await readJson(response) : null;
		if (!previewRequests.isCurrent(requestVersion)) return;
		if (!response?.ok) {
			const error = isRecord(data) && typeof data.error === "string" ? data.error : null;
			toast.error(error || "Failed to load holidays");
			set("previewLoading", false);
			return;
		}
		const holidays = getPreviewHolidays(data);
		if (!holidays) {
			toast.error("Failed to load holidays");
			set("previewLoading", false);
			return;
		}
		set("holidays", holidays);
		const selectedHolidays = new Set<string>();
		for (const holiday of holidays) {
			if (!holiday.isDuplicate) selectedHolidays.add(getHolidayIdentity(holiday));
		}
		set("selectedHolidays", selectedHolidays);
		const names = [
			state.countries.find((country) => country.code === state.selectedCountry)?.name ||
				state.selectedCountry,
			state.states.find((item) => item.code === state.selectedState)?.name,
			state.regions.find((item) => item.code === state.selectedRegion)?.name,
		].filter(Boolean);
		set("presetName", getPresetNameWithYear(names.join(" - "), state.selectedYear));
		set("step", 2);
		set("previewLoading", false);
	}

	async function importHolidays() {
		set("importLoading", true);
		const holidays: ImportValue[] = [];
		for (const holiday of state.holidays) {
			if (!state.selectedHolidays.has(getHolidayIdentity(holiday))) continue;
			const importValue = buildPresetHolidayImportValue(holiday);
			if (importValue !== null) holidays.push(importValue);
		}
		await runHolidayImport({
			organizationId,
			preset: {
				name: state.presetName,
				description: "",
				countryCode: state.selectedCountry,
				stateCode: state.selectedState || undefined,
				regionCode: state.selectedRegion || undefined,
				year: state.selectedYear,
				color: state.presetColor,
				isActive: true,
			},
			holidays,
			setAsOrgDefault: state.setAsOrgDefault,
			messages: {
				assignmentWarning: t(
					"settings.holidays.import.defaultWarning",
					"Preset created but could not set as organization default",
				),
				success: t(
					"settings.holidays.import.presetSuccess",
					`Created preset "{name}" with ${holidays.length} holidays`,
					{ name: state.presetName, count: holidays.length },
				),
			},
			actions: {
				createPreset: createHolidayPreset,
				addHolidays: bulkAddHolidaysToPreset,
				createAssignment: createPresetAssignment,
			},
			toast,
			onSuccess,
			onClose: close,
		});
		set("importLoading", false);
	}

	function changeCountry(country: string) {
		invalidatePreviewRequests(previewRequests, set);
		invalidateLocationRequests(locationRequests, set);
		set("selectedCountry", country);
		set("selectedState", "");
		set("selectedRegion", "");
		set("states", []);
		set("regions", []);
		if (country) void loadLocation("states", country);
	}

	function changeState(selectedState: string) {
		invalidatePreviewRequests(previewRequests, set);
		invalidateLocationRequests(locationRequests, set);
		set("selectedState", selectedState);
		set("selectedRegion", "");
		set("regions", []);
		if (state.selectedCountry && selectedState) {
			void loadLocation("regions", state.selectedCountry, selectedState);
		}
	}

	function changeRegion(region: string) {
		invalidatePreviewRequests(previewRequests, set);
		set("selectedRegion", region);
	}

	function changeYear(year: number) {
		changePreviewInput(previewRequests, set, "selectedYear", year);
	}

	return {
		state,
		set,
		loadPreview,
		importHolidays,
		changeCountry,
		changeState,
		changeRegion,
		changeYear,
		toggleHoliday: (identity: string) =>
			set("selectedHolidays", (current) => {
				const selected = new Set(current);
				if (selected.has(identity)) selected.delete(identity);
				else selected.add(identity);
				return selected;
			}),
		toggleType: (type: HolidayType) =>
			changePreviewInput(previewRequests, set, "selectedTypes", (types) =>
				types.includes(type) ? types.filter((item) => item !== type) : [...types, type],
			),
		close,
		handleOpenChange,
	};
}
