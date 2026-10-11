import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Message,
  Conversation,
  ModelSpec,
  ModelCacheInfo,
  DownloadProgress,
  TelemetryStats,
  UserSettings,
  ThemeDefinition,
  AccountUser,
  AttachedFile,
  IntegrationConfig,
  HardwareDevice,
} from './types';
import { DEFAULT_MODEL_ID, getModelById } from './lib/models';
import {
  loadStoredConversations,
  saveStoredConversations,
  loadActiveConversationId,
  saveActiveConversationId,
  loadUserSettings,
  saveUserSettings,
  getAllModelCacheStatuses,
  deleteModelFromCache,
  clearAllTransformersCaches,
  loadCustomOllamaUrl,
  loadStoredCustomThemes,
  saveStoredCustomThemes,
  loadActiveThemeId,
  saveActiveThemeId,
  loadBlockedUntil,
  incrementHarassmentCount,
  loadAccountSession,
  saveAccountSession,
  loadEquippedOutfitId,
  saveEquippedOutfitId,
  loadUnlockedOutfits,
  saveUnlockedOutfits,
  getOrCreateDeviceFingerprint,
  getBrowserDeviceLabel,
  isUserPremium,
  loadStoredIntegrations,
  saveStoredIntegrations,
  addOrUpdateIntegration,
  removeStoredIntegration,
  getSessionPassword,
  setSessionPassword,
  clearSessionPassword,
  isCodeAlreadyRedeemed,
  recordRedeemedCode,
} from './lib/storage';
import {
  streamPersonaResponse,
  stopCurrentGeneration,
  detectBestHardwareDevice,
  loadModelPipeline,
  resetActiveGenerator,
} from './lib/slmEngine';
import { extractDocumentText } from './lib/documentParser';
import { setActiveChatContext } from './tools';
import { soundManager, waitForPersonaVoice } from './lib/audio';
import { pingOllama } from './lib/ollama';
import {
  APP_INFO,
  AI_PROFILE,
  VOICE_CONFIG,
  OLLAMA_CONFIG,
  THEME_COLORS,
  UI_CONFIG,
  TOKEN_CONFIG,
  PRESET_THEMES,
  DEFAULT_OUTFIT_ID,
  getThemeById,
  getOutfitById,
  resolveSecretOutfitsByRedeemCode,
  CHAT_ERROR_CONFIG,
} from './constants';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { ThemeSidebar } from './components/ThemeSidebar';
import { CustomThemeModal } from './components/CustomThemeModal';
import { TelemetryBar } from './components/TelemetryBar';
import { ChatInput } from './components/ChatInput';
import { OllamaStatusMap } from './components/ModelSelector';
import { MessageList } from './components/MessageList';
import { SettingsModal } from './components/SettingsModal';
import { TwitterProfileModal } from './components/TwitterProfileModal';
import { VRMCanvas } from './components/VRMCanvas';
import { VRMSubtitles } from './components/VRMSubtitles';
import { SplashScreen } from './components/SplashScreen';
import { LandingPage } from './components/LandingPage';
import { AddIntegrationModal } from './components/AddIntegrationModal';
import { DocsPage } from './components/DocsPage';
import { ActDirectorPage } from './components/ActDirectorPage';
import { HumanizerPage } from './components/HumanizerPage';
import { VoiceTesterPage } from './components/VoiceTesterPage';
import { MMDStudioPage } from './components/MMDStudioPage';
import { InterviewPage } from './components/InterviewPage';
import { CallerPage } from './components/CallerPage';
import { TorGamePage } from './components/TorGamePage';
import { PremiumModal } from './components/PremiumModal';
import { IntegrationLibraryItem } from './constants';
import { dispatchChatToWebhooks } from './lib/integrations';
import { discordBotRunner } from './lib/discordRunner';
import { streamChatRunner } from './lib/streamChatRunner';
import { lipSyncManager } from './lib/lipSync';
import { preloadVRMAssetsBehindTheScenes } from './lib/vrmCache';
import { AvatarEmotion, detectEmotionForResponse } from './lib/emotionDetector';
import { AlertCircle, ShieldAlert, Clock, Home, X } from 'lucide-react';

export default function App() {
  // ----------------------------------------------------
  // SPA Routing: '/' -> Landing Page, '/chat' -> Main Chat App
  // ----------------------------------------------------
  const [currentRoute, setCurrentRoute] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path.startsWith('/app')) {
        window.history.replaceState(null, '', '/chat');
        return '/chat';
      }
      if (
        path.startsWith('/humanizer') ||
        path.startsWith('/ai-detector') ||
        path.startsWith('/ai-detect') ||
        path.startsWith('/humanize')
      ) {
        window.history.replaceState(null, '', '/humanizer');
        return '/humanizer';
      }
      if (path.startsWith('/docs')) {
        return path;
      }
      if (path.startsWith('/act')) {
        return '/act';
      }
      if (path.startsWith('/mmd')) {
        return '/mmd';
      }
      if (path.startsWith('/voice')) {
        return '/voice';
      }
      if (path.startsWith('/interview')) {
        return window.location.pathname + window.location.search;
      }
      if (path.startsWith('/caller')) {
        return '/caller';
      }
      if (path.startsWith('/tor')) {
        return '/tor';
      }
      return path.startsWith('/chat') ? '/chat' : '/';
    }
    return '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.startsWith('/app')) {
        window.history.replaceState(null, '', '/chat');
        setCurrentRoute('/chat');
        return;
      }
      if (
        path.startsWith('/humanizer') ||
        path.startsWith('/ai-detector') ||
        path.startsWith('/ai-detect') ||
        path.startsWith('/humanize')
      ) {
        window.history.replaceState(null, '', '/humanizer');
        setCurrentRoute('/humanizer');
        return;
      }
      if (path.startsWith('/docs')) {
        setCurrentRoute(path);
        return;
      }
      if (path.startsWith('/act')) {
        setCurrentRoute('/act');
        return;
      }
      if (path.startsWith('/tor')) {
        setCurrentRoute('/tor');
        return;
      }
      if (path.startsWith('/mmd')) {
        setCurrentRoute('/mmd');
        return;
      }
      if (path.startsWith('/voice')) {
        setCurrentRoute('/voice');
        return;
      }
      if (path.startsWith('/interview')) {
        setCurrentRoute(window.location.pathname + window.location.search);
        return;
      }
      if (path.startsWith('/caller')) {
        setCurrentRoute('/caller');
        return;
      }
      setCurrentRoute(path.startsWith('/chat') ? '/chat' : '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync /interview route query params if URL search changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const interval = setInterval(() => {
      if (window.location.pathname.startsWith('/interview')) {
        const full = window.location.pathname + window.location.search;
        if (currentRoute !== full) {
          setCurrentRoute(full);
        }
      }
    }, 200);
    return () => clearInterval(interval);
  }, [currentRoute]);

  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined') {
      let normalized = '/';
      if (path.startsWith('/chat') || path.startsWith('/app')) {
        normalized = '/chat';
      } else if (
        path.startsWith('/humanizer') ||
        path.startsWith('/ai-detector') ||
        path.startsWith('/ai-detect') ||
        path.startsWith('/humanize')
      ) {
        normalized = '/humanizer';
      } else if (path.startsWith('/docs')) {
        normalized = path;
      } else if (path.startsWith('/act')) {
        normalized = '/act';
      } else if (path.startsWith('/tor')) {
        normalized = '/tor';
      } else if (path.startsWith('/mmd')) {
        normalized = '/mmd';
      } else if (path.startsWith('/voice')) {
        normalized = '/voice';
      } else if (path.startsWith('/interview')) {
        normalized = path;
      } else if (path.startsWith('/caller')) {
        normalized = '/caller';
      }
      window.history.pushState(null, '', normalized);
      setCurrentRoute(normalized);
      window.scrollTo(0, 0);
    }
  };
  // ----------------------------------------------------
  // State Initialization
  // ----------------------------------------------------
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<ModelSpec>(() => getModelById(DEFAULT_MODEL_ID));
  const [cacheStatuses, setCacheStatuses] = useState<Record<string, ModelCacheInfo>>({});
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  // Attached files state (Images, documents, code, audio clips)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // Integrations state (Discord, Slack, n8n, Zapier)
  const [activeIntegrations, setActiveIntegrations] = useState<IntegrationConfig[]>(() =>
    loadStoredIntegrations()
  );
  const [isAddIntegrationModalOpen, setIsAddIntegrationModalOpen] = useState(false);

  // Microphone status alert (when access is denied or hardware not found)
  const [micAlert, setMicAlert] = useState<string | null>(null);

  const handleAddFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newItems: AttachedFile[] = fileArray.map((file) => {
      const isImg = file.type.startsWith('image/');
      const item: AttachedFile = {
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        isImage: isImg,
        previewUrl: isImg ? URL.createObjectURL(file) : undefined,
      };

      if (!isImg) {
        extractDocumentText(file)
          .then((text) => {
            if (text) {
              setAttachedFiles((prev) =>
                prev.map((f) => (f.id === item.id ? { ...f, textContent: text } : f))
              );
            }
          })
          .catch(() => {});
      }

      return item;
    });
    setAttachedFiles((prev) => [...prev, ...newItems]);
  };

  const handleRemoveFile = (id: string) => {
    setAttachedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleClearAllFiles = () => {
    attachedFiles.forEach((f) => {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    });
    setAttachedFiles([]);
  };

  const handleAddIntegration = (libraryItem: IntegrationLibraryItem) => {
    const newIntegration: IntegrationConfig = {
      id: `int_${libraryItem.platform}_${Date.now().toString(36)}`,
      platform: libraryItem.platform,
      name: libraryItem.name,
      enabled: true,
      status: 'disconnected',
    };
    const updated = addOrUpdateIntegration(newIntegration);
    setActiveIntegrations(updated);
  };

  const handleUpdateIntegration = (updated: IntegrationConfig) => {
    if (updated.platform === 'discord' && updated.botToken) {
      try {
        localStorage.setItem('discord_bot_token', updated.botToken.trim());
      } catch {}
    }
    const list = addOrUpdateIntegration(updated);
    setActiveIntegrations(list);
  };

  const handleRemoveIntegration = (id: string) => {
    const list = removeStoredIntegration(id);
    setActiveIntegrations(list);
  };
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const loaded = loadUserSettings();
    return { ...loaded, soundEffects: loaded.soundEffects !== false };
  });

  // ----------------------------------------------------
  // Multi-Theme System State (Presets + Custom Themes + Browser Storage)
  // ----------------------------------------------------
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(() => loadStoredCustomThemes());
  const [activeThemeId, setActiveThemeId] = useState<string>(() => loadActiveThemeId());
  const [isThemeSidebarOpen, setIsThemeSidebarOpen] = useState(false);
  const [isCustomThemeModalOpen, setIsCustomThemeModalOpen] = useState(false);
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);

  // Active theme resolved from presets and stored custom themes
  const activeTheme = useMemo(
    () => getThemeById(activeThemeId, customThemes),
    [activeThemeId, customThemes]
  );

  const theme: 'light' | 'dark' = activeTheme.isDark ? 'dark' : 'light';

  // Apply active theme colors and dark class to document root
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    if (activeTheme.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Set CSS theme variables
    root.style.setProperty('--theme-bg', activeTheme.colors.bg);
    root.style.setProperty('--theme-surface', activeTheme.colors.surface);
    root.style.setProperty('--theme-card', activeTheme.colors.card);
    root.style.setProperty('--theme-border', activeTheme.colors.border);
    root.style.setProperty('--theme-text', activeTheme.colors.text);
    root.style.setProperty('--theme-text-muted', activeTheme.colors.textMuted);
    root.style.setProperty('--theme-accent', activeTheme.colors.accent);
    root.style.setProperty('--theme-accent-hover', activeTheme.colors.accentHover);
    root.style.setProperty('--theme-accent-soft', activeTheme.colors.accentSoft);
    root.style.setProperty('--theme-user-bubble', activeTheme.colors.userBubble);
    root.style.setProperty('--theme-user-bubble-text', activeTheme.colors.userBubbleText);
    root.style.setProperty('--theme-assistant-bubble', activeTheme.colors.assistantBubble);
    root.style.setProperty('--theme-assistant-bubble-text', activeTheme.colors.assistantBubbleText);
    root.style.setProperty(
      '--theme-header-bg',
      activeTheme.colors.headerBg || (activeTheme.isDark ? 'rgba(19, 21, 31, 0.88)' : 'rgba(255, 255, 255, 0.88)')
    );

    // Sync all Tailwind sky-* color variables directly with the active theme
    root.style.setProperty('--color-sky-50', activeTheme.colors.accentSoft);
    root.style.setProperty('--color-sky-100', activeTheme.colors.accentSoft);
    root.style.setProperty('--color-sky-200', activeTheme.colors.accentSoft);
    root.style.setProperty('--color-sky-300', activeTheme.colors.accent);
    root.style.setProperty('--color-sky-400', activeTheme.colors.accent);
    root.style.setProperty('--color-sky-500', activeTheme.colors.accentHover);
    root.style.setProperty('--color-sky-600', activeTheme.colors.accentHover);
    root.style.setProperty('--color-sky-700', activeTheme.colors.accentHover);
    root.style.setProperty('--color-sky-800', activeTheme.colors.accentHover);
    root.style.setProperty('--color-sky-900', activeTheme.colors.text);
    root.style.setProperty('--color-sky-950', activeTheme.colors.card);

    saveActiveThemeId(activeTheme.id);
  }, [activeTheme]);

  const handleSelectTheme = (themeId: string) => {
    setActiveThemeId(themeId);
  };

  const handleSaveCustomTheme = (newTheme: ThemeDefinition) => {
    setCustomThemes((prev) => {
      const filtered = prev.filter((t) => t.id !== newTheme.id);
      const updated = [newTheme, ...filtered];
      saveStoredCustomThemes(updated);
      return updated;
    });
    setActiveThemeId(newTheme.id);
  };

  const handleDeleteCustomTheme = (themeId: string) => {
    setCustomThemes((prev) => {
      const updated = prev.filter((t) => t.id !== themeId);
      saveStoredCustomThemes(updated);
      return updated;
    });
    if (activeThemeId === themeId) {
      setActiveThemeId('classic-light');
    }
  };

  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  // 3D VRM Mode Toggle State
  const [is3DMode, setIs3DMode] = useState(false);

  // Splash Screen State
  const [isSplashActive, setIsSplashActive] = useState(true);
  const [isVoiceLoaded, setIsVoiceLoaded] = useState(false);
  const [isSplashTimeout, setIsSplashTimeout] = useState(false);

  // 3D Mode Voice Subtitle State
  const [subtitleState, setSubtitleState] = useState<{
    isActive: boolean;
    text: string;
    charIndex: number;
    currentWord: string;
  }>({
    isActive: false,
    text: '',
    charIndex: 0,
    currentWord: '',
  });

  // Pain sound facial expression mood state for 3D model
  const [isPainSoundActive, setIsPainSoundActive] = useState(false);

  // 3D Avatar Facial Expression Emotion state (happy, smug, sad, angry, surprised, neutral)
  const [avatarEmotion, setAvatarEmotion] = useState<AvatarEmotion>('neutral');

  // ----------------------------------------------------
  // NeonDB Account Session & Wardrobe Outfit State
  // ----------------------------------------------------
  const [accountUser, setAccountUser] = useState<AccountUser | null>(() => loadAccountSession());
  const [equippedOutfitId, setEquippedOutfitId] = useState<string>(() => loadEquippedOutfitId());
  const [unlockedOutfitIds, setUnlockedOutfitIds] = useState<string[]>(() => {
    const localUnlocked = loadUnlockedOutfits();
    const sessionUser = loadAccountSession();
    const userUnlocked = Array.isArray(sessionUser?.unlocked_outfits) ? sessionUser.unlocked_outfits : [];
    return Array.from(new Set([...localUnlocked, ...userUnlocked]));
  });
  const [externalAuthModalRequest, setExternalAuthModalRequest] = useState<number>(0);
  const [lastUserMessageAt, setLastUserMessageAt] = useState<number>(0);

  const isPremium = useMemo(() => isUserPremium(accountUser), [accountUser]);

  const activeOutfit = useMemo(() => {
    const candidate = getOutfitById(equippedOutfitId);
    if (candidate.isPremium && !isPremium) {
      return getOutfitById(DEFAULT_OUTFIT_ID);
    }
    if (
      candidate.isSecret &&
      !unlockedOutfitIds.includes(candidate.id) &&
      !unlockedOutfitIds.includes(candidate.fileName)
    ) {
      return getOutfitById(DEFAULT_OUTFIT_ID);
    }
    return candidate;
  }, [equippedOutfitId, isPremium, unlockedOutfitIds]);

  useEffect(() => {
    saveAccountSession(accountUser);
    if (accountUser && Array.isArray(accountUser.unlocked_outfits) && accountUser.unlocked_outfits.length > 0) {
      setUnlockedOutfitIds((prev) => {
        const merged = Array.from(new Set([...prev, ...(accountUser.unlocked_outfits || [])]));
        return merged.length === prev.length ? prev : merged;
      });
    }
  }, [accountUser]);

  useEffect(() => {
    saveEquippedOutfitId(equippedOutfitId);
  }, [equippedOutfitId]);

  useEffect(() => {
    saveUnlockedOutfits(unlockedOutfitIds);
  }, [unlockedOutfitIds]);

  const handleSelectOutfit = useCallback(
    (outfitId: string) => {
      const outfit = getOutfitById(outfitId);
      if (outfit.isPremium && !isUserPremium(accountUser)) {
        setIsSidebarOpen(true);
        setExternalAuthModalRequest((n) => n + 1);
        return;
      }
      if (
        outfit.isSecret &&
        !unlockedOutfitIds.includes(outfit.id) &&
        !unlockedOutfitIds.includes(outfit.fileName)
      ) {
        setIsSidebarOpen(true);
        setExternalAuthModalRequest((n) => n + 1);
        return;
      }
      setEquippedOutfitId(outfit.id);
      if (accountUser) {
        fetch('/api/account/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: accountUser.id,
            equippedOutfitId: outfit.id,
            unlockedOutfits: unlockedOutfitIds,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data?.user) setAccountUser(data.user);
          })
          .catch(() => {});
      }
    },
    [accountUser, unlockedOutfitIds]
  );

  const handleSignUp = useCallback(
    async (email: string, password: string) => {
      const resp = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          device: getBrowserDeviceLabel(),
          fingerprint: getOrCreateDeviceFingerprint(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Failed to create account.');
      }
      const user = data.user as AccountUser;
      setAccountUser(user);
      setSessionPassword(password);
      // Sync existing local conversations, custom themes & unlocked outfits up to NeonDB for this new user
      fetch('/api/account/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          conversations,
          customThemes,
          unlockedOutfits: unlockedOutfitIds,
          password,
        }),
      }).catch(() => {});
    },
    [conversations, customThemes, unlockedOutfitIds]
  );

  const handleSignIn = useCallback(
    async (email: string, password: string) => {
      const resp = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          device: getBrowserDeviceLabel(),
          fingerprint: getOrCreateDeviceFingerprint(),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Failed to sign in.');
      }
      const user = data.user as AccountUser;
      setSessionPassword(password);
      const serverUnlocked = Array.isArray(user.unlocked_outfits)
        ? user.unlocked_outfits
        : Array.isArray(data.unlockedOutfits)
        ? data.unlockedOutfits
        : [];
      if (serverUnlocked.length > 0) {
        setUnlockedOutfitIds((prev) => Array.from(new Set([...prev, ...serverUnlocked])));
      }
      setAccountUser(user);
      if (user.equipped_outfit_id) {
        setEquippedOutfitId(user.equipped_outfit_id);
      }
      if (user.active_theme_id) {
        setActiveThemeId(user.active_theme_id);
      }
      if (Array.isArray(data.conversations) && data.conversations.length > 0) {
        setConversations(data.conversations);
        saveStoredConversations(data.conversations);
        setActiveConvId(data.conversations[0].id);
      } else if (conversations.length > 0) {
        fetch('/api/account/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            conversations,
            customThemes,
            unlockedOutfits: unlockedOutfitIds,
            password,
          }),
        }).catch(() => {});
      }
      if (Array.isArray(data.customThemes) && data.customThemes.length > 0) {
        setCustomThemes(data.customThemes);
        saveStoredCustomThemes(data.customThemes);
      }
    },
    [conversations, customThemes, unlockedOutfitIds]
  );

  const handleSignOut = useCallback(() => {
    clearSessionPassword();
    setAccountUser(null);
    setEquippedOutfitId(DEFAULT_OUTFIT_ID);
    setUnlockedOutfitIds([]);
    saveUnlockedOutfits([]);
  }, []);

  const handleUpdateProfile = useCallback(
    async (updates: { username: string; displayName: string; avatarUrl: string }) => {
      if (!accountUser) return;
      const resp = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: accountUser.id,
          username: updates.username,
          displayName: updates.displayName,
          avatarUrl: updates.avatarUrl,
          unlockedOutfits: unlockedOutfitIds,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Failed to update profile.');
      }
      if (data.user) {
        setAccountUser(data.user);
      }
    },
    [accountUser, unlockedOutfitIds]
  );

  const handleRedeemCode = useCallback(
    async (code: string) => {
      if (!accountUser) return;
      const clean = code.trim().toUpperCase();
      if (isCodeAlreadyRedeemed(clean)) {
        throw new Error('You have already applied this redeem code.');
      }
      const resp = await fetch('/api/account/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: accountUser.id,
          code: clean,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        throw new Error(data.error || 'Failed to redeem code.');
      }
      recordRedeemedCode(clean);
      const matchedSecret = resolveSecretOutfitsByRedeemCode(clean).map((o) => o.id);
      if (data.user) {
        const userUnlocked = Array.isArray(data.user.unlocked_outfits)
          ? data.user.unlocked_outfits
          : [];
        const combinedUnlocked = Array.from(
          new Set([...unlockedOutfitIds, ...userUnlocked, ...matchedSecret])
        );
        setUnlockedOutfitIds(combinedUnlocked);
        setAccountUser({
          ...data.user,
          unlocked_outfits: combinedUnlocked,
        });
      } else if (matchedSecret.length > 0) {
        setUnlockedOutfitIds((prev) => Array.from(new Set([...prev, ...matchedSecret])));
      }
    },
    [accountUser, unlockedOutfitIds]
  );

  // Sync conversations, custom themes & unlocked outfits to NeonDB when logged in
  useEffect(() => {
    if (!accountUser) return;
    const sessionPwd = getSessionPassword();
    const syncTimer = setTimeout(() => {
      fetch('/api/account/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: accountUser.id,
          conversations,
          customThemes,
          unlockedOutfits: unlockedOutfitIds,
          password: sessionPwd || undefined,
        }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(syncTimer);
  }, [accountUser, conversations, customThemes, unlockedOutfitIds]);

  // Global Mouse Click Echoing Shockwave Ripples (0.6s total duration)
  const [clickRipples, setClickRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);

  useEffect(() => {
    const handleGlobalPointerDown = (e: PointerEvent) => {
      const id = Date.now() + Math.random();
      setClickRipples((prev) => [...prev.slice(-14), { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => {
        setClickRipples((prev) => prev.filter((r) => r.id !== id));
      }, 600);
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown);
    return () => window.removeEventListener('pointerdown', handleGlobalPointerDown);
  }, []);

  // Harassment Temporary Block State (persisted in localStorage across refreshes)
  const [blockedUntil, setBlockedUntil] = useState<number>(() => loadBlockedUntil());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const storedUntil = loadBlockedUntil();
    if (storedUntil !== blockedUntil) {
      setBlockedUntil(storedUntil);
    }
  }, [currentRoute]);

  useEffect(() => {
    if (blockedUntil <= Date.now()) return;
    setNowMs(Date.now());
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNowMs(currentNow);
      if (currentNow >= blockedUntil) {
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [blockedUntil]);

  const handleFallStart = useCallback(() => {
    const { blockedUntil: newBlockedUntil } = incrementHarassmentCount();
    if (newBlockedUntil && newBlockedUntil > Date.now()) {
      stopCurrentGeneration();
      if (pausedSpeechResumeTimeoutRef.current) {
        clearTimeout(pausedSpeechResumeTimeoutRef.current);
      }
      window.speechSynthesis?.cancel();
      lipSyncManager.endSpeech();
      setCurrentlySpeakingMsgId(null);
      setIsPainSoundActive(false);
      isPainSoundActiveRef.current = false;
      setNowMs(Date.now());
      setBlockedUntil(newBlockedUntil);
    }
  }, []);

  useEffect(() => {
    // Preload voice engine
    waitForPersonaVoice(VOICE_CONFIG.preloadTimeoutMs)
      .then(() => setIsVoiceLoaded(true))
      .catch(() => setIsVoiceLoaded(true));

    // During the loading phase of splash screen, also load up the 3D model behind the scenes according to its usual loading scheme
    preloadVRMAssetsBehindTheScenes();

    // Fallback: If voice engine takes longer than timeout, proceed through splash screen
    const timer = setTimeout(() => {
      setIsSplashTimeout(true);
    }, UI_CONFIG.splashFallbackTimeoutMs);

    return () => clearTimeout(timer);
  }, []);

  const isSplashReady = isVoiceLoaded || isSplashTimeout;

  // Modals & Panels
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isTelemetryExpanded, setIsTelemetryExpanded] = useState(false);
  const [currentlySpeakingMsgId, setCurrentlySpeakingMsgId] = useState<string | null>(null);

  // In-Conversation Search
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Real-time Telemetry
  const [telemetry, setTelemetry] = useState<TelemetryStats>({
    activeModelName: activeModel.name,
    modelId: activeModel.id,
    device: 'wasm',
    tokensPerSec: 0,
    timeToFirstTokenMs: 0,
    totalLatencyMs: 0,
    tokenCount: 0,
    statusText: 'Mind ready',
    isGenerating: false,
    isModelLoaded: false,
  });

  const hasPlayedReceiveAudio = useRef(false);

  // Effective sound enabled (in 3D view, she will always have sound enabled)
  const isSoundActive = userSettings.soundEffects || is3DMode;

  // Track active speech for pausing & resuming during model clicks
  const currentSpeechInfoRef = useRef<{
    msgId: string;
    text: string;
    charIndex: number;
  } | null>(null);

  const isPainSoundActiveRef = useRef(false);
  const pausedSpeechResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice synthesis with priority order queue sourced from VOICE_CONFIG
  const speakAssistantMessage = useCallback(
    async (msgId: string, text: string, isResuming = false) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!isSoundActive) return;

      // When pain sound is playing, defer assistant synthesis
      if (isPainSoundActiveRef.current) return;

      if (!isResuming) {
        window.speechSynthesis.cancel();
      }

      // Wait until voice synthesis engine is fully ready/loaded so the female voice queue is activated
      const voice = await waitForPersonaVoice(VOICE_CONFIG.waitVoiceTimeoutMs);

      // Skip male voice if no female voice is loaded/ready
      if (!voice) {
        console.warn('No female voice available from queue, skipping voice synthesis.');
        return;
      }

      // Check if user disabled sound while waiting
      if (!isSoundActive || isPainSoundActiveRef.current) return;

      setCurrentlySpeakingMsgId(msgId);
      currentSpeechInfoRef.current = { msgId, text, charIndex: 0 };
      lipSyncManager.startSpeech(text);
      setSubtitleState({
        isActive: true,
        text,
        charIndex: 0,
        currentWord: '',
      });

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = VOICE_CONFIG.pitch;
      utterance.rate = VOICE_CONFIG.rate;
      utterance.voice = voice;

      utterance.onboundary = (event) => {
        const charIndex = event.charIndex || 0;
        let charLength = event.charLength || 0;
        if (!charLength) {
          const match = text.slice(charIndex).match(/^\S+/);
          charLength = match ? match[0].length : 5;
        }
        const word = text.slice(charIndex, charIndex + charLength);
        lipSyncManager.onBoundary(word);

        if (currentSpeechInfoRef.current) {
          currentSpeechInfoRef.current.charIndex = charIndex;
        }

        setSubtitleState((prev) => ({
          ...prev,
          isActive: true,
          text,
          charIndex,
          currentWord: word,
        }));
      };

      utterance.onend = () => {
        if (currentSpeechInfoRef.current?.msgId === msgId) {
          currentSpeechInfoRef.current = null;
        }
        setCurrentlySpeakingMsgId(null);
        lipSyncManager.endSpeech();
        setSubtitleState((prev) => ({
          ...prev,
          isActive: false,
          charIndex: text.length,
        }));
      };
      utterance.onerror = () => {
        if (currentSpeechInfoRef.current?.msgId === msgId) {
          currentSpeechInfoRef.current = null;
        }
        setCurrentlySpeakingMsgId(null);
        lipSyncManager.endSpeech();
        setSubtitleState((prev) => ({
          ...prev,
          isActive: false,
        }));
      };

      window.speechSynthesis.speak(utterance);
    },
    [isSoundActive]
  );

  // Play pain sounds via current voice bank when 3D model is clicked,
  // pausing the whole voice synthesis until the pain sound is complete.
  const handleModelClick = useCallback(
    async (hitRegion: 'head' | 'chest' | 'stomach' | 'skirt' | 'legs') => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!isSoundActive) return;

      // Guard against rapid duplicate triggers
      if (isPainSoundActiveRef.current) return;
      isPainSoundActiveRef.current = true;
      setIsPainSoundActive(true);

      if (pausedSpeechResumeTimeoutRef.current) {
        clearTimeout(pausedSpeechResumeTimeoutRef.current);
      }

      // Check if an assistant message is currently speaking and record remaining portion to resume after pain sound
      let pausedSpeech: { msgId: string; remainingText: string } | null = null;
      if (currentSpeechInfoRef.current && currentlySpeakingMsgId) {
        const { msgId, text, charIndex } = currentSpeechInfoRef.current;
        const remaining = text.slice(charIndex).trim();
        if (remaining.length > 5) {
          pausedSpeech = { msgId, remainingText: remaining };
        }
      }

      // Pause/cancel ongoing voice synthesis to clear audio channel for the pain sound
      window.speechSynthesis.cancel();
      lipSyncManager.endSpeech();

      // Retrieve current voice from persona voice bank
      const voice = await waitForPersonaVoice(VOICE_CONFIG.waitVoiceTimeoutMs);
      if (!voice) {
        isPainSoundActiveRef.current = false;
        setIsPainSoundActive(false);
        return;
      }

      // Special expressive pain words and phrases
      const PAIN_SOUNDS_BY_REGION: Record<string, string[]> = {
        head: ['Ouch! My head...', 'Ow! Watch out!', 'Owie! That hurts!', 'My head... stop!', 'Ouch', 'Ah'],
        chest: ["Hey! That hurts!", "Eek! Don't do that!", 'Ouch! Cut it out!', 'Stop being a pervert!', 'Please, no!'],
        stomach: ['Ugh... oof!', 'Ouchie!', 'Ngh... stop!'],
        skirt: ['No!', 'What are you doing?!', 'Ouch! Hey!'],
        legs: ['Ow, ow, ow!', 'Ouch! That stings!', 'Ow!'],
      };

      const regionList = PAIN_SOUNDS_BY_REGION[hitRegion] || ['Ouch!', 'Kyaa!', 'Owie!', 'Ow!'];
      const painPhrase = regionList[Math.floor(Math.random() * regionList.length)];

      lipSyncManager.startSpeech(painPhrase);
      setSubtitleState({
        isActive: userSettings.visualSubtitles !== false,
        text: painPhrase,
        charIndex: 0,
        currentWord: painPhrase,
      });

      const utterance = new SpeechSynthesisUtterance(painPhrase);
      utterance.voice = voice;
      utterance.pitch = Math.min(2.0, VOICE_CONFIG.pitch * 1.25);
      utterance.rate = Math.min(2.0, VOICE_CONFIG.rate * 1.2);

      utterance.onboundary = (e) => {
        const charIndex = e.charIndex || 0;
        const word = painPhrase.slice(charIndex);
        lipSyncManager.onBoundary(word);
      };

      const finishPainSound = () => {
        isPainSoundActiveRef.current = false;
        setIsPainSoundActive(false);
        lipSyncManager.endSpeech();

        // If there was an assistant message interrupted, resume speaking the remaining text
        if (pausedSpeech && isSoundActive) {
          pausedSpeechResumeTimeoutRef.current = setTimeout(() => {
            speakAssistantMessage(pausedSpeech.msgId, pausedSpeech.remainingText, true);
          }, 350);
        } else {
          setSubtitleState((prev) => ({ ...prev, isActive: false }));
        }
      };

      utterance.onend = finishPainSound;
      utterance.onerror = finishPainSound;

      window.speechSynthesis.speak(utterance);
    },
    [isSoundActive, currentlySpeakingMsgId, userSettings.visualSubtitles, speakAssistantMessage]
  );

  // Streaming speech synthesis state for real-time 3D voice reactions
  const streamSpeechStateRef = useRef<{
    msgId: string;
    queuedCharIndex: number;
    activeUtteranceCount: number;
    isStreamComplete: boolean;
    fullText: string;
    isProcessing: boolean;
  } | null>(null);

  const processStreamingSpeechQueue = useCallback(async () => {
    const state = streamSpeechStateRef.current;
    if (!state || state.isProcessing) return;
    if (!isSoundActive || isPainSoundActiveRef.current) return;

    state.isProcessing = true;

    try {
      while (true) {
        if (!streamSpeechStateRef.current || isPainSoundActiveRef.current || !isSoundActive) {
          break;
        }

        const unqueued = state.fullText.slice(state.queuedCharIndex);
        if (!unqueued || unqueued.trim().length === 0) {
          break;
        }

        let chunkToSpeak = '';
        let advanceLen = 0;

        if (state.isStreamComplete) {
          // Stream is finished: consume all remaining text
          const trimmed = unqueued.trim();
          if (trimmed.length > 0) {
            chunkToSpeak = trimmed;
            advanceLen = unqueued.length;
          }
        } else {
          // Sentence boundaries: . ! ? or newline
          const sentenceMatch = unqueued.match(/^([\s\S]*?[.!?\n]+)(\s+|$)/);
          if (sentenceMatch) {
            chunkToSpeak = sentenceMatch[1].trim();
            advanceLen = sentenceMatch[0].length;
          } else if (unqueued.length > 35) {
            // Clause boundaries for longer clauses: , ; : or em-dash
            const clauseMatch = unqueued.match(/^([\s\S]*?[,;:\u2014]+)(\s+|$)/);
            if (clauseMatch) {
              chunkToSpeak = clauseMatch[1].trim();
              advanceLen = clauseMatch[0].length;
            } else if (unqueued.length > 55) {
              // Whitespace boundary if no punctuation is found in 55 chars
              const wordMatch = unqueued.match(/^([\s\S]*?\s+)/);
              if (wordMatch) {
                chunkToSpeak = wordMatch[1].trim();
                advanceLen = wordMatch[0].length;
              }
            }
          }
        }

        if (!chunkToSpeak || advanceLen === 0) {
          break;
        }

        state.queuedCharIndex += advanceLen;

        const voice = await waitForPersonaVoice(VOICE_CONFIG.waitVoiceTimeoutMs);
        if (!voice || !isSoundActive || isPainSoundActiveRef.current || !streamSpeechStateRef.current) {
          break;
        }

        const utterance = new SpeechSynthesisUtterance(chunkToSpeak);
        utterance.pitch = VOICE_CONFIG.pitch;
        utterance.rate = VOICE_CONFIG.rate;
        utterance.voice = voice;

        state.activeUtteranceCount++;

        utterance.onstart = () => {
          setCurrentlySpeakingMsgId(state.msgId);
          lipSyncManager.startSpeech(chunkToSpeak);
          setSubtitleState({
            isActive: userSettings.visualSubtitles !== false,
            text: chunkToSpeak,
            charIndex: 0,
            currentWord: chunkToSpeak.split(/\s+/)[0] || '',
          });
        };

        utterance.onboundary = (event) => {
          const charIndex = event.charIndex || 0;
          let charLength = event.charLength || 0;
          if (!charLength) {
            const m = chunkToSpeak.slice(charIndex).match(/^\S+/);
            charLength = m ? m[0].length : 5;
          }
          const word = chunkToSpeak.slice(charIndex, charIndex + charLength);
          lipSyncManager.onBoundary(word);

          if (currentSpeechInfoRef.current) {
            currentSpeechInfoRef.current.charIndex = state.queuedCharIndex;
          }

          setSubtitleState((prev) => ({
            ...prev,
            isActive: userSettings.visualSubtitles !== false,
            text: chunkToSpeak,
            charIndex,
            currentWord: word,
          }));
        };

        const handleChunkEnd = () => {
          if (!streamSpeechStateRef.current) return;
          const curState = streamSpeechStateRef.current;
          curState.activeUtteranceCount = Math.max(0, curState.activeUtteranceCount - 1);

          if (
            curState.activeUtteranceCount === 0 &&
            curState.isStreamComplete &&
            curState.queuedCharIndex >= curState.fullText.length
          ) {
            setCurrentlySpeakingMsgId(null);
            lipSyncManager.endSpeech();
            currentSpeechInfoRef.current = null;
            setSubtitleState((prev) => ({
              ...prev,
              isActive: false,
              charIndex: prev.text.length,
            }));
            streamSpeechStateRef.current = null;
          }
        };

        utterance.onend = handleChunkEnd;
        utterance.onerror = handleChunkEnd;

        window.speechSynthesis.speak(utterance);
      }
    } finally {
      if (streamSpeechStateRef.current) {
        streamSpeechStateRef.current.isProcessing = false;
      }
    }
  }, [isSoundActive, userSettings.visualSubtitles]);

  // Queue streaming speech chunks as tokens arrive from the LLM
  const queueStreamingSpeechChunk = useCallback(
    (msgId: string, fullText: string, isFinal = false) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      if (!isSoundActive || isPainSoundActiveRef.current) return;

      if (!streamSpeechStateRef.current || streamSpeechStateRef.current.msgId !== msgId) {
        window.speechSynthesis.cancel();
        streamSpeechStateRef.current = {
          msgId,
          queuedCharIndex: 0,
          activeUtteranceCount: 0,
          isStreamComplete: false,
          fullText: '',
          isProcessing: false,
        };
      }

      const state = streamSpeechStateRef.current;
      state.fullText = fullText;
      if (isFinal) {
        state.isStreamComplete = true;
      }

      processStreamingSpeechQueue();
    },
    [isSoundActive, processStreamingSpeechQueue]
  );

  const handleToggleSpeak = (msgId: string, content: string) => {
    if (currentlySpeakingMsgId === msgId) {
      currentSpeechInfoRef.current = null;
      streamSpeechStateRef.current = null;
      if (pausedSpeechResumeTimeoutRef.current) clearTimeout(pausedSpeechResumeTimeoutRef.current);
      window.speechSynthesis?.cancel();
      setCurrentlySpeakingMsgId(null);
      lipSyncManager.endSpeech();
      setSubtitleState((prev) => ({ ...prev, isActive: false }));
    } else {
      speakAssistantMessage(msgId, content);
    }
  };

  // ----------------------------------------------------
  // Live Integration Runners (Discord, Twitch, YouTube Live)
  // ----------------------------------------------------
  const lastDiscordStatusRef = useRef<{ status: string; msg: string }>({ status: '', msg: '' });

  useEffect(() => {
    // 1. Discord Bot: trigger in the background automatically as soon as /chat or /caller is launched if token detected
    const isChatLaunched =
      currentRoute === '/chat' ||
      currentRoute.startsWith('/chat') ||
      currentRoute.startsWith('/app') ||
      currentRoute === '/caller' ||
      currentRoute.startsWith('/caller');

    let storedDiscordToken = typeof window !== 'undefined' ? (localStorage.getItem('discord_bot_token') || '').trim() : '';
    if (!storedDiscordToken && typeof window !== 'undefined') {
      try {
        const savedPlatforms =
          localStorage.getItem('hana_caller_platforms_v2') ||
          localStorage.getItem('hana_caller_platforms_v1') ||
          localStorage.getItem('hana_caller_omnichannel_backup');
        if (savedPlatforms) {
          const parsed = JSON.parse(savedPlatforms);
          if (parsed?.discord?.botToken) {
            storedDiscordToken = parsed.discord.botToken.trim();
          }
        }
      } catch {}
    }

    let discordInt = activeIntegrations.find((i) => i.platform === 'discord');
    if (!discordInt && storedDiscordToken) {
      discordInt = {
        id: 'discord-auto',
        platform: 'discord',
        name: 'Discord Bot',
        botToken: storedDiscordToken,
        enabled: true,
        status: 'disconnected',
      };
    } else if (discordInt && !discordInt.botToken && storedDiscordToken) {
      discordInt = { ...discordInt, botToken: storedDiscordToken };
    }

    const hasToken = Boolean(discordInt?.botToken && discordInt.botToken.trim().length > 0);

    if (isChatLaunched && discordInt && hasToken && discordInt.enabled !== false) {
      discordBotRunner.start(discordInt, (status, msg) => {
        if (
          lastDiscordStatusRef.current.status !== status ||
          lastDiscordStatusRef.current.msg !== msg
        ) {
          lastDiscordStatusRef.current = { status, msg };
          setActiveIntegrations((prev) =>
            prev.map((item) =>
              item.platform === 'discord'
                ? { ...item, status, statusMessage: msg }
                : item
            )
          );
        }
      });
    } else if (!hasToken) {
      discordBotRunner.stop();
    }

    // 2. Twitch Stream Chat Runner
    const twitchInt = activeIntegrations.find((i) => i.platform === 'twitch' && i.enabled);
    if (twitchInt && twitchInt.twitchChannel) {
      streamChatRunner.startTwitch(twitchInt, (status, msg) => {
        handleUpdateIntegration({ ...twitchInt, status, statusMessage: msg });
      });
    } else {
      streamChatRunner.stopTwitch();
    }

    // 3. YouTube Live Stream Chat Poller
    const ytInt = activeIntegrations.find((i) => i.platform === 'youtube' && i.enabled);
    if (ytInt && ytInt.apiKey && ytInt.youtubeVideoId) {
      streamChatRunner.startYouTube(ytInt, (status, msg) => {
        handleUpdateIntegration({ ...ytInt, status, statusMessage: msg });
      });
    } else {
      streamChatRunner.stopYouTube();
    }
  }, [activeIntegrations, currentRoute]);

  // Keep 3D avatar facial expression in sync with latest assistant message in active conversation
  useEffect(() => {
    if (currentConversation?.messages?.length) {
      const lastAsst = [...currentConversation.messages]
        .reverse()
        .find((m) => m.role === 'assistant' && !m.error);
      if (lastAsst?.content) {
        detectEmotionForResponse(lastAsst.content)
          .then((emo) => setAvatarEmotion(emo))
          .catch(() => setAvatarEmotion('neutral'));
        return;
      }
    }
    setAvatarEmotion('neutral');
  }, [activeConvId]);

  // Connect live voice output from stream chat runner to TTS & lip sync
  useEffect(() => {
    streamChatRunner.setVoiceSpeakHandler((spokenText) => {
      if (userSettings.soundEffects || is3DMode) {
        speakAssistantMessage(`stream_voice_${Date.now()}`, spokenText);
      }
    });

    const unsubscribe = streamChatRunner.addMessageListener((evt) => {
      const streamUserMsg: Message = {
        id: `stream_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        content: `[${evt.platform.toUpperCase()} Live Chat] ${evt.author}: ${evt.message}`,
        timestamp: Date.now(),
      };
      const streamAsstMsg: Message = {
        id: `stream_asst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: evt.aiReply,
        timestamp: Date.now() + 100,
        modelUsed: activeModel.name,
      };

      setConversations((prev) => {
        const active = prev.find((c) => c.id === activeConvId);
        if (!active) return prev;
        const updated = prev.map((c) =>
          c.id === activeConvId
            ? { ...c, messages: [...c.messages, streamUserMsg, streamAsstMsg], updatedAt: Date.now() }
            : c
        );
        saveStoredConversations(updated);
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [activeConvId, activeModel.name, is3DMode, userSettings.soundEffects, speakAssistantMessage]);

  useEffect(() => {
    return () => {
      discordBotRunner.stop();
      streamChatRunner.stopTwitch();
      streamChatRunner.stopYouTube();
    };
  }, []);

  // ----------------------------------------------------
  // Initial Boot: Load persistent data & inspect cache
  // ----------------------------------------------------
  const refreshCacheStatuses = useCallback(async () => {
    try {
      const statuses = await getAllModelCacheStatuses();
      setCacheStatuses(statuses);
    } catch (e) {
      console.warn('Cache status inspect error:', e);
    }
  }, []);

  useEffect(() => {
    loadStoredConversations().then((stored) => {
      if (stored && stored.length > 0) {
        setConversations(stored);
        const lastActive = loadActiveConversationId();
        const found = stored.find((c) => c.id === lastActive);
        if (found) {
          setActiveConvId(found.id);
        } else {
          setActiveConvId(stored[0].id);
        }
      } else {
        const initialConv: Conversation = {
          id: `conv_${Date.now()}`,
          title: 'Direct Message',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          modelId: DEFAULT_MODEL_ID,
        };
        setConversations([initialConv]);
        setActiveConvId(initialConv.id);
        saveStoredConversations([initialConv]);
      }
    });

    detectBestHardwareDevice(userSettings.preferredDevice).then((dev) => {
      setTelemetry((prev) => ({
        ...prev,
        device: dev,
      }));
    });

    refreshCacheStatuses();
  }, [refreshCacheStatuses, userSettings.preferredDevice]);

  // ----------------------------------------------------
  // Ollama Servers: 5-Second Ping Check & Page-Load Auto-Switch
  // ----------------------------------------------------
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatusMap>({
    muxAi: { online: false, modelName: '', models: [] },
    custom: { online: false, modelName: '', models: [] },
  });

  const hasCheckedAutoSwitch = useRef(false);

  // Server offline auto-failover notification state (stays for 6 seconds then fades)
  const [serverFallbackNotice, setServerFallbackNotice] = useState<{
    message: string;
    isFading: boolean;
  } | null>(null);
  const serverFallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const serverFallbackFadeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerFallbackNotice = useCallback((optionName: string) => {
    if (serverFallbackTimerRef.current) clearTimeout(serverFallbackTimerRef.current);
    if (serverFallbackFadeTimerRef.current) clearTimeout(serverFallbackFadeTimerRef.current);

    setServerFallbackNotice({
      message: `Server issue on ${optionName}, changed to local LM.`,
      isFading: false,
    });

    // Stays for configured duration, then fades away smoothly
    serverFallbackTimerRef.current = setTimeout(() => {
      setServerFallbackNotice((prev) => (prev ? { ...prev, isFading: true } : null));
      serverFallbackFadeTimerRef.current = setTimeout(() => {
        setServerFallbackNotice(null);
      }, UI_CONFIG.serverFallbackFadeDurationMs);
    }, UI_CONFIG.serverFallbackNoticeDurationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (serverFallbackTimerRef.current) clearTimeout(serverFallbackTimerRef.current);
      if (serverFallbackFadeTimerRef.current) clearTimeout(serverFallbackFadeTimerRef.current);
    };
  }, []);

  const activeModelRef = useRef(activeModel);
  useEffect(() => {
    activeModelRef.current = activeModel;
  }, [activeModel]);

  useEffect(() => {
    let isSubscribed = true;

    const checkOllamaEndpoints = async () => {
      const customUrl = loadCustomOllamaUrl() || OLLAMA_CONFIG.defaultCustomUrl;
      const [muxRes, customRes] = await Promise.all([
        pingOllama(OLLAMA_CONFIG.muxAiEndpoint),
        pingOllama(customUrl),
      ]);

      if (!isSubscribed) return;

      const newStatus: OllamaStatusMap = {
        muxAi: {
          online: muxRes.online,
          modelName: muxRes.modelName || '',
          models: muxRes.models || [],
        },
        custom: {
          online: customRes.online,
          modelName: customRes.modelName || '',
          models: customRes.models || [],
        },
      };

      setOllamaStatus(newStatus);

      // Auto-switch at page load if custom or main server is detected online
      if (!hasCheckedAutoSwitch.current) {
        hasCheckedAutoSwitch.current = true;
        if (customRes.online) {
          const spec = getModelById('self-hosted-ollama');
          const detected = customRes.modelName || 'Hudson/llama3.1-uncensored:8b';
          const modelToActivate: ModelSpec = {
            ...spec,
            detectedModel: detected,
          };
          setActiveModel(modelToActivate);
          setTelemetry((prev) => ({
            ...prev,
            activeModelName: modelToActivate.name,
            modelId: modelToActivate.id,
            device: 'ollama',
            statusText: `Connected to Custom Ollama (${detected})`,
          }));
        } else if (muxRes.online) {
          const spec = getModelById('muxai-ollama');
          const detected = muxRes.modelName || 'Hudson/llama3.1-uncensored:8b';
          const modelToActivate: ModelSpec = {
            ...spec,
            detectedModel: detected,
          };
          setActiveModel(modelToActivate);
          setTelemetry((prev) => ({
            ...prev,
            activeModelName: modelToActivate.name,
            modelId: modelToActivate.id,
            device: 'ollama',
            statusText: `Connected to MuxAI Ollama (${detected})`,
          }));
        }
      } else {
        // Continuous health check: whenever an active Ollama server goes offline again,
        // auto-switch to smollm2 135 model and show notification for 6 seconds
        const currentModel = activeModelRef.current;
        if (currentModel.id === 'muxai-ollama' && !muxRes.online) {
          const smollmSpec = getModelById('smollm2-135m');
          setActiveModel(smollmSpec);
          setTelemetry((prev) => ({
            ...prev,
            activeModelName: smollmSpec.name,
            modelId: smollmSpec.id,
            device: 'webgpu',
            statusText: 'Ready',
          }));
          triggerFallbackNotice(currentModel.name);
        } else if (currentModel.id === 'self-hosted-ollama' && !customRes.online) {
          const smollmSpec = getModelById('smollm2-135m');
          setActiveModel(smollmSpec);
          setTelemetry((prev) => ({
            ...prev,
            activeModelName: smollmSpec.name,
            modelId: smollmSpec.id,
            device: 'webgpu',
            statusText: 'Ready',
          }));
          triggerFallbackNotice(currentModel.name);
        } else {
          // Keep active model's detectedModel up to date if currently on an Ollama model
          setActiveModel((current) => {
            if (current.id === 'muxai-ollama' && muxRes.modelName && current.detectedModel !== muxRes.modelName) {
              return { ...current, detectedModel: muxRes.modelName };
            }
            if (current.id === 'self-hosted-ollama' && customRes.modelName && current.detectedModel !== customRes.modelName) {
              return { ...current, detectedModel: customRes.modelName };
            }
            return current;
          });
        }
      }
    };

    // Immediate initial check at page load
    checkOllamaEndpoints();

    // Recurring check every 5 seconds
    const interval = setInterval(checkOllamaEndpoints, OLLAMA_CONFIG.pingIntervalMs || 5000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, []);

  const handleUpdateCustomUrl = useCallback((newUrl: string) => {
    pingOllama(newUrl).then((res) => {
      setOllamaStatus((prev) => ({
        ...prev,
        custom: {
          online: res.online,
          modelName: res.modelName || '',
          models: res.models || [],
        },
      }));
      if (res.online && activeModel.id === 'self-hosted-ollama') {
        setActiveModel((prev) => ({
          ...prev,
          detectedModel: res.modelName || prev.detectedModel,
        }));
      }
    });
  }, [activeModel.id]);

  const currentConversation = conversations.find((c) => c.id === activeConvId) || conversations[0] || null;

  // Search matches computed from the current conversation
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !currentConversation) return [];
    const q = searchQuery.trim().toLowerCase();
    return currentConversation.messages
      .filter((m) => m.content.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [searchQuery, currentConversation]);

  // Reset match index when query or conversation changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, activeConvId]);

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
  };

  const updateConversationMessages = useCallback(
    (newMessages: Message[]) => {
      if (!activeConvId) return;
      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.id === activeConvId) {
            let newTitle = conv.title;
            if ((!newTitle || newTitle === 'Direct Message') && newMessages.length > 0) {
              const firstUserMsg = newMessages.find((m) => m.role === 'user');
              if (firstUserMsg) {
                newTitle = firstUserMsg.content.slice(0, UI_CONFIG.titleTruncateLength);
              }
            }
            return {
              ...conv,
              title: newTitle,
              messages: newMessages,
              updatedAt: Date.now(),
              modelId: activeModel.id,
            };
          }
          return conv;
        });
        saveStoredConversations(updated);
        return updated;
      });
    },
    [activeConvId, activeModel.id]
  );

  // ----------------------------------------------------
  // Actions: New Chat, Switch Chat, Delete, Pin
  // ----------------------------------------------------
  const handleNewChat = () => {
    if (isGenerating) stopCurrentGeneration();
    currentSpeechInfoRef.current = null;
    if (pausedSpeechResumeTimeoutRef.current) clearTimeout(pausedSpeechResumeTimeoutRef.current);
    window.speechSynthesis?.cancel();
    setCurrentlySpeakingMsgId(null);
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    const newConv: Conversation = {
      id: `conv_${Date.now()}`,
      title: 'Direct Message',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      modelId: activeModel.id,
    };
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConvId(newConv.id);
    saveActiveConversationId(newConv.id);
    saveStoredConversations(updated);
    setInput('');
    setStreamingText('');
  };

  const handleSelectConversation = (id: string) => {
    if (isGenerating) stopCurrentGeneration();
    currentSpeechInfoRef.current = null;
    if (pausedSpeechResumeTimeoutRef.current) clearTimeout(pausedSpeechResumeTimeoutRef.current);
    window.speechSynthesis?.cancel();
    setCurrentlySpeakingMsgId(null);
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    setActiveConvId(id);
    saveActiveConversationId(id);
    setStreamingText('');
  };

  const handleDeleteConversation = (id: string) => {
    const remaining = conversations.filter((c) => c.id !== id);
    if (remaining.length === 0) {
      handleNewChat();
    } else {
      setConversations(remaining);
      saveStoredConversations(remaining);
      if (activeConvId === id) {
        setActiveConvId(remaining[0].id);
        saveActiveConversationId(remaining[0].id);
      }
    }
  };

  const handleTogglePin = (id: string) => {
    setConversations((prev) => {
      const updated = prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
      saveStoredConversations(updated);
      return updated;
    });
  };

  const handleSelectModel = (model: ModelSpec) => {
    setActiveModel(model);
    setTelemetry((prev) => ({
      ...prev,
      activeModelName: model.name,
      modelId: model.id,
      device: model.family === 'ollama' ? 'ollama' : prev.device,
    }));
  };

  const streamingTextRef = useRef('');
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  // Stop ongoing loading, caching, downloads, or generation immediately
  const handleStopGeneration = useCallback(() => {
    stopCurrentGeneration();
    setDownloadProgress(null);
    const wasGenerating = isGeneratingRef.current;
    isGeneratingRef.current = false;
    setIsGenerating(false);

    currentSpeechInfoRef.current = null;
    streamSpeechStateRef.current = null;
    if (pausedSpeechResumeTimeoutRef.current) clearTimeout(pausedSpeechResumeTimeoutRef.current);
    window.speechSynthesis?.cancel();
    setCurrentlySpeakingMsgId(null);
    lipSyncManager.endSpeech();
    setSubtitleState((prev) => ({ ...prev, isActive: false }));

    // Preserve the partial message generated so far as a completed message
    const partialText = streamingTextRef.current.trim();
    if (partialText.length > 0 && wasGenerating) {
      const stoppedAssistantMessage: Message = {
        id: `msg_asst_${Date.now()}`,
        role: 'assistant',
        content: partialText,
        timestamp: Date.now(),
        modelUsed: activeModel.name,
        speedTps: telemetry.tokensPerSec,
        generationTimeMs: telemetry.totalLatencyMs,
      };

      setConversations((prev) => {
        const active = prev.find((c) => c.id === activeConvId);
        if (!active) return prev;
        const updatedMessages = [...active.messages, stoppedAssistantMessage];
        const updated = prev.map((conv) => {
          if (conv.id === activeConvId) {
            return {
              ...conv,
              messages: updatedMessages,
              updatedAt: Date.now(),
            };
          }
          return conv;
        });
        saveStoredConversations(updated);
        return updated;
      });

      // Update 3D avatar facial expression based on overall sentiment of partial output
      detectEmotionForResponse(partialText)
        .then((emo) => setAvatarEmotion(emo))
        .catch(() => setAvatarEmotion('neutral'));

      refreshCacheStatuses();
    }

    setStreamingText('');
    streamingTextRef.current = '';
    setDownloadProgress(null);
    setTelemetry((prev) => ({ ...prev, isGenerating: false }));
  }, [
    activeConvId,
    activeModel.name,
    telemetry.tokensPerSec,
    telemetry.totalLatencyMs,
    refreshCacheStatuses,
    isSoundActive,
    speakAssistantMessage,
  ]);

  // ----------------------------------------------------
  // Send Message Flow
  // ----------------------------------------------------
  const handleSendMessage = async (textToSend: string, customBaseHistory?: Message[]) => {
    const rawTrimmed = textToSend.trim();
    if (!rawTrimmed && attachedFiles.length === 0) return;
    if (isGenerating) return;

    if (isSoundActive) {
      soundManager.playSend();
    }

    setInput('');
    setLastUserMessageAt(Date.now());

    const docTexts = attachedFiles
      .filter((f) => f.textContent)
      .map((f) => `--- Attached Document: "${f.name}" ---\n${f.textContent}\n--- End Document ---`)
      .join('\n\n');

    setActiveChatContext({
      text: rawTrimmed,
      attachedDocumentText: docTexts || undefined,
      modelId: activeModel.id,
    });

    let promptToSend = rawTrimmed;
    if (attachedFiles.length > 0) {
      const fileSummary = attachedFiles
        .map((f) => {
          if (f.textContent) {
            return `📎 [${f.name} (${f.type || 'document'}, ${(f.size / 1024).toFixed(1)} KB)]\n"""\n${f.textContent}\n"""`;
          }
          return `📎 [${f.name} (${f.type || 'file'}, ${(f.size / 1024).toFixed(1)} KB)]`;
        })
        .join('\n\n');
      promptToSend = rawTrimmed ? `${fileSummary}\n\n${rawTrimmed}` : fileSummary;
      handleClearAllFiles();
    }

    const userMessage: Message = {
      id: `msg_user_${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: Date.now(),
    };

    const baseHistory = customBaseHistory || (currentConversation ? currentConversation.messages : []);
    const updatedWithUser = [...baseHistory, userMessage];
    updateConversationMessages(updatedWithUser);

    setIsGenerating(true);
    isGeneratingRef.current = true;
    setStreamingText('');
    streamingTextRef.current = '';
    hasPlayedReceiveAudio.current = false;

    setTelemetry((prev) => ({
      ...prev,
      isGenerating: true,
      tokensPerSec: 0,
      timeToFirstTokenMs: 0,
      totalLatencyMs: 0,
      tokenCount: 0,
      statusText: 'Formulating reply...',
    }));

    const assistantMsgId = `msg_asst_${Date.now()}`;
    let lastTelemetryDispatch = 0;
    let latestTelemetryStats: {
      tokensPerSec: number;
      ttftMs: number;
      totalMs: number;
      tokenCount: number;
      device: HardwareDevice;
    } | null = null;

    try {
      const assistantText = await streamPersonaResponse({
        model: activeModel,
        history: updatedWithUser,
        userMessage: promptToSend,
        devicePref: userSettings.preferredDevice,
        maxTokens: userSettings.maxTokens || TOKEN_CONFIG.defaultTokens,
        onToken: (_piece, fullText) => {
          streamingTextRef.current = fullText;
          setStreamingText(fullText);
          if (!hasPlayedReceiveAudio.current && isSoundActive) {
            soundManager.playReceive();
            hasPlayedReceiveAudio.current = true;
          }

          // Let 3D mode AI access real-time message text as soon as it begins to arrive to reduce delay
          if (isSoundActive) {
            queueStreamingSpeechChunk(assistantMsgId, fullText, false);
          }
        },
        onTelemetry: (stats) => {
          latestTelemetryStats = stats;
          const now = performance.now();
          // Throttle telemetry re-renders to at most once per 150ms to keep 60 FPS smooth UI
          if (now - lastTelemetryDispatch >= 150) {
            lastTelemetryDispatch = now;
            setTelemetry((prev) => ({
              ...prev,
              tokensPerSec: stats.tokensPerSec,
              timeToFirstTokenMs: stats.ttftMs,
              totalLatencyMs: stats.totalMs,
              tokenCount: stats.tokenCount,
              device: stats.device,
            }));
          }
        },
        onProgress: (prog) => {
          setDownloadProgress(prog);
          if (prog.status === 'ready') {
            refreshCacheStatuses();
          }
        },
      });

      // If user stopped it mid-generation, handleStopGeneration already committed the partial message!
      if (!isGeneratingRef.current) {
        return;
      }

      // Finalize any remaining unqueued text for real-time speech
      if (isSoundActive) {
        queueStreamingSpeechChunk(assistantMsgId, assistantText, true);
      }

      const assistantMessage: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: assistantText,
        timestamp: Date.now(),
        modelUsed: activeModel.name,
        speedTps: telemetry.tokensPerSec,
        generationTimeMs: telemetry.totalLatencyMs,
      };

      updateConversationMessages([...updatedWithUser, assistantMessage]);

      // Pass the /chat LLM output through secondary LLM/algorithm to update 3D mode avatar's facial expression
      detectEmotionForResponse(assistantText)
        .then((detectedEmotion) => {
          setAvatarEmotion(detectedEmotion);
        })
        .catch(() => {
          setAvatarEmotion('neutral');
        });

      // Dispatch chat events to active automation webhooks (n8n, Zapier)
      dispatchChatToWebhooks(activeIntegrations, {
        prompt: promptToSend,
        response: assistantText,
        modelUsed: activeModel.name,
        timestamp: Date.now(),
      });

      setStreamingText('');
      streamingTextRef.current = '';
      setDownloadProgress(null);
      refreshCacheStatuses();
    } catch (err: unknown) {
      if (!isGeneratingRef.current) {
        return;
      }
      console.error('Chat generation error:', err);

      const isOllama = activeModel.family === 'ollama';
      if (isOllama) {
        const smollmSpec = getModelById('smollm2-135m');
        setActiveModel(smollmSpec);
        setTelemetry((prev) => ({
          ...prev,
          activeModelName: smollmSpec.name,
          modelId: smollmSpec.id,
          device: 'webgpu',
          statusText: 'Ready',
        }));
        triggerFallbackNotice(activeModel.name);
      }

      const errorDetails = err instanceof Error
        ? `${err.name}: ${err.message}${err.stack ? `\n\nStack:\n${err.stack}` : ''}`
        : typeof err === 'object' && err !== null
        ? JSON.stringify(err, null, 2)
        : String(err);

      const fallbackAssistantMessage: Message = {
        id: `msg_asst_err_${Date.now()}`,
        role: 'assistant',
        content: isOllama
          ? `Connection to ${activeModel.name} was interrupted. I have automatically switched to local Tiny Brain.\n\n${CHAT_ERROR_CONFIG.formatErrorMessage(errorDetails)}`
          : CHAT_ERROR_CONFIG.formatErrorMessage(errorDetails),
        timestamp: Date.now(),
        modelUsed: activeModel.name,
        error: true,
      };

      updateConversationMessages([...updatedWithUser, fallbackAssistantMessage]);
      setStreamingText('');
      streamingTextRef.current = '';
      setDownloadProgress(null);
    } finally {
      setIsGenerating(false);
      isGeneratingRef.current = false;
      setTelemetry((prev) => ({
        ...prev,
        ...(latestTelemetryStats
          ? {
              tokensPerSec: latestTelemetryStats.tokensPerSec,
              timeToFirstTokenMs: latestTelemetryStats.ttftMs,
              totalLatencyMs: latestTelemetryStats.totalMs,
              tokenCount: latestTelemetryStats.tokenCount,
              device: latestTelemetryStats.device,
            }
          : {}),
        isGenerating: false,
      }));
    }
  };

  // ----------------------------------------------------
  // User Message Toolbar Handlers (Retry & Edit)
  // ----------------------------------------------------
  const handleRetryUserMessage = (text: string) => {
    if (!currentConversation || isGenerating) return;
    const msgs = currentConversation.messages;
    const msgIndex = msgs.findIndex((m) => m.content === text && m.role === 'user');
    if (msgIndex !== -1) {
      const historyBefore = msgs.slice(0, msgIndex);
      handleSendMessage(text, historyBefore);
    } else {
      handleSendMessage(text);
    }
  };

  const handleEditUserMessage = (messageId: string, newText: string) => {
    if (!currentConversation || isGenerating) return;
    const msgs = currentConversation.messages;
    const msgIndex = msgs.findIndex((m) => m.id === messageId);
    if (msgIndex !== -1) {
      const historyBefore = msgs.slice(0, msgIndex);
      handleSendMessage(newText, historyBefore);
    }
  };

  // Preload a model from Settings
  const handlePreloadModel = async (model: ModelSpec) => {
    try {
      await loadModelPipeline(model, userSettings.preferredDevice, (prog) => {
        setDownloadProgress(prog);
      });
      await refreshCacheStatuses();
    } catch (e) {
      console.error('Preload failed:', e);
    } finally {
      setDownloadProgress(null);
    }
  };

  const handleDeleteModelCache = async (hfRepo: string) => {
    await deleteModelFromCache(hfRepo);
    await refreshCacheStatuses();
  };

  const handleClearAllCache = async () => {
    await clearAllTransformersCaches();
    resetActiveGenerator();
    await refreshCacheStatuses();
    const reloaded = loadUserSettings();
    setUserSettings(reloaded);
  };

  const handleUpdateSettings = (newPartial: Partial<UserSettings>) => {
    // If sound is being disabled and not in 3D mode, stop any active speech immediately
    if (newPartial.soundEffects === false && !is3DMode) {
      window.speechSynthesis?.cancel();
      setCurrentlySpeakingMsgId(null);
      setSubtitleState((prev) => ({ ...prev, isActive: false }));
    }
    setUserSettings((prev) => {
      const updated = { ...prev, ...newPartial };
      saveUserSettings(updated);
      return updated;
    });
  };

  const handleToggleNavbarSound = () => {
    const nextVal = !userSettings.soundEffects;
    if (!nextVal && !is3DMode) {
      window.speechSynthesis?.cancel();
      setCurrentlySpeakingMsgId(null);
      setSubtitleState((prev) => ({ ...prev, isActive: false }));
    }
    handleUpdateSettings({ soundEffects: nextVal });
  };

  const remainingBlockSeconds = Math.max(0, Math.ceil((blockedUntil - nowMs) / 1000));
  const isCurrentlyBlocked = blockedUntil > nowMs && remainingBlockSeconds > 0;

  const formatBlockCountdown = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  const shockwaveOverlay = (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden="true">
      {clickRipples.map((r) => (
        <div key={r.id} style={{ position: 'absolute', left: r.x, top: r.y }}>
          <span className="click-shockwave-primary" />
          <span className="click-shockwave-echo-1" />
          <span className="click-shockwave-echo-2" />
        </div>
      ))}
    </div>
  );

  // Render GitBook-style Documentation Page at '/docs' and subpaths
  if (currentRoute.startsWith('/docs')) {
    return (
      <>
        {shockwaveOverlay}
        <DocsPage
          currentPath={currentRoute}
          onNavigate={navigateTo}
          onBackToChat={() => navigateTo('/chat')}
          onBackToHome={() => navigateTo('/')}
        />
      </>
    );
  }

  // Render Secret Director Stage at '/act'
  if (currentRoute.startsWith('/act')) {
    return (
      <>
        {shockwaveOverlay}
        <ActDirectorPage
          onBackToChat={() => navigateTo('/chat')}
          onNavigateHome={() => navigateTo('/')}
        />
      </>
    );
  }

  // Render Secret Combat Testbed & Torment Game at '/tor'
  if (currentRoute.startsWith('/tor')) {
    return (
      <>
        {shockwaveOverlay}
        <TorGamePage
          onBackToChat={() => navigateTo('/chat')}
          onNavigateHome={() => navigateTo('/')}
          onNavigateToAct={() => navigateTo('/act')}
        />
      </>
    );
  }

  // Render MMD Studio Stage at '/mmd'
  if (currentRoute.startsWith('/mmd')) {
    return (
      <>
        {shockwaveOverlay}
        <MMDStudioPage
          onBackToChat={() => navigateTo('/chat')}
          onNavigateHome={() => navigateTo('/')}
        />
      </>
    );
  }

  // Render Voice Diagnostics & TTS Engine Tester at '/voice'
  if (currentRoute.startsWith('/voice')) {
    return (
      <>
        {shockwaveOverlay}
        <VoiceTesterPage
          onNavigateToChat={() => navigateTo('/chat')}
          onNavigateHome={() => navigateTo('/')}
          onNavigateToDocs={(p) => navigateTo(p || '/docs')}
        />
      </>
    );
  }

  // Render Autonomous AI Interview at '/interview'
  if (currentRoute.startsWith('/interview')) {
    return (
      <>
        {shockwaveOverlay}
        <InterviewPage
          currentPath={currentRoute}
          onNavigateHome={() => navigateTo('/')}
          onNavigateToChat={() => navigateTo('/chat')}
          onNavigateToInterview={(id) => navigateTo(id ? `/interview?id=${id}` : '/interview')}
          isPremium={isPremium}
          onRequirePremium={() => setIsPremiumModalOpen(true)}
          accountUser={accountUser}
        />
      </>
    );
  }

  // Render Autonomous AI Voice Caller & Agentic Booking at '/caller'
  if (currentRoute.startsWith('/caller')) {
    return (
      <>
        {shockwaveOverlay}
        <CallerPage
          onNavigateHome={() => navigateTo('/')}
          onNavigateToChat={() => navigateTo('/chat')}
          onNavigateToDocs={(p) => navigateTo(p || '/docs')}
          activeModel={activeModel}
          onSelectModel={handleSelectModel}
          cacheStatuses={cacheStatuses}
          ollamaStatus={ollamaStatus}
          onUpdateCustomUrl={handleUpdateCustomUrl}
          userSettings={userSettings}
          onUpdateSettings={handleUpdateSettings}
          activeOutfitFileName={activeOutfit.fileName}
        />
      </>
    );
  }

  // Render MuxAI Humanizer & Turnitin-Reverse at '/humanizer' (and redirects)
  if (currentRoute.startsWith('/humanizer')) {
    return (
      <>
        {shockwaveOverlay}
        <HumanizerPage
          onNavigateToChat={() => navigateTo('/chat')}
          onNavigateToDocs={(p) => navigateTo(p || '/docs')}
          onNavigateHome={() => navigateTo('/')}
          cacheStatuses={cacheStatuses}
        />
      </>
    );
  }

  // Render Landing Page at default root route '/'
  if (currentRoute === '/') {
    return (
      <>
        {shockwaveOverlay}
        <LandingPage
          onStartChat={() => navigateTo('/chat')}
          onNavigateToDocs={(p) => navigateTo(p || '/docs')}
          onNavigateToHumanizer={() => navigateTo('/humanizer')}
          onNavigateToInterview={(p) => navigateTo(p || '/interview')}
          onNavigateToCaller={() => navigateTo('/caller')}
        />
      </>
    );
  }

  // Render "You are Blocked" Screen on '/chat' when temporary harassment ban is active
  if (isCurrentlyBlocked) {
    return (
      <div className="relative min-h-screen w-screen bg-[#0c0d14] text-white font-sans flex items-center justify-center p-4 sm:p-6 overflow-y-auto select-none">
        {shockwaveOverlay}
        <div className="max-w-xl w-full rounded-3xl bg-[#13151f] border border-red-500/30 shadow-2xl shadow-red-950/40 p-6 sm:p-10 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-500 flex items-center justify-center mx-auto shadow-inner">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold font-heading text-white tracking-tight">
              You are Blocked
            </h1>

            {/* Real-time Countdown Timer */}
            <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-red-950/50 border border-red-500/30 text-red-300 font-mono text-xl sm:text-2xl font-bold tracking-widest mt-2 shadow-inner">
              <Clock className="w-5 h-5 text-red-400 animate-pulse" />
              <span>{formatBlockCountdown(remainingBlockSeconds)}</span>
            </div>
          </div>

          <div className="space-y-4 text-sm sm:text-base text-neutral-300 leading-relaxed text-left bg-black/25 p-5 rounded-2xl border border-white/[0.06]">
            <p className="font-semibold text-white">
              MuxAI has detected indecent behavior from you, for which you are temporarily banned from talking to {AI_PROFILE.name}.
            </p>
            <p className="text-neutral-300">
              The duration to wait will increase if you continue doing this in the future
            </p>
            <p className="text-amber-300/90 text-xs sm:text-sm font-medium">
              Trying to reset this by clearing cache will also clear all your conversations and delete downloaded AI models. Do it at your own risk!
            </p>
            <p className="text-neutral-400 text-xs sm:text-sm border-t border-white/[0.08] pt-3">
              MuxAI does not monitor your usage of this platform but there are built-in detection systems that may trigger alerts in case of highly illegal or inappropriate activities. Be warned!
            </p>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => navigateTo('/')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
            >
              <Home className="w-4 h-4" />
              <span>Return to Landing Page</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden ${THEME_COLORS.tokens.appBg} ${THEME_COLORS.tokens.appText} font-sans antialiased transition-colors ${theme === 'dark' ? 'dark' : ''}`}
      style={{
        backgroundColor: 'var(--theme-bg)',
        color: 'var(--theme-text)',
      }}
    >
      {shockwaveOverlay}
      {/* Sidebar (Conversations History & Account Section) */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        conversations={conversations}
        activeId={activeConvId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onTogglePin={handleTogglePin}
        cacheStatuses={cacheStatuses}
        accountUser={accountUser}
        onSignUp={handleSignUp}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onUpdateProfile={handleUpdateProfile}
        onRedeemCode={handleRedeemCode}
        externalAuthModalRequest={externalAuthModalRequest}
        onNavigateHome={() => navigateTo('/')}
      />

      {/* Right Sidebar (Themes & Wardrobe Live 3D Viewports) */}
      <ThemeSidebar
        isOpen={isThemeSidebarOpen}
        onClose={() => setIsThemeSidebarOpen(false)}
        presetThemes={PRESET_THEMES}
        customThemes={customThemes}
        activeThemeId={activeTheme.id}
        onSelectTheme={handleSelectTheme}
        onDeleteCustomTheme={handleDeleteCustomTheme}
        onOpenCreateModal={() => setIsCustomThemeModalOpen(true)}
        equippedOutfitId={activeOutfit.id}
        onSelectOutfit={handleSelectOutfit}
        isPremiumUser={isPremium}
        unlockedOutfitIds={unlockedOutfitIds}
        onRequirePremium={() => {
          setIsPremiumModalOpen(true);
          setIsThemeSidebarOpen(false);
          setIsSidebarOpen(false);
        }}
      />

      {/* Premium VIP Tier Pop-up Modal */}
      <PremiumModal
        isOpen={isPremiumModalOpen}
        onClose={() => setIsPremiumModalOpen(false)}
      />

      {/* Main Viewport */}
      <main
        className={`flex-1 flex flex-col h-full min-w-0 relative ${THEME_COLORS.tokens.appBg} transition-colors`}
        style={{
          backgroundColor: 'var(--theme-bg)',
        }}
      >
        {/* Top Header with 3D Mode Toggle Button between Search and Sound, and Palette Theme Button */}
        <Header
          isGenerating={isGenerating}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isSearchOpen={isSearchOpen}
          onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
          is3DMode={is3DMode}
          onToggle3DMode={() => setIs3DMode(!is3DMode)}
          onOpenProfile={() => setIsProfileOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          soundEnabled={isSoundActive}
          onToggleSound={handleToggleNavbarSound}
          isThemeSidebarOpen={isThemeSidebarOpen}
          onToggleThemeSidebar={() => setIsThemeSidebarOpen((prev) => !prev)}
        />

        {/* Quick Conversation Search Bar */}
        {!is3DMode && (
          <SearchBar
            isOpen={isSearchOpen}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            currentMatchIndex={currentMatchIndex}
            totalMatches={searchMatches.length}
            onNextMatch={handleNextMatch}
            onPrevMatch={handlePrevMatch}
            onClose={() => {
              setIsSearchOpen(false);
              setSearchQuery('');
            }}
          />
        )}

        {/* Central Display: 3D VRM Mode OR Message Thread Canvas */}
        <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* 3D VRM Canvas: Loaded behind the scenes from app startup, active when is3DMode */}
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${
              is3DMode ? 'opacity-100 pointer-events-auto z-10' : 'opacity-0 pointer-events-none -z-10'
            }`}
          >
            <VRMCanvas
              isSpeaking={currentlySpeakingMsgId !== null}
              onModelClick={handleModelClick}
              onFallStart={handleFallStart}
              isPainSoundPlaying={isPainSoundActive}
              modelFileName={activeOutfit.fileName}
              lastUserMessageAt={lastUserMessageAt}
              emotion={avatarEmotion}
            />
          </div>

          {/* Message Thread Canvas */}
          <div
            className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${
              !is3DMode ? 'opacity-100 pointer-events-auto z-10' : 'opacity-0 pointer-events-none -z-10'
            }`}
          >
            <MessageList
              messages={currentConversation ? currentConversation.messages : []}
              isGenerating={isGenerating}
              streamingText={streamingText}
              activeModel={activeModel}
              onSelectStarter={handleSendMessage}
              onRetryUserMessage={handleRetryUserMessage}
              onEditUserMessage={handleEditUserMessage}
              currentlySpeakingId={currentlySpeakingMsgId}
              onToggleSpeak={handleToggleSpeak}
              onOpenProfile={() => setIsProfileOpen(true)}
              searchQuery={searchQuery}
              currentMatchMessageId={searchMatches[currentMatchIndex] || null}
            />
          </div>

          {/* Subtitle-like system when 3D mode is enabled: every word spoken aloud is shown above the chat input panel in front of the 3D model */}
          {is3DMode && userSettings.visualSubtitles !== false && (
            <div className="absolute bottom-2 inset-x-0 z-30 flex justify-center pointer-events-none">
              <VRMSubtitles
                isActive={subtitleState.isActive}
                text={subtitleState.text}
                charIndex={subtitleState.charIndex}
                currentWord={subtitleState.currentWord}
                onDismiss={() => setSubtitleState((prev) => ({ ...prev, isActive: false }))}
              />
            </div>
          )}
        </div>

        {/* Server Issue Fallback Notification (Above Status Bar) */}
        {serverFallbackNotice && (
          <div className="flex justify-center px-4 mb-2">
            <div
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 shadow-sm transition-all duration-500 border z-30 ${
                serverFallbackNotice.isFading ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0'
              } ${THEME_COLORS.tokens.fallbackNoticeBg} backdrop-blur-md animate-in fade-in slide-in-from-bottom-1`}
            >
              <AlertCircle className={`w-3.5 h-3.5 ${THEME_COLORS.tokens.accentText} shrink-0`} />
              <span>{serverFallbackNotice.message}</span>
            </div>
          </div>
        )}

        {/* Microphone Alert (Above Chat Input Panel Status Bar) */}
        {micAlert && (
          <div className="flex justify-center px-4 mb-2">
            <div className="px-3.5 py-1.5 rounded-2xl text-xs font-medium flex items-center justify-between gap-3 shadow-md border z-30 bg-red-500/10 dark:bg-red-950/40 border-red-500/30 text-red-600 dark:text-red-300 backdrop-blur-md animate-in fade-in slide-in-from-bottom-1 max-w-2xl w-full sm:w-auto">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="leading-snug">{micAlert}</span>
              </div>
              <button
                type="button"
                onClick={() => setMicAlert(null)}
                className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Telemetry Status Bar (Directly Above Chat Input Panel) */}
        <TelemetryBar
          activeModel={activeModel}
          telemetry={telemetry}
          downloadProgress={downloadProgress}
          isExpanded={isTelemetryExpanded}
          onToggleExpand={() => setIsTelemetryExpanded(!isTelemetryExpanded)}
          onCancelDownload={handleStopGeneration}
        />

        {/* Chat Input Panel with Model Selector, Plus Menu (+), Attached Files & Integrations */}
        <div className="relative z-20">
          <ChatInput
            input={input}
            setInput={setInput}
            onSend={handleSendMessage}
            isGenerating={isGenerating}
            onStop={handleStopGeneration}
            activeModel={activeModel}
            cacheStatuses={cacheStatuses}
            onSelectModel={handleSelectModel}
            maxTokens={userSettings.maxTokens || TOKEN_CONFIG.defaultTokens}
            onChangeMaxTokens={(val) => handleUpdateSettings({ maxTokens: val })}
            ollamaStatus={ollamaStatus}
            onUpdateCustomUrl={handleUpdateCustomUrl}
            attachedFiles={attachedFiles}
            onAddFiles={handleAddFiles}
            onRemoveFile={handleRemoveFile}
            onClearAllFiles={handleClearAllFiles}
            activeIntegrations={activeIntegrations}
            onOpenAddIntegrationModal={() => setIsAddIntegrationModalOpen(true)}
            onUpdateIntegration={handleUpdateIntegration}
            onRemoveIntegration={handleRemoveIntegration}
            onNavigateToDocs={navigateTo}
            onMicAlert={setMicAlert}
            isHanaSpeaking={Boolean(currentlySpeakingMsgId !== null || isPainSoundActive)}
          />
        </div>
      </main>

      {/* Integration Library Pop-up Modal */}
      <AddIntegrationModal
        isOpen={isAddIntegrationModalOpen}
        onClose={() => setIsAddIntegrationModalOpen(false)}
        activeIntegrations={activeIntegrations}
        onAddIntegration={handleAddIntegration}
        onNavigateToDocs={navigateTo}
      />

      {/* Twitter/X Style Profile Preview Modal */}
      <TwitterProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        onNavigateHome={() => {
          setIsProfileOpen(false);
          navigateTo('/');
        }}
      />

      {/* Settings & Offline SLM Storage Manager Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        cacheStatuses={cacheStatuses}
        onDeleteModel={handleDeleteModelCache}
        onClearAllCache={handleClearAllCache}
        onPreloadModel={handlePreloadModel}
        userSettings={userSettings}
        onUpdateSettings={handleUpdateSettings}
        isDownloading={Boolean(downloadProgress && downloadProgress.status === 'downloading')}
      />

      {/* Custom Theme Pop-up Modal */}
      <CustomThemeModal
        isOpen={isCustomThemeModalOpen}
        onClose={() => setIsCustomThemeModalOpen(false)}
        onSave={handleSaveCustomTheme}
      />

      {/* App Launch Splash Screen */}
      {isSplashActive && (
        <SplashScreen
          isReady={isSplashReady}
          theme={theme}
          onFadeComplete={() => setIsSplashActive(false)}
        />
      )}
    </div>
  );
}
