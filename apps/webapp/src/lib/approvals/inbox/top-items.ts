import { type ApprovalTriagePolicy, getEffectiveApprovalTriagePolicy } from "../triage-policy";
import {
	type ApprovalInboxListParams,
	type ApprovalInboxListReadOptions,
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
import type { ApprovalInboxItem, ApprovalInboxListResult } from "./types";

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
	/** The first `limit` pending items, own and covered, in the inbox's order. */
	items: ApprovalInboxItem[];
	/** Sources whose list or count failed: their items or counts are missing above. */
	warnings: ApprovalInboxListResult["warnings"];
}

const itemKey = (type: string, id: string) => `${type}:${id}`;

/**
 * The viewer's pending work and its most urgent items, exactly as the inbox orders them
 * (#1978), for a surface that shows only a few, such as the Dashboard.
 *
 * Risk orders the inbox first, and current evidence (coverage, payroll, correction facts)
 * sets the risk of absences, absence changes and time corrections. Evidence costs queries per
 * item, so it is read only for the items that could still reach the first `limit`: evidence
 * never lowers an item below "high" before it is read, so an item is evaluated, best case
 * first, until the `limit` items already known outrank the next one's best case. Every other
 * kind's risk needs no evidence. The rows themselves are read as the inbox reads them, one
 * query per source as the badge does, so the counts stay the badge's.
 *
 * Candidates are the rows the inbox itself can list: every legacy-source item; the first 101
 * rows of each canonical read and of the compliance exceptions, in their pre-evidence order
 * (the inbox's own page cap); and each "Covering for" section's first 100 rows, also chosen
 * in pre-evidence order. A covered item past its section's 100 rows is never previewed, just
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
	const list = await (options.readList ?? getApprovalInboxList)(
		// No page limit, so no unevaluated order cuts off a legacy item; canonical and
		// compliance reads still return at most their first 101 rows.
		{ ...params, status: "pending", limit: Number.MAX_SAFE_INTEGER },
		{
			now,
			triagePolicy: policy,
			loadTriageEvidence: async (target) => {
				if (target.requestKind !== "other") {
					deferred.set(itemKey(target.type, target.context.requestId), target);
				}
				return { context: target.context, evidence: [] };
			},
		},
	);
	const candidates = itemsWithCoveringSections(list);
	const pending = candidates
		.flatMap((item) => {
			const target = deferred.get(itemKey(item.type, item.id));
			if (!target) return [];
			const best = { ...item, triage: { ...item.triage, riskLevel: "high" as const } };
			return [{ item, target, best }];
		})
		.sort((left, right) => compareInboxItems(left.best, right.best));
	let top = candidates.filter((item) => !deferred.has(itemKey(item.type, item.id))).slice(0, limit);
	let next = 0;
	while (next < pending.length) {
		const last = top.length >= limit ? top[limit - 1] : undefined;
		if (last && compareInboxItems(last, pending[next].best) < 0) break;
		const batch = pending.slice(next, next + limit);
		next += batch.length;
		const evaluated = await Promise.all(
			batch.map(async ({ item, target }) => ({
				...item,
				triage: await resolveApprovalInboxTriage({ target, now, policy, loadEvidence }),
			})),
		);
		top = [...top, ...evaluated].sort(compareInboxItems).slice(0, limit);
	}
	const counts = countsWithCoveringSections(list);
	return {
		counts,
		total: Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0),
		coveringCount: (list.covering ?? []).reduce((total, section) => total + section.rows.length, 0),
		items: top,
		warnings: list.warnings,
	};
}
