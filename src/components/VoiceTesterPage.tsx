import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Square,
  Pause,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Activity,
  Layers,
  Check,
  Terminal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  VOICE_CONFIG,
  THEME_COLORS,
} from '../constants';
import {
  findVoiceFromList,
} from '../lib/audio';

interface VoiceTesterPageProps {
  onNavigateToChat: () => void;
  onNavigateHome: () => void;
  onNavigateToDocs?: (path?: string) => void;
}

interface LogEntry {
  id: string;
  time: string;
  type: 'start' | 'end' | 'boundary' | 'error' | 'info';
  message: string;
}

const PRESET_TEST_TEXTS = [
  {
    label: 'Hana Greeting',
    text: "Hello! I am Hana, your AI companion. This is a voice test for the Makron speech synthesis audio engine.",
  },
  {
    label: 'Casual Chat',
    text: "Good morning! Did you sleep well? I was just tending to the flowers in the garden while waiting for you.",
  },
  {
    label: 'Intonation & Question',
    text: "Wait, really? Are you sure that's how it happened? Don't worry, we can figure this out together!",
  },
  {
    label: 'Tongue Twister',
    text: "She sells seashells by the seashore, and the shells she sells are surely seashells.",
  },
  {
    label: 'Technical Terms',
    text: "Web Speech API synthesizes phonemes with real-time word boundary cues and local offline drivers.",
  },
];

export const VoiceTesterPage: React.FC<VoiceTesterPageProps> = ({
  onNavigateToChat,
}) => {
  // ----------------------------------------------------
  // Speech & Voice State
  // ----------------------------------------------------
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [selectedPackName, setSelectedPackName] = useState<string>('');
  const [inputText, setInputText] = useState<string>(
    "Hello! I am Hana, your AI companion. This is a voice test for the Makron speech synthesis audio engine."
  );

  // Engine parameters
  const [pitch, setPitch] = useState<number>(VOICE_CONFIG.pitch); // 1.25
  const [rate, setRate] = useState<number>(VOICE_CONFIG.rate); // 1.05
  const [volume, setVolume] = useState<number>(1.0);

  // Playback state
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [currentWord, setCurrentWord] = useState<string>('');

  // Logs & Diagnostics
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogExpanded, setIsLogExpanded] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Logging helper
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const timeStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogs((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        time: timeStr,
        type,
        message,
      },
      ...prev.slice(0, 99),
    ]);
  }, []);

  // ----------------------------------------------------
  // Voice Loading and Detection
  // ----------------------------------------------------
  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);
    const available = window.speechSynthesis.getVoices();
    setVoices(available);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setIsSupported(false);
      return;
    }

    loadVoices();

    const handleVoicesChanged = () => {
      loadVoices();
    };

    window.speechSynthesis.onvoiceschanged = handleVoicesChanged;

    const timer = setTimeout(() => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0 && voices.length === 0) {
        setVoices(v);
      }
    }, 400);

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
      clearTimeout(timer);
    };
  }, [loadVoices, voices.length]);

  // ----------------------------------------------------
  // Match ONLY the voice packs configured in constants
  // ----------------------------------------------------
  const voicePackItems = useMemo(() => {
    return VOICE_CONFIG.priorityQueue.map((packName, index) => {
      const matched = voices.find((v) =>
        (v.name || '').toLowerCase().includes(packName.toLowerCase())
      );
      return {
        id: packName,
        priorityIndex: index + 1,
        packName,
        isLoaded: Boolean(matched),
        voice: matched || null,
      };
    });
  }, [voices]);

  // Default selection to first available voice pack or Hana's active voice
  useEffect(() => {
    if (!selectedPackName && voicePackItems.length > 0) {
      const firstAvailable = voicePackItems.find((p) => p.isLoaded);
      if (firstAvailable) {
        setSelectedPackName(firstAvailable.packName);
      } else {
        setSelectedPackName(voicePackItems[0].packName);
      }
    }
  }, [voicePackItems, selectedPackName]);

  const loadedPacksCount = useMemo(() => {
    return voicePackItems.filter((p) => p.isLoaded).length;
  }, [voicePackItems]);

  const selectedPack = useMemo(() => {
    return voicePackItems.find((p) => p.packName === selectedPackName) || null;
  }, [voicePackItems, selectedPackName]);

  // ----------------------------------------------------
  // Speech Playback Controller
  // ----------------------------------------------------
  const stopPlayback = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentWord('');
    addLog('info', 'Audio playback stopped.');
  }, [addLog]);

  const pausePlayback = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      addLog('info', 'Audio playback paused.');
    } else if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      addLog('info', 'Audio playback resumed.');
    }
  }, [isSpeaking, isPaused, addLog]);

  const speakText = useCallback(
    (targetVoice?: SpeechSynthesisVoice | null, customPitch?: number, customRate?: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setLastError('SpeechSynthesis is unsupported in this environment');
        return;
      }

      const text = inputText.trim();
      if (!text) {
        addLog('error', 'Cannot speak: text input is empty.');
        return;
      }

      // Voice to use
      let voiceToUse = targetVoice;
      if (!voiceToUse && selectedPack?.voice) {
        voiceToUse = selectedPack.voice;
      }
      if (!voiceToUse) {
        // Fallback to first loaded pack
        const fallback = voicePackItems.find((p) => p.voice);
        voiceToUse = fallback?.voice || null;
      }

      if (!voiceToUse) {
        setLastError('No installed voice pack found on this system');
        addLog('error', 'Cannot speak: Selected voice pack is not loaded on this system.');
        return;
      }

      window.speechSynthesis.cancel();
      setLastError(null);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = typeof customPitch === 'number' ? customPitch : pitch;
      utterance.rate = typeof customRate === 'number' ? customRate : rate;
      utterance.volume = volume;
      utterance.voice = voiceToUse;
      utterance.lang = voiceToUse.lang;

      activeUtteranceRef.current = utterance;

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
        addLog('start', `Started playing with "${voiceToUse?.name}"`);
      };

      utterance.onboundary = (event) => {
        const charIdx = event.charIndex || 0;
        let charLen = event.charLength || 0;
        if (!charLen) {
          const match = text.slice(charIdx).match(/^\S+/);
          charLen = match ? match[0].length : 5;
        }
        const word = text.slice(charIdx, charIdx + charLen);
        setCurrentWord(word);
        addLog('boundary', `Boundary: "${word}" [${charIdx}]`);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        setCurrentWord('');
        activeUtteranceRef.current = null;
        addLog('end', 'Finished playing.');
      };

      utterance.onerror = (event) => {
        const errType = event.error || 'unknown';
        if (errType !== 'interrupted' && errType !== 'canceled') {
          setLastError(errType);
          addLog('error', `Synthesis error: "${errType}"`);
        }
        setIsSpeaking(false);
        setIsPaused(false);
        setCurrentWord('');
        activeUtteranceRef.current = null;
      };

      utterance.onpause = () => {
        setIsPaused(true);
      };

      utterance.onresume = () => {
        setIsPaused(false);
      };

      window.speechSynthesis.speak(utterance);
    },
    [inputText, selectedPack, voicePackItems, pitch, rate, volume, addLog]
  );

  const handleForceReload = useCallback(() => {
    setIsRefreshing(true);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const v = window.speechSynthesis.getVoices();
        setVoices(v);
        addLog('info', `Queried getVoices(): ${v.length} voices returned.`);
      } catch (err) {
        addLog('error', `Query failed: ${String(err)}`);
      }
    }
    setTimeout(() => setIsRefreshing(false), 300);
  }, [addLog]);

  return (
    <div className="min-h-screen w-full bg-[var(--theme-bg,#f8f9fc)] text-[var(--theme-text,#1e2029)] font-sans antialiased p-4 sm:p-6 md:p-8 space-y-6">
      {/* ----------------------------------------------------
          Unlisted Miniapp Top Action Bar (No public navbar)
         ---------------------------------------------------- */}
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onNavigateToChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-neutral-200/80 hover:bg-neutral-300/80 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-neutral-800 dark:text-neutral-100 transition-all cursor-pointer active:scale-95"
            title="Return to chat"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>
          <div>
            <h1 className="text-sm sm:text-base font-bold font-heading text-neutral-900 dark:text-white leading-none">
              Voice Pack Diagnostics <span className="font-mono text-xs font-normal text-neutral-400">(/voice)</span>
            </h1>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
              Testing {voicePackItems.length} voice packs configured in constants.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleForceReload}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-[#1a1c29] hover:bg-neutral-100 dark:hover:bg-white/[0.08] text-neutral-700 dark:text-neutral-200 border border-black/10 dark:border-white/10 transition-all cursor-pointer active:scale-95 shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Reload Voices</span>
        </button>
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* ----------------------------------------------------
            Warnings Banner (if speech synthesis or packs fail)
           ---------------------------------------------------- */}
        {!isSupported && (
          <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-900 dark:text-red-200 text-xs sm:text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">SpeechSynthesis Unsupported</span>
              Web Speech API is not supported in this browser environment.
            </div>
          </div>
        )}

        {isSupported && loadedPacksCount === 0 && voices.length === 0 && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs sm:text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">No Voice Packs Loaded</span>
              The browser speech engine has not returned any voices yet. Click "Reload Voices" or interact with the page to trigger browser speech initialization.
            </div>
          </div>
        )}

        {isSupported && loadedPacksCount === 0 && voices.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs sm:text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Configured Voice Packs Not Found</span>
              None of the {voicePackItems.length} voice packs configured in constants are installed on this client operating system.
            </div>
          </div>
        )}

        {lastError && (
          <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-900 dark:text-red-200 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
              <span>Speech engine warning: "{lastError}"</span>
            </div>
            <button
              type="button"
              onClick={() => setLastError(null)}
              className="text-xs underline hover:no-underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ----------------------------------------------------
            1. Grid of Available Voicepacks (APPEARS ABOVE INPUT PANEL)
           ---------------------------------------------------- */}
        <section className="bg-white dark:bg-[#13151f] border border-black/[0.08] dark:border-white/[0.08] rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--theme-accent,#55d2f6)]" />
              <h2 className="text-sm sm:text-base font-bold font-heading text-neutral-900 dark:text-white">
                Available Voice Packs (Constants)
              </h2>
            </div>
            <div className="text-xs font-mono text-neutral-500">
              {loadedPacksCount} / {voicePackItems.length} loaded
            </div>
          </div>

          {/* Grid of voicepacks from constants */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {voicePackItems.map((item) => {
              const isSelected = selectedPackName === item.packName;

              return (
                <div
                  key={item.packName}
                  onClick={() => {
                    setSelectedPackName(item.packName);
                  }}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] border-[var(--theme-accent,#55d2f6)] ring-2 ring-[var(--theme-accent,#55d2f6)]/40 shadow-xs'
                      : item.isLoaded
                      ? 'bg-neutral-50/80 dark:bg-white/[0.03] border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20'
                      : 'bg-neutral-100/40 dark:bg-white/[0.01] border-dashed border-black/15 dark:border-white/10 opacity-70'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <span className="font-mono text-neutral-400">#{item.priorityIndex}</span>
                      {item.isLoaded ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3 h-3" />
                          <span>Loaded</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Not Loaded</span>
                        </span>
                      )}
                    </div>

                    <div className="font-bold text-xs sm:text-sm text-neutral-900 dark:text-white truncate">
                      {item.packName}
                    </div>

                    {item.isLoaded && item.voice ? (
                      <div className="text-[11px] text-neutral-500 font-mono truncate">
                        {item.voice.name} ({item.voice.lang})
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-tight">
                        Warning: Voice pack could not be loaded from system.
                      </div>
                    )}
                  </div>

                  {/* Card actions */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-black/[0.05] dark:border-white/[0.05]">
                    {item.isLoaded && item.voice ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPackName(item.packName);
                            speakText(item.voice);
                          }}
                          className="flex-1 py-1 px-2 rounded-xl text-[11px] font-semibold bg-[var(--theme-accent,#55d2f6)] text-neutral-950 hover:opacity-90 transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Try Voice</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPackName(item.packName);
                          }}
                          className={`py-1 px-2.5 rounded-xl text-[11px] font-medium transition-all ${
                            isSelected
                              ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                              : 'bg-white dark:bg-[#1a1c29] border border-black/10 dark:border-white/10 text-neutral-700 dark:text-neutral-300'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full py-1 px-2 rounded-xl text-[10px] text-neutral-400 bg-black/5 dark:bg-white/5 cursor-not-allowed text-center"
                      >
                        Unavailable
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ----------------------------------------------------
            2. Text to Speech Audio Engine Input Panel (BELOW GRID)
               - No drop-down selector! User selects from grid above.
               - Status pill strictly says "Engine Idle" or "Playing"
           ---------------------------------------------------- */}
        <section className="bg-white dark:bg-[#13151f] border border-black/[0.08] dark:border-white/[0.08] rounded-3xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/[0.06] dark:border-white/[0.06] pb-4">
            <div className="space-y-0.5">
              <h2 className="text-base font-bold font-heading text-neutral-900 dark:text-white flex items-center gap-2">
                <Volume2 className="w-5 h-5 text-[var(--theme-accent,#55d2f6)]" />
                <span>Audio Engine Input Panel</span>
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Type text to test speech synthesis with the selected voice pack from the grid above.
              </p>
            </div>

            {/* Status Pill: strictly Engine Idle or Playing */}
            <div className="self-start sm:self-center">
              <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium border ${
                  isSpeaking
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : 'bg-neutral-100 dark:bg-white/[0.05] border-black/5 dark:border-white/5 text-neutral-600 dark:text-neutral-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSpeaking ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'
                  }`}
                />
                <span>{isSpeaking ? 'Playing' : 'Engine Idle'}</span>
              </div>
            </div>
          </div>

          {/* Current Selection Notice (No dropdown) */}
          <div className="p-3 rounded-2xl bg-neutral-50 dark:bg-white/[0.03] border border-black/5 dark:border-white/5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <span className="text-neutral-400">Selected Voice:</span>
              <span className="font-semibold text-neutral-900 dark:text-white truncate">
                {selectedPack ? selectedPack.packName : 'None selected'}
              </span>
              {selectedPack?.isLoaded ? (
                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900">
                  Ready
                </span>
              ) : (
                <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900">
                  Not Loaded
                </span>
              )}
            </div>
            <span className="text-[11px] text-neutral-400 hidden sm:inline">
              Click any voice card above to switch
            </span>
          </div>

          {/* Text Input Area */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="tts-text-input" className="font-semibold text-neutral-700 dark:text-neutral-300">
                Text to Speech Input
              </label>
              <span className="text-neutral-400 font-mono text-[11px]">
                {inputText.length} chars
              </span>
            </div>

            <textarea
              id="tts-text-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={3}
              placeholder="Enter text to speak..."
              className="w-full p-3.5 rounded-2xl bg-neutral-50 dark:bg-[#1a1c29] border border-black/10 dark:border-white/10 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent,#55d2f6)]/40 focus:border-[var(--theme-accent,#55d2f6)] transition-all resize-y"
            />

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] font-medium text-neutral-400 mr-1">Presets:</span>
              {PRESET_TEST_TEXTS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => setInputText(sample.text)}
                  className="px-2.5 py-1 rounded-xl text-xs bg-neutral-100 hover:bg-neutral-200 dark:bg-white/[0.05] dark:hover:bg-white/[0.1] text-neutral-700 dark:text-neutral-300 border border-black/5 dark:border-white/5 transition-all cursor-pointer active:scale-95"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* Current word cue if speaking */}
          {isSpeaking && currentWord && (
            <div className="p-2.5 rounded-2xl bg-[var(--theme-accent-soft,rgba(85,210,246,0.1))] border border-[var(--theme-accent,#55d2f6)]/30 flex items-center gap-2 text-xs">
              <Activity className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)] animate-pulse" />
              <span className="text-neutral-500">Speaking word:</span>
              <strong className="text-[var(--theme-accent,#0f9bc7)] dark:text-[var(--theme-accent,#8ce0fa)] font-semibold">
                "{currentWord}"
              </strong>
            </div>
          )}

          {/* Parameter Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
            {/* Pitch */}
            <div className="p-3 rounded-2xl bg-neutral-50/60 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">Pitch</span>
                <span className="font-mono text-neutral-500">{pitch.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={pitch}
                onChange={(e) => setPitch(parseFloat(e.target.value))}
                className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                <span>0.5x</span>
                <span>1.25x (Hana)</span>
                <span>2.0x</span>
              </div>
            </div>

            {/* Rate */}
            <div className="p-3 rounded-2xl bg-neutral-50/60 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">Rate (Speed)</span>
                <span className="font-mono text-neutral-500">{rate.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                <span>0.5x</span>
                <span>1.05x (Hana)</span>
                <span>2.0x</span>
              </div>
            </div>

            {/* Volume */}
            <div className="p-3 rounded-2xl bg-neutral-50/60 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">Volume</span>
                <span className="font-mono text-neutral-500">{(volume * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-neutral-400 font-mono">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap pt-2">
            <button
              type="button"
              onClick={() => speakText(selectedPack?.voice)}
              disabled={!inputText.trim() || !selectedPack?.isLoaded}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold bg-[var(--theme-accent,#55d2f6)] text-neutral-950 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Speak Input Text</span>
            </button>

            {isSpeaking && (
              <button
                type="button"
                onClick={pausePlayback}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-medium bg-neutral-100 hover:bg-neutral-200 dark:bg-white/[0.08] dark:hover:bg-white/[0.12] text-neutral-800 dark:text-white transition-all cursor-pointer active:scale-95"
              >
                <Pause className="w-4 h-4" />
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={stopPlayback}
              disabled={!isSpeaking && !isPaused}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-medium bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-95"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Stop</span>
            </button>
          </div>
        </section>

        {/* ----------------------------------------------------
            Live Speech Event Log (Collapsible)
           ---------------------------------------------------- */}
        <section className="bg-white dark:bg-[#13151f] border border-black/[0.08] dark:border-white/[0.08] rounded-3xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[var(--theme-accent,#55d2f6)]" />
              <h3 className="text-xs sm:text-sm font-bold font-heading text-neutral-900 dark:text-white">
                Speech Engine Event Log
              </h3>
              <span className="text-[10px] font-mono text-neutral-400">({logs.length})</span>
            </div>

            <div className="flex items-center gap-2">
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsLogExpanded(!isLogExpanded)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                {isLogExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div
            className={`font-mono text-xs rounded-2xl bg-neutral-950 text-neutral-300 p-3 border border-white/10 overflow-y-auto space-y-1 transition-all ${
              isLogExpanded ? 'max-h-72' : 'max-h-24'
            }`}
          >
            {logs.length === 0 ? (
              <div className="text-neutral-600 italic">No events recorded.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-500 shrink-0">[{log.time}]</span>
                  <span
                    className={`shrink-0 uppercase text-[10px] px-1 rounded ${
                      log.type === 'start'
                        ? 'bg-blue-950 text-blue-400'
                        : log.type === 'end'
                        ? 'bg-emerald-950 text-emerald-400'
                        : log.type === 'error'
                        ? 'bg-red-950 text-red-400 font-bold'
                        : 'bg-neutral-900 text-neutral-400'
                    }`}
                  >
                    {log.type}
                  </span>
                  <span className="text-neutral-300 truncate">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default VoiceTesterPage;
