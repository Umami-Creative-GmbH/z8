"use client";

import { IconCheck, IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { searchOrgEmployees } from "./actions";
import { personDisplayName } from "./org-explorer-person-name";
import type {
	OrgExplorerSearchResult,
	OrgExplorerTeam,
} from "./org-explorer-types";
import type { OrgExplorerView } from "./org-explorer-url";

export function ViewSwitch({
	view,
	onChange,
}: {
	view: OrgExplorerView;
	onChange: (view: OrgExplorerView) => void;
}) {
	const { t } = useTranslate();

	return (
		<ToggleGroup
			aria-label={t("organization.explorer.views", "Views")}
			onValueChange={(value) => {
				if (value === "reporting-lines" || value === "teams") onChange(value);
			}}
			type="single"
			value={view}
			variant="outline"
		>
			<ToggleGroupItem value="reporting-lines">
				{t("organization.explorer.reportingLines", "Reporting lines")}
			</ToggleGroupItem>
			<ToggleGroupItem value="teams">
				{t("organization.explorer.teams", "Teams")}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}

/** A multi-select of teams. */
export function TeamFilter({
	teams,
	selectedIds,
	onChange,
}: {
	teams: OrgExplorerTeam[];
	selectedIds: string[];
	onChange: (teamIds: string[]) => void;
}) {
	const { t } = useTranslate();
	const selected = new Set(selectedIds);

	return (
		<div className="flex items-center gap-1">
			<Popover>
				<PopoverTrigger asChild>
					<Button className="gap-2" type="button" variant="outline">
						<IconFilter aria-hidden="true" className="size-4" />
						{t("organization.explorer.filterByTeam", "Filter by team")}
						{selected.size > 0 ? (
							<Badge
								className="h-5 min-w-5 justify-center px-1.5"
								variant="secondary"
							>
								{selected.size}
							</Badge>
						) : null}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-72 p-0">
					<Command>
						<CommandInput
							placeholder={t(
								"organization.explorer.searchTeams",
								"Search teams…",
							)}
						/>
						<CommandList>
							<CommandEmpty>
								{t("organization.explorer.noTeamsFound", "No teams found")}
							</CommandEmpty>
							<CommandGroup>
								{teams.map((team) => {
									const isSelected = selected.has(team.teamId);
									return (
										<CommandItem
											data-checked={isSelected}
											key={team.teamId}
											onSelect={() =>
												onChange(
													isSelected
														? selectedIds.filter((id) => id !== team.teamId)
														: [...selectedIds, team.teamId],
												)
											}
											value={`${team.name} ${team.teamId}`}
										>
											<IconCheck
												aria-hidden="true"
												className={cn(
													"size-4",
													isSelected ? "opacity-100" : "opacity-0",
												)}
											/>
											<span className="truncate">{team.name}</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{selected.size > 0 ? (
				<Button
					aria-label={t("organization.explorer.clearFilter", "Clear filter")}
					onClick={() => onChange([])}
					size="icon"
					type="button"
					variant="ghost"
				>
					<IconX aria-hidden="true" className="size-4" />
				</Button>
			) : null}
		</div>
	);
}

/** Searches the current roster by name, email or position. */
export function EmployeeSearch({
	onSelect,
}: {
	onSelect: (employeeId: string) => void;
}) {
	const { t } = useTranslate();
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<OrgExplorerSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const requestSequence = useRef(0);

	async function handleChange(value: string) {
		setQuery(value);
		const trimmed = value.trim();
		const sequence = requestSequence.current + 1;
		requestSequence.current = sequence;
		if (trimmed.length < 2) {
			setResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);
		const result = await searchOrgEmployees(trimmed);
		if (sequence !== requestSequence.current) return;
		setIsSearching(false);

		if (!result.success) {
			toast.error(
				result.error ||
					t(
						"organization.orgChart.searchFailed",
						"Could not search employees.",
					),
			);
			setResults([]);
			return;
		}
		setResults(result.data);
	}

	function choose(employeeId: string) {
		requestSequence.current += 1;
		setQuery("");
		setResults([]);
		setIsSearching(false);
		onSelect(employeeId);
	}

	return (
		<div className="relative w-full md:max-w-xs">
			<IconSearch
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				aria-label={t("organization.orgChart.searchLabel", "Search employees")}
				autoComplete="off"
				className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
				name="org-explorer-employee-search"
				onChange={(event) => {
					void handleChange(event.target.value);
				}}
				placeholder={t(
					"organization.orgChart.searchPlaceholder",
					"Search employees…",
				)}
				value={query}
			/>
			{query.trim().length >= 2 ? (
				<div className="absolute right-0 left-0 z-20 mt-2 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
					{isSearching ? (
						<p
							className="px-3 py-2 text-sm text-muted-foreground"
							role="status"
						>
							{t("organization.orgChart.searching", "Searching…")}
						</p>
					) : null}
					{results.map((result) => {
						const displayName = personDisplayName(result);
						return (
							<button
								aria-label={`${displayName} ${result.email}`}
								className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
								key={result.employeeId}
								onClick={() => choose(result.employeeId)}
								type="button"
							>
								<UserAvatar
									className="border border-border bg-primary/10"
									clockStatus="unknown"
									image={result.image}
									name={result.name}
									seed={result.employeeId}
									size="sm"
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate font-medium">{displayName}</span>
									<span className="truncate text-muted-foreground">
										{result.email}
									</span>
								</span>
							</button>
						);
					})}
					{!isSearching && results.length === 0 ? (
						<p className="px-3 py-2 text-sm text-muted-foreground">
							{t("organization.orgChart.noSearchResults", "No employees found")}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
