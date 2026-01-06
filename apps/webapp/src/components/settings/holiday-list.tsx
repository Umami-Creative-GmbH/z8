"use client";

import { IconAlertCircle, IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { deleteHoliday, getHolidays } from "@/app/[locale]/(app)/settings/holidays/actions";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface Holiday {
	id: string;
	name: string;
	description: string | null;
	startDate: Date;
	endDate: Date;
	recurrenceType: string;
	isActive: boolean;
	categoryId: string;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

interface HolidayListProps {
	organizationId: string;
	onAddClick: () => void;
	onEditClick: (holiday: Holiday) => void;
}

export function HolidayList({ organizationId, onAddClick, onEditClick }: HolidayListProps) {
	const { t } = useTranslate();
	const [holidays, setHolidays] = useState<Holiday[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [holidayToDelete, setHolidayToDelete] = useState<Holiday | null>(null);

	const fetchHolidays = async () => {
		setLoading(true);
		setError(null);

		const result = await getHolidays(organizationId);

		if (result.success && result.data) {
			setHolidays(result.data);
		} else {
			setError(result.error || "Failed to load holidays");
		}

		setLoading(false);
	};

	useEffect(() => {
		fetchHolidays();
	}, [fetchHolidays]);

	const handleDeleteClick = (holiday: Holiday) => {
		setHolidayToDelete(holiday);
		setDeleteConfirmOpen(true);
	};

	const handleDeleteConfirm = async () => {
		if (!holidayToDelete) return;

		setDeletingId(holidayToDelete.id);
		const result = await deleteHoliday(holidayToDelete.id);

		if (result.success) {
			toast.success(t("settings.holidays.deleted", "Holiday deleted successfully"));
			fetchHolidays(); // Refresh the list
		} else {
			toast.error(result.error || t("settings.holidays.deleteFailed", "Failed to delete holiday"));
		}

		setDeletingId(null);
		setDeleteConfirmOpen(false);
		setHolidayToDelete(null);
	};

	const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
		const start = new Date(startDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
		const end = new Date(endDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});

		if (start === end) {
			return start;
		}

		return `${start} - ${end}`;
	};

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<div className="rounded-md border p-8 flex items-center justify-center">
					<div className="flex items-center gap-2 text-muted-foreground">
						<IconLoader2 className="h-5 w-5 animate-spin" />
						<span>{t("settings.holidays.loading", "Loading holidays...")}</span>
					</div>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertCircle className="h-5 w-5" />
						<span>{error}</span>
					</div>
					<Button onClick={fetchHolidays} variant="outline" size="sm">
						{t("common.retry", "Retry")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.holidays.list.name", "Name")}</TableHead>
								<TableHead>{t("settings.holidays.list.category", "Category")}</TableHead>
								<TableHead>{t("settings.holidays.list.date", "Date")}</TableHead>
								<TableHead>{t("settings.holidays.list.recurrence", "Recurrence")}</TableHead>
								<TableHead className="text-right">
									{t("settings.holidays.list.actions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{holidays.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground h-24">
										{t(
											"settings.holidays.list.empty",
											"No holidays found. Add your first holiday to get started.",
										)}
									</TableCell>
								</TableRow>
							) : (
								holidays.map((holiday) => (
									<TableRow key={holiday.id}>
										<TableCell>
											<div>
												<div className="font-medium">{holiday.name}</div>
												{holiday.description && (
													<div className="text-sm text-muted-foreground">{holiday.description}</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												{holiday.category.color && (
													<div
														className="h-3 w-3 rounded-full border"
														style={{ backgroundColor: holiday.category.color }}
													/>
												)}
												<span className="text-sm">{holiday.category.name}</span>
											</div>
										</TableCell>
										<TableCell>{formatDateRange(holiday.startDate, holiday.endDate)}</TableCell>
										<TableCell>
											{holiday.recurrenceType === "none" ? (
												<span className="text-sm text-muted-foreground">
													{t("settings.holidays.recurrence.none", "One-time")}
												</span>
											) : (
												<Badge variant="secondary">
													{t("settings.holidays.recurrence.yearly", "Yearly")}
												</Badge>
											)}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => onEditClick(holiday)}
													disabled={deletingId === holiday.id}
												>
													<IconPencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDeleteClick(holiday)}
													disabled={deletingId === holiday.id}
												>
													{deletingId === holiday.id ? (
														<IconLoader2 className="h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="h-4 w-4" />
													)}
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.delete.title", "Delete Holiday")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.delete.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone.',
								{ name: holidayToDelete?.name || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
