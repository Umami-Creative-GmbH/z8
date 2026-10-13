import type { PersonalDataCollector } from "../collector";
import { accountCollector } from "./account";
import { employmentCollector } from "./employment";
import { integrationsCollector } from "./integrations";
import { notificationsCollector } from "./notifications";
import { positionStampsCollector } from "./position-stamps";

/**
 * Every category collector of a personal data export, in archive order. A new
 * category adds its collector here (and its key to `PERSONAL_DATA_CATEGORIES`).
 */
export const PERSONAL_DATA_COLLECTORS: readonly PersonalDataCollector[] = [
	employmentCollector,
	positionStampsCollector,
	notificationsCollector,
	integrationsCollector,
	accountCollector,
];
