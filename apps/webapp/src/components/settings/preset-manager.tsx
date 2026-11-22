"use client";

import {
	IconCalendar,
	IconDotsVertical,
	IconEdit,
	IconMapPin,
	IconPlus,
	IconTrash,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteHolidayPreset,
	getHolidayPresets,
} from "@/app/[locale]/(app)/settings/vacation/holiday-preset-actions";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
	actionErrorMessage,
	type RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { SettingsLoadError } from "./settings-load-error";

/** A delete refused because the preset is still assigned. */
const DELETE_REFUSALS: RefusalOverrides = {
	ConflictError: [
		"settings.holidays.presets.deleteHasAssignments",
		"This preset is still assigned. Remove its assignments first.",
	],
};

interface PresetManagerProps {
	organizationId: string;
	onImportClick: () => void;
	onEditClick: (preset: PresetData) => void;
}

interface PresetData {
	id: string;
	name: string;
	description: string | null;
	countryCode: string | null;
	stateCode: string | null;
	regionCode: string | null;
	year: number | null;
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	holidayCount: number;
	assignmentCount: number;
}

function formatLocation(preset: PresetData) {
	const parts = [preset.countryCode, preset.stateCode, preset.regionCode].filter(Boolean);
	return parts.length > 0 ? parts.join(" - ") : null;
}

export function PresetManager({ organizationId, onImportClick, onEditClick }: PresetManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedPreset, setSelectedPreset] = useState<PresetData | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Fetch presets
	const { data, isLoading, error, refetch, isFetching } = useQuery({
		queryKey: queryKeys.holidayPresets.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayPresets();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch presets");
			}
			return result.data as PresetData[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (presetId: string) => deleteHolidayPreset(presetId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.presets.deleted", "Preset deleted successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.list(organizationId) });
				setDeleteDialogOpen(false);
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteError(
					actionErrorMessage(t, result, DELETE_REFUSALS, [
						"settings.holidays.presets.deleteFailed",
						"Failed to delete preset",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(t("settings.holidays.presets.deleteFailed", "Failed to delete preset"));
		},
	});

	const handleDeleteClick = (preset: PresetData) => {
		setSelectedPreset(preset);
		setDeleteError(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedPreset && !deleteMutation.isPending) {
			setDeleteError(null);
			deleteMutation.mutate(selectedPreset.id);
		}
	};

	function formatPresetYear(year: number) {
		return t("settings.holidays.presets.yearValue", "Year {year}", { year });
	}

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<Skeleton className="h-6 w-40 mb-2" />
							<Skeleton className="h-4 w-64" />
						</div>
						<Skeleton className="h-10 w-32" />
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-32" />
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<SettingsLoadError
				message={t("settings.holidays.presets.loadError", "Failed to load presets")}
				onRetry={() => void refetch()}
				isRetrying={isFetching}
			/>
		);
	}

	const presets = data || [];

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="min-w-0 flex-[1_1_16rem]">
							<CardTitle>
								<h2>{t("settings.holidays.presets.title", "Holiday Presets")}</h2>
							</CardTitle>
							<CardDescription>
								{t(
									"settings.holidays.presets.description",
									"Create reusable holiday sets for different locations that can be assigned to teams or employees",
								)}
							</CardDescription>
						</div>
						<Button onClick={onImportClick}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.holidays.presets.import", "Import Holidays")}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{presets.length === 0 ? (
						<div className="text-center py-10 text-muted-foreground">
							<IconCalendar aria-hidden="true" className="size-8 mx-auto mb-3" />
							<h3 className="text-base font-medium text-foreground mb-1">
								{t("settings.holidays.presets.empty", "No presets yet")}
							</h3>
							<p className="text-sm mb-4">
								{t(
									"settings.holidays.presets.emptyDescription",
									"Import holidays from a country to create your first preset",
								)}
							</p>
							<Button onClick={onImportClick} variant="outline">
								<IconPlus className="mr-2 size-4" />
								{t("settings.holidays.presets.importFirst", "Import Your First Preset")}
							</Button>
						</div>
					) : (
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							{presets.map((preset) => (
								<div
									key={preset.id}
									className="relative rounded-lg border p-4 hover:bg-accent/50 transition-colors"
								>
									<div className="flex items-start justify-between">
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												{preset.color && (
													<div
														aria-hidden="true"
														className="size-3 rounded-full flex-shrink-0"
														style={{ backgroundColor: preset.color }}
													/>
												)}
												<h3 className="min-w-0 font-medium truncate" title={preset.name}>
													{preset.name}
												</h3>
											</div>
											{preset.year && (
												<Badge variant="outline" className="mt-2">
													{formatPresetYear(preset.year)}
												</Badge>
											)}
											{formatLocation(preset) && (
												<div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
													<IconMapPin className="size-3" />
													<span>{formatLocation(preset)}</span>
												</div>
											)}
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													className="size-8"
													aria-label={`${t("settings.holidays.presets.actions", "Preset actions")}: ${preset.name}`}
												>
													<IconDotsVertical aria-hidden="true" className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onEditClick(preset)}>
													<IconEdit className="mr-2 size-4" />
													{t("common.edit", "Edit")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onClick={() => handleDeleteClick(preset)}
													className="text-destructive focus:text-destructive"
													disabled={preset.assignmentCount > 0}
												>
													<IconTrash className="mr-2 size-4" />
													{t("common.delete", "Delete")}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-muted-foreground">
										<div className="flex items-center gap-1">
											<IconCalendar aria-hidden="true" className="size-4" />
											<span className="tabular-nums">
												{preset.holidayCount} {t("settings.holidays.presets.holidays", "holidays")}
											</span>
										</div>
										{preset.assignmentCount > 0 && (
											<Badge
												variant="secondary"
												className="gap-1 tabular-nums"
												title={t(
													"settings.holidays.presets.assignmentCount",
													"{count, plural, one {# assignment} other {# assignments}}",
													{ count: preset.assignmentCount },
												)}
											>
												<IconUsers aria-hidden="true" className="size-3" />
												<span aria-hidden="true">{preset.assignmentCount}</span>
												<span className="sr-only">
													{t(
														"settings.holidays.presets.assignmentCount",
														"{count, plural, one {# assignment} other {# assignments}}",
														{ count: preset.assignmentCount },
													)}
												</span>
											</Badge>
										)}
									</div>
									{!preset.isActive && (
										<Badge variant="outline" className="mt-2">
											{t("common.inactive", "Inactive")}
										</Badge>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Delete Confirmation Dialog */}
			<ConfirmActionDialog
				open={deleteDialogOpen}
				onOpenChange={(open) => {
					setDeleteDialogOpen(open);
					if (!open) setDeleteError(null);
				}}
				title={t("settings.holidays.presets.deleteTitle", "Delete Preset?")}
				description={
					<>
						{t(
							"settings.holidays.presets.deleteDescription",
							'This will permanently delete the preset "{name}" and all its holidays.',
							{ name: selectedPreset?.name },
						)}
						{selectedPreset?.assignmentCount ? (
							<span className="block mt-2 text-destructive font-medium">
								{t(
									"settings.holidays.presets.hasAssignments",
									"This preset has active assignments and cannot be deleted.",
								)}
							</span>
						) : null}
					</>
				}
				confirmLabel={t("common.delete", "Delete")}
				pendingLabel={t("common.deleting", "Deleting...")}
				isPending={deleteMutation.isPending}
				confirmDisabled={(selectedPreset?.assignmentCount ?? 0) > 0}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}
