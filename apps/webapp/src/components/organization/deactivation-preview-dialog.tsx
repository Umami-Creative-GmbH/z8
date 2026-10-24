"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect, useId, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-description";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant, localeDefaultTimeFormat } from "@/lib/datetime/temporal-format";
import type {
	DeactivationPlan,
	ManagerLinksPlan,
} from "@/lib/employee-lifecycle/deactivation/types";
import { DeactivationConsequences } from "./deactivation-preview-sections";

/** Report employee id → the replacement manager's employee id. */
export type DeactivationReplacementPicks = Record<string, string>;

export type DeactivationPreviewDialogProps = {
	open: boolean;
	onOpenChange(open: boolean): void;
	/** The person being deactivated. */
	employeeName: string;
	/** The server's preview; null until it first loads. */
	plan: DeactivationPlan | null;
	/** The preview is loading or recalculating for new picks. */
	isLoading: boolean;
	/** The preview could not be loaded. */
	loadError: string | null;
	onRetry?(): void;
	/** The server refused the deactivation; its guidance. */
	submitError: string | null;
	isSubmitting: boolean;
	/** Picks changed; the parent recalculates the preview with them. */
	onReplacementsChange?(picks: DeactivationReplacementPicks): void;
	onConfirm(picks: DeactivationReplacementPicks): void;
};

type ReportNeedingReplacement = ManagerLinksPlan["reportsNeedingReplacement"][number];

/**
 * Lists what deactivating an employee changes (Organization ADR 0006) and asks
 * for a replacement manager for every report who would be left without one.
 * Presentational: the parent loads the preview and submits the picks. The
 * server recomputes on submit, so the preview is advisory.
 */
export function DeactivationPreviewDialog(props: DeactivationPreviewDialogProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";

	return (
		<Dialog
			open={props.open}
			onOpenChange={(open) => {
				if (!open && props.isSubmitting) return;
				props.onOpenChange(open);
			}}
		>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{t("settings.employees.lifecycle.deactivationPreview.title", "Deactivate {name}?", {
							name: props.employeeName,
						})}
					</DialogTitle>
					<DialogDescription>
						{props.plan
							? t(
									"settings.employees.lifecycle.deactivationPreview.descriptionAt",
									"{name} becomes a former employee when you confirm (previewed for {time}, {timeZone}). Access to this organization ends, their sessions are signed out, and their history is kept. Review what else changes before you confirm.",
									{
										name: props.employeeName,
										time: formatPlanInstant(props.plan, locale),
										timeZone: props.plan.timeZone,
									},
								)
							: t(
									"settings.employees.lifecycle.deactivationPreview.description",
									"{name} becomes a former employee now. Access to this organization ends, their sessions are signed out, and their history is kept. Review what else changes before you confirm.",
									{ name: props.employeeName },
								)}
					</DialogDescription>
				</DialogHeader>
				<DeactivationPreviewForm {...props} />
			</DialogContent>
		</Dialog>
	);
}

function DeactivationPreviewForm(props: DeactivationPreviewDialogProps) {
	const { t } = useTranslate();
	const { plan } = props;
	const errorRef = useRef<HTMLDivElement>(null);
	const replacementsHeadingId = useId();
	const planRef = useRef(plan);
	planRef.current = plan;

	const form = useForm({
		defaultValues: { replacements: initialPicks(plan) },
		onSubmit: ({ value }) => {
			props.onConfirm(cleanPicks(value.replacements));
		},
	});

	useEffect(() => {
		if (props.submitError) errorRef.current?.focus();
	}, [props.submitError]);

	const reports = plan?.managerLinks.reportsNeedingReplacement ?? [];
	const options = plan?.managerLinks.replacementOptions ?? [];

	function changePick(reportId: string, value: string) {
		props.onReplacementsChange?.(
			cleanPicks({ ...form.state.values.replacements, [reportId]: value }),
		);
	}

	return (
		<form
			aria-label={t(
				"settings.employees.lifecycle.deactivationPreview.formLabel",
				"Deactivation preview",
			)}
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			{props.submitError && (
				<Alert variant="destructive" ref={errorRef} tabIndex={-1} role="alert">
					<IconAlertTriangle aria-hidden="true" />
					<AlertDescription>{props.submitError}</AlertDescription>
				</Alert>
			)}

			{props.isLoading && (
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					{t(
						"settings.employees.lifecycle.deactivationPreview.loading",
						"Calculating what changes…",
					)}
				</p>
			)}

			{props.loadError && (
				<Alert variant="destructive" role="alert">
					<IconAlertTriangle aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
						<span>{props.loadError}</span>
						{props.onRetry && (
							<Button type="button" size="sm" variant="outline" onClick={props.onRetry}>
								{t("settings.employees.lifecycle.deactivationPreview.retry", "Try again")}
							</Button>
						)}
					</AlertDescription>
				</Alert>
			)}

			{reports.length > 0 && (
				<section aria-labelledby={replacementsHeadingId} className="space-y-3">
					<div className="space-y-1">
						<h3 id={replacementsHeadingId} className="text-sm font-semibold">
							{t(
								"settings.employees.lifecycle.deactivationPreview.replacementsTitle",
								"Reports who need a new manager",
							)}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.employees.lifecycle.deactivationPreview.replacementsDescription",
								"These employees would have no current manager left. Choose a current admin or manager for each.",
							)}
						</p>
					</div>
					{reports.map((report) => (
						<form.Field
							key={report.employeeId}
							name={`replacements.${report.employeeId}`}
							validators={{
								onSubmit: ({ value }) => replacementProblem(report.employeeId, value),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t(
											"settings.employees.lifecycle.deactivationPreview.replacementLabel",
											"New manager for {name}",
											{ name: report.name },
										)}
									</TFormLabel>
									<Select
										value={field.state.value ?? ""}
										onValueChange={(value) => {
											const next = typeof value === "string" ? value : "";
											field.handleChange(next);
											changePick(report.employeeId, next);
										}}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{options
												.filter((option) => option.employeeId !== report.employeeId)
												.map((option) => (
													<SelectItem key={option.employeeId} value={option.employeeId}>
														{option.name || option.employeeId}
													</SelectItem>
												))}
										</SelectContent>
									</Select>
									<TFormMessage field={field}>
										{ineligibleMessage(report, field.state.value)}
									</TFormMessage>
								</TFormItem>
							)}
						</form.Field>
					))}
				</section>
			)}

			{plan && <DeactivationConsequences plan={plan} />}

			<DialogFooter>
				<Button
					type="button"
					variant="outline"
					disabled={props.isSubmitting}
					onClick={() => props.onOpenChange(false)}
				>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={props.isSubmitting || props.isLoading || Boolean(props.loadError) || !plan}
				>
					{props.isSubmitting && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
					{props.isSubmitting
						? t("settings.employees.lifecycle.deactivating", "Deactivating...")
						: t("settings.employees.lifecycle.deactivate", "Deactivate")}
				</Button>
			</DialogFooter>
		</form>
	);

	function replacementProblem(reportId: string, value: string | undefined) {
		const report = planRef.current?.managerLinks.reportsNeedingReplacement.find(
			(candidate) => candidate.employeeId === reportId,
		);
		if (!report) return undefined;
		if (!value) {
			return t(
				"settings.employees.lifecycle.deactivationPreview.replacementRequired",
				"Choose a new manager for {name}.",
				{ name: report.name },
			);
		}
		return ineligibleMessage(report, value);
	}

	/** The server found the pick it previewed with no longer eligible. */
	function ineligibleMessage(report: ReportNeedingReplacement, value: string | undefined) {
		if (
			report.refusal !== "replacement_ineligible" ||
			!value ||
			value !== report.replacementEmployeeId
		) {
			return undefined;
		}
		const replacement = planRef.current?.managerLinks.replacementOptions.find(
			(option) => option.employeeId === value,
		);
		return replacement?.name
			? t(
					"settings.employees.lifecycle.deactivationPreview.replacementIneligible",
					"{replacement} can no longer manage {name}. Choose someone else.",
					{ replacement: replacement.name, name: report.name },
				)
			: t(
					"settings.employees.lifecycle.deactivationPreview.replacementIneligibleUnnamed",
					"The chosen manager can no longer manage {name}. Choose someone else.",
					{ name: report.name },
				);
	}
}

/**
 * Copy the parent shows in the dialog for its own failures: a preview that did
 * not load, and the server's machine-readable refusals of the submit (#1440).
 */
export function useDeactivationDialogMessages() {
	const { t } = useTranslate();
	return {
		loadError: t(
			"settings.employees.lifecycle.deactivationPreview.loadError",
			"The preview could not be loaded.",
		),
		/** Null for a refusal the dialog has no copy for. */
		refusal(code: string | null): string | null {
			switch (code) {
				case "replacement_required":
					return t(
						"settings.employees.lifecycle.deactivationPreview.replacementRefused",
						"A report still needs an eligible new manager. The preview was updated; check the choices and confirm again.",
					);
				case "request_conflict":
					return t(
						"settings.employees.lifecycle.deactivationPreview.requestConflict",
						"This deactivation was already submitted with different choices. Check the preview and confirm again.",
					);
				default:
					return null;
			}
		},
	};
}

/** The previewed instant in the organization's zone, as date and time. */
function formatPlanInstant(plan: DeactivationPlan, locale: string): string {
	try {
		return formatInstant(
			parseInstant(plan.at),
			{ locale, timezone: plan.timeZone, timeFormat: localeDefaultTimeFormat(locale) },
			"dateTimeMedium",
		);
	} catch {
		return plan.at;
	}
}

function initialPicks(plan: DeactivationPlan | null): DeactivationReplacementPicks {
	const picks: DeactivationReplacementPicks = {};
	for (const report of plan?.managerLinks.reportsNeedingReplacement ?? []) {
		if (report.replacementEmployeeId) picks[report.employeeId] = report.replacementEmployeeId;
	}
	return picks;
}

function cleanPicks(picks: Record<string, string | undefined>): DeactivationReplacementPicks {
	const result: DeactivationReplacementPicks = {};
	for (const [reportId, managerId] of Object.entries(picks)) {
		if (managerId) result[reportId] = managerId;
	}
	return result;
}
