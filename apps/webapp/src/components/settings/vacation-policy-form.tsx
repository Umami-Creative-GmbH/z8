"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	createVacationPolicy,
	updateVacationPolicy,
} from "@/app/[locale]/(app)/settings/vacation/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";

interface VacationPolicyFormProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	year: number;
	existingPolicy?: {
		id: string;
		name: string;
		defaultAnnualDays: string;
		accrualType: string;
		accrualStartMonth: number | null;
		allowCarryover: boolean;
		maxCarryoverDays: string | null;
		carryoverExpiryMonths: number | null;
	};
}

export function VacationPolicyForm({
	open,
	onOpenChange,
	organizationId,
	year,
	existingPolicy,
}: VacationPolicyFormProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues: existingPolicy
			? {
					name: existingPolicy.name,
					defaultAnnualDays: existingPolicy.defaultAnnualDays,
					accrualType: existingPolicy.accrualType as "annual" | "monthly" | "biweekly",
					accrualStartMonth: existingPolicy.accrualStartMonth || 1,
					allowCarryover: existingPolicy.allowCarryover,
					maxCarryoverDays: existingPolicy.maxCarryoverDays || "",
					carryoverExpiryMonths: existingPolicy.carryoverExpiryMonths || (undefined as number | undefined),
				}
			: {
					name: "",
					defaultAnnualDays: "20",
					accrualType: "annual" as "annual" | "monthly" | "biweekly",
					accrualStartMonth: 1,
					allowCarryover: false,
					maxCarryoverDays: "",
					carryoverExpiryMonths: undefined as number | undefined,
				},
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			try {
				const result = existingPolicy
					? await updateVacationPolicy(existingPolicy.id, {
							...value,
							maxCarryoverDays: value.maxCarryoverDays || undefined,
						})
					: await createVacationPolicy({
							organizationId,
							year,
							...value,
							maxCarryoverDays: value.maxCarryoverDays || undefined,
						});

				if (result.success) {
					toast.success(
						existingPolicy ? "Policy updated successfully" : "Policy created successfully",
					);
					onOpenChange(false);
					router.refresh();
				} else {
					toast.error(result.error || "Failed to save policy");
				}
			} catch (_error) {
				toast.error("An unexpected error occurred");
			} finally {
				setLoading(false);
			}
		},
	});

	// Subscribe to allowCarryover for conditional fields
	const allowCarryover = useStore(form.store, (state) => state.values.allowCarryover);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle>
						{existingPolicy
							? `Edit "${existingPolicy.name}"`
							: `Create Vacation Policy for ${year}`}
					</DialogTitle>
					<DialogDescription>
						Configure vacation allowance settings. Each policy can be assigned to the organization,
						specific teams, or individual employees.
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
					<form.Field
						name="name"
						validators={{
							onChange: z.string().min(1, "Policy name is required").max(100, "Name too long"),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>Policy Name</Label>
								<Input
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="e.g., Germany Standard, Senior Engineers"
								/>
								<p className="text-sm text-muted-foreground">
									A descriptive name to identify this vacation policy
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name="defaultAnnualDays"
						validators={{
							onChange: z.string().refine(
								(val) => val && !Number.isNaN(parseFloat(val)) && parseFloat(val) > 0,
								"Must be a positive number"
							),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>Default Annual Days</Label>
								<Input
									type="number"
									step="0.5"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder="20"
								/>
								<p className="text-sm text-muted-foreground">
									Default number of vacation days per year for all employees
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field name="accrualType">
						{(field) => (
							<div className="space-y-2">
								<Label>Accrual Type</Label>
								<Select value={field.state.value} onValueChange={field.handleChange}>
									<SelectTrigger>
										<SelectValue placeholder="Select accrual type" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="annual">Annual (all at once)</SelectItem>
										<SelectItem value="monthly">Monthly accrual</SelectItem>
										<SelectItem value="biweekly">Biweekly accrual</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									How vacation days are granted throughout the year
								</p>
							</div>
						)}
					</form.Field>

					<form.Field name="accrualStartMonth">
						{(field) => (
							<div className="space-y-2">
								<Label>Accrual Start Month</Label>
								<Select
									value={field.state.value?.toString() || "1"}
									onValueChange={(val) => field.handleChange(parseInt(val, 10))}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select month" />
									</SelectTrigger>
									<SelectContent>
										{Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
											<SelectItem key={month} value={month.toString()}>
												{new Date(2000, month - 1).toLocaleString("default", {
													month: "long",
												})}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									Month when vacation accrual begins (typically January or hire date)
								</p>
							</div>
						)}
					</form.Field>

					<form.Field name="allowCarryover">
						{(field) => (
							<div className="flex flex-row items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label className="text-base">Allow Carryover</Label>
									<p className="text-sm text-muted-foreground">
										Allow employees to carry unused days to next year
									</p>
								</div>
								<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
							</div>
						)}
					</form.Field>

					{allowCarryover && (
						<>
							<form.Field name="maxCarryoverDays">
								{(field) => (
									<div className="space-y-2">
										<Label>Max Carryover Days (optional)</Label>
										<Input
											type="number"
											step="0.5"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="Leave empty for unlimited"
										/>
										<p className="text-sm text-muted-foreground">
											Maximum days that can be carried over (leave empty for unlimited)
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="carryoverExpiryMonths">
								{(field) => (
									<div className="space-y-2">
										<Label>Carryover Expiry (months, optional)</Label>
										<Input
											type="number"
											min="1"
											max="12"
											value={field.state.value || ""}
											onChange={(e) =>
												field.handleChange(
													e.target.value ? parseInt(e.target.value, 10) : undefined,
												)
											}
											onBlur={field.handleBlur}
											placeholder="e.g., 3"
										/>
										<p className="text-sm text-muted-foreground">
											Number of months before carried-over days expire (optional)
										</p>
									</div>
								)}
							</form.Field>
						</>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{existingPolicy ? "Update Policy" : "Create Policy"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
