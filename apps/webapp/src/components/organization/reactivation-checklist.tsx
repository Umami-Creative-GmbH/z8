"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconChecklist,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { toast } from "sonner";
import {
	dismissReactivationChecklistAction,
	getReactivationChecklistAction,
} from "@/app/[locale]/(app)/settings/employees/employee-reactivation.actions";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-description";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { formatDepartureCutoff } from "@/lib/employee-lifecycle/cutoff-display";
import type {
	ChecklistGrantKind,
	ReactivationChecklist,
	ReactivationChecklistGroup,
	ReactivationChecklistItem,
} from "@/lib/employee-lifecycle/reactivation-checklist";
import { queryKeys } from "@/lib/query/keys";
import { Link, useRouter } from "@/navigation";
import { useGrantKindLabel } from "./use-grant-kind-label";

/**
 * The re-grant checklist after Reactivate (#1441, Organization ADR 0006):
 * what the deactivation ended, each linked to the page where it is granted
 * again. Reactivation restores none of it. Org admins only; the server refuses
 * everyone else.
 */

const GROUP_ORDER: ReactivationChecklistGroup[] = [
	"managers",
	"grants",
	"access",
	"teams",
	"shifts",
	"absences",
	"shareLinks",
];

/** The checklist could not be loaded (not: there is none). */
export class ReactivationChecklistLoadError extends Error {
	constructor() {
		super("reactivation_checklist_load_failed");
		this.name = "ReactivationChecklistLoadError";
	}
}

/**
 * Loads the employee's checklist; null when there is none or it was dismissed.
 * Throws `ReactivationChecklistLoadError` when it could not be loaded.
 */
export async function fetchReactivationChecklist(
	employeeId: string,
): Promise<ReactivationChecklist | null> {
	const result = await getReactivationChecklistAction(employeeId);
	if (!result.success) throw new ReactivationChecklistLoadError();
	return result.data;
}

/** Copy the lifecycle actions use around the checklist. */
export function useReactivationChecklistMessages() {
	const { t } = useTranslate();
	return {
		openLabel: t("settings.employees.lifecycle.reactivationChecklist.open", "What to grant again"),
		loadError: t(
			"settings.employees.lifecycle.reactivationChecklist.loadError",
			"The checklist of what to grant again could not be loaded.",
		),
	};
}

/**
 * Reactivation restores nothing (#1441): after Reactivate, show what the
 * deactivation ended, to grant again on purpose. When the row that reactivated
 * is gone by now (a filtered list), or the checklist could not be loaded, the
 * toast links to the checklist on the employee page instead.
 */
export function useReactivationChecklistOffer(mounted: RefObject<boolean>) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const messages = useReactivationChecklistMessages();
	const [shown, setShown] = useState<{
		employeeName: string;
		checklist: ReactivationChecklist;
	} | null>(null);

	/** Confirms the reactivation with `successMessage` and offers the checklist. */
	async function offer(
		reactivated: { employeeId: string; displayName: string },
		successMessage: string,
	) {
		let checklist: ReactivationChecklist | null = null;
		let loadFailed = false;
		try {
			checklist = await queryClient.fetchQuery({
				queryKey: queryKeys.employees.reactivationChecklist(reactivated.employeeId),
				queryFn: () => fetchReactivationChecklist(reactivated.employeeId),
				staleTime: 0,
			});
		} catch {
			loadFailed = true;
		}
		const hasItems = checklist !== null && checklist.items.length > 0;
		if (checklist && hasItems && mounted.current) {
			setShown({ employeeName: reactivated.displayName, checklist });
		}
		const openOnEmployeePage = {
			label: messages.openLabel,
			onClick: () =>
				router.push(`/settings/employees/${reactivated.employeeId}#reactivation-checklist`),
		};
		toast.success(
			successMessage,
			loadFailed
				? { description: messages.loadError, action: openOnEmployeePage }
				: hasItems && !mounted.current
					? { action: openOnEmployeePage }
					: undefined,
		);
	}

	return { checklist: shown, offer, dismissDialog: () => setShown(null) };
}

function useLocale() {
	const tolgee = useTolgee(["language"]);
	return tolgee.getLanguage() || "en";
}

function useChecklistLabels() {
	const { t } = useTranslate();
	const locale = useLocale();
	const unnamed = t(
		"settings.employees.lifecycle.reactivationChecklist.unnamed",
		"Name not recorded",
	);

	const groupTitle = (group: ReactivationChecklistGroup) => {
		switch (group) {
			case "managers":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.managers",
					"Manager links",
				);
			case "grants":
				return t("settings.employees.lifecycle.reactivationChecklist.groups.grants", "Held grants");
			case "access":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.access",
					"Kiosk badges and driving authorizations",
				);
			case "teams":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.teams",
					"Teams and projects",
				);
			case "shifts":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.shifts",
					"Shifts that were opened",
				);
			case "absences":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.absences",
					"Cancelled absences",
				);
			case "shareLinks":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.groups.shareLinks",
					"Report share links",
				);
		}
	};

	const grantKindLabel = useGrantKindLabel();
	const grantLabel = (grant: ChecklistGrantKind | null) =>
		grant === null
			? t("settings.employees.lifecycle.reactivationChecklist.items.unknownGrant", "A held grant")
			: grantKindLabel(grant);

	const itemLabel = (item: ReactivationChecklistItem): string => {
		switch (item.kind) {
			case "report_moved":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.reportMoved",
					"{name} was moved to {manager}",
					{ name: item.name ?? unnamed, manager: item.newManagerName ?? unnamed },
				);
			case "report_link_ended":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.reportLinkEnded",
					"{name} kept another manager",
					{ name: item.name ?? unnamed },
				);
			case "own_manager":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.ownManager",
					"Managed by {name}",
					{ name: item.name ?? unnamed },
				);
			case "grant":
				return grantLabel(item.grant);
			case "kiosk_badges":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.kioskBadges",
					"{count, plural, one {# kiosk badge was revoked} other {# kiosk badges were revoked}}",
					{ count: item.count },
				);
			case "driving_authorizations":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.drivingAuthorizations",
					"{count, plural, one {# driving authorization ended; a new check is needed} other {# driving authorizations ended; a new check is needed}}",
					{ count: item.count },
				);
			case "team":
				return t("settings.employees.lifecycle.reactivationChecklist.items.team", "Team {name}", {
					name: item.name ?? unnamed,
				});
			case "project_assignment":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.projectAssignment",
					"Assigned to project {name}",
					{ name: item.name ?? unnamed },
				);
			case "project_manager":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.projectManager",
					"Manager of project {name}",
					{ name: item.name ?? unnamed },
				);
			case "shift":
				return item.date
					? t(
							"settings.employees.lifecycle.reactivationChecklist.items.shift",
							"{date}, {startTime}–{endTime}",
							{
								date: formatPlainDate(parsePlainDate(item.date), locale, "weekdayMonthDay"),
								startTime: item.startTime ?? "",
								endTime: item.endTime ?? "",
							},
						)
					: t(
							"settings.employees.lifecycle.reactivationChecklist.items.shiftUnnamed",
							"A shift (date not recorded)",
						);
			case "absence":
				return item.startDate && item.endDate
					? t(
							"settings.employees.lifecycle.reactivationChecklist.items.absence",
							"{category}, {dates}",
							{
								category: item.categoryName ?? unnamed,
								dates: formatPlainDateRange(
									parsePlainDate(item.startDate),
									parsePlainDate(item.endDate),
									locale,
									"dateMedium",
								),
							},
						)
					: t(
							"settings.employees.lifecycle.reactivationChecklist.items.absenceUnnamed",
							"An absence (dates not recorded)",
						);
			case "share_links":
				return t(
					"settings.employees.lifecycle.reactivationChecklist.items.shareLinks",
					"{count, plural, one {# share link was revoked} other {# share links were revoked}}",
					{ count: item.count },
				);
		}
	};

	return { groupTitle, itemLabel };
}

/** Unique within a checklist: one link per person, record or grant kind; counts appear once. */
function itemKey(item: ReactivationChecklistItem): string {
	if ("id" in item) return `${item.kind}:${item.id}`;
	if ("employeeId" in item) return `${item.kind}:${item.employeeId}`;
	if (item.kind === "grant") return `grant:${item.grant ?? "unknown"}`;
	return item.kind;
}

function ChecklistGroup({ title, children }: { title: string; children: ReactNode }) {
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h3 id={headingId} className="text-sm font-semibold">
				{title}
			</h3>
			<ul className="space-y-1 text-sm">{children}</ul>
		</section>
	);
}

/** The checklist items, grouped, each a link to where it is granted again. */
export function ReactivationChecklistItems({ checklist }: { checklist: ReactivationChecklist }) {
	const { groupTitle, itemLabel } = useChecklistLabels();
	return (
		<div className="space-y-4">
			{GROUP_ORDER.map((group) => {
				const items = checklist.items.filter((item) => item.group === group);
				if (items.length === 0) return null;
				return (
					<ChecklistGroup key={group} title={groupTitle(group)}>
						{items.map((item) => (
							<li key={itemKey(item)}>
								<Link
									href={item.href}
									className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
								>
									{itemLabel(item)}
									<IconArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
								</Link>
							</li>
						))}
					</ChecklistGroup>
				);
			})}
		</div>
	);
}

function useChecklistIntro(checklist: ReactivationChecklist) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (checklist.deactivatedAt === null) {
		return t(
			"settings.employees.lifecycle.reactivationChecklist.descriptionDateNotRecorded",
			"Reactivation restored nothing. These were ended at the deactivation (its date is not recorded). Grant again only what is still needed.",
		);
	}
	return t(
		"settings.employees.lifecycle.reactivationChecklist.description",
		"Reactivation restored nothing. These were ended at the deactivation on {deactivatedAt} ({timezone}). Grant again only what is still needed.",
		{
			deactivatedAt: formatDepartureCutoff(checklist.deactivatedAt, checklist.timeZone, locale),
			timezone: checklist.timeZone,
		},
	);
}

/** Shown right after Reactivate. */
export function ReactivationChecklistDialog({
	open,
	onOpenChange,
	employeeName,
	checklist,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	employeeName: string;
	checklist: ReactivationChecklist | null;
}) {
	const { t } = useTranslate();
	return (
		<Dialog open={open && checklist !== null} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
				{checklist && (
					<ReactivationChecklistDialogBody employeeName={employeeName} checklist={checklist} />
				)}
				<DialogFooter>
					<Button type="button" onClick={() => onOpenChange(false)}>
						{t("settings.employees.lifecycle.reactivationChecklist.close", "Done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ReactivationChecklistDialogBody({
	employeeName,
	checklist,
}: {
	employeeName: string;
	checklist: ReactivationChecklist;
}) {
	const { t } = useTranslate();
	const intro = useChecklistIntro(checklist);
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t(
						"settings.employees.lifecycle.reactivationChecklist.dialogTitle",
						"{name} is reactivated: what to grant again",
						{ name: employeeName },
					)}
				</DialogTitle>
				<DialogDescription>{intro}</DialogDescription>
			</DialogHeader>
			<ReactivationChecklistItems checklist={checklist} />
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.employees.lifecycle.reactivationChecklist.laterHint",
					"This checklist stays on the employee page until an admin dismisses it.",
				)}
			</p>
		</>
	);
}

/** On the employee page, for org admins, until an admin dismisses it. */
export function ReactivationChecklistCard({ employeeId }: { employeeId: string }) {
	const queryClient = useQueryClient();
	const queryKey = queryKeys.employees.reactivationChecklist(employeeId);
	const query = useQuery({
		queryKey,
		queryFn: () => fetchReactivationChecklist(employeeId),
	});
	if (query.isError) {
		return <ChecklistLoadError onRetry={() => void query.refetch()} retrying={query.isFetching} />;
	}
	const checklist = query.data;
	if (!checklist || checklist.items.length === 0) return null;
	return (
		<ReactivationChecklistCardBody
			checklist={checklist}
			onDismissed={() => queryClient.setQueryData(queryKey, null)}
		/>
	);
}

/** A failed load is said, never shown as "nothing to grant again". */
function ChecklistLoadError({ onRetry, retrying }: { onRetry(): void; retrying: boolean }) {
	const { t } = useTranslate();
	const { loadError } = useReactivationChecklistMessages();
	return (
		<Alert variant="destructive" role="alert" id="reactivation-checklist">
			<IconAlertTriangle aria-hidden="true" />
			<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
				<span>{loadError}</span>
				<Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
					{retrying && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
					{t("settings.employees.lifecycle.reactivationChecklist.retry", "Try again")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

function ReactivationChecklistCardBody({
	checklist,
	onDismissed,
}: {
	checklist: ReactivationChecklist;
	onDismissed(): void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const intro = useChecklistIntro(checklist);
	const dismissError = t(
		"settings.employees.lifecycle.reactivationChecklist.dismissError",
		"The checklist could not be dismissed. Try again.",
	);
	const dismiss = useMutation({
		mutationFn: () =>
			dismissReactivationChecklistAction({
				employeeId: checklist.employeeId,
				deactivationId: checklist.deactivationId,
			}),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(dismissError);
				return;
			}
			onDismissed();
		},
		onError: () => {
			toast.error(dismissError);
		},
	});

	return (
		<Card id="reactivation-checklist">
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div className="space-y-1.5">
					<CardTitle className="flex items-center gap-2">
						<IconChecklist aria-hidden="true" className="size-5" />
						{t("settings.employees.lifecycle.reactivationChecklist.title", "What to grant again")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.employees.lifecycle.reactivationChecklist.reactivatedOn",
							"Reactivated on {reactivatedAt} ({timezone}).",
							{
								reactivatedAt: formatDepartureCutoff(
									checklist.reactivatedAt,
									checklist.timeZone,
									locale,
								),
								timezone: checklist.timeZone,
							},
						)}{" "}
						{intro}
					</CardDescription>
				</div>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => dismiss.mutate()}
					disabled={dismiss.isPending}
				>
					{dismiss.isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconX aria-hidden="true" className="size-4" />
					)}
					{t("settings.employees.lifecycle.reactivationChecklist.dismiss", "Dismiss")}
				</Button>
			</CardHeader>
			<CardContent>
				<ReactivationChecklistItems checklist={checklist} />
			</CardContent>
		</Card>
	);
}
