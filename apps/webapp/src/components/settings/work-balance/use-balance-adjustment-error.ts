"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { useCallback, useMemo } from "react";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { BalanceAdjustmentErrorCode } from "@/lib/work-balance/adjustments/types";
import {
	BALANCE_ADJUSTMENT_FAILED,
	balanceAdjustmentRefusals,
} from "./balance-adjustment-refusals";

/**
 * Translates a balance adjustment refusal code for a toast; a `month_closed`
 * refusal names the closed month when it is known.
 */
export function useBalanceAdjustmentErrorMessage() {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const refusals = useMemo(() => balanceAdjustmentRefusals(locale), [locale]);
	return useCallback(
		(
			code: BalanceAdjustmentErrorCode | null,
			details: { closedMonth?: string | null } = {},
		): string =>
			actionErrorMessage(
				t,
				{ code, closedMonth: details.closedMonth },
				refusals,
				BALANCE_ADJUSTMENT_FAILED,
			),
		[t, refusals],
	);
}
