import Image from "next/image";
import { v } from "@/components/theme/tokens";
import { detailedFeatures } from "./data";

export function DetailedFeatures() {
	return (
		<section id="detailed" className="relative z-10 px-8 py-28 lg:px-16">
			<div className="mx-auto max-w-6xl">
				<div className="mb-20 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						Im Detail
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						Gebaut f&uuml;r den Alltag.
					</h2>
				</div>

				<div className="space-y-32">
					{detailedFeatures.map((feat, i) => (
						<div
							key={i}
							className={`grid items-center gap-16 lg:grid-cols-2 ${i % 2 === 1 ? "direction-rtl" : ""}`}
						>
							<div className={i % 2 === 1 ? "order-2 lg:order-1" : ""}>
								<span
									className="mb-4 inline-block rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
									style={{ borderColor: v("borderStrong"), color: v("textTertiary") }}
								>
									{feat.tag}
								</span>
								<h3
									className="mb-5"
									style={{
										fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
										fontWeight: 700,
										lineHeight: 1.15,
										letterSpacing: "-0.025em",
									}}
								>
									{feat.title}
								</h3>
								<p className="max-w-md text-[15px] leading-[1.8]" style={{ color: v("textSecondary") }}>
									{feat.desc}
								</p>
								<a
									href="#contact"
									className="mt-6 inline-flex items-center gap-2 text-[14px] font-semibold transition-colors"
								>
									Mehr erfahren
									<span style={{ fontSize: "18px" }}>&rarr;</span>
								</a>
							</div>
							<div className={i % 2 === 1 ? "order-1 lg:order-2" : ""}>
								<div
									className="relative overflow-hidden rounded-2xl"
									style={{
										boxShadow: `0 20px 60px ${v("shadow")}, 0 4px 20px ${v("shadowSubtle")}`,
									}}
								>
									<Image
										src={feat.image}
										alt={feat.tag}
										width={800}
										height={500}
										className="h-auto w-full object-cover"
										style={{ aspectRatio: "8/5" }}
									/>
									<div
										className="absolute inset-0"
										style={{
											background: "linear-gradient(to top, rgba(26,26,26,0.15) 0%, transparent 40%)",
										}}
									/>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
