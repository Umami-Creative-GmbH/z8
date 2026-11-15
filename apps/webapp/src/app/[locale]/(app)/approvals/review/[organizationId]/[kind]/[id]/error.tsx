"use client";

import { useTranslate } from "@tolgee/react";
import { AppErrorState } from "@/components/errors/app-error-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";

export default function ApprovalReviewError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	const { t } = useTranslate();
	return (
		<AppErrorState
			variant="error"
			recovery="workspace"
			titleKey="errors.unexpected.title"
			titleDefault="Something went wrong"
			descriptionKey="errors.unexpected.description"
			descriptionDefault="We couldn't load this page right now. Please try again or return to a safe place in the app."
			digest={error.digest}
			onRetry={retry}
			actions={
				<Button asChild variant="outline">
					<Link href="/approvals/inbox">
						{t("approvals:approvals.openInbox", "Open Inbox")}
					</Link>
				</Button>
			}
		/>
	);
}
