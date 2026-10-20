import React, { useState } from 'react';
import { ArrowRight, BookOpen, Menu, X, Sparkles, Shield, Terminal, Crown, Bot } from 'lucide-react';

export interface LandingNavbarProps {
  onStartChat: () => void;
  onNavigateToDocs?: (path?: string) => void;
  onNavigateHome?: () => void;
  isInsideLandingPage?: boolean;
}

export const LandingNavbar: React.FC<LandingNavbarProps> = ({
  onStartChat,
  onNavigateToDocs,
  onNavigateHome,
  isInsideLandingPage = false,
}) => {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const handleSectionClick = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    setIsMobileNavOpen(false);

    if (isInsideLandingPage) {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    // If outside landing page (e.g. in /humanizer), navigate to landing page section
    if (onNavigateHome) {
      onNavigateHome();
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else window.location.hash = sectionId;
      }, 100);
    } else {
      window.location.href = `/#${sectionId}`;
    }
  };

  const handleLogoClick = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else if (isInsideLandingPage) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.location.href = '/';
    }
  };

  return (
    <>
      {/* Top Navbar (Sticky) */}
      <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/80 border-b border-black/[0.06] transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo - clean image without squircle frame */}
          <div
            onClick={handleLogoClick}
            className="flex items-center gap-3 cursor-pointer select-none group"
          >
            <img
              src="https://ai.mux8.com/hana_icon.png"
              alt="Hana"
              className="w-9 h-9 object-contain group-hover:scale-105 transition-transform"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/hana_icon.png';
              }}
            />
            <div>
              <span className="font-bold text-lg tracking-tight font-heading block leading-none">
                Makron <span className="text-[var(--theme-accent,#0f9bc7)]">Hana</span>
              </span>
            </div>
          </div>

          {/* Desktop Nav links & CTA */}
          <div className="hidden md:flex items-center gap-6">
            <a
              href="#why-it-matters"
              onClick={(e) => handleSectionClick(e, 'why-it-matters')}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              Why It Matters
            </a>
            <a
              href="#integrations-apis"
              onClick={(e) => handleSectionClick(e, 'integrations-apis')}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              Extensions & APIs
            </a>
            <a
              href="#mcp"
              onClick={(e) => handleSectionClick(e, 'mcp')}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              MCP
            </a>
            <a
              href="#automation"
              onClick={(e) => handleSectionClick(e, 'automation')}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              Automation
            </a>
            <a
              href="#pricing"
              onClick={(e) => handleSectionClick(e, 'pricing')}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
            >
              Pricing
            </a>
            <button
              type="button"
              onClick={() => onNavigateToDocs?.('/docs')}
              className="text-xs font-semibold text-[#0f9bc7] hover:underline transition-colors flex items-center gap-1 cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Docs</span>
            </button>
            <button
              type="button"
              onClick={onStartChat}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#1e2029] text-white hover:bg-neutral-800 shadow-sm active:scale-95 transition-all group cursor-pointer"
            >
              <span>LM Chat</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Mobile UI: AI Chat + Hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <button
              type="button"
              onClick={onStartChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1e2029] text-white hover:bg-neutral-800 shadow-sm active:scale-95 transition-all group cursor-pointer"
            >
              <span>LM Chat</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
              className="p-2 rounded-xl text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100 border border-black/[0.08] active:scale-95 transition-all cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {isMobileNavOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Collapsible Navigation Sidebar Drawer */}
      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex justify-end animate-in fade-in duration-150">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileNavOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-72 max-w-[85vw] h-full bg-white shadow-2xl border-l border-black/[0.08] flex flex-col p-5 z-10 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] mb-4">
              <div
                onClick={() => {
                  setIsMobileNavOpen(false);
                  handleLogoClick();
                }}
                className="flex items-center gap-2.5 cursor-pointer"
              >
                <img
                  src="https://ai.mux8.com/hana_icon.png"
                  alt="Hana"
                  className="w-8 h-8 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/hana_icon.png';
                  }}
                />
                <span className="font-bold text-base tracking-tight font-heading">
                  Makron <span className="text-[var(--theme-accent,#0f9bc7)]">Hana</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Nav Links */}
            <nav className="flex-1 space-y-1.5">
              <a
                href="#why-it-matters"
                onClick={(e) => handleSectionClick(e, 'why-it-matters')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors cursor-pointer"
              >
                <Shield className="w-4 h-4 text-neutral-400" />
                <span>Why It Matters</span>
              </a>

              <a
                href="#integrations-apis"
                onClick={(e) => handleSectionClick(e, 'integrations-apis')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-neutral-400" />
                <span>Extensions & APIs</span>
              </a>

              <a
                href="#mcp"
                onClick={(e) => handleSectionClick(e, 'mcp')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors cursor-pointer"
              >
                <Terminal className="w-4 h-4 text-neutral-400" />
                <span>MCP</span>
              </a>

              <a
                href="#automation"
                onClick={(e) => handleSectionClick(e, 'automation')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors cursor-pointer"
              >
                <Bot className="w-4 h-4 text-neutral-400" />
                <span>Automation</span>
              </a>

              <a
                href="#pricing"
                onClick={(e) => handleSectionClick(e, 'pricing')}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors cursor-pointer"
              >
                <Crown className="w-4 h-4 text-neutral-400" />
                <span>Pricing</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  setIsMobileNavOpen(false);
                  onNavigateToDocs?.('/docs');
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100/80 transition-colors text-left cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-[#0f9bc7]" />
                <span>Documentation</span>
              </button>
            </nav>

            {/* Bottom CTA in Drawer */}
            <div className="pt-4 border-t border-black/[0.06] space-y-2">
              <button
                type="button"
                onClick={() => {
                  setIsMobileNavOpen(false);
                  onStartChat();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold bg-[#1e2029] text-white hover:bg-neutral-800 shadow-sm active:scale-95 transition-all cursor-pointer"
              >
                <span>LM Chat</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
