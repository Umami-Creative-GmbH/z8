"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import type { DrivingLicenceHistory } from "@/lib/organization/driving-licence/history";
import { supplementDrivingLicenceCheckAction } from "@/lib/organization/driving-licence/history-actions";
import type { DrivingCheckCorrection } from "@/lib/organization/driving-licence/history-types";
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
	const { form, error } = useSupplementForm({ employeeId, check, onSaved });
	return (
		<form
			className="space-y-4 rounded-lg border border-primary/30 bg-card p-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<h3 className="font-semibold">
				{t(
					"drivingLicence.history.supplementTitle",
					"Supplement original check {date}",
					{ date: check.controlledAt },
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.history.supplementHelp",
					"This adds a dated correction with your identity. The original confirmation stays unchanged. Earlier limits, failed outcomes and new restrictions suspend affected current clearance; a supplement never renews or reinstates authorization.",
				)}
			</p>
			<SupplementCorrectionFields form={form} check={check} />
			<form.Field name="reason">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("drivingLicence.history.reason", "Reason for supplement")}
						</TFormLabel>
						<TFormControl>
							<select
								aria-label={t(
									"drivingLicence.history.reason",
									"Reason for supplement",
								)}
								name={field.name}
								autoComplete="off"
								className="h-10 w-full rounded-md border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							>
								<option value="recording_error">
									{t(
										"drivingLicence.history.recordingError",
										"Recording error",
									)}
								</option>
								<option value="missing_detail">
									{t("drivingLicence.history.missingDetail", "Missing detail")}
								</option>
							</select>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{t(
						"drivingLicence.history.saveError",
						"The supplement could not be saved. Check your current responsibility and correction details.",
					)}
				</p>
			)}
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
	const [commandId] = useState(() => crypto.randomUUID());
	const [error, setError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			field: "documentIssuedOn",
			classCode: check.classes[0]?.code ?? "B",
			value: "",
			reason: "recording_error",
		},
		onSubmit: async ({ value }) => {
			let correction: DrivingCheckCorrection;
			const classCode = check.classes.find(
				(c) => c.code === value.classCode,
			)?.code;
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
			setError(null);
			const saved = await supplementDrivingLicenceCheckAction({
				employeeId,
				checkId: check.id,
				commandId,
				reason: value.reason,
				correction,
			});
			if (!saved.success) {
				setError(saved.error);
				return;
			}
			await onSaved();
		},
	});
	return { form, error };
}
function SupplementCorrectionFields({
	form,
	check,
}: {
	form: ReturnType<typeof useSupplementForm>["form"];
	check: DrivingLicenceHistory["checks"][number];
}) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field name="field">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("drivingLicence.history.field", "Corrected field")}
						</TFormLabel>
						<TFormControl>
							<select
								aria-label={t(
									"drivingLicence.history.field",
									"Corrected field",
								)}
								name={field.name}
								autoComplete="off"
								className="h-10 w-full rounded-md border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									form.setFieldValue("value", "");
								}}
							>
								<option value="documentIssuedOn">
									{t(
										"drivingLicence.history.documentIssued",
										"Document issue date",
									)}
								</option>
								<option value="documentExpiresOn">
									{t(
										"drivingLicence.history.documentExpiry",
										"Document expiry date",
									)}
								</option>
								<option value="classExpiry">
									{t("drivingLicence.history.classExpiry", "Class expiry date")}
								</option>
								<option value="classRestrictions">
									{t(
										"drivingLicence.history.classRestrictions",
										"Driving restrictions",
									)}
								</option>
								<option value="classResult">
									{t(
										"drivingLicence.history.classResult",
										"Inspected class outcome",
									)}
								</option>
							</select>
						</TFormControl>
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
										<TFormLabel>
											{t("drivingLicence.history.class", "Checked class")}
										</TFormLabel>
										<TFormControl>
											<select
												aria-label={t(
													"drivingLicence.history.class",
													"Checked class",
												)}
												name={field.name}
												autoComplete="off"
												className="h-10 w-full rounded-md border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => {
													const code = check.classes.find(
														(c) => c.code === event.target.value,
													)?.code;
													if (code) field.handleChange(code);
												}}
											>
												{check.classes.map((c) => (
													<option key={c.code} value={c.code}>
														{c.code}
													</option>
												))}
											</select>
										</TFormControl>
									</TFormItem>
								)}
							</form.Field>
						)}
						<form.Field name="value">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("drivingLicence.history.value", "Corrected value")}
									</TFormLabel>
									<TFormControl>
										{selectedField === "classResult" ? (
											<select
												aria-label={t(
													"drivingLicence.history.value",
													"Corrected value",
												)}
												name={field.name}
												autoComplete="off"
												required
												className="h-10 w-full rounded-md border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
											>
												<option value="">
													{t(
														"drivingLicence.history.chooseOutcome",
														"Choose outcome",
													)}
												</option>
												<option value="successful">
													{t("drivingLicence.result.successful", "Successful")}
												</option>
												<option value="unsuccessful">
													{t(
														"drivingLicence.result.unsuccessful",
														"Unsuccessful",
													)}
												</option>
												<option value="inconclusive">
													{t(
														"drivingLicence.result.inconclusive",
														"Inconclusive",
													)}
												</option>
											</select>
										) : (
											<Input
												name={field.name}
												autoComplete="off"
												type={
													selectedField === "classRestrictions"
														? "text"
														: "date"
												}
												required={
													selectedField !== "classRestrictions" &&
													selectedField !== "classExpiry"
												}
												maxLength={
													selectedField === "classRestrictions"
														? 300
														: undefined
												}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
											/>
										)}
									</TFormControl>
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
