"use client";
import { IconUserCheck } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import type { DrivingLicenceDeclaredClasses } from "@/lib/organization/driving-licence/declared-classes-store";
import { LicenceClassIcon, useLicenceClassNames } from "./licence-class-visuals";

const DEFAULT_CLASSES: DrivingCheckClass[] = LICENCE_CLASSES.map((code) => ({
	code,
	result: "successful",
	expiryDate: null,
	restrictions: "",
}));
type FailureScope = "classes" | "document" | "person";

/**
 * The original check (#1429: on the check page). The inspected classes, the employee's
 * declaration and the verifier's confirmations are checkboxes: each confirms a statement.
 */
export function OriginalDrivingCheckForm({
	employeeId,
	name,
	declared = null,
	declaredUnchecked = [],
	onCompleted,
}: {
	employeeId: string;
	name: string;
	/** The employee's own statement (#2003): preselects the classes to inspect. */
	declared?: DrivingLicenceDeclaredClasses | null;
	declaredUnchecked?: readonly string[];
	onCompleted: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const [error, setError] = useState("");
	const [commandId, setCommandId] = useState(() => crypto.randomUUID());
	const declaredCodes = new Set(declaredUnchecked);
	const form = useForm({
		defaultValues: originalCheckDefaults(declared, declaredCodes),
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
			}).catch(() => ({
				success: false as const,
				error: t(
					"drivingLicence.check.transportError",
					"The check could not be recorded. Your input is kept; retry after checking your connection and responsibility.",
				),
			}));
			if (!result.success) {
				setError(result.error);
				toast.error(result.error);
				return;
			}
			toast.success(
				t("drivingLicence.check.recorded", "Original check recorded"),
			);
			await onCompleted();
			setCommandId(crypto.randomUUID());
			form.reset();
		},
	});
	return (
		<Card>
			<OriginalCheckHeader name={name} />
			<CardContent>
				{declaredCodes.size ? (
					<DeclaredClassesAlert name={name} codes={declaredCodes} />
				) : null}
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<fieldset className="grid gap-4 sm:grid-cols-2">
						<legend className="mb-3 font-medium">
							{t(
								"drivingLicence.check.documentDates",
								"Original document dates",
							)}
						</legend>
						<form.Field name="documentIssuedOn">
							{(field) => (
								<DocumentDateInput
									name={field.name}
									label={t(
										"drivingLicence.check.issueDate",
										"Document issue date",
									)}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={field.handleChange}
								/>
							)}
						</form.Field>
						<form.Field name="documentExpiresOn">
							{(field) => (
								<DocumentDateInput
									name={field.name}
									label={t(
										"drivingLicence.check.expiryDate",
										"Document expiry date",
									)}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={field.handleChange}
								/>
							)}
						</form.Field>
					</fieldset>
					<fieldset className="space-y-3">
						<legend className="mb-3 font-medium">
							{t("drivingLicence.check.classes", "Classes actually inspected")}
						</legend>
						<form.Field name="selected">
							{(selected) => (
								<form.Field name="classes">
									{(classes) => (
										<InspectionClassGrid
											classes={classes.state.value}
											selected={selected.state.value}
											declaredCodes={declaredCodes}
											onSelectedChange={selected.handleChange}
											onClassesChange={classes.handleChange}
										/>
									)}
								</form.Field>
							)}
						</form.Field>
					</fieldset>
					<form.Field name="failureScope">
						{(field) => (
							<FailureScopeSelect
								value={field.state.value}
								onChange={field.handleChange}
							/>
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
						{(isSubmitting) => <RecordCheckButton isSubmitting={isSubmitting} />}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}

function originalCheckDefaults(
	declared: DrivingLicenceDeclaredClasses | null,
	declaredCodes: ReadonlySet<string>,
) {
	const declaredExpiry = new Map(
		declared?.classes.map((entry) => [entry.code, entry.expiryDate]) ?? [],
	);
	return {
		documentIssuedOn: "",
		documentExpiresOn: declared?.documentExpiresOn ?? "",
		originalInspected: false,
		identityConfirmed: false,
		employeeDeclaration: false,
		verifierConfirmed: false,
		failureScope: "classes" as FailureScope,
		selected: LICENCE_CLASSES.filter((code) => declaredCodes.has(code)) as string[],
		classes: DEFAULT_CLASSES.map((row) =>
			declaredCodes.has(row.code)
				? { ...row, expiryDate: declaredExpiry.get(row.code) ?? null }
				: row,
		),
	};
}

function OriginalCheckHeader({ name }: { name: string }) {
	const { t } = useTranslate();
	return (
		<CardHeader>
			<CardTitle>
				<h2 className="text-lg font-semibold">
					{t(
						"drivingLicence.check.title",
						"Inspect {name}'s original licence",
						{ name },
					)}
				</h2>
			</CardTitle>
			<CardDescription>
				{t(
					"drivingLicence.check.privacy",
					"Record only document dates, inspected classes and necessary driving restrictions. Do not enter a licence number, address, medical explanations or personal background.",
				)}
			</CardDescription>
		</CardHeader>
	);
}

function DeclaredClassesAlert({
	name,
	codes,
}: {
	name: string;
	codes: ReadonlySet<string>;
}) {
	const { t } = useTranslate();
	const { className: nameOf } = useLicenceClassNames();
	return (
		<Alert className="mb-6">
			<IconUserCheck aria-hidden="true" />
			<AlertTitle>
				{t(
					"drivingLicence.check.declaredTitle",
					"{name} declared {classes}",
					{
						name,
						classes: [...codes]
							.map((code) => `${code} (${nameOf(code)})`)
							.join(", "),
					},
				)}
			</AlertTitle>
			<AlertDescription>
				{t(
					"drivingLicence.check.declaredHelp",
					"These classes and any dates the employee entered are preselected. Compare them with the original licence and correct anything that differs.",
				)}
			</AlertDescription>
		</Alert>
	);
}

function InspectionClassGrid({
	classes,
	selected,
	declaredCodes,
	onSelectedChange,
	onClassesChange,
}: {
	classes: DrivingCheckClass[];
	selected: string[];
	declaredCodes: ReadonlySet<string>;
	onSelectedChange: (selected: string[]) => void;
	onClassesChange: (classes: DrivingCheckClass[]) => void;
}) {
	const selectedCodes = new Set(selected);
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{classes.map((inspected, index) => (
				<InspectionClassRow
					key={inspected.code}
					inspected={inspected}
					declared={declaredCodes.has(inspected.code)}
					chosen={selectedCodes.has(inspected.code)}
					onSelect={(chosen) =>
						onSelectedChange(
							chosen
								? [...selected, inspected.code]
								: selected.filter((code) => code !== inspected.code),
						)
					}
					onChange={(values) =>
						onClassesChange(
							classes.map((row, i) =>
								i === index ? { ...row, ...values } : row,
							),
						)
					}
				/>
			))}
		</div>
	);
}

function RecordCheckButton({ isSubmitting }: { isSubmitting: boolean }) {
	const { t } = useTranslate();
	return (
		<Button type="submit" disabled={isSubmitting}>
			{isSubmitting
				? t("drivingLicence.check.saving", "Recording check…")
				: t("drivingLicence.check.submit", "Record original check")}
		</Button>
	);
}

function DocumentDateInput({
	name,
	label,
	value,
	onBlur,
	onChange,
}: {
	name: string;
	label: string;
	value: string;
	onBlur: () => void;
	onChange: (value: string) => void;
}) {
	return (
		<TFormItem>
			<TFormLabel>{label}</TFormLabel>
			<TFormControl>
				<Input
					name={name}
					autoComplete="off"
					aria-describedby={undefined}
					type="date"
					required
					value={value}
					onBlur={onBlur}
					onChange={(event) => onChange(event.target.value)}
				/>
			</TFormControl>
		</TFormItem>
	);
}

function FailureScopeSelect({
	value,
	onChange,
}: {
	value: FailureScope;
	onChange: (value: FailureScope) => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const scopes: { value: FailureScope; label: string }[] = [
		{
			value: "classes",
			label: t(
				"drivingLicence.check.scopeClasses",
				"Only the affected inspected classes",
			),
		},
		{
			value: "document",
			label: t(
				"drivingLicence.check.scopeDocument",
				"Every authorization based on the document",
			),
		},
		{
			value: "person",
			label: t(
				"drivingLicence.check.scopePerson",
				"All driving authorization for the employee",
			),
		},
	];
	return (
		<div className="flex flex-col gap-1.5">
			<span id={id} className="text-sm font-medium">
				{t(
					"drivingLicence.check.failureScope",
					"Scope of an unsuccessful or inconclusive check",
				)}
			</span>
			<Select
				value={value}
				items={scopes}
				onValueChange={(next) => {
					if (next) onChange(next as FailureScope);
				}}
			>
				<SelectTrigger aria-labelledby={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{scopes.map((scope) => (
						<SelectItem key={scope.value} value={scope.value}>
							{scope.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function InspectionClassRow({
	inspected,
	chosen,
	declared,
	onSelect,
	onChange,
}: {
	inspected: DrivingCheckClass;
	chosen: boolean;
	declared: boolean;
	onSelect: (chosen: boolean) => void;
	onChange: (values: Partial<DrivingCheckClass>) => void;
}) {
	const { t } = useTranslate();
	const { className: nameOf } = useLicenceClassNames();
	const id = useId();
	const results: { value: CheckResult; label: string }[] = [
		{
			value: "successful",
			label: t("drivingLicence.result.successful", "Successful"),
		},
		{
			value: "unsuccessful",
			label: t("drivingLicence.result.unsuccessful", "Unsuccessful"),
		},
		{
			value: "inconclusive",
			label: t("drivingLicence.result.inconclusive", "Inconclusive"),
		},
	];
	return (
		<div
			className={
				chosen
					? "col-span-full rounded-md border border-primary/30 bg-primary/5 p-3"
					: "rounded-md border p-3"
			}
		>
			<div className="flex items-center gap-2">
				<Checkbox
					id={`${id}-class`}
					checked={chosen}
					onCheckedChange={(checked) => onSelect(checked === true)}
				/>
				<Label htmlFor={`${id}-class`} className="flex min-w-0 flex-1 items-center gap-2">
					<LicenceClassIcon
						code={inspected.code}
						className={chosen ? "text-primary" : "text-muted-foreground"}
					/>
					<span className="font-medium" translate="no">
						{inspected.code}
					</span>{" "}
					<span className="truncate text-xs font-normal text-muted-foreground">
						{nameOf(inspected.code)}
					</span>
				</Label>
				{declared ? (
					<Badge variant="outline" className="border-dashed">
						{t("drivingLicence.check.declaredBadge", "Declared")}
					</Badge>
				) : null}
			</div>
			{chosen && (
				<div className="mt-3 grid gap-3 sm:grid-cols-3">
					<div className="space-y-1 text-sm">
						<span id={`${id}-result`}>
							{t("drivingLicence.check.result", "Result")}
						</span>
						<Select
							value={inspected.result}
							items={results}
							onValueChange={(value) => {
								if (value) onChange({ result: value as CheckResult });
							}}
						>
							<SelectTrigger
								aria-labelledby={`${id}-result`}
								className="w-full"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{results.map((result) => (
									<SelectItem key={result.value} value={result.value}>
										{result.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
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
	const id = useId();
	return (
		<div className="flex items-start gap-3">
			<Checkbox
				id={id}
				required={required}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={(next) => onChange(next === true)}
			/>
			<Label htmlFor={id} className="text-sm font-normal leading-snug">
				{label}
			</Label>
		</div>
	);
}
