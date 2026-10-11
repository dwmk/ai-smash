import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  FileText,
  Upload,
  Send,
  ArrowLeft,
  Radio,
  Trash2,
  Square,
  ExternalLink,
  Sparkles,
  Link2,
  Check,
  Eye,
  EyeOff,
  MessageSquare,
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Play,
  Copy,
  Activity,
  Globe,
  Sliders,
  Zap,
} from 'lucide-react';
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
} from '../lib/models';
import {
  ModelSpec,
  ModelCacheInfo,
  DownloadProgress,
  TelemetryStats,
  UserSettings,
  Message,
  HardwareDevice,
} from '../types';
import {
  soundManager,
  waitForPersonaVoice,
  getPersonaVoice,
} from '../lib/audio';
import { extractDocumentText } from '../lib/documentParser';
import {
  streamPersonaResponse,
  stopCurrentGeneration,
} from '../lib/slmEngine';
import { lipSyncManager } from '../lib/lipSync';
import { AvatarEmotion, detectEmotionForResponse } from '../lib/emotionDetector';
import { VOICE_CONFIG, DEFAULT_OUTFIT_ID, getOutfitById } from '../constants';
import { ModelSelector, OllamaStatusMap } from './ModelSelector';
import { ProviderSubmodelSelector } from './ProviderSubmodelSelector';
import { MaxTokensSelector } from './MaxTokensSelector';
import { TelemetryBar } from './TelemetryBar';
import { VRMCanvas } from './VRMCanvas';
import { VRMSubtitles } from './VRMSubtitles';
import { OmnichannelGatewaysGrid } from './OmnichannelGatewaysGrid';
import { discordBotRunner } from '../lib/discordRunner';

export interface CallerPageProps {
  onNavigateHome: () => void;
  onNavigateToChat: () => void;
  onNavigateToDocs?: (path?: string) => void;
  activeModel?: ModelSpec;
  onSelectModel?: (model: ModelSpec) => void;
  cacheStatuses?: Record<string, ModelCacheInfo>;
  ollamaStatus?: OllamaStatusMap;
  onUpdateCustomUrl?: (url: string) => void;
  userSettings?: UserSettings;
  onUpdateSettings?: (newPartial: Partial<UserSettings>) => void;
  activeOutfitFileName?: string;
}

type CallStatus = 'idle' | 'dialing' | 'ringing' | 'connected' | 'speaking' | 'listening' | 'ended';
type CallDirection = 'outbound' | 'inbound';

interface CallTranscriptMessage {
  id: string;
  sender: 'agent' | 'callee';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

interface RagPreset {
  id: string;
  name: string;
  outboundGreeting: string;
  inboundGreeting: string;
  quickPhrases: string[];
  content: string;
}

const STORAGE_KEYS = {
  MY_LINE: 'hana_caller_my_line_v3',
  TARGET_PHONE: 'hana_caller_target_phone_v3',
  RAG_TEXT: 'hana_caller_rag_text_v3',
  RAG_PRESET: 'hana_caller_rag_preset_v3',
  PLATFORMS: 'hana_caller_platforms_v2',
};

export const CALLER_INTERVIEWER_VRM_MODEL = 'hana_v1.2_interviewer_vrm1.vrm';

export interface PlatformCredentials {
  whatsapp: {
    enabled: boolean;
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    verifyToken: string;
    targetNumber: string;
    callMode: 'audio_note' | 'voip_bridge' | 'receptionist';
    status: 'idle' | 'verified' | 'error';
    statusMessage?: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
    secretToken: string;
    callMode: 'voice_note' | 'voip_gateway' | 'channel_agent';
    status: 'idle' | 'verified' | 'error';
    statusMessage?: string;
  };
  discord: {
    enabled: boolean;
    botToken: string;
    guildId: string;
    channelId: string;
    targetUserId: string;
    callMode: 'voice_bridge' | 'direct_call' | 'audio_bot';
    status: 'idle' | 'verified' | 'error';
    statusMessage?: string;
  };
  messenger: {
    enabled: boolean;
    pageAccessToken: string;
    pageId: string;
    appSecret: string;
    verifyToken: string;
    recipientId: string;
    callMode: 'audio_message' | 'call_bridge' | 'two_way_agent';
    status: 'idle' | 'verified' | 'error';
    statusMessage?: string;
  };
  router: {
    autoAnswerPlatforms: boolean;
    groundWithRag: boolean;
    useTtsVoice: boolean;
  };
}

export interface PlatformActivityLogItem {
  id: string;
  platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord' | 'system';
  action: string;
  target?: string;
  message?: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed' | 'info';
}

const RAG_PRESETS: RagPreset[] = [
  {
    id: 'clinic',
    name: 'Clinic',
    outboundGreeting:
      'Hello! This is Hana calling from Mux Dental and Wellness Clinic regarding your appointment. Do you have a quick moment to pick a time that works for you?',
    inboundGreeting:
      'Thank you for calling Mux Dental and Wellness Clinic! My name is Hana. How may I help you today?',
    quickPhrases: [
      'How much is a routine checkup and cleaning?',
      'What are your hours and open slots this week?',
      'Do you accept Delta Dental insurance?',
      'Book me for Friday at 5:00 PM please.',
    ],
    content: `[CLINIC RAG KNOWLEDGE BASE]
Business Name: Mux Dental & Wellness Clinic
Hours: Mon-Fri 8:30 AM - 6:00 PM, Sat 9:00 AM - 2:00 PM.
Services & Pricing:
- Routine Checkup & Cleaning: $95 (45 min)
- Deep Cleaning & Fluoride: $150 (60 min)
- Laser Teeth Whitening: $220 (60 min)
Accepted Insurance: Delta Dental, MetLife, Cigna, Aetna, BlueCross.
Open Slots This Week:
- Tomorrow at 10:30 AM or 2:00 PM
- Thursday at 11:00 AM or 5:00 PM
- Friday at 2:00 PM or 5:00 PM
Instructions: Answer caller questions accurately from this text and confirm their preferred appointment slot.`,
  },
  {
    id: 'bistro',
    name: 'Restaurant',
    outboundGreeting:
      'Hi there! This is Hana calling from Mux Garden Bistro to confirm your table reservation. How many guests will be joining, and what time works best?',
    inboundGreeting:
      'Welcome to Mux Garden Bistro! This is Hana speaking. Would you like to reserve a table or ask about our menu?',
    quickPhrases: [
      'Do you have patio seating for 4 tomorrow at 7:00 PM?',
      'Do you have vegan and gluten-free options?',
      'What is your corkage fee?',
      'Reserve a patio table for 4 tomorrow at 7:00 PM.',
    ],
    content: `[RESTAURANT RAG KNOWLEDGE BASE]
Business Name: Mux Garden Bistro
Hours: Tue-Sun 11:30 AM - 10:30 PM. Closed Mondays.
Seating: Indoor Dining Room, Heated Sakura Patio, Private Chef's Counter ($85 tasting menu).
Policies:
- Full vegan, gluten-free, and nut-free menus available.
- Corkage fee: $25 per bottle.
Available Dinner Slots:
- Tomorrow: 6:00 PM, 7:00 PM, or 8:30 PM
- Friday & Saturday: 5:30 PM, 7:30 PM, or 9:00 PM`,
  },
  {
    id: 'sales',
    name: 'SaaS Demo',
    outboundGreeting:
      'Hello! This is Hana calling from MuxAI Technologies regarding your platform inquiry. Do you have a minute to chat or schedule a live demo?',
    inboundGreeting:
      'Thank you for calling MuxAI! This is Hana. Are you looking for pricing details or to schedule a live demo?',
    quickPhrases: [
      'How much is the Professional plan vs Starter?',
      'Do you support self-hosted on-premise deployment?',
      'Schedule a demo for Thursday at 2:00 PM.',
    ],
    content: `[SAAS SALES RAG KNOWLEDGE BASE]
Company: MuxAI Technologies
Product: Self-Hosted AI Voice & Agent Runtime.
Pricing:
- Starter: $49/mo (1 line, live RAG editor)
- Professional: $199/mo (5 lines, custom voice tuning)
- Enterprise: Custom (Unlimited lines, on-prem GPU, HIPAA/SOC2)
Demo Slots: Tue-Fri at 11:00 AM, 2:00 PM, or 4:00 PM EST.`,
  },
  {
    id: 'custom',
    name: 'Custom',
    outboundGreeting:
      'Hello! This is Hana calling regarding your inquiry. How can I help you today?',
    inboundGreeting:
      'Hello and thank you for calling! This is Hana speaking. How may I assist you today?',
    quickPhrases: [
      'What services and pricing do you offer?',
      'What time slots are available tomorrow?',
      'Can I book an appointment for tomorrow at 2:00 PM?',
    ],
    content: `[CUSTOM RAG KNOWLEDGE BASE]
Business Name: Your Business
Operating Hours: Mon-Fri 9:00 AM - 6:00 PM
Services & Pricing:
- Standard Consultation (30 min): $75
- Full Session (60 min): $150
Available Slots:
- Tomorrow at 10:00 AM, 2:00 PM, or 4:00 PM
Instructions: Answer questions using only the facts above and help the caller schedule an appointment.`,
  },
];

function toE164(rawPhone: string): string {
  const digits = (rawPhone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function playRingTone() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.4);
    osc2.stop(ctx.currentTime + 0.4);
  } catch {}
}

function synthesizeRagGroundedFallback(calleeInput: string, ragContent: string): string {
  const lower = calleeInput.toLowerCase();
  const lines = ragContent
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const bizLine = lines.find((l) => /^(business name|company):/i.test(l));
  const bizName = bizLine ? bizLine.replace(/^[^:]+:\s*/i, '').trim() : 'our office';

  if (/\b(no more questions|that'?s all|thank you|thanks|bye|goodbye)\b/i.test(lower) && !lower.includes('?')) {
    return `You are very welcome! Thank you for speaking with ${bizName}. Have a wonderful day!`;
  }

  if (/\b(confirm|book|schedule|reserve|lock in|works for me)\b/i.test(lower)) {
    const timeMatch = calleeInput.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const slotTime = timeMatch ? timeMatch[1].toUpperCase() : 'your requested time';
    return `Wonderful! I have confirmed your booking with ${bizName} for ${slotTime}. Do you have any other questions for me?`;
  }

  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'this', 'that', 'have', 'does', 'your', 'with',
    'from', 'about', 'would', 'could', 'please', 'can', 'you', 'the', 'and', 'for', 'are',
  ]);
  const queryWords = lower
    .replace(/[^a-z0-9\s$]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  const asksPrice = /\b(price|pricing|cost|charge|how much|fee|tier|plan|\$)\b/i.test(lower);
  const asksHours = /\b(hour|hours|open|time|when|schedule|available|slot|tomorrow|friday|thursday)\b/i.test(lower);

  const scoredLines = lines
    .filter((line) => !line.startsWith('[') && !line.endsWith(']'))
    .map((line) => {
      const lLower = line.toLowerCase();
      let score = 0;
      for (const qw of queryWords) {
        if (lLower.includes(qw)) score += 3;
      }
      if (asksPrice && (/\$|\bprice|\bcost|\bfee/i.test(line))) score += 4;
      if (asksHours && (/\b(am|pm|mon|tue|fri|sat|hours|tomorrow|thursday|slot)\b/i.test(line))) score += 4;
      return { line: line.replace(/^[-*•]\s*/, '').trim(), score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredLines.length > 0) {
    return `${scoredLines
      .slice(0, 2)
      .map((m) => m.line)
      .join(' Also, ')}. Would you like me to reserve a time slot for you?`;
  }

  const summary = lines
    .filter((l) => !l.startsWith('[') && l.includes(':'))
    .slice(0, 2)
    .join(' ');
  return `${summary || `At ${bizName}, we have openings this week.`} What day and time works best for you?`;
}

export const CallerPage: React.FC<CallerPageProps> = ({
  onNavigateHome,
  onNavigateToChat,
  onNavigateToDocs,
  activeModel: externalActiveModel,
  onSelectModel: externalOnSelectModel,
  cacheStatuses = {},
  ollamaStatus,
  onUpdateCustomUrl,
  userSettings,
  onUpdateSettings,
  activeOutfitFileName,
}) => {
  // ----------------------------------------------------
  // Reused /chat AI Model & Telemetry State
  // ----------------------------------------------------
  const [selectedCallerModel, setSelectedCallerModel] = useState<ModelSpec>(() => {
    try {
      const stored = localStorage.getItem('hana_caller_selected_model_v2');
      if (stored) {
        const found = getModelById(stored);
        if (found) return found;
      }
    } catch {}
    if (externalActiveModel && externalActiveModel.family !== 'browser-slm') {
      return externalActiveModel;
    }
    const gemini = getModelById('gemini-api');
    if (gemini) return gemini;
    return externalActiveModel || AVAILABLE_MODELS[0];
  });
  const activeModel = selectedCallerModel;

  const handleSelectModel = useCallback(
    (model: ModelSpec) => {
      setSelectedCallerModel(model);
      try {
        localStorage.setItem('hana_caller_selected_model_v2', model.id);
      } catch {}
      if (externalOnSelectModel) {
        externalOnSelectModel(model);
      }
      setTelemetry((prev) => ({
        ...prev,
        activeModelName: model.name,
        modelId: model.id,
        device:
          model.family === 'ollama'
            ? 'ollama'
            : model.family === 'api-provider'
            ? 'api-provider'
            : model.family === 'cloud'
            ? 'cloud'
            : prev.device,
      }));
    },
    [externalOnSelectModel]
  );

  const [localMaxTokens, setLocalMaxTokens] = useState<number>(
    userSettings?.maxTokens || 256
  );
  const maxTokens = userSettings?.maxTokens || localMaxTokens;
  const handleChangeMaxTokens = (val: number) => {
    setLocalMaxTokens(val);
    onUpdateSettings?.({ maxTokens: val });
  };

  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isTelemetryExpanded, setIsTelemetryExpanded] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TelemetryStats>({
    tokensPerSec: 0,
    timeToFirstTokenMs: 0,
    totalLatencyMs: 0,
    tokenCount: 0,
    device: 'webgpu',
    isGenerating: false,
    isModelLoaded: false,
    activeModelName: activeModel.name,
    modelId: activeModel.id,
    statusText: 'Ready',
  });

  // ----------------------------------------------------
  // 3rd-Party Platform Calling & Voice Integrations State
  // (WhatsApp Business, Telegram Voice, Facebook Messenger)
  // Stored in browser localStorage so inputs never reset on refresh.
  // ----------------------------------------------------
  const DEFAULT_PLATFORM_CREDS: PlatformCredentials = useMemo(
    () => ({
      whatsapp: {
        enabled: true,
        accessToken: '',
        phoneNumberId: '',
        wabaId: '',
        verifyToken: 'hana_wa_verify_2026',
        targetNumber: '',
        callMode: 'audio_note',
        status: 'idle',
      },
      telegram: {
        enabled: true,
        botToken: '',
        chatId: '',
        secretToken: 'hana_tg_secret_2026',
        callMode: 'voice_note',
        status: 'idle',
      },
      discord: {
        enabled: true,
        botToken: '',
        guildId: '',
        channelId: '',
        targetUserId: '',
        callMode: 'voice_bridge',
        status: 'idle',
      },
      messenger: {
        enabled: true,
        pageAccessToken: '',
        pageId: '',
        appSecret: '',
        verifyToken: 'hana_fb_verify_2026',
        recipientId: '',
        callMode: 'audio_message',
        status: 'idle',
      },
      router: {
        autoAnswerPlatforms: true,
        groundWithRag: true,
        useTtsVoice: true,
      },
    }),
    []
  );

  const [platformCreds, setPlatformCreds] = useState<PlatformCredentials>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEYS.PLATFORMS) ||
        localStorage.getItem('hana_caller_platforms_v1') ||
        localStorage.getItem('hana_caller_omnichannel_backup');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            whatsapp: {
              enabled: parsed.whatsapp?.enabled ?? true,
              accessToken: parsed.whatsapp?.accessToken || '',
              phoneNumberId: parsed.whatsapp?.phoneNumberId || '',
              wabaId: parsed.whatsapp?.wabaId || '',
              verifyToken: parsed.whatsapp?.verifyToken || 'hana_wa_verify_2026',
              targetNumber: parsed.whatsapp?.targetNumber || '',
              callMode: parsed.whatsapp?.callMode || 'audio_note',
              status: parsed.whatsapp?.status || 'idle',
              statusMessage: parsed.whatsapp?.statusMessage,
            },
            telegram: {
              enabled: parsed.telegram?.enabled ?? true,
              botToken: parsed.telegram?.botToken || '',
              chatId: parsed.telegram?.chatId || '',
              secretToken: parsed.telegram?.secretToken || 'hana_tg_secret_2026',
              callMode: parsed.telegram?.callMode || 'voice_note',
              status: parsed.telegram?.status || 'idle',
              statusMessage: parsed.telegram?.statusMessage,
            },
            discord: {
              enabled: parsed.discord?.enabled ?? true,
              botToken: parsed.discord?.botToken || '',
              guildId: parsed.discord?.guildId || '',
              channelId: parsed.discord?.channelId || '',
              targetUserId: parsed.discord?.targetUserId || '',
              callMode: parsed.discord?.callMode || 'voice_bridge',
              status: parsed.discord?.status || 'idle',
              statusMessage: parsed.discord?.statusMessage,
            },
            messenger: {
              enabled: parsed.messenger?.enabled ?? true,
              pageAccessToken: parsed.messenger?.pageAccessToken || '',
              pageId: parsed.messenger?.pageId || '',
              appSecret: parsed.messenger?.appSecret || '',
              verifyToken: parsed.messenger?.verifyToken || 'hana_fb_verify_2026',
              recipientId: parsed.messenger?.recipientId || '',
              callMode: parsed.messenger?.callMode || 'audio_message',
              status: parsed.messenger?.status || 'idle',
              statusMessage: parsed.messenger?.statusMessage,
            },
            router: {
              autoAnswerPlatforms: parsed.router?.autoAnswerPlatforms ?? true,
              groundWithRag: parsed.router?.groundWithRag ?? true,
              useTtsVoice: parsed.router?.useTtsVoice ?? true,
            },
          };
        }
      }
    } catch (e) {
      console.warn('Failed to parse platform credentials:', e);
    }
    return {
      whatsapp: {
        enabled: true,
        accessToken: '',
        phoneNumberId: '',
        wabaId: '',
        verifyToken: 'hana_wa_verify_2026',
        targetNumber: '',
        callMode: 'audio_note',
        status: 'idle',
      },
      telegram: {
        enabled: true,
        botToken: '',
        chatId: '',
        secretToken: 'hana_tg_secret_2026',
        callMode: 'voice_note',
        status: 'idle',
      },
      discord: {
        enabled: true,
        botToken: '',
        guildId: '',
        channelId: '',
        targetUserId: '',
        callMode: 'voice_bridge',
        status: 'idle',
      },
      messenger: {
        enabled: true,
        pageAccessToken: '',
        pageId: '',
        appSecret: '',
        verifyToken: 'hana_fb_verify_2026',
        recipientId: '',
        callMode: 'audio_message',
        status: 'idle',
      },
      router: {
        autoAnswerPlatforms: true,
        groundWithRag: true,
        useTtsVoice: true,
      },
    };
  });

  // Synchronous updater that guarantees immediate browser storage persistence on every change
  const handleUpdatePlatformCreds = useCallback(
    (updater: (prev: PlatformCredentials) => PlatformCredentials) => {
      setPlatformCreds((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        try {
          const serialized = JSON.stringify(next);
          localStorage.setItem(STORAGE_KEYS.PLATFORMS, serialized);
          localStorage.setItem('hana_caller_omnichannel_backup', serialized);
          if (next.discord?.botToken?.trim()) {
            localStorage.setItem('discord_bot_token', next.discord.botToken.trim().replace(/^Bot\s+/i, ''));
          }
        } catch (e) {
          console.warn('Failed to persist platform credentials:', e);
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    try {
      const serialized = JSON.stringify(platformCreds);
      localStorage.setItem(STORAGE_KEYS.PLATFORMS, serialized);
      localStorage.setItem('hana_caller_omnichannel_backup', serialized);
    } catch {}
  }, [platformCreds]);

  // Flush credentials immediately on page reload or navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const serialized = JSON.stringify(platformCreds);
        localStorage.setItem(STORAGE_KEYS.PLATFORMS, serialized);
        localStorage.setItem('hana_caller_omnichannel_backup', serialized);
      } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [platformCreds]);

  const [showSecrets, setShowSecrets] = useState<{
    waToken?: boolean;
    tgToken?: boolean;
    fbToken?: boolean;
    fbSecret?: boolean;
  }>({});

  const [testingPlatform, setTestingPlatform] = useState<string | null>(null);
  const [dispatchingPlatform, setDispatchingPlatform] = useState<string | null>(null);
  const [copiedPlatformWebhook, setCopiedPlatformWebhook] = useState<string | null>(null);
  const [savedPlatformNotice, setSavedPlatformNotice] = useState<boolean>(false);

  // Active 3rd-party omnichannel call state (Telegram, Discord, WhatsApp, Messenger)
  const [activePlatformCall, setActivePlatformCall] = useState<{
    platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord';
    target: string;
    botToken?: string;
    channelId?: string;
  } | null>(null);
  const activePlatformCallRef = useRef(activePlatformCall);
  useEffect(() => {
    activePlatformCallRef.current = activePlatformCall;
  }, [activePlatformCall]);

  // Frontend audio monitoring toggle (default false: omnichannel calls send voice to receiving end, not local speakers)
  const [frontendMonitorAudio, setFrontendMonitorAudio] = useState<boolean>(false);
  const frontendMonitorAudioRef = useRef(frontendMonitorAudio);
  useEffect(() => {
    frontendMonitorAudioRef.current = frontendMonitorAudio;
  }, [frontendMonitorAudio]);

  // Real-time Discord Gateway connection state
  const [discordGatewayStatus, setDiscordGatewayStatus] = useState<{
    status: 'connected' | 'disconnected' | 'polling' | 'error';
    message: string;
    botUser?: { id: string; username: string } | null;
  }>({
    status: 'disconnected',
    message: 'Gateway idle',
  });

  // Subscribe to discordBotRunner status updates
  useEffect(() => {
    const unsub = discordBotRunner.subscribe((status, message, botUser) => {
      setDiscordGatewayStatus({ status, message, botUser });
    });
    return unsub;
  }, []);

  // Auto-connect Discord Bot when token is available so it stays active & online immediately
  useEffect(() => {
    const token = platformCreds.discord.botToken?.trim();
    if (token && token.length > 20 && platformCreds.discord.enabled !== false) {
      discordBotRunner.start(
        {
          id: 'caller_discord_session',
          platform: 'discord',
          name: 'Discord Bot',
          botToken: token,
          channelId: platformCreds.discord.channelId,
          guildId: platformCreds.discord.guildId,
          enabled: true,
          status: 'polling',
        },
        (status, message) => {
          setDiscordGatewayStatus({
            status,
            message,
            botUser: discordBotRunner.getBotUser(),
          });
          if (status === 'connected') {
            setPlatformCreds((prev) => ({
              ...prev,
              discord: {
                ...prev.discord,
                status: 'verified',
                statusMessage: message,
              },
            }));
          }
        }
      );
    }
  }, [
    platformCreds.discord.botToken,
    platformCreds.discord.enabled,
    platformCreds.discord.channelId,
    platformCreds.discord.guildId,
  ]);

  // Discord Voice Channel state (for direct Voice Channel audio streaming)
  const [discordVoiceState, setDiscordVoiceState] = useState<{
    connected: boolean;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    isSpeaking?: boolean;
    isVoiceChannel?: boolean;
  }>({ connected: false });
  const [isJoiningDiscordVc, setIsJoiningDiscordVc] = useState<boolean>(false);

  const handleJoinDiscordVoiceChannel = useCallback(async () => {
    const cfg = platformCreds.discord;
    const token = cfg.botToken?.trim().replace(/^Bot\s+/i, '');
    const channelId = cfg.channelId?.trim();
    if (!token || !channelId) {
      alert('Please enter your Discord Bot Token and target Channel ID first.');
      return;
    }

    setIsJoiningDiscordVc(true);
    try {
      const resp = await fetch('/api/caller/discord/join-vc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token, channelId, guildId: cfg.guildId }),
      });
      const data = await resp.json();
      if (data.ok) {
        setDiscordVoiceState({
          connected: true,
          channelId: data.channelId,
          channelName: data.channelName,
          guildId: data.guildId,
          isSpeaking: false,
          isVoiceChannel: true,
        });
        if (data.guildId) {
          discordBotRunner.joinVoiceChannel(data.guildId, channelId);
        }
        setPlatformActivityLog((prev) => [
          {
            id: `act_${Date.now()}`,
            platform: 'discord',
            action: 'Joined Voice Channel',
            message: `Connected to Voice Channel #${data.channelName || channelId}. Ready to stream audio directly into voice call!`,
            timestamp: new Date().toLocaleTimeString(),
            status: 'success',
          },
          ...prev,
        ]);
      } else {
        alert(data.error || 'Failed to join voice channel');
      }
    } catch (err: any) {
      alert(err.message || 'Error joining voice channel');
    } finally {
      setIsJoiningDiscordVc(false);
    }
  }, [platformCreds.discord]);

  const handleLeaveDiscordVoiceChannel = useCallback(async () => {
    const cfg = platformCreds.discord;
    const token = cfg.botToken?.trim().replace(/^Bot\s+/i, '');
    const channelId = discordVoiceState.channelId || cfg.channelId?.trim();
    const guildId = discordVoiceState.guildId || cfg.guildId?.trim();
    if (!token) return;

    try {
      await fetch('/api/caller/discord/leave-vc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token, guildId, channelId }),
      });
      if (guildId) {
        discordBotRunner.leaveVoiceChannel(guildId);
      }
      setDiscordVoiceState({ connected: false });
      setPlatformActivityLog((prev) => [
        {
          id: `act_${Date.now()}`,
          platform: 'discord',
          action: 'Left Voice Channel',
          message: 'Disconnected from Discord voice channel.',
          timestamp: new Date().toLocaleTimeString(),
          status: 'info',
        },
        ...prev,
      ]);
    } catch {}
  }, [discordVoiceState, platformCreds.discord]);

  const handleConnectDiscord = useCallback(async () => {
    const cfg = platformCreds.discord;
    const token = cfg.botToken?.trim().replace(/^Bot\s+/i, '');
    if (!token) {
      alert('Please enter your Discord Bot Token first.');
      return;
    }

    // 1. Keep bot active & online on the server
    fetch('/api/caller/platforms/keep-bot-online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'discord', botToken: token }),
    }).catch(() => {});

    // 2. Connect client-side Discord Gateway runner
    discordBotRunner.start(
      {
        id: 'caller_discord_session',
        platform: 'discord',
        name: 'Discord Bot',
        botToken: token,
        channelId: cfg.channelId,
        guildId: cfg.guildId,
        enabled: true,
        status: 'polling',
      },
      (status, message) => {
        setDiscordGatewayStatus({
          status,
          message,
          botUser: discordBotRunner.getBotUser(),
        });
        if (status === 'connected') {
          setPlatformCreds((prev) => ({
            ...prev,
            discord: {
              ...prev.discord,
              status: 'verified',
              statusMessage: message,
            },
          }));
        }
      }
    );
  }, [platformCreds.discord]);

  const [platformActivityLog, setPlatformActivityLog] = useState<PlatformActivityLogItem[]>([
    {
      id: 'init_1',
      platform: 'system',
      action: 'Platform Switchboard Active',
      message: 'Ready to bridge WhatsApp Cloud API, Telegram Voice Gateway, and Messenger calling.',
      timestamp: '00:00',
      status: 'info',
    },
  ]);

  // ----------------------------------------------------
  // Self-Hosted WebRTC PBX Line & Dialer State (Zero External APIs)
  // ----------------------------------------------------
  const [myLineNumber, setMyLineNumber] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MY_LINE);
      if (saved) return saved;
    } catch {}
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `+1 (555) 840-${rand}`;
  });

  const [phoneNumber, setPhoneNumber] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const callTo = params.get('callTo');
      if (callTo) return callTo;
    }
    try {
      return localStorage.getItem(STORAGE_KEYS.TARGET_PHONE) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MY_LINE, myLineNumber);
    } catch {}
  }, [myLineNumber]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TARGET_PHONE, phoneNumber);
    } catch {}
  }, [phoneNumber]);

  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const callStatusRef = useRef<CallStatus>('idle');
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const [callDirection, setCallDirection] = useState<CallDirection>('outbound');
  const [autoAnswerIncoming, setAutoAnswerIncoming] = useState<boolean>(true);
  const autoAnswerRef = useRef<boolean>(true);
  useEffect(() => {
    autoAnswerRef.current = autoAnswerIncoming;
  }, [autoAnswerIncoming]);

  const [useNativeCarrierBridge, setUseNativeCarrierBridge] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const [activePbxCallId, setActivePbxCallId] = useState<string | null>(null);
  const activePbxCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    activePbxCallIdRef.current = activePbxCallId;
  }, [activePbxCallId]);

  const [incomingPbxOffer, setIncomingPbxOffer] = useState<{
    callId: string;
    fromNumber: string;
    offerSdp?: any;
  } | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const processedMsgIdsRef = useRef<Set<string>>(new Set());

  const [callSeconds, setCallSeconds] = useState<number>(0);
  const callSecondsRef = useRef<number>(0);
  useEffect(() => {
    callSecondsRef.current = callSeconds;
  }, [callSeconds]);

  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const isMicMutedRef = useRef<boolean>(false);
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !isMicMuted;
      });
    }
  }, [isMicMuted]);

  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const isSpeakerMutedRef = useRef<boolean>(false);
  useEffect(() => {
    isSpeakerMutedRef.current = isSpeakerMuted;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = isSpeakerMuted;
    }
  }, [isSpeakerMuted]);

  // ----------------------------------------------------
  // Special Editable RAG Knowledge Base State
  // ----------------------------------------------------
  const [selectedRagPresetId, setSelectedRagPresetId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.RAG_PRESET) || 'clinic';
    } catch {
      return 'clinic';
    }
  });

  const [ragText, setRagText] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RAG_TEXT);
      if (saved && saved.trim()) return saved;
    } catch {}
    return RAG_PRESETS[0].content;
  });
  const ragTextRef = useRef<string>(ragText);
  useEffect(() => {
    ragTextRef.current = ragText;
    try {
      localStorage.setItem(STORAGE_KEYS.RAG_TEXT, ragText);
    } catch {}
  }, [ragText]);

  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);

  const currentPreset = useMemo(
    () => RAG_PRESETS.find((p) => p.id === selectedRagPresetId) || RAG_PRESETS[0],
    [selectedRagPresetId]
  );

  // ----------------------------------------------------
  // 3D Avatar & Voice Synthesis State
  // ----------------------------------------------------
  const [avatarEmotion, setAvatarEmotion] = useState<AvatarEmotion>('neutral');
  const [hanaIsSpeaking, setHanaIsSpeaking] = useState<boolean>(false);
  const hanaIsSpeakingRef = useRef<boolean>(false);
  const speechCooldownUntilRef = useRef<number>(0);
  const currentSpokenTextRef = useRef<string>('');

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

  // ----------------------------------------------------
  // Live 2-Way Call Transcript & Continuous STT State
  // ----------------------------------------------------
  const [silenceProgress, setSilenceProgress] = useState<{ id: number; durationMs: number } | null>(
    null
  );
  const [transcript, setTranscript] = useState<CallTranscriptMessage[]>([]);
  const transcriptRef = useRef<CallTranscriptMessage[]>(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const [streamingAgentText, setStreamingAgentText] = useState<string>('');
  const [currentCalleeInput, setCurrentCalleeInput] = useState<string>('');
  const [liveInterimSpeech, setLiveInterimSpeech] = useState<string>('');
  const accumulatedSttRef = useRef<string>('');
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const isAiGeneratingRef = useRef<boolean>(false);
  useEffect(() => {
    isAiGeneratingRef.current = isAiGenerating;
  }, [isAiGenerating]);

  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState<boolean>(false);

  const callTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ringTimerRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pbxPollRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  const outfitFileName = useMemo(() => {
    if (activeOutfitFileName) return activeOutfitFileName;
    return getOutfitById(DEFAULT_OUTFIT_ID).fileName;
  }, [activeOutfitFileName]);

  const formatCallTime = useCallback((secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  // Preload persona voice
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      waitForPersonaVoice(1500).catch(() => {});
    }
  }, []);

  // Call duration timer
  useEffect(() => {
    if (
      callStatus === 'connected' ||
      callStatus === 'speaking' ||
      callStatus === 'listening'
    ) {
      callTimerRef.current = setInterval(() => {
        setCallSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    }
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, [callStatus]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript, streamingAgentText, liveInterimSpeech]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCurrentGeneration();
      window.speechSynthesis?.cancel();
      lipSyncManager.endSpeech();
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (pbxPollRef.current) clearInterval(pbxPollRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {}
      try {
        peerConnectionRef.current?.close();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  // ----------------------------------------------------
  // WebRTC PeerConnection Helper (Zero External APIs)
  // ----------------------------------------------------
  const setupWebRtcPeer = useCallback(async (role: 'caller' | 'callee', callId: string) => {
    try {
      peerConnectionRef.current?.close();
    } catch {}

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    peerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        fetch('/api/caller/pbx/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId,
            role,
            candidate: e.candidate,
          }),
        }).catch(() => {});
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current && e.streams[0]) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } catch {
      // Continue with SpeechSynthesis + SpeechRecognition PBX signaling even if raw mic stream is busy
    }

    return pc;
  }, []);

  // ----------------------------------------------------
  // 2-Way Voice Synthesis Engine (Hana TTS with Lip-Sync)
  // ----------------------------------------------------
  const speakAgentVoice = useCallback(
    async (
      text: string,
      onDone?: () => void,
      options?: { silentVisualOnly?: boolean }
    ): Promise<void> => {
      const cleanText = text
        .replace(/[*#`_~]+/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) {
        if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
          setCallStatus('listening');
        }
        onDone?.();
        return;
      }

      // Check whether to suppress frontend browser audio speaker output:
      // Omnichannel options send voice to receiving end (Discord, Telegram, WhatsApp, Messenger), not web frontend!
      const isOmnichannelCall = Boolean(activePlatformCallRef.current);
      const isSilentVisual = Boolean(options?.silentVisualOnly || (isOmnichannelCall && !frontendMonitorAudioRef.current));

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setSilenceProgress(null);

      try {
        window.speechSynthesis?.cancel();
      } catch {}

      hanaIsSpeakingRef.current = true;
      setHanaIsSpeaking(true);
      currentSpokenTextRef.current = cleanText;
      if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
        setCallStatus('speaking');
      }

      try {
        recognitionRef.current?.stop();
      } catch {}

      detectEmotionForResponse(cleanText)
        .then((emo) => setAvatarEmotion(emo))
        .catch(() => setAvatarEmotion('neutral'));

      // If silent visual mode is active (omnichannel call):
      // The voice was sent to the remote receiver (Discord, Telegram, WhatsApp, etc.).
      // The web frontend animates the 3D avatar lips & subtitles visually without playing local audio!
      if (isSilentVisual || isSpeakerMutedRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return new Promise((resolve) => {
          const words = cleanText.split(/\s+/).filter(Boolean);
          let currentWordIndex = 0;
          const wordIntervalMs = 240;

          setSubtitleState({
            isActive: true,
            text: cleanText,
            charIndex: 0,
            currentWord: words[0] || '',
          });

          lipSyncManager.startSpeech(cleanText);

          let finished = false;
          let visualTimer: any = null;

          const finishSpeech = () => {
            if (finished) return;
            finished = true;
            if (visualTimer) clearInterval(visualTimer);
            lipSyncManager.endSpeech();
            hanaIsSpeakingRef.current = false;
            setHanaIsSpeaking(false);
            setSubtitleState((prev) => ({ ...prev, isActive: false }));

            speechCooldownUntilRef.current = Date.now() + 850;

            if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
              setCallStatus('listening');
              if (!isMicMutedRef.current) {
                setTimeout(() => {
                  if (
                    !hanaIsSpeakingRef.current &&
                    callStatusRef.current !== 'idle' &&
                    callStatusRef.current !== 'ended' &&
                    !isMicMutedRef.current
                  ) {
                    try {
                      recognitionRef.current?.start();
                    } catch {}
                  }
                }, 900);
              }
            }

            onDone?.();
            resolve();
          };

          visualTimer = setInterval(() => {
            if (finished) return;
            if (currentWordIndex < words.length) {
              const word = words[currentWordIndex];
              lipSyncManager.onBoundary(word);
              setSubtitleState({
                isActive: true,
                text: cleanText,
                charIndex: currentWordIndex,
                currentWord: word,
              });
              currentWordIndex++;
            } else {
              finishSpeech();
            }
          }, wordIntervalMs);

          const maxDurationMs = Math.max(2500, (words.length / 2.2) * 1000 + 1800);
          setTimeout(() => {
            if (!finished) finishSpeech();
          }, maxDurationMs);
        });
      }

      const personaVoice = await waitForPersonaVoice(1000);
      const matchedVoice = personaVoice || getPersonaVoice();

      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        if (matchedVoice) {
          utterance.voice = matchedVoice;
        }
        utterance.rate = VOICE_CONFIG.rate || 1.05;
        utterance.pitch = VOICE_CONFIG.pitch || 1.12;
        utterance.volume = 1.0;

        setSubtitleState({
          isActive: true,
          text: cleanText,
          charIndex: 0,
          currentWord: cleanText.split(/\s+/)[0] || '',
        });

        utterance.onboundary = (event: SpeechSynthesisEvent) => {
          if (event.name === 'word' || typeof event.charIndex === 'number') {
            const idx = event.charIndex || 0;
            const rest = cleanText.slice(idx);
            const wordMatch = rest.match(/^[^\s.,!?;:]+/);
            const word = wordMatch ? wordMatch[0] : '';
            lipSyncManager.onBoundary(word);
            setSubtitleState({
              isActive: true,
              text: cleanText,
              charIndex: idx,
              currentWord: word,
            });
          }
        };

        let finished = false;
        const finishSpeech = () => {
          if (finished) return;
          finished = true;
          lipSyncManager.endSpeech();
          hanaIsSpeakingRef.current = false;
          setHanaIsSpeaking(false);
          setSubtitleState((prev) => ({ ...prev, isActive: false }));

          speechCooldownUntilRef.current = Date.now() + 850;

          if (callStatusRef.current !== 'idle' && callStatusRef.current !== 'ended') {
            setCallStatus('listening');
            if (!isMicMutedRef.current) {
              setTimeout(() => {
                if (
                  !hanaIsSpeakingRef.current &&
                  callStatusRef.current !== 'idle' &&
                  callStatusRef.current !== 'ended' &&
                  !isMicMutedRef.current
                ) {
                  try {
                    recognitionRef.current?.start();
                  } catch {}
                }
              }, 900);
            }
          }

          onDone?.();
          resolve();
        };

        utterance.onend = () => finishSpeech();
        utterance.onerror = () => finishSpeech();

        const wordCount = cleanText.split(/\s+/).length;
        const maxDurationMs = Math.max(3000, (wordCount / 2.2) * 1000 + 2500);
        setTimeout(() => {
          if (hanaIsSpeakingRef.current && currentSpokenTextRef.current === cleanText) {
            finishSpeech();
          }
        }, maxDurationMs);

        lipSyncManager.startSpeech(cleanText);
        try {
          window.speechSynthesis.resume();
        } catch {}
        window.speechSynthesis.speak(utterance);
      });
    },
    []
  );

  const handleInterruptSpeech = () => {
    window.speechSynthesis?.cancel();
    lipSyncManager.endSpeech();
    hanaIsSpeakingRef.current = false;
    setHanaIsSpeaking(false);
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    if (callStatus !== 'idle' && callStatus !== 'ended') {
      setCallStatus('listening');
    }
  };

  // ----------------------------------------------------
  // Submit Caller Speech/Text -> Active /chat LLM with RAG -> Speak Reply
  // ----------------------------------------------------
  const handleSendCalleeInput = useCallback(
    async (inputText: string, fromRemotePbx = false) => {
      const trimmed = inputText.trim();
      if (!trimmed || isAiGeneratingRef.current) return;

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setSilenceProgress(null);

      if (callStatusRef.current === 'idle' || callStatusRef.current === 'ended') {
        setCallStatus('connected');
      }

      soundManager.playSend();

      const msgId = `msg_callee_${Date.now()}`;
      processedMsgIdsRef.current.add(msgId);

      const userMessage: CallTranscriptMessage = {
        id: msgId,
        sender: 'callee',
        text: trimmed,
        timestamp: formatCallTime(callSecondsRef.current),
      };

      const updatedTranscript = [...transcriptRef.current, userMessage];
      setTranscript(updatedTranscript);
      setCurrentCalleeInput('');
      setLiveInterimSpeech('');
      accumulatedSttRef.current = '';

      // Relay caller message to self-hosted PBX session if active
      if (!fromRemotePbx && activePbxCallIdRef.current) {
        fetch('/api/caller/pbx/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: activePbxCallIdRef.current,
            id: msgId,
            sender: 'callee',
            fromNumber: phoneNumber || myLineNumber,
            text: trimmed,
            timestamp: userMessage.timestamp,
          }),
        }).catch(() => {});
      }

      setIsAiGenerating(true);
      isAiGeneratingRef.current = true;
      setStreamingAgentText('');

      setTelemetry((prev) => ({
        ...prev,
        isGenerating: true,
        tokensPerSec: 0,
        timeToFirstTokenMs: 0,
        totalLatencyMs: 0,
        tokenCount: 0,
        statusText: 'Formulating RAG phone reply...',
      }));

      const ragSystemPrompt = [
        `You are Hana, a warm, natural-sounding AI voice receptionist and autonomous phone agent on a live telephone call (${phoneNumber || myLineNumber}).`,
        `CRITICAL RULE: Answer the called person's questions and schedule appointments using ONLY the facts, prices, hours, and slots in the Special Editable RAG Knowledge Base below:`,
        `=== SPECIAL EDITABLE RAG KNOWLEDGE BASE ===`,
        ragTextRef.current,
        `=== END RAG KNOWLEDGE BASE ===`,
        `Keep your spoken reply concise (1 to 3 sentences maximum, plain text only, no markdown or bullet points) so it sounds natural when spoken aloud over the phone.`,
      ].join('\n');

      const chatHistory: Message[] = updatedTranscript.slice(-8).map((m) => ({
        id: m.id,
        role: m.sender === 'agent' ? 'assistant' : 'user',
        content: m.text,
        timestamp: Date.now(),
      }));

      let finalReply = '';
      let latestStats: {
        ttftMs: number;
        tokensPerSec: number;
        totalMs: number;
        tokenCount: number;
        device: HardwareDevice;
      } | null = null;

      let actualModelUsed = activeModel.name;

      const isUncachedBrowserSlm =
        activeModel.family === 'browser-slm' &&
        !cacheStatuses[activeModel.hfRepo]?.downloaded;

      // Only attempt browser SLM if it's already downloaded/cached; otherwise avoid freezing
      // during a live phone call and connect directly to live server Gemini AI!
      if (!isUncachedBrowserSlm) {
        try {
          const llmOutput = await streamPersonaResponse({
            model: activeModel,
            history: chatHistory.slice(0, -1),
            userMessage: trimmed,
            devicePref: userSettings?.preferredDevice || 'auto',
            maxTokens: Math.min(maxTokens || 256, 320),
            customSystemPrompt: ragSystemPrompt,
            onToken: (_piece, fullText) => {
              setStreamingAgentText(fullText);
            },
            onTelemetry: (stats) => {
              latestStats = stats;
              setTelemetry((prev) => ({
                ...prev,
                tokensPerSec: stats.tokensPerSec,
                timeToFirstTokenMs: stats.ttftMs,
                totalLatencyMs: stats.totalMs,
                tokenCount: stats.tokenCount,
                device: stats.device,
              }));
            },
            onProgress: (prog) => {
              setDownloadProgress(prog);
            },
          });

          if (llmOutput && llmOutput.trim().length >= 4) {
            finalReply = llmOutput
              .replace(/[*#`_~]+/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          }
        } catch (llmErr) {
          console.warn('Selected LLM stream had issue, invoking server Gemini AI fallback...', llmErr);
        }
      }

      // If the selected model (e.g. uncached browser SLM or provider) didn't return text,
      // seamlessly query the live server-side Gemini 3.1 Flash Lite AI model so a real LLM reply is ALWAYS generated!
      if (!finalReply || finalReply.trim().length < 4) {
        try {
          const startTime = performance.now();
          const serverResp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                ...chatHistory.slice(-8).map((m) => ({ role: m.role, content: m.content })),
                { role: 'user', content: trimmed },
              ],
              systemPrompt: ragSystemPrompt,
              maxTokens: Math.min(maxTokens || 256, 320),
            }),
          });

          if (serverResp.ok && serverResp.body) {
            const reader = serverResp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let serverText = '';
            let tokenCount = 0;
            let firstTokenTime: number | null = null;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('data: ')) {
                  const rawJson = trimmedLine.slice(6).trim();
                  if (rawJson === '[DONE]' || rawJson === '{"done":true}') continue;
                  try {
                    const data = JSON.parse(rawJson);
                    if (data.text) {
                      if (firstTokenTime === null) firstTokenTime = performance.now();
                      tokenCount++;
                      serverText += data.text;
                      setStreamingAgentText(serverText);

                      const now = performance.now();
                      const elapsed = (now - startTime) / 1000;
                      const tps = elapsed > 0 ? Math.round((tokenCount / elapsed) * 10) / 10 : 0;
                      latestStats = {
                        ttftMs: firstTokenTime ? Math.round(firstTokenTime - startTime) : 0,
                        tokensPerSec: tps,
                        totalMs: Math.round(now - startTime),
                        tokenCount,
                        device: 'cloud',
                      };
                      setTelemetry((prev) => ({
                        ...prev,
                        tokensPerSec: tps,
                        timeToFirstTokenMs: latestStats?.ttftMs || 0,
                        totalLatencyMs: latestStats?.totalMs || 0,
                        tokenCount,
                        device: 'cloud',
                      }));
                    }
                  } catch {}
                }
              }
            }

            if (serverText.trim().length >= 4) {
              finalReply = serverText
                .replace(/[*#`_~]+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              actualModelUsed = 'Gemini 3.1 Flash Lite';
            }
          }
        } catch (serverErr) {
          console.error('Server Gemini AI fallback error:', serverErr);
        }
      }

      // Offline emergency fallback only if device is strictly disconnected from the network
      if (!finalReply || finalReply.length < 5) {
        finalReply = synthesizeRagGroundedFallback(trimmed, ragTextRef.current);
        actualModelUsed = 'Offline RAG Fallback';
      }

      setStreamingAgentText('');
      setDownloadProgress(null);
      setIsAiGenerating(false);
      isAiGeneratingRef.current = false;

      setTelemetry((prev) => ({
        ...prev,
        ...(latestStats
          ? {
              tokensPerSec: latestStats.tokensPerSec,
              timeToFirstTokenMs: latestStats.ttftMs,
              totalLatencyMs: latestStats.totalMs,
              tokenCount: latestStats.tokenCount,
              device: latestStats.device,
            }
          : {}),
        isGenerating: false,
        statusText: 'Ready',
      }));

      const agentMsgId = `msg_agent_${Date.now()}`;
      processedMsgIdsRef.current.add(agentMsgId);

      const agentMessage: CallTranscriptMessage = {
        id: agentMsgId,
        sender: 'agent',
        text: finalReply,
        timestamp: formatCallTime(callSecondsRef.current),
        modelUsed: actualModelUsed,
      };

      setTranscript((prev) => [...prev, agentMessage]);
      soundManager.playReceive();

      // Relay Hana's spoken reply to self-hosted PBX so remote caller handset hears/sees it
      if (activePbxCallIdRef.current) {
        fetch('/api/caller/pbx/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: activePbxCallIdRef.current,
            id: agentMsgId,
            sender: 'agent',
            fromNumber: myLineNumber,
            text: finalReply,
            timestamp: agentMessage.timestamp,
            modelUsed: actualModelUsed,
          }),
        }).catch(() => {});
      }

      // Relay Hana's spoken reply to active 3rd-party platform (Telegram or Discord)
      if (activePlatformCallRef.current) {
        fetch('/api/caller/platforms/relay-reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: activePlatformCallRef.current.platform,
            target: activePlatformCallRef.current.target,
            botToken: activePlatformCallRef.current.botToken,
            text: finalReply,
          }),
        }).catch(() => {});
      }

      await speakAgentVoice(finalReply, undefined, {
        silentVisualOnly: Boolean(activePlatformCallRef.current && !frontendMonitorAudioRef.current),
      });
    },
    [
      activeModel,
      formatCallTime,
      maxTokens,
      myLineNumber,
      phoneNumber,
      speakAgentVoice,
      userSettings?.preferredDevice,
    ]
  );

  // ----------------------------------------------------
  // 3rd-Party Platform Actions & Testing
  // ----------------------------------------------------
  const handleTestPlatform = async (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => {
    setTestingPlatform(platform);
    try {
      const cfg = platformCreds[platform];

      // If Discord, ensure DiscordBotRunner connects immediately to keep bot online
      if (platform === 'discord' && platformCreds.discord.botToken?.trim()) {
        const discToken = platformCreds.discord.botToken.trim();
        discordBotRunner.start(
          {
            id: 'caller_discord_session',
            platform: 'discord',
            name: 'Discord Bot',
            botToken: discToken,
            channelId: platformCreds.discord.channelId,
            guildId: platformCreds.discord.guildId,
            enabled: true,
            status: 'polling',
          },
          (status, message) => {
            setDiscordGatewayStatus({
              status,
              message,
              botUser: discordBotRunner.getBotUser(),
            });
          }
        );
      }

      const resp = await fetch('/api/caller/platforms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, config: cfg, credentials: cfg }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.ok) {
        setPlatformCreds((prev) => ({
          ...prev,
          [platform]: {
            ...prev[platform],
            status: 'verified',
            statusMessage: 'Verified & Connected',
          },
        }));
        setPlatformActivityLog((prev) => [
          {
            id: `act_${Date.now()}`,
            platform,
            action: 'Connection Verified',
            message: `Successfully authenticated with ${platform.toUpperCase()} API (${data.details?.verifiedName || data.details?.username || 'Active'}).`,
            timestamp: new Date().toLocaleTimeString(),
            status: 'success',
          },
          ...prev,
        ]);
      } else {
        setPlatformCreds((prev) => ({
          ...prev,
          [platform]: {
            ...prev[platform],
            status: 'error',
            statusMessage: data?.error || 'Verification failed',
          },
        }));
        setPlatformActivityLog((prev) => [
          {
            id: `act_${Date.now()}`,
            platform,
            action: 'Connection Error',
            message: data?.error || 'Verification failed. Please check tokens and IDs.',
            timestamp: new Date().toLocaleTimeString(),
            status: 'failed',
          },
          ...prev,
        ]);
      }
    } catch (err: any) {
      setPlatformCreds((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          status: 'error',
          statusMessage: err?.message || 'Network error',
        },
      }));
    } finally {
      setTestingPlatform(null);
    }
  };

  const handleDispatchPlatformCall = async (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => {
    setDispatchingPlatform(platform);
    try {
      const cfg = platformCreds[platform];
      const target =
        platform === 'whatsapp'
          ? platformCreds.whatsapp.targetNumber
          : platform === 'telegram'
          ? platformCreds.telegram.chatId
          : platform === 'discord'
          ? platformCreds.discord.channelId || platformCreds.discord.targetUserId
          : platformCreds.messenger.recipientId;

      if (!target) {
        alert(`Please enter the target destination for ${platform.toUpperCase()}`);
        return;
      }

      // If Discord call, activate DiscordBotRunner immediately so bot shows green ONLINE status
      if (platform === 'discord' && platformCreds.discord.botToken?.trim()) {
        const discToken = platformCreds.discord.botToken.trim();
        discordBotRunner.start(
          {
            id: 'caller_discord_session',
            platform: 'discord',
            name: 'Discord Bot',
            botToken: discToken,
            channelId: platformCreds.discord.channelId,
            guildId: platformCreds.discord.guildId,
            enabled: true,
            status: 'polling',
          },
          (status, message) => {
            setDiscordGatewayStatus({
              status,
              message,
              botUser: discordBotRunner.getBotUser(),
            });
          }
        );
      }

      const greeting =
        currentPreset.outboundGreeting ||
        `Hello! This is Hana AI voice agent calling regarding your appointment. How may I assist you today?`;

      // 1. Immediately initiate active outbound call on the Caller web frontend!
      setActivePlatformCall({
        platform,
        target,
        botToken: (cfg as any)?.botToken,
        channelId: (cfg as any)?.channelId,
      });
      setPhoneNumber(`[${platform.toUpperCase()}] ${target}`);
      setCallDirection('outbound');
      soundManager.playSend();
      playRingTone();
      setCallStatus('dialing');
      setCallSeconds(0);
      setLiveInterimSpeech('');
      accumulatedSttRef.current = '';

      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      ringTimerRef.current = setTimeout(() => {
        playRingTone();
        setCallStatus('ringing');
        ringTimerRef.current = setTimeout(() => {
          setCallStatus('connected');
          soundManager.playReceive();

          const greetId = `msg_greet_${Date.now()}`;
          processedMsgIdsRef.current.add(greetId);

          setTranscript([
            {
              id: greetId,
              sender: 'agent',
              text: greeting,
              timestamp: '00:01',
              modelUsed: activeModel.name,
            },
          ]);
          // Voice is sent to the remote receiving end (Discord/Telegram/WhatsApp/Messenger),
          // so local web frontend speakers stay silent while avatar & subtitles animate visually!
          speakAgentVoice(greeting, undefined, { silentVisualOnly: true });
        }, 900);
      }, 700);

      // 2. Dispatch call to platform backend API with voice greeting
      const resp = await fetch('/api/caller/platforms/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          config: cfg,
          credentials: cfg,
          message: greeting,
          to: target,
          recipient: target,
          ragContext: ragText,
          callerUrl: typeof window !== 'undefined' ? window.location.origin : '',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (data?.ok) {
        setPlatformActivityLog((prev) => [
          {
            id: `act_${Date.now()}`,
            platform,
            action: `Live ${platform.toUpperCase()} Call Active`,
            target: data.to || target,
            message: `Voice greeting dispatched to ${platform.toUpperCase()} receiver. (Web frontend speaker quiet).`,
            timestamp: new Date().toLocaleTimeString(),
            status: 'success',
          },
          ...prev,
        ]);
      } else {
        setPlatformActivityLog((prev) => [
          {
            id: `act_${Date.now()}`,
            platform,
            action: 'Dispatch Notice',
            message: data?.error || 'Call initiated on frontend, check platform credentials.',
            timestamp: new Date().toLocaleTimeString(),
            status: 'pending',
          },
          ...prev,
        ]);
      }
    } catch (err: any) {
      setPlatformActivityLog((prev) => [
        {
          id: `act_${Date.now()}`,
          platform,
          action: 'Dispatch Exception',
          message: err?.message || 'Error executing dispatch',
          timestamp: new Date().toLocaleTimeString(),
          status: 'failed',
        },
        ...prev,
      ]);
    } finally {
      setDispatchingPlatform(null);
    }
  };

  const handleSimulatePlatformInbound = async (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => {
    const questions: Record<string, string> = {
      whatsapp: 'Hi Hana! What dental checkup packages and hours do you have open tomorrow?',
      telegram: 'Hello Hana! Can you tell me your pricing and whether you have 2 PM slots available?',
      discord: 'Hey Hana! Are you able to help me schedule my consultation through this voice call?',
      messenger: 'Hey! I need to book an appointment with your clinic. What insurance do you accept?',
    };
    const incomingText = questions[platform] || 'What appointment times are open?';
    setPlatformActivityLog((prev) => [
      {
        id: `act_${Date.now()}`,
        platform,
        action: `Inbound ${platform.toUpperCase()} Call Received`,
        message: incomingText,
        timestamp: new Date().toLocaleTimeString(),
        status: 'pending',
      },
      ...prev,
    ]);

    // Send through Hana AI with RAG
    handleSendCalleeInput(incomingText);
  };

  const handleCopyWebhookUrl = (platform: string) => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/caller/webhooks/${platform}`;
    navigator.clipboard?.writeText(url);
    setCopiedPlatformWebhook(platform);
    setTimeout(() => setCopiedPlatformWebhook(null), 2000);
  };


  const handleSendCalleeInputRef = useRef(handleSendCalleeInput);
  useEffect(() => {
    handleSendCalleeInputRef.current = handleSendCalleeInput;
  }, [handleSendCalleeInput]);

  // ----------------------------------------------------
  // Answer an Incoming Call on the Self-Hosted PBX Switchboard
  // ----------------------------------------------------
  const handleAnswerIncomingCall = useCallback(
    async (incoming?: { callId: string; fromNumber: string; offerSdp?: any }) => {
      const target = incoming || incomingPbxOffer;
      setCallDirection('inbound');
      setCallSeconds(0);
      setIncomingPbxOffer(null);

      if (target) {
        setActivePbxCallId(target.callId);
        setPhoneNumber(target.fromNumber);

        let answerSdp: RTCSessionDescriptionInit | null = null;
        if (target.offerSdp) {
          try {
            const pc = await setupWebRtcPeer('callee', target.callId);
            await pc.setRemoteDescription(new RTCSessionDescription(target.offerSdp));
            answerSdp = await pc.createAnswer();
            await pc.setLocalDescription(answerSdp);
          } catch {}
        }

        await fetch('/api/caller/pbx/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: target.callId,
            answerSdp,
          }),
        }).catch(() => {});
      }

      setCallStatus('connected');
      soundManager.playReceive();

      const greeting = currentPreset.inboundGreeting;
      const greetId = `msg_greet_${Date.now()}`;
      processedMsgIdsRef.current.add(greetId);

      setTranscript([
        {
          id: greetId,
          sender: 'agent',
          text: greeting,
          timestamp: '00:01',
          modelUsed: activeModel.name,
        },
      ]);

      if (target?.callId) {
        fetch('/api/caller/pbx/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: target.callId,
            id: greetId,
            sender: 'agent',
            fromNumber: myLineNumber,
            text: greeting,
            timestamp: '00:01',
            modelUsed: activeModel.name,
          }),
        }).catch(() => {});
      }

      speakAgentVoice(greeting);
    },
    [activeModel.name, currentPreset.inboundGreeting, incomingPbxOffer, myLineNumber, setupWebRtcPeer, speakAgentVoice]
  );

  // ----------------------------------------------------
  // Self-Hosted PBX Switchboard Polling (Receive & Sync Calls)
  // ----------------------------------------------------
  useEffect(() => {
    fetch('/api/caller/pbx/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineNumber: myLineNumber }),
    }).catch(() => {});

    pbxPollRef.current = setInterval(async () => {
      try {
        const query = new URLSearchParams({
          lineNumber: myLineNumber,
          ...(activePbxCallIdRef.current ? { callId: activePbxCallIdRef.current } : {}),
        });
        const resp = await fetch(`/api/caller/pbx/poll?${query.toString()}`);
        if (!resp.ok) return;
        const data = await resp.json();

        // 1. Check for new incoming call when idle
        if (
          data?.incomingCall &&
          callStatusRef.current === 'idle' &&
          data.incomingCall.status === 'ringing'
        ) {
          const inc = data.incomingCall;
          playRingTone();
          setIncomingPbxOffer({
            callId: inc.callId,
            fromNumber: inc.fromNumber,
            offerSdp: inc.offerSdp,
          });
          setPhoneNumber(inc.fromNumber);
          setCallDirection('inbound');
          setCallStatus('ringing');

          if (autoAnswerRef.current) {
            setTimeout(() => {
              if (callStatusRef.current === 'ringing') {
                handleAnswerIncomingCall({
                  callId: inc.callId,
                  fromNumber: inc.fromNumber,
                  offerSdp: inc.offerSdp,
                });
              }
            }, 1200);
          }
        }

        // 2. Sync active call WebRTC SDP, ICE, and remote speech turns
        const activeSession = data?.activeCall;
        if (activeSession) {
          if (activeSession.status === 'ended' && callStatusRef.current !== 'idle') {
            setActivePbxCallId(null);
            setCallStatus('ended');
            setTimeout(() => setCallStatus('idle'), 1500);
            return;
          }

          if (
            activeSession.answerSdp &&
            peerConnectionRef.current &&
            peerConnectionRef.current.signalingState === 'have-local-offer'
          ) {
            peerConnectionRef.current
              .setRemoteDescription(new RTCSessionDescription(activeSession.answerSdp))
              .catch(() => {});
          }

          if (Array.isArray(activeSession.messages)) {
            for (const m of activeSession.messages) {
              if (!processedMsgIdsRef.current.has(m.id)) {
                processedMsgIdsRef.current.add(m.id);
                if (m.sender === 'callee') {
                  handleSendCalleeInputRef.current(m.text, true);
                } else {
                  setTranscript((prev) => [...prev, m]);
                  speakAgentVoice(m.text);
                }
              }
            }
          }
        }
      } catch {}
    }, 1500);

    return () => {
      if (pbxPollRef.current) clearInterval(pbxPollRef.current);
    };
  }, [handleAnswerIncomingCall, myLineNumber, speakAgentVoice]);

  // ----------------------------------------------------
  // Omnichannel Platform Call Polling (Telegram & Discord Live Speech Sync)
  // ----------------------------------------------------
  const platformPollRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!activePlatformCall) {
      if (platformPollRef.current) {
        clearInterval(platformPollRef.current);
        platformPollRef.current = null;
      }
      return;
    }

    platformPollRef.current = setInterval(async () => {
      try {
        if (!activePlatformCallRef.current) return;
        const cur = activePlatformCallRef.current;
        const query = new URLSearchParams({
          platform: cur.platform,
          target: cur.target,
          botToken: cur.botToken || '',
        });
        const resp = await fetch(`/api/caller/platforms/poll?${query.toString()}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data?.messages)) {
          for (const m of data.messages) {
            if (!processedMsgIdsRef.current.has(m.id)) {
              processedMsgIdsRef.current.add(m.id);
              if (m.sender === 'callee') {
                handleSendCalleeInputRef.current(m.text, true);
              } else {
                setTranscript((prev) => [...prev, m]);
                speakAgentVoice(m.text);
              }
            }
          }
        }
      } catch {}
    }, 1200);

    return () => {
      if (platformPollRef.current) {
        clearInterval(platformPollRef.current);
        platformPollRef.current = null;
      }
    };
  }, [activePlatformCall, speakAgentVoice]);

  // ----------------------------------------------------
  // Continuous Real-Time Speech-to-Text (STT) with Silence Auto-Send
  // ----------------------------------------------------
  const scheduleSilenceAutoSend = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    const waitMs = 1900;
    setSilenceProgress({ id: Date.now(), durationMs: waitMs });

    silenceTimerRef.current = setTimeout(() => {
      setSilenceProgress(null);
      const spokenText = accumulatedSttRef.current.trim();
      if (
        spokenText.length >= 2 &&
        !hanaIsSpeakingRef.current &&
        !isAiGeneratingRef.current
      ) {
        accumulatedSttRef.current = '';
        setLiveInterimSpeech('');
        handleSendCalleeInputRef.current(spokenText);
      }
      silenceTimerRef.current = null;
    }, waitMs);
  }, []);

  useEffect(() => {
    const isCallActive =
      callStatus === 'connected' ||
      callStatus === 'speaking' ||
      callStatus === 'listening';

    if (!isCallActive || isMicMuted) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsRecognizingSpeech(false);
      setSilenceProgress(null);
      return;
    }

    if (typeof window === 'undefined') return;
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    let isDisposed = false;
    let recognition: any = null;

    const initContinuousStt = () => {
      if (isDisposed) return;
      try {
        recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          if (!isDisposed) setIsRecognizingSpeech(true);
        };

        recognition.onresult = (event: any) => {
          if (isDisposed) return;

          if (
            hanaIsSpeakingRef.current ||
            isAiGeneratingRef.current ||
            (typeof window !== 'undefined' && window.speechSynthesis?.speaking) ||
            Date.now() < speechCooldownUntilRef.current
          ) {
            return;
          }

          let interimChunk = '';
          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcriptPiece = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalChunk += transcriptPiece + ' ';
            } else {
              interimChunk += transcriptPiece;
            }
          }

          if (finalChunk.trim()) {
            accumulatedSttRef.current = (
              (accumulatedSttRef.current ? accumulatedSttRef.current + ' ' : '') +
              finalChunk.trim()
            ).trim();
          }

          const combinedLive = (
            (accumulatedSttRef.current ? accumulatedSttRef.current + ' ' : '') +
            interimChunk
          ).trim();

          if (combinedLive) {
            setLiveInterimSpeech(combinedLive);
            scheduleSilenceAutoSend();
          }
        };

        recognition.onend = () => {
          if (isDisposed) {
            setIsRecognizingSpeech(false);
            return;
          }
          const stillActive =
            callStatusRef.current === 'connected' ||
            callStatusRef.current === 'speaking' ||
            callStatusRef.current === 'listening';

          if (
            stillActive &&
            !isMicMutedRef.current &&
            !hanaIsSpeakingRef.current &&
            !(window.speechSynthesis?.speaking)
          ) {
            setTimeout(() => {
              if (!isDisposed && !isMicMutedRef.current && !hanaIsSpeakingRef.current) {
                try {
                  recognition.start();
                } catch {}
              }
            }, 300);
          } else {
            setIsRecognizingSpeech(false);
          }
        };

        recognitionRef.current = recognition;
        if (!hanaIsSpeakingRef.current && !(window.speechSynthesis?.speaking)) {
          recognition.start();
        }
      } catch {
        setIsRecognizingSpeech(false);
      }
    };

    initContinuousStt();

    return () => {
      isDisposed = true;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try {
        recognition?.stop();
      } catch {}
    };
  }, [callStatus, isMicMuted, scheduleSilenceAutoSend]);

  // ----------------------------------------------------
  // Outbound & Inbound Call Actions
  // ----------------------------------------------------
  const handleStartCall = async (direction: CallDirection = 'outbound') => {
    if (direction === 'inbound' && incomingPbxOffer) {
      await handleAnswerIncomingCall(incomingPbxOffer);
      return;
    }

    setCallDirection(direction);
    soundManager.playSend();
    playRingTone();
    setCallStatus(direction === 'outbound' ? 'dialing' : 'ringing');
    setCallSeconds(0);
    setLiveInterimSpeech('');
    accumulatedSttRef.current = '';

    const targetE164 = toE164(phoneNumber);

    // 1. Optional Native OS / Cellular Carrier Handset Bridge (tel:)
    if (direction === 'outbound' && useNativeCarrierBridge && targetE164) {
      const a = document.createElement('a');
      a.href = `tel:${targetE164}`;
      a.click();
    }

    // 2. Dial over Self-Hosted WebRTC PBX Switchboard
    if (direction === 'outbound' && phoneNumber.trim()) {
      try {
        const tempId = `pbx_${Date.now()}`;
        const pc = await setupWebRtcPeer('caller', tempId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await fetch('/api/caller/pbx/dial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromNumber: myLineNumber,
            toNumber: phoneNumber,
            offerSdp: offer,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok && data.callId) {
          setActivePbxCallId(data.callId);
        }
      } catch {}
    }

    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      playRingTone();
      setCallStatus('ringing');
      ringTimerRef.current = setTimeout(() => {
        setCallStatus('connected');
        soundManager.playReceive();

        const greeting =
          direction === 'outbound'
            ? currentPreset.outboundGreeting
            : currentPreset.inboundGreeting;
        const greetId = `msg_greet_${Date.now()}`;
        processedMsgIdsRef.current.add(greetId);

        setTranscript([
          {
            id: greetId,
            sender: 'agent',
            text: greeting,
            timestamp: '00:01',
            modelUsed: activeModel.name,
          },
        ]);
        speakAgentVoice(greeting);
      }, 900);
    }, 700);
  };

  const handleEndCall = () => {
    stopCurrentGeneration();
    window.speechSynthesis?.cancel();
    lipSyncManager.endSpeech();
    hanaIsSpeakingRef.current = false;
    setHanaIsSpeaking(false);
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    setSilenceProgress(null);

    try {
      recognitionRef.current?.stop();
    } catch {}
    try {
      peerConnectionRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}

    if (activePbxCallId) {
      fetch('/api/caller/pbx/hangup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: activePbxCallId }),
      }).catch(() => {});
      setActivePbxCallId(null);
    }

    if (activePlatformCallRef.current) {
      setActivePlatformCall(null);
    }

    setIncomingPbxOffer(null);
    setIsRecognizingSpeech(false);
    setCallStatus('ended');
    setTimeout(() => setCallStatus('idle'), 1400);
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedRagPresetId(presetId);
    try {
      localStorage.setItem(STORAGE_KEYS.RAG_PRESET, presetId);
    } catch {}
    const found = RAG_PRESETS.find((p) => p.id === presetId);
    if (found) {
      setRagText(found.content);
    }
  };

  const handleUploadRagDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingDoc(true);
    try {
      const extracted = await extractDocumentText(file);
      if (extracted) {
        setRagText((prev) => `[UPLOADED DOCUMENT: ${file.name}]\n${extracted}\n\n${prev}`);
      }
    } catch (err) {
      console.error('Failed to extract RAG document:', err);
    } finally {
      setIsUploadingDoc(false);
      e.target.value = '';
    }
  };

  const handleCopyCallLink = () => {
    const url = `${window.location.origin}/caller?callTo=${encodeURIComponent(myLineNumber)}`;
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const isCallLive =
    callStatus === 'connected' ||
    callStatus === 'speaking' ||
    callStatus === 'listening';

  return (
    <div className="relative min-h-screen w-screen bg-[#f8fafc] text-neutral-900 font-sans flex flex-col overflow-x-hidden selection:bg-sky-500/20 selection:text-sky-950">
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* ======================================================== */}
      {/* COMPACT LIGHT HEADER: Reuses /chat Model Controls        */}
      {/* ======================================================== */}
      <header className="h-14 px-4 sm:px-6 border-b border-neutral-200 bg-white/95 backdrop-blur-md flex items-center justify-between gap-2 shrink-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onNavigateHome}
            className="px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-700 hover:text-neutral-950 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToChat}
            className="px-2.5 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 transition-all cursor-pointer text-xs font-semibold"
          >
            /chat
          </button>

          <div className="flex items-center gap-2 ml-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#55d2f6] flex items-center justify-center text-neutral-950 shrink-0 shadow-xs">
              <PhoneCall className="w-3.5 h-3.5 stroke-[2.2]" />
            </div>
            <h1 className="text-sm font-bold font-heading text-neutral-900 truncate">
              Hana AI Caller
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-mono font-semibold ${
              isCallLive
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : callStatus === 'dialing' || callStatus === 'ringing'
                ? 'bg-amber-50 border-amber-300 text-amber-800'
                : 'bg-neutral-100 border-neutral-200 text-neutral-600'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isCallLive
                  ? 'bg-emerald-500 animate-ping'
                  : callStatus === 'dialing' || callStatus === 'ringing'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-neutral-400'
              }`}
            />
            <span>
              {callStatus.toUpperCase()} · {formatCallTime(callSeconds)}
            </span>
          </div>
        </div>
      </header>

      {/* ======================================================== */}
      {/* BENTO GRID: 30% PORTRAIT 3D FRAME + 70% 2x2 RIGHT TILES  */}
      {/* ======================================================== */}
      <main className="flex-1 p-3 sm:p-5 max-w-[1536px] mx-auto w-full grid grid-cols-1 lg:grid-cols-10 gap-4 items-stretch">
        {/* ======================================================== */}
        {/* LEFT COLUMN (30% / 3 cols): PORTRAIT 3D AVATAR FRAME    */}
        {/* ======================================================== */}
        <section className="lg:col-span-3 flex flex-col min-w-0">
          <div className="relative w-full h-full min-h-[500px] lg:min-h-0 rounded-2xl bg-gradient-to-b from-sky-100/70 via-sky-50/40 to-slate-100 border border-neutral-200/90 shadow-xs flex flex-col justify-between">
            {/* Live 3D VRM Canvas (uses same model as /interviewer, pointer interactions disabled) */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none select-none">
              <VRMCanvas
                interactive={false}
                enablePointerTracking={false}
                disableIdleWaitingAnimations={true}
                isSpeaking={hanaIsSpeaking}
                modelFileName={CALLER_INTERVIEWER_VRM_MODEL}
                emotion={avatarEmotion}
              />
            </div>

            {/* Subtitles Overlay */}
            {subtitleState.isActive && (
              <div className="absolute bottom-16 inset-x-2 z-20 pointer-events-none flex justify-center">
                <VRMSubtitles
                  isActive={subtitleState.isActive}
                  text={subtitleState.text}
                  charIndex={subtitleState.charIndex}
                  currentWord={subtitleState.currentWord}
                  onDismiss={() =>
                    setSubtitleState((prev) => ({ ...prev, isActive: false }))
                  }
                />
              </div>
            )}

            {/* Top Left: Avatar Status Pill */}
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-md border border-neutral-200 text-[11px] font-mono text-neutral-800 flex items-center gap-1.5 shadow-xs z-20 pointer-events-auto">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  hanaIsSpeaking
                    ? 'bg-sky-500 animate-ping'
                    : isRecognizingSpeech
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-neutral-400'
                }`}
              />
              <span className="font-semibold">
                {hanaIsSpeaking
                  ? 'Speaking'
                  : isRecognizingSpeech
                  ? 'Listening'
                  : 'Standby'}
              </span>
            </div>

            {/* Top Right: Mic & TTS Voice Mute Toggles */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20 pointer-events-auto">
              <button
                type="button"
                onClick={() => setIsMicMuted((prev) => !prev)}
                className={`p-1.5 rounded-lg border backdrop-blur-md transition-all cursor-pointer shadow-xs ${
                  isMicMuted
                    ? 'bg-rose-50/95 border-rose-300 text-rose-600'
                    : 'bg-white/95 border-neutral-200 text-emerald-600 hover:bg-white'
                }`}
                title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !isSpeakerMuted;
                  setIsSpeakerMuted(next);
                  if (next) handleInterruptSpeech();
                }}
                className={`p-1.5 rounded-lg border backdrop-blur-md transition-all cursor-pointer shadow-xs ${
                  isSpeakerMuted
                    ? 'bg-rose-50/95 border-rose-300 text-rose-600'
                    : 'bg-white/95 border-neutral-200 text-sky-600 hover:bg-white'
                }`}
                title={isSpeakerMuted ? 'Unmute TTS Voice' : 'Mute TTS Voice'}
              >
                {isSpeakerMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Bottom Left Overlays: Model Selector & Max Token Selector in a Row */}
            <div className="absolute bottom-3 left-3 z-30 flex items-center gap-1.5 flex-wrap pointer-events-auto max-w-[calc(100%-24px)]">
              <ModelSelector
                activeModel={activeModel}
                cacheStatuses={cacheStatuses}
                onSelectModel={handleSelectModel}
                disabled={isAiGenerating}
                ollamaStatus={ollamaStatus}
                onUpdateCustomUrl={onUpdateCustomUrl}
                onNavigateToDocs={onNavigateToDocs}
              />

              <ProviderSubmodelSelector
                activeModel={activeModel}
                onUpdateModel={handleSelectModel}
                disabled={isAiGenerating}
                onNavigateToDocs={onNavigateToDocs}
              />

              <MaxTokensSelector
                maxTokens={maxTokens}
                onChangeMaxTokens={handleChangeMaxTokens}
                disabled={isAiGenerating}
              />
            </div>
          </div>
        </section>

        {/* ======================================================== */}
        {/* RIGHT COLUMN (70% / 7 cols): 2 COLS x 2 ROWS BENTO GRID */}
        {/* Row 1: Col 1 Dialer | Col 2 Editable RAG Knowledge       */}
        {/* Row 2: Merged Double Column (Live 2-Way Voice Q&A)        */}
        {/* ======================================================== */}
        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch min-w-0">
          {/* ------------------------------------------------------ */}
          {/* ROW 1, COL 1: SELF-HOSTED PHONE DIALER & PBX LINE     */}
          {/* ------------------------------------------------------ */}
          <section className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between gap-3 min-w-0">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
                  <PhoneCall className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold font-heading text-neutral-900 truncate">
                    Phone Calling &amp; Line
                  </h2>
                  <p className="text-[11px] text-neutral-500 truncate">
                    Carrier bridge &amp; direct WebRTC PBX
                  </p>
                </div>
              </div>

              {/* My Receiver Line Number */}
              <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1.5 mb-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-neutral-700 flex items-center gap-1">
                    <PhoneIncoming className="w-3 h-3 text-sky-600" />
                    <span>My Line (Receive Calls)</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAutoAnswerIncoming((prev) => !prev)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border cursor-pointer ${
                        autoAnswerIncoming
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-white border-neutral-200 text-neutral-500'
                      }`}
                      title="Automatically answer incoming calls with Hana AI"
                    >
                      {autoAnswerIncoming ? 'Auto-Answer: ON' : 'Auto-Answer: OFF'}
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyCallLink}
                      className="px-2 py-0.5 rounded-md bg-white hover:bg-sky-50 border border-neutral-200 text-[10px] font-semibold text-sky-700 flex items-center gap-1 cursor-pointer"
                      title="Copy link to open on your phone or another tab to call this line"
                    >
                      {copiedLink ? <Check className="w-3 h-3 text-emerald-600" /> : <Link2 className="w-3 h-3" />}
                      <span>{copiedLink ? 'Copied' : 'Call Link'}</span>
                    </button>
                  </div>
                </div>

                <input
                  type="tel"
                  value={myLineNumber}
                  onChange={(e) => setMyLineNumber(e.target.value)}
                  className="w-full px-2.5 py-1 rounded-lg bg-white border border-neutral-200 text-xs font-mono font-semibold text-neutral-800 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Outbound Target Phone Number */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-neutral-600 font-medium">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-emerald-600" />
                    <span>Dial Phone Number</span>
                  </span>
                  <label className="inline-flex items-center gap-1 text-[10px] text-neutral-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useNativeCarrierBridge}
                      onChange={(e) => setUseNativeCarrierBridge(e.target.checked)}
                      className="accent-sky-500 rounded"
                    />
                    <span>OS Carrier (tel:)</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </label>
                </div>

                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Enter phone number (e.g. +1 555-234-8901)"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-50 border border-neutral-300 text-xs sm:text-sm font-mono font-bold text-neutral-900 placeholder:font-sans placeholder:font-normal placeholder:text-neutral-400 focus:outline-none focus:border-sky-500 focus:bg-white"
                />
              </div>

              {/* Incoming Call Ringing Alert */}
              {incomingPbxOffer && callStatus === 'ringing' && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-between gap-2 animate-pulse">
                  <span className="text-xs font-bold text-amber-900 truncate">
                    Incoming: {incomingPbxOffer.fromNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAnswerIncomingCall(incomingPbxOffer)}
                    className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer shrink-0"
                  >
                    Answer
                  </button>
                </div>
              )}
            </div>

            {/* Primary Call / Answer / End Buttons */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {callStatus === 'idle' || callStatus === 'ended' ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleStartCall('outbound')}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <PhoneForwarded className="w-3.5 h-3.5" />
                    <span>Call Number</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleStartCall('inbound')}
                    className="py-2.5 px-3 rounded-xl bg-[#55d2f6] hover:bg-[#38c7f0] active:scale-95 text-neutral-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <PhoneIncoming className="w-3.5 h-3.5" />
                    <span>Receive Call</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleEndCall}
                    className={`${
                      hanaIsSpeaking ? 'col-span-1' : 'col-span-2'
                    } py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer`}
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>End Call</span>
                  </button>

                  {hanaIsSpeaking && (
                    <button
                      type="button"
                      onClick={handleInterruptSpeech}
                      className="col-span-1 py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Barge-In</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </section>

          {/* ------------------------------------------------------ */}
          {/* ROW 1, COL 2: SPECIAL EDITABLE RAG KNOWLEDGE BASE      */}
          {/* ------------------------------------------------------ */}
          <section className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold font-heading text-neutral-900 truncate">
                    Editable RAG Knowledge
                  </h2>
                  <p className="text-[11px] text-neutral-500 truncate">
                    Connected to <span className="font-semibold text-neutral-800">{activeModel.name}</span>
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-[11px] font-semibold text-neutral-800 cursor-pointer shrink-0">
                <Upload className="w-3 h-3 text-sky-600" />
                <span>{isUploadingDoc ? '...' : 'Upload Doc'}</span>
                <input
                  type="file"
                  accept=".txt,.md,.json,.csv,.pdf,.docx,.doc"
                  onChange={handleUploadRagDocument}
                  className="hidden"
                />
              </label>
            </div>

            {/* Compact Domain Presets */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {RAG_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    selectedRagPresetId === p.id
                      ? 'bg-[#55d2f6] text-neutral-950'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200/70'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Special Editable RAG Text Input */}
            <textarea
              value={ragText}
              onChange={(e) => setRagText(e.target.value)}
              placeholder="Enter your business facts, prices, available appointment slots, and instructions for Hana..."
              className="flex-1 min-h-[170px] w-full p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-800 leading-relaxed focus:outline-none focus:border-sky-500 focus:bg-white resize-none"
            />
          </section>

          {/* ------------------------------------------------------ */}
          {/* ROW 2: MERGED DOUBLE COLUMN (LIVE 2-WAY VOICE Q&A)     */}
          {/* ------------------------------------------------------ */}
          <section className="md:col-span-2 rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col gap-3 min-w-0">
            {activePlatformCall && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-950 text-xs shadow-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-600 animate-ping shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-violet-900 truncate">
                      🟢 Live {activePlatformCall.platform.toUpperCase()} Call Bridge Active: {activePlatformCall.target}
                    </p>
                    <p className="text-[11px] text-violet-700 truncate">
                      Callee audio voice notes &amp; messages stream into this caller room; Hana speaks replies back as voiceovers.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shrink-0 cursor-pointer shadow-xs transition-all"
                >
                  End Call
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
                  <Radio className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold font-heading text-neutral-900">
                    Live 2-Way Voice Q&amp;A
                  </h2>
                  <p className="text-[11px] text-neutral-500">
                    Real-time STT &amp; TTS phone conversation
                  </p>
                </div>
              </div>

              {transcript.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTranscript([])}
                  className="p-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 cursor-pointer"
                  title="Clear Call Transcript"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Live Transcript Stream */}
            <div
              ref={transcriptContainerRef}
              className="flex-1 min-h-[180px] max-h-[260px] overflow-y-auto p-3 rounded-xl bg-neutral-50 border border-neutral-200 space-y-2.5"
            >
              {transcript.length === 0 && !streamingAgentText && !liveInterimSpeech ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-3 py-6 text-neutral-400 space-y-1">
                  <PhoneCall className="w-5 h-5 text-sky-500/70" />
                  <p className="text-xs font-semibold text-neutral-600">
                    Line Ready for 2-Way Voice Call
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    Dial a number, receive a call, or speak/click a question below to talk with Hana.
                  </p>
                </div>
              ) : (
                transcript.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === 'agent' ? 'items-start' : 'items-end'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-mono text-neutral-500">
                      <span className="font-semibold text-neutral-700">
                        {msg.sender === 'agent' ? 'Hana AI' : 'Caller'}
                      </span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                      {msg.sender === 'agent' && (
                        <button
                          type="button"
                          onClick={() => speakAgentVoice(msg.text)}
                          className="text-sky-600 hover:underline cursor-pointer"
                        >
                          Speak
                        </button>
                      )}
                    </div>
                    <div
                      className={`max-w-[85%] p-2.5 rounded-xl text-xs leading-relaxed ${
                        msg.sender === 'agent'
                          ? 'bg-sky-50 border border-sky-200 text-neutral-900 rounded-tl-xs'
                          : 'bg-white border border-neutral-200 text-neutral-900 rounded-tr-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}

              {streamingAgentText && (
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-1 mb-0.5 text-[10px] font-mono text-sky-700 font-semibold">
                    <Sparkles className="w-3 h-3 animate-spin" />
                    <span>Hana replying...</span>
                  </div>
                  <div className="max-w-[85%] p-2.5 rounded-xl rounded-tl-xs bg-sky-50 border border-sky-300 text-xs text-neutral-900">
                    {streamingAgentText}
                  </div>
                </div>
              )}

              {liveInterimSpeech && (
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1 mb-0.5 text-[10px] font-mono text-emerald-700 font-semibold">
                    <Mic className="w-3 h-3 animate-pulse" />
                    <span>Caller speaking...</span>
                  </div>
                  <div className="max-w-[85%] p-2.5 rounded-xl rounded-tr-xs bg-emerald-50 border border-emerald-300 text-xs text-emerald-950">
                    <p>{liveInterimSpeech}</p>
                    {silenceProgress && (
                      <div className="w-full h-1 bg-emerald-200 rounded-full overflow-hidden mt-1.5">
                        <div
                          key={silenceProgress.id}
                          className="h-full bg-emerald-600 rounded-full"
                          style={{
                            animation: `silence-progress-fill ${silenceProgress.durationMs}ms linear forwards`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Caller Test Prompts */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {currentPreset.quickPhrases.map((phrase, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isAiGenerating}
                  onClick={() => handleSendCalleeInput(phrase)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-sky-50 border border-neutral-200 hover:border-sky-300 text-[11px] text-neutral-700 whitespace-nowrap transition-all cursor-pointer shrink-0 disabled:opacity-50"
                >
                  &ldquo;{phrase}&rdquo;
                </button>
              ))}
            </div>

            {/* Caller Speech / Text Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCalleeInput(currentCalleeInput);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={currentCalleeInput}
                onChange={(e) => setCurrentCalleeInput(e.target.value)}
                placeholder="Speak into mic or type caller question..."
                disabled={isAiGenerating}
                className="flex-1 px-3 py-2 rounded-xl bg-neutral-50 border border-neutral-300 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-sky-500 focus:bg-white"
              />
              <button
                type="submit"
                disabled={!currentCalleeInput.trim() || isAiGenerating}
                className="px-3.5 py-2 rounded-xl bg-[#55d2f6] hover:bg-[#38c7f0] disabled:opacity-40 text-neutral-950 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          </section>
        </div>
      </main>

      {/* ======================================================== */}
      {/* SECONDARY BENTO GRID: 3rd-PARTY PLATFORM CALLING GATEWAYS*/}
      {/* (WhatsApp Business, Telegram Bot VoIP, Facebook Messenger)*/}
      {/* ======================================================== */}
      <OmnichannelGatewaysGrid
        platformCreds={platformCreds}
        onChangeCreds={handleUpdatePlatformCreds}
        activityLogs={platformActivityLog}
        onClearLogs={() => setPlatformActivityLog([])}
        onTestPlatform={handleTestPlatform}
        onDispatchCall={handleDispatchPlatformCall}
        onSimulateInbound={handleSimulatePlatformInbound}
        testingPlatform={testingPlatform}
        dispatchingPlatform={dispatchingPlatform}
        copiedWebhook={copiedPlatformWebhook}
        onCopyWebhook={handleCopyWebhookUrl}
        savedNotice={savedPlatformNotice}
        onSaveNotice={() => {
          try {
            const serialized = JSON.stringify(platformCreds);
            localStorage.setItem(STORAGE_KEYS.PLATFORMS, serialized);
            localStorage.setItem('hana_caller_omnichannel_backup', serialized);
          } catch {}
          setSavedPlatformNotice(true);
          setTimeout(() => setSavedPlatformNotice(false), 2000);
        }}
        onNavigateToDocs={onNavigateToDocs}
        discordStatus={discordGatewayStatus}
        onConnectDiscord={handleConnectDiscord}
        discordVoiceState={discordVoiceState}
        onJoinDiscordVoiceChannel={handleJoinDiscordVoiceChannel}
        onLeaveDiscordVoiceChannel={handleLeaveDiscordVoiceChannel}
        isJoiningDiscordVc={isJoiningDiscordVc}
        frontendMonitorAudio={frontendMonitorAudio}
        onToggleFrontendMonitorAudio={() => setFrontendMonitorAudio((prev) => !prev)}
      />

      {/* ======================================================== */}
      {/* BOTTOM BAR: Reuses /chat TelemetryBar                    */}
      {/* ======================================================== */}
      <TelemetryBar
        activeModel={activeModel}
        telemetry={telemetry}
        downloadProgress={downloadProgress}
        isExpanded={isTelemetryExpanded}
        onToggleExpand={() => setIsTelemetryExpanded((prev) => !prev)}
        onCancelDownload={stopCurrentGeneration}
      />
    </div>
  );
};
