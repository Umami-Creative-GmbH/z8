"use client";
/* eslint-disable react-doctor/no-giant-component */

import {
	IconArchive,
	IconCopy,
	IconEdit,
	IconFilePlus,
	IconLoader2,
	IconPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useReducer } from "react";
import { toast } from "sonner";
import {
	archiveWorkPolicyPreset,
	getWorkPolicyPresets,
	type WorkPolicyPresetWithSource,
} from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";
import { WorkPolicyPresetReviewDialog } from "./work-policy-preset-review-dialog";
import {
	filterWorkPolicyPresets,
	getPresetSource,
	type PresetSourceFilter,
	parsePresetBreakRules,
	summarizeBreakRules,
	summarizeMinutes,
} from "./work-policy-preset-utils";

interface WorkPolicyPresetImportProps {
	organizationId: string;
	onImportSuccess: () => void;
}

type ReviewMode = "createCustom" | "editCustom" | "copySystem" | "useAsPolicy";

interface PresetImportUiState {
	search: string;
	sourceFilter: PresetSourceFilter;
	countryFilter: string;
	reviewOpen: boolean;
	reviewMode: ReviewMode;
	reviewPreset: WorkPolicyPresetWithSource | null;
	archivePreset: WorkPolicyPresetWithSource | null;
}

type PresetImportUiAction =
	| { type: "setSearch"; value: string }
	| { type: "setSourceFilter"; value: PresetSourceFilter }
	| { type: "setCountryFilter"; value: string }
	| {
			type: "openReview";
			mode: ReviewMode;
			preset: WorkPolicyPresetWithSource | null;
	  }
	| { type: "setReviewOpen"; value: boolean }
	| { type: "setArchivePreset"; value: WorkPolicyPresetWithSource | null };

const presetImportInitialState: PresetImportUiState = {
	search: "",
	sourceFilter: "all",
	countryFilter: "all",
	reviewOpen: false,
	reviewMode: "createCustom",
	reviewPreset: null,
	archivePreset: null,
};

function presetImportUiReducer(
	state: PresetImportUiState,
	action: PresetImportUiAction,
): PresetImportUiState {
	switch (action.type) {
		case "setSearch":
			return { ...state, search: action.value };
		case "setSourceFilter":
			return { ...state, sourceFilter: action.value };
		case "setCountryFilter":
			return { ...state, countryFilter: action.value };
		case "openReview":
			return {
				...state,
				reviewMode: action.mode,
				reviewPreset: action.preset,
				reviewOpen: true,
			};
		case "setReviewOpen":
			return { ...state, reviewOpen: action.value };
		case "setArchivePreset":
			return { ...state, archivePreset: action.value };
		default:
			return state;
	}
}

const countryFlags: Record<string, string> = {
	DE: "🇩🇪",
	EU: "🇪🇺",
	FR: "🇫🇷",
	GB: "🇬🇧",
	CH: "🇨🇭",
	AT: "🇦🇹",
	US: "🇺🇸",
	INT: "🌍",
};

function getCountryLabel(countryCode: string | null | undefined): string {
	if (!countryCode) return "International";
	return `${countryFlags[countryCode] ?? countryFlags.INT} ${countryCode}`;
}

function getPresetSummary(preset: WorkPolicyPresetWithSource): string[] {
	return [
		`Cycle ${preset.scheduleCycle ?? "-"}`,
		`Hours ${preset.hoursPerCycle ?? "-"}`,
		`Daily ${summarizeMinutes(preset.maxDailyMinutes)}`,
		`Weekly ${summarizeMinutes(preset.maxWeeklyMinutes)}`,
		`Uninterrupted ${summarizeMinutes(preset.maxUninterruptedMinutes)}`,
		summarizeBreakRules(parsePresetBreakRules(preset.breakRulesJson)),
	];
}

export function WorkPolicyPresetImport({
	organizationId,
	onImportSuccess,
}: WorkPolicyPresetImportProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [uiState, dispatch] = useReducer(presetImportUiReducer, presetImportInitialState);

	const presetsQueryKey = queryKeys.workPolicies.presets(organizationId);

	const {
		data: presets,
		isLoading,
		error,
	} = useQuery({
		queryKey: presetsQueryKey,
		queryFn: async () => {
			const result = await getWorkPolicyPresets(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch presets");
			}
			return result.data;
		},
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	const archiveMutation = useMutation({
		mutationFn: (presetId: string) => archiveWorkPolicyPreset(organizationId, presetId),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(
					result.error || t("settings.workPolicies.archivePresetError", "Failed to archive preset"),
				);
				return;
			}

			toast.success(t("settings.workPolicies.archivePresetSuccess", "Preset archived"));
			queryClient.invalidateQueries({ queryKey: presetsQueryKey });
			dispatch({ type: "setArchivePreset", value: null });
			onImportSuccess();
		},
		onError: () => {
			toast.error(t("settings.workPolicies.archivePresetError", "Failed to archive preset"));
		},
	});

	const openReviewDialog = (mode: ReviewMode, preset: WorkPolicyPresetWithSource | null = null) => {
		dispatch({ type: "openReview", mode, preset });
	};

	const handleReviewSuccess = () => {
		queryClient.invalidateQueries({ queryKey: presetsQueryKey });
		queryClient.invalidateQueries({
			queryKey: queryKeys.workPolicies.list(organizationId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.workPolicies.assignments(organizationId),
		});
		onImportSuccess();
	};

	const countries = Array.from(
		new Set(
			(presets ?? [])
				.map((preset) => preset.countryCode)
				.filter((code): code is string => Boolean(code)),
		),
	).sort();
	const filteredPresets = filterWorkPolicyPresets(presets ?? [], {
		search: uiState.search,
		source: uiState.sourceFilter,
		countryCode: uiState.countryFilter === "all" ? null : uiState.countryFilter,
	});

	if (isLoading) {
		return (
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3].map((i) => (
					<Card key={i}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-full" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-28 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t("settings.workPolicies.presetsLoadError", "Failed to load presets")}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="font-semibold text-base">
						{t("settings.workPolicies.presetLibrary", "Preset library")}
					</h2>
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.workPolicies.presetLibraryDescription",
							"Start from system templates or maintain reusable custom presets.",
						)}
					</p>
				</div>
				<Button onClick={() => openReviewDialog("createCustom")}>
					<IconPlus className="mr-2 size-4" />
					{t("settings.workPolicies.createCustomPreset", "Create custom preset")}
				</Button>
			</div>

			<div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
				<Input
					aria-label={t("settings.workPolicies.searchPresets", "Search presets")}
					autoComplete="off"
					name="preset-search"
					value={uiState.search}
					onChange={(event) => dispatch({ type: "setSearch", value: event.target.value })}
					placeholder="Search presets..."
				/>
				<Select
					value={uiState.sourceFilter}
					onValueChange={(value) =>
						dispatch({
							type: "setSourceFilter",
							value: value as PresetSourceFilter,
						})
					}
				>
					<SelectTrigger className="w-full sm:w-36" aria-label="Preset source">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{t("settings.workPolicies.allSources", "All sources")}
						</SelectItem>
						<SelectItem value="system">
							{t("settings.workPolicies.systemSource", "System")}
						</SelectItem>
						<SelectItem value="custom">
							{t("settings.workPolicies.customSource", "Custom")}
						</SelectItem>
					</SelectContent>
				</Select>
				<Select
					value={uiState.countryFilter}
					onValueChange={(value) => dispatch({ type: "setCountryFilter", value })}
				>
					<SelectTrigger className="w-full sm:w-36" aria-label="Preset country">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{t("settings.workPolicies.allCountries", "All countries")}
						</SelectItem>
						{countries.map((countryCode) => (
							<SelectItem key={countryCode} value={countryCode}>
								{getCountryLabel(countryCode)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{!presets || presets.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<div className="flex flex-col items-center gap-4">
							<div className="rounded-full bg-muted p-4">
								<IconFilePlus className="size-8 text-muted-foreground" />
							</div>
							<div>
								<h3 className="font-medium text-lg">
									{t("settings.workPolicies.noPresets", "No presets available")}
								</h3>
								<p className="mt-1 text-muted-foreground text-sm">
									{t(
										"settings.workPolicies.noPresetsDescription",
										"Create a custom preset to reuse policy defaults across your organization.",
									)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			) : filteredPresets.length === 0 ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground text-sm">
						{t("settings.workPolicies.noMatchingPresets", "No presets match your filters")}
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filteredPresets.map((preset) => {
						const source = getPresetSource(preset);
						const isArchiving =
							archiveMutation.variables === preset.id && archiveMutation.isPending;

						return (
							<Card key={preset.id} className="flex flex-col">
								<CardHeader className="pb-3">
									<div className="flex items-start justify-between gap-3">
										<div className="space-y-2">
											<CardTitle className="text-base leading-tight">{preset.name}</CardTitle>
											<div className="flex flex-wrap gap-2">
												<Badge variant={source === "system" ? "secondary" : "outline"}>
													{source === "system"
														? t("settings.workPolicies.systemPreset", "System")
														: t("settings.workPolicies.customPreset", "Custom")}
												</Badge>
												<Badge variant="outline">{getCountryLabel(preset.countryCode)}</Badge>
											</div>
										</div>
									</div>
									{preset.description ? (
										<CardDescription className="line-clamp-2">{preset.description}</CardDescription>
									) : null}
								</CardHeader>
								<CardContent className="flex flex-1 flex-col justify-between gap-4">
									<div className="grid gap-2 text-sm">
										{getPresetSummary(preset).map((summary) => (
											<div
												key={summary}
												className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground"
											>
												{summary}
											</div>
										))}
									</div>

									<div className="grid gap-2">
										<Button size="sm" onClick={() => openReviewDialog("useAsPolicy", preset)}>
											<IconFilePlus className="mr-2 size-4" />
											{t("settings.workPolicies.useAsPolicy", "Use as policy")}
										</Button>
										{source === "system" ? (
											<Button
												variant="outline"
												size="sm"
												onClick={() => openReviewDialog("copySystem", preset)}
											>
												<IconCopy className="mr-2 size-4" />
												{t("settings.workPolicies.copyToCustomPreset", "Copy to custom preset")}
											</Button>
										) : (
											<div className="grid grid-cols-2 gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => openReviewDialog("editCustom", preset)}
												>
													<IconEdit className="mr-2 size-4" />
													{t("settings.workPolicies.editPreset", "Edit preset")}
												</Button>
												<Button
													variant="outline"
													size="sm"
													disabled={archiveMutation.isPending}
													onClick={() =>
														dispatch({
															type: "setArchivePreset",
															value: preset,
														})
													}
												>
													{isArchiving ? (
														<IconLoader2 className="mr-2 size-4 animate-spin" />
													) : (
														<IconArchive className="mr-2 size-4" />
													)}
													{t("settings.workPolicies.archivePreset", "Archive")}
												</Button>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<WorkPolicyPresetReviewDialog
				open={uiState.reviewOpen}
				onOpenChange={(open) => dispatch({ type: "setReviewOpen", value: open })}
				organizationId={organizationId}
				mode={uiState.reviewMode}
				preset={uiState.reviewPreset}
				onSuccess={handleReviewSuccess}
			/>

			<AlertDialog
				open={uiState.archivePreset !== null}
				onOpenChange={(open) => {
					if (!open) dispatch({ type: "setArchivePreset", value: null });
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.workPolicies.archivePresetTitle", "Archive custom preset?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.workPolicies.archivePresetDescription",
								"This removes the preset from the library. Existing policies created from it are not changed.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={archiveMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!uiState.archivePreset || archiveMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (uiState.archivePreset) archiveMutation.mutate(uiState.archivePreset.id);
							}}
						>
							{archiveMutation.isPending ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" />
							) : null}
							{t("settings.workPolicies.confirmArchivePreset", "Archive preset")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
