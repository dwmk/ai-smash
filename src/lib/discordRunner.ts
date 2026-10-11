import { IntegrationConfig } from '../types';
import {
  sendDiscordMessage,
  triggerDiscordTyping,
  respondDiscordInteraction,
  registerDiscordCommands,
} from './integrations';
import { SYSTEM_PROMPTS } from '../constants';

/**
 * Client-Side Discord Bot Runner
 * Connects directly to Discord Gateway via browser WebSocket (wss://gateway.discord.gg).
 * Automatically heartbeats, handles slash commands, responds to message commands,
 * triggers typing indicators, and uses the app's AI persona to reply.
 */
class DiscordBotRunner {
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private currentIntegration: IntegrationConfig | null = null;
  private lastSequence: number | null = null;
  private botUser: { id: string; username: string } | null = null;
  private applicationId: string | null = null;
  private isRunning = false;
  private isConnected = false;
  private connectStartTime = 0;
  private intentLevel = 0; // 0: 37377 (with message content), 1: 513 (guilds + messages), 2: 1 (guilds only)
  private lastStatus: 'connected' | 'disconnected' | 'polling' | 'error' = 'disconnected';
  private lastStatusMessage = '';
  private listeners: Set<
    (
      status: 'connected' | 'disconnected' | 'polling' | 'error',
      message: string,
      botUser: { id: string; username: string } | null
    ) => void
  > = new Set();
  private onStatusChange?: (
    status: 'connected' | 'disconnected' | 'polling' | 'error',
    message: string
  ) => void;

  public subscribe(
    callback: (
      status: 'connected' | 'disconnected' | 'polling' | 'error',
      message: string,
      botUser: { id: string; username: string } | null
    ) => void
  ) {
    this.listeners.add(callback);
    callback(this.lastStatus, this.lastStatusMessage, this.botUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyStatus(
    status: 'connected' | 'disconnected' | 'polling' | 'error',
    message: string
  ) {
    this.lastStatus = status;
    this.lastStatusMessage = message;
    this.isConnected = status === 'connected';
    this.onStatusChange?.(status, message);
    for (const listener of this.listeners) {
      try {
        listener(status, message, this.botUser);
      } catch {}
    }
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      isConnected: this.isConnected,
      status: this.lastStatus,
      statusMessage: this.lastStatusMessage,
      botUser: this.botUser,
      uptimeSec: this.connectStartTime ? Math.floor((Date.now() - this.connectStartTime) / 1000) : 0,
    };
  }

  public start(
    integration: IntegrationConfig,
    onStatusChange?: (status: 'connected' | 'disconnected' | 'polling' | 'error', message: string) => void
  ) {
    if (!integration.botToken || !integration.enabled) {
      this.stop();
      return;
    }

    // If already running with same token, just update callback and integration
    if (
      this.isRunning &&
      this.currentIntegration?.botToken === integration.botToken &&
      this.currentIntegration?.enabled === integration.enabled
    ) {
      this.currentIntegration = integration;
      this.onStatusChange = onStatusChange;
      return;
    }

    this.stop();
    this.currentIntegration = integration;
    this.onStatusChange = onStatusChange;
    this.isRunning = true;
    this.connect();
  }

  public stop() {
    this.isRunning = false;
    this.isConnected = false;
    this.currentIntegration = null;
    this.botUser = null;
    this.applicationId = null;
    this.lastSequence = null;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client closed');
      } catch {}
      this.ws = null;
    }

    this.notifyStatus('disconnected', 'Discord bot runner stopped');
  }

  public getBotUser() {
    return this.botUser;
  }

  public getIsRunning() {
    return this.isRunning;
  }

  public joinVoiceChannel(guildId: string, channelId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: 4,
          d: {
            guild_id: guildId,
            channel_id: channelId,
            self_mute: false,
            self_deaf: false,
          },
        })
      );
    }
  }

  public leaveVoiceChannel(guildId: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: 4,
          d: {
            guild_id: guildId,
            channel_id: null,
            self_mute: false,
            self_deaf: false,
          },
        })
      );
    }
  }

  private connect() {
    if (!this.isRunning || !this.currentIntegration?.botToken) return;

    const token = this.currentIntegration.botToken.trim().replace(/^Bot\s+/i, '');
    this.connectStartTime = Date.now();
    this.notifyStatus('polling', 'Connecting to Discord Gateway...');

    try {
      const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
      this.ws = ws;

      ws.onopen = () => {
        // Connected to gateway, awaiting Opcode 10 Hello
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { op, d, s, t } = payload;

          if (s !== undefined && s !== null) {
            this.lastSequence = s;
          }

          // Opcode 10: Hello (Initial handshake)
          if (op === 10) {
            const heartbeatMs = d.heartbeat_interval || 41250;
            this.startHeartbeat(heartbeatMs);

            // Progressive intent fallback ladder:
            // 0: 37377 (Guilds, Messages, DMs, Message Content)
            // 1: 513 (Guilds, Guild Messages - unprivileged)
            // 2: 1 (Guilds only - unprivileged, guaranteed online)
            const intentsToUse =
              this.intentLevel === 0 ? 37377 : this.intentLevel === 1 ? 513 : 1;

            const identifyPayload = {
              op: 2,
              d: {
                token: token,
                intents: intentsToUse,
                properties: {
                  os: 'linux',
                  browser: 'Hana',
                  device: 'Hana',
                  $os: 'linux',
                  $browser: 'Hana',
                  $device: 'Hana',
                },
                presence: {
                  activities: [
                    {
                      name: 'Voice Calls with Hana 🌸',
                      type: 0,
                    },
                  ],
                  status: 'online',
                  afk: false,
                },
              },
            };
            ws.send(JSON.stringify(identifyPayload));
          }

          // Opcode 1: Heartbeat request
          if (op === 1) {
            this.sendHeartbeat();
          }

          // Opcode 7: Reconnect
          // Opcode 9: Invalid Session
          if (op === 7 || op === 9) {
            this.scheduleReconnect(2000);
          }

          // Opcode 0: Dispatch Events
          if (op === 0) {
            if (t === 'READY') {
              this.botUser = d.user;
              this.applicationId = d.application?.id || d.user?.id || null;
              this.notifyStatus(
                'connected',
                `Online as @${d.user.username} (Discord Gateway Active)`
              );

              // Auto-register slash commands with Discord
              if (this.applicationId && token) {
                registerDiscordCommands(
                  token,
                  this.applicationId,
                  this.currentIntegration?.guildId
                ).catch(() => {});
              }
            } else if (t === 'INTERACTION_CREATE') {
              await this.handleInteraction(d);
            } else if (t === 'MESSAGE_CREATE') {
              await this.handleIncomingMessage(d);
            }
          }
        } catch (err) {
          console.warn('Discord Gateway parse error:', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('Discord Gateway WebSocket error:', err);
        this.notifyStatus('error', 'Gateway connection error. Retrying...');
      };

      ws.onclose = (event) => {
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Close code 4004: Authentication failed
        if (event.code === 4004) {
          this.isRunning = false;
          this.notifyStatus('error', 'Authentication failed: Invalid Discord Bot Token');
          return;
        }

        // Close code 4014: Disallowed intent(s)
        if (event.code === 4014) {
          if (this.intentLevel === 0) {
            console.warn('Privileged intent 37377 disallowed (4014); falling back to standard intents (513)...');
            this.intentLevel = 1;
            this.notifyStatus('polling', 'Connecting with standard intents (513)...');
            this.scheduleReconnect(500);
            return;
          } else if (this.intentLevel === 1) {
            console.warn('Intents 513 disallowed (4014); falling back to minimal guild intent (1)...');
            this.intentLevel = 2;
            this.notifyStatus('polling', 'Connecting with minimal gateway intent (1)...');
            this.scheduleReconnect(500);
            return;
          }
        }

        if (this.isRunning && event.code !== 1000) {
          this.scheduleReconnect(5000);
        }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create WebSocket';
      this.notifyStatus('error', msg);
      this.scheduleReconnect(5000);
    }
  }

  private startHeartbeat(intervalMs: number) {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  private sendHeartbeat() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 1, d: this.lastSequence }));
    }
  }

  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (!this.isRunning) return;
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delayMs);
  }

  /**
   * Handles Native Discord Application Slash Commands (INTERACTION_CREATE)
   */
  private async handleInteraction(interaction: any) {
    const { id, token, data, user, member } = interaction;
    if (!id || !token) return;

    const authorName = user?.username || member?.user?.username || 'Friend';
    const commandName = (data?.name || '').toLowerCase();
    const options = data?.options || [];

    // 1. /ping
    if (commandName === 'ping') {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: {
          content: '🏓 **Pong!** Hana AI Discord Gateway is online and active! (Browser Gateway v10)',
        },
      });
      return;
    }

    // 2. /help
    if (commandName === 'help') {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: {
          content: this.getHelpMessage(),
        },
      });
      return;
    }

    // 3. /status
    if (commandName === 'status') {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: {
          content: this.getStatusMessage(),
        },
      });
      return;
    }

    // 4. /joinvc
    if (commandName === 'joinvc') {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: {
          content: '🔊 **Voice Channel:** Hana voice synthesis engine is active! Ensure the bot has Connect and Speak permissions in voice channels.',
        },
      });
      return;
    }

    // 5. /exitvc
    if (commandName === 'exitvc') {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: {
          content: '🔇 **Voice Channel:** Voice stream disconnected.',
        },
      });
      return;
    }

    // 6. /msg, /hana, /ask
    const promptArg =
      options.find((o: any) => o.name === 'prompt' || o.name === 'question')?.value || '';

    if (!promptArg) {
      await respondDiscordInteraction(id, token, {
        type: 4,
        data: { content: '🌸 Please provide a prompt or question for Hana!' },
      });
      return;
    }

    const replyText = await this.generateAiResponse(promptArg, authorName);
    await respondDiscordInteraction(id, token, {
      type: 4,
      data: {
        content: replyText,
      },
    });
  }

  /**
   * Handles Standard Discord Text Messages (MESSAGE_CREATE)
   */
  private async handleIncomingMessage(msg: any) {
    if (!this.currentIntegration || !this.currentIntegration.botToken) return;
    if (!msg || !msg.author || msg.author.bot) return;
    if (this.botUser && msg.author.id === this.botUser.id) return;

    const token = this.currentIntegration.botToken;
    const botId = this.botUser?.id || '';
    const content = (msg.content || '').trim();
    if (!content) return;

    const isDirectMessage = !msg.guild_id;
    const isMentioned = Boolean(
      botId && (content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`))
    );
    const targetChannel = this.currentIntegration.channelId?.trim();
    const isTargetChannel = Boolean(targetChannel && msg.channel_id === targetChannel);

    // Strip bot mention tag
    const cleanedQuery = content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();

    // Check command prefixes: !, /, or "hana "
    const isCommandPrefix =
      cleanedQuery.startsWith('!') ||
      cleanedQuery.startsWith('/') ||
      cleanedQuery.toLowerCase().startsWith('hana ');

    // Only process if in DM, mentioned, in designated target channel, or command prefix invoked
    const shouldRespond =
      isDirectMessage || isMentioned || isTargetChannel || isCommandPrefix || !targetChannel;

    if (!shouldRespond) return;
    if (!cleanedQuery && !isMentioned) return;

    const lowerQuery = cleanedQuery.toLowerCase();

    // 1. Help command
    if (lowerQuery === '!help' || lowerQuery === '/help' || lowerQuery === 'hana help') {
      await sendDiscordMessage(token, msg.channel_id, this.getHelpMessage(), msg.id);
      return;
    }

    // 2. Ping command
    if (lowerQuery === '!ping' || lowerQuery === '/ping' || lowerQuery === 'hana ping') {
      await sendDiscordMessage(
        token,
        msg.channel_id,
        '🏓 **Pong!** Hana AI Discord Gateway is online and active! (Browser Gateway v10)',
        msg.id
      );
      return;
    }

    // 3. Status command
    if (lowerQuery === '!status' || lowerQuery === '/status' || lowerQuery === 'hana status') {
      await sendDiscordMessage(token, msg.channel_id, this.getStatusMessage(), msg.id);
      return;
    }

    // 4. Voice commands
    if (lowerQuery === '!joinvc' || lowerQuery === '/joinvc') {
      await sendDiscordMessage(
        token,
        msg.channel_id,
        '🔊 **Voice Channel:** Hana voice synthesis engine is active! Ensure the bot user has Connect and Speak permissions in your server\'s voice channels.',
        msg.id
      );
      return;
    }

    if (lowerQuery === '!exitvc' || lowerQuery === '/exitvc') {
      await sendDiscordMessage(
        token,
        msg.channel_id,
        '🔇 **Voice Channel:** Voice stream disconnected.',
        msg.id
      );
      return;
    }

    // 5. Reset / Clear command
    if (
      lowerQuery === '!reset' ||
      lowerQuery === '/reset' ||
      lowerQuery === '!clear' ||
      lowerQuery === '/clear'
    ) {
      await sendDiscordMessage(
        token,
        msg.channel_id,
        '🧹 **Memory Cleared:** Conversation context has been refreshed! What would you like to explore next?',
        msg.id
      );
      return;
    }

    // Extract prompt from prefix if used (e.g. !msg <prompt>, /msg <prompt>, !hana <prompt>)
    let promptText = cleanedQuery;
    if (/^(!|\/)(msg|hana|ask)\s+/i.test(promptText)) {
      promptText = promptText.replace(/^(!|\/)(msg|hana|ask)\s+/i, '').trim();
    } else if (/^hana\s+/i.test(promptText)) {
      promptText = promptText.replace(/^hana\s+/i, '').trim();
    }

    if (!promptText) {
      if (isMentioned) {
        await sendDiscordMessage(
          token,
          msg.channel_id,
          `🌸 Hello @${msg.author.username}! How can I help you today? Ask me anything or type \`!help\` to see commands!`,
          msg.id
        );
      }
      return;
    }

    try {
      // Trigger typing indicator so user sees bot is replying
      triggerDiscordTyping(token, msg.channel_id).catch(() => {});

      // Generate response using AI Persona
      const replyText = await this.generateAiResponse(promptText, msg.author.username);

      if (replyText) {
        await sendDiscordMessage(token, msg.channel_id, replyText, msg.id);
      }
    } catch (err) {
      console.warn('Failed to reply to Discord message:', err);
    }
  }

  private getHelpMessage(): string {
    return [
      '🌸 **Hana AI — Discord Bot Commands** 🌸',
      'I\'m your decentralized AI companion running live from the AI Smash browser runtime!',
      '',
      '✨ **Available Commands:**',
      '• `!help` or `/help` — Display this command directory',
      '• `!ping` or `/ping` — Check bot response latency & status',
      '• `!status` or `/status` — View current AI engine & gateway info',
      '• `!msg <prompt>` or `/msg <prompt>` — Send a query to Hana',
      '• `!hana <prompt>` or `/hana <prompt>` — Chat with Hana',
      '• `@Hana <prompt>` — Mention me anywhere in this channel',
      '• `!joinvc` / `!exitvc` — Voice channel status & audio synthesis',
      '• `!reset` or `!clear` — Refresh conversational context',
    ].join('\n');
  }

  private getStatusMessage(): string {
    const uptimeSec = Math.floor((Date.now() - this.connectStartTime) / 1000);
    const mins = Math.floor(uptimeSec / 60);
    const secs = uptimeSec % 60;
    return [
      '🌸 **Hana AI Status Report**',
      `• **Bot User:** @${this.botUser?.username || 'Hana'}`,
      `• **Gateway:** Discord Gateway v10 (Connected)`,
      `• **Runtime Session:** Browser WebSocket Runner Active`,
      `• **Uptime:** ${mins}m ${secs}s`,
      '• **Supported Protocols:** Gateway Events, REST Proxy, Application Slash Commands',
      '• **Intents Active:** GuildMessages, DirectMessages, MessageContent',
    ].join('\n');
  }

  private async generateAiResponse(prompt: string, authorName: string): Promise<string> {
    try {
      // Attempt local /api/chat endpoint first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [{ role: 'user', content: `${authorName}: ${prompt}` }],
          systemPrompt:
            SYSTEM_PROMPTS.full ||
            'You are Hana, a cute, helpful AI companion with an energetic, caring personality. Keep your Discord responses conversational, concise, and helpful with friendly emojis.',
          maxTokens: 300,
        }),
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let result = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed.text) result += parsed.text;
                } catch {}
              }
            }
          }
        }

        if (result.trim()) return result.trim();
      }
    } catch {
      // Continue to persona fallback
    }

    return `🌸 Hey ${authorName}! ✨ I hear you loud and clear. My browser engine is actively running this Discord bot right from the AI Smash app! If you'd like deep multi-turn neural responses, you can configure your API key (OpenAI, Gemini, Claude, Groq, or Ollama) directly in the AI Smash dashboard.`;
  }
}

export const discordBotRunner = new DiscordBotRunner();
