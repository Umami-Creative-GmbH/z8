import Image from "next/image";
import Link from "next/link";

export default function Design24_4() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
				backgroundColor: "#0d0f14",
				color: "#b0b8c8",
			}}
		>
			{/* Titanium blue grid background */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					backgroundImage:
						"linear-gradient(rgba(60,70,100,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(60,70,100,0.04) 1px, transparent 1px)",
					backgroundSize: "60px 60px",
				}}
			/>

			{/* Header — heavy top bar */}
			<header
				className="relative z-10 flex items-center justify-between px-6 py-5 lg:px-12"
				style={{ borderBottom: "2px solid #1a1e28" }}
			>
				<div className="flex items-center gap-3">
					<div
						className="flex h-9 w-9 items-center justify-center text-[11px] font-bold"
						style={{
							backgroundColor: "#1a1e28",
							border: "1px solid #2a3040",
							color: "#7888a8",
						}}
					>
						Z8
					</div>
					<div className="text-[10px] uppercase tracking-[0.2em] text-[#3a4558]">
						TITAN // ZEITERFASSUNG
					</div>
				</div>
				<nav className="hidden items-center gap-6 text-[10px] uppercase tracking-[0.15em] text-[#3a4558] md:flex">
					<a href="#features" className="transition-colors hover:text-[#7888a8]">[FUNKT]</a>
					<a href="#core" className="transition-colors hover:text-[#7888a8]">[KERN]</a>
					<a href="#contact" className="transition-colors hover:text-[#7888a8]">[KNTKT]</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2 text-[10px] font-bold uppercase tracking-[0.15em] transition-all hover:bg-[#2a3040] hover:text-[#b0b8c8]"
					style={{
						border: "1px solid #2a3040",
						color: "#5a6880",
					}}
				>
					ANFRAGEN &gt;
				</a>
			</header>

			{/* Hero — brutalist angular */}
			<section className="relative z-10 px-6 pb-20 pt-20 lg:px-12">
				<div className="grid gap-6 lg:grid-cols-12">
					{/* Sidebar data column */}
					<div className="hidden text-[9px] uppercase leading-[2.5] tracking-[0.15em] text-[#2a3040] lg:col-span-1 lg:block" style={{ borderRight: "1px solid #1a1e28" }}>
						<div>SYS</div>
						<div>V4.2</div>
						<div>---</div>
						<div>Ti</div>
						<div>47</div>
						<div>---</div>
						<div>2025</div>
					</div>

					<div className="lg:col-span-11 lg:pl-8">
						<div
							className="animate-fade-up mb-6 flex items-center gap-3"
							style={{ animationDelay: "0.1s" }}
						>
							<div className="h-[2px] w-6" style={{ backgroundColor: "#5a6880" }} />
							<span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#5a6880]">
								SYSTEM_INIT
							</span>
						</div>

						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(3rem, 9vw, 7rem)",
								fontWeight: 700,
								lineHeight: 0.95,
								letterSpacing: "-0.04em",
								animationDelay: "0.2s",
								color: "#d0d8e8",
							}}
						>
							TITAN
							<span style={{ color: "#3a4558" }}>_</span>
							<br />
							<span style={{ color: "#5a6880" }}>GRADE</span>
							<span className="inline-block animate-pulse" style={{ color: "#7888a8" }}>.</span>
						</h1>

						<p
							className="animate-fade-up mt-8 max-w-lg text-[13px] leading-[2]"
							style={{ color: "#4a5868", animationDelay: "0.4s" }}
						>
							// Zeiterfassung aus Titan: leichter als Stahl, h&auml;rter als alles andere.
							<br />
							// GoBD-konform. Unzerst&ouml;rbar. Industrietauglich.
						</p>

						<div className="animate-fade-up mt-10 flex items-center gap-4" style={{ animationDelay: "0.5s" }}>
							<a
								href="#contact"
								className="px-8 py-3.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all hover:bg-[#3a4558]"
								style={{
									backgroundColor: "#2a3040",
									border: "1px solid #3a4558",
									color: "#b0b8c8",
								}}
							>
								DEMO_ANFRAGEN &gt;
							</a>
							<a href="#features" className="text-[10px] uppercase tracking-[0.15em] text-[#3a4558] transition-colors hover:text-[#7888a8]">
								[SCROLL] &darr;
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Hero image — industrial */}
			<section className="relative z-10 mx-6 mb-20 lg:mx-12">
				<div className="animate-scale-in" style={{ animationDelay: "0.6s" }}>
					<div className="relative overflow-hidden" style={{ border: "1px solid #1a1e28" }}>
						{/* Top bar */}
						<div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: "#0f1118", borderBottom: "1px solid #1a1e28" }}>
							<div className="flex items-center gap-2">
								<div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#3a4558" }} />
								<div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#2a3040" }} />
								<div className="h-2 w-2 rounded-full" style={{ backgroundColor: "#2a3040" }} />
							</div>
							<span className="text-[8px] uppercase tracking-[0.2em] text-[#2a3040]">VIEWPORT_01</span>
						</div>
						<div className="relative h-[35vh] overflow-hidden">
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0) brightness(0.35) contrast(1.4) hue-rotate(200deg)" }}
								priority
							/>
							{/* Scan line effect */}
							<div
								className="absolute inset-0 opacity-[0.015]"
								style={{
									backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(176,184,200,1) 2px, rgba(176,184,200,1) 3px)",
								}}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* Features — grid with exposed structure */}
			<section id="features" className="relative z-10 px-6 py-20 lg:px-12">
				<div className="mb-12 flex items-center gap-3">
					<div className="h-[2px] w-6" style={{ backgroundColor: "#5a6880" }} />
					<span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#5a6880]">
						FEATURES_ARR[6]
					</span>
				</div>

				<div className="grid gap-px md:grid-cols-2 lg:grid-cols-3" style={{ border: "1px solid #1a1e28" }}>
					{[
						{ key: "CLK", title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Sync." },
						{ key: "GBD", title: "GoBD-konform", desc: "Revisionssicher. Unver\u00e4nderbar." },
						{ key: "EXP", title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP." },
						{ key: "TNT", title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert. Sicher." },
						{ key: "SSO", title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Integriert." },
						{ key: "ANL", title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards." },
					].map((f, i) => (
						<div
							key={i}
							className="group p-6 transition-colors hover:bg-[#0f1118]"
							style={{
								backgroundColor: "#0d0f14",
								borderRight: "1px solid #1a1e28",
								borderBottom: "1px solid #1a1e28",
							}}
						>
							<div className="mb-3 flex items-center justify-between">
								<span className="text-[9px] font-bold tracking-[0.2em] text-[#3a4558]">
									{f.key}_{String(i).padStart(2, "0")}
								</span>
								<span className="text-[8px] text-[#1a1e28] transition-colors group-hover:text-[#3a4558]">&gt;</span>
							</div>
							<h3 className="mb-2 text-[15px] font-bold tracking-tight text-[#7888a8] transition-colors group-hover:text-[#b0b8c8]">
								{f.title}
							</h3>
							<p className="text-[11px] leading-[1.8] text-[#3a4558]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image pair */}
			<section className="relative z-10 mx-6 mb-20 grid gap-px md:grid-cols-2 lg:mx-12" style={{ border: "1px solid #1a1e28" }}>
				<div className="relative h-48 overflow-hidden">
					<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0) brightness(0.3) contrast(1.3) hue-rotate(200deg)" }} />
				</div>
				<div className="relative h-48 overflow-hidden">
					<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0) brightness(0.3) contrast(1.3) hue-rotate(200deg)" }} />
				</div>
			</section>

			{/* Core */}
			<section id="core" className="relative z-10 px-6 py-24 lg:px-12" style={{ borderTop: "1px solid #1a1e28", borderBottom: "1px solid #1a1e28" }}>
				<div className="mx-auto max-w-2xl">
					<span className="mb-6 block text-[9px] uppercase tracking-[0.3em] text-[#3a4558]">
						// KERN_PHILOSOPHIE
					</span>
					<blockquote className="text-[clamp(1.3rem,3vw,2rem)] font-bold leading-[1.5] tracking-[-0.01em] text-[#7888a8]">
						Titan rostet nicht. Titan biegt sich nicht.
						Titan wird unter Druck nur st&auml;rker.
					</blockquote>
					<div className="mt-8 text-[9px] uppercase tracking-[0.2em] text-[#2a3040]">
						// Next.js 16 | PostgreSQL | Valkey | Better Auth | Drizzle | BullMQ
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-6 py-20 lg:px-12">
				<div className="grid gap-8 lg:grid-cols-2">
					<div>
						<h2 className="text-[clamp(2rem,5vw,3.5rem)] font-bold leading-[1.1] tracking-[-0.03em] text-[#d0d8e8]">
							BEREIT
							<span style={{ color: "#3a4558" }}>_</span>
							<br />
							<span style={{ color: "#5a6880" }}>F&Uuml;R</span>
							<span style={{ color: "#3a4558" }}>_</span>
							<span style={{ color: "#7888a8" }}>TITAN</span>
							<span style={{ color: "#5a6880" }}>?</span>
						</h2>
					</div>
					<div className="flex flex-col justify-end">
						<p className="mb-6 text-[13px] leading-[1.9] text-[#4a5868]">
							// Pers&ouml;nliche Demo. Industrietaugliche Pr&auml;zision.
						</p>
						<div className="flex items-center gap-4">
							<a
								href="mailto:hello@z8.app"
								className="px-8 py-3.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all hover:bg-[#3a4558]"
								style={{
									backgroundColor: "#2a3040",
									border: "1px solid #3a4558",
									color: "#b0b8c8",
								}}
							>
								DEMO_INIT &gt;
							</a>
							<a href="mailto:hello@z8.app" className="text-[10px] tracking-[0.1em] text-[#3a4558] transition-colors hover:text-[#7888a8]">
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-6 py-6 lg:px-12" style={{ borderTop: "2px solid #1a1e28" }}>
				<div className="flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-[#1a1e28]">
					<span>Z8_SYS &copy; 2025</span>
					<Link href="/" className="transition-colors hover:text-[#7888a8]">&lt; ALLE_DESIGNS</Link>
				</div>
			</footer>
		</div>
	);
}
