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

				<div className="grid gap-6 md:grid-cols-3">
					{copy.plans.map((plan) => (
						<div
							key={plan.id}
							className="relative rounded-2xl p-8 transition-all hover:-translate-y-1"
							style={{
								border: plan.highlighted
									? `2px solid ${v("surface")}`
									: `1px solid ${v("borderMedium")}`,
								backgroundColor: v("cardBg"),
								boxShadow: plan.highlighted ? `0 20px 60px ${v("shadowLight")}` : "none",
								transition: "background-color 0.4s ease, border-color 0.4s ease",
							}}
						>
							{plan.highlighted && (
								<div
									className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[10px] font-bold uppercase tracking-[0.1em]"
									style={{ backgroundColor: v("surface"), color: v("surfaceText") }}
								>
									{copy.highlightBadge}
								</div>
							)}
							<div className="mb-6">
								<h3 className="mb-1 text-[18px] font-bold">{plan.name}</h3>
								<p className="text-[13px]" style={{ color: v("textTertiary") }}>
									{plan.desc}
								</p>
							</div>
							<div className="mb-6">
								<span className="text-[clamp(2rem,4vw,3rem)] font-extrabold tracking-[-0.03em]">
									{plan.priceKind === "numeric" ? copy.currencyPrefix : ""}
									{plan.price}
								</span>
								<span className="ml-1 text-[13px]" style={{ color: v("textTertiary") }}>
									{plan.period}
								</span>
							</div>
							<ul className="mb-8 space-y-3">
								{plan.features.map((f) => (
									<li
										key={f}
										className="flex items-start gap-2.5 text-[14px]"
										style={{ color: v("textFaint") }}
									>
										<span
											className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
											style={{ backgroundColor: v("badgeBg"), color: v("badgeText") }}
										>
											&#10003;
										</span>
										{f}
									</li>
								))}
							</ul>
							<a
								href="#contact"
								className="block rounded-xl py-3.5 text-center text-[14px] font-bold transition-all"
								style={{
									backgroundColor: plan.highlighted ? v("surface") : "transparent",
									color: plan.highlighted ? v("surfaceText") : v("text"),
									border: plan.highlighted ? "none" : `1px solid ${v("borderStrong")}`,
								}}
							>
								{plan.cta}
							</a>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
