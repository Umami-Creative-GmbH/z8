import { v } from "@/components/theme/tokens";

export function AnnouncementBar() {
	return (
		<div
			className="relative z-20 flex items-center justify-center gap-2 py-2.5 text-[12px]"
			style={{ backgroundColor: v("bgAlt"), borderBottom: `1px solid ${v("border")}`, transition: "background-color 0.4s ease, border-color 0.4s ease" }}
		>
			<span
				className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
				style={{ backgroundColor: v("surface"), color: v("surfaceText"), transition: "background-color 0.4s ease" }}
			>
				Neu
			</span>
			<span style={{ color: v("textSecondary"), transition: "color 0.4s ease" }}>
				Z8 v4 ist da: Schneller, sch&ouml;ner, smarter.
			</span>
			<span style={{ color: v("textTertiary") }}>&rsaquo;</span>
		</div>
	);
}
