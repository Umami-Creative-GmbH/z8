"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	agreeToPositionNoticeAction,
	declinePositionNoticeAction,
} from "@/app/[locale]/(app)/settings/position-stamps/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	answerPositionConsent,
	currentPositionConsentQuestion,
	registerPositionConsentHost,
	subscribePositionConsentQuestion,
} from "./position-consent-prompt";
import { PositionNoticeText } from "./position-notice-text";

function noQuestion() {
	return null;
}

/**
 * The consent dialog on the next clock action of an employee whose position
 * capture is switched on and who has not answered the current notice (#826).
 * Agree records consent; "Not now" is not asked again until a new notice
 * version. Either way, the clock action goes ahead. Mounted once in the app
 * layout; the keys live in `common` because clock controls appear on every page.
 */
export function PositionConsentDialogHost() {
	const { t } = useTranslate();
	const question = useSyncExternalStore(
		subscribePositionConsentQuestion,
		currentPositionConsentQuestion,
		noQuestion,
	);
	const [pending, setPending] = useState(false);

	useEffect(() => registerPositionConsentHost(), []);

	async function answer(decision: "agreed" | "declined") {
		if (!question) return;
		setPending(true);
		try {
			const input = { noticeId: question.notice.id };
			const result =
				decision === "agreed"
					? await agreeToPositionNoticeAction(input)
					: await declinePositionNoticeAction(input);
			// A failed save asks again next time; the clock action never waits on it.
			answerPositionConsent(result.success ? decision : "dismissed");
		} catch {
			answerPositionConsent("dismissed");
		} finally {
			setPending(false);
		}
	}

	return (
		<Dialog
			open={question !== null}
			onOpenChange={(open) => {
				if (!open && !pending) answerPositionConsent("dismissed");
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{t("common.positionConsent.title", "Record your position with clock events?")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"common.positionConsent.description",
							"Your organization asks to record your device's position when you clock in, clock out or take a break. Your clock event is recorded either way.",
						)}
					</DialogDescription>
				</DialogHeader>
				{question ? (
					<ScrollArea className="max-h-[50vh] pr-3">
						<PositionNoticeText
							version={question.notice.version}
							purposeStatement={question.notice.purposeStatement}
							retentionDays={question.retentionDays}
						/>
					</ScrollArea>
				) : null}
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						onClick={() => void answer("declined")}
					>
						{t("common.positionConsent.notNow", "Not now")}
					</Button>
					<Button type="button" disabled={pending} onClick={() => void answer("agreed")}>
						{t("common.positionConsent.agree", "Agree")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
