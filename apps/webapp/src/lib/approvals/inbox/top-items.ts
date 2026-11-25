import { mapConcurrently } from "@/lib/async/map-concurrently";
import { type ApprovalTriagePolicy, getEffectiveApprovalTriagePolicy } from "../triage-policy";
import {
	type ApprovalInboxListParams,
	type ApprovalInboxListReadOptions,
	COVERING_SECTION_LIMIT,
	compareInboxItems,
	countsWithCoveringSections,
	getApprovalInboxList,
	itemsWithCoveringSections,
} from "./read-service";
import {
	type ApprovalInboxTriageEvidenceLoader,
	type ApprovalInboxTriageTarget,
	loadCurrentApprovalTriageEvidence,
	resolveApprovalInboxTriage,
} from "./triage-evidence";
import type { ApprovalInboxItem, ApprovalInboxListResult, ApprovalInboxType } from "./types";

export interface ApprovalInboxTopItems {
	/** Pending approvals per type, "Covering for" rows included: the inbox badge's counts. */
	counts: ApprovalInboxListResult["counts"];
	/** The badge's total: the sum of `counts`. */
	total: number;
	/**
	 * The covered share of `total` (#1978): the rows the viewer's "Covering for" sections list,
	 * exactly the rows the badge counts. A section past its first 100 rows has more waiting
	 * than this counts, as the badge does.
	 */
	coveringCount: number;
	/**
	 * The rows read per type, own and the covered ones counted above: never more than wait, so
	 * a lower bound for a type whose count failed (#1978).
	 */
	listed: Partial<Record<ApprovalInboxType, number>>;
	/** The first `limit` pending items, own and covered, in the inbox's order. */
	items: ApprovalInboxItem[];
	/** Sources whose list or count failed: their items or counts are missing above. */
	warnings: ApprovalInboxListResult["warnings"];
}

const itemKey = (type: string, id: string) => `${type}:${id}`;

/** Rounds of `limit` evidence reads before every remaining candidate is read in one round. */
const SMALL_EVIDENCE_ROUNDS = 2;

/** The most items whose evidence is read at the same time. */
const EVIDENCE_CONCURRENCY = 5;

/**
 * The viewer's pending work and its most urgent items, exactly as the inbox orders them
 * (#1978), for a surface that shows only a few, such as the Dashboard.
 *
 * Risk orders the inbox first, and current evidence (coverage, payroll, correction facts)
 * sets the risk of absences, absence changes and time corrections. Evidence costs queries per
 * item, so it is read only for the items that could still reach the first `limit`: evidence
 * never lowers an item below "high" before it is read, so an item is evaluated, best case
 * first, until the `limit` items already known outrank the next one's best case. Two small
 * rounds come first; a third reads every item that could still reach the top, a few at a
 * time, so a dashboard never waits through more rounds than that. Every other
 * kind's risk needs no evidence. The rows themselves are read as the inbox reads them, one
 * query per source as the badge does, so the counts stay the badge's.
 *
 * Candidates are the rows the inbox itself can list: every legacy-source item; every row of
 * the evidence-aware canonical reads (absences, absence changes, time corrections), read with
 * `limit all` as the inbox reads them; the first 101 rows of each other canonical read and of
 * the compliance exceptions, in their pre-evidence order (the inbox's own page cap); and each
 * "Covering for" section's first 100 rows, chosen after current evidence as the inbox
 * chooses them. A covered item past its section's 100 rows is never previewed, just
 * as the inbox doesn't list it, and neither the total nor `coveringCount` counts it.
 *
 * The viewer's own pending requests count and appear as the badge has them (#1978): an
 * org-wide viewer's own request is listed read-only, marked `capabilities.ownRequest`.
 */
export async function getApprovalInboxTopItems(
	params: Omit<ApprovalInboxListParams, "limit" | "cursor">,
	options: {
		limit: number;
		now?: Date;
		triagePolicy?: ApprovalTriagePolicy;
		loadTriageEvidence?: ApprovalInboxTriageEvidenceLoader;
		/** Stands in for the inbox's list read. */
		readList?: (
			params: ApprovalInboxListParams,
			options: ApprovalInboxListReadOptions,
		) => Promise<ApprovalInboxListResult>;
	},
): Promise<ApprovalInboxTopItems> {
	const { limit } = options;
	const now = options.now ?? new Date();
	const policy =
		options.triagePolicy ??
		(await getEffectiveApprovalTriagePolicy({ organizationId: params.organizationId }));
	const loadEvidence = options.loadTriageEvidence ?? loadCurrentApprovalTriageEvidence;
	// Evidence-aware items, by item: read without evidence first, evaluated below if needed.
	const deferred = new Map<string, ApprovalInboxTriageTarget>();
	const uncut = await (options.readList ?? getApprovalInboxList)(
		// No page limit, so no unevaluated order cuts off a legacy item; evidence-aware canonical
		// reads return every row, other canonical and compliance reads at most their first 101.
		// Covering sections come uncut: they are cut below, after evidence, as the inbox cuts them.
		{ ...params, status: "pending", limit: Number.MAX_SAFE_INTEGER },
		{
			now,
			triagePolicy: policy,
			uncutCoveringSections: true,
			loadTriageEvidence: async (target) => {
				if (target.requestKind !== "other") {
					deferred.set(itemKey(target.type, target.context.requestId), target);
				}
				return { context: target.context, evidence: [] };
			},
		},
	);
	const evaluate = (items: ApprovalInboxItem[]) =>
		// Bounded (#1978): the inbox reads its evidence with an unbounded `Promise.all`, but the
		// Dashboard renders far more often, and a fresh queue can leave every pending absence or
		// time correction to read here, each with several queries. A few at a time keeps the
		// result exact at the cost of a little latency, without flooding the database pool.
		mapConcurrently(items, EVIDENCE_CONCURRENCY, async (item) => {
			const key = itemKey(item.type, item.id);
			const target = deferred.get(key);
			if (!target) return item;
			deferred.delete(key);
			return {
				...item,
				triage: await resolveApprovalInboxTriage({ target, now, policy, loadEvidence }),
			};
		});
	// A section past its first rows is cut after its evidence, as the inbox cuts it, so the
	// counts keep exactly the rows the inbox's section lists. Only the counts per type need the
	// cut: a covered row in the first `limit` overall is among its section's first rows anyway.
	const sections = await mapConcurrently(uncut.covering ?? [], 1, async (section) => {
		if (section.rows.length <= COVERING_SECTION_LIMIT) return { counted: section, listed: section };
		// One type: whichever rows the cut keeps, it keeps that many of that type. No count
		// changes, so no evidence is read for the cut; the preview reads what it needs.
		if (new Set(section.rows.map((row) => row.type)).size === 1) {
			return {
				counted: { ...section, rows: section.rows.slice(0, COVERING_SECTION_LIMIT) },
				listed: section,
			};
		}
		// Mixed types: evidence decides which type the cut drops. Rare: only an absent approver
		// with more than COVERING_SECTION_LIMIT pending of several kinds reads them all here.
		const cut = {
			...section,
			rows: (await evaluate(section.rows)).sort(compareInboxItems).slice(0, COVERING_SECTION_LIMIT),
		};
		return { counted: cut, listed: cut };
	});
	const list = { ...uncut, covering: sections.map(({ counted }) => counted) };
	const candidates = itemsWithCoveringSections({
		...uncut,
		covering: sections.map(({ listed }) => listed),
	});
	const pending = candidates
		.flatMap((item) => {
			if (!deferred.has(itemKey(item.type, item.id))) return [];
			const best = { ...item, triage: { ...item.triage, riskLevel: "high" as const } };
			return [{ item, best }];
		})
		.sort((left, right) => compareInboxItems(left.best, right.best));
	let top = candidates.filter((item) => !deferred.has(itemKey(item.type, item.id))).slice(0, limit);
	// Whether the known top already outranks this item's best case, and so every later one's.
	const outranks = (index: number) => {
		const last = top.length >= limit ? top[limit - 1] : undefined;
		return last !== undefined && compareInboxItems(last, pending[index].best) < 0;
	};
	let next = 0;
	for (let round = 0; next < pending.length; round += 1) {
		if (outranks(next)) break;
		// Small rounds first, as most dashboards fill their top from the oldest high-risk items.
		// Past them, evidence is read at once, as the inbox reads it, for every remaining item
		// whose best case could still reach the top: the known top only improves, so an item
		// it already outranks never enters it, and no dashboard waits through more rounds.
		let end = next + limit;
		if (round >= SMALL_EVIDENCE_ROUNDS) {
			end = next + 1;
			while (end < pending.length && !outranks(end)) end += 1;
		}
		const batch = pending.slice(next, end);
		next += batch.length;
		const evaluated = await evaluate(batch.map(({ item }) => item));
		top = [...top, ...evaluated].sort(compareInboxItems).slice(0, limit);
	}
	const counts = countsWithCoveringSections(list);
	const listed: ApprovalInboxTopItems["listed"] = {};
	for (const item of itemsWithCoveringSections(list)) {
		listed[item.type] = (listed[item.type] ?? 0) + 1;
	}
	return {
		counts,
		total: Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0),
		coveringCount: list.covering.reduce((total, section) => total + section.rows.length, 0),
		listed,
		items: top,
		warnings: list.warnings,
	};
}
