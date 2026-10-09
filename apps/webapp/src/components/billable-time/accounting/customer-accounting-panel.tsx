"use client";

import { IconLink, IconLinkOff, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	type CustomerAccountingDetail,
	getCustomerAccounting,
	linkCustomerContact,
	setCustomerTaxTreatment,
	unlinkCustomerContact,
} from "@/app/[locale]/(app)/settings/billable-time/accounting/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { accountingProviderName } from "@/lib/billable-time/accounting/views";
import type { ServerActionResult } from "@/lib/effect/result";
import { queryKeys } from "@/lib/query/keys";
import { Link } from "@/navigation";
import { ContactPicker } from "./contact-picker";
import {
	TaxTreatmentFields,
	useTaxTreatmentError,
	useTaxTreatmentSummary,
} from "./tax-treatment-fields";

/**
 * A customer's accounting side (#903): its contact link to an existing contact
 * in the accounting tool and its tax treatment override. Owners and admins
 * only; every action authorizes again.
 */
export function CustomerAccountingEditor({
	customerId,
	onChanged,
}: {
	customerId: string;
	onChanged?: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.billableTime.customerAccounting(customerId);
	const [picking, setPicking] = useState(false);
	const [pending, setPending] = useState(false);

	const detail = useQuery({
		queryKey,
		queryFn: async (): Promise<CustomerAccountingDetail> => {
			const result = await getCustomerAccounting({ customerId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const apply = async (
		change: Promise<ServerActionResult<CustomerAccountingDetail>>,
		successMessage: string,
	): Promise<boolean> => {
		setPending(true);
		const result = await change.catch(() => null);
		setPending(false);
		if (!result) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			return false;
		}
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		queryClient.setQueryData(queryKey, result.data);
		toast.success(successMessage);
		onChanged?.();
		return true;
	};

	if (detail.isPending) {
		return (
			<div className="flex justify-center p-4">
				<IconLoader2
					aria-label={t("common.loading", "Loading")}
					className="size-6 animate-spin text-muted-foreground"
				/>
			</div>
		);
	}
	if (detail.isError) {
		return (
			<p className="text-sm text-destructive" role="alert">
				{detail.error.message}
			</p>
		);
	}

	const { customer, connection } = detail.data;
	const link = customer.contactLink;

	return (
		<div className="space-y-6">
			<section className="space-y-3">
				<h3 className="font-semibold">
					{t(
						"settings.billableTime.accounting.customer.contactLink",
						"Contact in the accounting tool",
					)}
				</h3>
				{connection === null ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.billableTime.accounting.customer.notConnected",
							"Connect an accounting tool in the Billable Time settings first.",
						)}{" "}
						<Link href="/settings/billable-time/accounting" className="text-primary underline">
							{t(
								"settings.billableTime.accounting.customer.openSettings",
								"Open accounting settings",
							)}
						</Link>
					</p>
				) : (
					<>
						{link ? (
							<div className="rounded-md border p-3 text-sm">
								<div className="font-medium">{link.contactName}</div>
								<div className="text-xs text-muted-foreground">
									{link.contactNumber
										? t(
												"settings.billableTime.accounting.customer.linkedInWithNumber",
												"Customer no. {number} in {tool}",
												{
													number: link.contactNumber,
													tool: accountingProviderName(connection.providerKind),
												},
											)
										: t("settings.billableTime.accounting.customer.linkedIn", "In {tool}", {
												tool: accountingProviderName(connection.providerKind),
											})}
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.billableTime.accounting.customer.notLinked",
									"Not linked. A customer needs a contact link before its first hand-off.",
								)}
							</p>
						)}
						<div className="flex flex-wrap gap-2">
							<Button size="sm" variant="outline" onClick={() => setPicking((open) => !open)}>
								<IconLink aria-hidden="true" className="mr-2 size-4" />
								{link
									? t("settings.billableTime.accounting.customer.changeContact", "Change contact")
									: t("settings.billableTime.accounting.customer.linkContact", "Link contact")}
							</Button>
							{link && (
								<Button
									size="sm"
									variant="ghost"
									disabled={pending}
									onClick={() =>
										void apply(
											unlinkCustomerContact({ customerId }),
											t(
												"settings.billableTime.accounting.customer.unlinked",
												"Contact link removed",
											),
										)
									}
								>
									<IconLinkOff aria-hidden="true" className="mr-2 size-4" />
									{t("settings.billableTime.accounting.customer.unlink", "Remove link")}
								</Button>
							)}
						</div>
						{picking && (
							<ContactPicker
								minLength={connection.capabilities?.contactSearchMinLength ?? 1}
								currentContactId={link?.contactId ?? null}
								pending={pending}
								onPick={(contact) =>
									void apply(
										linkCustomerContact({ customerId, contactId: contact.id }),
										t("settings.billableTime.accounting.customer.linked", "Contact linked"),
									).then((ok) => {
										if (ok) setPicking(false);
									})
								}
							/>
						)}
					</>
				)}
			</section>

			<Separator />

			<CustomerTaxTreatmentSection
				detail={detail.data}
				pending={pending}
				onSave={(taxTreatment) =>
					apply(
						setCustomerTaxTreatment({ customerId, taxTreatment }),
						taxTreatment
							? t("settings.billableTime.accounting.customer.taxSaved", "Tax treatment saved")
							: t(
									"settings.billableTime.accounting.customer.taxCleared",
									"The connection's default tax treatment applies again",
								),
					)
				}
			/>
		</div>
	);
}

function CustomerTaxTreatmentSection({
	detail,
	pending,
	onSave,
}: {
	detail: CustomerAccountingDetail;
	pending: boolean;
	onSave: (taxTreatment: CustomerAccountingDetail["customer"]["taxOverride"]) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const id = useId();
	const summary = useTaxTreatmentSummary();
	const taxError = useTaxTreatmentError();
	const { customer, connection } = detail;
	const [editing, setEditing] = useState(false);
	const fallback = connection?.defaultTaxTreatment ?? null;

	const form = useForm({
		defaultValues: {
			taxTreatment: customer.taxOverride ??
				fallback ?? { kind: "domestic_standard" as const, rate: "19" },
		},
		onSubmit: async ({ value }) => {
			if (await onSave(value.taxTreatment)) setEditing(false);
		},
	});

	return (
		<section className="space-y-3">
			<h3 className="font-semibold">
				{t("settings.billableTime.accounting.customer.taxTreatment", "Tax treatment")}
			</h3>
			<p className="text-sm">
				{customer.taxOverride
					? t(
							"settings.billableTime.accounting.customer.taxOverride",
							"{treatment} (customer's own)",
							{
								treatment: summary(customer.taxOverride),
							},
						)
					: fallback
						? t(
								"settings.billableTime.accounting.customer.taxDefault",
								"{treatment} (connection default)",
								{ treatment: summary(fallback) },
							)
						: t(
								"settings.billableTime.accounting.customer.taxNoDefault",
								"The connection's default applies once an accounting tool is connected.",
							)}
			</p>
			{!editing ? (
				<div className="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
						{t("settings.billableTime.accounting.customer.overrideTax", "Set customer's own")}
					</Button>
					{customer.taxOverride && (
						<Button size="sm" variant="ghost" disabled={pending} onClick={() => void onSave(null)}>
							{t("settings.billableTime.accounting.customer.useDefault", "Use connection default")}
						</Button>
					)}
				</div>
			) : (
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
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.billableTime.accounting.customer.taxHelp",
							"Used for this customer's invoice drafts. The accountant checks it on each draft.",
						)}
					</p>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									disabled={isSubmitting}
									onClick={() => {
										setEditing(false);
										form.reset();
									}}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									)}
									{t("common.save", "Save")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
			)}
		</section>
	);
}

/** A side panel with one customer's accounting side, for contextual entry points. */
export function CustomerAccountingPanel({
	open,
	onOpenChange,
	customerId,
	customerName,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	customerId: string | null;
	customerName: string;
	onChanged?: () => void;
}) {
	const { t } = useTranslate();
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.billableTime.accounting.customer.title", "Accounting for {name}", {
							name: customerName,
						})}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.billableTime.accounting.customer.description",
							"The contact this customer's invoice drafts go to, and how they are taxed.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody>
					{open && customerId && (
						<CustomerAccountingEditor customerId={customerId} onChanged={onChanged} />
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
