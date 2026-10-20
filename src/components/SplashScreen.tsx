import React, { useEffect, useState } from 'react';
import { THEME_COLORS, SPLASH_CONFIG, UI_CONFIG } from '../constants';

interface SplashScreenProps {
  isReady: boolean;
  theme: 'light' | 'dark';
  onFadeComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isReady,
  theme,
  onFadeComplete,
}) => {
  const [shouldFadeOut, setShouldFadeOut] = useState(false);
  const [isRendered, setIsRendered] = useState(true);

  // Trigger fade-out when isReady is true or after timeout
  useEffect(() => {
    if (isReady && !shouldFadeOut) {
      // Slight delay so the user experiences the smooth completion transition
      const timer = setTimeout(() => {
        setShouldFadeOut(true);
      }, UI_CONFIG.splashCompletionDelayMs);
      return () => clearTimeout(timer);
    }
  }, [isReady, shouldFadeOut]);

  // Remove completely from DOM after fade transition completes
  useEffect(() => {
    if (shouldFadeOut) {
      const timer = setTimeout(() => {
        setIsRendered(false);
        onFadeComplete();
      }, UI_CONFIG.splashFadeDurationMs);
      return () => clearTimeout(timer);
    }
  }, [shouldFadeOut, onFadeComplete]);

  if (!isRendered) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-between items-center px-6 py-8 select-none transition-opacity duration-700 ease-out ${
        shouldFadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      } ${THEME_COLORS.tokens.appBg} ${THEME_COLORS.tokens.appText}`}
      style={{
        backgroundColor: 'var(--theme-bg)',
        color: 'var(--theme-text)',
      }}
    >
      {/* Top Balanced Spacer */}
      <div className="h-10 w-full" />

      {/* Centered Region: Logo, Title, and fast-spinning loader */}
      <div className="flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-500">
        <div className="relative group">
          <img
            src={SPLASH_CONFIG.logoUrl}
            alt={SPLASH_CONFIG.title}
            className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-xl transition-transform duration-300 group-hover:scale-105"
            draggable={false}
            loading="eager"
            decoding="sync"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== 'https://makron.app/assets/logo.png') {
                target.src = 'https://makron.app/assets/logo.png';
              }
            }}
          />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-5 font-heading">
          {SPLASH_CONFIG.title}
        </h1>

        {/* Fast-spinning loader */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-[2.5px] animate-spin"
            style={{
              animationDuration: '0.45s',
              borderColor: 'var(--theme-accent-soft)',
              borderTopColor: 'var(--theme-accent)',
            }}
            aria-label="Loading assets"
          />
          <p className="text-xs font-mono text-neutral-400 dark:text-neutral-500 tracking-wide mt-1">
            {SPLASH_CONFIG.subtitle}
          </p>
        </div>
      </div>

      {/* Footer Links */}
      <footer className="w-full text-center text-xs text-neutral-500 dark:text-neutral-400 font-sans tracking-wide">
        <span className="opacity-80">Other links:</span>{' '}
        {SPLASH_CONFIG.footerLinks.map((link, idx) => (
          <React.Fragment key={link.url}>
            {idx > 0 && ' • '}
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`font-medium ${THEME_COLORS.tokens.accentTextHover} transition-colors underline-offset-2 hover:underline`}
            >
              {link.label}
            </a>
          </React.Fragment>
        ))}
      </footer>
    </div>
  );
};
