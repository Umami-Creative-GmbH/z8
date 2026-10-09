"use client";

import { IconLoader2, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { listAccountingContactPersons } from "@/app/[locale]/(app)/settings/billable-time/accounting/actions";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	AccountingContactPerson,
	AccountingProviderKind,
} from "@/lib/billable-time/accounting/provider";

/**
 * Loads the users of the tool account behind the entered API key and lets the
 * admin pick the contact person named on every invoice draft (sevdesk, #905).
 * The key is sent for this one lookup and not stored. With a single user the
 * choice is made automatically.
 */
export function ContactPersonPicker({
	id,
	providerKind,
	apiKey,
	value,
	onChange,
	hasError,
}: {
	id: string;
	providerKind: AccountingProviderKind;
	apiKey: string;
	value: string;
	onChange: (contactPersonId: string) => void;
	hasError?: boolean;
}) {
	const { t } = useTranslate();
	const [persons, setPersons] = useState<AccountingContactPerson[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		setLoading(true);
		setError(null);
		const result = await listAccountingContactPersons({ providerKind, apiKey }).catch(() => null);
		setLoading(false);
		if (!result?.success) {
			setPersons(null);
			setError(result?.error ?? t("common.unexpectedError", "An unexpected error occurred"));
			return;
		}
		setPersons(result.data);
		if (result.data.length === 1) onChange(result.data[0].id);
		else if (!result.data.some((person) => person.id === value)) onChange("");
	};

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={loading || apiKey.trim() === ""}
					onClick={() => void load()}
				>
					{loading ? (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
					) : (
						<IconUsers aria-hidden="true" className="mr-2 size-4" />
					)}
					{t("settings.billableTime.accounting.contactPerson.load", "Load sevdesk users")}
				</Button>
				{persons && persons.length > 0 && (
					<Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
						<SelectTrigger id={id} className="w-full sm:w-72" aria-invalid={hasError || undefined}>
							<SelectValue
								placeholder={t(
									"settings.billableTime.accounting.contactPerson.placeholder",
									"Choose a sevdesk user",
								)}
							/>
						</SelectTrigger>
						<SelectContent>
							{persons.map((person) => (
								<SelectItem key={person.id} value={person.id}>
									{person.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>
			{persons && persons.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.billableTime.accounting.contactPerson.none",
						"This account has no active sevdesk users.",
					)}
				</p>
			)}
			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
