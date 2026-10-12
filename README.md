# Hana Intelligence

> A private, responsive conversational platform combining in-browser Small Language Models (SLMs), cloud AI endpoints, and an interactive 3D humanoid avatar with full-body physics. (+ more)

previously known as **AI Smash**.

![](https://muxai.vercel.app/aismash_banner.png)

based on a derivative of the [MuxAI](https://github.com/muxai/muxai-platform) platform.

## Active web versions
- [[🌐 Live deployment]](https://aismash.web.app)
- [[🛠️ Beta deployment]](https://ai-smash.vercel.app)

---

## Tech Stack & Concepts

`React 19` `TypeScript` `Vite` `Tailwind CSS` `Three.js` `@pixiv/three-vrm` `@pixiv/three-vrm-springbone` `GLTFLoader` `Mixamo Retargeting` `Hugging Face Transformers.js` `ONNX Runtime Web` `WebGPU API` `WebAssembly (WASM)` `FP16 Half-Precision Quantization` `Q4 Quantization` `SpeechSynthesis API` `Web Audio API` `Phoneme-to-Viseme Lip Sync` `Damped Harmonic Spring Physics` `Verlet Integration` `Centrifugal & Rotational Inertia Dynamics` `Raycasting Interaction` `Ollama REST API` `Server-Sent Events (SSE)` `Express.js` `Google GenAI SDK` `IndexedDB API` `Cache API` `LocalStorage API` `Origin Private File System (OPFS)` `Responsive UI` `Offline-First Architecture` `Edge Computing`

---

## Overview

This platform is a full-stack conversational application uniting persona-driven dialogue with on-device client-side Small Language Models (SLMs) and server-side LLMs. Built with React 19, TypeScript, Vite, Tailwind CSS, Three.js, `@pixiv/three-vrm`, and Hugging Face Transformers.js ONNX Web Runtime, the application can run entirely within your web browser with zero server dependency, or optionally connect to local/remote Ollama backend instances and cloud AI APIs.

The integrated 3D view features a humanoid VRM 1.0 avatar with retargeted Mixamo idle motions, real-time audio viseme lip-synchronization, procedural gaze and saccade tracking, full-body physical inertial dynamics when rotating, and physical impact absorption on user interactions.

---

## Key Features

- **In-Browser Edge SLM Neural Inference**: Execute lightweight Small Language Models (SmolLM2-135M, SmolLM2-360M, Qwen2.5-0.5B, MiniCPM5-2B, Llama-3.2-1B) directly in the client browser using Hugging Face Transformers.js and ONNX Runtime Web.
- **WebGPU & WASM Hardware Acceleration**: Automatic device detection prioritizing WebGPU execution, graceful fallback to multi-threaded WebAssembly with FP16/Q4 quantization, and persistent model weight caching in browser storage.
- **Interactive 3D Avatar with Full-Body Physics**: Three.js-rendered VRM 1.0 humanoid avatar featuring Mixamo idle motion retargeting, 3D look-at cursor tracking with ocular alignment, procedural eye blinks and micro-saccades, physical recoil impulses on pointer tap (spine/chest recoil, arm jolt, hip absorption, spring bone flutter), and full-body rotational inertia (spine torsional lag, arm centrifugal swing, and boosted secondary physics).
- **Real-Time Phonetic Lip Synchronization**: Centralized viseme analyzer processing voice synthesis audio to actuate VRM mouth shapes (`aa`, `oh`, `ou`, `ih`, `ee`) in direct sync with spoken voice synthesis and contextual facial expressions.
- **High-Quality Voice Bank Selection**: Automatic prioritizer selecting the highest quality modern neural, natural, enhanced, and premium female speech synthesis voices available across operating systems.
- **Cloud & Self-Hosted Ollama Support**: Connect to cloud Ollama servers or private local endpoints (e.g., `http://localhost:11434`), featuring live auto-ping, model tag enumeration, and CORS-friendly streaming.
- **Continuous Health Check & Auto-Failover**: Automated 5-second health checks continuously monitor remote servers; if a connected server goes offline, the app seamlessly switches to a local in-browser model and alerts the user with an auto-dismissing notice.
- **Comprehensive Session Management**: Complete client-side conversation storage, full-text dialogue search, message audio playback, editable user prompts, customizable token budgets, and granular cache/storage management.
- **Dynamic Multi-Theme Engine & Custom Palette Creator**: Rich selection of dynamic light and dark theme presets (Classic Light, Classic Dark, Cyber Velvet, Midnight Sakura, Neon Synthwave, Strawberry Meadows, Sunny Lemonade, Sweet Sunflowers, Peppermint Syrup, Matcha Blossom, Emerald Grove, Desert Honey) with dynamic CSS variables, custom color picker modal, and persistent theme definitions.
- **Wardrobe System with Live 3D Previews**: Switch between diverse VRM humanoid outfits (Mint Maid Apron, Candy Maid Apron, Imperial Noblewoman, Lavender Grace Dress, Sakura Spring, School Uniform, Streetlit Hoodie, Mux Future, Cozy Canadian Winter) rendered via shared WebGL offscreen portrait viewports.
- **Optional Cloud Account Sync (NeonDB PostgreSQL)**: Optional account authentication and cloud backup for conversations, custom themes, and user settings across devices, preserving user privacy without mandatory lock-in.
- **Webhook Integrations Ecosystem**: Connect AI Smash conversations with automated workflow pipelines including Discord, Slack, n8n, and Zapier webhooks.

---

## Architecture

```
edge-ai-platform/
├── server.ts                    # Express backend (VRM proxy, animation proxy, NeonDB auth, Ollama & Gemini streaming)
├── src/
│   ├── App.tsx                  # Main application orchestrator & chat interface
│   ├── components/
│   │   ├── AddIntegrationModal.tsx # Webhook integrations modal (Discord, Slack, n8n, Zapier)
│   │   ├── AttachedFilesPreview.tsx # Media, document, and attachment chips
│   │   ├── ChatInput.tsx        # Message input, model selector trigger, token budget, and send controls
│   │   ├── CustomThemeModal.tsx # Interactive color palette builder for custom themes
│   │   ├── DocsPage.tsx         # Documentation and guide center
│   │   ├── Header.tsx           # Navigation bar, profile access, 3D mode switch, and modal triggers
│   │   ├── LandingHeroCanvas.tsx # Landing page interactive 3D hero viewport
│   │   ├── LandingPage.tsx      # Platform overview, feature highlights & showcase
│   │   ├── MaxTokensSelector.tsx # Configurable token budget dropdown
│   │   ├── MessageItem.tsx      # Individual message card, speech synthesis, and token metrics
│   │   ├── MessageList.tsx      # Conversation scrollable feed with starter prompts
│   │   ├── ModelSelector.tsx    # Drop-up menu for in-browser SLMs and cloud/local Ollama models
│   │   ├── SearchBar.tsx        # In-conversation search and message filter modal
│   │   ├── SettingsModal.tsx    # Hardware acceleration preferences & browser storage manager
│   │   ├── Sidebar.tsx          # Conversation sessions, MuxAI account auth, and storage drawer
│   │   ├── SplashScreen.tsx     # Startup brand intro screen with auto-dismiss
│   │   ├── TelemetryBar.tsx     # Real-time hardware compute, speed, and latency status bar
│   │   ├── ThemeSidebar.tsx     # Themes & live 3D wardrobe portrait gallery
│   │   ├── TwitterProfileModal.tsx # Persona social profile modal with banner crossfade
│   │   ├── VRMCanvas.tsx        # Three.js 3D VRM humanoid avatar, Mixamo idle, look-at & full-body physics
│   │   └── VRMSubtitles.tsx     # Real-time karaoke-style viseme speech subtitles
│   ├── constants/
│   │   └── index.ts             # Central single configuration file (prompts, models, endpoints, constants)
│   ├── db/
│   │   ├── init_neondb.sql      # Database schema for accounts, sessions, conversations, and custom themes
│   │   └── neondb.ts            # NeonDB PostgreSQL client for accounts and cloud sync
│   ├── lib/
│   │   ├── audio.ts             # Web Audio API acoustic effects and high-quality voice resolution
│   │   ├── integrations.ts      # Webhook dispatch engine for Discord, Slack, n8n, and Zapier
│   │   ├── lipSync.ts           # SpeechSynthesis phoneme-to-viseme mapping & facial articulation
│   │   ├── models.ts            # Local SLM specifications, VRAM budgets, and model catalog
│   │   ├── ollama.ts            # Ollama connectivity ping, tags enumeration, and streaming client
│   │   ├── prompts.ts           # System prompt sanitization and text output cleanup
│   │   ├── slmEngine.ts         # Transformers.js ONNX Web pipeline, device detection, and token streaming
│   │   ├── storage.ts           # Storage persistence, cache cleanup, and state management
│   │   └── vrmCache.ts          # Cache API & IndexedDB manager for 3D VRM models and animations
│   ├── types/
│   │   └── index.ts             # Core TypeScript interfaces for models, messages, and telemetry
│   ├── index.css                # Tailwind CSS styling, dynamic theme tokens, and custom animations
│   └── main.tsx                 # React DOM root entry point
├── index.html                   # HTML entry point with metadata & OpenGraph tags
├── package.json                 # Project dependencies, scripts, and runtime engines
├── tsconfig.json                # TypeScript compiler configuration
└── vite.config.ts               # Vite bundler configuration
```

![](https://muxai.vercel.app/promo/Hana%20AI.jpg)

---

## Live API Endpoints & Specification

The full-stack Express server (`server.ts`) exposes production-ready endpoints serving AI inference, 3D asset streaming, autonomous tools, MCP protocol events, and account management:

### 1. LM Chat & Emotion Analysis
| Method | URL | Description & Purpose |
|---|---|---|
| `POST` | `/api/chat` | Server-Sent Events (SSE) streaming endpoint for responsive persona dialogue. |
| `POST` | `/api/chat/provider` | Universal multi-provider LLM streaming proxy supporting external keys for OpenAI, Anthropic Claude, xAI, Groq, DeepSeek, Z.ai, Qwen, and Hugging Face. |
| `POST` | `/api/emotion` | **Full-Message Emotion Classifier**: Analyzes the entire completed AI response (evaluating overall sentiment, tone, and lexical density across all sentences) to determine the 3D avatar's facial expression using a pure algorithm (zero Gemini/LLM usage) to return `"happy"` (relaxed eyes, mouth slightly open), `"smug"` (relaxed smirk), `"sad"`, `"angry"`, `"surprised"`, or `"neutral"`. |

### 2. MuxAI Humanizer & Turnitin-Reverse Engine (`/humanizer`)
- **Route URLs**: `/humanizer`, with automatic redirects from `/ai-detector`, `/ai-detect`, and `/humanize`.
- **Purpose**: A Turnitin-style split-view AI detection and text humanizer. Defeats Turnitin, GPTZero, and CopyLeaks by elevating sentence burstiness, eradicating machine clichés (e.g., "delve into", "testament to", "crucial role"), and injecting natural syntactic rhythm.
- **Engines**: Defaults to the instant, zero-LLM Turnitin-Reverse Algorithm, with model selection supporting in-browser SLMs and cloud models (reusing `/chat`'s submodel and API key selectors).
- **Audio Voice Synthesis**: Features personalized time-of-day voice greetings and dynamic completion voicelines from Hana.
- **Export Options**: Formatted text output, Microsoft Word (`.doc`), printable PDF report, and plain text (`.txt`).
- **Endpoints**:
  - `POST` `/api/extract-document-text`: High-fidelity server and client document extractor for PDF and Word (`.docx`/`.doc`) files, stripping binary bytecode and PDF formatting so users get clean, readable text.

### 3. Live 3D Assets & Animation Streams
| Method | URL | Description & Purpose |
|---|---|---|
| `GET` | `/api/vrm` | High-performance proxy and stream for 3D humanoid `.vrm` character models to bypass cross-origin resource sharing (CORS) blocks. |
| `GET` | `/api/animation/:type` | Proxies Mixamo character animation FBX assets (`/api/animation/idle`, `/api/animation/fall`, `/api/animation/getup`, `/api/animation/walk`, `/api/animation/wave`, `/api/animation/yawn`, `/api/animation/wait`). |

### 4. Ollama Local & Remote Streaming
| Method | URL | Description & Purpose |
|---|---|---|
| `POST` | `/api/ollama/ping` | Connectivity health check for local or remote Ollama instances; inspects loaded models via `/api/tags` and `/v1/models`. |
| `POST` | `/api/ollama/chat` | Cloud proxy and streaming endpoint for Ollama instances with custom system prompts and token predictability limits. |

### 5. Autonomous Agent Tools
| Method | URL | Description & Purpose |
|---|---|---|
| `GET` | `/api/tools/web-search` | Live internet search engine querying DuckDuckGo Instant Answers with Wikipedia search fallback (`?q=query&limit=5`). |
| `GET` | `/api/tools/wikipedia` | Retrieves structured encyclopedia summaries, article URLs, and thumbnail assets from Wikipedia REST API (`?q=topic`). |
| `GET` | `/api/tools/weather` | Live meteorological conditions and daily forecast querying Open-Meteo geocoding and forecast APIs (`?city=Tokyo` or `?lat=..&lon=..`). |
| `POST` | `/api/tools/execute` | Universal execution gateway dispatching tool requests for web search, weather, Wikipedia, and client environment inspectors. |

### 6. Model Context Protocol (MCP) & Avatar Actor Engine
| Method | URL | Description & Purpose |
|---|---|---|
| `GET` | `/api/mcp` | Discovery endpoint reporting MCP server manifest, protocol version `2024-11-05`, registered tools, prompts, and resources. |
| `GET` | `/api/mcp/sse` | MCP Server-Sent Events (SSE) transport endpoint establishing long-lived bidirectional JSON-RPC sessions. |
| `POST` | `/api/mcp/messages` | MCP JSON-RPC 2.0 message dispatcher handling `initialize`, `tools/list`, `tools/call`, `resources/read`, and `prompts/list`. |
| `GET` | `/api/avatar/events` | Real-time SSE event bus streaming live avatar speech, emotion changes, and animations to connected client viewports. |
| `POST` | `/api/avatar/action` | Dispatches live avatar actor directives (`action`, `text`, `emotion`, `animation`, `cues`) to all listening 3D clients. |

### 7. Universal GraphQL API & Third-Party Client Integration
- **Docs Guide**: Available at `/docs/api/third-party-avatar` (Hana 3D) with live interactive query explorer.
- **Endpoint**: `POST` & `GET` `/api/graphql`
- **Purpose**: Enables external client applications (React, Vue, Three.js, Electron, OBS overlays, mobile webviews) to query and control Hana in a single strongly-typed schema:
  - `avatar`: Current VRM asset URL, fallback mirrors, and 16+ wardrobe outfits catalog.
  - `animations`: Mixamo retargeting animation clips (`idle`, `walk`, `wave`, `fall`, `getup`, `yawn`, `wait`).
  - `emotions`: 6 facial expression blendshapes (`neutral`, `happy`, `smug`, `sad`, `angry`, `surprised`).
  - `voiceEngine`: Speech synthesis rate, pitch, female priority voices, and phoneme-to-viseme lip-sync maps (`aa`, `ih`, `ou`, `ee`, `oh`).
  - `activeLlm`: Catalog of in-browser ONNX SLMs and external LLM cloud providers.
  - `mutations`: `setAvatarAction` (dispatches live avatar movements across viewports) and `detectEmotion` (classifies text emotion).

### 8. User Account, Auth & Database Sync (NeonDB PostgreSQL)
| Method | URL | Description & Purpose |
|---|---|---|
| `GET` | `/api/health` | System health check reporting service status, active persona, Gemini key status, and NeonDB database connection. |
| `GET` | `/api/account/status` | Verifies whether the PostgreSQL pool is connected or running in fallback in-memory mode. |
| `POST` | `/api/auth/signup` | Registers a new account with cryptographically salted `scryptSync` password hashing and device fingerprinting. |
| `POST` | `/api/auth/signin` | Authenticates account credentials and returns synced conversations and custom color themes. |
| `POST` | `/api/account/profile` | Updates user profile metadata including username, display name, avatar URL, equipped 3D outfit, and active theme ID. |
| `POST` | `/api/account/redeem` | Validates and activates VIP promo codes (e.g. `MUXAI-PREMIUM-2026`, `HANA-VIP`) granting access to premium outfit tiers. |
| `POST` | `/api/account/sync` | Atomically commits user conversation histories and custom theme palettes to the cloud database. |
| `POST` | `/api/account/data` | Fetches backed-up conversations and user themes for cross-device state hydration. |

### 9. External Messaging & Discord Bot Engine
| Method | URL | Description & Purpose |
|---|---|---|
| `POST` | `/api/discord/test` | Validates Discord bot tokens and queries bot profile information (`@me`) via the Discord REST API v10. |
| `POST` | `/api/discord/send` | Dispatches formatted text responses to Discord channels via server proxy, eliminating client-side browser CORS restrictions. |
| `POST` | `/api/discord/typing` | Triggers the native Discord typing indicator in the target channel while Hana generates an AI response. |
| `POST` | `/api/discord/interaction` | Proxies Discord application slash command interaction callbacks (`/interactions/:id/:token/callback`). |
| `POST` | `/api/discord/register-commands` | Registers global or guild-scoped application slash commands (`/msg`, `/hana`, `/ask`, `/help`, `/ping`, `/status`, `/joinvc`, `/exitvc`) on Discord API v10. |

#### Discord Bot Architecture & Command System
- **Browser Gateway Runner**: Uses direct WebSocket connections (`wss://gateway.discord.gg/?v=10&encoding=json`) running in background browser sessions. Automatically manages Opcode 10 Hello handshakes, Opcode 1 heartbeats (with jitter), and Opcode 2 Identify.
- **Gateway Intents (37377)**: Configured with `Guilds` (1), `GuildMessages` (512), `DirectMessages` (4096), and `MessageContent` (32768) to receive both server channel messages and direct messages (DMs).
- **Supported Command Set**:
  - `!help` / `/help` — Interactive command directory and usage guide.
  - `!ping` / `/ping` — Verifies round-trip gateway latency and operational health.
  - `!status` / `/status` — Displays runtime session details, uptime, and active model telemetry.
  - `!msg <prompt>` / `/msg <prompt>` — Direct prompt query to Hana.
  - `!hana <prompt>` / `/hana <prompt>` or `!ask <question>` — Conversational interaction with Hana persona.
  - `@Hana <prompt>` — Mention detection in any server channel.
  - `!joinvc` / `/joinvc` — Voice channel synthesis status directive.
  - `!exitvc` / `/exitvc` — Voice channel disconnect directive.
  - `!reset` / `/clear` — Clears conversation context for the channel.
- **Discord Developer Portal Prerequisites**:
  1. Under **Bot -> Privileged Gateway Intents**, enable **Message Content Intent** (and Server Members Intent).
  2. Under **OAuth2 -> URL Generator**, select scopes `bot` and `applications.commands`, with permissions `Send Messages`, `Read Message History`, and `Attach Files`.
  3. Enter your Bot Token in AI Smash under **+ -> Add integration -> Discord**; settings persist securely in browser localStorage.

---

## Cloud Sync & Cross-Device Portability

AI Smash provides an optional, privacy-respecting account system:

- **Optional by Design**: All core features—including 3D rendering, offline SLMs, sound synthesis, and local conversation history—work completely without creating an account.
- **Encrypted Session Sync**: When logged into a MuxAI account, conversations and custom themes are synced automatically to serverless NeonDB PostgreSQL with debounced state synchronization.
- **Profile Customization**: Users can personalize display names, handles, avatars, and redeem access codes for premium outfit tiers.

---

## Privacy & Offline Capability

- No conversational data, prompts, or images are transmitted to external tracking servers.
- After the initial download, in-browser models run **100% offline** without an active internet connection.
- All conversational history and preferences are preserved client-side in localStorage and IndexedDB.
- Model weights remain cached directly within browser storage with zero external telemetry.
- Client-side execution ensures your conversations remain confidential on your device.

---

![](https://muxai.vercel.app/hana_og-image.jpg)

## License & Intellectual Property Notice

Distributed under the [MIT License](LICENSE).

- **Project License**: The source code and software implementation of AI Smash are distributed under the MIT License.

- **Original Character & Intellectual Property (IP)**: **Hana / Yana**, including her name, character identity, persona directives, backstory, speech patterns, visual aesthetics, and associated creative lore, is an **Original Character (OC)** and the exclusive **Intellectual Property (IP)** of the creator. This project license applies solely to the software codebase, tools, and technical implementation. It does not grant ownership, trademark, or commercial character rights over Hana as an intellectual property.
