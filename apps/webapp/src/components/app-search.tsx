"use client";

import {
	IconBeach,
	IconCalendar,
	IconClipboardCheck,
	IconClock,
	IconDashboard,
	IconFileDescription,
	IconHierarchy,
	IconReceipt,
	IconReport,
	IconSearch,
	IconSettings,
	IconShieldCheck,
	IconUsers,
} from "@tabler/icons-react";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { useTranslate } from "@tolgee/react";
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
import { UserAvatar } from "@/components/user-avatar";
import type { AppSearchResult, LiveAppSearchResults } from "@/lib/app-search/types";
import { useRouter } from "@/navigation";

const EMPTY_LIVE_RESULTS: LiveAppSearchResults = {
	employees: [],
	teams: [],
};

const SEARCH_HOTKEY = "Mod+K";

const EMPTY_STATIC_COMMANDS: AppSearchResult[] = [];

type SearchIcon = typeof IconSearch;

const RESULT_ICON_BY_HREF: Record<string, SearchIcon> = {
	"/": IconDashboard,
	"/absences": IconBeach,
	"/approvals/inbox": IconClipboardCheck,
	"/calendar": IconCalendar,
	"/compliance": IconShieldCheck,
	"/my-requests": IconFileDescription,
	"/organization": IconHierarchy,
	"/reports": IconReport,
	"/settings": IconSettings,
	"/settings/employees": IconUsers,
	"/settings/organizations": IconHierarchy,
	"/settings/payroll-readiness": IconReceipt,
	"/settings/projects": IconFileDescription,
	"/settings/security": IconShieldCheck,
	"/settings/teams": IconUsers,
	"/team": IconUsers,
	"/team/absences": IconBeach,
	"/time-tracking": IconClock,
	"/travel-expenses": IconReceipt,
};

function getResultIcon(result: AppSearchResult): SearchIcon {
	return (
		RESULT_ICON_BY_HREF[result.href] ??
		(result.type === "setting" ? IconSettings : IconFileDescription)
	);
}

function getGroupLabel(type: AppSearchResult["type"], t: ReturnType<typeof useTranslate>["t"]) {
	switch (type) {
		case "action":
			return t("appSearch.groups.actions", "Actions");
		case "page":
			return t("appSearch.groups.pages", "Pages");
		case "setting":
			return t("appSearch.groups.settings", "Settings");
		case "employee":
			return t("appSearch.groups.people", "People");
		case "team":
			return t("appSearch.groups.teams", "Teams");
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
			{results.map((result) => {
				const ResultIcon = getResultIcon(result);

				return (
					<CommandItem
						className="gap-3"
						key={`${result.type}:${result.id}`}
						onSelect={() => onSelect(result)}
						value={getResultSearchValue(result)}
					>
						{result.type === "employee" ? (
							<UserAvatar
								image={result.image}
								seed={result.avatarSeed ?? result.id}
								name={result.title}
								size="sm"
								showClockStatus={false}
							/>
						) : (
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
								<ResultIcon
									aria-hidden="true"
									data-testid={`app-search-icon-${result.id}`}
									className="size-4"
								/>
							</span>
						)}
						<div className="flex min-w-0 flex-col gap-0.5">
							<span className="truncate font-medium">{result.title}</span>
							{result.subtitle ? (
								<span className="truncate text-muted-foreground text-xs">{result.subtitle}</span>
							) : null}
						</div>
					</CommandItem>
				);
			})}
		</CommandGroup>
	);
}

export function AppSearch({
	staticCommands = EMPTY_STATIC_COMMANDS,
	staticResults,
}: {
	staticCommands?: AppSearchResult[];
	staticResults: AppSearchResult[];
}) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [liveResults, setLiveResults] = useState<LiveAppSearchResults>(EMPTY_LIVE_RESULTS);
	const [liveError, setLiveError] = useState<string | null>(null);
	const trimmedQuery = query.trim();
	const shouldSearchLiveRecords = open && trimmedQuery.length >= 2;
	const visibleLiveResults = shouldSearchLiveRecords ? liveResults : EMPTY_LIVE_RESULTS;
	const visibleLiveError = shouldSearchLiveRecords ? liveError : null;

	const searchShortcutLabel = formatForDisplay(SEARCH_HOTKEY);

	useHotkey(SEARCH_HOTKEY, () => setOpen((currentOpen) => !currentOpen), {
		preventDefault: true,
	});

	useEffect(() => {
		if (!shouldSearchLiveRecords) {
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(() => {
			searchAppRecordsAction(trimmedQuery).then((result) => {
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
	}, [shouldSearchLiveRecords, trimmedQuery]);

	const actionResults = staticCommands.filter((result) => result.type === "action");
	const pageResults = staticResults.filter((result) => result.type === "page");
	const settingResults = staticResults.filter((result) => result.type === "setting");
	const searchLabel = t("appSearch.search", "Search");
	const searchOrRunCommandLabel = t("appSearch.searchOrRunCommand", "Search or run command");

	function handleSelect(result: AppSearchResult) {
		setOpen(false);
		setQuery("");
		push(result.href);
	}

	function handleQueryChange(nextQuery: string) {
		setQuery(nextQuery);
		if (nextQuery.trim().length < 2) {
			setLiveResults(EMPTY_LIVE_RESULTS);
			setLiveError(null);
		}
	}

	return (
		<>
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								className="h-9 justify-start rounded-lg border border-input bg-card px-3 text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
								onClick={() => setOpen(true)}
								tooltip={searchOrRunCommandLabel}
								type="button"
							>
								<IconSearch aria-hidden="true" className="text-muted-foreground" />
								<span className="font-normal text-sm">{searchLabel}</span>
								<Kbd
									aria-hidden="true"
									className="ml-auto hidden bg-muted text-muted-foreground group-data-[collapsible=icon]:hidden sm:inline-flex"
								>
									{searchShortcutLabel}
								</Kbd>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
			<CommandDialog
				description={t(
					"appSearch.commandDescription",
					"Search pages, people, teams, settings, or actions",
				)}
				onOpenChange={setOpen}
				open={open}
				title={searchOrRunCommandLabel}
			>
				<CommandInput
					aria-label={t(
						"appSearch.commandDescription",
						"Search pages, people, teams, settings, or actions",
					)}
					onValueChange={handleQueryChange}
					placeholder={t(
						"appSearch.commandPlaceholder",
						"Search pages, people, teams, settings, or actions…",
					)}
					value={query}
				/>
				<CommandList>
					<CommandEmpty>{t("appSearch.empty", "No results found.")}</CommandEmpty>
					<ResultGroup
						label={getGroupLabel("action", t)}
						onSelect={handleSelect}
						results={actionResults}
					/>
					<ResultGroup
						label={getGroupLabel("employee", t)}
						onSelect={handleSelect}
						results={visibleLiveResults.employees}
					/>
					<ResultGroup
						label={getGroupLabel("team", t)}
						onSelect={handleSelect}
						results={visibleLiveResults.teams}
					/>
					<ResultGroup
						label={getGroupLabel("page", t)}
						onSelect={handleSelect}
						results={pageResults}
					/>
					<ResultGroup
						label={getGroupLabel("setting", t)}
						onSelect={handleSelect}
						results={settingResults}
					/>
					{visibleLiveError ? (
						<p aria-live="polite" className="px-3 py-2 text-destructive text-sm">
							{visibleLiveError}
						</p>
					) : null}
				</CommandList>
			</CommandDialog>
		</>
	);
}
