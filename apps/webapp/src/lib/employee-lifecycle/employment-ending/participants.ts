import "server-only";

import { drivingLicenceEndingParticipant } from "@/lib/organization/driving-licence/employment-ending";
import { equipmentEndingParticipant } from "@/lib/organization/equipment/employment-ending";
import { documentRequestsEndingParticipant } from "@/lib/personnel-file/document-request-employment-ending";
import { reportShareLinksEndingParticipant } from "@/lib/projects/report-share/employment-ending";
import { kioskBadgesEndingParticipant } from "@/lib/time-tracking/kiosk/badge-employment-ending";
import { kioskFobsEndingParticipant } from "@/lib/time-tracking/kiosk/fob-employment-ending";
import { deputyAssignmentsEndingParticipant } from "./deputy-assignments";
import { officerGrantsEndingParticipant } from "./officer-grants";

/**
 * The Employment ending participants, in their fixed order (spec #1590).
 * Equipment runs first, because it captures the employee's teams and needs
 * the open employment period. Every cause runs every participant; adding one
 * means its adapter plus a line here.
 */
export const EMPLOYMENT_ENDING_PARTICIPANTS = [
	equipmentEndingParticipant,
	drivingLicenceEndingParticipant,
	officerGrantsEndingParticipant,
	documentRequestsEndingParticipant,
	kioskBadgesEndingParticipant,
	kioskFobsEndingParticipant,
	reportShareLinksEndingParticipant,
	deputyAssignmentsEndingParticipant,
] as const;
