type ActivationPolicy = {
	intervalMonths: number;
	timezone: string;
	/** Saved on the policy tab after the switch-on when given and not the default 30 and 7. */
	reminderLeadDays?: number[];
	retentionMonths: number;
	retentionJustification: string;
};

/**
 * Switches driving licence control on as the Features card does (#1421), then saves other
 * reminder lead times on the policy tab. Returns the first refused result, else the last.
 */
export async function activateDrivingLicenceControl(policy: ActivationPolicy) {
	const actions = await import("../policy-actions");
	const { reminderLeadDays, ...setup } = policy;
	const switched = await actions.switchDrivingLicenceControlAction({ enabled: true, setup });
	if (!switched.success || !reminderLeadDays || reminderLeadDays.join() === "30,7")
		return switched;
	return actions.saveDrivingLicencePolicyAction({ ...setup, reminderLeadDays });
}

/**
 * Intended-driver saves as the settings screen makes them (#1425): preview first, then save
 * with the confirmed preview token. A refused preview is returned as the result.
 */
export async function saveConfirmedIntendedDriverAssignment(input: Record<string, unknown>) {
	const actions = await import("../intended-driver-actions");
	const preview = await actions.previewDrivingLicenceIntendedDriverAssignmentAction(input);
	if (!preview.success) return preview;
	return actions.setDrivingLicenceIntendedDriverAssignmentAction({
		...input,
		previewToken: preview.data.previewToken,
	});
}

/** Removes an intended-driver assignment after previewing it, as the settings screen does. */
export async function removeConfirmedIntendedDriverAssignment(input: { assignmentId: string }) {
	const actions = await import("../intended-driver-actions");
	const preview = await actions.previewDrivingLicenceIntendedDriverRemovalAction(input);
	if (!preview.success) return preview;
	return actions.removeDrivingLicenceIntendedDriverAssignmentAction({
		...input,
		previewToken: preview.data.previewToken,
	});
}
