export async function runWithBusyState(
	setBusy: (busy: boolean) => void,
	action: () => Promise<void>,
) {
	setBusy(true);
	try {
		await action();
	} finally {
		setBusy(false);
	}
}
