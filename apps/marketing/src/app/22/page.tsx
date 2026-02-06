import Image from "next/image";
import Link from "next/link";

export default function Design22() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Futura', 'Century Gothic', 'Trebuchet MS', sans-serif",
				backgroundColor: "#0e0806",
				color: "#f0e8e0",
			}}
		>
			{/* Magma glow background */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 70% 50% at 30% 80%, rgba(180,50,10,0.12) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 70% 20%, rgba(200,80,20,0.06) 0%, transparent 50%), radial-gradient(ellipse 100% 100% at 50% 100%, rgba(120,30,0,0.08) 0%, transparent 40%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-4">
					<span
						className="text-2xl font-black tracking-[-0.03em]"
						style={{
							background: "linear-gradient(135deg, #ff6a2b, #ff3d00)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<span className="text-[10px] uppercase tracking-[0.3em] text-[#5a3a28]">
						Zeiterfassung
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] font-medium uppercase tracking-[0.15em] text-[#6a4a38] md:flex">
					<a href="#features" className="transition-colors hover:text-[#ff6a2b]">Funktionen</a>
					<a href="#core" className="transition-colors hover:text-[#ff6a2b]">Kern</a>
					<a href="#contact" className="transition-colors hover:text-[#ff6a2b]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:shadow-[0_0_30px_rgba(255,61,0,0.3)]"
					style={{
						background: "linear-gradient(135deg, #ff6a2b, #ff3d00)",
						color: "#0e0806",
					}}
				>
					Anfragen
				</a>
			</header>

			{/* Volcanic fissure divider */}
			<div className="relative z-10 mx-8 lg:mx-16">
				<div className="h-px" style={{ background: "linear-gradient(90deg, transparent 0%, #ff3d0030 30%, #ff6a2b50 50%, #ff3d0030 70%, transparent 100%)" }} />
			</div>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-24 pt-28 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-12">
					<div className="lg:col-span-7">
						<p
							className="animate-fade-up mb-8 text-[10px] font-bold uppercase tracking-[0.5em]"
							style={{
								color: "#ff6a2b",
								animationDelay: "0.1s",
							}}
						>
							Unter der Oberfl&auml;che
						</p>
						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(3rem, 8vw, 6.5rem)",
								fontWeight: 900,
								lineHeight: 1.0,
								letterSpacing: "-0.04em",
								animationDelay: "0.2s",
							}}
						>
							Zeiterfassung
							<br />
							mit{" "}
							<span
								style={{
									background: "linear-gradient(135deg, #ff6a2b, #ff3d00, #cc2800)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Kern
							</span>
							.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[15px] leading-[1.9] text-[#7a5a48]"
							style={{ animationDelay: "0.4s" }}
						>
							Wie Magma unter der Erdkruste: unsichtbar, aber mit enormer Kraft. Z8 treibt
							Ihre Prozesse an &mdash; GoBD-konform, unaufhaltsam, tiefgreifend.
						</p>
						<div className="animate-fade-up mt-12 flex items-center gap-6" style={{ animationDelay: "0.5s" }}>
							<a
								href="#contact"
								className="group relative overflow-hidden px-8 py-4 text-[11px] font-bold uppercase tracking-[0.15em] text-[#0e0806] transition-all"
								style={{ background: "linear-gradient(135deg, #ff6a2b, #ff3d00)" }}
							>
								<span className="relative z-10">Demo anfragen</span>
								<div
									className="absolute inset-0 translate-y-full transition-transform duration-300 group-hover:translate-y-0"
									style={{ background: "linear-gradient(135deg, #ff3d00, #cc2800)" }}
								/>
							</a>
							<a href="#features" className="text-[11px] uppercase tracking-[0.15em] text-[#5a3a28] transition-colors hover:text-[#ff6a2b]">
								Erkunden &darr;
							</a>
						</div>
					</div>

					{/* Hero image with lava border */}
					<div className="animate-scale-in lg:col-span-5" style={{ animationDelay: "0.3s" }}>
						<div
							className="relative overflow-hidden"
							style={{
								padding: "2px",
								background: "linear-gradient(180deg, #ff6a2b40, #ff3d0020, transparent)",
							}}
						>
							<div className="relative h-[55vh] overflow-hidden">
								<Image
									src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1000&q=80&auto=format&fit=crop"
									alt=""
									fill
									className="object-cover"
									style={{ filter: "saturate(0.3) brightness(0.4) contrast(1.2) sepia(0.3)" }}
									priority
								/>
								{/* Lava glow overlay */}
								<div
									className="absolute inset-0"
									style={{
										background: "linear-gradient(180deg, rgba(14,8,6,0) 30%, rgba(255,61,0,0.08) 100%)",
									}}
								/>
							</div>
						</div>
						{/* Ember particles */}
						<div className="mt-3 flex items-center gap-2">
							<div className="h-1 w-1 rounded-full" style={{ backgroundColor: "#ff6a2b" }} />
							<div className="h-1 w-8 rounded-full" style={{ background: "linear-gradient(90deg, #ff6a2b, transparent)" }} />
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mb-16 flex items-end justify-between">
					<div>
						<span className="mb-3 block text-[10px] font-bold uppercase tracking-[0.5em] text-[#ff6a2b]">
							Funktionen
						</span>
						<h2 className="text-4xl font-black tracking-[-0.03em]">Sechs Schichten Kraft.</h2>
					</div>
				</div>

				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation auf allen Ger\u00e4ten.", heat: "100%" },
						{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. L\u00fcckenlos dokumentiert und gepr\u00fcft.", heat: "85%" },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisiert und fehlerfrei.", heat: "70%" },
						{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert, sicher, skalierbar.", heat: "55%" },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos in Ihre Systeme integriert.", heat: "40%" },
						{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Live-Dashboards. Immer aktuell.", heat: "25%" },
					].map((f, i) => (
						<div
							key={i}
							className="group relative overflow-hidden p-7 transition-all duration-500 hover:translate-y-[-2px]"
							style={{
								backgroundColor: "rgba(255,106,43,0.03)",
								border: "1px solid rgba(255,106,43,0.08)",
							}}
						>
							{/* Heat indicator */}
							<div
								className="absolute bottom-0 left-0 h-[2px] transition-all duration-700 group-hover:h-[3px]"
								style={{
									width: f.heat,
									background: "linear-gradient(90deg, #ff3d00, #ff6a2b, transparent)",
								}}
							/>
							<span className="mb-1 block text-[9px] uppercase tracking-[0.3em] text-[#5a3a28]">
								0{i + 1}
							</span>
							<h3 className="mb-3 text-[17px] font-black tracking-tight transition-colors group-hover:text-[#ff6a2b]">
								{f.title}
							</h3>
							<p className="text-[12px] leading-[1.85] text-[#6a4a38]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Full image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="relative h-[30vh] overflow-hidden">
					<Image
						src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.2) brightness(0.3) contrast(1.2) sepia(0.4)" }}
					/>
					<div
						className="absolute inset-0"
						style={{ background: "linear-gradient(90deg, rgba(14,8,6,0.8) 0%, rgba(14,8,6,0.2) 50%, rgba(14,8,6,0.8) 100%)" }}
					/>
					<div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, #ff3d0040, transparent)" }} />
				</div>
			</section>

			{/* Core philosophy */}
			<section id="core" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-8 flex items-center justify-center gap-3">
						<div className="h-px w-16" style={{ background: "linear-gradient(90deg, transparent, #ff3d0040)" }} />
						<div className="h-2 w-2 rounded-full" style={{ background: "linear-gradient(135deg, #ff6a2b, #ff3d00)" }} />
						<div className="h-px w-16" style={{ background: "linear-gradient(90deg, #ff3d0040, transparent)" }} />
					</div>
					<blockquote
						className="text-[clamp(1.5rem,3.5vw,2.5rem)] font-black leading-[1.35] tracking-[-0.02em]"
					>
						Unter jeder ruhigen Oberfl&auml;che steckt
						<span
							style={{
								background: "linear-gradient(135deg, #ff6a2b, #ff3d00)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							{" "}ungez&auml;hmte Energie
						</span>
						.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="relative overflow-hidden p-12 lg:p-16"
					style={{
						background: "linear-gradient(135deg, rgba(255,106,43,0.06), rgba(255,61,0,0.03))",
						border: "1px solid rgba(255,106,43,0.1)",
					}}
				>
					<div
						className="absolute -right-20 -top-20 h-40 w-40 rounded-full opacity-20 blur-3xl"
						style={{ backgroundColor: "#ff3d00" }}
					/>
					<div className="relative z-10 grid gap-8 lg:grid-cols-2">
						<div>
							<h2 className="text-4xl font-black tracking-[-0.03em]">
								Bereit f&uuml;r die
								<br />
								<span
									style={{
										background: "linear-gradient(135deg, #ff6a2b, #ff3d00)",
										WebkitBackgroundClip: "text",
										WebkitTextFillColor: "transparent",
									}}
								>
									Eruption
								</span>
								?
							</h2>
						</div>
						<div className="flex items-end">
							<div>
								<p className="mb-6 text-[14px] leading-relaxed text-[#7a5a48]">
									Erleben Sie die Kraft von Z8 in einer pers&ouml;nlichen Demo.
								</p>
								<div className="flex gap-4">
									<a
										href="mailto:hello@z8.app"
										className="px-8 py-4 text-[11px] font-bold uppercase tracking-[0.15em] text-[#0e0806] transition-all hover:shadow-[0_0_30px_rgba(255,61,0,0.3)]"
										style={{ background: "linear-gradient(135deg, #ff6a2b, #ff3d00)" }}
									>
										Demo vereinbaren
									</a>
									<a
										href="mailto:hello@z8.app"
										className="px-8 py-4 text-[11px] tracking-[0.1em] text-[#5a3a28] transition-colors hover:text-[#ff6a2b]"
									>
										hello@z8.app
									</a>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(255,106,43,0.06)" }}>
				<div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-[#3a2218]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#ff6a2b]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
