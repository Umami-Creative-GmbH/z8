"use client";

import { IconAlertTriangle, IconLoader2, IconPlugConnected, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	type AccountingSettings,
	connectAccountingTool,
	removeAccountingTool,
	updateAccountingDefaults,
} from "@/app/[locale]/(app)/settings/billable-time/accounting/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { useDisplayContext } from "@/hooks/use-display-context";
import {
	type AccountingProviderKind,
	isAccountingProviderKind,
} from "@/lib/billable-time/accounting/provider";
import {
	type AccountingConnectionView,
	accountingProviderName,
	type TaxTreatmentView,
} from "@/lib/billable-time/accounting/views";
import { formatRateDate } from "@/lib/billable-time/format";
import type { ServerActionResult } from "@/lib/effect/result";
import { ContactPersonPicker } from "./contact-person-picker";
import { DEFAULT_TAX_TREATMENT } from "./tax-treatment-default";
import {
	TaxTreatmentFields,
	useTaxTreatmentError,
	useTaxTreatmentSummary,
} from "./tax-treatment-fields";

/** Setup advice for one tool, shown with its key field. */
function useProviderHint() {
	const { t } = useTranslate();
	return (kind: AccountingProviderKind): string => {
		switch (kind) {
			case "lexware_office":
				return t(
					"settings.billableTime.accounting.hint.lexwareOffice",
					"Needs the Lexware Office XL plan and drafts in EUR. Create the key at app.lexware.de under Public API, ideally for a dedicated Lexware user.",
				);
			case "sevdesk":
				return t(
					"settings.billableTime.accounting.hint.sevdesk",
					"Use the API token of a sevdesk user. The token carries that user's full permissions, so a dedicated user is recommended.",
				);
		}
	};
}

/**
 * The organization's accounting connection (#903): connect a tool with an API
 * key, replace or remove the connection, and set its default tax treatment.
 * The key is sent once and never shown again.
 */
export function AccountingConnectionCard({
	settings,
	onChanged,
}: {
	settings: AccountingSettings;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const { locale, timezone } = useDisplayContext();
	const summary = useTaxTreatmentSummary();
	const [mode, setMode] = useState<"view" | "connect" | "editTax">("view");
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [removing, setRemoving] = useState(false);
	const connection = settings.connection;

	const remove = async () => {
		if (!connection) return;
		setRemoving(true);
		const result = await removeAccountingTool({ connectionId: connection.id }).catch(() => null);
		setRemoving(false);
		setConfirmRemove(false);
		if (!result?.success) {
			toast.error(result?.error ?? t("common.unexpectedError", "An unexpected error occurred"));
			return;
		}
		toast.success(t("settings.billableTime.accounting.removed", "Accounting connection removed"));
		onChanged();
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconPlugConnected aria-hidden="true" className="size-5" />
					{t("settings.billableTime.accounting.connection.title", "Accounting connection")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.billableTime.accounting.connection.description",
						"Z8 creates invoice drafts in your accounting tool, where your accountant finalizes them. Z8 never issues invoices or creates contacts there.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{connection && mode !== "connect" && (
					<ConnectionSummary
						connection={connection}
						connectedOn={formatRateDate(
							locale,
							Temporal.Instant.from(connection.connectedAt)
								.toZonedDateTimeISO(timezone)
								.toPlainDate()
								.toString(),
						)}
						taxSummary={summary(connection.defaultTaxTreatment)}
					/>
				)}

				{connection && mode === "editTax" && (
					<DefaultTaxForm
						connection={connection}
						onCancel={() => setMode("view")}
						onSaved={() => {
							setMode("view");
							onChanged();
						}}
					/>
				)}

				{(mode === "connect" || !connection) && (
					<ConnectForm
						settings={settings}
						replacing={connection}
						onCancel={connection ? () => setMode("view") : undefined}
						onConnected={() => {
							setMode("view");
							onChanged();
						}}
					/>
				)}

				{connection && mode === "view" && (
					<div className="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" onClick={() => setMode("editTax")}>
							{t("settings.billableTime.accounting.editDefaultTax", "Change default tax treatment")}
						</Button>
						<Button size="sm" variant="outline" onClick={() => setMode("connect")}>
							{t("settings.billableTime.accounting.replace", "Replace connection")}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
							<IconTrash aria-hidden="true" className="mr-2 size-4 text-destructive" />
							{t("settings.billableTime.accounting.remove", "Remove connection")}
						</Button>
					</div>
				)}
			</CardContent>

			<AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.billableTime.accounting.removeTitle",
								"Remove the accounting connection?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.billableTime.accounting.removeDescription",
								"Z8 deletes the API key and can no longer create invoice drafts. Drafts already in the tool stay there. Contact links come back if you reconnect the same account.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removing}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={removing}
							onClick={() => void remove()}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("settings.billableTime.accounting.removeConfirm", "Remove connection")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}

function ConnectionSummary({
	connection,
	connectedOn,
	taxSummary,
}: {
	connection: AccountingConnectionView;
	connectedOn: string;
	taxSummary: string;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-3">
			<dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
				<dt className="text-muted-foreground">
					{t("settings.billableTime.accounting.tool", "Tool")}
				</dt>
				<dd className="font-medium">
					{accountingProviderName(connection.providerKind)}
					{connection.accountLabel && (
						<span className="font-normal text-muted-foreground"> · {connection.accountLabel}</span>
					)}
				</dd>
				<dt className="text-muted-foreground">
					{t("settings.billableTime.accounting.connected", "Connected")}
				</dt>
				<dd>
					{connection.connectedByName
						? t("settings.billableTime.accounting.connectedOnBy", "{date} by {name}", {
								date: connectedOn,
								name: connection.connectedByName,
							})
						: connectedOn}
				</dd>
				<dt className="text-muted-foreground">
					{t("settings.billableTime.accounting.defaultTax", "Default tax treatment")}
				</dt>
				<dd>{taxSummary}</dd>
			</dl>
			{(!connection.apiKeyStored || !connection.providerAvailable) && (
				<p className="flex items-start gap-2 text-sm text-destructive" role="alert">
					<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					{!connection.providerAvailable
						? t(
								"settings.billableTime.accounting.providerUnavailable",
								"This tool is not available in this installation. Replace or remove the connection.",
							)
						: t(
								"settings.billableTime.accounting.keyMissing",
								"The API key is missing from the secret store. Replace the connection with a new key.",
							)}
				</p>
			)}
		</div>
	);
}

function DefaultTaxForm({
	connection,
	onCancel,
	onSaved,
}: {
	connection: AccountingConnectionView;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const taxError = useTaxTreatmentError();
	const form = useForm({
		defaultValues: { taxTreatment: connection.defaultTaxTreatment as TaxTreatmentView },
		onSubmit: async ({ value }) => {
			const result = await updateAccountingDefaults({
				connectionId: connection.id,
				defaultTaxTreatment: value.taxTreatment,
			}).catch(() => null);
			if (!result?.success) {
				toast.error(result?.error ?? t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			toast.success(
				t("settings.billableTime.accounting.defaultTaxSaved", "Default tax treatment saved"),
			);
			onSaved();
		},
	});

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border bg-muted/30 p-4"
		>
			<form.Field name="taxTreatment" validators={{ onSubmit: ({ value }) => taxError(value) }}>
				{(field) => (
					<div className="space-y-2">
						<TaxTreatmentFields
							id={`${id}-tax`}
							value={field.state.value}
							onChange={field.handleChange}
							onBlur={field.handleBlur}
							hasError={fieldHasError(field)}
						/>
						<TFormMessage field={field} />
					</div>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<FormButtons
						isSubmitting={isSubmitting}
						onCancel={() => {
							form.reset();
							onCancel();
						}}
						label={t("common.save", "Save")}
					/>
				)}
			</form.Subscribe>
		</form>
	);
}

function ConnectForm({
	settings,
	replacing,
	onCancel,
	onConnected,
}: {
	settings: AccountingSettings;
	replacing: AccountingConnectionView | null;
	onCancel?: () => void;
	onConnected: () => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const hintFor = useProviderHint();
	const taxError = useTaxTreatmentError();
	const available = settings.providers.filter((provider) => provider.available);
	const firstKind =
		(replacing && available.some((provider) => provider.kind === replacing.providerKind)
			? replacing.providerKind
			: available[0]?.kind) ?? "";

	const form = useForm({
		defaultValues: {
			providerKind: firstKind as AccountingProviderKind | "",
			apiKey: "",
			taxTreatment: (replacing?.defaultTaxTreatment ?? DEFAULT_TAX_TREATMENT) as TaxTreatmentView,
			// sevdesk only: the drafts' contact person and the net price confirmation.
			contactPersonId: "",
			netPrices: false,
		},
		onSubmit: async ({ value }) => {
			const result: ServerActionResult<AccountingConnectionView> | null =
				await connectAccountingTool({
					providerKind: value.providerKind,
					apiKey: value.apiKey,
					defaultTaxTreatment: value.taxTreatment,
					settings:
						value.providerKind === "sevdesk"
							? {
									contactPersonId: value.contactPersonId || undefined,
									netPrices: value.netPrices,
								}
							: undefined,
				}).catch(() => null);
			if (!result?.success) {
				toast.error(result?.error ?? t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			form.reset();
			toast.success(
				replacing
					? t("settings.billableTime.accounting.replaced", "Accounting connection replaced")
					: t("settings.billableTime.accounting.connectedToast", "Accounting tool connected"),
			);
			onConnected();
		},
	});

	if (available.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.billableTime.accounting.noProviders",
					"No accounting tool can be connected in this installation yet.",
				)}
			</p>
		);
	}

	return (
		<form
			noValidate
			autoComplete="off"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
			className="space-y-4 rounded-lg border bg-muted/30 p-4"
		>
			{replacing && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.billableTime.accounting.replaceHelp",
						"The new connection replaces the current one and its key is deleted. Contact links stay when the new key belongs to the same account in the same tool.",
					)}
				</p>
			)}
			<form.Field
				name="providerKind"
				validators={{
					onSubmit: ({ value }) =>
						isAccountingProviderKind(value)
							? undefined
							: t("settings.billableTime.accounting.chooseTool", "Choose an accounting tool"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.billableTime.accounting.tool", "Tool")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) => {
								if (isAccountingProviderKind(value)) field.handleChange(value);
							}}
						>
							<TFormControl hasError={fieldHasError(field)}>
								<SelectTrigger className="w-full sm:w-72">
									<SelectValue />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								{settings.providers.map((provider) => (
									<SelectItem
										key={provider.kind}
										value={provider.kind}
										disabled={!provider.available}
									>
										{provider.available
											? accountingProviderName(provider.kind)
											: t(
													"settings.billableTime.accounting.toolUnavailable",
													"{tool} (not available yet)",
													{ tool: accountingProviderName(provider.kind) },
												)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<form.Subscribe selector={(state) => state.values.providerKind}>
							{(kind) =>
								isAccountingProviderKind(kind) && (
									<TFormDescription>{hintFor(kind)}</TFormDescription>
								)
							}
						</form.Subscribe>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Field
				name="apiKey"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t("settings.billableTime.accounting.apiKeyRequired", "Enter the API key"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.billableTime.accounting.apiKey", "API key")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								type="password"
								autoComplete="new-password"
								spellCheck={false}
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.billableTime.accounting.apiKeyHelp",
								"Stored in your organization's secret store. Z8 never shows it again.",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe
				selector={(state) => ({ kind: state.values.providerKind, apiKey: state.values.apiKey })}
			>
				{({ kind, apiKey }) =>
					kind === "sevdesk" && (
						<>
							<form.Field name="contactPersonId">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)}>
											{t("settings.billableTime.accounting.contactPerson.label", "Contact person")}
										</TFormLabel>
										<ContactPersonPicker
											id={`${id}-contact-person`}
											providerKind={kind}
											apiKey={apiKey}
											value={field.state.value}
											onChange={field.handleChange}
											hasError={fieldHasError(field)}
										/>
										<TFormDescription>
											{t(
												"settings.billableTime.accounting.contactPerson.help",
												"sevdesk names a user of your account as contact person on every invoice. Load the users with the API key above and choose one.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field
								name="netPrices"
								validators={{
									onSubmit: ({ value }) =>
										value
											? undefined
											: t(
													"settings.billableTime.accounting.netPrices.required",
													"Z8 hands off net prices. Confirm that sevdesk enters prices as net prices",
												),
								}}
							>
								{(field) => (
									<TFormItem>
										<div className="flex items-start gap-2">
											<Checkbox
												id={`${id}-net-prices`}
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
												aria-invalid={fieldHasError(field) || undefined}
											/>
											<label htmlFor={`${id}-net-prices`} className="text-sm leading-tight">
												{t(
													"settings.billableTime.accounting.netPrices.label",
													"This sevdesk account enters invoice prices as net prices",
												)}
											</label>
										</div>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</>
					)
				}
			</form.Subscribe>
			<form.Field name="taxTreatment" validators={{ onSubmit: ({ value }) => taxError(value) }}>
				{(field) => (
					<div className="space-y-2">
						<TaxTreatmentFields
							id={`${id}-tax`}
							value={field.state.value}
							onChange={field.handleChange}
							onBlur={field.handleBlur}
							hasError={fieldHasError(field)}
						/>
						<p className="text-xs text-muted-foreground">
							{t(
								"settings.billableTime.accounting.defaultTaxHelp",
								"The default for every customer's invoice drafts. A customer can override it.",
							)}
						</p>
						<TFormMessage field={field} />
					</div>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<FormButtons
						isSubmitting={isSubmitting}
						onCancel={
							onCancel &&
							(() => {
								form.reset();
								onCancel();
							})
						}
						label={
							replacing
								? t("settings.billableTime.accounting.replaceSubmit", "Replace connection")
								: t("settings.billableTime.accounting.connect", "Connect")
						}
					/>
				)}
			</form.Subscribe>
		</form>
	);
}

function FormButtons({
	isSubmitting,
	onCancel,
	label,
}: {
	isSubmitting: boolean;
	onCancel?: () => void;
	label: string;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex justify-end gap-2">
			{onCancel && (
				<Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
			)}
			<Button type="submit" disabled={isSubmitting}>
				{isSubmitting && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
				{label}
			</Button>
		</div>
	);
}
