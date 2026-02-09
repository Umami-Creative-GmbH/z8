"use client";

import { useThemeTokens } from "@/components/theme/theme-context";
import { footerLinks } from "./data";

export function Footer() {
	const { t } = useThemeTokens();

	return (
		<footer className="relative z-10 px-8 pb-8 pt-20 lg:px-16" style={{ borderTop: `1px solid ${t.border}`, transition: "border-color 0.4s ease" }}>
			<div className="mx-auto max-w-6xl">
				<div className="mb-16 grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
					<div>
						<span className="mb-4 block text-[24px] font-black tracking-[-0.02em]">Z8</span>
						<p className="mb-6 max-w-[220px] text-[14px] leading-relaxed" style={{ color: t.textMuted }}>
							Workforce Management f&uuml;r moderne Unternehmen. Zeiterfassung, Lohnexport und Analyse in einem.
						</p>
						<div className="flex gap-3">
							{["Li", "X", "GH"].map((social, i) => (
								<a
									key={i}
									href="#contact"
									className="flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-bold transition-all"
									style={{ border: `1px solid ${t.socialBorder}`, color: t.textTertiary }}
									onMouseOver={(e) => {
										e.currentTarget.style.backgroundColor = t.surface;
										e.currentTarget.style.color = t.surfaceText;
										e.currentTarget.style.borderColor = t.surface;
									}}
									onMouseOut={(e) => {
										e.currentTarget.style.backgroundColor = "transparent";
										e.currentTarget.style.color = t.textTertiary;
										e.currentTarget.style.borderColor = t.socialBorder;
									}}
								>
									{social}
								</a>
							))}
						</div>
					</div>
					{Object.entries(footerLinks).map(([category, links]) => (
						<div key={category}>
							<h4 className="mb-4 text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: t.textTertiary }}>
								{category}
							</h4>
							<ul className="space-y-2.5">
								{links.map((link) => (
									<li key={link}>
										<a
											href="#contact"
											className="text-[14px] transition-colors"
											style={{ color: t.textSecondary }}
											onMouseOver={(e) => e.currentTarget.style.color = t.footerHover}
											onMouseOut={(e) => e.currentTarget.style.color = t.textSecondary}
										>
											{link}
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				<div
					className="flex flex-col items-center justify-between gap-4 pt-8 md:flex-row"
					style={{ borderTop: `1px solid ${t.border}` }}
				>
					<div className="flex flex-wrap items-center gap-4 text-[13px]" style={{ color: t.textQuaternary }}>
						<span>&copy; 2025 Z8 GmbH</span>
						<span>&middot;</span>
						<a href="#contact" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = t.footerHover} onMouseOut={(e) => e.currentTarget.style.color = t.textQuaternary}>Datenschutz</a>
						<span>&middot;</span>
						<a href="#contact" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = t.footerHover} onMouseOut={(e) => e.currentTarget.style.color = t.textQuaternary}>AGB</a>
						<span>&middot;</span>
						<a href="#contact" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = t.footerHover} onMouseOut={(e) => e.currentTarget.style.color = t.textQuaternary}>Impressum</a>
					</div>
					<span className="flex items-center gap-1.5 text-[12px]" style={{ color: t.textQuaternary }}>
						<span className="inline-block h-2 w-2 rounded-full bg-[#27ca40]" />
						Alle Systeme operativ
					</span>
				</div>
			</div>
		</footer>
	);
}
