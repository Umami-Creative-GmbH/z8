import type { PersonalDataCollector } from "../collector";
import { employmentCollector } from "./employment";

/**
 * Every category collector of a personal data export, in archive order. A new
 * category adds its collector here (and its key to `PERSONAL_DATA_CATEGORIES`).
 */
export const PERSONAL_DATA_COLLECTORS: readonly PersonalDataCollector[] = [employmentCollector];
