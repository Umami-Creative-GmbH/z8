"use client";

import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createSurchargeModel,
	updateSurchargeModel,
} from "@/app/[locale]/(app)/settings/surcharges/actions";
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
import { Switch } from "@/components/ui/switch";
import {
	fieldHasError,
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";
import { surchargeModelFormSchema } from "@/lib/surcharges/validation";
import { SurchargeRuleEditor, type SurchargeRuleFormValues } from "./surcharge-rule-editor";

interface SurchargeModelDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingModel: SurchargeModelWithRules | null;
	onSuccess: () => void;
}

const defaultRule: SurchargeRuleFormValues = {
	ruleType: "day_of_week",
	name: "",
	description: null,
	percentage: 0.5,
	dayOfWeek: "sunday",
	priority: 0,
	validFrom: null,
	validUntil: null,
	isActive: true,
};

export function SurchargeModelDialog({
	open,
	onOpenChange,
	organizationId,
	editingModel,
	onSuccess,
}: SurchargeModelDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingModel;

	const form = useForm({
		defaultValues: {
			name: "",
			description: "" as string | null,
			rules: [] as SurchargeRuleFormValues[],
			isActive: true,
		},
		validators: {
			onChange: ({ value }) => {
				const result = surchargeModelFormSchema.safeParse(value);
				if (!result.success) {
					return result.error.issues[0]?.message || t("common.validationError", "Validation error");
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			if (isEditing) {
				updateMutation.mutate({
					name: value.name,
					description: value.description,
					isActive: value.isActive,
				});
			} else {
				createMutation.mutate(value);
			}
		},
	});

	// Reset form when dialog opens/closes or when editing model changes
	useEffect(() => {
		if (open) {
			if (editingModel) {
				form.reset({
					name: editingModel.name,
					description: editingModel.description || "",
					rules: editingModel.rules.map((rule) => ({
						ruleType: rule.ruleType,
						name: rule.name,
						description: rule.description,
						percentage: parseFloat(rule.percentage),
						dayOfWeek: rule.dayOfWeek as SurchargeRuleFormValues["dayOfWeek"],
						windowStartTime: rule.windowStartTime || undefined,
						windowEndTime: rule.windowEndTime || undefined,
						specificDate: rule.specificDate || undefined,
						dateRangeStart: rule.dateRangeStart || undefined,
						dateRangeEnd: rule.dateRangeEnd || undefined,
						priority: rule.priority,
						validFrom: rule.validFrom,
						validUntil: rule.validUntil,
						isActive: rule.isActive,
					})),
					isActive: editingModel.isActive,
				});
			} else {
				form.reset({
					name: "",
					description: "",
					rules: [],
					isActive: true,
				});
			}
		}
	}, [open, editingModel, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (data: {
			name: string;
			description: string | null;
			rules: SurchargeRuleFormValues[];
			isActive: boolean;
		}) =>
			// Cast to SurchargeModelFormData to satisfy the discriminated union type
			createSurchargeModel(organizationId, data as Parameters<typeof createSurchargeModel>[1]),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.modelCreated", "Surcharge model created"));
				onSuccess();
			} else {
				toast.error(
					result.error || t("settings.surcharges.createFailed", "Failed to create model"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.surcharges.createFailed", "Failed to create surcharge model"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: (data: { name?: string; description?: string | null; isActive?: boolean }) =>
			updateSurchargeModel(editingModel!.id, data),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.surcharges.modelUpdated", "Surcharge model updated"));
				onSuccess();
			} else {
				toast.error(
					result.error || t("settings.surcharges.updateFailed", "Failed to update model"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.surcharges.updateFailed", "Failed to update surcharge model"));
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.surcharges.editModel", "Edit Surcharge Model")
							: t("settings.surcharges.createModel", "Create Surcharge Model")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.surcharges.modelDescription",
							"Define surcharge rules for overtime, night work, weekends, and holidays.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-6"
				>
					{/* Basic Info */}
					<div className="grid gap-4">
						<form.Field name="name">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.surcharges.modelName", "Model Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.surcharges.modelNamePlaceholder",
												"e.g., Weekend Premium",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("settings.surcharges.descriptionLabel", "Description")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											value={field.state.value || ""}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.surcharges.descriptionPlaceholder",
												"Optional description of this surcharge model",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</div>

					{/* Surcharge Rules */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-medium">
								{t("settings.surcharges.rules", "Surcharge Rules")}
							</h3>
							<form.Field name="rules">
								{(field) => (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => {
											field.pushValue({ ...defaultRule, priority: field.state.value.length });
										}}
									>
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.surcharges.addRule", "Add Rule")}
									</Button>
								)}
							</form.Field>
						</div>

						<form.Field name="rules" mode="array">
							{(field) => (
								<div className="space-y-4">
									{field.state.value.length === 0 ? (
										<div className="flex flex-col items-center justify-center py-8 text-center border rounded-lg border-dashed">
											<p className="text-sm text-muted-foreground">
												{t("settings.surcharges.noRules", "No surcharge rules defined")}
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												{t(
													"settings.surcharges.noRulesDescription",
													"Add rules to define when surcharges apply",
												)}
											</p>
										</div>
									) : (
										field.state.value.map((_, ruleIndex) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: Dynamic form array - no stable IDs for new rules
											<form.Field key={ruleIndex} name={`rules[${ruleIndex}]`}>
												{() => (
													<SurchargeRuleEditor
														ruleIndex={ruleIndex}
														form={form}
														onRemove={() => field.removeValue(ruleIndex)}
													/>
												)}
											</form.Field>
										))
									)}
								</div>
							)}
						</form.Field>
					</div>

					{/* Active Status */}
					<form.Field name="isActive">
						{(field) => (
							<div className="flex items-center justify-between rounded-lg border p-4">
								<div className="space-y-0.5">
									<Label>{t("settings.surcharges.active", "Active")}</Label>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.surcharges.activeDescription",
											"Inactive models won't be used for calculations",
										)}
									</p>
								</div>
								<Switch checked={field.state.value} onCheckedChange={field.handleChange} />
							</div>
						)}
					</form.Field>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
							{([isSubmitting, canSubmit]) => (
								<Button type="submit" disabled={isPending || isSubmitting || !canSubmit}>
									{(isPending || isSubmitting) && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
