"use client";

import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from "react";
import { searchAppRecordsAction } from "@/app/[locale]/(app)/search/actions";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { AppSearchResult, LiveAppSearchResults } from "@/lib/app-search/types";
import { useRouter } from "@/navigation";

const EMPTY_LIVE_RESULTS: LiveAppSearchResults = {
	employees: [],
	teams: [],
};

const SEARCH_HOTKEY = "Mod+K";

function getGroupLabel(type: AppSearchResult["type"]) {
	switch (type) {
		case "page":
			return "Pages";
		case "setting":
			return "Settings";
		case "employee":
			return "People";
		case "team":
			return "Teams";
	}
}

function getResultSearchValue(result: AppSearchResult) {
	return [
		result.type,
		result.id,
		result.title,
		result.subtitle ?? "",
		result.keywords?.join(" ") ?? "",
	].join(":");
}

function ResultGroup({
	label,
	results,
	onSelect,
}: {
	label: string;
	results: AppSearchResult[];
	onSelect: (result: AppSearchResult) => void;
}) {
	if (results.length === 0) {
		return null;
	}

	return (
		<CommandGroup heading={label}>
			{results.map((result) => (
				<CommandItem
					key={`${result.type}:${result.id}`}
					onSelect={() => onSelect(result)}
					value={getResultSearchValue(result)}
				>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="truncate font-medium">{result.title}</span>
						{result.subtitle ? (
							<span className="truncate text-muted-foreground text-xs">{result.subtitle}</span>
						) : null}
					</div>
				</CommandItem>
			))}
		</CommandGroup>
	);
}

export function AppSearch({ staticResults }: { staticResults: AppSearchResult[] }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [liveResults, setLiveResults] = useState<LiveAppSearchResults>(EMPTY_LIVE_RESULTS);
	const [liveError, setLiveError] = useState<string | null>(null);

	const searchShortcutLabel = formatForDisplay(SEARCH_HOTKEY);

	useHotkey(SEARCH_HOTKEY, () => setOpen((currentOpen) => !currentOpen), {
		preventDefault: true,
	});

	useEffect(() => {
		if (!(open && query.trim().length >= 2)) {
			setLiveResults(EMPTY_LIVE_RESULTS);
			setLiveError(null);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			searchAppRecordsAction(query.trim()).then((result) => {
				if (cancelled) {
					return;
				}

				if (result.success) {
					setLiveResults(result.data);
					setLiveError(null);
					return;
				}

				setLiveResults(EMPTY_LIVE_RESULTS);
				setLiveError(result.error);
			});
		}, 250);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [open, query]);

	const pageResults = staticResults.filter((result) => result.type === "page");
	const settingResults = staticResults.filter((result) => result.type === "setting");

	function handleSelect(result: AppSearchResult) {
		setOpen(false);
		setQuery("");
		router.push(result.href);
	}

	return (
		<>
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton onClick={() => setOpen(true)} tooltip="Search" type="button">
								<IconSearch />
								<span>Search</span>
								<Kbd className="ml-auto hidden bg-sidebar-accent text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden sm:inline-flex">
									{searchShortcutLabel}
								</Kbd>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
			<CommandDialog
				description="Search pages, settings, people, and teams"
				onOpenChange={setOpen}
				open={open}
				title="Search"
			>
				<CommandInput
					aria-label="Search pages, settings, people, and teams"
					onValueChange={setQuery}
					placeholder="Search pages, settings, people, and teams…"
					value={query}
				/>
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<ResultGroup
						label={getGroupLabel("employee")}
						onSelect={handleSelect}
						results={liveResults.employees}
					/>
					<ResultGroup
						label={getGroupLabel("team")}
						onSelect={handleSelect}
						results={liveResults.teams}
					/>
					<ResultGroup
						label={getGroupLabel("page")}
						onSelect={handleSelect}
						results={pageResults}
					/>
					<ResultGroup
						label={getGroupLabel("setting")}
						onSelect={handleSelect}
						results={settingResults}
					/>
					{liveError ? (
						<p aria-live="polite" className="px-3 py-2 text-destructive text-sm">
							{liveError}
						</p>
					) : null}
				</CommandList>
			</CommandDialog>
		</>
	);
}
