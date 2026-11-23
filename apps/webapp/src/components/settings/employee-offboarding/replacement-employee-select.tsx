"use client";

import { IconCheck, IconChevronDown, IconLoader2, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
	getReplacementEmployeeAction,
	searchReplacementEmployeesAction,
} from "@/app/[locale]/(app)/settings/employees/employee-offboarding.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReplacementEmployeeOption } from "@/lib/employee-lifecycle/view-types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

export type ReplacementEmployeeSelectProps = {
	/** Employee being offboarded; excluded from replacement results. */
	excludeEmployeeId: string;
	/** Currently selected replacement employee ID, or null for no replacement. */
	value: string | null;
	onChange: (employeeId: string | null) => void;
	/** Allow clearing selection to "No replacement" (default true). */
	allowNone?: boolean;
	noneLabel?: string;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
	id?: string;
	"aria-labelledby"?: string;
	onBlur?: () => void;
};

/**
 * Scalable, cursor-paginated searchable single-select for choosing an eligible
 * approval replacement employee in large (10,000+) organizations.
 *
 * Always queries the server via `searchReplacementEmployeesAction` (bounded to
 * 20 items per page with opaque keyset cursor pagination) rather than loading
 * the full organization roster into memory.
 */
export function ReplacementEmployeeSelect({
	excludeEmployeeId,
	value,
	onChange,
	allowNone = true,
	noneLabel,
	placeholder,
	disabled = false,
	className,
	id,
	"aria-labelledby": ariaLabelledBy,
	onBlur,
}: ReplacementEmployeeSelectProps) {
	const { t } = useTranslate();
	const listboxId = useId();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [items, setItems] = useState<ReplacementEmployeeOption[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loadedKey, setLoadedKey] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [selectedOption, setSelectedOption] = useState<ReplacementEmployeeOption | null>(null);
	const requestCounter = useRef(0);

	const activeQueryKey = `${excludeEmployeeId}::${debouncedSearch}`;
	const isLoading = open && loadedKey !== activeQueryKey;

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search.trim());
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [search]);

	const matchedSelected = useMemo(() => {
		if (!value) return null;
		if (selectedOption?.employeeId === value) return selectedOption;
		return items.find((item) => item.employeeId === value) ?? null;
	}, [value, selectedOption, items]);

	// Resolve label for an already-selected value without loading the org roster
	useEffect(() => {
		if (!value || matchedSelected) return;
		let cancelled = false;
		void getReplacementEmployeeAction({ employeeId: value }).then((result) => {
			if (!cancelled && result.success && result.data) {
				setSelectedOption(result.data);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [value, matchedSelected]);

	// Fetch first page whenever the popover opens or the debounced search query changes
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const seq = ++requestCounter.current;
		const queryKey = activeQueryKey;
		void searchReplacementEmployeesAction({
			excludeEmployeeId,
			search: debouncedSearch || null,
			cursor: null,
			limit: PAGE_SIZE,
		}).then((result) => {
			if (cancelled || seq !== requestCounter.current) return;
			if (result.success) {
				setItems(result.data.items);
				setNextCursor(result.data.nextCursor);
				setHasMore(result.data.hasMore);
			}
			setLoadedKey(queryKey);
		});
		return () => {
			cancelled = true;
		};
	}, [open, excludeEmployeeId, debouncedSearch, activeQueryKey]);

	const loadMore = useCallback(async () => {
		if (!nextCursor || isLoadingMore) return;
		const seq = ++requestCounter.current;
		setIsLoadingMore(true);
		// Promise.finally instead of try/finally: React Compiler cannot compile a finalizer.
		const result = await searchReplacementEmployeesAction({
			excludeEmployeeId,
			search: debouncedSearch || null,
			cursor: nextCursor,
			limit: PAGE_SIZE,
		}).finally(() => {
			if (seq === requestCounter.current) {
				setIsLoadingMore(false);
			}
		});
		if (seq !== requestCounter.current) return;
		if (result.success) {
			setItems((prev) => [...prev, ...result.data.items]);
			setNextCursor(result.data.nextCursor);
			setHasMore(result.data.hasMore);
		}
	}, [excludeEmployeeId, debouncedSearch, nextCursor, isLoadingMore]);

	const resolvedNoneLabel =
		noneLabel ?? t("settings.employees.offboarding.noReplacement", "No replacement");
	const resolvedPlaceholder =
		placeholder ??
		(allowNone
			? resolvedNoneLabel
			: t("settings.employees.offboarding.chooseReplacement", "Choose a replacement"));

	const triggerLabel = useMemo(() => {
		if (!value) return resolvedPlaceholder;
		return matchedSelected?.name ?? value;
	}, [value, matchedSelected, resolvedPlaceholder]);

	const handleSelect = (option: ReplacementEmployeeOption | null) => {
		setSelectedOption(option);
		onChange(option?.employeeId ?? null);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-labelledby={ariaLabelledBy}
					disabled={disabled}
					onBlur={onBlur}
					className={cn(
						"w-full justify-between font-normal",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<span className="truncate">{triggerLabel}</span>
					<IconChevronDown className="ml-2 size-4 shrink-0 opacity-60" aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80 p-2" align="start">
				<div className="space-y-2">
					<div className="relative">
						<IconSearch
							className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t(
								"settings.employees.offboarding.searchReplacementPlaceholder",
								"Search managers and admins…",
							)}
							aria-label={t(
								"settings.employees.offboarding.searchReplacementLabel",
								"Search replacement employees",
							)}
							className="h-8 pr-7 pl-8 text-sm"
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								aria-label={t("settings.employees.offboarding.clearSearch", "Clear search")}
								className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							>
								<IconX className="size-3.5" aria-hidden="true" />
							</button>
						)}
					</div>

					<div
						id={listboxId}
						role="listbox"
						aria-label={t(
							"settings.employees.offboarding.replacement",
							"Replacement for approvals",
						)}
						className="max-h-60 space-y-0.5 overflow-y-auto"
					>
						{allowNone && (
							<button
								type="button"
								role="option"
								aria-selected={value === null}
								onClick={() => handleSelect(null)}
								className={cn(
									"flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
									value === null && "bg-accent font-medium",
								)}
							>
								<span>{resolvedNoneLabel}</span>
								{value === null && <IconCheck className="size-4 shrink-0" aria-hidden="true" />}
							</button>
						)}

						{isLoading ? (
							<div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
								<span>
									{t("settings.employees.offboarding.searchingReplacements", "Searching…")}
								</span>
							</div>
						) : items.length === 0 ? (
							<p className="px-2 py-4 text-center text-muted-foreground text-sm">
								{t(
									"settings.employees.offboarding.noMatchingReplacements",
									"No eligible replacements found.",
								)}
							</p>
						) : (
							items.map((option) => {
								const isSelected = value === option.employeeId;
								return (
									<button
										key={option.employeeId}
										type="button"
										role="option"
										aria-selected={isSelected}
										onClick={() => handleSelect(option)}
										className={cn(
											"flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
											isSelected && "bg-accent font-medium",
										)}
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate">{option.name}</span>
											{(option.position || option.teamName || option.email) && (
												<span className="block truncate text-muted-foreground text-xs">
													{[option.position, option.teamName].filter(Boolean).join(" · ") ||
														option.email}
												</span>
											)}
										</span>
										{isSelected && <IconCheck className="size-4 shrink-0" aria-hidden="true" />}
									</button>
								);
							})
						)}
					</div>

					{hasMore && nextCursor && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-full"
							disabled={isLoadingMore}
							onClick={() => void loadMore()}
						>
							{isLoadingMore && (
								<IconLoader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
							)}
							{t("settings.employees.offboarding.loadMoreReplacements", "Load more")}
						</Button>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
