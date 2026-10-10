import { db } from "@/db";
import {
	type AbsenceCategoryNoticesResult,
	deliverAbsenceCategoryNotices,
} from "@/lib/absences/category-notices";

export interface AbsenceCategoryNoticesJobResult extends AbsenceCategoryNoticesResult {
	success: true;
}

/**
 * Tells the owners and admins of organizations that existed before time off in lieu (#1000)
 * once that it is available. Pending notices come from migration 0188; with none left the
 * job only finds nothing to do.
 */
export async function runAbsenceCategoryNoticesJob(): Promise<AbsenceCategoryNoticesJobResult> {
	const result = await deliverAbsenceCategoryNotices(db);
	return { success: true, ...result };
}
