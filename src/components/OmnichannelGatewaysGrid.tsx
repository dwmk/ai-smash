import React, { useState } from 'react';
import {
  MessageSquare,
  Send,
  MessageCircle,
  Check,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Play,
  Copy,
  Activity,
  Globe,
  Zap,
  Eye,
  EyeOff,
  ExternalLink,
  Trash2,
  Download,
  Upload,
  PhoneCall,
  ShieldCheck,
  Radio,
  BookOpen,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { PlatformCredentials, PlatformActivityLogItem } from './CallerPage';
import { OMNICHANNEL_LOGOS } from '../constants';

export interface OmnichannelGatewaysGridProps {
  platformCreds: PlatformCredentials;
  onChangeCreds: (updater: (prev: PlatformCredentials) => PlatformCredentials) => void;
  activityLogs: PlatformActivityLogItem[];
  onClearLogs: () => void;
  onTestPlatform: (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => Promise<void>;
  onDispatchCall: (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => Promise<void>;
  onSimulateInbound: (platform: 'whatsapp' | 'telegram' | 'messenger' | 'discord') => Promise<void>;
  testingPlatform: string | null;
  dispatchingPlatform: string | null;
  copiedWebhook: string | null;
  onCopyWebhook: (platform: string) => void;
  savedNotice: boolean;
  onSaveNotice: () => void;
  onNavigateToDocs?: (path?: string) => void;
  discordStatus?: {
    status: 'connected' | 'disconnected' | 'polling' | 'error';
    message: string;
    botUser?: { id: string; username: string } | null;
  };
  onConnectDiscord?: () => void;
  discordVoiceState?: {
    connected: boolean;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    isSpeaking?: boolean;
    isVoiceChannel?: boolean;
  };
  onJoinDiscordVoiceChannel?: () => Promise<void>;
  onLeaveDiscordVoiceChannel?: () => Promise<void>;
  isJoiningDiscordVc?: boolean;
  frontendMonitorAudio?: boolean;
  onToggleFrontendMonitorAudio?: () => void;
}

export const OmnichannelGatewaysGrid: React.FC<OmnichannelGatewaysGridProps> = ({
  platformCreds,
  onChangeCreds,
  activityLogs,
  onClearLogs,
  onTestPlatform,
  onDispatchCall,
  onSimulateInbound,
  testingPlatform,
  dispatchingPlatform,
  copiedWebhook,
  onCopyWebhook,
  savedNotice,
  onSaveNotice,
  onNavigateToDocs,
  discordStatus,
  onConnectDiscord,
  discordVoiceState,
  onJoinDiscordVoiceChannel,
  onLeaveDiscordVoiceChannel,
  isJoiningDiscordVc = false,
  frontendMonitorAudio = false,
  onToggleFrontendMonitorAudio,
}) => {
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});

  const toggleShowToken = (key: string) => {
    setShowTokens((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExportConfig = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(platformCreds, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `hana-calling-gateways-${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && (parsed.whatsapp || parsed.telegram || parsed.messenger || parsed.discord)) {
          onChangeCreds((prev) => ({
            ...prev,
            ...parsed,
          }));
          onSaveNotice();
        }
      } catch (err) {
        console.error('Import failed:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset all 3rd-party calling credentials to blank defaults?')) {
      onChangeCreds(() => ({
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
      }));
      onSaveNotice();
    }
  };

  const originUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <section className="px-3 sm:px-5 pb-16 max-w-[1536px] mx-auto w-full space-y-4">
      {/* ======================================================== */}
      {/* SECONDARY BENTO GRID HEADER                              */}
      {/* ======================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Globe className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold font-heading text-neutral-900 truncate">
                3rd-Party Omnichannel Calling &amp; Voice Gateways
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                MULTI-CHANNEL
              </span>
            </div>
            <p className="text-xs text-neutral-500 truncate">
              Connect Meta Cloud WebRTC, Telegram Bot Voice Gateways, and Messenger Audio to Hana&apos;s active RAG receptionist.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => {
              onChangeCreds((prev) => ({
                ...prev,
                router: {
                  ...prev.router,
                  autoAnswerPlatforms: !prev.router.autoAnswerPlatforms,
                },
              }));
              onSaveNotice();
            }}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              platformCreds.router.autoAnswerPlatforms
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-neutral-100 border-neutral-200 text-neutral-600'
            }`}
            title="Automatically reply to voice messages and incoming calls using Hana and the active RAG prompt"
          >
            <Zap className={`w-3.5 h-3.5 ${platformCreds.router.autoAnswerPlatforms ? 'text-emerald-600' : 'text-neutral-400'}`} />
            <span>Auto-Answer Channels: {platformCreds.router.autoAnswerPlatforms ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onSaveNotice}
            className="px-3.5 py-1.5 rounded-xl bg-[#55d2f6] hover:bg-[#38c7f0] text-neutral-950 text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{savedNotice ? 'Saved!' : 'Save Credentials'}</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4-COLUMN BENTO GRID: WhatsApp, Telegram, Discord, Messenger */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        {/* ------------------------------------------------------ */}
        {/* TILE 1: WHATSAPP BUSINESS CALLING & VOICE GATEWAY      */}
        {/* ------------------------------------------------------ */}
        <div className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-heading text-neutral-900">
                    WhatsApp Business
                  </h3>
                  <p className="text-[10px] text-neutral-500">
                    Meta Cloud Calling &amp; Audio API
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                    platformCreds.whatsapp.status === 'verified'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : platformCreds.whatsapp.status === 'error'
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  {platformCreds.whatsapp.status === 'verified'
                    ? 'Verified'
                    : platformCreds.whatsapp.status === 'error'
                    ? 'Error'
                    : 'Unverified'}
                </span>

                <input
                  type="checkbox"
                  checked={platformCreds.whatsapp.enabled}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      whatsapp: { ...prev.whatsapp, enabled: e.target.checked },
                    }))
                  }
                  className="accent-emerald-600 rounded cursor-pointer"
                  title="Enable WhatsApp Gateway"
                />
              </div>
            </div>

            {/* Input: Phone Number ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Phone Number ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Meta Sender ID</span>
              </label>
              <input
                type="text"
                value={platformCreds.whatsapp.phoneNumberId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    whatsapp: { ...prev.whatsapp, phoneNumberId: e.target.value },
                  }))
                }
                placeholder="e.g. 104829104857201"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-emerald-500 focus:bg-white"
              />
            </div>

            {/* Input: WABA ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>WABA Account ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Business Account ID</span>
              </label>
              <input
                type="text"
                value={platformCreds.whatsapp.wabaId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    whatsapp: { ...prev.whatsapp, wabaId: e.target.value },
                  }))
                }
                placeholder="e.g. 109283746501928"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-emerald-500 focus:bg-white"
              />
            </div>

            {/* Input: System User Access Token */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>System Access Token / API Key</span>
                <button
                  type="button"
                  onClick={() => toggleShowToken('wa')}
                  className="text-[10px] text-emerald-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  {showTokens.wa ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                  <span>{showTokens.wa ? 'Hide' : 'Show'}</span>
                </button>
              </label>
              <input
                type={showTokens.wa ? 'text' : 'password'}
                value={platformCreds.whatsapp.accessToken}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    whatsapp: { ...prev.whatsapp, accessToken: e.target.value },
                  }))
                }
                placeholder="EAABw..."
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-emerald-500 focus:bg-white"
              />
            </div>

            {/* Input: Target WhatsApp Phone Number */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700">
                Target Recipient Phone Number
              </label>
              <input
                type="tel"
                value={platformCreds.whatsapp.targetNumber}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    whatsapp: { ...prev.whatsapp, targetNumber: e.target.value },
                  }))
                }
                placeholder="e.g. +1 555-234-8901"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-emerald-500 focus:bg-white"
              />
            </div>

            {/* Calling Mode & Webhook */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Calling Channel Mode
                </label>
                <select
                  value={platformCreds.whatsapp.callMode}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      whatsapp: { ...prev.whatsapp, callMode: e.target.value as any },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-medium text-neutral-800 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="audio_note">Voice Message Note</option>
                  <option value="voip_bridge">WebRTC VoIP Call</option>
                  <option value="receptionist">RAG Receptionist</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Verify Token
                </label>
                <input
                  type="text"
                  value={platformCreds.whatsapp.verifyToken}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      whatsapp: { ...prev.whatsapp, verifyToken: e.target.value },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-mono text-neutral-800 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Webhook Endpoint Copy */}
            <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-1 text-[10px]">
              <span className="font-mono text-neutral-600 truncate">
                {originUrl}/api/caller/webhooks/whatsapp
              </span>
              <button
                type="button"
                onClick={() => onCopyWebhook('whatsapp')}
                className="px-2 py-0.5 rounded-md bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-700 font-semibold shrink-0 cursor-pointer flex items-center gap-1"
              >
                {copiedWebhook === 'whatsapp' ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
                <span>{copiedWebhook === 'whatsapp' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={testingPlatform === 'whatsapp'}
                onClick={() => onTestPlatform('whatsapp')}
                className="py-1.5 px-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${testingPlatform === 'whatsapp' ? 'animate-spin' : ''}`} />
                <span>Test Handshake</span>
              </button>

              <button
                type="button"
                disabled={dispatchingPlatform === 'whatsapp'}
                onClick={() => onDispatchCall('whatsapp')}
                className="py-1.5 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Dispatch Call</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSimulateInbound('whatsapp')}
              className="w-full py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100/70 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
            >
              <Radio className="w-3 h-3 text-emerald-600 animate-pulse" />
              <span>Simulate Inbound WhatsApp Call</span>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------ */}
        {/* TILE 2: TELEGRAM BOT CALLING & VOICE GATEWAY           */}
        {/* ------------------------------------------------------ */}
        <div className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shrink-0">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-heading text-neutral-900">
                    Telegram Voice Bot
                  </h3>
                  <p className="text-[10px] text-neutral-500">
                    MTProto VoIP &amp; Voice Note Gateway
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                    platformCreds.telegram.status === 'verified'
                      ? 'bg-sky-50 border-sky-300 text-sky-700'
                      : platformCreds.telegram.status === 'error'
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  {platformCreds.telegram.status === 'verified'
                    ? 'Verified'
                    : platformCreds.telegram.status === 'error'
                    ? 'Error'
                    : 'Unverified'}
                </span>

                <input
                  type="checkbox"
                  checked={platformCreds.telegram.enabled}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      telegram: { ...prev.telegram, enabled: e.target.checked },
                    }))
                  }
                  className="accent-sky-600 rounded cursor-pointer"
                  title="Enable Telegram Gateway"
                />
              </div>
            </div>

            {/* Input: Bot Token */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Telegram Bot Token</span>
                <button
                  type="button"
                  onClick={() => toggleShowToken('tg')}
                  className="text-[10px] text-sky-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  {showTokens.tg ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                  <span>{showTokens.tg ? 'Hide' : 'Show'}</span>
                </button>
              </label>
              <input
                type={showTokens.tg ? 'text' : 'password'}
                value={platformCreds.telegram.botToken}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, botToken: e.target.value },
                  }))
                }
                placeholder="123456789:ABCdefGHIjklMNO..."
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-sky-500 focus:bg-white"
              />
            </div>

            {/* Input: Target Chat ID / Username */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Target Username or Chat ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">@user or ID</span>
              </label>
              <input
                type="text"
                value={platformCreds.telegram.chatId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    telegram: { ...prev.telegram, chatId: e.target.value },
                  }))
                }
                placeholder="e.g. @your_account or 987654321"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-sky-500 focus:bg-white"
              />
            </div>

            {/* Voice Call Mode & Secret Token */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Voice Calling Mode
                </label>
                <select
                  value={platformCreds.telegram.callMode}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      telegram: { ...prev.telegram, callMode: e.target.value as any },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-medium text-neutral-800 focus:outline-none focus:border-sky-500 cursor-pointer"
                >
                  <option value="voice_note">Opus Voice Note</option>
                  <option value="voip_gateway">2-Way VoIP Stream</option>
                  <option value="channel_agent">Receptionist Bot</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Secret Webhook Token
                </label>
                <input
                  type="text"
                  value={platformCreds.telegram.secretToken}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      telegram: { ...prev.telegram, secretToken: e.target.value },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-mono text-neutral-800 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Webhook Endpoint Copy */}
            <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-1 text-[10px]">
              <span className="font-mono text-neutral-600 truncate">
                {originUrl}/api/caller/webhooks/telegram
              </span>
              <button
                type="button"
                onClick={() => onCopyWebhook('telegram')}
                className="px-2 py-0.5 rounded-md bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-700 font-semibold shrink-0 cursor-pointer flex items-center gap-1"
              >
                {copiedWebhook === 'telegram' ? <Check className="w-2.5 h-2.5 text-sky-600" /> : <Copy className="w-2.5 h-2.5" />}
                <span>{copiedWebhook === 'telegram' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={testingPlatform === 'telegram'}
                onClick={() => onTestPlatform('telegram')}
                className="py-1.5 px-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${testingPlatform === 'telegram' ? 'animate-spin' : ''}`} />
                <span>Ping @getMe</span>
              </button>

              <button
                type="button"
                disabled={dispatchingPlatform === 'telegram'}
                onClick={() => onDispatchCall('telegram')}
                className="py-1.5 px-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Dispatch Call</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSimulateInbound('telegram')}
              className="w-full py-1 rounded-lg bg-sky-50 hover:bg-sky-100/70 border border-sky-200 text-sky-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
            >
              <Radio className="w-3 h-3 text-sky-600 animate-pulse" />
              <span>Simulate Inbound Telegram Voice Turn</span>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------ */}
        {/* TILE 3: FACEBOOK MESSENGER CALLING GATEWAY             */}
        {/* ------------------------------------------------------ */}
        <div className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-heading text-neutral-900">
                    Messenger Audio
                  </h3>
                  <p className="text-[10px] text-neutral-500">
                    Meta Graph Audio &amp; VoIP Bridge
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                    platformCreds.messenger.status === 'verified'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : platformCreds.messenger.status === 'error'
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                  }`}
                >
                  {platformCreds.messenger.status === 'verified'
                    ? 'Verified'
                    : platformCreds.messenger.status === 'error'
                    ? 'Error'
                    : 'Unverified'}
                </span>

                <input
                  type="checkbox"
                  checked={platformCreds.messenger.enabled}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      messenger: { ...prev.messenger, enabled: e.target.checked },
                    }))
                  }
                  className="accent-indigo-600 rounded cursor-pointer"
                  title="Enable Messenger Gateway"
                />
              </div>
            </div>

            {/* Input: Facebook Page ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Facebook Page ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Page Identifier</span>
              </label>
              <input
                type="text"
                value={platformCreds.messenger.pageId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    messenger: { ...prev.messenger, pageId: e.target.value },
                  }))
                }
                placeholder="e.g. 102938475619283"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            {/* Input: Page Access Token */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Page Access Token (Graph API)</span>
                <button
                  type="button"
                  onClick={() => toggleShowToken('fb')}
                  className="text-[10px] text-indigo-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  {showTokens.fb ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                  <span>{showTokens.fb ? 'Hide' : 'Show'}</span>
                </button>
              </label>
              <input
                type={showTokens.fb ? 'text' : 'password'}
                value={platformCreds.messenger.pageAccessToken}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    messenger: { ...prev.messenger, pageAccessToken: e.target.value },
                  }))
                }
                placeholder="EAA..."
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            {/* Input: Recipient PSID / Target ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Recipient PSID</span>
                <span className="text-[10px] text-neutral-400 font-normal">User Page-Scoped ID</span>
              </label>
              <input
                type="text"
                value={platformCreds.messenger.recipientId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    messenger: { ...prev.messenger, recipientId: e.target.value },
                  }))
                }
                placeholder="e.g. 4820194857201928"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>

            {/* Calling Mode & Webhook Verify Token */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Audio Channel Mode
                </label>
                <select
                  value={platformCreds.messenger.callMode}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      messenger: { ...prev.messenger, callMode: e.target.value as any },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-medium text-neutral-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="audio_message">Audio Call Voice</option>
                  <option value="call_bridge">WebRTC Call Bridge</option>
                  <option value="two_way_agent">Two-Way Agent</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-neutral-600 block mb-1">
                  Verify Token
                </label>
                <input
                  type="text"
                  value={platformCreds.messenger.verifyToken}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      messenger: { ...prev.messenger, verifyToken: e.target.value },
                    }))
                  }
                  className="w-full px-2 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] font-mono text-neutral-800 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Webhook Endpoint Copy */}
            <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-1 text-[10px]">
              <span className="font-mono text-neutral-600 truncate">
                {originUrl}/api/caller/webhooks/messenger
              </span>
              <button
                type="button"
                onClick={() => onCopyWebhook('messenger')}
                className="px-2 py-0.5 rounded-md bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-700 font-semibold shrink-0 cursor-pointer flex items-center gap-1"
              >
                {copiedWebhook === 'messenger' ? <Check className="w-2.5 h-2.5 text-indigo-600" /> : <Copy className="w-2.5 h-2.5" />}
                <span>{copiedWebhook === 'messenger' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={testingPlatform === 'messenger'}
                onClick={() => onTestPlatform('messenger')}
                className="py-1.5 px-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${testingPlatform === 'messenger' ? 'animate-spin' : ''}`} />
                <span>Verify Page</span>
              </button>

              <button
                type="button"
                disabled={dispatchingPlatform === 'messenger'}
                onClick={() => onDispatchCall('messenger')}
                className="py-1.5 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Dispatch Call</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSimulateInbound('messenger')}
              className="w-full py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-200 text-indigo-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
            >
              <Radio className="w-3 h-3 text-indigo-600 animate-pulse" />
              <span>Simulate Inbound Messenger Call</span>
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------ */}
        {/* TILE 4: DISCORD BOT CALLING & VOICE GATEWAY            */}
        {/* ------------------------------------------------------ */}
        <div className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between gap-4">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600 shrink-0 overflow-hidden">
                  <img
                    src={OMNICHANNEL_LOGOS.discord}
                    alt="Discord"
                    className="w-5 h-5 object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-heading text-neutral-900">
                    Discord Voice Bot
                  </h3>
                  <p className="text-[10px] text-neutral-500">
                    Voice Channel &amp; Audio DM Bridge
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {discordStatus?.status === 'connected' ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border bg-emerald-50 border-emerald-300 text-emerald-700 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                ) : discordStatus?.status === 'polling' ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border bg-amber-50 border-amber-300 text-amber-700 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-spin" />
                    Connecting...
                  </span>
                ) : (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                      platformCreds.discord.status === 'verified'
                        ? 'bg-violet-50 border-violet-300 text-violet-700'
                        : platformCreds.discord.status === 'error'
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {platformCreds.discord.status === 'verified'
                      ? 'Verified'
                      : platformCreds.discord.status === 'error'
                      ? 'Error'
                      : 'Offline'}
                  </span>
                )}

                <input
                  type="checkbox"
                  checked={platformCreds.discord.enabled}
                  onChange={(e) =>
                    onChangeCreds((prev) => ({
                      ...prev,
                      discord: { ...prev.discord, enabled: e.target.checked },
                    }))
                  }
                  className="accent-violet-600 rounded cursor-pointer"
                  title="Enable Discord Gateway"
                />
              </div>
            </div>

            {/* Live Gateway Connection Bar */}
            <div className="p-2 rounded-xl bg-violet-50/60 border border-violet-200 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${discordStatus?.status === 'connected' ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-neutral-400'}`} />
                <span className="text-[11px] font-semibold text-neutral-800 truncate">
                  {discordStatus?.status === 'connected'
                    ? `Bot Online: @${discordStatus.botUser?.username || 'Hana'}`
                    : discordStatus?.status === 'polling'
                    ? 'Connecting to Discord Gateway...'
                    : 'Bot Gateway Offline'}
                </span>
              </div>
              {onConnectDiscord && (
                <button
                  type="button"
                  onClick={onConnectDiscord}
                  className="px-2 py-0.5 rounded-lg bg-white border border-violet-200 hover:bg-violet-100/60 text-violet-700 font-semibold text-[10px] shrink-0 cursor-pointer shadow-2xs"
                >
                  {discordStatus?.status === 'connected' ? 'Active' : 'Keep Online'}
                </button>
              )}
            </div>

            {/* Receiving End Voice Notice & Local Monitor Toggle */}
            <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-200 text-[10px] text-neutral-600 flex items-center justify-between gap-2">
              <span className="truncate">
                🎙️ Voice dispatched to receiving end (not web frontend).
              </span>
              {onToggleFrontendMonitorAudio && (
                <button
                  type="button"
                  onClick={onToggleFrontendMonitorAudio}
                  className={`px-2 py-0.5 rounded-md border font-semibold shrink-0 cursor-pointer text-[10px] ${
                    frontendMonitorAudio
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-white border-neutral-200 text-neutral-600'
                  }`}
                  title="Toggle whether to also play audio through local web frontend speakers"
                >
                  {frontendMonitorAudio ? 'Speaker: Monitoring' : 'Speaker: Muted'}
                </button>
              )}
            </div>

            {/* Input: Target Channel ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Target Channel ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Voice or Text Channel</span>
              </label>
              <input
                type="text"
                value={platformCreds.discord.channelId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    discord: { ...prev.discord, channelId: e.target.value },
                  }))
                }
                placeholder="e.g. 112233445566778899"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-violet-500 focus:bg-white"
              />
            </div>

            {/* Input: Discord Bot Token */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Bot Token</span>
                <button
                  type="button"
                  onClick={() => toggleShowToken('discord_bot')}
                  className="text-[10px] text-violet-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  {showTokens['discord_bot'] ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                  <span>{showTokens['discord_bot'] ? 'Hide' : 'Show'}</span>
                </button>
              </label>
              <input
                type={showTokens['discord_bot'] ? 'text' : 'password'}
                value={platformCreds.discord.botToken}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    discord: { ...prev.discord, botToken: e.target.value },
                  }))
                }
                placeholder="MTI..."
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-violet-500 focus:bg-white"
              />
            </div>

            {/* Input: Guild (Server) ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Guild / Server ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Optional</span>
              </label>
              <input
                type="text"
                value={platformCreds.discord.guildId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    discord: { ...prev.discord, guildId: e.target.value },
                  }))
                }
                placeholder="e.g. 998877665544332211"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-violet-500 focus:bg-white"
              />
            </div>

            {/* Input: Target User ID */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700 flex items-center justify-between">
                <span>Target User ID</span>
                <span className="text-[10px] text-neutral-400 font-normal">Optional (Direct Mention)</span>
              </label>
              <input
                type="text"
                value={platformCreds.discord.targetUserId}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    discord: { ...prev.discord, targetUserId: e.target.value },
                  }))
                }
                placeholder="e.g. 123456789012345678"
                className="w-full px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-mono text-neutral-900 focus:outline-none focus:border-violet-500 focus:bg-white"
              />
            </div>

            {/* Select: Voice Call Routing Mode */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-neutral-700">
                Voice Call Routing Mode
              </label>
              <select
                value={platformCreds.discord.callMode}
                onChange={(e) =>
                  onChangeCreds((prev) => ({
                    ...prev,
                    discord: { ...prev.discord, callMode: e.target.value as any },
                  }))
                }
                className="w-full px-2.5 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs font-medium text-neutral-900 focus:outline-none focus:border-violet-500"
              >
                <option value="voice_channel_direct">Direct Voice Channel Streaming (Join VC &amp; Speak Live via Discord Voice API)</option>
                <option value="voice_bridge">Two-Way Voice Bridge (Call Room + Audio Attachments)</option>
                <option value="direct_call">Direct User Audio DM &amp; Call Alert</option>
                <option value="audio_bot">Interactive Channel Audio Receptionist</option>
              </select>
            </div>

            {/* Direct Discord Voice Channel Audio Streaming Controls */}
            <div className="p-2.5 rounded-xl bg-violet-50/80 border border-violet-200/90 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      discordVoiceState?.connected
                        ? 'bg-emerald-500 ring-2 ring-emerald-200 animate-pulse'
                        : 'bg-neutral-300'
                    }`}
                  />
                  <span className="text-[11px] font-bold text-violet-950 truncate">
                    {discordVoiceState?.connected
                      ? `Voice Channel: #${discordVoiceState.channelName || discordVoiceState.channelId}`
                      : 'Discord Voice Channel (Join VC & Speak)'}
                  </span>
                </div>
                {discordVoiceState?.isSpeaking && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 animate-pulse flex items-center gap-1">
                    <Volume2 className="w-2.5 h-2.5" />
                    Speaking
                  </span>
                )}
              </div>

              <p className="text-[10px] text-violet-800/80 leading-snug">
                Instead of only posting audio files to chat, Hana joins the voice channel directly based on Channel ID and transmits audio using Discord&apos;s Voice Gateway APIs.
              </p>

              <div className="flex items-center gap-1.5 pt-0.5">
                {discordVoiceState?.connected ? (
                  <button
                    type="button"
                    onClick={onLeaveDiscordVoiceChannel}
                    className="flex-1 py-1 px-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-all"
                  >
                    <VolumeX className="w-3 h-3" />
                    <span>Leave Voice Channel</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isJoiningDiscordVc || !platformCreds.discord.channelId}
                    onClick={onJoinDiscordVoiceChannel}
                    className="flex-1 py-1 px-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs transition-all"
                  >
                    {isJoiningDiscordVc ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Joining Voice...</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3 h-3" />
                        <span>Join Voice Channel</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Webhook Endpoint */}
            <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-wider">
                  Discord Interactions / Webhook
                </span>
                <button
                  type="button"
                  onClick={() => onCopyWebhook('discord')}
                  className="text-[10px] font-semibold text-violet-600 hover:text-violet-800 flex items-center gap-1 cursor-pointer"
                >
                  {copiedWebhook === 'discord' ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : <Copy className="w-2.5 h-2.5" />}
                  <span>{copiedWebhook === 'discord' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[10px] font-mono text-neutral-500 break-all bg-white p-1 rounded border border-neutral-200">
                {originUrl}/api/caller/webhooks/discord
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-neutral-100">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={testingPlatform === 'discord'}
                onClick={() => onTestPlatform('discord')}
                className="py-1.5 px-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${testingPlatform === 'discord' ? 'animate-spin' : ''}`} />
                <span>Test Bot</span>
              </button>

              <button
                type="button"
                disabled={dispatchingPlatform === 'discord'}
                onClick={() => onDispatchCall('discord')}
                className="py-1.5 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Dispatch Call</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => onSimulateInbound('discord')}
              className="w-full py-1 rounded-lg bg-violet-50 hover:bg-violet-100/70 border border-violet-200 text-violet-800 text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer"
            >
              <Radio className="w-3 h-3 text-violet-600 animate-pulse" />
              <span>Simulate Inbound Discord Call</span>
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* TILE 4: OMNICHANNEL LIVE EVENT STREAM & CONSOLE          */}
      {/* ======================================================== */}
      <div className="rounded-2xl p-4 bg-white border border-neutral-200/90 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-700 shrink-0">
              <Activity className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-heading text-neutral-900">
                Omnichannel Live Event Stream &amp; Dispatch Console
              </h3>
              <p className="text-[11px] text-neutral-500">
                Real-time webhook events, handshake status, and cross-platform RAG receptionist logs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all">
              <Upload className="w-3 h-3" />
              <span>Import Config</span>
              <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
            </label>

            <button
              type="button"
              onClick={handleExportConfig}
              className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all"
            >
              <Download className="w-3 h-3" />
              <span>Export Config</span>
            </button>

            <button
              type="button"
              onClick={onClearLogs}
              className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 text-neutral-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Logs</span>
            </button>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all"
            >
              <span>Reset Credentials</span>
            </button>
          </div>
        </div>

        {/* Live Event Stream Viewport */}
        <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-neutral-50 border border-neutral-200 font-mono text-xs">
          {activityLogs.length === 0 ? (
            <div className="py-6 text-center text-neutral-400 text-[11px]">
              No dispatch events recorded yet. Click &ldquo;Test Handshake&rdquo; or &ldquo;Simulate Inbound&rdquo; above.
            </div>
          ) : (
            activityLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between gap-2 p-2 rounded-lg bg-white border border-neutral-200/80 text-[11px] leading-tight"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                      log.platform === 'whatsapp'
                        ? 'bg-emerald-100 text-emerald-800'
                        : log.platform === 'telegram'
                        ? 'bg-sky-100 text-sky-800'
                        : log.platform === 'messenger'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-neutral-200 text-neutral-800'
                    }`}
                  >
                    {log.platform}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900 truncate">
                      {log.action}
                      {log.target ? ` · to ${log.target}` : ''}
                    </p>
                    {log.message && (
                      <p className="text-neutral-500 font-sans text-[11px] truncate mt-0.5">
                        {log.message}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-neutral-400">
                  <span>{log.timestamp}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      log.status === 'success'
                        ? 'bg-emerald-500'
                        : log.status === 'failed'
                        ? 'bg-rose-500'
                        : log.status === 'pending'
                        ? 'bg-amber-500 animate-pulse'
                        : 'bg-neutral-400'
                    }`}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
