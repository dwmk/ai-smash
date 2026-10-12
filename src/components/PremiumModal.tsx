import React from 'react';
import { X, Crown, Check, ArrowRight, Sparkles } from 'lucide-react';
import { THEME_COLORS } from '../constants';

interface PremiumModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PremiumModal: React.FC<PremiumModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const vipFeatures = [
    'Unlimited conversation messages & turns',
    '3D mode with voice engine',
    '3D avatar customizations & wardrobe outfits',
    'Custom theme designer',
    'In-browser on-device SLM execution (WebGPU/Wasm)',
    'Connect custom local Ollama / vLLM servers',
    'Connect with APIs and integrations',
    'Create and review automated interviews',
    'Access the full Hana ecosystem',
    'Sync account data, settings with cloud storage',
    'Enhanced customer support',
    'Early access to new features',
  ];

  const paymentPortalUrl = 'https://muks.gumroad.com/l/hana-vip?wanted=true';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl p-6 sm:p-7 shadow-2xl border animate-in zoom-in-95 duration-150 overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-surface, #ffffff)',
          borderColor: 'var(--theme-accent, #55d2f6)',
          boxShadow: '0 20px 50px -10px var(--theme-accent-soft, rgba(85,210,246,0.3))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Highlight ribbon */}
        <div
          className="absolute -top-1 right-6 px-3 py-1 rounded-b-xl text-[11px] font-bold tracking-wider uppercase shadow-xs flex items-center gap-1 font-mono"
          style={{
            backgroundColor: 'var(--theme-accent, #55d2f6)',
            color: 'var(--theme-user-bubble-text, #0f1117)',
          }}
        >
          <Crown className="w-3 h-3 fill-current" />
          <span>Premium</span>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 left-4 p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close premium modal"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header & Pricing */}
        <div className="text-center pt-4 mb-5">
          <div
            className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center shadow-sm"
            style={{
              backgroundColor: 'var(--theme-accent-soft, rgba(85,210,246,0.15))',
              color: 'var(--theme-accent, #55d2f6)',
            }}
          >
            <Crown className="w-6 h-6" />
          </div>

          <h3 className="text-2xl font-bold font-heading text-neutral-900 dark:text-white tracking-tight">
            VIP Tier
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Everything you want
          </p>

          <div className="mt-3 flex items-baseline justify-center">
            <span className="text-4xl sm:text-5xl font-extrabold font-heading text-neutral-900 dark:text-white tracking-tight">
              $5
            </span>
            <span className="text-xs text-neutral-500 font-mono ml-1.5">/ month</span>
          </div>
        </div>

        {/* Features List */}
        <div className="space-y-2.5 py-4 border-t border-b border-black/[0.06] dark:border-white/[0.08] max-h-[42vh] overflow-y-auto pr-1">
          {vipFeatures.map((feat, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-neutral-700 dark:text-neutral-200">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: 'var(--theme-accent-soft, rgba(85,210,246,0.2))',
                  color: 'var(--theme-accent, #55d2f6)',
                }}
              >
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
              <span className={idx === 2 || idx === 3 || idx === 7 ? 'font-semibold text-neutral-950 dark:text-white' : ''}>
                {feat}
              </span>
            </div>
          ))}
        </div>

        {/* Action Button: Linking to Payment Portal */}
        <div className="mt-5 space-y-2.5">
          <a
            href={paymentPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold shadow-md active:scale-98 transition-all group cursor-pointer"
            style={{
              backgroundColor: 'var(--theme-accent, #55d2f6)',
              color: 'var(--theme-user-bubble-text, #0f1117)',
            }}
          >
            <span>Unlock Access</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>

          <p className="text-[11px] text-center text-neutral-400 font-mono">
            Have a coupon code? Redeem it in Account Settings.
          </p>
        </div>
      </div>
    </div>
  );
};
