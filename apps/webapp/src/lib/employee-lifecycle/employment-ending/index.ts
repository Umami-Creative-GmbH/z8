import "server-only";

import { createEmploymentEnding } from "./employment-ending";
import { EMPLOYMENT_ENDING_PARTICIPANTS } from "./participants";

/**
 * Employment ending (#1624, spec #1590): ends everything an employee holds
 * when their employment ends, for every cause. See `employment-ending.ts`.
 */
export const { endEmployment, previewEmploymentEnding, reactivationItems } = createEmploymentEnding(
	EMPLOYMENT_ENDING_PARTICIPANTS,
);
