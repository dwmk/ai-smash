import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Sparkles,
  MessageSquare,
  Shield,
  Box,
  Palette,
  Github,
  Linkedin,
  ExternalLink,
  Heart,
  Award,
  BookOpen,
  Bot,
  Workflow,
  Key,
  Menu,
  X,
  Crown,
  Terminal,
  Copy,
  UserCheck,
  PhoneCall,
  Monitor,
  CheckCircle2,
  Cpu,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { LandingHeroCanvas } from './LandingHeroCanvas';
import { LandingNavbar } from './LandingNavbar';
import { MacTerminalViewer } from './MacTerminalViewer';
import { AI_PROFILE, SPECIAL_THANKS_LINKS, PRODUCT_HUNT_URL, INTEGRATION_LIBRARY, API_PROVIDERS_CONFIG } from '../constants';

interface LandingPageProps {
  onStartChat: () => void;
  onNavigateToDocs?: (path?: string) => void;
  onNavigateToHumanizer?: () => void;
  onNavigateToInterview?: (path?: string) => void;
  onNavigateToCaller?: () => void;
}

interface AccordionItem {
  id: string;
  title: string;
  icon: React.ElementType;
  points: string[];
  image: string;
  tagline: string;
}

const ACCORDION_DATA: AccordionItem[] = [
  {
    id: 'data-freedom',
    title: 'Data Freedom',
    icon: Shield,
    tagline: 'Pure on-device privacy with zero server snooping',
    points: [
      'no ratelimits to messages or usage metrics',
      'no account sign-ups needed',
      'no user data escapes out your device',
      'models run directly in your browser',
    ],
    image: 'https://muxai.vercel.app/screenshots/smash3.png',
  },
  {
    id: 'interact-3d',
    title: 'Interact in 3D',
    icon: Box,
    tagline: 'Life-like anime avatar with real-time reactive physics',
    points: [
      'switch between 2D/3D modes',
      'voice synthesis for immersive experience',
      'avatar reacts in real-time',
    ],
    image: 'https://muxai.vercel.app/screenshots/smash7.png',
  },
  {
    id: 'make-it-yours',
    title: 'Make It Yours',
    icon: Palette,
    tagline: 'Extensive aesthetic and local storage customizations',
    points: [
      'customize themes and personal preferences',
      'manage local cache storage on your own',
      'more customization features on the way!',
    ],
    image: 'https://muxai.vercel.app/screenshots/smash5.png',
  },
];

const AUTOMATION_DATA: AccordionItem[] = [
  {
    id: 'ai-interviews',
    title: 'AI Interviews & Recruiting',
    icon: UserCheck,
    tagline: 'Autonomous conversational screenings & candidate evaluations',
    points: [
      'structured technical and behavioral interview rubrics',
      'interactive persona interviewer with dynamic follow-up questioning',
      'automated candidate dossier scoring and summary extraction',
      'instant integration into ATS pipelines and candidate scheduling',
    ],
    image: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'voice-calling',
    title: 'Voice Calling & Agentic Booking',
    icon: PhoneCall,
    tagline: 'Natural voice telephony with live data entry & calendar booking',
    points: [
      'inbound and outbound real-time conversational voice handling',
      'automatic appointment booking & Google Calendar scheduling',
      'structured field extraction into CRM and spreadsheet databases',
      'low-latency audio response with affective vocal inflection',
    ],
    image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'screenspace-support',
    title: 'Screenspace Troubleshooting',
    icon: Monitor,
    tagline: 'Multimodal desktop visual observation & live tech diagnostics',
    points: [
      'live screenspace vision inspecting software windows & DOM elements',
      'instant detection of stack traces, UI warnings, and error dialogs',
      'step-by-step spoken voice instructions guiding users through fixes',
      'autonomous cursor highlight suggestions and CLI fix generation',
    ],
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
  },
  {
    id: 'ui-testing',
    title: 'Visual UI Testing & Commentary',
    icon: CheckCircle2,
    tagline: 'Live avatar commentary with automated UI element validation',
    points: [
      'autonomous multi-viewport regression and layout unit testing',
      'real-time vocal and visual commentary pinpointing UX friction',
      'reactive element state assertions (hover, active, disabled, focus)',
      'exportable bug reproduction videos and test audit logs',
    ],
    image: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartChat,
  onNavigateToDocs,
  onNavigateToHumanizer,
  onNavigateToInterview,
  onNavigateToCaller,
}) => {
  const [activeAccordion, setActiveAccordion] = useState<number>(0);
  const [activeAutomationAccordion, setActiveAutomationAccordion] = useState<number | null>(0);
  const [scrollY, setScrollY] = useState(0);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [showAllIntegrations, setShowAllIntegrations] = useState(false);
  const [showAllApiProviders, setShowAllApiProviders] = useState(false);
  const [activeMcpTab, setActiveMcpTab] = useState<'claude' | 'cursor' | 'jsonrpc' | 'act'>('claude');
  const [copiedMcpConfig, setCopiedMcpConfig] = useState(false);

  const copyMcpConfig = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedMcpConfig(true);
      setTimeout(() => setCopiedMcpConfig(false), 2000);
    }
  };

  // Parallax scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleToggleAccordion = (index: number) => {
    // Only 1 accordion can remain open at a time; if clicking same, keep it open so image is always shown
    setActiveAccordion(index);
  };

  const handleToggleAutomationAccordion = (index: number) => {
    setActiveAutomationAccordion((prev) => (prev === index ? null : index));
  };

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, sectionId: string) => {
    e.preventDefault();
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const currentAccordion = ACCORDION_DATA[activeAccordion] || ACCORDION_DATA[0];

  return (
    <div className="relative min-h-screen bg-[#f8f9fc] text-[#1e2029] font-sans overflow-x-clip selection:bg-[#55d2f6]/20 selection:text-[#1e2029]">
      {/* Fixed Parallax 3D VRM Background (Active behind the Hero section) */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          transform: `translateY(${scrollY * 0.18}px)`,
          opacity: Math.max(0, 1 - scrollY / 750),
          transition: 'opacity 0.1s ease-out',
        }}
        aria-hidden="true"
      >
        <LandingHeroCanvas />
      </div>

      {/* Top Navbar (Sticky) & Mobile Drawer */}
      <LandingNavbar
        onStartChat={onStartChat}
        onNavigateToDocs={onNavigateToDocs}
        isInsideLandingPage={true}
      />

      {/* Main Content Area */}
      <main className="relative z-10">
        {/* HERO SECTION */}
        <section className="relative min-h-[calc(100vh-4rem)] flex items-center px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-12 lg:py-20">
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left 3D avatar spacer on desktop: she stands near left edge */}
            <div className="hidden lg:block lg:col-span-5 pointer-events-none" />

            {/* Right side: Foreground typography & CTA elements */}
            <div
              data-hero-foreground="true"
              className="lg:col-span-7 flex flex-col items-start lg:pl-6 text-left"
            >
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 border border-black/[0.08] shadow-xs text-xs font-medium text-neutral-700 mb-6 backdrop-blur-xs animate-in fade-in duration-300">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#55d2f6] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#55d2f6]" />
                </span>
                <span className="font-mono text-[11px] tracking-wide text-neutral-500 uppercase">
                  Hana is online
                </span>
              </div>

              <h1 className="hero-title-outline text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight font-heading text-neutral-900 leading-[1.04]">
                Hana AI
              </h1>

              {/* Subtitle: Sandbox for mini LLMs that run directly in the browser with 3D avatar interactions and voice */}
              <p className="hero-subtitle-outline mt-6 text-lg sm:text-xl md:text-2xl text-neutral-600 font-sans leading-relaxed max-w-2xl">
                Redefining the next generation of technology by Human-Computer Interaction (HCI) via Artificial Intelligence (AI)
              </p>

              {/* AI Chat Button with arrow icon */}
              <div className="mt-8 sm:mt-10 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={onStartChat}
                  className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-2xl text-sm sm:text-base font-semibold bg-[#55d2f6] hover:bg-[#22bdec] text-neutral-950 shadow-lg shadow-[#55d2f6]/25 hover:shadow-xl hover:shadow-[#55d2f6]/35 active:scale-95 transition-all duration-150 group cursor-pointer"
                >
                  <span>LM Chat</span>
                  <ArrowRight className="w-4 h-4 stroke-[2.5] group-hover:translate-x-1 transition-transform" />
                </button>

                <a
                  href="#why-it-matters"
                  onClick={(e) => scrollToSection(e, 'why-it-matters')}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-sm font-semibold bg-white/90 hover:bg-white text-neutral-700 hover:text-neutral-950 border border-black/[0.08] shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  <span>Explore Features</span>
                  <ChevronDown className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: WHY IT MATTERS (2-column accordion on left, dynamic image on right) */}
        <section
          id="why-it-matters"
          className="relative z-20 bg-white border-t border-b border-black/[0.08] shadow-sm py-20 lg:py-28 px-4 sm:px-6 lg:px-8 transition-colors"
        >
          <div className="max-w-7xl mx-auto">
            {/* Centered Heading */}
            <div className="text-center max-w-2xl mx-auto mb-16 lg:mb-20">
              <span className="text-xs font-mono uppercase tracking-widest text-[#22bdec] font-semibold block mb-2">
                Highlights
              </span>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold font-heading text-neutral-900 tracking-tight">
                Why It Matters
              </h2>
              <p className="text-sm sm:text-base text-neutral-500 mt-3 max-w-lg mx-auto leading-relaxed">
                Experience next-generation private conversational intelligence completely localized to your own browser.
              </p>
            </div>

            {/* 2-Column Display: Accordion on Left, Dynamic Image on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
              {/* Left Column: Accordions */}
              <div className="lg:col-span-6 space-y-4">
                {ACCORDION_DATA.map((item, idx) => {
                  const isOpen = activeAccordion === idx;
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-2xl border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
                        isOpen
                          ? 'border-[#55d2f6] bg-[#f8f9fc] shadow-md ring-1 ring-[#55d2f6]/30'
                          : 'border-black/[0.08] bg-white hover:border-black/20 hover:bg-neutral-50/50'
                      }`}
                    >
                      {/* Accordion Trigger Header */}
                      <button
                        type="button"
                        onClick={() => handleToggleAccordion(idx)}
                        className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 cursor-pointer focus:outline-none"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                              isOpen
                                ? 'bg-[#55d2f6] text-neutral-950 shadow-xs scale-105'
                                : 'bg-neutral-100 text-neutral-500 scale-100'
                            }`}
                          >
                            <Icon className="w-5 h-5 stroke-[2]" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-lg sm:text-xl font-bold font-heading text-neutral-900 tracking-tight">
                              {item.title}
                            </h3>
                            <p className="text-xs text-neutral-500 truncate mt-0.5">
                              {item.tagline}
                            </p>
                          </div>
                        </div>

                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center border border-black/10 shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            isOpen ? 'rotate-180 bg-[#55d2f6]/10 text-neutral-900' : 'text-neutral-400'
                          }`}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </div>
                      </button>

                      {/* Accordion Expanded Body with Synchronized Smooth Height & Opacity Transition */}
                      <div
                        className={`grid transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          isOpen
                            ? 'grid-rows-[1fr] opacity-100'
                            : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="px-5 pb-6 pt-1 sm:px-6 border-t border-black/[0.05]">
                            <ul className="space-y-3 pt-2">
                              {item.points.map((point, pIdx) => (
                                <li
                                  key={pIdx}
                                  className={`flex items-start gap-3 text-sm text-neutral-700 leading-snug transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                                    isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
                                  }`}
                                >
                                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  </div>
                                  <span className="capitalize">{point}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Dynamic Image Showcase Synchronized with Accordion */}
              <div className="lg:col-span-6">
                <div className="relative rounded-3xl p-3 sm:p-4 bg-gradient-to-br from-neutral-100 to-neutral-200/80 border border-black/[0.08] shadow-2xl overflow-hidden group transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
                  {/* Mock Window Header */}
                  <div className="flex items-center justify-between pb-3 px-2 border-b border-black/[0.06] mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                    </div>
                    <button
                      type="button"
                      onClick={onStartChat}
                      className="text-xs font-semibold text-[#16536b] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Try it</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Screenshot Display with Synchronized Cross-Fade & Scale Transitions */}
                  <div className="relative aspect-[16/10] w-full rounded-2xl overflow-hidden bg-neutral-900 shadow-inner">
                    {ACCORDION_DATA.map((item, idx) => {
                      const isCurrent = activeAccordion === idx;
                      return (
                        <img
                          key={item.id}
                          src={item.image}
                          alt={item.title}
                          className={`absolute inset-0 w-full h-full object-cover object-top transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            isCurrent
                              ? 'opacity-100 scale-100 translate-y-0 z-10'
                              : 'opacity-0 scale-[0.97] translate-y-2 z-0 pointer-events-none'
                          }`}
                          loading="lazy"
                        />
                      );
                    })}

                    {/* Gradient Overlay for Sleek Look */}
                    <div className="absolute inset-0 ring-1 ring-inset ring-black/10 pointer-events-none rounded-2xl z-20" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: INTEGRATIONS & AI APIS (Directly below Why It Matters) */}
        <section
          id="integrations-apis"
          className="relative z-20 py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-black/[0.06]"
        >
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest bg-[var(--theme-accent-soft)] text-[#0f9bc7] font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Extensions</span>
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold font-heading text-neutral-900 tracking-tight">
              Integrations & AI APIs
            </h2>
            <p className="mt-4 text-base sm:text-lg text-neutral-600 leading-relaxed">
              Bridge your AI companion to external platforms, bots, and the world&apos;s leading LLM providers with Hana via secure local credential storage
            </p>
          </div>

          {/* 1. Bot & Workflow Integrations Grid */}
          <div className="mb-14">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-[#0f9bc7]" />
                <h3 className="text-xl font-bold font-heading text-neutral-900">
                  Bot &amp; Workflow Integrations
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToDocs?.('/docs')}
                className="text-xs font-semibold text-[#0f9bc7] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View Integration Docs</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {(showAllIntegrations
                  ? INTEGRATION_LIBRARY.filter((item) => item.platform !== 'mcp')
                  : INTEGRATION_LIBRARY.filter((item) => item.platform !== 'mcp').slice(0, 4)
                ).map((item) => (
                  <div
                    key={item.platform}
                    className="rounded-2xl p-5 sm:p-6 bg-white border border-black/[0.08] shadow-sm hover:shadow-md hover:border-[#55d2f6]/60 transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl overflow-hidden ring-1 ring-black/10 shadow-xs bg-white p-0.5 shrink-0">
                            <img
                              src={item.logoUrl}
                              alt={item.name}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          </div>
                          <div>
                            <h4 className="text-lg font-bold font-heading text-neutral-900 group-hover:text-[#0f9bc7] transition-colors">
                              {item.name}
                            </h4>
                            <span className="text-xs text-neutral-500 block mt-0.5">
                              {item.tagline}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigateToDocs?.(item.docsPath)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#0f9bc7] hover:underline cursor-pointer shrink-0 pt-1"
                        >
                          <span>Setup Guide</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-sm text-neutral-600 leading-relaxed mb-4">
                        {item.description}
                      </p>

                      <div className="space-y-1.5 pt-3 border-t border-black/[0.05]">
                        {item.features.slice(0, 3).map((feat, fIdx) => (
                          <div key={fIdx} className="flex items-center gap-2 text-xs text-neutral-700">
                            <div className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!showAllIntegrations && INTEGRATION_LIBRARY.filter((item) => item.platform !== 'mcp').length > 4 && (
                <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#f8f9fc] via-[#f8f9fc]/90 to-transparent pointer-events-none z-10" />
              )}

              <div className={`flex justify-center ${!showAllIntegrations ? 'relative z-20 -mt-6' : 'mt-8'}`}>
                <button
                  type="button"
                  onClick={() => setShowAllIntegrations(!showAllIntegrations)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold bg-white border border-black/10 text-neutral-800 hover:text-black hover:border-[var(--theme-accent)] shadow-sm hover:shadow active:scale-95 transition-all cursor-pointer group"
                >
                  <span>{showAllIntegrations ? 'Show Less' : 'Show More'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      showAllIntegrations ? 'rotate-180' : 'group-hover:translate-y-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 2. External AI Model APIs Grid */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-[#0f9bc7]" />
                <h3 className="text-xl font-bold font-heading text-neutral-900">
                  Supported External AI Model APIs
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToDocs?.('/docs')}
                className="text-xs font-semibold text-[#0f9bc7] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>API Reference</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(showAllApiProviders
                  ? Object.values(API_PROVIDERS_CONFIG)
                  : Object.values(API_PROVIDERS_CONFIG).slice(0, 4)
                ).map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => onNavigateToDocs?.(provider.docsPath)}
                    className="rounded-2xl p-4 bg-white border border-black/[0.08] shadow-xs hover:shadow-md hover:border-[#55d2f6]/60 transition-all flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-black/10 shadow-xs bg-white p-0.5 shrink-0 group-hover:scale-105 transition-transform">
                        <img
                          src={provider.logoUrl}
                          alt={provider.name}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold font-heading text-neutral-900 group-hover:text-[#0f9bc7] transition-colors truncate">
                          {provider.name}
                        </h4>
                        <p className="text-[11px] text-neutral-500 truncate">
                          {provider.tagline}
                        </p>
                      </div>
                    </div>

                    <span className="text-[#0f9bc7] text-xs font-semibold flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform shrink-0">
                      <span>Docs</span>
                      <ChevronDown className="w-3 h-3 -rotate-90" />
                    </span>
                  </div>
                ))}
              </div>

              {!showAllApiProviders && Object.values(API_PROVIDERS_CONFIG).length > 4 && (
                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#f8f9fc] via-[#f8f9fc]/90 to-transparent pointer-events-none z-10" />
              )}

              <div className={`flex justify-center ${!showAllApiProviders ? 'relative z-20 -mt-6' : 'mt-8'}`}>
                <button
                  type="button"
                  onClick={() => setShowAllApiProviders(!showAllApiProviders)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-semibold bg-white border border-black/10 text-neutral-800 hover:text-black hover:border-[var(--theme-accent)] shadow-sm hover:shadow active:scale-95 transition-all cursor-pointer group"
                >
                  <span>{showAllApiProviders ? 'Show Less' : 'Show More'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      showAllApiProviders ? 'rotate-180' : 'group-hover:translate-y-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 3. Documentation Callout Card */}
          <div className="mt-12 rounded-3xl p-6 sm:p-8 bg-gradient-to-r from-neutral-900 via-neutral-950 to-[#093649] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-xl">
            <div className="space-y-1.5 max-w-xl">
              <div className="inline-flex items-center gap-1.5 text-xs font-mono text-[#55d2f6] uppercase tracking-wider font-semibold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Documentation</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold font-heading tracking-tight">
                Explore Full Developer Guides
              </h3>
              <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                Step-by-step documentation for how to make things work.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateToDocs?.('/docs')}
              className="px-6 py-3 rounded-xl text-xs font-semibold bg-[#55d2f6] text-neutral-950 hover:bg-[#8ce0fa] shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              <span>Browse Docs (/docs)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* SECTION: MODEL CONTEXT PROTOCOL (MCP) (Dedicated section above Pricing) */}
        <section
          id="mcp"
          className="relative z-20 py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-black/[0.06]"
        >
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest bg-[var(--theme-accent-soft)] text-[#0f9bc7] font-semibold mb-3">
              <Terminal className="w-3.5 h-3.5" />
              <span>Anthropic Protocol</span>
            </span>
            <div className="flex items-center justify-center gap-3">
              <img
                src="https://ai.mux8.com/logo0.png"
                alt="MCP"
                className="w-10 h-10 rounded-xl shadow-xs border border-black/10 bg-white p-0.5"
              />
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold font-heading text-neutral-900 tracking-tight">
                Model Context Protocol (MCP)
              </h2>
            </div>
            <p className="mt-4 text-base sm:text-lg text-neutral-600 leading-relaxed">
              Standardized open architecture connecting Cursor IDE, Claude Desktop, Windsurf, and custom external tool suites directly into this AI runtime in /chat mode
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left 7 cols: Server Endpoints & Available Tools */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              {/* Endpoint Card */}
              <div className="rounded-3xl p-6 sm:p-7 bg-white border border-black/[0.08] shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h3 className="text-lg font-bold font-heading text-neutral-900">
                        Built-in Live MCP Server
                      </h3>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                      PROTOCOL 2024-11-05
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-neutral-600 mb-4 leading-relaxed">
                    AI Smash runs an active Model Context Protocol server. External clients can connect over Server-Sent Events (SSE) or JSON-RPC 2.0 to access character context, execute built-in tools, and query the active model during /chat mode.
                  </p>

                  <div className="space-y-2">
                    <div className="p-3 rounded-xl bg-neutral-50 border border-black/[0.06] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 block font-semibold">
                          SSE Transport Stream
                        </span>
                        <code className="text-xs font-mono text-neutral-900 font-bold truncate block">
                          /api/mcp/sse
                        </code>
                      </div>
                      <span className="text-[11px] font-medium text-emerald-600 shrink-0">
                        Active SSE
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-neutral-50 border border-black/[0.06] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 block font-semibold">
                          JSON-RPC 2.0 Messages
                        </span>
                        <code className="text-xs font-mono text-neutral-900 font-bold truncate block">
                          POST /api/mcp
                        </code>
                      </div>
                      <span className="text-[11px] font-medium text-neutral-500 shrink-0">
                        Method Dispatcher
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-neutral-50 border border-black/[0.06] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 block font-semibold">
                          Server Info &amp; Discovery
                        </span>
                        <code className="text-xs font-mono text-neutral-900 font-bold truncate block">
                          GET /api/mcp
                        </code>
                      </div>
                      <span className="text-[11px] font-medium text-neutral-500 shrink-0">
                        Manifest JSON
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-neutral-500">
                    Connect from Claude Desktop or Cursor IDE in seconds.
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateToDocs?.('/docs/integration/mcp')}
                    className="text-xs font-semibold text-[#0f9bc7] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>Read MCP Spec Guide</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tools Palette Grid */}
              <div className="rounded-3xl p-6 sm:p-7 bg-white border border-black/[0.08] shadow-sm">
                <h4 className="text-sm font-bold font-heading text-neutral-900 uppercase tracking-wider text-neutral-500 mb-3">
                  Tool Calling Samples
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {[
                    { name: 'avatar_act', desc: 'Execute /act cues & script' },
                    { name: 'avatar_say', desc: 'Live speech & lip sync' },
                    { name: 'web_search', desc: 'Real-time web snippets' },
                    { name: 'wikipedia', desc: 'Encyclopedia summaries' },
                    { name: 'weather_info', desc: 'Forecast & temperatures' },
                    { name: 'ask_persona', desc: 'Direct persona response' },
                  ].map((tool) => (
                    <div
                      key={tool.name}
                      className="p-2.5 rounded-xl bg-neutral-50 border border-black/[0.05] hover:border-[var(--theme-accent)]/50 transition-colors"
                    >
                      <code className="text-xs font-mono font-bold text-neutral-900 block truncate">
                        {tool.name}
                      </code>
                      <span className="text-[10px] text-neutral-500 block truncate mt-0.5">
                        {tool.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 5 cols: Client Configuration & /chat Integration */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              {/* Code Snippet Box with macOS Terminal Styling */}
              <div className="rounded-3xl p-6 sm:p-7 bg-[#13151f] text-white border border-white/10 shadow-lg flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
                      Client Integration CLI
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">
                      macOS / Linux / Windows
                    </span>
                  </div>

                  {/* Gorgeous macOS Terminal with syntax coloring and word wrap */}
                  <MacTerminalViewer
                    activeTab={activeMcpTab}
                    onChangeTab={setActiveMcpTab}
                  />
                </div>

                <div className="pt-4 mt-4 border-t border-white/10">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={onStartChat}
                      className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-[var(--theme-accent,#55d2f6)] text-neutral-950 hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-md"
                    >
                      <span>Connect in /chat Mode</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-2 text-center">
                    Also available under the &quot;+&quot; extensions menu inside /chat.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Continuous Chain Marquee (Above Applications Section) */}
        <div className="w-full select-none relative z-20">
          {/* Band 1: Text Marquee */}
          <div className="w-full overflow-hidden bg-neutral-900 border-t border-neutral-800 py-3">
            <div className="flex w-max animate-marquee items-center gap-6 whitespace-nowrap">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={`mq-top-1-${i}`}
                  className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold text-neutral-300"
                >
                  <span className="text-[#55d2f6]">Coming Soon</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                  <span className="text-neutral-100">Work in Progress</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                </div>
              ))}
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={`mq-top-2-${i}`}
                  className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold text-neutral-300"
                >
                  <span className="text-[#55d2f6]">Coming Soon</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                  <span className="text-neutral-100">Work in Progress</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                </div>
              ))}
            </div>
          </div>

          {/* Band 2: Row of arrows pointing DOWN towards the section */}
          <div className="w-full overflow-hidden bg-neutral-950 border-y border-neutral-800/80 py-2">
            <div className="flex w-max animate-marquee items-center gap-6 whitespace-nowrap">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={`arr-top-1-${i}`} className="inline-flex items-center gap-4 text-xs font-mono text-neutral-400">
                  <ArrowDown className="w-3.5 h-3.5 text-[#55d2f6] animate-pulse" strokeWidth={2.5} />
                  <span className="w-1 h-1 rounded-full bg-amber-400/80" />
                  <ArrowDown className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
                  <span className="w-1 h-1 rounded-full bg-neutral-600" />
                </div>
              ))}
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={`arr-top-2-${i}`} className="inline-flex items-center gap-4 text-xs font-mono text-neutral-400">
                  <ArrowDown className="w-3.5 h-3.5 text-[#55d2f6] animate-pulse" strokeWidth={2.5} />
                  <span className="w-1 h-1 rounded-full bg-amber-400/80" />
                  <ArrowDown className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
                  <span className="w-1 h-1 rounded-full bg-neutral-600" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION: VIRTUAL ASSISTANT AUTOMATON / APPLICATIONS (Moved below MCP) */}
        <section
          id="automation"
          className="relative z-20 bg-[#f8f9fc] py-20 lg:py-24 px-4 sm:px-6 lg:px-8 transition-colors"
        >
          {/* Hidden anchor element to also support #automaton */}
          <div id="automaton" className="absolute -top-16" />

          <div className="max-w-7xl mx-auto">
            {/* Centered Heading */}
            <div className="text-center max-w-3xl mx-auto mb-14 lg:mb-16">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest bg-[var(--theme-accent-soft)] text-[#0f9bc7] font-semibold mb-3">
                <Cpu className="w-3.5 h-3.5" />
                <span>Applications</span>
              </span>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold font-heading text-neutral-900 tracking-tight">
                Virtual Assistant Automaton
              </h2>
              <p className="text-sm sm:text-base text-neutral-600 mt-3 max-w-2xl mx-auto leading-relaxed">
                Deploy Hana as an autonomous operational agent for your business, enhancing and complementing your current human workforce outside their shift hours. Here are some example scenarios:
              </p>
            </div>

            {/* 4 Categories with same Accordion UI UX as before, arranged in 2-columns (md:grid-cols-2) or 1 top-bottom stacked column (grid-cols-1) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6 max-w-6xl mx-auto items-start">
              {AUTOMATION_DATA.map((item, idx) => {
                const isOpen = activeAutomationAccordion === idx;
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
                      isOpen
                        ? 'border-[#55d2f6] bg-white shadow-md ring-1 ring-[#55d2f6]/30'
                        : 'border-black/[0.08] bg-white hover:border-black/20 hover:bg-neutral-50/50'
                    }`}
                  >
                    {/* Accordion Trigger Header */}
                    <button
                      type="button"
                      onClick={() => handleToggleAutomationAccordion(idx)}
                      className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 cursor-pointer focus:outline-none"
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            isOpen
                              ? 'bg-[#55d2f6] text-neutral-950 shadow-xs scale-105'
                              : 'bg-neutral-100 text-neutral-500 scale-100'
                          }`}
                        >
                          <Icon className="w-5 h-5 stroke-[2]" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-500 font-semibold">
                              0{idx + 1}
                            </span>
                            <h3 className="text-lg sm:text-xl font-bold font-heading text-neutral-900 tracking-tight">
                              {item.title}
                            </h3>
                          </div>
                          <p className="text-xs text-neutral-500 truncate mt-0.5">
                            {item.tagline}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center border border-black/10 shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          isOpen ? 'rotate-180 bg-[#55d2f6]/10 text-neutral-900' : 'text-neutral-400'
                        }`}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </button>

                    {/* Accordion Expanded Body with Synchronized Smooth Height & Opacity Transition */}
                    <div
                      className={`grid transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        isOpen
                          ? 'grid-rows-[1fr] opacity-100'
                          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="px-5 pb-6 pt-1 sm:px-6 border-t border-black/[0.05]">
                          <ul className="space-y-3 pt-2">
                            {item.points.map((point, pIdx) => (
                              <li
                                key={pIdx}
                                className={`flex items-start gap-3 text-sm text-neutral-700 leading-snug transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                                  isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
                                }`}
                              >
                                <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                                <span className="capitalize">{point}</span>
                              </li>
                            ))}
                          </ul>

                          {item.id === 'ai-interviews' && (
                            <div className="mt-5 pt-4 border-t border-black/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div>
                                <span className="text-xs font-bold text-neutral-900 block">
                                  Experience Hana&apos;s AI Interview
                                </span>
                                <span className="text-[11px] text-neutral-500 block">
                                  Interactive candidate screening, recruiter studio, NeonDB persistence &amp; dossiers
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    onNavigateToInterview
                                      ? onNavigateToInterview('/interview?id=demo')
                                      : onStartChat()
                                  }
                                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-[#0f9bc7] hover:bg-[#117ba2] text-white shadow-xs hover:shadow transition-all active:scale-95 cursor-pointer"
                                >
                                  <span>Launch Demo</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {item.id === 'voice-calling' && (
                            <div className="mt-5 pt-4 border-t border-black/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div>
                                <span className="text-xs font-bold text-neutral-900 block">
                                  Experience Hana&apos;s AI Voice Caller
                                </span>
                                <span className="text-[11px] text-neutral-500 block">
                                  Direct phone dialing, editable RAG knowledge base &amp; real-time 2-way voice booking
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateToCaller
                                    ? onNavigateToCaller()
                                    : onStartChat()
                                }
                                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-[#0f9bc7] hover:bg-[#117ba2] text-white shadow-xs hover:shadow transition-all active:scale-95 cursor-pointer shrink-0"
                              >
                                <span>Launch AI Caller</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Continuous Chain Marquee (Below Applications Section) */}
        <div className="w-full select-none relative z-20">
          {/* Band 1: Row of arrows pointing UP towards the section */}
          <div className="w-full overflow-hidden bg-neutral-950 border-t border-neutral-800/80 py-2">
            <div className="flex w-max animate-marquee-reverse items-center gap-6 whitespace-nowrap">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={`arr-bot-1-${i}`} className="inline-flex items-center gap-4 text-xs font-mono text-neutral-400">
                  <ArrowUp className="w-3.5 h-3.5 text-[#55d2f6] animate-pulse" strokeWidth={2.5} />
                  <span className="w-1 h-1 rounded-full bg-amber-400/80" />
                  <ArrowUp className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
                  <span className="w-1 h-1 rounded-full bg-neutral-600" />
                </div>
              ))}
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={`arr-bot-2-${i}`} className="inline-flex items-center gap-4 text-xs font-mono text-neutral-400">
                  <ArrowUp className="w-3.5 h-3.5 text-[#55d2f6] animate-pulse" strokeWidth={2.5} />
                  <span className="w-1 h-1 rounded-full bg-amber-400/80" />
                  <ArrowUp className="w-3.5 h-3.5 text-white/80" strokeWidth={2} />
                  <span className="w-1 h-1 rounded-full bg-neutral-600" />
                </div>
              ))}
            </div>
          </div>

          {/* Band 2: Text Marquee */}
          <div className="w-full overflow-hidden bg-neutral-900 border-y border-neutral-800 py-3">
            <div className="flex w-max animate-marquee-reverse items-center gap-6 whitespace-nowrap">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={`mq-bot-1-${i}`}
                  className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold text-neutral-300"
                >
                  <span className="text-[#55d2f6]">Coming Soon</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                  <span className="text-neutral-100">Work in Progress</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                </div>
              ))}
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={`mq-bot-2-${i}`}
                  className="inline-flex items-center gap-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase font-semibold text-neutral-300"
                >
                  <span className="text-[#55d2f6]">Coming Soon</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                  <span className="text-neutral-100">Work in Progress</span>
                  <span className="text-amber-400 font-bold">&bull;</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION: PRICING (Above Ready to Chat with Hana?) */}
        <section
          id="pricing"
          className="relative z-20 py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto border-t border-black/[0.06]"
        >
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest bg-[var(--theme-accent-soft)] text-[#0f9bc7] font-semibold mb-3">
              <Crown className="w-3.5 h-3.5 text-amber-500" />
              <span>Membership & Pricing</span>
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold font-heading text-neutral-900 tracking-tight">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-4 text-base sm:text-lg text-neutral-600 leading-relaxed">
              Experience private local AI for free, or unlock premium avatar wardrobe customizations, theme creation, and cloud sync.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto items-stretch">
            {/* Fan Tier ($0) */}
            <div className="rounded-3xl p-7 sm:p-8 bg-white border border-black/[0.08] shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="text-xl font-bold font-heading text-neutral-900">
                    Fan Tier
                  </h3>
                </div>
                <div className="mb-6">
                  <span className="text-4xl sm:text-5xl font-extrabold font-heading text-neutral-900 tracking-tight">
                    $0
                  </span>
                  <span className="text-xs text-neutral-500 font-mono ml-2">/ forever</span>
                  <p className="text-xs text-neutral-500 mt-2">
                    Everything you need
                  </p>
                </div>

                <div className="space-y-3 pt-4 border-t border-black/[0.06]">
                  {[
                    'Unlimited conversation messages & turns',
                    '3D mode with voice engine',
                    'In-browser on-device SLM execution (WebGPU/Wasm)',
                    'Connect custom local Ollama / vLLM servers',
                    'Connect with APIs and integrations',
                  ].map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm text-neutral-700">
                      <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-4">
                <button
                  type="button"
                  onClick={onStartChat}
                  className="w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-900 shadow-xs active:scale-98 transition-all cursor-pointer"
                >
                  Selected
                </button>
              </div>
            </div>

            {/* VIP Tier ($5/month) */}
            <div className="relative rounded-3xl p-7 sm:p-8 bg-gradient-to-b from-white to-[#f0faff] border-2 border-[#55d2f6] shadow-xl ring-1 ring-[#55d2f6]/40 flex flex-col justify-between">
              {/* Highlight ribbon */}
              <div className="absolute -top-3.5 right-6 px-3 py-1 rounded-full bg-[#55d2f6] text-neutral-950 text-[11px] font-bold tracking-wider uppercase shadow-xs flex items-center gap-1 font-mono">
                <Crown className="w-3 h-3" />
                <span>Premium</span>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h3 className="text-xl font-bold font-heading text-neutral-900 flex items-center gap-2">
                    <span>VIP Tier</span>
                  </h3>
                </div>

                <div className="mb-6">
                  <span className="text-4xl sm:text-5xl font-extrabold font-heading text-neutral-900 tracking-tight">
                    $5
                  </span>
                  <span className="text-xs text-neutral-500 font-mono ml-2">/ month</span>
                  <p className="text-xs text-neutral-500 mt-2">
                    Everything you want
                  </p>
                </div>

                <div className="space-y-3 pt-4 border-t border-black/[0.06]">
                  {[
                    'Unlimited conversation messages & turns',
                    '3D mode with voice engine',
                    '3D avatar customizations',
                    'Custom theme designer',
                    'In-browser on-device SLM execution (WebGPU/Wasm)',
                    'Connect custom local Ollama / vLLM servers',
                    'Connect with APIs and integrations',
                    'Sync account data, settings with cloud storage',
                    'Enhanced customer support',
                    'Early access to new features',
                  ].map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm text-neutral-800">
                      <div className="w-5 h-5 rounded-full bg-[#55d2f6]/25 text-[#0a7a9e] flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                      <span className={idx === 2 || idx === 3 || idx === 7 ? 'font-medium text-neutral-950' : ''}>
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-4">
                <a
                  href="https://muks.gumroad.com/l/hana-vip?wanted=true"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold bg-[#55d2f6] hover:bg-[#32c5f2] text-neutral-950 shadow-md hover:shadow-lg shadow-[#55d2f6]/30 active:scale-98 transition-all cursor-pointer group"
                >
                  <Crown className="w-4 h-4 text-neutral-950" />
                  <span>Subscribe</span>
                  <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM CALL TO ACTION STRIP */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center">
          <div className="rounded-3xl p-8 sm:p-12 bg-white border border-black/[0.08] shadow-lg flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-[#55d2f6]/20 text-[#0f9bc7] flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 stroke-[2.2]" />
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold font-heading text-neutral-900 tracking-tight">
              Ready to Chat with Hana?
            </h3>
            <p className="text-sm sm:text-base text-neutral-500 max-w-md mt-2 leading-relaxed">
              No cloud accounts or external subscriptions needed. Everything runs locally in your browser session.
            </p>
            <button
              onClick={onStartChat}
              className="mt-6 inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-base font-semibold bg-[#1e2029] text-white hover:bg-neutral-800 shadow-md active:scale-95 transition-all group cursor-pointer"
            >
              <span>LM Chat</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </section>

        {/* SPECIAL THANKS & PRODUCT HUNT SECTION (Above Footer) */}
        <section
          id="special-thanks"
          className="relative z-20 bg-white/95 border-t border-black/[0.08] py-16 lg:py-20 px-4 sm:px-6 lg:px-8"
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#22bdec] font-semibold mb-2">
                  <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                  <span> Acknowledgements</span>
                </span>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold font-heading text-neutral-900 tracking-tight">
                  Special Thanks
                </h2>
                <p className="text-sm text-neutral-500 mt-1.5 max-w-xl">
                  This project could not be possible without:
                </p>
              </div>

              {/* ProductHunt and Peerlist Launch Badges */}
              <div className="flex flex-wrap items-center gap-3 shrink-0 self-start md:self-auto">
                <a
                  href="https://www.producthunt.com/products/ai-smash?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-hana-c650f112-68f2-44d7-b71e-c36714b8419c"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                >
                  <img
                    alt="Hana - Self-hosted decentralized 3D HCI-AI companion | Product Hunt"
                    width="250"
                    height="54"
                    src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1268384&theme=light&t=1791483853467"
                  />
                </a>
                <a
                  href="https://peerlist.io/dmkto/project/ai-smash"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center"
                >
                  <img
                    src="https://peerlist.io/api/v1/projects/embed/PRJHA9E8KMQGNLPQ6CKQ69GBDJK7GA?showUpvote=true&theme=light"
                    alt="Hana"
                    style={{ width: 'auto', height: '72px' }}
                  />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {SPECIAL_THANKS_LINKS.map((entry) => (
                <a
                  key={entry.name}
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 sm:p-5 rounded-2xl bg-[#f8f9fc] hover:bg-white border border-black/[0.08] hover:border-[#55d2f6] shadow-2xs hover:shadow-md transition-all duration-200 flex items-start justify-between gap-3 group"
                >
                  <div className="min-w-0">
                    <h3 className="text-base font-bold font-heading text-neutral-900 group-hover:text-[#0f9bc7] transition-colors flex items-center gap-1.5">
                      <span>{entry.name}</span>
                    </h3>
                    <p className="text-xs sm:text-sm text-neutral-600 mt-1 leading-relaxed">
                      {entry.description}
                    </p>
                  </div>
                  <div className="w-7 h-7 rounded-xl bg-white border border-black/[0.06] flex items-center justify-center text-neutral-400 group-hover:text-[#0f9bc7] group-hover:border-[#55d2f6]/40 shrink-0 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="relative z-20 border-t border-black/[0.08] bg-white py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Company branding */}
          <div className="flex items-center gap-3">
            <a
              href="https://mux8.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-lg tracking-tight font-heading text-neutral-900 hover:text-[var(--theme-accent,#0f9bc7)] transition-colors"
            >
              MuxAI
            </a>
          </div>

          {/* Social Links */}
          <div className="flex items-center gap-5 text-sm text-neutral-600">
            <a
              href="https://www.linkedin.com/company/huanmux"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-neutral-900 font-medium transition-colors"
              title="MuxAI on LinkedIn"
            >
              <Linkedin className="w-4 h-4 text-blue-600" />
              <span>LinkedIn</span>
            </a>

            <a
              href="https://github.com/MuxAI/hana.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-neutral-900 font-medium transition-colors"
              title="Hana on GitHub"
            >
              <Github className="w-4 h-4 text-neutral-900" />
              <span>GitHub</span>
            </a>
          </div>

          {/* Copyright notice */}
          <div className="text-xs text-neutral-400 font-mono">
            &copy; {new Date().getFullYear()}{' '}
            <a
              href="https://mux8.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-700 hover:underline transition-colors"
            >
              MuxAI
            </a>
            . All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};
