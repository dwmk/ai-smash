import React, { useState, useMemo } from 'react';
import {
  Search,
  BookOpen,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  ArrowLeft,
  Bot,
  Workflow,
  Sparkles,
  Key,
  ShieldCheck,
  Volume2,
  Terminal,
  MessageSquare,
  Home,
  Menu,
  X,
  Play,
  RefreshCw,
  Layers,
  Cpu,
  Radio,
  Database,
  Code,
  Zap,
} from 'lucide-react';
import { AI_PROFILE } from '../constants';
import { CodeBlockView } from './CodeBlockView';

interface DocsPageProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onBackToChat: () => void;
  onBackToHome: () => void;
}

interface DocArticle {
  id: string;
  path: string;
  title: string;
  category: 'Getting Started' | 'Hana APIs' | 'Hana features' | 'AI Model APIs' | 'Integrations';
  tagline: string;
  logoUrl?: string;
  content: {
    overview: string;
    prerequisites?: string[];
    steps?: Array<{ title: string; desc: string; code?: string; lang?: string }>;
    slashCommands?: Array<{ cmd: string; desc: string; example: string }>;
    parameters?: Array<{ name: string; type: string; required: boolean; desc: string }>;
    codeExample?: { lang: string; code: string };
    tips?: string[];
  };
}

export const DOCS_ARTICLES: DocArticle[] = [
  // 1. Getting Started Overview
  {
    id: 'overview',
    path: '/docs',
    title: 'Developer Documentation Overview',
    category: 'Getting Started',
    tagline: 'Connect external models, configure API keys, and deploy bots with AI Smash',
    content: {
      overview:
        'AI Smash provides an interactive sandbox unifying in-browser Small Language Models (SLMs) with frontier external AI APIs and multi-platform bot integrations. All API credentials and bot tokens are persisted securely in your local browser session (via localStorage) so you can test, iterate, and integrate without sending secrets to any intermediary database.',
      prerequisites: [
        'A modern desktop or mobile browser with WebGPU/WASM and IndexedDB support',
        'Valid API keys or bot tokens for whichever cloud providers you wish to integrate',
      ],
      steps: [
        {
          title: '1. Select AI Model or External Provider',
          desc: 'Click on the Model Selector in the chat input panel. Choose from instant in-browser SLMs (SmolLM2, Qwen 2.5, Llama 3.2), self-hosted Ollama servers, or external frontier APIs (OpenAI, Gemini, Anthropic, xAI, Groq, Z.ai, DeepSeek, Qwen, HuggingFace).',
        },
        {
          title: '2. Attach Files & Multi-Modal Inputs',
          desc: 'Click the "+" button vertically above the model selector to attach images, documents, audio clips, or source code. Files automatically arrange themselves in a reactive preview above the chat composer.',
        },
        {
          title: '3. Add Integrations from the Library',
          desc: 'Click the "+" button and select "Add integration" to open the integration modal. Add Discord, Slack, n8n, or Zapier connectors with one click.',
        },
      ],
      tips: [
        'API keys and integration credentials stay on your device and are never shared publicly.',
        'When using external API providers, responses stream directly with real-time token telemetry and 3D avatar lip-sync.',
      ],
    },
  },

  // 2. HANA 3D (3D AVATAR, VOICE ENGINE, EMOTIONS & GRAPHQL SDK)
  {
    id: 'third-party-avatar',
    path: '/docs/api/third-party-avatar',
    title: 'Hana 3D',
    category: 'Hana APIs',
    tagline: 'Embed Hana 3D VRM model, expressions, Mixamo animations, voice engine, active LLMs, and GraphQL API in third-party client apps',
    logoUrl: 'https://ai.mux8.com/hana_icon.png',
    content: {
      overview:
        'This guide provides the complete developer blueprint for allowing external third-party client applications (React, Vue, plain Three.js, Electron, Unity WebGL, or OBS livestream overlays) to embed and control Hana. You can load the 3D VRM humanoid character, trigger retargeted Mixamo animations, synchronize real-time facial emotions, drive phonetic viseme lip-sync matching spoken dialogue, query the active LLM, and dispatch remote actor directives via REST, Server-Sent Events (SSE), or GraphQL.',
      prerequisites: [
        'A WebGL2 / WebGPU-capable rendering environment supporting Three.js r160+ and @pixiv/three-vrm 1.0+',
        'npm packages: three, @pixiv/three-vrm, and vrm-mixamo-retarget',
        'Web Speech API (SpeechSynthesis) and Web Audio API for audio synthesis & viseme tracking',
        'Direct HTTP access to this server (CORS headers Access-Control-Allow-Origin: * are pre-configured)',
      ],
      steps: [
        {
          title: '1. Load Hana 3D VRM 1.0 Model via Asset Proxy',
          desc: 'To prevent cross-origin redirect errors, request the avatar model from /api/vrm. You can specify a wardrobe outfit using the query parameter ?file=hana_v1.5_vrm1.vrm. Initialize Three.js, register VRMLoaderPlugin with GLTFLoader, and add the resulting VRM scene to your WebGL viewport.',
          lang: 'typescript',
          code: `import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 50);
camera.position.set(0, 1.15, 1.65);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container')?.appendChild(renderer.domElement);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

let currentVrm: any = null;
let mixer: THREE.AnimationMixer | null = null;

// Load Hana default Mint Maid outfit (or ?file=hana_v1.0_pinkmaid_vrm1.vrm)
loader.load('/api/vrm', (gltf) => {
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.removeUnnecessaryJoints(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  
  scene.add(vrm.scene);
  currentVrm = vrm;
  mixer = new THREE.AnimationMixer(vrm.scene);
  console.log('Hana 3D VRM successfully loaded!');
});`,
        },
        {
          title: '2. Fetch & Retarget Mixamo Animations with Gaze Isolation',
          desc: 'Fetch animation FBX files from the proxy /api/animation/:type (/api/animation/idle, walk, wave, fall, getup, yawn, wait). Use vrm-mixamo-retarget to apply bones while filtering head/neck tracks on idle so Hana can track the user cursor procedurally.',
          lang: 'typescript',
          code: `import { retargetAnimationFromUrl } from 'vrm-mixamo-retarget';

async function playAnimation(animType: 'idle' | 'walk' | 'wave' | 'fall' | 'getup') {
  if (!currentVrm || !mixer) return;
  const animUrl = \`/api/animation/\${animType}\`;
  
  const clip = await retargetAnimationFromUrl(currentVrm, animUrl);
  if (clip) {
    // Optional: Filter head/neck bones on idle for cursor look-at tracking
    if (animType === 'idle') {
      clip.tracks = clip.tracks.filter(t => !t.name.includes('head') && !t.name.includes('neck'));
    }
    const action = mixer.clipAction(clip);
    action.setLoop(animType === 'idle' || animType === 'walk' ? THREE.LoopRepeat : THREE.LoopOnce, 1);
    action.play();
  }
}`,
        },
        {
          title: '3. Actuate Facial Expressions & Emotional Blendshapes',
          desc: 'Hana supports 6 core emotional morph presets: neutral, happy, smug (relaxed), sad, angry, and surprised. Actuate them using currentVrm.expressionManager.setValue(name, weight). You can also send the full AI reply to POST /api/emotion to have the algorithm automatically classify the exact emotion.',
          lang: 'typescript',
          code: `// Set facial expression smoothly
function setFacialEmotion(emotion: 'happy' | 'relaxed' | 'sad' | 'angry' | 'surprised' | 'neutral', weight = 1.0) {
  if (!currentVrm?.expressionManager) return;
  const expr = currentVrm.expressionManager;
  
  // Clear previous emotion weights
  ['happy', 'relaxed', 'sad', 'angry', 'surprised'].forEach((name) => {
    expr.setValue(name, name === emotion ? weight : 0);
  });
}

// Automatically classify emotion from full assistant response text
async function detectEmotionForText(messageText: string) {
  const resp = await fetch('/api/emotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: messageText }),
  });
  const data = await resp.json();
  setFacialEmotion(data.emotion, 0.85);
}`,
        },
        {
          title: '4. Voice Engine & Real-Time Viseme Lip Synchronization',
          desc: 'Configure speech synthesis with Hana\'s high-priority female voice queue (rate 1.05, pitch 1.25) and Web Audio harmonic filters. Hook into the utterance.onboundary event to compute phoneme vowel shapes (aa, ih, ou, ee, oh) and lerp expressionManager weights in real time.',
          lang: 'typescript',
          code: `function speakWithLipSync(text: string) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Select preferred female neural/natural voice
  const voices = window.speechSynthesis.getVoices();
  const femaleVoice = voices.find(v => 
    /aria|jenny|samantha|ava|serena|zira|natural/i.test(v.name) && !/male|david|mark/i.test(v.name)
  );
  if (femaleVoice) utterance.voice = femaleVoice;
  utterance.pitch = 1.25;
  utterance.rate = 1.05;

  // Track word boundary events for syllable mouth shapes
  utterance.onboundary = (e) => {
    const word = text.slice(e.charIndex, e.charIndex + (e.charLength || 6)).toLowerCase();
    const expr = currentVrm?.expressionManager;
    if (!expr) return;

    if (/[ao]/.test(word)) {
      expr.setValue('oh', word.includes('o') ? 0.35 : 0);
      expr.setValue('aa', word.includes('a') ? 0.40 : 0);
    } else if (/[iu]/.test(word)) {
      expr.setValue('ou', word.includes('u') ? 0.30 : 0);
      expr.setValue('ih', word.includes('i') ? 0.25 : 0);
    } else if (/[e]/.test(word)) {
      expr.setValue('ee', 0.30);
    }
  };

  utterance.onend = () => {
    // Reset mouth to closed resting state
    ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => currentVrm?.expressionManager?.setValue(v, 0));
  };

  window.speechSynthesis.speak(utterance);
}`,
        },
        {
          title: '5. Query Active LLMs & Stream Persona Responses',
          desc: 'Third-party apps can query active models via GET /api/mcp or POST /api/graphql. To stream persona responses directly, call POST /api/chat or POST /api/chat/provider with SSE streaming. Responses come back token-by-token with natural conversational rhythm.',
          lang: 'typescript',
          code: `// Stream persona response from server
async function streamHanaChat(userMessage: string, onToken: (chunk: string) => void) {
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      stream: true,
    }),
  });

  const reader = resp.body?.getReader();
  const decoder = new TextDecoder();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = JSON.parse(line.slice(6));
        if (payload.text) onToken(payload.text);
      }
    }
  }
}`,
        },
        {
          title: '6. Synchronize Remote Clients via Live SSE Event Bus',
          desc: 'If running a separate presentation client (e.g. OBS streaming overlay, Discord companion, or second screen), subscribe to GET /api/avatar/events. Whenever an action is triggered via POST /api/avatar/action or GraphQL mutation setAvatarAction, your 3D client receives the speech text, emotion, and animation cues instantly.',
          lang: 'typescript',
          code: `// Connect to live avatar event stream
const sse = new EventSource('/api/avatar/events');

sse.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'speak' || data.type === 'act') {
    console.log('Live action received:', data.text, data.emotion, data.animation);
    setFacialEmotion(data.emotion, 0.9);
    playAnimation(data.animation);
    if (data.text) speakWithLipSync(data.text);
  }
};`,
        },
      ],
      parameters: [
        { name: 'GET /api/vrm?file=...', type: 'Binary GLB/VRM stream', required: false, desc: 'Streams 3D humanoid VRM model file with CORS headers.' },
        { name: 'GET /api/animation/:type', type: 'Binary FBX stream', required: true, desc: 'Streams Mixamo animation FBX (idle, walk, wave, fall, getup, yawn, wait).' },
        { name: 'POST /api/emotion', type: 'JSON { text: string }', required: true, desc: 'Evaluates entire reply text and returns detected facial emotion.' },
        { name: 'POST /api/graphql', type: 'JSON { query: string }', required: true, desc: 'Universal GraphQL endpoint querying models, outfits, voice, emotions, and mutations.' },
        { name: 'GET /api/avatar/events', type: 'text/event-stream (SSE)', required: false, desc: 'Pub/sub stream broadcasting avatar speech and gestures to all connected viewports.' },
        { name: 'POST /api/avatar/action', type: 'JSON { action, text, emotion, animation }', required: false, desc: 'Dispatches remote directive to all active 3D viewports.' },
      ],
      codeExample: {
        lang: 'html',
        code: `<!-- Complete HTML boilerplate embedding Hana 3D avatar in an iframe or standalone page -->
<!DOCTYPE html>
<html>
<head>
  <title>Hana 3D Avatar Client</title>
  <style>body { margin: 0; overflow: hidden; background: #0f1117; }</style>
  <script type="importmap">
    {
      "imports": {
        "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
        "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/",
        "@pixiv/three-vrm": "https://unpkg.com/@pixiv/three-vrm@2.0.6/lib/three-vrm.module.js"
      }
    }
  </script>
</head>
<body>
  <div id="avatar-container" style="width: 100vw; height: 100vh;"></div>
  <script type="module">
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { VRMLoaderPlugin } from '@pixiv/three-vrm';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.15, 1.65);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('avatar-container').appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(1.5, 2.5, 2.0);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const loader = new GLTFLoader();
    loader.register(p => new VRMLoaderPlugin(p));
    loader.load('/api/vrm', gltf => {
      scene.add(gltf.userData.vrm.scene);
    });

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();
  </script>
</body>
</html>`,
      },
      tips: [
        'Camera FOV: Use FOV 28 at position (0, 1.15, 1.65) and lookAt (0, 1.05, 0) for optimal portrait framing of Hana.',
        'Mouth Deadzone: In your lip-sync render loop, snap viseme values below 0.02 directly to 0 to prevent subtle mouth jitter.',
        'Transparent OBS Overlay: Set WebGLRenderer alpha: true and render background transparent for clean stream capture.',
      ],
    },
  },

  // ========================================================
  // HANA FEATURES: OMNICHANNEL VOICE & CALLING SYSTEMS
  // ========================================================

  // 1. WHATSAPP BUSINESS SETUP
  {
    id: 'whatsapp-feature',
    path: '/docs/features/whatsapp',
    title: 'WhatsApp Business Setup',
    category: 'Hana features',
    tagline: 'How to obtain Phone Number ID, WABA ID, Permanent System User Access Token, and configure Meta Webhooks for Hana calling',
    logoUrl: 'https://muxai.vercel.app/logos/whatsapp.jpg',
    content: {
      overview:
        'Hana bridges directly to Meta\'s WhatsApp Cloud API to handle customer inquiries via intelligent voice notes, interactive WebRTC voice calling, and automated receptionist switchboards. All incoming voice messages and text inquiries are retrieved, grounded in your active RAG prompt, and answered in Hana\'s synthesized speech. This guide explains how to get each required piece of information from the Meta Developer and Business Manager consoles.',
      prerequisites: [
        'A Meta Developer account at developers.facebook.com',
        'A Meta Business Manager account at business.facebook.com',
        'A phone number not currently registered on a personal WhatsApp consumer app (or a test phone number provided by the Meta sandbox)',
        'Hana /caller instance or webhook callback endpoint (/api/caller/webhooks/whatsapp)',
      ],
      parameters: [
        {
          name: 'phoneNumberId',
          type: 'string',
          required: true,
          desc: 'Meta Graph API Phone Number ID for the WhatsApp business sender (e.g. 104829104857201)',
        },
        {
          name: 'wabaId',
          type: 'string',
          required: true,
          desc: 'WhatsApp Business Account (WABA) ID registered under your Meta Business Manager',
        },
        {
          name: 'accessToken',
          type: 'string',
          required: true,
          desc: 'Permanent System User Access Token with whatsapp_business_messaging & whatsapp_business_management scopes',
        },
        {
          name: 'targetNumber',
          type: 'string',
          required: true,
          desc: 'Target recipient mobile number in international E.164 format (e.g. +15552348901)',
        },
        {
          name: 'verifyToken',
          type: 'string',
          required: true,
          desc: 'Custom verification string for Meta webhook challenge validation (default: hana_wa_verify_2026)',
        },
        {
          name: 'callMode',
          type: 'enum',
          required: false,
          desc: 'Calling mode: audio_note (Opus voice note), voip_bridge (WebRTC call), or receptionist (interactive RAG)',
        },
      ],
      steps: [
        {
          title: '1. Create a Meta Developer App & Add WhatsApp',
          desc: 'Visit developers.facebook.com, log in, and click "My Apps" > "Create App". Select "Other" > "Business" as the app type, give your app a name (e.g., "Hana Voice Dispatcher"), and click Create. On the App Dashboard, locate the "WhatsApp" product card and click "Set up".',
        },
        {
          title: '2. How to Get Phone Number ID & WABA ID',
          desc: 'In the left sidebar, navigate to WhatsApp > API Setup. In the "Send and receive messages" panel, locate "Phone number ID" (a numeric ID like 104829104857201). Right underneath it, locate the "WhatsApp Business Account ID" (WABA ID). Copy both IDs into Hana\'s corresponding input fields in /caller.',
          lang: 'bash',
          code: `# Phone Number ID & WABA ID are visible in Meta App Dashboard > WhatsApp > API Setup
Phone Number ID: 104829104857201
WhatsApp Business Account ID: 109283746501928`,
        },
        {
          title: '3. How to Generate a Permanent System User Access Token',
          desc: 'The temporary token displayed in the API Setup tab expires after 24 hours. For permanent 24/7 reception, generate a System User token: 1) Go to business.facebook.com > Business Settings > Users > System Users. 2) Click "Add", name the user "Hana Receptionist", and set the role to "Admin". 3) Click "Assign Assets", select your Meta App under "Apps", and enable "Full Control". 4) Click "Generate New Token", choose your App, set token expiration to "Never", and check both "whatsapp_business_messaging" and "whatsapp_business_management" permissions. 5) Copy the token (starts with EAABw...) into Hana\'s System Access Token field.',
        },
        {
          title: '4. How to Configure Meta Webhook Callback & Verify Token',
          desc: 'In your Meta App Dashboard, navigate to WhatsApp > Configuration. Under "Webhook", click "Edit". Set the Callback URL to your Hana instance endpoint: https://your-domain/api/caller/webhooks/whatsapp. Set the Verify Token to match the verify token in Hana (default: hana_wa_verify_2026). Click "Verify and Save". Then, click "Manage" under Webhook fields and subscribe to the "messages" event field.',
          lang: 'bash',
          code: `# Meta Webhook Configuration:
Callback URL: https://ai.mux8.com/api/caller/webhooks/whatsapp
Verify Token: hana_wa_verify_2026
Webhook Fields Subscribed: messages, message_template_status_update`,
        },
        {
          title: '5. Test Connection Handshake & Dispatch Outbound Voice Call',
          desc: 'In Hana /caller, click "Test Handshake" on the WhatsApp card. Hana verifies your credentials by querying Meta\'s Graph API GET /v21.0/{phone-number-id}. Once the status badge switches to "Verified", enter your target phone number in E.164 format (e.g. +1 555-234-8901) and click "Dispatch Call" to deliver an outbound voice message or trigger an incoming simulation.',
        },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl -X POST "https://graph.facebook.com/v21.0/104829104857201/messages" \\
  -H "Authorization: Bearer EAABw..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "+15552348901",
    "type": "audio",
    "audio": {
      "link": "https://ai.mux8.com/audio/hana_greeting.mp3"
    }
  }'`,
      },
      tips: [
        'Phone numbers must be in strict E.164 format (+ followed by country code and subscriber number with no spaces, dashes, or parentheses).',
        'Meta requires customer opt-in or an existing customer-initiated conversation thread within 24 hours to receive non-template media messages.',
        'Credentials entered in /caller are stored locally in your browser storage (localStorage) and never uploaded to public servers.',
      ],
    },
  },

  // 2. TELEGRAM VOICE BOT SETUP
  {
    id: 'telegram-feature',
    path: '/docs/features/telegram',
    title: 'Telegram Voice Bot Setup',
    category: 'Hana features',
    tagline: 'How to create a bot via @BotFather, retrieve your Bot Token, find your Chat ID, set secret webhook tokens, and configure voice calling modes',
    logoUrl: 'https://muxai.vercel.app/logos/telegram.jpg',
    content: {
      overview:
        'Hana interfaces with Telegram\'s MTProto Bot API to operate as a voice-enabled assistant. You can dispatch OGG Opus voice messages, stream interactive VoIP calls, and auto-reply to incoming voice or text notes in channels and groups. Setup takes less than 3 minutes using Telegram\'s official @BotFather bot.',
      prerequisites: [
        'A Telegram account on mobile or desktop app',
        'Access to @BotFather bot within Telegram',
        'Hana /caller instance or webhook callback endpoint (/api/caller/webhooks/telegram)',
      ],
      parameters: [
        {
          name: 'botToken',
          type: 'string',
          required: true,
          desc: 'Telegram Bot API token issued by @BotFather (format: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ)',
        },
        {
          name: 'chatId',
          type: 'string',
          required: true,
          desc: 'Target Telegram Chat ID (numeric integer like 987654321) or recipient @username',
        },
        {
          name: 'secretToken',
          type: 'string',
          required: false,
          desc: 'Secret token passed in X-Telegram-Bot-Api-Secret-Token header for webhook request authentication',
        },
        {
          name: 'callMode',
          type: 'enum',
          required: false,
          desc: 'Voice calling mode: voice_note (Opus voice note), voip_gateway (2-way VoIP stream), or channel_agent (receptionist bot)',
        },
      ],
      steps: [
        {
          title: '1. How to Create a Bot with @BotFather & Obtain Bot Token',
          desc: 'Open Telegram and search for "@BotFather" (the official verified bot with a blue checkmark). Click Start or send "/newbot". Follow the prompts: 1) Enter a friendly display name (e.g., "Hana AI Receptionist"). 2) Enter a unique username ending in "bot" (e.g., "HanaReceptionistBot"). @BotFather will immediately send you your HTTP API Bot Token (e.g. 123456789:ABCdefGHIjklMNO...). Copy this token into Hana\'s "Telegram Bot Token" field.',
          lang: 'bash',
          code: `# BotFather output format:
Use this token to access the HTTP API:
123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
Keep your token secure and store it safely.`,
        },
        {
          title: '2. How to Configure Bot Capabilities & Privacy Mode',
          desc: 'In your chat with @BotFather: 1) Send "/setprivacy" > select your bot > choose "Disable" so Hana can hear messages in group switchboards. 2) Send "/setdescription" to explain your receptionist\'s hours and services. 3) Send "/setuserpic" to upload Hana\'s avatar so users see her friendly face.',
        },
        {
          title: '3. How to Find Your Target User / Chat ID',
          desc: 'To send voice calls or messages to a specific user, you need their numeric Chat ID: Method A: Search Telegram for "@userinfobot" or "@raw_data_bot" and send "/start". It immediately prints your numeric "Id" (e.g., 987654321). Method B: Send any message to your newly created bot, then open in your browser: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates. Look for the "id" field inside the "chat" object. Paste this ID or your "@username" into Hana\'s Chat ID field.',
        },
        {
          title: '4. How to Register Webhook with Telegram API',
          desc: 'To have Telegram deliver incoming voice notes and messages directly to Hana, register your webhook callback URL using Telegram\'s setWebhook endpoint. Include your custom Secret Token for tamper-proof verification.',
          lang: 'bash',
          code: `curl -X POST "https://api.telegram.org/bot123456789:ABCdefGHIjklMNO/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://ai.mux8.com/api/caller/webhooks/telegram",
    "secret_token": "hana_tg_secret_2026",
    "allowed_updates": ["message", "edited_message"]
  }'`,
        },
        {
          title: '5. Ping @getMe & Test Outbound Voice Dispatch',
          desc: 'In Hana /caller, click "Ping @getMe" on the Telegram tile. Hana calls https://api.telegram.org/bot<token>/getMe to verify bot credentials in real time. Once verified, click "Dispatch Call" to send a voice note to the specified Chat ID, or click "Simulate Inbound Telegram Voice Turn" to test RAG response generation.',
        },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl -X POST "https://api.telegram.org/bot123456789:ABCdefGHIjklMNO/sendVoice" \\
  -H "Content-Type: application/json" \\
  -d '{
    "chat_id": "987654321",
    "voice": "https://ai.mux8.com/audio/hana_greeting.ogg",
    "caption": "Spoken by Hana AI Receptionist"
  }'`,
      },
      tips: [
        'Telegram voice notes must be encoded in OGG format with the Opus codec (audio/ogg; codecs=opus). Hana transcodes speech automatically.',
        'The Telegram Bot API is completely free with no per-minute or per-message fees.',
        'All credentials are saved locally in your browser storage and persist across page refreshes.',
      ],
    },
  },

  // 3. FACEBOOK MESSENGER AUDIO SETUP
  {
    id: 'messenger-feature',
    path: '/docs/features/messenger',
    title: 'Messenger Audio Gateway Setup',
    category: 'Hana features',
    tagline: 'How to retrieve Facebook Page ID, Page Access Token, App Secret, and Recipient PSID for Hana voice messaging and calling',
    logoUrl: 'https://muxai.vercel.app/logos/messenger.jpg',
    content: {
      overview:
        'Hana integrates with Meta\'s Messenger Platform (Graph API) to provide automated voice calling and spoken audio message responses to visitors on your Facebook Business Page. When a visitor leaves a voice message or asks a question, Hana generates an intelligent RAG response and returns high-fidelity audio.',
      prerequisites: [
        'A Facebook Business Page (or Creator Page) that you administer',
        'A Meta Developer App (business type) at developers.facebook.com',
        'Hana /caller instance or webhook callback endpoint (/api/caller/webhooks/messenger)',
      ],
      parameters: [
        {
          name: 'pageId',
          type: 'string',
          required: true,
          desc: 'Numeric identifier of your Facebook Business Page (e.g. 102938475619283)',
        },
        {
          name: 'pageAccessToken',
          type: 'string',
          required: true,
          desc: 'Page Access Token generated from Meta Developer App with pages_messaging permission',
        },
        {
          name: 'appSecret',
          type: 'string',
          required: true,
          desc: 'Meta App Secret from App Settings > Basic, used to verify X-Hub-Signature-256 signatures',
        },
        {
          name: 'recipientId',
          type: 'string',
          required: true,
          desc: 'Target user Page-Scoped ID (PSID) assigned by Facebook for conversations with your Page',
        },
        {
          name: 'verifyToken',
          type: 'string',
          required: true,
          desc: 'Verification token string matching your Meta Webhook configuration (default: hana_fb_verify_2026)',
        },
        {
          name: 'callMode',
          type: 'enum',
          required: false,
          desc: 'Audio channel mode: audio_message (voice message), call_bridge (WebRTC call bridge), or two_way_agent',
        },
      ],
      steps: [
        {
          title: '1. Create a Facebook Page & Meta Developer App',
          desc: 'Ensure you have a published Facebook Page (e.g. "Hana Clinic & Wellness"). Visit developers.facebook.com, click "My Apps" > "Create App", select "Other" > "Business", name your app, and add the "Messenger" product from the catalog.',
        },
        {
          title: '2. How to Find Your Facebook Page ID',
          desc: 'Open Facebook in your browser and switch to your Page profile. 1) Click Settings & privacy > Settings > Page setup. 2) Alternatively, click on the "About" tab on your Page and select "Page transparency". Copy the numeric "Page ID" (e.g., 102938475619283) into Hana\'s "Facebook Page ID" field.',
        },
        {
          title: '3. How to Generate Page Access Token & Set Permissions',
          desc: 'In the Meta App Dashboard, navigate to Messenger > API Setup in the left menu. Under "Access Tokens", click "Add or remove Pages" and select your Page. Click "Generate Token". In the permission modal, approve "pages_messaging", "pages_manage_metadata", and "pages_read_engagement". Copy the generated token (starts with EAA...) into Hana\'s "Page Access Token" field.',
        },
        {
          title: '4. How to Retrieve Meta App Secret',
          desc: 'In the Meta App Dashboard left sidebar, navigate to App settings > Basic. Locate the "App Secret" field, click "Show", enter your Meta account password, and copy the secret hash into Hana\'s "Meta App Secret" field in /caller.',
        },
        {
          title: '5. How to Obtain Recipient PSID (Page-Scoped ID)',
          desc: 'In Messenger, user IDs are page-scoped (PSID). To get a recipient\'s PSID: 1) Have the user send a message to your Facebook Page. 2) Inspect the incoming webhook payload at /api/caller/webhooks/messenger—the sender.id field is the user\'s PSID (e.g., 4820194857201928). 3) Alternatively, call GET /v21.0/{page-id}/conversations?fields=participants&access_token={token} to list customer PSIDs. Paste this ID into Hana\'s "Recipient PSID" field.',
        },
        {
          title: '6. How to Configure Webhook & Verify Page',
          desc: 'In Meta App Dashboard > Messenger > API Setup > Webhooks: 1) Click "Add Callback URL". 2) Enter https://your-domain/api/caller/webhooks/messenger. 3) Enter your Verify Token (hana_fb_verify_2026) and save. 4) Under Subscriptions, enable "messages" and "messaging_postbacks". 5) In Hana /caller, click "Verify Page" to test the Graph API connection, then click "Dispatch Call" to send a voice message!',
          lang: 'bash',
          code: `# Messenger Webhook Configuration:
Callback URL: https://ai.mux8.com/api/caller/webhooks/messenger
Verify Token: hana_fb_verify_2026
Events Subscribed: messages, messaging_postbacks`,
        },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl -X POST "https://graph.facebook.com/v21.0/me/messages?access_token=EAA..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "recipient": { "id": "4820194857201928" },
    "message": {
      "attachment": {
        "type": "audio",
        "payload": {
          "url": "https://ai.mux8.com/audio/hana_greeting.mp3",
          "is_reusable": true
        }
      }
    }
  }'`,
      },
      tips: [
        'Always use a Page Access Token, never a User Access Token. Page Access Tokens do not expire when generated via System Users.',
        'Standard Messenger policy requires sending responses within 24 hours of the user\'s last message unless using an approved Message Tag.',
        'All credentials remain strictly client-side in browser storage so your tokens are never exposed.',
      ],
    },
  },

  // 4. OMNICHANNEL VOICE GATEWAY ARCHITECTURE
  {
    id: 'omnichannel-feature',
    path: '/docs/features/omnichannel',
    title: 'Omnichannel Voice Switchboard',
    category: 'Hana features',
    tagline: 'Multi-channel RAG architecture bridging WhatsApp, Telegram, and Messenger into Hana\'s 3D avatar voice engine',
    logoUrl: 'https://ai.mux8.com/hana_icon.png',
    content: {
      overview:
        'The Omnichannel Voice Switchboard in Hana provides a unified runtime connecting Meta WhatsApp Cloud API, Telegram Bot MTProto API, and Facebook Messenger Graph API into a single reactive RAG receptionist brain. It enables real-time 3D avatar lip-sync, spoken voice synthesis, and zero-latency context grounding across every customer touchpoint.',
      prerequisites: [
        'At least one configured platform (WhatsApp, Telegram, or Messenger)',
        'Active knowledge base prompt configured in Hana /caller (Clinic, Bistro, SaaS Demo, or Custom)',
      ],
      steps: [
        {
          title: '1. Unified Multi-Platform Inbound Normalization',
          desc: 'Incoming webhook events from WhatsApp, Telegram, and Messenger are normalized by Hana into a universal conversational turn format containing sender ID, platform origin, audio/text content, and channel mode.',
        },
        {
          title: '2. Real-Time RAG Grounding & Policy Enforcement',
          desc: 'Hana matches the user question against the active RAG knowledge base selected in /caller (e.g. Clinic hours, prices, open slots). Responses strictly follow business facts and guidelines.',
        },
        {
          title: '3. Streaming Speech Synthesis & 3D Lip-Sync',
          desc: 'Response text streams through Web Speech API or server-side TTS. The 3D avatar in /caller animates corresponding facial blendshapes and mouth visemes (aa, ih, ou, ee, oh) while dispatching the audio file back to the customer.',
        },
        {
          title: '4. Browser Storage Persistence & Safe Backup',
          desc: 'All platform credentials, webhook tokens, phone numbers, and chat IDs are stored securely in browser localStorage (hana_caller_platforms_v2). You can export your full configuration via the "Export Config" button at any time.',
        },
      ],
      tips: [
        'Turn on "Auto-Answer Channels" in /caller to let Hana automatically reply to voice notes across all platforms.',
        'Use the "Simulate Inbound" buttons on each tile to test your RAG prompts and answers before going live.',
      ],
    },
  },

  // 2. DISCORD INTEGRATION
  {
    id: 'discord',
    path: '/docs/integration/discord',
    title: 'Discord Bot & Voice Integration',
    category: 'Integrations',
    tagline: 'Bot mentions, direct messages, voice channel TTS, and slash commands',
    logoUrl: 'https://muxai.vercel.app/logos/discord.jpg',
    content: {
      overview:
        'The AI Smash Discord integration enables your Discord bot to listen for mentions (@bot) and Direct Messages, route the conversation to whichever AI model is currently active in AI Smash, and post formatted replies back. If joined in a voice channel, the bot will synthesize and output voice audio in real-time.',
      prerequisites: [
        'A Discord Application created in the Discord Developer Portal (https://discord.com/developers/applications)',
        'A Bot User created under the application with "Message Content Intent" enabled',
        'Bot invited to your Discord server with Send Messages and Connect/Speak voice permissions',
      ],
      steps: [
        {
          title: 'Step 1: Obtain Bot Token',
          desc: 'In Discord Developer Portal -> Your App -> Bot -> Reset Token -> Copy the token.',
        },
        {
          title: 'Step 2: Enable Gateway Privileged Intents',
          desc: 'Under the Bot tab in the Developer Portal, toggle ON "Server Members Intent" and "Message Content Intent".',
        },
        {
          title: 'Step 3: Insert Token into AI Smash',
          desc: 'Click the "+" button in the chat input panel, click "Add integration", choose Discord, and paste your Bot Token in the settings field. It saves automatically to browser persistent storage.',
        },
      ],
      slashCommands: [
        {
          cmd: '/msg <prompt>',
          desc: 'Sends a private hidden message that is not broadcast into the public Discord text channel. The bot replies privately or ephemerally.',
          example: '/msg Can you summarize the latest project roadmap?',
        },
        {
          cmd: '/joinvc',
          desc: 'Instructs the bot to join whichever voice channel the command user is currently connected to on the server.',
          example: '/joinvc',
        },
        {
          cmd: '/exitvc',
          desc: 'Instructs the bot to leave the voice channel and end any active audio stream.',
          example: '/exitvc',
        },
      ],
      parameters: [
        { name: 'botToken', type: 'string (secret)', required: true, desc: 'Your Discord application bot token.' },
        { name: 'guildId', type: 'string', required: false, desc: 'Server ID to restrict bot scope.' },
        { name: 'channelId', type: 'string', required: false, desc: 'Default text or voice channel ID.' },
        { name: 'enableVoice', type: 'boolean', required: false, desc: 'When enabled, outputs voice synthesis to Discord VC.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test Discord bot authentication using curl
curl -X GET "https://discord.com/api/v10/users/@me" \\
  -H "Authorization: Bot MTI3ODk0..." \\
  -H "Content-Type: application/json"`,
      },
      tips: [
        'Use /msg whenever you want to consult Hana privately without notifying server members in public channels.',
        'Voice synthesis in Discord VC automatically matches Hana\'s configured voice profile and rate.',
      ],
    },
  },

  // 3. SLACK INTEGRATION
  {
    id: 'slack',
    path: '/docs/integration/slack',
    title: 'Slack Workspace Integration',
    category: 'Integrations',
    tagline: 'Respond to team mentions and direct messages with conversational context',
    logoUrl: 'https://muxai.vercel.app/logos/slack.jpg',
    content: {
      overview:
        'Connect AI Smash to your Slack workspace. The Slack integration listens for @bot mentions or direct messages, routes prompt queries to your active model, and posts answers back into the Slack channel or thread.',
      prerequisites: [
        'A Slack App created at https://api.slack.com/apps',
        'OAuth Scopes: app_mentions:read, chat:write, im:history',
        'Installed app into your target Slack workspace',
      ],
      steps: [
        {
          title: 'Step 1: Create Slack App & Add Bot Scopes',
          desc: 'Add "app_mentions:read" and "chat:write" under OAuth & Permissions in the Slack API dashboard.',
        },
        {
          title: 'Step 2: Copy Bot User OAuth Token',
          desc: 'Install the app to your workspace and copy the token starting with "xoxb-".',
        },
        {
          title: 'Step 3: Configure in AI Smash',
          desc: 'Add Slack from the Integration Library, paste your Bot User Token, and optionally add an Incoming Webhook URL.',
        },
      ],
      parameters: [
        { name: 'botToken', type: 'string', required: true, desc: 'Slack Bot User OAuth Token (xoxb-...)' },
        { name: 'webhookUrl', type: 'string (url)', required: false, desc: 'Optional incoming webhook URL for notifications.' },
        { name: 'channelId', type: 'string', required: false, desc: 'Default channel ID for broadcasts.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test Slack Bot token authentication
curl -X POST "https://slack.com/api/auth.test" \\
  -H "Authorization: Bearer xoxb-your-token" \\
  -H "Content-Type: application/json"`,
      },
    },
  },

  // 4. n8n INTEGRATION
  {
    id: 'n8n',
    path: '/docs/integration/n8n',
    title: 'n8n Workflow Automation',
    category: 'Integrations',
    tagline: 'Trigger automated node flows and webhooks on chat completions',
    logoUrl: 'https://muxai.vercel.app/logos/n8n.jpg',
    content: {
      overview:
        'n8n is an open, extendable workflow automation tool. The AI Smash n8n integration pushes user queries and assistant responses to any n8n Webhook node so you can trigger email notifications, database records, Notion updates, or custom scripts.',
      prerequisites: [
        'A self-hosted or cloud n8n instance (https://n8n.io)',
        'An active n8n workflow containing a Webhook Trigger node set to POST',
      ],
      steps: [
        {
          title: 'Step 1: Create Webhook Node in n8n',
          desc: 'Add a Webhook node in your workflow, set HTTP Method to POST, and copy the Production or Test Webhook URL.',
        },
        {
          title: 'Step 2: Paste Webhook URL into AI Smash',
          desc: 'In AI Smash, add n8n from the Integration Library, paste your webhook URL, and optionally specify header authentication keys.',
        },
      ],
      parameters: [
        { name: 'webhookUrl', type: 'string (url)', required: true, desc: 'n8n Webhook URL endpoint.' },
        { name: 'apiKey', type: 'string', required: false, desc: 'Optional authentication header token.' },
      ],
      codeExample: {
        lang: 'json',
        code: `// Sample JSON payload sent to n8n webhook:
{
  "source": "AI Smash",
  "platform": "n8n",
  "prompt": "Explain quantum computing briefly",
  "response": "Quantum computing harnesses superposition and entanglement...",
  "modelUsed": "OpenAI API (gpt-4o)",
  "timestamp": 1740000000000
}`,
      },
    },
  },

  // 5. ZAPIER INTEGRATION
  {
    id: 'zapier',
    path: '/docs/integration/zapier',
    title: 'Zapier App Connector',
    category: 'Integrations',
    tagline: 'Connect AI Smash chats to 5,000+ cloud applications and Zaps',
    logoUrl: 'https://muxai.vercel.app/logos/zapier.jpg',
    content: {
      overview:
        'Connect AI Smash to Zapier using Catch Hooks. Every conversational exchange can trigger actions across Google Sheets, Airtable, Gmail, Salesforce, or Discord without writing custom backend code.',
      prerequisites: [
        'A Zapier account (https://zapier.com)',
        'A Zap configured with "Webhooks by Zapier" as the trigger, using the "Catch Hook" event',
      ],
      steps: [
        {
          title: 'Step 1: Set up Webhooks by Zapier',
          desc: 'In Zapier, create a new Zap, select "Webhooks by Zapier" -> "Catch Hook", and copy the Webhook URL.',
        },
        {
          title: 'Step 2: Add Zapier in AI Smash',
          desc: 'Open the Integration Library, add Zapier, paste the Catch Hook URL, and click "Test Connection" to send a sample event.',
        },
      ],
      parameters: [
        { name: 'webhookUrl', type: 'string (url)', required: true, desc: 'Zapier Catch Hook URL endpoint.' },
        { name: 'name', type: 'string', required: false, desc: 'Friendly name for your Zap connector.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test sending a payload to Zapier Catch Hook
curl -X POST "https://hooks.zapier.com/hooks/catch/123456/abcdef/" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"test_ping","app":"AI Smash","timestamp":"2026-10-04T10:00:00Z"}'`,
      },
    },
  },

  // 6. TWITCH INTEGRATION
  {
    id: 'twitch',
    path: '/docs/integration/twitch',
    title: 'Twitch Live Chat & Voice Bot',
    category: 'Integrations',
    tagline: 'Listen to Twitch chat, process viewer prompts with AI, and speak answers in real-time',
    logoUrl: 'https://muxai.vercel.app/logos/twitch.jpg',
    content: {
      overview:
        'Connect your Twitch stream live chat directly to AI Smash. The integration connects over Twitch IRC WebSocket to listen for chat messages in your channel, feeds questions and prompts to the active AI persona, and synthesizes speech aloud with real-time 3D avatar lip-sync.',
      prerequisites: [
        'A Twitch account and broadcast channel name (e.g. twitch.tv/yourchannel)',
        'Optional: Twitch Chat OAuth Token generated from https://twitchapps.com/tmi/ if you want the bot to also send chat messages back to viewers',
      ],
      steps: [
        {
          title: 'Step 1: Enter Twitch Channel Name',
          desc: 'Open AI Smash in /chat mode, click the "+" button, select "Add integration", and choose Twitch. Type your channel username into the "Twitch Channel Name" input field.',
        },
        {
          title: 'Step 2: (Optional) Add Chat OAuth Token for Bot Replies',
          desc: 'If you want the bot to post text replies in your Twitch chat in addition to speaking aloud, generate an OAuth token at twitchapps.com/tmi and paste it in the "OAuth Chat Token" field.',
        },
        {
          title: 'Step 3: Enable Voice Output',
          desc: 'Check the "Enable Live TTS Voice Output" toggle to have Hana speak answers out loud with audio and 3D facial expressions for your stream audience.',
        },
      ],
      parameters: [
        { name: 'twitchChannel', type: 'string', required: true, desc: 'Your Twitch channel username to monitor.' },
        { name: 'botToken', type: 'string (secret)', required: false, desc: 'Optional Twitch IRC OAuth token (oauth:...) for sending chat messages.' },
        { name: 'enableVoice', type: 'boolean', required: false, desc: 'Synthesizes speech and triggers avatar animations for live viewers.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Example Twitch IRC WebSocket connection test
wscat -c wss://irc-ws.chat.twitch.tv:443
# Send: PASS oauth:yourtoken
# Send: NICK yourusername
# Send: JOIN #yourchannel`,
      },
      tips: [
        'Place the AI Smash 3D avatar on your OBS/Streamlabs overlay as a Browser Source with transparent background.',
        'Viewers can trigger interactive answers by typing in chat or using channel point prompts.',
      ],
    },
  },

  // 7. YOUTUBE LIVE INTEGRATION
  {
    id: 'youtube',
    path: '/docs/integration/youtube',
    title: 'YouTube Live Stream & Voice',
    category: 'Integrations',
    tagline: 'Live chat polling with YouTube Data API v3, voice TTS & 3D avatar lip sync',
    logoUrl: 'https://muxai.vercel.app/logos/youtube.jpg',
    content: {
      overview:
        'The YouTube Live integration connects your YouTube Live stream chat to AI Smash. Using the YouTube Data API v3, it continuously polls active live chat messages, submits viewer questions to the active LLM, and speaks answers out loud with real-time 3D VRM avatar mouth movements and facial expressions.',
      prerequisites: [
        'A Google Cloud Project with the YouTube Data API v3 enabled',
        'A Google Cloud API Key with access to YouTube Data API v3',
        'An active or scheduled YouTube Live stream with live chat enabled',
      ],
      steps: [
        {
          title: 'Step 1: Get YouTube Data API v3 Key',
          desc: 'Visit Google Cloud Console (console.cloud.google.com) -> APIs & Services -> Enable "YouTube Data API v3" -> Credentials -> Create API Key.',
        },
        {
          title: 'Step 2: Obtain Live Broadcast Video ID',
          desc: 'Start your YouTube live broadcast or open your upcoming stream. Copy the video ID from the URL (e.g. in https://youtube.com/watch?v=jfKfPfyJRdk, the ID is jfKfPfyJRdk).',
        },
        {
          title: 'Step 3: Configure in AI Smash',
          desc: 'In AI Smash, click the "+" button, add YouTube from the Integration Library, paste your API Key and Video ID, and test connection.',
        },
      ],
      parameters: [
        { name: 'apiKey', type: 'string (secret)', required: true, desc: 'Google Cloud API Key with YouTube Data API v3 enabled.' },
        { name: 'youtubeVideoId', type: 'string', required: true, desc: 'The 11-character video ID of your live stream broadcast.' },
        { name: 'enableVoice', type: 'boolean', required: false, desc: 'Automatically speak answers out loud via TTS.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test retrieving YouTube Live broadcast details via curl
curl -X GET "https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=YOUR_VIDEO_ID&key=YOUR_API_KEY"`,
      },
      tips: [
        'Stream viewers can chat in real time, and Hana will answer questions while keeping full personality context.',
        'Supports both desktop OBS stream setups and standalone browser window capture.',
      ],
    },
  },

  // 8. GMAIL INTEGRATION
  {
    id: 'gmail',
    path: '/docs/integration/gmail',
    title: 'Gmail Workspace Connector',
    category: 'Integrations',
    tagline: 'Inspect unread email threads and compose draft replies directly via Gmail API',
    logoUrl: 'https://muxai.vercel.app/logos/gmail.jpg',
    content: {
      overview:
        'Connect Google Gmail to AI Smash. The integration interfaces with the Gmail REST API to query recent unread messages, summarize lengthy email threads, extract actionable items, and compose draft replies directly in your mailbox.',
      prerequisites: [
        'A Google Cloud Project with Gmail API enabled',
        'A Google OAuth 2.0 Access Token with https://www.googleapis.com/auth/gmail.readonly or https://www.googleapis.com/auth/gmail.compose scope',
      ],
      steps: [
        {
          title: 'Step 1: Obtain Google OAuth Access Token',
          desc: 'Generate an OAuth 2.0 access token via Google OAuth Playground (developers.google.com/oauthplayground) or your Google Cloud OAuth Client with the Gmail scope.',
        },
        {
          title: 'Step 2: Enter Credentials in AI Smash',
          desc: 'Click the "+" button in AI Smash, select "Add integration", click Gmail, and paste your Google OAuth Access Token (starts with ya29.).',
        },
        {
          title: 'Step 3: Test Connection',
          desc: 'Click "Test Connection" to verify access to your Gmail profile and mailbox. The token is stored locally in your browser.',
        },
      ],
      parameters: [
        { name: 'googleAccessToken', type: 'string (secret)', required: true, desc: 'Google OAuth Access Token with Gmail scopes.' },
        { name: 'userEmail', type: 'string', required: false, desc: 'Your Gmail address for mailbox reference.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test Gmail API profile retrieval using curl
curl -X GET "https://gmail.googleapis.com/gmail/v1/users/me/profile" \\
  -H "Authorization: Bearer ya29.a0AfH6SM..." \\
  -H "Content-Type: application/json"`,
      },
      tips: [
        'Ask Hana "Summarize my latest unread emails" or "Draft a polite follow-up email to my colleague" to trigger Gmail workflow actions.',
      ],
    },
  },

  // 9. GOOGLE SHEETS INTEGRATION
  {
    id: 'sheets',
    path: '/docs/integration/sheets',
    title: 'Google Sheets Connector',
    category: 'Integrations',
    tagline: 'Read spreadsheet tables into chat context and log conversation turns into rows',
    logoUrl: 'https://muxai.vercel.app/logos/sheets.jpg',
    content: {
      overview:
        'The Google Sheets connector allows AI Smash to read tabular spreadsheet data into conversational memory and log conversation prompts, answers, token counts, and timestamps directly into Google Sheets rows for audit or data analysis.',
      prerequisites: [
        'A Google Spreadsheet in Google Drive',
        'A Google OAuth Access Token with https://www.googleapis.com/auth/spreadsheets scope',
      ],
      steps: [
        {
          title: 'Step 1: Copy Spreadsheet ID',
          desc: 'Open your Google Sheet in a browser. Copy the ID from the URL between /d/ and /edit (e.g. in https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit, the ID is 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms).',
        },
        {
          title: 'Step 2: Obtain OAuth Access Token',
          desc: 'Generate a Google OAuth token with the spreadsheets scope via OAuth Playground or your Google Cloud application.',
        },
        {
          title: 'Step 3: Configure in AI Smash',
          desc: 'In the "+" menu of AI Smash, select Google Sheets, paste your Access Token, Spreadsheet ID, and optional Sheet Range (e.g. Sheet1!A:E).',
        },
      ],
      parameters: [
        { name: 'googleAccessToken', type: 'string (secret)', required: true, desc: 'Google OAuth Access Token with spreadsheets scope.' },
        { name: 'spreadsheetId', type: 'string', required: true, desc: 'The unique spreadsheet ID from your Google Sheet URL.' },
        { name: 'sheetRange', type: 'string', required: false, desc: 'Tab name and cell range to read/append (default: Sheet1!A:E).' },
      ],
      codeExample: {
        lang: 'bash',
        code: `# Test reading values from Google Sheets API
curl -X GET "https://sheets.googleapis.com/v4/spreadsheets/YOUR_SPREADSHEET_ID/values/Sheet1!A1:D10" \\
  -H "Authorization: Bearer ya29.a0AfH6SM..." \\
  -H "Content-Type: application/json"`,
      },
      tips: [
        'Ideal for logging user feedback, keeping customer support logs, or pulling live inventory data into conversation context.',
      ],
    },
  },

  // 10. MODEL CONTEXT PROTOCOL (MCP)
  {
    id: 'mcp',
    path: '/docs/integration/mcp',
    title: 'Model Context Protocol (MCP)',
    category: 'Integrations',
    tagline: 'Connect external apps, IDEs (Cursor, Windsurf, Claude Desktop) & tool suites via standardized MCP',
    logoUrl: 'https://ai.mux8.com/logo0.png',
    content: {
      overview:
        'The Model Context Protocol (MCP) is an open standard that enables external applications, developer IDEs, and AI tools to exchange tools, memory resources, and prompt context. AI Smash exposes a complete built-in MCP server endpoint (/api/mcp and /api/mcp/sse) allowing external clients like Cursor and Claude Desktop to connect directly, and allows you to attach external MCP servers to Hana in /chat mode.',
      prerequisites: [
        'An MCP-compatible client (e.g. Claude Desktop, Cursor IDE, Windsurf, or custom script)',
        'Built-in server endpoint runs automatically at /api/mcp/sse and /api/mcp/messages',
      ],
      steps: [
        {
          title: 'Step 1: Built-in MCP Server Discovery',
          desc: 'Send a GET request to /api/mcp to inspect supported tools (web_search, wikipedia, weather_info, ask_persona), resources, and server capabilities.',
        },
        {
          title: 'Step 2: Configure Claude Desktop or Cursor',
          desc: 'Add the AI Smash MCP server configuration to your claude_desktop_config.json or .cursor/mcp.json file using the SSE transport endpoint.',
        },
        {
          title: 'Step 3: Connect External MCP Servers in /chat mode',
          desc: 'In AI Smash, click the "+" button, add Model Context Protocol (MCP), and enter your external MCP SSE endpoint URL to expand the model\'s active tool palette.',
        },
      ],
      parameters: [
        { name: 'mcpServerUrl', type: 'string (url)', required: false, desc: 'MCP server endpoint URL (defaults to built-in /api/mcp/sse).' },
        { name: 'apiKey', type: 'string (secret)', required: false, desc: 'Optional Bearer authentication token for secured external servers.' },
      ],
      codeExample: {
        lang: 'json',
        code: `// claude_desktop_config.json configuration:
{
  "mcpServers": {
    "ai-smash": {
      "url": "https://YOUR_DOMAIN/api/mcp/sse",
      "transport": "sse"
    }
  }
}`,
      },
      tips: [
        'Built-in tools available via MCP: web_search, wikipedia, weather_info, location_info, device_info, and ask_persona.',
        'External IDEs can query Hana\'s persona state and tools seamlessly during development sessions.',
      ],
    },
  },

  // 6. OPENAI API
  {
    id: 'openai',
    path: '/docs/api/openai',
    title: 'OpenAI API Integration',
    category: 'AI Model APIs',
    tagline: 'Stream GPT-4o, GPT-4o-mini & o3-mini directly with real-time lip-sync',
    logoUrl: 'https://muxai.vercel.app/logos/openai.jpg',
    content: {
      overview:
        'The OpenAI API integration connects your AI Smash chat directly to OpenAI\'s frontier models. Supported models include GPT-4o (flagship multimodal), GPT-4o-mini (lightweight high speed), and o3-mini (reasoning model). Streaming tokens, avatar speech synthesis, and latency metrics are fully supported.',
      prerequisites: [
        'An OpenAI API Key from https://platform.openai.com/api-keys',
        'Sufficient account balance or billing enabled on your OpenAI organization',
      ],
      steps: [
        {
          title: '1. Copy API Key',
          desc: 'Generate an API key in your OpenAI developer dashboard.',
        },
        {
          title: '2. Configure in AI Smash',
          desc: 'In AI Smash, open the Model Selector, scroll down to "OpenAI API", click "Configure API Key", paste your key, and select your preferred model (gpt-4o, gpt-4o-mini, o3-mini).',
        },
      ],
      parameters: [
        { name: 'apiKey', type: 'string (sk-...)', required: true, desc: 'OpenAI secret API key.' },
        { name: 'model', type: 'string', required: true, desc: 'Target model (e.g. gpt-4o, gpt-4o-mini, o3-mini).' },
        { name: 'maxTokens', type: 'number', required: false, desc: 'Max generation token count (64 - 4096).' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`,
      },
    },
  },

  // 7. GEMINI API
  {
    id: 'gemini',
    path: '/docs/api/gemini',
    title: 'Google Gemini API Integration',
    category: 'AI Model APIs',
    tagline: 'Google Gemini 2.5 Flash & 2.5 Pro with multimodal streaming',
    logoUrl: 'https://muxai.vercel.app/logos/gemini.jpg',
    content: {
      overview:
        'Google Gemini delivers fast reasoning and long-context windows. AI Smash supports Gemini 3.1 Flash-Lite, Gemini 3.8 Flash, and Gemini 3.1 Pro via the official @google/genai SDK with server-side proxy streaming.',
      prerequisites: [
        'A Google Gemini API key from Google AI Studio (https://aistudio.google.com)',
      ],
      steps: [
        {
          title: '1. Obtain Gemini API Key',
          desc: 'Create an API key in Google AI Studio.',
        },
        {
          title: '2. Select Gemini in Model Selector',
          desc: 'Select "Gemini API" in the Model Selector. You can use your custom API key or the pre-configured environment credentials.',
        },
      ],
      parameters: [
        { name: 'apiKey', type: 'string', required: false, desc: 'Custom Gemini key or server fallback.' },
        { name: 'model', type: 'string', required: true, desc: 'gemini-3.1-flash-lite, gemini-3.8-flash, gemini-3.1-pro-preview.' },
      ],
      codeExample: {
        lang: 'typescript',
        code: `import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const responseStream = await ai.models.generateContentStream({
  model: 'gemini-3.1-flash-lite',
  contents: [{ role: 'user', parts: [{ text: 'Hello Hana!' }] }],
});`,
      },
    },
  },

  // 8. ANTHROPIC API
  {
    id: 'anthropic',
    path: '/docs/api/anthropic',
    title: 'Anthropic Claude API Integration',
    category: 'AI Model APIs',
    tagline: 'Claude 3.7 Sonnet & Claude 3.5 Haiku intelligent reasoning',
    logoUrl: 'https://muxai.vercel.app/logos/claude.jpg',
    content: {
      overview:
        'Anthropic Claude delivers high steerability and deep nuanced conversational responses. AI Smash interfaces directly with the Anthropic Messages API with SSE streaming for Claude 3.7 Sonnet and Claude 3.5 Haiku.',
      prerequisites: [
        'Anthropic Console API Key from https://console.anthropic.com',
      ],
      steps: [
        {
          title: '1. Create Anthropic Key',
          desc: 'Under Anthropic Console -> API Keys -> Create Key.',
        },
        {
          title: '2. Select in Model Selector',
          desc: 'Paste your key into the Anthropic API configuration card in the Model Selector.',
        },
      ],
      parameters: [
        { name: 'x-api-key', type: 'string (sk-ant-...)', required: true, desc: 'Anthropic authentication key.' },
        { name: 'model', type: 'string', required: true, desc: 'claude-3-7-sonnet-20250219 or claude-3-5-haiku-20241022.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://api.anthropic.com/v1/messages \\
  -H "x-api-key: sk-ant-..." \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-3-7-sonnet-20250219",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello Claude"}]
  }'`,
      },
    },
  },

  // 9. xAI API
  {
    id: 'xai',
    path: '/docs/api/xai',
    title: 'xAI Grok API Integration',
    category: 'AI Model APIs',
    tagline: 'Grok 2 and Grok Beta with frontier reasoning',
    logoUrl: 'https://muxai.vercel.app/logos/grok.jpg',
    content: {
      overview:
        'xAI\'s Grok models provide witty, real-time grounded intelligence. AI Smash communicates with xAI\'s OpenAI-compatible completions endpoint with streaming tokens.',
      prerequisites: ['xAI Console API Key from https://console.x.ai'],
      parameters: [
        { name: 'apiKey', type: 'string', required: true, desc: 'xAI API Key.' },
        { name: 'model', type: 'string', required: true, desc: 'grok-2-latest or grok-beta.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://api.x.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer xai-..." \\
  -d '{"model": "grok-2-latest", "messages": [{"role": "user", "content": "Hello Grok!"}], "stream": true}'`,
      },
    },
  },

  // 10. GROQ API
  {
    id: 'groq',
    path: '/docs/api/groq',
    title: 'Groq LPU Inference API',
    category: 'AI Model APIs',
    tagline: 'Ultra-fast Llama 3.3 70B & Llama 3.1 8B at hundreds of tokens per second',
    logoUrl: 'https://muxai.vercel.app/logos/groq.jpg',
    content: {
      overview:
        'Groq\'s Language Processing Unit (LPU) architecture enables blazing fast inference speeds exceeding 400+ tokens/sec on open-weights models like Llama 3.3 70B Versatile and Mixtral.',
      prerequisites: ['GroqCloud API Key from https://console.groq.com'],
      parameters: [
        { name: 'apiKey', type: 'string (gsk_...)', required: true, desc: 'Groq API Key.' },
        { name: 'model', type: 'string', required: true, desc: 'llama-3.3-70b-versatile or llama-3.1-8b-instant.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://api.groq.com/openai/v1/chat/completions \\
  -H "Authorization: Bearer gsk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "llama-3.3-70b-versatile", "messages": [{"role": "user", "content": "Fast answer"}], "stream": true}'`,
      },
    },
  },

  // 11. Z.ai GLM API
  {
    id: 'zai',
    path: '/docs/api/zai',
    title: 'Z.ai GLM API Integration',
    category: 'AI Model APIs',
    tagline: 'Zhipu AI GLM-4 Plus & GLM-4 Flash language models',
    logoUrl: 'https://muxai.vercel.app/logos/zai.jpg',
    content: {
      overview:
        'Zhipu AI (Z.ai) GLM-4 provides advanced bilingual reasoning and high-speed chat capabilities.',
      prerequisites: ['Z.ai API Key from https://open.bigmodel.cn'],
      parameters: [
        { name: 'apiKey', type: 'string', required: true, desc: 'Z.ai API token.' },
        { name: 'model', type: 'string', required: true, desc: 'glm-4-plus or glm-4-flash.' },
      ],
    },
  },

  // 12. DEEPSEEK API
  {
    id: 'deepseek',
    path: '/docs/api/deepseek',
    title: 'DeepSeek API Integration',
    category: 'AI Model APIs',
    tagline: 'DeepSeek-V3 & DeepSeek-R1 reasoning models',
    logoUrl: 'https://muxai.vercel.app/logos/deepseek.jpg',
    content: {
      overview:
        'DeepSeek-V3 and DeepSeek-R1 deliver powerful mathematical reasoning and open-weights intelligence via standard OpenAI-compatible completions endpoints.',
      prerequisites: ['DeepSeek API Key from https://platform.deepseek.com'],
      parameters: [
        { name: 'apiKey', type: 'string', required: true, desc: 'DeepSeek API Key.' },
        { name: 'model', type: 'string', required: true, desc: 'deepseek-chat or deepseek-reasoner.' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://api.deepseek.com/chat/completions \\
  -H "Authorization: Bearer sk-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "Hello DeepSeek"}], "stream": true}'`,
      },
    },
  },

  // 13. QWEN API
  {
    id: 'qwen',
    path: '/docs/api/qwen',
    title: 'Qwen Alibaba Cloud API Integration',
    category: 'AI Model APIs',
    tagline: 'Alibaba Cloud DashScope Qwen-Max & Qwen-Turbo',
    logoUrl: 'https://muxai.vercel.app/logos/qwen.jpg',
    content: {
      overview:
        'Alibaba Cloud Qwen series offers leading bilingual and multilingual benchmark performance.',
      prerequisites: ['Alibaba Cloud DashScope API Key from https://dashscope.console.aliyun.com'],
      parameters: [
        { name: 'apiKey', type: 'string', required: true, desc: 'DashScope API Key.' },
        { name: 'model', type: 'string', required: true, desc: 'qwen-max or qwen-turbo.' },
      ],
    },
  },

  // 14. HUGGING FACE API
  {
    id: 'huggingface',
    path: '/docs/api/huggingface',
    title: 'Hugging Face Inference API',
    category: 'AI Model APIs',
    tagline: 'Serverless Router & Inference endpoints across thousands of open-source models',
    logoUrl: 'https://muxai.vercel.app/logos/huggingface.jpg',
    content: {
      overview:
        'Directly stream thousands of community and foundation models deployed on Hugging Face Serverless Router endpoints using your HF User Access Token.',
      prerequisites: ['Hugging Face User Access Token (read permissions) from https://huggingface.co/settings/tokens'],
      parameters: [
        { name: 'apiKey', type: 'string (hf_...)', required: true, desc: 'Hugging Face Access Token.' },
        { name: 'model', type: 'string', required: true, desc: 'Repo ID (e.g. meta-llama/Llama-3.3-70B-Instruct).' },
      ],
      codeExample: {
        lang: 'bash',
        code: `curl https://router.huggingface.co/hf-inference/v1/chat/completions \\
  -H "Authorization: Bearer hf_..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "meta-llama/Llama-3.3-70B-Instruct", "messages": [{"role": "user", "content": "Hi"}], "stream": true}'`,
      },
    },
  },
];

const GRAPHQL_PRESET_QUERIES: Array<{ label: string; desc: string; query: string }> = [
  {
    label: 'Query 3D Avatar & Outfits',
    desc: 'Fetch current VRM model URL, fallback mirrors, and all 16+ wardrobe outfits',
    query: `query GetAvatarAndWardrobe {
  avatar {
    url
    defaultOutfitId
    activeFile
    candidateUrls
    outfits {
      id
      name
      fileName
      isPremium
      isSecret
      modelUrl
    }
  }
}`,
  },
  {
    label: 'Query Facial Emotions & Morph Targets',
    desc: 'List supported expressions, VRM blendshape morph targets, and valences',
    query: `query GetFacialEmotions {
  emotions {
    name
    vrmMorph
    valence
    description
  }
}`,
  },
  {
    label: 'Query Voice Engine & Viseme Mappings',
    desc: 'Retrieve speech synthesis configuration, female voice priority queue, and lip-sync visemes',
    query: `query GetVoiceEngineConfig {
  voiceEngine {
    lang
    rate
    pitch
    preferredVoices
    acousticFilter
    visemes {
      viseme
      vrmMouthMorph
      phonemes
    }
  }
}`,
  },
  {
    label: 'Query Supported LLM Models',
    desc: 'Enumerate in-browser ONNX SLMs, Ollama servers, and external API providers',
    query: `query GetActiveModels {
  activeLlm {
    id
    name
    family
    speedRating
    inferenceType
    streamingEndpoint
    description
    approxParams
  }
}`,
  },
  {
    label: 'Trigger Avatar Action (Mutation)',
    desc: 'Broadcast speech, emotion, and gesture to all connected 3D viewports via SSE',
    query: `mutation DispatchAvatarAction {
  setAvatarAction(
    action: "speak"
    text: "Hello from third-party client application!"
    emotion: "happy"
    animation: "wave"
  ) {
    success
    message
    activeSubscribers
    event {
      type
      text
      emotion
      animation
      timestamp
    }
  }
}`,
  },
  {
    label: 'Detect Text Emotion (Mutation)',
    desc: 'Classify conversational sentiment to determine avatar facial expression',
    query: `mutation ClassifySentiment {
  detectEmotion(text: "Thank you so much! I am thrilled to work with you!") {
    text
    emotion
    method
  }
}`,
  },
  {
    label: 'Synthesize Viseme Phonemes (Mutation)',
    desc: 'Analyze phoneme breakdown and timing cues for custom audio lip-sync engines',
    query: `mutation AnalyzePhonemes {
  synthesizePhonemes(text: "Welcome to Hana 3D avatar platform") {
    text
    cues {
      word
      viseme
      vrmMorph
      intensity
    }
  }
}`,
  },
];

export const GraphQLExplorer: React.FC = () => {
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(0);
  const [queryInput, setQueryInput] = useState(GRAPHQL_PRESET_QUERIES[0].query);
  const [responseOutput, setResponseOutput] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedRes, setCopiedRes] = useState(false);

  const handleSelectPreset = (index: number) => {
    setSelectedPresetIndex(index);
    setQueryInput(GRAPHQL_PRESET_QUERIES[index].query);
  };

  const handleExecuteQuery = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryInput }),
      });
      const end = performance.now();
      setLatencyMs(Math.round(end - start));
      setStatusCode(res.status);
      const data = await res.json();
      setResponseOutput(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      const end = performance.now();
      setLatencyMs(Math.round(end - start));
      const msg = err instanceof Error ? err.message : 'Network request failed';
      setErrorMsg(msg);
      setStatusCode(500);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyResponse = () => {
    if (responseOutput && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(responseOutput);
      setCopiedRes(true);
      setTimeout(() => setCopiedRes(false), 2000);
    }
  };

  return (
    <div className="rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#141622] overflow-hidden shadow-xs my-6">
      <div className="p-4 border-b border-black/[0.06] dark:border-white/[0.06] bg-neutral-50/70 dark:bg-neutral-900/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[var(--theme-accent-soft)] flex items-center justify-center text-[var(--theme-accent)] shrink-0">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold font-heading text-neutral-900 dark:text-white flex items-center gap-2">
              <span>Interactive GraphQL Explorer</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--theme-accent-soft)] text-[var(--theme-accent)] font-semibold">
                POST /api/graphql
              </span>
            </h3>
            <p className="text-xs text-neutral-500">
              Execute live queries and mutations directly against the server schema
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExecuteQuery}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-[var(--theme-accent)] hover:opacity-90 active:scale-95 text-white shadow-xs transition-all cursor-pointer disabled:opacity-60"
        >
          {isLoading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>{isLoading ? 'Executing...' : 'Run Query'}</span>
        </button>
      </div>

      {/* Preset selector chips */}
      <div className="p-3 border-b border-black/[0.06] dark:border-white/[0.06] bg-neutral-50/40 dark:bg-neutral-900/30">
        <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold mb-2">
          Select Query / Mutation Template
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GRAPHQL_PRESET_QUERIES.map((preset, idx) => {
            const isSelected = selectedPresetIndex === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectPreset(idx)}
                className={`px-2.5 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--theme-accent)] text-white font-semibold shadow-xs'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Split view: Query Editor on left, Response on right */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-black/[0.06] dark:divide-white/[0.06]">
        {/* Left: Query Editor */}
        <div className="p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">
              GraphQL Query / Mutation
            </span>
            <span className="text-[11px] text-neutral-400 truncate max-w-[200px]">
              {GRAPHQL_PRESET_QUERIES[selectedPresetIndex]?.desc}
            </span>
          </div>
          <textarea
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            rows={12}
            className="w-full flex-1 p-3 font-mono text-xs rounded-xl bg-neutral-900 text-neutral-100 dark:bg-[#0a0c12] border border-black/10 dark:border-white/10 focus:outline-none focus:border-[var(--theme-accent)] resize-y"
            placeholder="Type your GraphQL query or mutation here..."
          />
        </div>

        {/* Right: Response Output */}
        <div className="p-4 flex flex-col bg-neutral-50/40 dark:bg-neutral-950/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">
                Result Output
              </span>
              {statusCode !== null && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    statusCode === 200
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                  }`}
                >
                  {statusCode} {statusCode === 200 ? 'OK' : 'Error'}
                </span>
              )}
              {latencyMs !== null && (
                <span className="text-[10px] font-mono text-neutral-400">
                  {latencyMs}ms
                </span>
              )}
            </div>

            {responseOutput && (
              <button
                type="button"
                onClick={handleCopyResponse}
                className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
              >
                {copiedRes ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedRes ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>

          <div className="w-full flex-1 min-h-[240px] p-3 font-mono text-xs rounded-xl bg-neutral-900 text-emerald-400 dark:bg-[#0a0c12] border border-black/10 dark:border-white/10 overflow-auto scrollbar-thin">
            {errorMsg ? (
              <div className="text-red-400">{errorMsg}</div>
            ) : responseOutput ? (
              <pre className="whitespace-pre-wrap">{responseOutput}</pre>
            ) : (
              <div className="text-neutral-500 italic py-12 text-center">
                Click &quot;Run Query&quot; above to execute this GraphQL operation against /api/graphql.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const DocsPage: React.FC<DocsPageProps> = ({
  currentPath,
  onNavigate,
  onBackToChat,
  onBackToHome,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const categories = [
    'Getting Started',
    'Hana APIs',
    'Hana features',
    'AI Model APIs',
    'Integrations',
  ] as const;

  // Normalize path to match article with alias support
  const activeArticle = useMemo(() => {
    const cleanPath = currentPath.replace(/\/+$/, '');
    const found = DOCS_ARTICLES.find(
      (a) => a.path === cleanPath || a.path === currentPath
    );
    if (found) return found;

    // Route alias mapping for developer convenience
    if (
      cleanPath.includes('/avatar') ||
      cleanPath.includes('/third-party') ||
      cleanPath.includes('/3d') ||
      cleanPath.includes('/vrm') ||
      cleanPath.includes('/hana-3d') ||
      cleanPath.includes('/graphql')
    ) {
      const match = DOCS_ARTICLES.find((a) => a.id === 'third-party-avatar');
      if (match) return match;
    }

    if (cleanPath.includes('/whatsapp')) {
      const match = DOCS_ARTICLES.find((a) => a.id === 'whatsapp-feature');
      if (match) return match;
    }

    if (cleanPath.includes('/telegram')) {
      const match = DOCS_ARTICLES.find((a) => a.id === 'telegram-feature');
      if (match) return match;
    }

    if (cleanPath.includes('/messenger')) {
      const match = DOCS_ARTICLES.find((a) => a.id === 'messenger-feature');
      if (match) return match;
    }

    if (cleanPath.includes('/omnichannel') || cleanPath.includes('/features')) {
      const match = DOCS_ARTICLES.find((a) => a.id === 'omnichannel-feature');
      if (match) return match;
    }

    return DOCS_ARTICLES[0];
  }, [currentPath]);

  // Filter sidebar articles by search query
  const filteredArticles = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return DOCS_ARTICLES;
    return DOCS_ARTICLES.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleCopyCode = (code: string, index: number) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedCodeIndex(index);
      setTimeout(() => setCopiedCodeIndex(null), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] dark:bg-[#0d0f16] text-[#1e2029] dark:text-[#f1f2f6] flex flex-col font-sans transition-colors">
      {/* Top GitBook-style Navigation Bar */}
      <header className="sticky top-0 z-40 w-full h-14 bg-white/90 dark:bg-[#11131c]/90 backdrop-blur-md border-b border-black/[0.08] dark:border-white/[0.08] px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="md:hidden p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {isMobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Logo / Brand */}
          <button
            type="button"
            onClick={onBackToHome}
            className="flex items-center gap-2 text-left cursor-pointer group"
          >
            <div className="w-7 h-7 rounded-xl overflow-hidden ring-1 ring-black/10 dark:ring-white/10 shadow-xs bg-white p-0.5">
              <img
                src={AI_PROFILE.avatarUrl}
                alt={AI_PROFILE.name}
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight font-heading">
                AI Smash
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--theme-accent-soft)] text-[var(--theme-accent)] font-semibold">
                DOCS
              </span>
            </div>
          </button>

          {/* Breadcrumbs */}
          <div className="hidden sm:flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500 ml-3 pl-3 border-l border-black/[0.08] dark:border-white/[0.08]">
            <span
              onClick={() => onNavigate('/docs')}
              className="hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              Docs
            </span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-neutral-600 dark:text-neutral-300 font-medium truncate max-w-[140px]">
              {activeArticle.category}
            </span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[var(--theme-accent)] font-semibold truncate max-w-[160px]">
              {activeArticle.title}
            </span>
          </div>
        </div>

        {/* Right CTA links */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBackToHome}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </button>
        </div>
      </header>

      {/* Main 2-column Layout */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        {/* Left Sidebar (GitBook style navigation) */}
        <aside
          className={`fixed inset-y-14 left-0 z-30 w-72 bg-white dark:bg-[#11131c] border-r border-black/[0.08] dark:border-white/[0.08] flex flex-col p-4 transition-transform duration-200 md:static md:translate-x-0 ${
            isMobileSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
          }`}
        >
          {/* Quick Search */}
          <div className="relative mb-4">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs, APIs, hooks..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-xl bg-neutral-100 dark:bg-[#1a1d2b] border border-black/[0.06] dark:border-white/[0.06] text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          {/* Navigation Categories */}
          <div className="flex-1 overflow-y-auto space-y-5 scrollbar-thin pr-1">
            {categories.map((cat) => {
              const catArticles = filteredArticles.filter((a) => a.category === cat);
              if (catArticles.length === 0) return null;

              return (
                <div key={cat} className="space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold px-2">
                    {cat}
                  </div>
                  <div className="space-y-0.5">
                    {catArticles.map((art) => {
                      const isActive = art.id === activeArticle.id;
                      return (
                        <button
                          key={art.id}
                          type="button"
                          onClick={() => {
                            onNavigate(art.path);
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[var(--theme-accent-soft)] text-neutral-900 dark:text-white font-semibold'
                              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 font-normal'
                          }`}
                        >
                          {art.logoUrl ? (
                            <div className="w-4 h-4 rounded-md overflow-hidden shrink-0 border border-black/10 dark:border-white/10 bg-white">
                              <img
                                src={art.logoUrl}
                                alt={art.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <BookOpen className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                          )}
                          <span className="truncate">{art.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Mobile backdrop */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* Center Documentation Article Body */}
        <main className="flex-1 p-6 sm:p-10 max-w-4xl min-w-0">
          {/* Article Header */}
          <div className="pb-6 border-b border-black/[0.08] dark:border-white/[0.08] mb-8">
            <div className="flex items-center gap-3 mb-3">
              {activeArticle.logoUrl && (
                <div className="w-12 h-12 rounded-2xl overflow-hidden border border-black/10 dark:border-white/10 shadow-sm bg-white p-0.5 shrink-0">
                  <img
                    src={activeArticle.logoUrl}
                    alt={activeArticle.title}
                    className="w-full h-full object-cover rounded-xl"
                  />
                </div>
              )}
              <div>
                <span className="text-xs font-mono text-[var(--theme-accent)] font-semibold uppercase tracking-wider">
                  {activeArticle.category}
                </span>
                <h1 className="text-2xl sm:text-3xl font-bold font-heading text-neutral-900 dark:text-white tracking-tight mt-0.5">
                  {activeArticle.title}
                </h1>
              </div>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed max-w-2xl">
              {activeArticle.tagline}
            </p>
          </div>

          {/* Overview Section */}
          <section className="mb-8">
            <h2 className="text-lg font-bold font-heading text-neutral-900 dark:text-white mb-2">
              Overview
            </h2>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              {activeArticle.content.overview}
            </p>
          </section>

          {/* 3D Avatar Architectural Capability Cards */}
          {activeArticle.category === 'Hana APIs' && (
            <div className="mb-8 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Layers className="w-3.5 h-3.5 text-[var(--theme-accent)]" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    3D VRM 1.0 Avatar
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  Proxy at <code className="text-[var(--theme-accent)]">/api/vrm</code> with 16+ wardrobe skins
                </p>
              </div>

              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Play className="w-3.5 h-3.5 text-pink-500" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    Mixamo Animations
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  8+ FBX streams (<code className="text-pink-500">idle, walk, wave, fall</code>)
                </p>
              </div>

              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    Facial Expressions
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  6 emotion blendshapes &amp; <code className="text-amber-500">/api/emotion</code>
                </p>
              </div>

              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    Voice &amp; Lip-Sync
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  Phoneme-to-viseme maps (<code className="text-emerald-500">aa, ih, ou, ee, oh</code>)
                </p>
              </div>

              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Radio className="w-3.5 h-3.5 text-violet-500" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    Live Event Bus
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  SSE sync at <code className="text-violet-500">/api/avatar/events</code>
                </p>
              </div>

              <div className="p-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="w-3.5 h-3.5 text-cyan-500" />
                  <span className="text-[11px] font-mono font-bold text-neutral-900 dark:text-white">
                    Universal GraphQL
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 leading-tight">
                  Single query endpoint at <code className="text-cyan-500">/api/graphql</code>
                </p>
              </div>
            </div>
          )}

          {/* Hana Features Omnichannel Calling Capability Banner */}
          {activeArticle.category === 'Hana features' && (
            <div className="mb-8 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/docs/features/whatsapp')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                    activeArticle.id === 'whatsapp-feature'
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/60 shadow-xs'
                      : 'bg-white dark:bg-[#141622] border-black/[0.06] dark:border-white/[0.06] hover:bg-neutral-50 dark:hover:bg-neutral-900/60'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl overflow-hidden border border-emerald-200 bg-white shrink-0 shadow-xs">
                    <img
                      src="https://muxai.vercel.app/logos/whatsapp.jpg"
                      alt="WhatsApp"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1">
                      <span>WhatsApp Business</span>
                      {activeArticle.id === 'whatsapp-feature' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-500 truncate">Meta Cloud Calling API</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('/docs/features/telegram')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                    activeArticle.id === 'telegram-feature'
                      ? 'bg-sky-50/80 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700/60 shadow-xs'
                      : 'bg-white dark:bg-[#141622] border-black/[0.06] dark:border-white/[0.06] hover:bg-neutral-50 dark:hover:bg-neutral-900/60'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl overflow-hidden border border-sky-200 bg-white shrink-0 shadow-xs">
                    <img
                      src="https://muxai.vercel.app/logos/telegram.jpg"
                      alt="Telegram"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1">
                      <span>Telegram Voice Bot</span>
                      {activeArticle.id === 'telegram-feature' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-500 truncate">MTProto Voice &amp; VoIP</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('/docs/features/messenger')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-3 ${
                    activeArticle.id === 'messenger-feature'
                      ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/60 shadow-xs'
                      : 'bg-white dark:bg-[#141622] border-black/[0.06] dark:border-white/[0.06] hover:bg-neutral-50 dark:hover:bg-neutral-900/60'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl overflow-hidden border border-indigo-200 bg-white shrink-0 shadow-xs">
                    <img
                      src="https://muxai.vercel.app/logos/messenger.jpg"
                      alt="Messenger"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1">
                      <span>Messenger Audio</span>
                      {activeArticle.id === 'messenger-feature' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-500 truncate">Meta Graph Audio Bridge</p>
                  </div>
                </button>
              </div>

              <div className="p-3 rounded-xl bg-neutral-100/70 dark:bg-neutral-900/50 border border-black/[0.06] dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>All omnichannel credentials are saved securely in browser storage and persist across refreshes.</span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('/caller')}
                  className="px-3 py-1 rounded-lg bg-[var(--theme-accent)] hover:opacity-90 text-white font-semibold flex items-center gap-1 text-[11px] shadow-xs cursor-pointer"
                >
                  <Zap className="w-3 h-3" />
                  <span>Open /caller Console</span>
                </button>
              </div>
            </div>
          )}

          {/* Interactive GraphQL Playground for Hana APIs */}
          {(activeArticle.category === 'Hana APIs' ||
            activeArticle.id === 'third-party-avatar') && (
            <section className="mb-8">
              <h2 className="text-lg font-bold font-heading text-neutral-900 dark:text-white mb-1">
                Interactive GraphQL Playground
              </h2>
              <p className="text-xs text-neutral-500 mb-3">
                Test and execute live GraphQL queries or mutations against <code className="font-mono text-[var(--theme-accent)]">/api/graphql</code> to inspect the 3D model, emotions, animations, voice visemes, or dispatch live actions.
              </p>
              <GraphQLExplorer />
            </section>
          )}

          {/* Prerequisites */}
          {activeArticle.content.prerequisites && (
            <section className="mb-8 p-4 rounded-2xl bg-neutral-100/70 dark:bg-neutral-900/60 border border-black/[0.06] dark:border-white/[0.06]">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-500 mb-2">
                Prerequisites
              </h3>
              <ul className="space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                {activeArticle.content.prerequisites.map((req, rIdx) => (
                  <li key={rIdx} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--theme-accent)] mt-1.5 shrink-0" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Setup Steps */}
          {activeArticle.content.steps && (
            <section className="mb-8 space-y-4">
              <h2 className="text-lg font-bold font-heading text-neutral-900 dark:text-white">
                Step-by-Step Configuration
              </h2>
              <div className="space-y-3">
                {activeArticle.content.steps.map((st, sIdx) => (
                  <div
                    key={sIdx}
                    className="p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-white dark:bg-[#141622] shadow-xs"
                  >
                    <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {st.title}
                    </h4>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1 leading-relaxed">
                      {st.desc}
                    </p>
                    {st.code && (
                      <div className="mt-2">
                        <CodeBlockView code={st.code} lang={st.lang || 'bash'} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Slash Commands Table (for Discord) */}
          {activeArticle.content.slashCommands && (
            <section className="mb-8">
              <h2 className="text-lg font-bold font-heading text-neutral-900 dark:text-white mb-3">
                Supported Slash Commands
              </h2>
              <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#141622]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-neutral-900/80 border-b border-black/[0.06] dark:border-white/[0.06] text-neutral-500 font-mono">
                    <tr>
                      <th className="p-3">Command</th>
                      <th className="p-3">Function</th>
                      <th className="p-3">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {activeArticle.content.slashCommands.map((sc, scIdx) => (
                      <tr key={scIdx}>
                        <td className="p-3 font-mono font-bold text-[var(--theme-accent)]">
                          {sc.cmd}
                        </td>
                        <td className="p-3 text-neutral-700 dark:text-neutral-300">
                          {sc.desc}
                        </td>
                        <td className="p-3 font-mono text-neutral-500">
                          {sc.example}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Parameters Table */}
          {activeArticle.content.parameters && (
            <section className="mb-8">
              <h2 className="text-lg font-bold font-heading text-neutral-900 dark:text-white mb-3">
                Configuration Fields
              </h2>
              <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-[#141622]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 dark:bg-neutral-900/80 border-b border-black/[0.06] dark:border-white/[0.06] text-neutral-500 font-mono">
                    <tr>
                      <th className="p-3">Field</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Required</th>
                      <th className="p-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    {activeArticle.content.parameters.map((param, pIdx) => (
                      <tr key={pIdx}>
                        <td className="p-3 font-mono font-semibold text-neutral-900 dark:text-white">
                          {param.name}
                        </td>
                        <td className="p-3 font-mono text-neutral-500">
                          {param.type}
                        </td>
                        <td className="p-3">
                          {param.required ? (
                            <span className="px-1.5 py-0.5 rounded font-mono text-[9px] bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                              REQUIRED
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded font-mono text-[9px] bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                              OPTIONAL
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-neutral-700 dark:text-neutral-300">
                          {param.desc}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Code Snippet Example with Copy Button */}
          {activeArticle.content.codeExample && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  Code / Request Example ({activeArticle.content.codeExample.lang})
                </h3>
              </div>

              <CodeBlockView
                code={activeArticle.content.codeExample.code}
                lang={activeArticle.content.codeExample.lang}
              />
            </section>
          )}

          {/* Pro Tips Callout */}
          {activeArticle.content.tips && (
            <section className="p-4 rounded-2xl bg-[var(--theme-accent-soft)] border border-[var(--theme-border)] space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-[var(--theme-accent)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Pro-Tips & Performance Notes
              </h4>
              <ul className="space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                {activeArticle.content.tips.map((tip, tIdx) => (
                  <li key={tIdx} className="flex items-start gap-2">
                    <span>&bull;</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
