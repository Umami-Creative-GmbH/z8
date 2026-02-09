import { v } from "@/components/theme/tokens";
import { howItWorksSteps } from "./data";

export function HowItWorks() {
	return (
		<section className="relative z-10 px-8 py-28 lg:px-16">
			<div className="mx-auto max-w-4xl">
				<div className="mb-16 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						So funktioniert&apos;s
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						In 3 Schritten startklar.
					</h2>
				</div>
				<div className="grid gap-0 md:grid-cols-3">
					{howItWorksSteps.map((s, i) => (
						<div key={i} className="relative px-8 py-10 text-center">
							{i < 2 && (
								<div
									className="absolute right-0 top-1/2 hidden h-px w-full -translate-y-1/2 md:block"
									style={{ backgroundColor: v("borderMedium"), left: "60%" }}
								/>
							)}
							<div
								className="relative z-10 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-[20px] font-extrabold"
								style={{ backgroundColor: v("surface"), color: v("surfaceText") }}
							>
								{s.step}
							</div>
							<h3 className="mb-2 text-[16px] font-bold">{s.title}</h3>
							<p className="text-[13px] leading-[1.7]" style={{ color: v("textMuted") }}>{s.desc}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
