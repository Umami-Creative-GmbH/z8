"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	createScheduledExportAction,
	updateScheduledExportAction,
} from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { StepSchedule } from "./steps/step-schedule";
import { StepReport } from "./steps/step-report";
import { StepFilters, type FilterOptions } from "./steps/step-filters";
import { StepDelivery } from "./steps/step-delivery";
import { StepReview } from "./steps/step-review";
import type {
	ScheduleType,
	ReportType,
	DeliveryMethod,
	DateRangeStrategy,
} from "@/lib/scheduled-exports/domain/types";
import type {
	ScheduledExportReportConfig,
	ScheduledExportFilters,
	ScheduledExportCustomOffset,
} from "@/db/schema/scheduled-export";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScheduledExportForm = any;

export interface ScheduledExportFormValues {
	// Step 1: Schedule
	name: string;
	description?: string;
	scheduleType: ScheduleType;
	cronExpression?: string;
	timezone: string;

	// Step 2: Report
	reportType: ReportType;
	reportConfig: ScheduledExportReportConfig;
	payrollConfigId?: string;

	// Step 3: Filters
	dateRangeStrategy: DateRangeStrategy;
	customOffset?: ScheduledExportCustomOffset;
	filters?: ScheduledExportFilters;

	// Step 4: Delivery
	deliveryMethod: DeliveryMethod;
	emailRecipients: string[];
	emailSubjectTemplate?: string;
	useOrgS3Config: boolean;
	customS3Prefix?: string;
}

interface ScheduledExportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editScheduleId?: string;
	initialValues?: Partial<ScheduledExportFormValues>;
	payrollConfigs: Array<{ id: string; formatId: string; formatName: string }>;
	filterOptions: FilterOptions | null;
	onSuccess?: () => void;
}

const DEFAULT_VALUES: ScheduledExportFormValues = {
	name: "",
	scheduleType: "monthly",
	timezone: "UTC",
	reportType: "payroll_export",
	reportConfig: {},
	dateRangeStrategy: "previous_month",
	deliveryMethod: "s3_and_email",
	emailRecipients: [],
	useOrgS3Config: true,
};

export function ScheduledExportDialog({
	open,
	onOpenChange,
	organizationId,
	editScheduleId,
	initialValues,
	payrollConfigs,
	filterOptions,
	onSuccess,
}: ScheduledExportDialogProps) {
	const { t } = useTranslate();
	const [currentStep, setCurrentStep] = useState(0);
	const [isPending, startTransition] = useTransition();

	const isEditing = Boolean(editScheduleId);

	const STEPS = [
		{
			id: 0,
			name: t("settings.scheduledExports.steps.schedule", "Schedule"),
			description: t("settings.scheduledExports.steps.scheduleDesc", "Configure when exports run"),
		},
		{
			id: 1,
			name: t("settings.scheduledExports.steps.report", "Report"),
			description: t("settings.scheduledExports.steps.reportDesc", "Choose what to export"),
		},
		{
			id: 2,
			name: t("settings.scheduledExports.steps.filters", "Filters"),
			description: t("settings.scheduledExports.steps.filtersDesc", "Set date range and filters"),
		},
		{
			id: 3,
			name: t("settings.scheduledExports.steps.delivery", "Delivery"),
			description: t("settings.scheduledExports.steps.deliveryDesc", "Configure notifications"),
		},
		{
			id: 4,
			name: t("settings.scheduledExports.steps.review", "Review"),
			description: t("settings.scheduledExports.steps.reviewDesc", "Review and create"),
		},
	];

	const form = useForm({
		defaultValues: { ...DEFAULT_VALUES, ...initialValues } as ScheduledExportFormValues,
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				const result = await (isEditing
					? updateScheduledExportAction({
							id: editScheduleId!,
							organizationId,
							...value,
						})
					: createScheduledExportAction({
							organizationId,
							...value,
						})
				).then((response) => response, () => null);

				if (!result) {
					toast.error(
						t("settings.scheduledExports.toast.unexpectedError", "An unexpected error occurred"),
					);
					return;
				}

				if (result.success) {
					toast.success(
						isEditing
							? t("settings.scheduledExports.toast.updateSuccess", "Schedule updated")
							: t("settings.scheduledExports.toast.createSuccess", "Schedule created"),
						{
							description: isEditing
								? t("settings.scheduledExports.toast.updateSuccessDesc", "Your scheduled export has been updated.")
								: t("settings.scheduledExports.toast.createSuccessDesc", "Your scheduled export has been created and will run according to the schedule."),
						},
					);
					onOpenChange(false);
					onSuccess?.();
				} else {
					toast.error(
						isEditing
							? t("settings.scheduledExports.toast.updateError", "Failed to update schedule")
							: t("settings.scheduledExports.toast.createError", "Failed to create schedule"),
						{
							description: result.error,
						},
					);
				}
			});
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			form.reset({ ...DEFAULT_VALUES, ...initialValues });
			setCurrentStep(0);
		}
		onOpenChange(nextOpen);
	};

	// Get current form values for validation
	const formValues = useStore(form.store, (state) => state.values);

	// Step validation
	const canProceed = useCallback(() => {
		switch (currentStep) {
			case 0: // Schedule
				if (!formValues.name.trim()) return false;
				if (formValues.scheduleType === "cron" && !formValues.cronExpression?.trim()) return false;
				return true;
			case 1: // Report
				if (formValues.reportType === "payroll_export" && !formValues.payrollConfigId) return false;
				if (formValues.reportType === "data_export") {
					const categories = formValues.reportConfig?.categories as string[] | undefined;
					if (!categories || categories.length === 0) return false;
				}
				return true;
			case 2: // Filters
				return Boolean(formValues.dateRangeStrategy);
			case 3: // Delivery
				if (
					formValues.deliveryMethod === "s3_and_email" ||
					formValues.deliveryMethod === "email_only"
				) {
					return formValues.emailRecipients.length > 0;
				}
				return true;
			case 4: // Review
				return true;
			default:
				return false;
		}
	}, [currentStep, formValues]);

	const handleNext = () => {
		if (currentStep < STEPS.length - 1 && canProceed()) {
			setCurrentStep((prev) => prev + 1);
		}
	};

	const handleBack = () => {
		if (currentStep > 0) {
			setCurrentStep((prev) => prev - 1);
		}
	};

	const handleSubmit = () => {
		form.handleSubmit();
	};

	const progress = ((currentStep + 1) / STEPS.length) * 100;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="max-w-2xl max-h-[90vh] overflow-y-auto"
				aria-describedby="wizard-description"
			>
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.scheduledExports.dialog.editTitle", "Edit Scheduled Export")
							: t("settings.scheduledExports.dialog.createTitle", "New Scheduled Export")}
					</DialogTitle>
					<DialogDescription id="wizard-description">
						{STEPS[currentStep].description}
					</DialogDescription>
				</DialogHeader>

				{/* Progress indicator */}
				<div className="space-y-2" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
					<Progress value={progress} className="h-2" aria-label={t("settings.scheduledExports.dialog.progress", "Wizard progress")} />
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>
							{t("settings.scheduledExports.dialog.stepOf", "Step {current} of {total}", {
								current: currentStep + 1,
								total: STEPS.length,
							})}
						</span>
						<span>{STEPS[currentStep].name}</span>
					</div>
				</div>

				{/* Step content */}
				<div className="py-4 min-h-[300px]">
					{currentStep === 0 && <StepSchedule form={form} />}
					{currentStep === 1 && (
						<StepReport form={form} payrollConfigs={payrollConfigs} />
					)}
					{currentStep === 2 && (
						<StepFilters form={form} filterOptions={filterOptions} />
					)}
					{currentStep === 3 && <StepDelivery form={form} />}
					{currentStep === 4 && (
						<StepReview
							form={form}
							filterOptions={filterOptions}
							payrollConfigs={payrollConfigs}
						/>
					)}
				</div>

				<DialogFooter className="flex justify-between sm:justify-between">
					<Button
						type="button"
						variant="outline"
						onClick={handleBack}
						disabled={currentStep === 0 || isPending}
						aria-label={t("settings.scheduledExports.dialog.backStep", "Go to previous step")}
					>
						<ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
						{t("settings.scheduledExports.dialog.back", "Back")}
					</Button>

					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							{t("settings.scheduledExports.dialog.cancel", "Cancel")}
						</Button>

						{currentStep < STEPS.length - 1 ? (
							<Button
								type="button"
								onClick={handleNext}
								disabled={!canProceed() || isPending}
								aria-label={t("settings.scheduledExports.dialog.nextStep", "Go to next step")}
							>
								{t("settings.scheduledExports.dialog.next", "Next")}
								<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
							</Button>
						) : (
							<Button
								type="button"
								onClick={handleSubmit}
								disabled={isPending}
							>
								{isPending ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
										{isEditing
											? t("settings.scheduledExports.dialog.updating", "Updating...")
											: t("settings.scheduledExports.dialog.creating", "Creating...")}
									</>
								) : isEditing ? (
									t("settings.scheduledExports.dialog.updateSchedule", "Update Schedule")
								) : (
									t("settings.scheduledExports.dialog.createSchedule", "Create Schedule")
								)}
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
