"use client";

import { IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { cancelAbsenceRequest } from "@/app/[locale]/(app)/absences/actions";
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
import { calculateBusinessDays, formatDateRange } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { CategoryBadge } from "./category-badge";

interface AbsenceEntriesTableProps {
	absences: AbsenceWithCategory[];
	onUpdate?: () => void;
}

export function AbsenceEntriesTable({ absences, onUpdate }: AbsenceEntriesTableProps) {
	const [cancelingId, setCancelingId] = useState<string | null>(null);

	const handleCancel = async (absenceId: string) => {
		setCancelingId(absenceId);

		const result = await cancelAbsenceRequest(absenceId);

		setCancelingId(null);

		if (result.success) {
			toast.success("Absence request cancelled");
			onUpdate?.();
		} else {
			toast.error(result.error || "Failed to cancel absence request");
		}
	};

	if (absences.length === 0) {
		return (
			<div className="rounded-md border">
				<div className="p-8 text-center text-muted-foreground">No absence requests found.</div>
			</div>
		);
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Date Range</TableHead>
						<TableHead>Type</TableHead>
						<TableHead className="text-right">Days</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Notes</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{absences.map((absence) => {
						const days = calculateBusinessDays(absence.startDate, absence.endDate, []);

						return (
							<TableRow key={absence.id}>
								<TableCell className="font-medium">
									{formatDateRange(absence.startDate, absence.endDate)}
								</TableCell>
								<TableCell>
									<CategoryBadge
										name={absence.category.name}
										type={absence.category.type}
										color={absence.category.color}
									/>
								</TableCell>
								<TableCell className="text-right tabular-nums">{days}</TableCell>
								<TableCell>
									<Badge
										variant={
											absence.status === "approved"
												? "default"
												: absence.status === "pending"
													? "secondary"
													: "destructive"
										}
									>
										{absence.status}
									</Badge>
								</TableCell>
								<TableCell className="max-w-[200px] truncate text-muted-foreground">
									{absence.notes || "—"}
								</TableCell>
								<TableCell className="text-right">
									{absence.status === "pending" && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleCancel(absence.id)}
											disabled={cancelingId === absence.id}
										>
											<IconX className="size-4" />
										</Button>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}
