/**
 * German statutory foundation (#1988, spec #1934): baselines, organization warning tiers,
 * per-employee statutory context, the shared finding shape, audited acknowledgements and the
 * wage-redaction boundary. Monitors (#1989–#1993) build on these; see `CONTEXT.md` nearby.
 */
export {
	isStatutoryAcknowledgementKind,
	type StatutoryAcknowledgementKind,
	statutoryAcknowledgementKindDomains,
	statutoryAcknowledgementKinds,
} from "./acknowledgement-kinds";
export {
	attachAcknowledgementStates,
	listStatutoryAcknowledgements,
	loadStatutoryAcknowledgementStates,
	recordStatutoryAcknowledgement,
	type StatutoryAcknowledgementRecord,
	type StatutoryAcknowledgementRefusal,
	type StatutoryAcknowledgementState,
	type StatutoryAcknowledgementStates,
	type StatutoryAcknowledgementSubject,
	statutoryAcknowledgementSubjectOf,
} from "./acknowledgements";
export {
	type EmployeeContextRefusal,
	listApprenticeReleases,
	listEmployeeStatutoryOffsets,
	listEmployeeStudyPeriods,
	type RecordEmployeeStatutoryOffsetInput,
	recordApprenticeRelease,
	recordEmployeeStatutoryOffset,
	recordEmployeeStudyPeriod,
	voidApprenticeRelease,
	voidEmployeeStatutoryOffset,
	voidEmployeeStudyPeriod,
} from "./employee-context";
export { loadEmployeeInOrganization } from "./employee-scope";
export {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutoryFindingAcknowledgement,
	type StatutoryFindingAdminDetail,
	type StatutoryFindingSummary,
	type StatutoryQuantity,
	type StatutorySeverity,
	type StatutoryUsageTier,
	severityOfUsageTier,
	statutoryFindingId,
} from "./finding";
export { statutoryInputFingerprint } from "./fingerprint";
export {
	DEFAULT_STATUTORY_PREFERENCES,
	type LoadedStatutoryPreferences,
	loadOrganizationStatutoryPreferences,
	type StatutoryPreferenceRefusal,
	type StatutoryPreferences,
	saveOrganizationStatutoryPreferences,
	validateStatutoryPreferences,
} from "./preferences";
export {
	isEarningsDerivedFinding,
	loadStatutoryAudience,
	type RedactedStatutoryFinding,
	restrictedSummary,
	redactStatutoryFinding,
	redactStatutoryFindings,
	redactStatutoryThresholds,
	type StatutoryAudience,
	statutoryAudienceOf,
} from "./redaction";
export {
	isMoneyThreshold,
	isStatutoryThresholdKey,
	type StatutoryDomain,
	type StatutoryThresholdKey,
	type StatutoryThresholdUnit,
	statutoryDomains,
	statutoryThresholdCatalog,
	statutoryThresholdKeys,
} from "./threshold-catalog";
export {
	buildStatutoryThresholdTable,
	loadStatutoryThresholds,
	resolveStatutoryThreshold,
	type StatutoryThresholdReader,
	type StatutoryThresholdRow,
	type StatutoryThresholdSegment,
	type StatutoryThresholdTable,
} from "./thresholds";
