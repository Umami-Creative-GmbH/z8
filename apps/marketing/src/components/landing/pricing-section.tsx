import { v } from "@/components/theme/tokens";
import type { LandingCopy } from "@/i18n/landing-copy";

type PricingSectionProps = {
	copy: LandingCopy["pricing"];
};

export function PricingSection({ copy }: PricingSectionProps) {
	return (
		<section
			id="pricing"
			className="relative z-10 px-8 py-28 lg:px-16"
			style={{ backgroundColor: v("bgAlt"), transition: "background-color 0.4s ease" }}
		>
			<div className="mx-auto max-w-5xl">
				<div className="mb-16 text-center">
					<span
						className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]"
						style={{ color: v("textTertiary") }}
					>
						{copy.eyebrow}
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">{copy.title}</h2>
					<p
						className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed"
						style={{ color: v("textMuted") }}
					>
						{copy.description}
					</p>
				</div>

				<div className="mx-auto max-w-2xl">
					<div
						className="relative overflow-hidden rounded-3xl p-8 text-center sm:p-10"
						style={{
							border: `1px solid ${v("borderMedium")}`,
							backgroundColor: v("cardBg"),
							boxShadow: `0 20px 60px ${v("shadowLight")}`,
							transition: "background-color 0.4s ease, border-color 0.4s ease",
						}}
					>
						<p
							className="mb-8 rounded-full px-4 py-2 text-[13px] font-bold uppercase tracking-[0.08em]"
							style={{ backgroundColor: v("badgeBg"), color: v("badgeText") }}
						>
							{copy.offer.trial}
						</p>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="rounded-2xl p-6" style={{ border: `1px solid ${v("borderMedium")}` }}>
								<div className="text-[clamp(2rem,4vw,3rem)] font-extrabold tracking-[-0.03em]">
									{copy.offer.monthly}
								</div>
							</div>
							<div className="rounded-2xl p-6" style={{ border: `1px solid ${v("borderMedium")}` }}>
								<div className="text-[clamp(2rem,4vw,3rem)] font-extrabold tracking-[-0.03em]">
									{copy.offer.yearly}
								</div>
							</div>
						</div>

						<p className="mt-6 text-[13px]" style={{ color: v("textTertiary") }}>
							{copy.offer.taxNote}
						</p>

						<a
							href="#contact"
							className="mx-auto mt-8 block max-w-xs rounded-xl py-3.5 text-center text-[14px] font-bold transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
							style={{ backgroundColor: v("surface"), color: v("surfaceText") }}
						>
							{copy.offer.cta}
						</a>
					</div>
				</div>
			</div>
		</section>
	);
}
