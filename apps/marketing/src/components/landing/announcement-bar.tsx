import { v } from "@/components/theme/tokens";
import type { LandingCopy } from "@/i18n/landing-copy";

type AnnouncementBarProps = {
	copy: LandingCopy["announcement"];
};

export function AnnouncementBar({ copy }: AnnouncementBarProps) {
	return (
		<div
			className="relative z-20 flex items-center justify-center gap-2 py-2.5 text-[12px]"
			style={{
				backgroundColor: v("bgAlt"),
				borderBottom: `1px solid ${v("border")}`,
				transition: "background-color 0.4s ease, border-color 0.4s ease",
			}}
		>
			<span
				className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
				style={{
					backgroundColor: v("surface"),
					color: v("surfaceText"),
					transition: "background-color 0.4s ease",
				}}
			>
				{copy.badge}
			</span>
			<span style={{ color: v("textSecondary"), transition: "color 0.4s ease" }}>{copy.text}</span>
			<span style={{ color: v("textTertiary") }}>&rsaquo;</span>
		</div>
	);
}
