import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	auditLog,
	customer,
	invoiceDraft,
	invoicedWork,
	invoicedWorkResolution,
	project,
	type ResolutionSnapshot,
	type ResolvedWorkValues,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isUuid } from "../input";
import { amountDifferenceOf } from "./amount-difference";
import { compareWork } from "./comparison";
import {
	changedFieldsOf,
	type InvoicedWorkRowView,
	invoicedWorkViews,
	lockHandOffs,
} from "./hand-off-store";
import { comparisonItems, itemMarkVersion, type ResolutionInput } from "./resolution";
import type {
	MarkedWorkDraftView,
	MarkedWorkItemView,
	ResolutionHistoryEntryView,
	WorkComparisonView,
} from "./views";

/**
 * Resolving work changed after invoicing (#1499). A resolution records who
 * handled a comparison item, when, why, the accounting reference, the changed
 * fields it resolved and the live values reviewed, then removes the item's
 * mark. Resolutions are append-only (migration 0290); a later correction marks
 * the item again. Each marked item is listed with its comparison (#1501): the
 * hand-off, its latest resolution's snapshot and the live values. Callers
 * authorize an org admin of `organizationId` first;
 * everything here is scoped to that organization. The Billable Time module may
 * be off.
 *
 * Stale-safe: the batch is refused whole when any item's mark version differs
 * from the one the admin loaded. Lock order: the hand-off lock, then the
 * drafts' invoiced work rows by id; work periods are only read, never locked
 * (their writers lock work_period before invoiced_work). A correction waiting
 * on our row lock marks the item again after we commit; one that committed
 * first moved the mark version, so we refuse.
 */

type Reader = Pick<typeof db, "select">;

type ItemRowView = InvoicedWorkRowView & { id: string };

function itemsOf(rows: readonly InvoicedWorkRowView[]): Map<string, ItemRowView[]> {
	return comparisonItems(rows.map((row) => ({ ...row, id: row.invoicedWorkId })));
}

interface ItemHistory {
	/** Resolutions and earlier clears, newest first, by handed-off row. */
	history: Map<string, ResolutionHistoryEntryView[]>;
	/** The latest resolution's reviewed values, by handed-off row. */
	lastResolved: Map<string, { resolvedAt: string; snapshot: ResolutionSnapshot }>;
}

async function historyOf(
	reader: Reader,
	organizationId: string,
	items: ReadonlyMap<string, readonly ItemRowView[]>,
): Promise<ItemHistory> {
	const rootOf = new Map<string, string>();
	for (const [root, rows] of items) for (const row of rows) rootOf.set(row.id, root);
	if (rootOf.size === 0) return { history: new Map(), lastResolved: new Map() };
	const [resolutions, cleared] = await Promise.all([
		reader
			.select({
				id: invoicedWorkResolution.id,
				invoicedWorkId: invoicedWorkResolution.invoicedWorkId,
				at: invoicedWorkResolution.resolvedAt,
				actorName: user.name,
				explanation: invoicedWorkResolution.explanation,
				accountingReference: invoicedWorkResolution.accountingReference,
				resolvedFields: invoicedWorkResolution.resolvedFields,
				snapshot: invoicedWorkResolution.snapshot,
			})
			.from(invoicedWorkResolution)
			.leftJoin(user, eq(user.id, invoicedWorkResolution.resolvedBy))
			.where(
				and(
					eq(invoicedWorkResolution.organizationId, organizationId),
					inArray(invoicedWorkResolution.invoicedWorkId, [...items.keys()]),
				),
			),
		reader
			.select({
				invoicedWorkId: invoicedWork.id,
				at: invoicedWork.markClearedAt,
				actorName: user.name,
			})
			.from(invoicedWork)
			.leftJoin(user, eq(user.id, invoicedWork.markClearedBy))
			.where(
				and(
					eq(invoicedWork.organizationId, organizationId),
					inArray(invoicedWork.id, [...rootOf.keys()]),
					isNotNull(invoicedWork.markClearedAt),
				),
			),
	]);
	const entries: ResolutionHistoryEntryView[] = [
		...resolutions.map(
			(row): ResolutionHistoryEntryView => ({
				kind: "resolution",
				id: row.id,
				invoicedWorkId: row.invoicedWorkId,
				at: row.at.toISOString(),
				actorName: row.actorName,
				explanation: row.explanation,
				accountingReference: row.accountingReference,
				resolvedFields: changedFieldsOf(row.resolvedFields),
			}),
		),
		...cleared.flatMap((row): ResolutionHistoryEntryView[] =>
			row.at
				? [
						{
							kind: "cleared_before_resolutions",
							invoicedWorkId: rootOf.get(row.invoicedWorkId) ?? row.invoicedWorkId,
							at: row.at.toISOString(),
							actorName: row.actorName,
						},
					]
				: [],
		),
	];
	entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
	const byItem = new Map<string, ResolutionHistoryEntryView[]>();
	for (const entry of entries) {
		const list = byItem.get(entry.invoicedWorkId) ?? [];
		list.push(entry);
		byItem.set(entry.invoicedWorkId, list);
	}
	const lastResolved: ItemHistory["lastResolved"] = new Map();
	for (const row of resolutions) {
		const latest = lastResolved.get(row.invoicedWorkId);
		if (!latest || latest.resolvedAt < row.at.toISOString()) {
			lastResolved.set(row.invoicedWorkId, {
				resolvedAt: row.at.toISOString(),
				snapshot: row.snapshot,
			});
		}
	}
	return { history: byItem, lastResolved };
}

/**
 * The items with an open mark. Released rows keep the marks open at release
 * (#1503); they stay listed, read-only.
 */
function openItems(
	items: ReadonlyMap<string, readonly ItemRowView[]>,
): Map<string, readonly ItemRowView[]> {
	return new Map(
		[...items].filter(([, rows]) => rows.some((row) => row.changedAfterInvoicingAt !== null)),
	);
}

interface ItemComparison {
	comparison: WorkComparisonView;
	draft: MarkedWorkDraftView;
}

/**
 * Each item's comparison (#1501): the handed-off row against its latest
 * resolution's snapshot and the live work periods of all its pieces. The
 * hand-off's customer is the draft's. The amount difference (#1502) is priced
 * at the handed-off row's frozen shares in the draft's currency, never at
 * current billable rates.
 */
async function comparisonsOf(
	reader: Reader,
	organizationId: string,
	items: ReadonlyMap<string, readonly ItemRowView[]>,
	lastResolved: ItemHistory["lastResolved"],
): Promise<Map<string, ItemComparison>> {
	if (items.size === 0) return new Map();
	const rows = [...items.values()].flat();
	const [drafts, current] = await Promise.all([
		reader
			.select({
				id: invoiceDraft.id,
				customerId: invoiceDraft.customerId,
				customerName: customer.name,
				currency: invoiceDraft.currency,
				periodFrom: invoiceDraft.periodFrom,
				periodTo: invoiceDraft.periodTo,
				title: invoiceDraft.title,
				externalId: invoiceDraft.externalId,
				createdAt: invoiceDraft.createdAt,
			})
			.from(invoiceDraft)
			.leftJoin(
				customer,
				and(eq(customer.id, invoiceDraft.customerId), eq(customer.organizationId, organizationId)),
			)
			.where(
				and(
					eq(invoiceDraft.organizationId, organizationId),
					inArray(invoiceDraft.id, [...new Set(rows.map((row) => row.invoiceDraftId))]),
				),
			),
		currentValues(
			reader,
			organizationId,
			rows.map((row) => row.workPeriodId),
		),
	]);
	const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
	const comparisons = new Map<string, ItemComparison>();
	for (const [rootId, members] of items) {
		const root = members[0];
		const frozen = root.handedOff;
		const draft = draftsById.get(root.invoiceDraftId);
		// The draft cascades its invoiced work away, so it is always there.
		if (!draft) continue;
		const latest = lastResolved.get(rootId);
		const lastResolvedPieces = latest ? latest.snapshot.pieces : null;
		// The work period cascades its invoiced work away, so each piece has one.
		const currentPieces = members.flatMap((row) => {
			const values = current.get(row.workPeriodId);
			return values ? [values] : [];
		});
		comparisons.set(rootId, {
			comparison: {
				...compareWork({
					handOff: {
						removed: false,
						startedAt: frozen.startedAt,
						endedAt: frozen.endedAt,
						startOffsetMinutes: frozen.startOffsetMinutes,
						endOffsetMinutes: frozen.startOffsetMinutes,
						durationMinutes: frozen.durationMinutes,
						projectId: frozen.projectId,
						projectName: root.projectName || null,
						customerId: draft.customerId,
						customerName: draft.customerName,
						// Only billable work is handed off.
						billable: true,
					},
					lastResolved:
						latest && lastResolvedPieces
							? { resolvedAt: latest.resolvedAt, pieces: lastResolvedPieces }
							: null,
					current: currentPieces,
				}),
				amountDifference: amountDifferenceOf({
					frozen: {
						shares: frozen.shares,
						startedAt: frozen.startedAt,
						endedAt: frozen.endedAt,
						durationMinutes: frozen.durationMinutes,
						projectId: frozen.projectId,
						customerId: draft.customerId,
						currency: draft.currency,
					},
					lastResolved: lastResolvedPieces,
					current: currentPieces,
				}),
			},
			draft: {
				customerId: draft.customerId,
				customerName: draft.customerName ?? "",
				currency: draft.currency,
				period: { from: draft.periodFrom, to: draft.periodTo },
				title: draft.title,
				externalId: draft.externalId,
				createdAt: draft.createdAt.toISOString(),
			},
		});
	}
	return comparisons;
}

/** The items' views; an item without an open mark (resolved) has no changed fields. */
function markedItemsOf(
	items: ReadonlyMap<string, readonly ItemRowView[]>,
	{ history }: ItemHistory,
	comparisons: ReadonlyMap<string, ItemComparison>,
): MarkedWorkItemView[] {
	const marked: MarkedWorkItemView[] = [];
	for (const [rootId, rows] of items) {
		const open = rows.filter((row) => row.changedAfterInvoicingAt !== null);
		const compared = comparisons.get(rootId);
		if (!compared) continue;
		const {
			id: _id,
			timesheet: _timesheet,
			carriedFromWorkPeriodId: _source,
			markVersion: _version,
			released: _released,
			handedOff: _handedOff,
			...root
		} = rows[0];
		marked.push({
			...root,
			// ISO instants of one format: the smallest string is the earliest.
			changedAfterInvoicingAt:
				open.map((row) => row.changedAfterInvoicingAt as string).sort()[0] ?? null,
			changedFields: [...new Set(open.flatMap((row) => row.changedFields))].sort(),
			markVersion: itemMarkVersion(rows),
			draft: compared.draft,
			// Release returns every row of a draft at once.
			openWhenReleased: open.length > 0 && rows[0].released,
			history: history.get(rootId) ?? [],
			comparison: compared.comparison,
		});
	}
	return marked;
}

/** Marked items with their history and comparison. */
async function markedItemsWithComparisons(
	reader: Reader,
	organizationId: string,
	items: ReadonlyMap<string, readonly ItemRowView[]>,
	history: ItemHistory,
): Promise<MarkedWorkItemView[]> {
	const open = openItems(items);
	const comparisons = await comparisonsOf(reader, organizationId, open, history.lastResolved);
	return markedItemsOf(open, history, comparisons);
}

/** The organization's comparison items marked as changed after invoicing, in unreleased drafts. */
export async function listMarkedItems(
	reader: Reader,
	organizationId: string,
): Promise<MarkedWorkItemView[]> {
	const drafts = await reader
		.select({ id: invoicedWork.invoiceDraftId })
		.from(invoicedWork)
		.where(
			and(
				eq(invoicedWork.organizationId, organizationId),
				isNull(invoicedWork.releasedAt),
				isNotNull(invoicedWork.changedAfterInvoicingAt),
			),
		)
		.groupBy(invoicedWork.invoiceDraftId);
	if (drafts.length === 0) return [];
	const rows = await invoicedWorkViews(
		reader,
		organizationId,
		and(
			inArray(
				invoicedWork.invoiceDraftId,
				drafts.map((draft) => draft.id),
			),
			isNull(invoicedWork.releasedAt),
		),
	);
	const items = openItems(itemsOf(rows));
	return markedItemsWithComparisons(
		reader,
		organizationId,
		items,
		await historyOf(reader, organizationId, items),
	);
}

/**
 * A draft's marked items and the resolution history of all its items. On a
 * released draft (#1503) these are the items still open at release, with
 * their comparisons, and the history as it was: re-handed-off work is new
 * invoiced work of another draft, with comparisons and history of its own.
 */
export async function readDraftReconciliation(
	reader: Reader,
	input: { organizationId: string; draftId: string },
): Promise<{ marked: MarkedWorkItemView[]; resolutionHistory: ResolutionHistoryEntryView[] }> {
	const rows = await invoicedWorkViews(
		reader,
		input.organizationId,
		eq(invoicedWork.invoiceDraftId, input.draftId),
	);
	const items = itemsOf(rows);
	const history = await historyOf(reader, input.organizationId, items);
	return {
		marked: await markedItemsWithComparisons(reader, input.organizationId, items, history),
		resolutionHistory: [...history.history.values()]
			.flat()
			.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
	};
}

/**
 * A draft's items for its reconciliation CSV (#1504): every item still marked
 * or with a resolution history, with its comparison, in the order of their
 * hand-off. Read like the draft detail, so released drafts are included. Null
 * when the draft is not the organization's.
 */
export async function readDraftReconciliationItems(
	reader: Reader,
	input: { organizationId: string; draftId: string },
): Promise<{ period: { from: string; to: string }; items: MarkedWorkItemView[] } | null> {
	if (!isUuid(input.draftId)) return null;
	const [draft] = await reader
		.select({ periodFrom: invoiceDraft.periodFrom, periodTo: invoiceDraft.periodTo })
		.from(invoiceDraft)
		.where(
			and(
				eq(invoiceDraft.id, input.draftId),
				eq(invoiceDraft.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!draft) return null;
	const rows = await invoicedWorkViews(
		reader,
		input.organizationId,
		eq(invoicedWork.invoiceDraftId, input.draftId),
	);
	const all = itemsOf(rows);
	const history = await historyOf(reader, input.organizationId, all);
	const reconciled = new Map(
		[...all].filter(
			([rootId, members]) =>
				history.history.has(rootId) || members.some((row) => row.changedAfterInvoicingAt !== null),
		),
	);
	const comparisons = await comparisonsOf(
		reader,
		input.organizationId,
		reconciled,
		history.lastResolved,
	);
	return {
		period: { from: draft.periodFrom, to: draft.periodTo },
		items: markedItemsOf(reconciled, history, comparisons),
	};
}

export type ResolveResult =
	| { ok: true; resolved: number }
	/** An item is not invoiced work of the organization. */
	| { ok: false; reason: "not_found" }
	/** These items changed since they were loaded; nothing was resolved. */
	| { ok: false; reason: "stale"; invoicedWorkIds: string[] }
	/** These items' draft was released (#1503): read-only; nothing was resolved. */
	| { ok: false; reason: "released"; invoicedWorkIds: string[] };

/** The live values of the work periods, read without locks (see the module note). */
async function currentValues(
	tx: Reader,
	organizationId: string,
	workPeriodIds: readonly string[],
): Promise<Map<string, Omit<ResolvedWorkValues, "invoicedWorkId">>> {
	const clockIn = alias(timeEntry, "resolution_clock_in");
	const clockOut = alias(timeEntry, "resolution_clock_out");
	const rows = await tx
		.select({
			workPeriodId: workPeriod.id,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			deletedAt: workPeriod.deletedAt,
			billable: workPeriod.isBillable,
			projectId: workPeriod.projectId,
			projectName: project.name,
			customerId: project.customerId,
			customerName: customer.name,
			startOffsetMinutes: clockIn.utcOffsetMinutes,
			endOffsetMinutes: clockOut.utcOffsetMinutes,
		})
		.from(workPeriod)
		.leftJoin(
			clockIn,
			and(eq(clockIn.id, workPeriod.clockInId), eq(clockIn.organizationId, organizationId)),
		)
		.leftJoin(
			clockOut,
			and(eq(clockOut.id, workPeriod.clockOutId), eq(clockOut.organizationId, organizationId)),
		)
		.leftJoin(
			project,
			and(eq(project.id, workPeriod.projectId), eq(project.organizationId, organizationId)),
		)
		.leftJoin(
			customer,
			and(eq(customer.id, project.customerId), eq(customer.organizationId, organizationId)),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.id, [...workPeriodIds]),
			),
		);
	return new Map(
		rows.map((row) => [
			row.workPeriodId,
			{
				workPeriodId: row.workPeriodId,
				removed: row.deletedAt !== null,
				startedAt: row.startTime.toISOString(),
				endedAt: row.endTime?.toISOString() ?? null,
				startOffsetMinutes: row.startOffsetMinutes,
				endOffsetMinutes: row.endOffsetMinutes,
				durationMinutes: row.durationMinutes,
				projectId: row.projectId,
				projectName: row.projectName,
				customerId: row.customerId,
				customerName: row.customerName,
				billable: row.billable,
			},
		]),
	);
}

/**
 * Resolves comparison items with one shared explanation and reference: one
 * resolution and one audit row per item, and every row of the item loses its
 * mark. Refuses the whole batch when an item is unknown or stale.
 */
export async function resolveChangedAfterInvoicing(
	database: typeof db,
	input: { organizationId: string; actorUserId: string; resolution: ResolutionInput },
): Promise<ResolveResult> {
	const { organizationId, resolution } = input;
	const requestedIds = resolution.items.map((item) => item.invoicedWorkId);
	return database.transaction(async (tx): Promise<ResolveResult> => {
		await lockHandOffs(tx, organizationId);
		const drafts = await tx
			.select({ id: invoicedWork.invoiceDraftId })
			.from(invoicedWork)
			.where(
				and(
					eq(invoicedWork.organizationId, organizationId),
					inArray(invoicedWork.id, requestedIds),
				),
			)
			.groupBy(invoicedWork.invoiceDraftId);
		if (drafts.length === 0) return { ok: false, reason: "not_found" };
		// Every row of the drafts: an item's pieces are found by walking them.
		const rows = await tx
			.select({
				id: invoicedWork.id,
				invoiceDraftId: invoicedWork.invoiceDraftId,
				workPeriodId: invoicedWork.workPeriodId,
				employeeId: invoicedWork.employeeId,
				carriedFromWorkPeriodId: invoicedWork.carriedFromWorkPeriodId,
				markVersion: invoicedWork.markVersion,
				releasedAt: invoicedWork.releasedAt,
				changedAfterInvoicingAt: invoicedWork.changedAfterInvoicingAt,
				changedFields: invoicedWork.changedFields,
			})
			.from(invoicedWork)
			.where(
				and(
					eq(invoicedWork.organizationId, organizationId),
					inArray(
						invoicedWork.invoiceDraftId,
						drafts.map((draft) => draft.id),
					),
				),
			)
			.orderBy(asc(invoicedWork.id))
			.for("update");
		const known = new Set(rows.map((row) => row.id));
		if (requestedIds.some((id) => !known.has(id))) return { ok: false, reason: "not_found" };

		const items = comparisonItems(rows);
		// Release keeps a draft's history read-only (#1503). The hand-off lock
		// serializes this check with release.
		const released = requestedIds.filter((id) =>
			items.get(id)?.some((row) => row.releasedAt !== null),
		);
		if (released.length > 0) return { ok: false, reason: "released", invoicedWorkIds: released };
		const stale = resolution.items.flatMap(({ invoicedWorkId, markVersion }) => {
			const members = items.get(invoicedWorkId);
			const unchanged =
				members?.some((row) => row.changedAfterInvoicingAt !== null) &&
				itemMarkVersion(members) === markVersion;
			return unchanged ? [] : [invoicedWorkId];
		});
		if (stale.length > 0) return { ok: false, reason: "stale", invoicedWorkIds: stale };

		const resolved = resolution.items.map(({ invoicedWorkId }) => {
			const members = items.get(invoicedWorkId) ?? [];
			return {
				id: randomUUID(),
				root: members[0],
				members,
				resolvedFields: [...new Set(members.flatMap((row) => row.changedFields))].sort(),
			};
		});
		const members = resolved.flatMap((item) => item.members);
		const current = await currentValues(
			tx,
			organizationId,
			members.map((row) => row.workPeriodId),
		);
		const valuesOf = (row: (typeof members)[number]): ResolvedWorkValues => {
			const values = current.get(row.workPeriodId);
			// The work period cascades its invoiced work away, so it is always there.
			if (!values) throw new Error(`Work period ${row.workPeriodId} of invoiced work is missing`);
			return { invoicedWorkId: row.id, ...values };
		};

		await tx.insert(invoicedWorkResolution).values(
			resolved.map((item) => ({
				id: item.id,
				organizationId,
				invoiceDraftId: item.root.invoiceDraftId,
				invoicedWorkId: item.root.id,
				resolvedBy: input.actorUserId,
				explanation: resolution.explanation,
				accountingReference: resolution.accountingReference,
				resolvedFields: item.resolvedFields,
				snapshot: { pieces: item.members.map(valuesOf) },
			})),
		);
		// The mark_version trigger bumps every row, so a concurrent resolution goes stale.
		await tx
			.update(invoicedWork)
			.set({ changedAfterInvoicingAt: null, changedFields: sql`'{}'::text[]` })
			.where(
				and(
					eq(invoicedWork.organizationId, organizationId),
					inArray(
						invoicedWork.id,
						members.map((row) => row.id),
					),
				),
			);
		await tx.insert(auditLog).values(
			resolved.map((item) => ({
				organizationId,
				entityType: "invoiced_work",
				entityId: item.root.workPeriodId,
				action: AuditAction.INVOICED_WORK_MARK_RESOLVED,
				performedBy: input.actorUserId,
				employeeId: item.root.employeeId,
				changes: JSON.stringify({
					resolutionId: item.id,
					invoiceDraftId: item.root.invoiceDraftId,
					invoicedWorkIds: item.members.map((row) => row.id),
					resolvedFields: item.resolvedFields,
					explanation: resolution.explanation,
					accountingReference: resolution.accountingReference,
				}),
			})),
		);
		return { ok: true, resolved: resolved.length };
	});
}
