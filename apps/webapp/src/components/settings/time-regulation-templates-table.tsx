"use client";

import {
	IconDots,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteTimeRegulation,
	getTimeRegulations,
	type TimeRegulationWithBreakRules,
} from "@/app/[locale]/(app)/settings/time-regulations/actions";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";

interface TimeRegulationTemplatesTableProps {
	organizationId: string;
	onCreateClick: () => void;
	onEditClick: (regulation: TimeRegulationWithBreakRules) => void;
}

function formatMinutesToHours(minutes: number | null): string {
	if (minutes === null) return "—";
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

export function TimeRegulationTemplatesTable({
	organizationId,
	onCreateClick,
	onEditClick,
}: TimeRegulationTemplatesTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [regulationToDelete, setRegulationToDelete] =
		useState<TimeRegulationWithBreakRules | null>(null);

	// Fetch regulations
	const {
		data: regulations,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.timeRegulations.list(organizationId),
		queryFn: async () => {
			const result = await getTimeRegulations(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch regulations");
			}
			return result.data;
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (regulationId: string) => deleteTimeRegulation(regulationId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.timeRegulations.deleted", "Regulation deleted"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.timeRegulations.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setRegulationToDelete(null);
			} else {
				toast.error(
					result.error || t("settings.timeRegulations.deleteFailed", "Failed to delete"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.timeRegulations.deleteFailed", "Failed to delete regulation"));
		},
	});

	const handleDeleteClick = (regulation: TimeRegulationWithBreakRules) => {
		setRegulationToDelete(regulation);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (regulationToDelete) {
			deleteMutation.mutate(regulationToDelete.id);
		}
	};

	if (isLoading) {
		return (
			<div className="space-y-2">
				<div className="flex justify-end">
					<Skeleton className="h-10 w-32" />
				</div>
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("settings.timeRegulations.loadError", "Failed to load regulations")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-end gap-2">
				<Button variant="ghost" size="icon" onClick={() => refetch()}>
					<IconRefresh className="h-4 w-4" />
					<span className="sr-only">{t("common.refresh", "Refresh")}</span>
				</Button>
				<Button onClick={onCreateClick}>
					<IconPlus className="mr-2 h-4 w-4" />
					{t("settings.timeRegulations.create", "Create Regulation")}
				</Button>
			</div>

			{!regulations || regulations.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
					<p className="text-muted-foreground">
						{t("settings.timeRegulations.noRegulations", "No time regulations")}
					</p>
					<p className="text-muted-foreground text-sm mt-1">
						{t(
							"settings.timeRegulations.noRegulationsDescription",
							"Create a regulation to define working time limits and break requirements.",
						)}
					</p>
					<Button className="mt-4" onClick={onCreateClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.timeRegulations.create", "Create Regulation")}
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.timeRegulations.name", "Name")}</TableHead>
								<TableHead className="text-center">
									{t("settings.timeRegulations.maxDaily", "Max Daily")}
								</TableHead>
								<TableHead className="text-center">
									{t("settings.timeRegulations.maxWeekly", "Max Weekly")}
								</TableHead>
								<TableHead className="text-center">
									{t("settings.timeRegulations.maxUninterrupted", "Max Uninterrupted")}
								</TableHead>
								<TableHead className="text-center">
									{t("settings.timeRegulations.breakRules", "Break Rules")}
								</TableHead>
								<TableHead className="w-[70px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{regulations.map((regulation) => (
								<TableRow key={regulation.id}>
									<TableCell className="font-medium">
										<div className="flex items-center gap-2">
											{regulation.name}
											{!regulation.isActive && (
												<Badge variant="secondary" className="text-xs">
													{t("common.inactive", "Inactive")}
												</Badge>
											)}
										</div>
										{regulation.description && (
											<p className="text-xs text-muted-foreground mt-0.5">
												{regulation.description}
											</p>
										)}
									</TableCell>
									<TableCell className="text-center tabular-nums">
										{formatMinutesToHours(regulation.maxDailyMinutes)}
									</TableCell>
									<TableCell className="text-center tabular-nums">
										{formatMinutesToHours(regulation.maxWeeklyMinutes)}
									</TableCell>
									<TableCell className="text-center tabular-nums">
										{formatMinutesToHours(regulation.maxUninterruptedMinutes)}
									</TableCell>
									<TableCell className="text-center">
										<Badge variant="outline">{regulation.breakRules?.length || 0}</Badge>
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="h-8 w-8">
													<IconDots className="h-4 w-4" />
													<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onEditClick(regulation)}>
													<IconPencil className="mr-2 h-4 w-4" />
													{t("common.edit", "Edit")}
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													className="text-destructive"
													onClick={() => handleDeleteClick(regulation)}
												>
													<IconTrash className="mr-2 h-4 w-4" />
													{t("common.delete", "Delete")}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.timeRegulations.deleteTitle", "Delete Regulation")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.timeRegulations.deleteDescription",
								'Are you sure you want to delete "{name}"? This will also remove all assignments for this regulation. This action cannot be undone.',
								{ name: regulationToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
