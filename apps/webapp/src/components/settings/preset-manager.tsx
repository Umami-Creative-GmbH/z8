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
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

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
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	holidayCount: number;
	assignmentCount: number;
}

export function PresetManager({ organizationId, onImportClick, onEditClick }: PresetManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedPreset, setSelectedPreset] = useState<PresetData | null>(null);

	// Fetch presets
	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.holidayPresets.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayPresets(organizationId);
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
				setSelectedPreset(null);
			} else {
				toast.error(result.error || t("settings.holidays.presets.deleteFailed", "Failed to delete preset"));
			}
		},
		onError: () => {
			toast.error(t("settings.holidays.presets.deleteFailed", "Failed to delete preset"));
		},
	});

	const handleDeleteClick = (preset: PresetData) => {
		setSelectedPreset(preset);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedPreset) {
			deleteMutation.mutate(selectedPreset.id);
		}
	};

	const formatLocation = (preset: PresetData) => {
		const parts = [preset.countryCode, preset.stateCode, preset.regionCode].filter(Boolean);
		return parts.length > 0 ? parts.join(" - ") : null;
	};

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
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">{t("settings.holidays.presets.loadError", "Failed to load presets")}</p>
				</CardContent>
			</Card>
		);
	}

	const presets = data || [];

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle>{t("settings.holidays.presets.title", "Holiday Presets")}</CardTitle>
							<CardDescription>
								{t(
									"settings.holidays.presets.description",
									"Create reusable holiday sets for different locations that can be assigned to teams or employees",
								)}
							</CardDescription>
						</div>
						<Button onClick={onImportClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.holidays.presets.import", "Import Holidays")}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{presets.length === 0 ? (
						<div className="text-center py-12 text-muted-foreground">
							<IconCalendar className="h-16 w-16 mx-auto mb-4 opacity-50" />
							<h3 className="text-lg font-medium mb-2">
								{t("settings.holidays.presets.empty", "No presets yet")}
							</h3>
							<p className="text-sm mb-4">
								{t(
									"settings.holidays.presets.emptyDescription",
									"Import holidays from a country to create your first preset",
								)}
							</p>
							<Button onClick={onImportClick} variant="outline">
								<IconPlus className="mr-2 h-4 w-4" />
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
														className="w-3 h-3 rounded-full flex-shrink-0"
														style={{ backgroundColor: preset.color }}
													/>
												)}
												<h4 className="font-medium truncate">{preset.name}</h4>
											</div>
											{formatLocation(preset) && (
												<div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
													<IconMapPin className="h-3 w-3" />
													<span>{formatLocation(preset)}</span>
												</div>
											)}
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="h-8 w-8">
													<IconDotsVertical className="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onEditClick(preset)}>
													<IconEdit className="mr-2 h-4 w-4" />
													{t("common.edit", "Edit")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onClick={() => handleDeleteClick(preset)}
													className="text-destructive focus:text-destructive"
													disabled={preset.assignmentCount > 0}
												>
													<IconTrash className="mr-2 h-4 w-4" />
													{t("common.delete", "Delete")}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
										<div className="flex items-center gap-1">
											<IconCalendar className="h-4 w-4" />
											<span>
												{preset.holidayCount}{" "}
												{t("settings.holidays.presets.holidays", "holidays")}
											</span>
										</div>
										{preset.assignmentCount > 0 && (
											<Badge variant="secondary" className="gap-1">
												<IconUsers className="h-3 w-3" />
												{preset.assignmentCount}
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
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.presets.deleteTitle", "Delete Preset?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.presets.deleteDescription",
								"This will permanently delete the preset \"{name}\" and all its holidays.",
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
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteMutation.isPending || (selectedPreset?.assignmentCount ?? 0) > 0}
							className="bg-destructive hover:bg-destructive/90"
						>
							{deleteMutation.isPending
								? t("common.deleting", "Deleting...")
								: t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
