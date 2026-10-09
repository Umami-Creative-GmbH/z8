"use client";

import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useState } from "react";
import {
	type ContactSearchView,
	searchContacts,
} from "@/app/[locale]/(app)/settings/billable-time/accounting/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountingContact } from "@/lib/billable-time/accounting/provider";
import { queryKeys } from "@/lib/query/keys";

const SEARCH_DELAY_MS = 300;

function useDebounced(value: string, delayMs: number): string {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

/**
 * Searches the connected accounting tool's existing contacts and picks one.
 * Z8 never creates contacts in the tool (ADR 0002), so there is no "create".
 */
export function ContactPicker({
	minLength,
	currentContactId,
	pending,
	onPick,
}: {
	/** The provider's shortest accepted query. */
	minLength: number;
	currentContactId: string | null;
	/** A pick is being saved. */
	pending: boolean;
	onPick: (contact: AccountingContact) => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const [query, setQuery] = useState("");
	const debounced = useDebounced(query.trim(), SEARCH_DELAY_MS);
	const enabled = debounced.length >= minLength;

	const search = useQuery({
		queryKey: queryKeys.billableTime.contactSearch(debounced),
		enabled,
		staleTime: 30_000,
		queryFn: async (): Promise<ContactSearchView> => {
			const result = await searchContacts({ query: debounced });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	return (
		<div className="space-y-3">
			<div className="space-y-2">
				<Label htmlFor={`${id}-query`}>
					{t("settings.billableTime.accounting.contacts.search", "Search contacts in the tool")}
				</Label>
				<div className="relative">
					<IconSearch
						aria-hidden="true"
						className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id={`${id}-query`}
						value={query}
						autoComplete="off"
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t(
							"settings.billableTime.accounting.contacts.searchPlaceholder",
							"Name or customer number",
						)}
						className="pl-9"
					/>
				</div>
				{!enabled && (
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.billableTime.accounting.contacts.minLength",
							"Enter at least {count} characters",
							{ count: minLength },
						)}
					</p>
				)}
			</div>

			{enabled && search.isPending && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					{t("settings.billableTime.accounting.contacts.searching", "Searching…")}
				</div>
			)}
			{enabled && search.isError && (
				<p className="text-sm text-destructive" role="alert">
					{search.error.message}
				</p>
			)}
			{enabled && search.isSuccess && search.data.contacts.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.billableTime.accounting.contacts.noResults",
						"No contact matches. Create the contact in the accounting tool first; Z8 never creates contacts there.",
					)}
				</p>
			)}
			{enabled && search.isSuccess && search.data.contacts.length > 0 && (
				<ul className="divide-y rounded-md border">
					{search.data.contacts.map((contact) => (
						<li key={contact.id} className="flex items-start justify-between gap-3 p-3">
							<div className="min-w-0 space-y-0.5 text-sm">
								<div className="font-medium">{contact.name}</div>
								<div className="text-xs text-muted-foreground">
									{[
										contact.customerNumber &&
											t(
												"settings.billableTime.accounting.contacts.customerNumber",
												"Customer no. {number}",
												{ number: contact.customerNumber },
											),
										contact.vatId,
									]
										.filter(Boolean)
										.join(" · ")}
								</div>
								{contact.address && (
									<div className="whitespace-pre-line text-xs text-muted-foreground">
										{contact.address}
									</div>
								)}
							</div>
							<Button
								size="sm"
								variant={contact.id === currentContactId ? "secondary" : "outline"}
								disabled={pending || contact.id === currentContactId}
								onClick={() => onPick(contact)}
							>
								{contact.id === currentContactId
									? t("settings.billableTime.accounting.contacts.linked", "Linked")
									: t("settings.billableTime.accounting.contacts.link", "Link")}
							</Button>
						</li>
					))}
				</ul>
			)}
			{enabled && search.isSuccess && search.data.truncated && (
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.billableTime.accounting.contacts.truncated",
						"More contacts match. Narrow the search to see them.",
					)}
				</p>
			)}
		</div>
	);
}
