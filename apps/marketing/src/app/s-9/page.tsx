import Image from "next/image";
import Link from "next/link";

export default function DesignS9() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Plus Jakarta Sans', 'General Sans', 'Switzer', sans-serif",
				backgroundColor: "#fef8f4",
				color: "#3a2828",
			}}
		>
			{/* Dawn gradient background */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"linear-gradient(170deg, #fef8f4 0%, #fce8d8 30%, #f8c8a8 60%, #f0a080 85%, #e88060 100%)",
					opacity: 0.4,
				}}
			/>

			{/* Horizon glow */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background: "radial-gradient(ellipse 100% 40% at 50% 100%, rgba(240,140,80,0.12) 0%, transparent 60%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-3">
					<span
						className="text-[22px] font-bold tracking-[-0.03em]"
						style={{
							background: "linear-gradient(135deg, #e87040, #d04820)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
				</div>
				<nav className="hidden items-center gap-8 text-[13px] font-medium md:flex" style={{ color: "#9a7868" }}>
					<a href="#features" className="transition-colors hover:text-[#d04820]">Funktionen</a>
					<a href="#warmth" className="transition-colors hover:text-[#d04820]">Vorteile</a>
					<a href="#contact" className="transition-colors hover:text-[#d04820]">Preise</a>
				</nav>
				<a
					href="#contact"
					className="rounded-full px-6 py-2.5 text-[13px] font-semibold transition-all hover:shadow-lg"
					style={{
						background: "linear-gradient(135deg, #e87040, #d04820)",
						color: "#fff",
					}}
				>
					Starten
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 flex min-h-[88vh] flex-col items-center justify-center px-8 text-center lg:px-16">
				{/* Sun circle */}
				<div
					className="animate-scale-in mb-12"
					style={{ animationDelay: "0s" }}
				>
					<div
						style={{
							width: 120,
							height: 120,
							borderRadius: "50%",
							background: "radial-gradient(circle, #f8a860 0%, #e87040 40%, rgba(232,112,64,0) 70%)",
							boxShadow: "0 0 80px rgba(232,112,64,0.3), 0 0 160px rgba(232,112,64,0.1)",
						}}
					/>
				</div>

				<p
					className="animate-fade-up text-[12px] font-semibold tracking-[0.25em] uppercase"
					style={{ color: "#c87850", animationDelay: "0.15s" }}
				>
					Ein neuer Tag beginnt
				</p>

				<h1
					className="animate-fade-up mt-6 text-[clamp(2.5rem,6vw,5rem)] font-bold leading-[1.08] tracking-[-0.04em]"
					style={{ color: "#3a2828", animationDelay: "0.3s" }}
				>
					Jeder Morgen.
					<br />
					<span
						style={{
							background: "linear-gradient(135deg, #e87040, #d04820)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Jede Minute.
					</span>
					<br />
					Zählt.
				</h1>

				<p
					className="animate-fade-up mx-auto mt-8 max-w-lg text-[16px] leading-[1.75]"
					style={{ color: "#8a6858", animationDelay: "0.45s" }}
				>
					Wie der erste Lichtstrahl am Horizont — Z8 bringt Wärme
					und Klarheit in Ihre tägliche Zeiterfassung.
				</p>

				<div className="animate-fade-up mt-10 flex items-center gap-4" style={{ animationDelay: "0.6s" }}>
					<a
						href="#contact"
						className="rounded-full px-8 py-3.5 text-[13px] font-bold transition-all hover:shadow-lg"
						style={{
							background: "linear-gradient(135deg, #e87040, #d04820)",
							color: "#fff",
						}}
					>
						Kostenlos testen
					</a>
					<a
						href="#features"
						className="rounded-full px-8 py-3.5 text-[13px] font-semibold transition-all hover:bg-white/70"
						style={{
							border: "2px solid rgba(208,72,32,0.2)",
							color: "#d04820",
						}}
					>
						Erkunden
					</a>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<h2
						className="text-center text-[clamp(1.8rem,3.5vw,2.8rem)] font-bold tracking-[-0.03em]"
						style={{ color: "#3a2828" }}
					>
						Warm. Klar. Einfach.
					</h2>

					<div className="mt-16 grid gap-6 md:grid-cols-3">
						{[
							{
								gradient: "linear-gradient(135deg, #fce8d8, #f8d0b0)",
								title: "Zeitstempel",
								desc: "Start und Stopp — so schnell wie ein Sonnenaufgang.",
							},
							{
								gradient: "linear-gradient(135deg, #f8d0b0, #f0b088)",
								title: "Berichte",
								desc: "Automatische Zusammenfassungen, die leuchten vor Klarheit.",
							},
							{
								gradient: "linear-gradient(135deg, #f0b088, #e89068)",
								title: "Teamwork",
								desc: "Alle Mitarbeiter auf einem Dashboard. In Echtzeit.",
							},
						].map((f) => (
							<div
								key={f.title}
								className="rounded-3xl p-8 transition-all hover:shadow-lg"
								style={{ background: f.gradient }}
							>
								<h3 className="text-[18px] font-bold" style={{ color: "#3a2828" }}>
									{f.title}
								</h3>
								<p className="mt-3 text-[14px] leading-[1.7]" style={{ color: "#6a4838" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 px-8 py-12 lg:px-16">
				<div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-56 overflow-hidden rounded-3xl">
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.7) brightness(1.05) sepia(0.1)" }} />
						</div>
					))}
				</div>
			</section>

			{/* Warmth section — testimonial */}
			<section id="warmth" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-3xl text-center">
					<div
						className="inline-block rounded-3xl px-12 py-10"
						style={{
							background: "linear-gradient(135deg, rgba(232,112,64,0.08), rgba(208,72,32,0.05))",
							border: "1px solid rgba(208,72,32,0.1)",
						}}
					>
						<blockquote
							className="text-[clamp(1.3rem,2.5vw,1.8rem)] font-medium leading-[1.5]"
							style={{ color: "#5a3828" }}
						>
							&ldquo;Z8 hat unseren Morgen verändert. Kein Stress mehr,
							keine Zettel — nur Klarheit ab dem ersten Kaffee.&rdquo;
						</blockquote>
						<p className="mt-6 text-[13px] font-semibold" style={{ color: "#c87850" }}>
							— Sarah K., Teamleiterin
						</p>
					</div>
				</div>
			</section>

			{/* Stats */}
			<section className="relative z-10 px-8 py-16 lg:px-16">
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-8">
					{[
						{ val: "10k+", label: "Nutzer" },
						{ val: "98%", label: "Zufriedenheit" },
						{ val: "30s", label: "Setup" },
						{ val: "24/7", label: "Support" },
					].map((s) => (
						<div key={s.label} className="text-center">
							<div
								className="text-[clamp(1.5rem,3vw,2.5rem)] font-bold"
								style={{
									background: "linear-gradient(135deg, #e87040, #d04820)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								{s.val}
							</div>
							<div className="mt-1 text-[11px] font-semibold tracking-[0.15em] uppercase" style={{ color: "#9a7868" }}>
								{s.label}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<h2
					className="text-[clamp(2rem,4vw,3.2rem)] font-bold leading-[1.1] tracking-[-0.03em]"
					style={{ color: "#3a2828" }}
				>
					Der Tag wartet nicht.
				</h2>
				<a
					href="#"
					className="mt-10 rounded-full px-10 py-4 text-[14px] font-bold transition-all hover:shadow-lg"
					style={{
						background: "linear-gradient(135deg, #e87040, #d04820)",
						color: "#fff",
					}}
				>
					Jetzt starten
				</a>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(208,72,32,0.1)" }}>
				<div className="flex items-center justify-between">
					<span className="text-[12px]" style={{ color: "#b8a090" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[12px] transition-colors hover:text-[#d04820]" style={{ color: "#b8a090" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
