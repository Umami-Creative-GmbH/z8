type RunOnboardingActionOptions<Result> = {
	action: () => Promise<Result>;
	onRejected: () => void;
	onResult: (result: Result) => boolean | undefined;
	setLoading: (loading: boolean) => void;
};

export async function runOnboardingAction<Result>({
	action,
	onRejected,
	onResult,
	setLoading,
}: RunOnboardingActionOptions<Result>) {
	setLoading(true);
	let outcome: { status: "resolved"; result: Result } | { status: "rejected" };

	try {
		outcome = { status: "resolved", result: await action() };
	} catch {
		outcome = { status: "rejected" };
	}

	let keepLoading = false;
	try {
		if (outcome.status === "resolved") {
			keepLoading = onResult(outcome.result) === true;
		} else {
			onRejected();
		}
	} finally {
		if (!keepLoading) {
			setLoading(false);
		}
	}
}
