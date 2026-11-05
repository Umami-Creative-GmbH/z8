"use client";

import { IconSearch } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { getEntriesByGroup, type SettingsEntry, type SettingsGroupConfig } from "./settings-config";

export function SettingsSearch({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="relative">
			<IconSearch
				className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				name="settingsSearch"
				autoComplete="off"
				className="pl-9"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-label={t("settings.search.label", "Search settings")}
				placeholder={t("settings.search.placeholder", "Search settings…")}
			/>
		</div>
	);
}

export function useSettingsSearch(settings: SettingsEntry[], groups: SettingsGroupConfig[]) {
	const { t } = useTranslate();
	const [query, setQuery] = useState("");
	const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
	const matchingGroups = groups.flatMap((group) => {
		const entries = getEntriesByGroup(settings, group.id).filter((entry) => {
			const searchableText = normalizeSearch(
				[
					t(entry.titleKey, entry.titleDefault),
					t(entry.descriptionKey, entry.descriptionDefault),
					t(group.labelKey, group.labelDefault),
					entry.titleDefault,
					entry.descriptionDefault,
					entry.href,
				].join(" "),
			);
			return terms.every((term) => searchableText.includes(term));
		});
		return entries.length > 0 ? [{ ...group, entries }] : [];
	});
	return { query, setQuery, matchingGroups };
}

function normalizeSearch(value: string) {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}
