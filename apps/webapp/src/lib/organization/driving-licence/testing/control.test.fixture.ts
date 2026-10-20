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
