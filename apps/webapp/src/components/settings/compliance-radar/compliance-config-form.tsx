"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import {
	saveComplianceConfig,
	type ComplianceConfigData,
	type SaveConfigInput,
} from "@/app/[locale]/(app)/settings/compliance-radar/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { ComplianceFindingSeverity } from "@/db/schema";

interface ComplianceConfigFormProps {
	config: ComplianceConfigData | null | undefined;
	onSaved: () => void;
}

const DEFAULT_CONFIG: SaveConfigInput = {
	detectRestPeriodViolations: true,
	detectMaxHoursDaily: true,
	detectMaxHoursWeekly: true,
	detectConsecutiveDays: true,
	restPeriodMinutes: null,
	maxDailyMinutes: null,
	maxWeeklyMinutes: null,
	maxConsecutiveDays: 6,
	employeeVisibility: false,
	notifyManagers: true,
	notifyOnSeverity: "warning",
	teamsDigestEnabled: false,
	autoResolveAfterDays: 90,
};

export function ComplianceConfigForm({ config, onSaved }: ComplianceConfigFormProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm({
		defaultValues: config
			? {
					detectRestPeriodViolations: config.detectRestPeriodViolations,
					detectMaxHoursDaily: config.detectMaxHoursDaily,
					detectMaxHoursWeekly: config.detectMaxHoursWeekly,
					detectConsecutiveDays: config.detectConsecutiveDays,
					restPeriodMinutes: config.restPeriodMinutes,
					maxDailyMinutes: config.maxDailyMinutes,
					maxWeeklyMinutes: config.maxWeeklyMinutes,
					maxConsecutiveDays: config.maxConsecutiveDays,
					employeeVisibility: config.employeeVisibility,
					notifyManagers: config.notifyManagers,
					notifyOnSeverity: config.notifyOnSeverity,
					teamsDigestEnabled: config.teamsDigestEnabled,
					autoResolveAfterDays: config.autoResolveAfterDays,
				}
			: DEFAULT_CONFIG,
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			try {
				const result = await saveComplianceConfig(value);
				if (result.success) {
					toast.success(t("complianceRadar.config.saved", "Configuration saved"));
					onSaved();
				} else {
					toast.error(result.error);
				}
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="space-y-6"
		>
			{/* Detection Rules */}
			<Card>
				<CardHeader>
					<CardTitle>{t("complianceRadar.config.detectionRules", "Detection Rules")}</CardTitle>
					<CardDescription>
						{t("complianceRadar.config.detectionRulesDesc", "Select which compliance violations to detect")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<form.Field name="detectRestPeriodViolations">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.detectRestPeriod", "Rest Period Violations")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.detectRestPeriodDesc", "Detect insufficient rest between shifts (11 hours minimum)")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="detectMaxHoursDaily">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.detectMaxDaily", "Daily Hours Exceeded")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.detectMaxDailyDesc", "Detect when daily work hours exceed maximum (10 hours)")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="detectMaxHoursWeekly">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.detectMaxWeekly", "Weekly Hours Exceeded")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.detectMaxWeeklyDesc", "Detect when weekly work hours exceed maximum (48 hours)")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="detectConsecutiveDays">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.detectConsecutive", "Consecutive Days Exceeded")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.detectConsecutiveDesc", "Detect when employees work too many days in a row")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
			</Card>

			{/* Thresholds */}
			<Card>
				<CardHeader>
					<CardTitle>{t("complianceRadar.config.thresholds", "Thresholds")}</CardTitle>
					<CardDescription>
						{t("complianceRadar.config.thresholdsDesc", "Override default thresholds (leave empty to use work policy defaults)")}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<form.Field name="restPeriodMinutes">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{t("complianceRadar.config.restPeriodMinutes", "Minimum Rest Period (minutes)")}
								</Label>
								<Input
									id={field.name}
									type="number"
									placeholder={t("complianceRadar.config.restPeriodPlaceholder", "660 (11 hours)")}
									value={field.state.value ?? ""}
									onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="maxDailyMinutes">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{t("complianceRadar.config.maxDailyMinutes", "Max Daily Minutes")}
								</Label>
								<Input
									id={field.name}
									type="number"
									placeholder={t("complianceRadar.config.maxDailyPlaceholder", "600 (10 hours)")}
									value={field.state.value ?? ""}
									onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="maxWeeklyMinutes">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{t("complianceRadar.config.maxWeeklyMinutes", "Max Weekly Minutes")}
								</Label>
								<Input
									id={field.name}
									type="number"
									placeholder={t("complianceRadar.config.maxWeeklyPlaceholder", "2880 (48 hours)")}
									value={field.state.value ?? ""}
									onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="maxConsecutiveDays">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>
									{t("complianceRadar.config.maxConsecutiveDays", "Max Consecutive Days")}
								</Label>
								<Input
									id={field.name}
									type="number"
									placeholder={t("complianceRadar.config.maxConsecutivePlaceholder", "6")}
									value={field.state.value ?? ""}
									onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : null)}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
			</Card>

			{/* Notifications */}
			<Card>
				<CardHeader>
					<CardTitle>{t("complianceRadar.config.notifications", "Notifications")}</CardTitle>
					<CardDescription>
						{t("complianceRadar.config.notificationsDesc", "Configure how findings are communicated")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<form.Field name="notifyManagers">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.notifyManagers", "Notify Managers")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.notifyManagersDesc", "Send notifications to managers when findings are detected")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="notifyOnSeverity">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.notifyOnSeverity", "Minimum Severity for Notifications")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.notifyOnSeverityDesc", "Only notify for findings at or above this severity")}
									</p>
								</div>
								<Select
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as ComplianceFindingSeverity)}
								>
									<SelectTrigger id={field.name} className="w-32">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="info">{t("complianceRadar.severity.info", "Info")}</SelectItem>
										<SelectItem value="warning">{t("complianceRadar.severity.warning", "Warning")}</SelectItem>
										<SelectItem value="critical">{t("complianceRadar.severity.critical", "Critical")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					<form.Field name="teamsDigestEnabled">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.teamsDigest", "Teams Daily Digest")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.teamsDigestDesc", "Send daily digest to Microsoft Teams channel")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>

					<form.Field name="employeeVisibility">
						{(field) => (
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.employeeVisibility", "Employee Visibility")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.employeeVisibilityDesc", "Allow employees to view their own compliance findings")}
									</p>
								</div>
								<Switch
									id={field.name}
									checked={field.state.value}
									onCheckedChange={field.handleChange}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
			</Card>

			{/* Auto-Resolution */}
			<Card>
				<CardHeader>
					<CardTitle>{t("complianceRadar.config.autoResolution", "Auto-Resolution")}</CardTitle>
					<CardDescription>
						{t("complianceRadar.config.autoResolutionDesc", "Automatically resolve old findings")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form.Field name="autoResolveAfterDays">
						{(field) => (
							<div className="flex items-center gap-4">
								<div className="flex-1 space-y-0.5">
									<Label htmlFor={field.name}>
										{t("complianceRadar.config.autoResolveAfterDays", "Auto-resolve after (days)")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t("complianceRadar.config.autoResolveAfterDaysDesc", "Set to 0 to disable auto-resolution")}
									</p>
								</div>
								<Input
									id={field.name}
									type="number"
									className="w-24"
									value={field.state.value}
									onChange={(e) => field.handleChange(Number(e.target.value))}
								/>
							</div>
						)}
					</form.Field>
				</CardContent>
			</Card>

			{/* Submit */}
			<div className="flex justify-end">
				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconDeviceFloppy className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("common.save", "Save")}
				</Button>
			</div>
		</form>
	);
}
