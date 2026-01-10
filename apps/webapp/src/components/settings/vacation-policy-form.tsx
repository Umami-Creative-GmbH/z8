"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
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
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";

const formSchema = z.object({
	name: z.string().min(1, "Policy name is required").max(100, "Name too long"),
	defaultAnnualDays: z
		.string()
		.refine((val) => !Number.isNaN(parseFloat(val)) && parseFloat(val) > 0, {
			message: "Must be a positive number",
		}),
	accrualType: z.enum(["annual", "monthly", "biweekly"]),
	accrualStartMonth: z.number().min(1).max(12).optional(),
	allowCarryover: z.boolean(),
	maxCarryoverDays: z.string().optional(),
	carryoverExpiryMonths: z.number().min(1).max(12).optional(),
});

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

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: existingPolicy
			? {
					name: existingPolicy.name,
					defaultAnnualDays: existingPolicy.defaultAnnualDays,
					accrualType: existingPolicy.accrualType as "annual" | "monthly" | "biweekly",
					accrualStartMonth: existingPolicy.accrualStartMonth || 1,
					allowCarryover: existingPolicy.allowCarryover,
					maxCarryoverDays: existingPolicy.maxCarryoverDays || "",
					carryoverExpiryMonths: existingPolicy.carryoverExpiryMonths || undefined,
				}
			: {
					name: "",
					defaultAnnualDays: "20",
					accrualType: "annual",
					accrualStartMonth: 1,
					allowCarryover: false,
					maxCarryoverDays: "",
					carryoverExpiryMonths: undefined,
				},
	});

	const allowCarryover = form.watch("allowCarryover");

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setLoading(true);

		try {
			const result = existingPolicy
				? await updateVacationPolicy(existingPolicy.id, {
						...values,
						maxCarryoverDays: values.maxCarryoverDays || undefined,
					})
				: await createVacationPolicy({
						organizationId,
						year,
						...values,
						maxCarryoverDays: values.maxCarryoverDays || undefined,
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
	}

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

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Policy Name</FormLabel>
									<FormControl>
										<Input placeholder="e.g., Germany Standard, Senior Engineers" {...field} />
									</FormControl>
									<FormDescription>
										A descriptive name to identify this vacation policy
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="defaultAnnualDays"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Default Annual Days</FormLabel>
									<FormControl>
										<Input type="number" step="0.5" placeholder="20" {...field} />
									</FormControl>
									<FormDescription>
										Default number of vacation days per year for all employees
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="accrualType"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Accrual Type</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select accrual type" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="annual">Annual (all at once)</SelectItem>
											<SelectItem value="monthly">Monthly accrual</SelectItem>
											<SelectItem value="biweekly">Biweekly accrual</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>
										How vacation days are granted throughout the year
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="accrualStartMonth"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Accrual Start Month</FormLabel>
									<Select
										onValueChange={(val) => field.onChange(parseInt(val, 10))}
										defaultValue={field.value?.toString() || "1"}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select month" />
											</SelectTrigger>
										</FormControl>
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
									<FormDescription>
										Month when vacation accrual begins (typically January or hire date)
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="allowCarryover"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<FormLabel className="text-base">Allow Carryover</FormLabel>
										<FormDescription>
											Allow employees to carry unused days to next year
										</FormDescription>
									</div>
									<FormControl>
										<Switch checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
								</FormItem>
							)}
						/>

						{allowCarryover && (
							<>
								<FormField
									control={form.control}
									name="maxCarryoverDays"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Max Carryover Days (optional)</FormLabel>
											<FormControl>
												<Input
													type="number"
													step="0.5"
													placeholder="Leave empty for unlimited"
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Maximum days that can be carried over (leave empty for unlimited)
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="carryoverExpiryMonths"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Carryover Expiry (months, optional)</FormLabel>
											<FormControl>
												<Input
													type="number"
													min="1"
													max="12"
													placeholder="e.g., 3"
													value={field.value || ""}
													onChange={(e) =>
														field.onChange(
															e.target.value ? parseInt(e.target.value, 10) : undefined,
														)
													}
												/>
											</FormControl>
											<FormDescription>
												Number of months before carried-over days expire (optional)
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
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
				</Form>
			</DialogContent>
		</Dialog>
	);
}
