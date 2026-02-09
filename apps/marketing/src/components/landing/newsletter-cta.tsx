"use client";

import { useThemeTokens } from "@/components/theme/theme-context";

export function NewsletterCta() {
	const { t, dark } = useThemeTokens();

	return (
		<section className="relative z-10 px-8 py-16 lg:px-16">
			<div
				className="mx-auto max-w-4xl overflow-hidden rounded-3xl"
				style={{ backgroundColor: t.ctaInvertBg, transition: "background-color 0.4s ease" }}
			>
				<div className="grid items-center gap-8 p-12 lg:grid-cols-2 lg:p-16">
					<div>
						<h2
							className="mb-3"
							style={{
								fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
								fontWeight: 700,
								letterSpacing: "-0.02em",
								lineHeight: 1.2,
								color: t.ctaInvertText,
							}}
						>
							Immer auf dem Laufenden.
						</h2>
						<p className="text-[14px] leading-relaxed" style={{ color: t.ctaInvertMuted }}>
							Produktupdates, Branchen-Insights und Best Practices f&uuml;r Zeiterfassung &mdash; direkt in Ihr Postfach. Kein Spam, jederzeit abmeldbar.
						</p>
					</div>
					<div>
						<div className="flex gap-3">
							<div className="relative flex-1">
								<input
									type="email"
									placeholder="name@firma.de"
									className="w-full rounded-xl border-0 px-5 py-4 text-[14px] outline-none"
									style={{
										backgroundColor: dark ? "#252525" : "#2a2a2a",
										color: dark ? "#e8e8e8" : "#fff",
									}}
									readOnly
								/>
							</div>
							<button
								type="button"
								className="flex-shrink-0 rounded-xl px-6 py-4 text-[14px] font-bold transition-all"
								style={{
									backgroundColor: dark ? "#0a0a0a" : "#fff",
									color: dark ? "#e8e8e8" : "#1a1a1a",
								}}
							>
								Abonnieren
							</button>
						</div>
						<p className="mt-3 text-[11px]" style={{ color: t.ctaInvertFaint }}>
							Kein Spam. Maximal 2&times; pro Monat. Jederzeit abmeldbar.
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
