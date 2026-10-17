import type { PersonalDataCollector } from "../collector";
import { absencesCollector } from "./absences";
import { accountCollector } from "./account";
import { approvalsCollector } from "./approvals";
import { auditLogCollector } from "./audit-log";
import { drivingLicenceCollector } from "./driving-licence";
import { employmentCollector } from "./employment";
import { integrationsCollector } from "./integrations";
import { notificationsCollector } from "./notifications";
import { personnelFileCollector } from "./personnel-file";
import { planningCollector } from "./planning";
import { positionStampsCollector } from "./position-stamps";
import { timeCollector } from "./time";
import { travelExpensesCollector } from "./travel-expenses";

/**
 * Every category collector of a personal data export, in archive order. A new
 * category adds its collector here (and its key to `PERSONAL_DATA_CATEGORIES`).
 */
export const PERSONAL_DATA_COLLECTORS: readonly PersonalDataCollector[] = [
	employmentCollector,
	timeCollector,
	absencesCollector,
	planningCollector,
	approvalsCollector,
	travelExpensesCollector,
	personnelFileCollector,
	positionStampsCollector,
	notificationsCollector,
	integrationsCollector,
	auditLogCollector,
	drivingLicenceCollector,
	accountCollector,
];
