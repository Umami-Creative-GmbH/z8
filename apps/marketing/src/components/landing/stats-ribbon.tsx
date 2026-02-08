"use client";

import { useThemeTokens } from "@/components/theme/theme-context";
import { stats } from "./data";

export function StatsRibbon() {
	const { dark } = useThemeTokens();

	return (
		<section className="relative z-10" style={{ backgroundColor: dark ? "#e8e8e8" : "#1a1a1a", transition: "background-color 0.4s ease" }}>
			<div className="mx-auto grid max-w-6xl grid-cols-2 gap-px lg:grid-cols-4" style={{ backgroundColor: dark ? "#ccc" : "#333" }}>
				{stats.map((s, i) => (
					<div
						key={i}
						className="animate-count-up flex flex-col items-center justify-center px-6 py-12 text-center"
						style={{ backgroundColor: dark ? "#e8e8e8" : "#1a1a1a", animationDelay: `${0.1 + i * 0.12}s`, transition: "background-color 0.4s ease" }}
					>
						<span className="text-[clamp(2rem,4vw,3.2rem)] font-extrabold tracking-[-0.03em]" style={{ color: dark ? "#0a0a0a" : "#fff" }}>
							{s.value}
						</span>
						<span className="mt-1 text-[13px] font-semibold" style={{ color: dark ? "#555" : "#999" }}>{s.label}</span>
						<span className="mt-0.5 text-[11px]" style={{ color: dark ? "#888" : "#555" }}>{s.sub}</span>
					</div>
				))}
			</div>
		</section>
	);
}
