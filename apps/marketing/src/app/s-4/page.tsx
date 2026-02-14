import Image from "next/image";
import Link from "next/link";

export default function DesignS4() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'DM Serif Display', 'Libre Baskerville', 'Lora', Georgia, serif",
				backgroundColor: "#faf4ee",
				color: "#3a2820",
			}}
		>
			{/* Warm ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 60% 40% at 80% 0%, rgba(200,120,60,0.06) 0%, transparent 50%), radial-gradient(ellipse 50% 50% at 10% 100%, rgba(180,100,50,0.04) 0%, transparent 50%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: "#b85c30" }}>
						Z8
					</span>
					<span className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "#b89878" }}>
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[12px] font-medium md:flex" style={{ color: "#9a7a60" }}>
					<a href="#features" className="transition-colors hover:text-[#b85c30]">Funktionen</a>
					<a href="#story" className="transition-colors hover:text-[#b85c30]">Geschichte</a>
					<a href="#contact" className="transition-colors hover:text-[#b85c30]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="rounded-none px-6 py-2.5 text-[11px] font-bold tracking-[0.1em] uppercase transition-all hover:bg-[#b85c30] hover:text-[#faf4ee]"
					style={{ border: "2px solid #b85c30", color: "#b85c30" }}
				>
					Starten
				</a>
			</header>

			{/* Hero — editorial split */}
			<section className="relative z-10 min-h-[90vh] px-8 lg:px-16">
				<div className="flex min-h-[90vh] flex-col justify-center lg:flex-row lg:items-center lg:gap-20">
					{/* Left — text */}
					<div className="max-w-xl flex-1">
						<div
							className="animate-fade-up mb-6 h-1 w-16"
							style={{ backgroundColor: "#b85c30", animationDelay: "0s" }}
						/>
						<p
							className="animate-fade-up text-[11px] font-bold tracking-[0.25em] uppercase"
							style={{ color: "#b89878", animationDelay: "0.1s" }}
						>
							Handwerk trifft Technologie
						</p>
						<h1
							className="animate-fade-up mt-6 text-[clamp(2.8rem,6vw,5rem)] leading-[1.05] tracking-[-0.02em]"
							style={{ color: "#3a2820", animationDelay: "0.25s" }}
						>
							Zeit hat eine
							<br />
							<em style={{ color: "#b85c30" }}>Wärme</em>,
							<br />
							wenn man sie
							<br />
							versteht.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[16px] leading-[1.8]"
							style={{
								color: "#7a5a40",
								animationDelay: "0.4s",
								fontFamily: "'DM Sans', 'General Sans', sans-serif",
							}}
						>
							Wie ein guter Ton, geformt von Hand — Z8 gibt Ihrer Arbeitszeit
							Form und Struktur. Warm, ehrlich und beständig.
						</p>
						<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.55s" }}>
							<a
								href="#contact"
								className="px-8 py-3.5 text-[12px] font-bold tracking-[0.1em] uppercase transition-all hover:shadow-lg"
								style={{ backgroundColor: "#b85c30", color: "#faf4ee" }}
							>
								Kostenlos testen
							</a>
							<a
								href="#features"
								className="text-[12px] font-bold tracking-[0.1em] uppercase transition-colors hover:text-[#b85c30]"
								style={{ color: "#b89878" }}
							>
								Entdecken →
							</a>
						</div>
					</div>

					{/* Right — terracotta arch with image */}
					<div className="animate-scale-in mt-16 hidden flex-1 items-center justify-center lg:mt-0 lg:flex" style={{ animationDelay: "0.5s" }}>
						<div className="relative">
							{/* Arch shape with image */}
							<div
								style={{
									width: 300,
									height: 420,
									borderRadius: "150px 150px 0 0",
									position: "relative",
									overflow: "hidden",
								}}
							>
								<Image
									src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover"
									style={{ filter: "saturate(0.5) sepia(0.25) contrast(1.05)" }}
								/>
								{/* Terracotta overlay tint */}
								<div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(200,112,64,0.15), rgba(184,92,48,0.25))" }} />
							</div>
							{/* Shadow */}
							<div
								style={{
									position: "absolute",
									bottom: -12,
									left: 20,
									right: 20,
									height: 24,
									background: "radial-gradient(ellipse, rgba(60,30,15,0.12) 0%, transparent 70%)",
								}}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* Features — tiles */}
			<section id="features" className="relative z-10 px-8 py-32 lg:px-16" style={{ backgroundColor: "#f2e8dc" }}>
				<div className="mx-auto max-w-5xl">
					<h2
						className="text-[clamp(1.8rem,3.5vw,2.8rem)] tracking-[-0.02em]"
						style={{ color: "#3a2820" }}
					>
						Geformt für den Alltag
					</h2>

					<div className="mt-16 grid gap-8 md:grid-cols-2">
						{[
							{ title: "Stempeluhr", desc: "Start und Stopp mit einem Tippen. So einfach wie ein Lichtschalter." },
							{ title: "Stundenzettel", desc: "Automatisch generiert, immer aktuell, bereit zum Export." },
							{ title: "Projekte", desc: "Zeiten nach Projekt erfassen und zuordnen. Ohne Umwege." },
							{ title: "Übersicht", desc: "Ihr Dashboard zeigt, was zählt. Keine Ablenkung." },
						].map((f, i) => (
							<div
								key={f.title}
								className="p-8"
								style={{
									backgroundColor: "#faf4ee",
									borderLeft: i % 2 === 0 ? "4px solid #b85c30" : "4px solid #d4a880",
								}}
							>
								<h3 className="text-[20px] tracking-[-0.01em]" style={{ color: "#3a2820" }}>
									{f.title}
								</h3>
								<p
									className="mt-3 text-[14px] leading-[1.7]"
									style={{
										color: "#7a5a40",
										fontFamily: "'DM Sans', 'General Sans', sans-serif",
									}}
								>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 my-16 lg:mx-16">
				<div className="grid gap-6 md:grid-cols-3">
					{[
						"https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1497215842964-222b430dc094?w=600&q=80&auto=format&fit=crop",
						"https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop",
					].map((src, i) => (
						<div key={i} className="relative h-64 overflow-hidden">
							<Image src={src} alt="" fill className="object-cover" style={{ filter: "saturate(0.4) sepia(0.3) contrast(1.05)" }} />
						</div>
					))}
				</div>
			</section>

			{/* Quote */}
			<section id="story" className="relative z-10 flex flex-col items-center px-8 py-32 text-center lg:px-16">
				<blockquote
					className="max-w-2xl text-[clamp(1.5rem,3vw,2.2rem)] italic leading-[1.4] tracking-[-0.01em]"
					style={{ color: "#5a3a28" }}
				>
					&ldquo;Die beste Technologie ist die, die man nicht bemerkt —
					die einfach funktioniert, wie ein warmer Raum.&rdquo;
				</blockquote>
				<div className="mt-8 h-1 w-12" style={{ backgroundColor: "#b85c30" }} />
			</section>

			{/* CTA */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16" style={{ backgroundColor: "#c87040" }}>
				<div className="mx-auto flex max-w-3xl flex-col items-center text-center">
					<h2
						className="text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.02em]"
						style={{ color: "#faf4ee" }}
					>
						Formen Sie Ihre Zeit.
					</h2>
					<a
						href="#"
						className="mt-10 px-10 py-4 text-[12px] font-bold tracking-[0.15em] uppercase transition-all hover:bg-[#faf4ee] hover:text-[#b85c30]"
						style={{ border: "2px solid #faf4ee", color: "#faf4ee" }}
					>
						Jetzt starten
					</a>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #e0d0c0" }}>
				<div className="flex items-center justify-between">
					<span className="text-[11px]" style={{ color: "#b89878" }}>
						© 2025 Z8
					</span>
					<Link href="/" className="text-[11px] transition-colors hover:text-[#b85c30]" style={{ color: "#b89878" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
