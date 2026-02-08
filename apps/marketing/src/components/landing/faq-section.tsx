import { v } from "@/components/theme/tokens";
import { faqs } from "./data";

export function FaqSection() {
	return (
		<section id="faq" className="relative z-10 px-8 py-28 lg:px-16" style={{ backgroundColor: v("bgAlt"), transition: "background-color 0.4s ease" }}>
			<div className="mx-auto max-w-2xl">
				<div className="mb-14 text-center">
					<span className="mb-3 block text-[12px] font-bold uppercase tracking-[0.15em]" style={{ color: v("textTertiary") }}>
						FAQ
					</span>
					<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
						H&auml;ufig gestellte Fragen.
					</h2>
				</div>
				<div className="space-y-3">
					{faqs.map((faq, i) => (
						<details
							key={i}
							className="group rounded-2xl transition-all"
							style={{ border: `1px solid ${v("border")}`, backgroundColor: v("cardBg"), transition: "background-color 0.4s ease" }}
						>
							<summary className="flex cursor-pointer items-center justify-between px-7 py-5 text-[15px] font-semibold marker:content-[''] [&::-webkit-details-marker]:hidden">
								{faq.q}
								<span
									className="ml-4 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[14px] transition-transform group-open:rotate-45"
									style={{ backgroundColor: v("badgeBg") }}
								>
									+
								</span>
							</summary>
							<div className="px-7 pb-6 text-[14px] leading-[1.8]" style={{ color: v("textSecondary") }}>
								{faq.a}
							</div>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
