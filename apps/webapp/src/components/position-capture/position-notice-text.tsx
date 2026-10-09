"use client";

import { useTranslate } from "@tolgee/react";

export interface PositionNoticeTextProps {
	version: number;
	purposeStatement: string;
	/** The retention that applies now; never longer than the version's own retention. */
	retentionDays: number;
}

/**
 * The position notice an employee agrees to (#766, ADR 0004): Z8's fixed text
 * (template revision 1) plus the organization's purpose statement. Keys live in
 * `common` so the consent dialog on clock actions (#826) and the works-council
 * portal (#834) can render it outside the settings routes.
 */
export function PositionNoticeText({
	version,
	purposeStatement,
	retentionDays,
}: PositionNoticeTextProps) {
	const { t } = useTranslate();

	return (
		<div className="space-y-4 text-sm">
			<p className="text-muted-foreground">
				{t("common.positionNotice.version", "Position notice, version {version}", { version })}
			</p>
			<section className="space-y-1">
				<h3 className="font-medium">
					{t("common.positionNotice.purposeTitle", "Why your organization records positions")}
				</h3>
				<p className="whitespace-pre-line break-words">{purposeStatement}</p>
			</section>
			<section className="space-y-1">
				<h3 className="font-medium">{t("common.positionNotice.whatTitle", "What is recorded")}</h3>
				<p>
					{t(
						"common.positionNotice.what",
						"When you clock in, clock out, start or end a break in the Z8 web app on your device, your device's position is recorded with that clock event: latitude, longitude, how accurate the position is and when the device determined it. No address, altitude or speed is recorded, and nothing is recorded between clock events.",
					)}
				</p>
				<p>
					{t(
						"common.positionNotice.never",
						"Clock-outs done for you by someone else, automatic clock-outs, imports and corrections never carry a position. If your device cannot provide a position, your clock event is recorded without one, and nothing records why.",
					)}
				</p>
			</section>
			<section className="space-y-1">
				<h3 className="font-medium">
					{t("common.positionNotice.retentionTitle", "How long positions are kept")}
				</h3>
				<p>
					{t(
						"common.positionNotice.retention",
						"Each position is deleted {days, plural, one {# day} other {# days}} after it was recorded. Your clock events stay.",
						{ days: retentionDays },
					)}
				</p>
			</section>
			<section className="space-y-1">
				<h3 className="font-medium">
					{t("common.positionNotice.viewersTitle", "Who can see positions")}
				</h3>
				<p>
					{t(
						"common.positionNotice.viewers",
						"You can see your own positions. Organization owners and admins, and people explicitly given permission, can see them for a single work period, and every such view is logged for you to see. Being your manager does not give access. The works council never sees individual positions.",
					)}
				</p>
			</section>
			<section className="space-y-1">
				<h3 className="font-medium">{t("common.positionNotice.withdrawTitle", "Your choice")}</h3>
				<p>
					{t(
						"common.positionNotice.withdraw",
						"Positions are recorded only while you agree. You can withdraw at any time under Settings, Position stamps. Withdrawing stops recording and immediately deletes all your recorded positions. Whether you agree has no effect on your clock events.",
					)}
				</p>
			</section>
		</div>
	);
}
