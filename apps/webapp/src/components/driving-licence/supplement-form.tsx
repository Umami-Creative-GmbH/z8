"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import type { DrivingLicenceHistory } from "@/lib/organization/driving-licence/history";
import { supplementDrivingLicenceCheckAction } from "@/lib/organization/driving-licence/history-actions";
import type { DrivingCheckCorrection } from "@/lib/organization/driving-licence/history-types";

type Option = { value: string; label: string };

/** A design-system Select for one supplement field, labelled by its visible label. */
function SupplementSelect({
	labelId,
	value,
	options,
	onChange,
	placeholder,
}: {
	labelId: string;
	value: string;
	options: Option[];
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<Select
			value={value || null}
			items={options}
			onValueChange={(next) => {
				if (typeof next === "string") onChange(next);
			}}
		>
			<SelectTrigger aria-labelledby={labelId} className="w-full">
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function DrivingCheckSupplementForm({
	employeeId,
	check,
	onSaved,
	onCancel,
}: {
	employeeId: string;
	check: DrivingLicenceHistory["checks"][number];
	onSaved: () => Promise<void>;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const reasonId = useId();
	const form = useSupplementForm({ employeeId, check, onSaved });
	const reasons: Option[] = [
		{
			value: "recording_error",
			label: t("drivingLicence.history.recordingError", "Recording error"),
		},
		{
			value: "missing_detail",
			label: t("drivingLicence.history.missingDetail", "Missing detail"),
		},
	];
	return (
		<Card className="border-primary/30">
			<CardHeader>
				<CardTitle>
					<h3 className="font-semibold">
						{t("drivingLicence.history.supplementTitle", "Supplement original check {date}", {
							date: check.controlledAt,
						})}
					</h3>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.history.supplementHelp",
						"This adds a dated correction with your identity. The original confirmation stays unchanged. Earlier limits, failed outcomes and new restrictions suspend affected current clearance; a supplement never renews or reinstates authorization.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<SupplementCorrectionFields form={form} check={check} />
					<form.Field name="reason">
						{(field) => (
							<TFormItem>
								<TFormLabel id={reasonId}>
									{t("drivingLicence.history.reason", "Reason for supplement")}
								</TFormLabel>
								<SupplementSelect
									labelId={reasonId}
									value={field.state.value}
									options={reasons}
									onChange={field.handleChange}
								/>
							</TFormItem>
						)}
					</form.Field>
					<div className="flex gap-2">
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(busy) => (
								<Button type="submit" disabled={busy}>
									{t("drivingLicence.history.save", "Save supplement")}
								</Button>
							)}
						</form.Subscribe>
						<Button type="button" variant="ghost" onClick={onCancel}>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
function useSupplementForm({
	employeeId,
	check,
	onSaved,
}: {
	employeeId: string;
	check: DrivingLicenceHistory["checks"][number];
	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const [commandId] = useState(() => crypto.randomUUID());
	return useForm({
		defaultValues: {
			field: "documentIssuedOn",
			classCode: check.classes[0]?.code ?? "B",
			value: "",
			reason: "recording_error",
		},
		onSubmit: async ({ value }) => {
			let correction: DrivingCheckCorrection;
			const classCode = check.classes.find((c) => c.code === value.classCode)?.code;
			switch (value.field) {
				case "documentIssuedOn":
				case "documentExpiresOn":
					correction = { field: value.field, value: value.value };
					break;
				case "classExpiry":
					if (!classCode) return;
					correction = {
						field: value.field,
						classCode,
						value: value.value || null,
					};
					break;
				case "classRestrictions":
					if (!classCode) return;
					correction = { field: value.field, classCode, value: value.value };
					break;
				case "classResult": {
					if (
						!classCode ||
						(value.value !== "successful" &&
							value.value !== "unsuccessful" &&
							value.value !== "inconclusive")
					)
						return;
					correction = { field: value.field, classCode, value: value.value };
					break;
				}
				default:
					return;
			}
			const saved = await supplementDrivingLicenceCheckAction({
				employeeId,
				checkId: check.id,
				commandId,
				reason: value.reason,
				correction,
			});
			if (!saved.success) {
				toast.error(
					t(
						"drivingLicence.history.saveError",
						"The supplement could not be saved. Check your current responsibility and correction details.",
					),
				);
				return;
			}
			toast.success(t("drivingLicence.history.saved", "Supplement saved"));
			await onSaved();
		},
	});
}
function SupplementCorrectionFields({
	form,
	check,
}: {
	form: ReturnType<typeof useSupplementForm>;
	check: DrivingLicenceHistory["checks"][number];
}) {
	const { t } = useTranslate();
	const fieldId = useId();
	const classId = useId();
	const valueId = useId();
	const fields: Option[] = [
		{
			value: "documentIssuedOn",
			label: t("drivingLicence.history.documentIssued", "Document issue date"),
		},
		{
			value: "documentExpiresOn",
			label: t("drivingLicence.history.documentExpiry", "Document expiry date"),
		},
		{ value: "classExpiry", label: t("drivingLicence.history.classExpiry", "Class expiry date") },
		{
			value: "classRestrictions",
			label: t("drivingLicence.history.classRestrictions", "Driving restrictions"),
		},
		{
			value: "classResult",
			label: t("drivingLicence.history.classResult", "Inspected class outcome"),
		},
	];
	const outcomes: Option[] = [
		{ value: "successful", label: t("drivingLicence.result.successful", "Successful") },
		{ value: "unsuccessful", label: t("drivingLicence.result.unsuccessful", "Unsuccessful") },
		{ value: "inconclusive", label: t("drivingLicence.result.inconclusive", "Inconclusive") },
	];
	const classes: Option[] = check.classes.map((c) => ({ value: c.code, label: c.code }));
	return (
		<>
			<form.Field name="field">
				{(field) => (
					<TFormItem>
						<TFormLabel id={fieldId}>
							{t("drivingLicence.history.field", "Corrected field")}
						</TFormLabel>
						<SupplementSelect
							labelId={fieldId}
							value={field.state.value}
							options={fields}
							onChange={(next) => {
								field.handleChange(next);
								form.setFieldValue("value", "");
							}}
						/>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.field}>
				{(selectedField) => (
					<>
						{selectedField.startsWith("class") && (
							<form.Field name="classCode">
								{(field) => (
									<TFormItem>
										<TFormLabel id={classId}>
											{t("drivingLicence.history.class", "Checked class")}
										</TFormLabel>
										<SupplementSelect
											labelId={classId}
											value={field.state.value}
											options={classes}
											onChange={(next) => {
												const code = check.classes.find((c) => c.code === next)?.code;
												if (code) field.handleChange(code);
											}}
										/>
									</TFormItem>
								)}
							</form.Field>
						)}
						<form.Field name="value">
							{(field) => (
								<TFormItem>
									<TFormLabel id={valueId}>
										{t("drivingLicence.history.value", "Corrected value")}
									</TFormLabel>
									{selectedField === "classResult" ? (
										<SupplementSelect
											labelId={valueId}
											value={field.state.value}
											options={outcomes}
											onChange={field.handleChange}
											placeholder={t("drivingLicence.history.chooseOutcome", "Choose outcome")}
										/>
									) : (
										<TFormControl>
											<Input
												name={field.name}
												autoComplete="off"
												type={selectedField === "classRestrictions" ? "text" : "date"}
												required={
													selectedField !== "classRestrictions" && selectedField !== "classExpiry"
												}
												maxLength={selectedField === "classRestrictions" ? 300 : undefined}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</TFormControl>
									)}
									<TFormDescription>
										{t(
											"drivingLicence.history.minimalEvidence",
											"Record only necessary driving evidence. Do not enter document numbers, medical explanations or personal background.",
										)}
									</TFormDescription>
								</TFormItem>
							)}
						</form.Field>
					</>
				)}
			</form.Subscribe>
		</>
	);
}
