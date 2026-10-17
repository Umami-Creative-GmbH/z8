"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { completeDrivingLicenceCheckAction } from "@/lib/organization/driving-licence/check-actions";
import {
	type CheckResult,
	type DrivingCheckClass,
	LICENCE_CLASSES,
} from "@/lib/organization/driving-licence/check-types";

const DEFAULT_CLASSES: DrivingCheckClass[] = LICENCE_CLASSES.map((code) => ({
	code,
	result: "successful",
	expiryDate: null,
	restrictions: "",
}));
export function OriginalDrivingCheckForm({
	employeeId,
	name,
	onCompleted,
}: {
	employeeId: string;
	name: string;
	onCompleted: () => Promise<void>;
}) {
	const { t } = useTranslate();

	const [error, setError] = useState("");
	const [commandId, setCommandId] = useState(() => crypto.randomUUID());
	const form = useForm({
		defaultValues: {
			documentIssuedOn: "",
			documentExpiresOn: "",
			originalInspected: false,
			identityConfirmed: false,
			employeeDeclaration: false,
			verifierConfirmed: false,
			failureScope: "classes" as "classes" | "document" | "person",
			selected: [] as string[],
			classes: DEFAULT_CLASSES,
		},
		onSubmit: async ({ value }) => {
			setError("");
			const selectedCodes = new Set(value.selected);
			const classes = value.classes.filter((inspected) =>
				selectedCodes.has(inspected.code),
			);
			if (!classes.length) {
				setError(
					t(
						"drivingLicence.check.chooseClasses",
						"Select the classes you actually inspected.",
					),
				);
				return;
			}
			const result = await completeDrivingLicenceCheckAction({
				employeeId,
				commandId,
				documentIssuedOn: value.documentIssuedOn,
				documentExpiresOn: value.documentExpiresOn,
				originalInspected: value.originalInspected,
				identityConfirmed: value.identityConfirmed,
				employeeDeclaration: value.employeeDeclaration,
				verifierConfirmed: value.verifierConfirmed,
				failureScope: value.failureScope,
				classes,
			});
			if (!result.success) {
				setError(result.error);
				return;
			}
			await onCompleted();
			setCommandId(crypto.randomUUID());
			form.reset();
		},
	});
	return (
		<form
			className="space-y-6 rounded-lg border bg-card p-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<div>
				<h3 className="text-lg font-semibold">
					{t(
						"drivingLicence.check.title",
						"Inspect {name}'s original licence",
						{ name },
					)}
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					{t(
						"drivingLicence.check.privacy",
						"Record only document dates, inspected classes and necessary driving restrictions. Do not enter a licence number, address, medical explanations or personal background.",
					)}
				</p>
			</div>
			<fieldset className="grid gap-4 sm:grid-cols-2">
				<legend className="mb-3 font-medium">
					{t("drivingLicence.check.documentDates", "Original document dates")}
				</legend>
				<form.Field name="documentIssuedOn">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("drivingLicence.check.issueDate", "Document issue date")}
							</TFormLabel>
							<TFormControl>
								<Input
									type="date"
									required
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="documentExpiresOn">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("drivingLicence.check.expiryDate", "Document expiry date")}
							</TFormLabel>
							<TFormControl>
								<Input
									type="date"
									required
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
			</fieldset>
			<fieldset className="space-y-3">
				<legend className="mb-3 font-medium">
					{t("drivingLicence.check.classes", "Classes actually inspected")}
				</legend>
				<form.Field name="selected">
					{(selected) => {
						const selectedCodes = new Set(selected.state.value);
						return (
							<form.Field name="classes">
								{(classes) => (
									<div className="space-y-3">
										{classes.state.value.map((inspected, index) => (
											<InspectionClassRow
												key={inspected.code}
												inspected={inspected}
												chosen={selectedCodes.has(inspected.code)}
												onSelect={(chosen) =>
													selected.handleChange(
														chosen
															? [...selected.state.value, inspected.code]
															: selected.state.value.filter(
																	(code) => code !== inspected.code,
																),
													)
												}
												onChange={(values) =>
													classes.handleChange(
														classes.state.value.map((row, i) =>
															i === index ? { ...row, ...values } : row,
														),
													)
												}
											/>
										))}
									</div>
								)}
							</form.Field>
						);
					}}
				</form.Field>
			</fieldset>
			<form.Field name="failureScope">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"drivingLicence.check.failureScope",
								"Scope of an unsuccessful or inconclusive check",
							)}
						</TFormLabel>
						<TFormControl>
							<select
								className="h-9 w-full rounded-md border bg-background px-2 focus-visible:ring-2 focus-visible:ring-ring"
								aria-label={t(
									"drivingLicence.check.failureScope",
									"Scope of an unsuccessful or inconclusive check",
								)}
								value={field.state.value}
								onChange={(event) =>
									field.handleChange(
										event.target.value as "classes" | "document" | "person",
									)
								}
							>
								<option value="classes">
									{t(
										"drivingLicence.check.scopeClasses",
										"Only the affected inspected classes",
									)}
								</option>
								<option value="document">
									{t(
										"drivingLicence.check.scopeDocument",
										"Every authorization based on the document",
									)}
								</option>
								<option value="person">
									{t(
										"drivingLicence.check.scopePerson",
										"All driving authorization for the employee",
									)}
								</option>
							</select>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<fieldset className="space-y-3">
				<legend className="mb-3 font-medium">
					{t(
						"drivingLicence.check.attestations",
						"Personal inspection and declarations",
					)}
				</legend>
				<form.Field name="originalInspected">
					{(field) => (
						<InspectionConfirmation
							checked={field.state.value}
							onChange={field.handleChange}
							label={t(
								"drivingLicence.check.original",
								"I personally inspected the original driving licence in the employee's presence.",
							)}
						/>
					)}
				</form.Field>
				<form.Field name="identityConfirmed">
					{(field) => (
						<InspectionConfirmation
							checked={field.state.value}
							onChange={field.handleChange}
							label={t(
								"drivingLicence.check.identity",
								"I confirmed that the original document belongs to this employee.",
							)}
						/>
					)}
				</form.Field>
				<blockquote className="border-l-2 border-primary pl-3 text-sm">
					{t(
						"drivingLicence.declaration.text",
						"I confirm that no known driving ban, withdrawal or other impediment prevents the intended driving, and that I meet the applicable driving restrictions.",
					)}
				</blockquote>
				<form.Field name="employeeDeclaration">
					{(field) => (
						<InspectionConfirmation
							checked={field.state.value}
							onChange={field.handleChange}
							label={t(
								"drivingLicence.check.employeeDeclaration",
								"The employee personally made the declaration shown above during this check; I attest that declaration.",
							)}
						/>
					)}
				</form.Field>
				<form.Field name="verifierConfirmed">
					{(field) => (
						<InspectionConfirmation
							checked={field.state.value}
							onChange={field.handleChange}
							required
							label={t(
								"drivingLicence.check.verifier",
								"I confirm that the recorded facts and individual class results reflect my inspection.",
							)}
						/>
					)}
				</form.Field>
			</fieldset>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.check.suspensionNotice",
					"A successful recheck does not automatically reinstate a suspended authorization. A new check and an explicit reinstatement decision are required.",
				)}
			</p>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting
							? t("drivingLicence.check.saving", "Recording check…")
							: t("drivingLicence.check.submit", "Record original check")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function InspectionClassRow({
	inspected,
	chosen,
	onSelect,
	onChange,
}: {
	inspected: DrivingCheckClass;
	chosen: boolean;
	onSelect: (chosen: boolean) => void;
	onChange: (values: Partial<DrivingCheckClass>) => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	return (
		<div className="rounded-md border p-3">
			<label className="flex items-center gap-2 font-medium">
				<input
					type="checkbox"
					checked={chosen}
					onChange={(event) => onSelect(event.target.checked)}
				/>
				{inspected.code}
			</label>
			{chosen && (
				<div className="mt-3 grid gap-3 sm:grid-cols-3">
					<label className="space-y-1 text-sm" htmlFor={`${id}-result`}>
						<span>{t("drivingLicence.check.result", "Result")}</span>
						<select
							id={`${id}-result`}
							className="h-9 w-full rounded-md border bg-background px-2 focus-visible:ring-2 focus-visible:ring-ring"
							value={inspected.result}
							onChange={(event) =>
								onChange({ result: event.target.value as CheckResult })
							}
						>
							<option value="successful">
								{t("drivingLicence.result.successful", "Successful")}
							</option>
							<option value="unsuccessful">
								{t("drivingLicence.result.unsuccessful", "Unsuccessful")}
							</option>
							<option value="inconclusive">
								{t("drivingLicence.result.inconclusive", "Inconclusive")}
							</option>
						</select>
					</label>
					<label className="space-y-1 text-sm" htmlFor={`${id}-expiry`}>
						<span>
							{t(
								"drivingLicence.check.classExpiry",
								"Class expiry (if applicable)",
							)}
						</span>
						<Input
							id={`${id}-expiry`}
							name={`${inspected.code}-expiry`}
							autoComplete="off"
							type="date"
							value={inspected.expiryDate ?? ""}
							onChange={(event) =>
								onChange({ expiryDate: event.target.value || null })
							}
						/>
					</label>
					<label className="space-y-1 text-sm" htmlFor={`${id}-restrictions`}>
						<span>
							{t(
								"drivingLicence.check.restrictions",
								"Necessary driving restrictions",
							)}
						</span>
						<Input
							id={`${id}-restrictions`}
							name={`${inspected.code}-restrictions`}
							autoComplete="off"
							maxLength={300}
							value={inspected.restrictions}
							onChange={(event) =>
								onChange({ restrictions: event.target.value })
							}
						/>
					</label>
				</div>
			)}
		</div>
	);
}

function InspectionConfirmation({
	checked,
	onChange,
	label,
	required,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	required?: boolean;
}) {
	return (
		<label className="flex items-start gap-3 text-sm">
			<input
				type="checkbox"
				required={required}
				className="mt-1"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
			/>
			{label}
		</label>
	);
}
