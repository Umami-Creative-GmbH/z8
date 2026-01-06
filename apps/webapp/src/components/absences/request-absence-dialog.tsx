"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import { CategoryBadge } from "./category-badge";

interface RequestAbsenceDialogProps {
	categories: Array<{
		id: string;
		name: string;
		type: string;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
	}>;
	remainingDays: number;
	trigger?: React.ReactNode;
	onSuccess?: () => void;
}

export function RequestAbsenceDialog({
	categories,
	remainingDays,
	trigger,
	onSuccess,
}: RequestAbsenceDialogProps) {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [formData, setFormData] = useState({
		categoryId: "",
		startDate: "",
		endDate: "",
		notes: "",
	});

	const selectedCategory = categories.find((c) => c.id === formData.categoryId);

	// Calculate requested days
	const requestedDays =
		formData.startDate && formData.endDate
			? calculateBusinessDays(new Date(formData.startDate), new Date(formData.endDate), [])
			: 0;

	const balanceAfterRequest = selectedCategory?.countsAgainstVacation
		? remainingDays - requestedDays
		: remainingDays;

	const insufficientBalance = selectedCategory?.countsAgainstVacation && balanceAfterRequest < 0;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!formData.categoryId || !formData.startDate || !formData.endDate) {
			toast.error("Please fill in all required fields");
			return;
		}

		if (insufficientBalance) {
			toast.error("Insufficient vacation balance");
			return;
		}

		setLoading(true);

		const result = await requestAbsence({
			categoryId: formData.categoryId,
			startDate: new Date(formData.startDate),
			endDate: new Date(formData.endDate),
			notes: formData.notes || undefined,
		});

		setLoading(false);

		if (result.success) {
			toast.success("Absence request submitted successfully");
			setOpen(false);
			setFormData({ categoryId: "", startDate: "", endDate: "", notes: "" });
			onSuccess?.();
		} else {
			toast.error(result.error || "Failed to submit absence request");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger || <Button>Request Absence</Button>}</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Request Absence</DialogTitle>
						<DialogDescription>
							Submit a request for time off. Your manager will be notified for approval.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						{/* Category Select */}
						<div className="grid gap-2">
							<Label htmlFor="category">Absence Type *</Label>
							<Select
								value={formData.categoryId}
								onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
							>
								<SelectTrigger id="category">
									<SelectValue placeholder="Select absence type" />
								</SelectTrigger>
								<SelectContent>
									{categories.map((category) => (
										<SelectItem key={category.id} value={category.id}>
											<div className="flex items-center gap-2">
												<CategoryBadge
													name={category.name}
													type={category.type}
													color={category.color}
												/>
												{!category.requiresApproval && (
													<span className="text-xs text-muted-foreground">(Auto-approved)</span>
												)}
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Date Range */}
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="startDate">Start Date *</Label>
								<Input
									id="startDate"
									type="date"
									value={formData.startDate}
									onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="endDate">End Date *</Label>
								<Input
									id="endDate"
									type="date"
									value={formData.endDate}
									min={formData.startDate}
									onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
									required
								/>
							</div>
						</div>

						{/* Business Days Calculation */}
						{requestedDays > 0 && (
							<div className="rounded-md border p-3 text-sm">
								<div className="flex justify-between items-center">
									<span className="text-muted-foreground">Business days:</span>
									<span className="font-semibold tabular-nums">{requestedDays}</span>
								</div>
								{selectedCategory?.countsAgainstVacation && (
									<>
										<div className="flex justify-between items-center mt-1">
											<span className="text-muted-foreground">Days remaining:</span>
											<span className="font-semibold tabular-nums">{remainingDays}</span>
										</div>
										<div className="flex justify-between items-center mt-1 pt-2 border-t">
											<span className="font-medium">Balance after request:</span>
											<span
												className={`font-bold tabular-nums ${insufficientBalance ? "text-destructive" : ""}`}
											>
												{balanceAfterRequest}
											</span>
										</div>
										{insufficientBalance && (
											<div className="mt-2 text-xs text-destructive">
												Insufficient vacation balance for this request
											</div>
										)}
									</>
								)}
							</div>
						)}

						{/* Notes */}
						<div className="grid gap-2">
							<Label htmlFor="notes">Notes (Optional)</Label>
							<Textarea
								id="notes"
								placeholder="Add any additional information..."
								value={formData.notes}
								onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
								rows={3}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={loading}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={loading || insufficientBalance}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							Submit Request
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
