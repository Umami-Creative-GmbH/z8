/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useTranslate } from "@tolgee/react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmailTagInput } from "../email-tag-input";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import type { DeliveryMethod } from "@/lib/scheduled-exports/domain/types";

interface StepDeliveryProps {
	form: ScheduledExportForm;
}

export function StepDelivery({ form }: StepDeliveryProps) {
	const { t } = useTranslate();

	const DELIVERY_METHODS: { value: DeliveryMethod; label: string; description: string }[] = [
		{
			value: "s3_and_email",
			label: t("settings.scheduledExports.deliveryMethod.s3AndEmail", "S3 + Email"),
			description: t("settings.scheduledExports.deliveryMethod.s3AndEmailDesc", "Upload to S3 and send email notifications with download links"),
		},
		{
			value: "email_only",
			label: t("settings.scheduledExports.deliveryMethod.emailOnly", "Email Only"),
			description: t("settings.scheduledExports.deliveryMethod.emailOnlyDesc", "Send export file directly via email attachment"),
		},
		{
			value: "s3_only",
			label: t("settings.scheduledExports.deliveryMethod.s3Only", "S3 Only"),
			description: t("settings.scheduledExports.deliveryMethod.s3OnlyDesc", "Upload to S3 storage without email notifications"),
		},
	];

	return (
		<div className="space-y-6">
			<form.Field name="deliveryMethod">
				{(field: any) => (
					<div className="space-y-2">
						<Label id="delivery-method-label">
							{t("settings.scheduledExports.delivery.deliveryMethod", "Delivery Method")} *
						</Label>
						<Select
							value={field.state.value}
							onValueChange={(v) => field.handleChange(v as DeliveryMethod)}
							aria-labelledby="delivery-method-label"
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DELIVERY_METHODS.map((method) => (
									<SelectItem key={method.value} value={method.value}>
										<div>
											<div>{method.label}</div>
											<div className="text-xs text-muted-foreground">
												{method.description}
											</div>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</form.Field>

			<form.Subscribe selector={(state: any) => state.values.deliveryMethod}>
				{(deliveryMethod: any) => (
					<>
						{(deliveryMethod === "s3_and_email" || deliveryMethod === "email_only") && (
							<div className="space-y-4">
								<form.Field name="emailRecipients">
									{(field: any) => (
										<div className="space-y-2">
											<Label>
												{t("settings.scheduledExports.delivery.emailRecipients", "Email Recipients")} *
											</Label>
											<EmailTagInput
												value={field.state.value}
												onChange={field.handleChange}
												placeholder={t("settings.scheduledExports.delivery.emailPlaceholder", "Enter email addresses")}
												ariaLabel={t("settings.scheduledExports.delivery.emailRecipientsLabel", "Email recipients for export notifications")}
											/>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive" role="alert">
													{field.state.meta.errors[0]}
												</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field name="emailSubjectTemplate">
									{(field: any) => (
										<div className="space-y-2">
											<Label htmlFor="emailSubjectTemplate">
												{t("settings.scheduledExports.delivery.emailSubject", "Email Subject Template")}
											</Label>
											<Input
												id="emailSubjectTemplate"
												placeholder={t("settings.scheduledExports.delivery.emailSubjectPlaceholder", "Scheduled Export: {scheduleName} ({dateRange})")}
												value={field.state.value || ""}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-describedby="email-subject-hint"
											/>
											<p id="email-subject-hint" className="text-xs text-muted-foreground">
												{t("settings.scheduledExports.delivery.emailSubjectHint", "Available variables: {scheduleName}, {dateRange}")}
											</p>
										</div>
									)}
								</form.Field>
							</div>
						)}

						{(deliveryMethod === "s3_and_email" || deliveryMethod === "s3_only") && (
							<div className="space-y-4 rounded-lg border p-4" role="region" aria-label={t("settings.scheduledExports.delivery.s3ConfigRegion", "S3 storage configuration")}>
								<div className="font-medium">{t("settings.scheduledExports.delivery.s3Config", "S3 Storage Configuration")}</div>

								<form.Field name="useOrgS3Config">
									{(field: any) => (
										<div className="flex items-center justify-between">
											<div className="space-y-0.5">
												<Label htmlFor="useOrgS3Config" className="text-base">
													{t("settings.scheduledExports.delivery.useOrgS3", "Use Organization S3 Config")}
												</Label>
												<p className="text-sm text-muted-foreground">
													{t("settings.scheduledExports.delivery.useOrgS3Desc", "Use the default S3 bucket configured for your organization")}
												</p>
											</div>
											<Switch
												id="useOrgS3Config"
												checked={field.state.value}
												onCheckedChange={field.handleChange}
												aria-describedby="use-org-s3-desc"
											/>
										</div>
									)}
								</form.Field>

								<form.Field name="customS3Prefix">
									{(field: any) => (
										<div className="space-y-2">
											<Label htmlFor="customS3Prefix">
												{t("settings.scheduledExports.delivery.s3Prefix", "Custom S3 Prefix")}
											</Label>
											<Input
												id="customS3Prefix"
												placeholder={t("settings.scheduledExports.delivery.s3PrefixPlaceholder", "exports/payroll/")}
												value={field.state.value || ""}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-describedby="s3-prefix-hint"
											/>
											<p id="s3-prefix-hint" className="text-xs text-muted-foreground">
												{t("settings.scheduledExports.delivery.s3PrefixHint", "Optional prefix for organizing exports in the S3 bucket")}
											</p>
										</div>
									)}
								</form.Field>
							</div>
						)}
					</>
				)}
			</form.Subscribe>
		</div>
	);
}
