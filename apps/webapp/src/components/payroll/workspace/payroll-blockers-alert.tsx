"use client";

import { IconAlertTriangle, IconChevronDown } from "@tabler/icons-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import type React from "react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	type DismissiblePayrollBlocker,
	isDismissiblePayrollBlocker,
} from "@/lib/payroll-workspace/blocker-dismissals";
import {
	type PayrollBlockerIdentity,
	payrollBlockerIdentity,
} from "@/lib/payroll-workspace/blocker-identity";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import type { BlockerFocusRequest, PayrollTranslate } from "./state";

/** The blocker's type label and the action that resolves it. */
function payrollBlockerAction(
	blocker: PayrollWorkspaceSummary["blockers"][number],
	formattedDate: string | null,
	t: PayrollTranslate,
) {
	let blockerType: string;
	let actionLabel: string;
	let href: string;

	switch (blocker.type) {
		case "missing_clock_out":
		case "unresolved_work_minutes":
			blockerType =
				blocker.type === "missing_clock_out"
					? t("payroll.blockers.missingClockOut", "Missing clock-out")
					: t("payroll.blockers.unresolvedWorkMinutes", "Work minutes need review");
			actionLabel = t("payroll.blockers.openCalendar", "Open calendar");
			href = `/calendar/${encodeURIComponent(blocker.employeeId)}${
				formattedDate && blocker.date ? `?date=${encodeURIComponent(blocker.date)}` : ""
			}`;
			break;
		case "offboarding_clock_repair":
			// Fixed through the existing time correction flow on the calendar.
			blockerType = t(
				"payroll.blockers.offboardingClockRepair",
				"Offboarding clock-out needs repair",
			);
			actionLabel = t("payroll.blockers.openCalendar", "Open calendar");
			href = `/calendar/${encodeURIComponent(blocker.employeeId)}${
				formattedDate && blocker.date ? `?date=${encodeURIComponent(blocker.date)}` : ""
			}`;
			break;
		case "open_work":
			blockerType = t("payroll.blockers.openWork", "Work without clock-out");
			actionLabel = t("payroll.blockers.openCalendar", "Open calendar");
			href = `/calendar/${encodeURIComponent(blocker.employeeId)}${
				formattedDate && blocker.date ? `?date=${encodeURIComponent(blocker.date)}` : ""
			}`;
			break;
		case "pending_work_approval":
		case "pending_work_correction":
			blockerType =
				blocker.type === "pending_work_approval"
					? t("payroll.blockers.pendingWorkApproval", "Work awaiting approval")
					: t("payroll.blockers.pendingTimeCorrection", "Pending time correction");
			actionLabel = t("payroll.blockers.openApprovals", "Open approvals");
			href = "/approvals/inbox?types=time_entry";
			break;
		case "uncertain_historical_work":
			blockerType = t("payroll.blockers.uncertainHistoricalWork", "Historical work needs review");
			actionLabel = t("payroll.blockers.openWorkDiagnostics", "Open work diagnostics");
			href = "/settings/work-diagnostics";
			break;
		case "pending_time_correction":
			blockerType = t("payroll.blockers.pendingTimeCorrection", "Pending time correction");
			actionLabel = t("payroll.blockers.openApprovals", "Open approvals");
			href = "/approvals/inbox?types=time_entry";
			break;
		case "pending_absence":
			blockerType = t("payroll.blockers.pendingAbsence", "Pending absence");
			actionLabel = t("payroll.blockers.openApprovals", "Open approvals");
			href = "/approvals/inbox?types=absence_entry";
			break;
		case "missing_identifier":
			// The configured custom field identifier has no value (#821).
			blockerType = t("payroll.blockers.missingIdentifier", "Missing identifier");
			actionLabel = t("payroll.blockers.openEmployee", "Open employee");
			href = `/settings/employees/${encodeURIComponent(blocker.employeeId)}`;
			break;
	}

	return { blockerType, actionLabel, href };
}

export function PayrollBlockersAlert({
	blockers,
	clearingBlockerKeys,
	employees,
	fallbackFocusRef,
	focusRequest,
	onClearBlocker,
	t,
}: {
	blockers: PayrollWorkspaceSummary["blockers"];
	clearingBlockerKeys: ReadonlySet<PayrollBlockerIdentity>;
	employees: PayrollWorkspaceSummary["employees"];
	fallbackFocusRef: React.RefObject<HTMLDivElement | null>;
	focusRequest: BlockerFocusRequest | null;
	onClearBlocker: (blocker: DismissiblePayrollBlocker, activatedControl: HTMLButtonElement) => void;
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const handledFocusRequestIdRef = useRef(0);
	const blockerControlRefs = useRef(
		new Map<
			PayrollBlockerIdentity,
			{ action: HTMLAnchorElement | null; clear: HTMLButtonElement | null }
		>(),
	);
	const employeeNames = new Map(employees.map((employee) => [employee.id, employee.name]));
	const title = t("payroll.blockers.needReview", "{count} payroll blockers need review", {
		count: blockers.length,
	});

	useEffect(() => {
		if (!focusRequest || handledFocusRequestIdRef.current === focusRequest.id) return;

		handledFocusRequestIdRef.current = focusRequest.id;
		const controls = focusRequest.targetBlockerKey
			? blockerControlRefs.current.get(focusRequest.targetBlockerKey)
			: undefined;
		const targetControl =
			controls?.clear && !controls.clear.disabled ? controls.clear : controls?.action;
		const fallbackTarget = blockers.length === 0 ? fallbackFocusRef.current : triggerRef.current;
		(targetControl ?? fallbackTarget)?.focus();
	}, [blockers.length, fallbackFocusRef, focusRequest]);

	function setBlockerControlRef(
		blockerKey: PayrollBlockerIdentity,
		control: "action" | "clear",
		node: HTMLAnchorElement | HTMLButtonElement | null,
	) {
		const refs = blockerControlRefs.current.get(blockerKey) ?? {
			action: null,
			clear: null,
		};
		if (control === "action") refs.action = node as HTMLAnchorElement | null;
		else refs.clear = node as HTMLButtonElement | null;

		if (!refs.action && !refs.clear) blockerControlRefs.current.delete(blockerKey);
		else blockerControlRefs.current.set(blockerKey, refs);
	}

	if (blockers.length === 0) return null;

	return (
		<Collapsible asChild>
			<section
				aria-labelledby="payroll-blockers-title"
				className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
			>
				<header>
					<h2 id="payroll-blockers-title">
						<CollapsibleTrigger asChild>
							<button
								className="flex min-h-11 w-full items-start gap-3 rounded-sm text-left font-medium leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&[data-panel-open]>svg:last-child]:rotate-180"
								ref={triggerRef}
								type="button"
							>
								<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
								<span className="min-w-0 flex-1">{title}</span>
								<IconChevronDown
									aria-hidden="true"
									className="size-4 shrink-0 transition-transform"
								/>
							</button>
						</CollapsibleTrigger>
					</h2>
				</header>
				<CollapsibleContent asChild>
					<ul className="mt-3 grid gap-2">
						{blockers.map((blocker) => {
							const blockerKey = payrollBlockerIdentity(blocker);
							const isClearing = clearingBlockerKeys.has(blockerKey);
							const summaryEmployeeName = employeeNames.get(blocker.employeeId);
							const employeeName =
								summaryEmployeeName && summaryEmployeeName !== blocker.employeeId
									? summaryEmployeeName
									: t("payroll.blockers.unknownEmployee", "Unknown employee");
							const formattedDate = formatPayrollBlockerDate(blocker.date, locale);
							const metadata = formattedDate
								? [formattedDate, blocker.time].filter(Boolean).join(", ")
								: t("payroll.blockers.dateUnavailable", "Date unavailable");
							const { blockerType, actionLabel, href } = payrollBlockerAction(
								blocker,
								formattedDate,
								t,
							);

							return (
								<li
									className="grid min-w-0 gap-2 rounded-md border bg-background px-3 py-2 text-foreground lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-4"
									data-payroll-blocker-key={blockerKey}
									key={blockerKey}
								>
									<div className="grid min-w-0 gap-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,auto)] lg:items-center lg:gap-4">
										<span className="min-w-0 break-words font-medium">{employeeName}</span>
										<span className="min-w-0 break-words">{blockerType}</span>
										{formattedDate && blocker.date ? (
											<time
												className="min-w-0 text-muted-foreground text-xs tabular-nums"
												dateTime={`${blocker.date}${blocker.time ? `T${blocker.time}` : ""}`}
											>
												{metadata}
											</time>
										) : (
											<span className="text-muted-foreground text-xs">{metadata}</span>
										)}
									</div>
									<div
										className={`grid gap-1 lg:flex lg:items-center lg:justify-end ${
											isDismissiblePayrollBlocker(blocker) ? "sm:grid-cols-2" : ""
										}`}
									>
										<Button asChild className="w-full lg:w-auto" size="sm" variant="outline">
											<Link
												aria-label={`${actionLabel}: ${employeeName}, ${blockerType}, ${metadata}`}
												href={href}
												ref={(node) => setBlockerControlRef(blockerKey, "action", node)}
											>
												{actionLabel}
											</Link>
										</Button>
										{isDismissiblePayrollBlocker(blocker) ? (
											<Button
												aria-label={`${
													isClearing
														? t("payroll.blockers.clearingFalsePositive", "Clearing false positive")
														: t("payroll.blockers.clearFalsePositive", "Clear false positive")
												}: ${employeeName}, ${blockerType}, ${metadata}`}
												aria-busy={isClearing}
												className="w-full lg:w-auto"
												disabled={isClearing}
												onClick={(event) => onClearBlocker(blocker, event.currentTarget)}
												ref={(node) => setBlockerControlRef(blockerKey, "clear", node)}
												size="sm"
												type="button"
												variant="ghost"
											>
												{isClearing
													? t("payroll.blockers.clearingFalsePositive", "Clearing false positive")
													: t("payroll.blockers.clearFalsePositive", "Clear false positive")}
											</Button>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}

function formatPayrollBlockerDate(date: string | null, locale: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const bridgeDate = new Date(0);
	bridgeDate.setUTCFullYear(year, month - 1, day);
	bridgeDate.setUTCHours(0, 0, 0, 0);

	if (
		bridgeDate.getUTCFullYear() !== year ||
		bridgeDate.getUTCMonth() !== month - 1 ||
		bridgeDate.getUTCDate() !== day
	) {
		return null;
	}

	return Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(bridgeDate);
}
