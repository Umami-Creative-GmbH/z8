"use client";

import { createContext, use } from "react";

export const ReportReadScope = createContext<readonly string[]>([]);

/** Keep existing invalidation prefixes without reusing a retired RSC arrival. */
export function useReportQueryKey(key: readonly unknown[]) {
	return [...key, ...use(ReportReadScope)];
}
