"use client";

import { useThemeTokens } from "@/components/theme/theme-context";

export function FinalCta() {
	const { t, dark } = useThemeTokens();

	return (
		<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
			<div
				className="noise mx-auto max-w-3xl rounded-3xl p-14 text-center"
				style={{ backgroundColor: t.ctaInvertBg, color: t.ctaInvertText, transition: "background-color 0.4s ease" }}
			>
				<span
					className="mb-4 inline-block rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em]"
					style={{ borderColor: t.ctaInvertBorder, color: t.ctaInvertMuted }}
				>
					Jetzt starten
				</span>
				<h2 className="mb-4 text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
					Bereit durchzustarten?
				</h2>
				<p className="mb-8 text-[15px]" style={{ color: t.ctaInvertMuted }}>
					Starten Sie kostenlos &mdash; keine Kreditkarte, kein Risiko. Kein Vertriebsgespr&auml;ch n&ouml;tig.
				</p>
				<div className="flex items-center justify-center gap-3">
					<a
						href="mailto:hello@z8.app"
						className="rounded-xl px-8 py-4 text-[14px] font-bold transition-all"
						style={{
							backgroundColor: dark ? "#0a0a0a" : "#fff",
							color: dark ? "#e8e8e8" : "#1a1a1a",
						}}
					>
						Kostenlos starten
					</a>
					<a
						href="mailto:hello@z8.app"
						className="rounded-xl px-8 py-4 text-[14px] font-medium transition-colors"
						style={{ border: `1px solid ${t.ctaInvertBorder}`, color: t.ctaInvertMuted }}
					>
						Demo anfragen
					</a>
				</div>
				<p className="mt-8 text-[12px]" style={{ color: t.ctaInvertFaint }}>
					Dauerhaft kostenlos f&uuml;r bis zu 10 Mitarbeiter &middot; Keine Kreditkarte &middot; DSGVO-konform
				</p>
			</div>
		</section>
	);
}
