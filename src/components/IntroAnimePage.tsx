import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';
import confetti from 'canvas-confetti';
import {
  Play,
  Sparkles,
  Shield,
  Layers,
  Zap,
  Radio,
  MessageSquare,
  Sun,
  FileCheck,
  Video,
  CheckCircle2,
} from 'lucide-react';
import {
  MODEL_SOURCE_DOMAIN,
  MODEL_FALLBACK_DOMAIN,
  VOICE_CONFIG,
} from '../constants';
import { waitForPersonaVoice } from '../lib/audio';

// ---------------------------------------------------------------------------
// TYPES & CONSTANTS
// ---------------------------------------------------------------------------

interface IntroAnimePageProps {
  onBackToChat: () => void;
  onNavigateHome: () => void;
  onNavigateToInterview?: () => void;
  onNavigateToHumanizer?: () => void;
}

interface ShowcaseOutfit {
  id: string;
  name: string;
  theme: string;
  badge: string;
  color: string;
  fileName: string;
}

const SHOWCASE_OUTFITS: ShowcaseOutfit[] = [
  {
    id: 'mint-maid',
    name: 'Mint Maid Apron',
    theme: 'ANGELIC SIGNATURE',
    badge: 'CLASSIC // ICONIC',
    color: '#0284c7',
    fileName: 'hana_v1.5_vrm1.vrm',
  },
  {
    id: 'candy-maid',
    name: 'Candy Maid Apron',
    theme: 'SWEET PASTEL SUGAR',
    badge: 'KAWAII // PINK',
    color: '#e11d48',
    fileName: 'hana_v1.0_pinkmaid_vrm1.vrm',
  },
  {
    id: 'imperial',
    name: 'Imperial Noblewoman',
    theme: 'ROYAL DYNASTY',
    badge: 'ELEGANCE // GOLD',
    color: '#d97706',
    fileName: 'hana_v1.0_imperial_vrm1.vrm',
  },
  {
    id: 'gothic',
    name: 'Gothic Beauty',
    theme: 'MIDNIGHT NOIR',
    badge: 'SECRET // DARK VELVET',
    color: '#9333ea',
    fileName: 'hana_v1.0_gothicdress_vrm1.vrm',
  },
  {
    id: 'red-dress',
    name: 'Memorable Night',
    theme: 'SCARLET VELVET',
    badge: 'VINTAGE // ELEGANT',
    color: '#dc2626',
    fileName: 'hana_v1.0_reddress_vrm1.vrm',
  },
  {
    id: 'interviewer',
    name: 'Professional Interviewer',
    theme: 'EXECUTIVE ACADEMIC',
    badge: 'CAREER // FORMAL',
    color: '#0891b2',
    fileName: 'hana_v1.5_interviewer_vrm1.vrm',
  },
];

interface ActSceneDef {
  id: number;
  title: string;
  subtitle: string;
  startTime: number;
  endTime: number;
  animFile: string;
  voiceLine: string;
  camera: {
    fromPos: [number, number, number];
    toPos: [number, number, number];
    fromTarget: [number, number, number];
    toTarget: [number, number, number];
    fov: number;
  };
  lightingColor: number;
  accentColor: string;
  lookAtViewer: boolean; // Direct gaze towards viewer in Act 02, Act 04, Act 06
}

const ACT_SCENES: ActSceneDef[] = [
  {
    id: 0,
    title: 'OVERTURE',
    subtitle: 'WAKE UP, REBEL. MEET HANA.',
    startTime: 0,
    endTime: 5.5,
    animFile: 'mixamo_wave.fbx',
    voiceLine: 'Hello! I am Hana, your private and decentralized anime companion. Welcome to our luminous world.',
    camera: {
      fromPos: [0.0, 1.35, 0.55],
      toPos: [0.35, 1.15, 1.75],
      fromTarget: [0.0, 1.3, 0.0],
      toTarget: [0.0, 1.0, 0.0],
      fov: 32,
    },
    lightingColor: 0x55d2f6,
    accentColor: '#0284c7',
    lookAtViewer: false,
  },
  {
    id: 1,
    title: 'NEURAL SOUL',
    subtitle: 'SELF-HOSTED & DECENTRALIZED SLM',
    startTime: 5.5,
    endTime: 12.0,
    animFile: 'mixamo_feelingshy.fbx',
    voiceLine: 'Powered entirely by local neural SLMs, in-browser WebGPU acceleration, and private self-hosted intelligence.',
    camera: {
      fromPos: [-0.65, 0.55, 1.45],
      toPos: [0.45, 1.3, 1.55],
      fromTarget: [0.0, 1.15, 0.0],
      toTarget: [0.0, 1.05, 0.0],
      fov: 28,
    },
    lightingColor: 0x00f0ff,
    accentColor: '#0284c7',
    lookAtViewer: true, // Eye contact with viewer in Act 02
  },
  {
    id: 2,
    title: 'WARDROBE MORPH',
    subtitle: 'FREEZE-FRAME OUTFIT REVOLUTION',
    startTime: 12.0,
    endTime: 19.5,
    animFile: 'mixamo_thankful.fbx',
    voiceLine: 'With an entire wardrobe at your fingertips. Transform your style in an instant for any occasion.',
    camera: {
      fromPos: [1.1, 1.25, 1.2],
      toPos: [-1.1, 0.95, 1.2],
      fromTarget: [0.0, 1.0, 0.0],
      toTarget: [0.0, 1.0, 0.0],
      fov: 34,
    },
    lightingColor: 0xffa500,
    accentColor: '#d97706',
    lookAtViewer: false,
  },
  {
    id: 3,
    title: 'ACADEMIC & CAREER SUITE',
    subtitle: 'AUTONOMOUS AI INTERVIEWER & HUMANIZER',
    startTime: 19.5,
    endTime: 27.0,
    animFile: 'mixamo_talking.fbx',
    voiceLine: 'Practice full mock technical interviews with visual camera checks, and polish essays with our sentence flow humanizer.',
    camera: {
      fromPos: [0.75, 1.45, 1.35],
      toPos: [-0.65, 0.85, 1.45],
      fromTarget: [0.0, 1.1, 0.0],
      toTarget: [0.0, 0.95, 0.0],
      fov: 34,
    },
    lightingColor: 0x38bdf8,
    accentColor: '#0284c7',
    lookAtViewer: true, // Eye contact with viewer in Act 04
  },
  {
    id: 4,
    title: 'OMNICHANNEL MATRIX',
    subtitle: 'NEURAL TTS, DISCORD & WORKFLOWS',
    startTime: 27.0,
    endTime: 34.0,
    animFile: 'mixamo_soulspin_dance.fbx',
    voiceLine: 'Speak with me using real-time viseme lip-sync, or connect directly into Discord, Twitch, and automation pipelines.',
    camera: {
      fromPos: [-0.9, 1.15, 1.6],
      toPos: [0.9, 1.15, 1.6],
      fromTarget: [0.0, 1.05, 0.0],
      toTarget: [0.0, 1.05, 0.0],
      fov: 30,
    },
    lightingColor: 0xfacc15,
    accentColor: '#ca8a04',
    lookAtViewer: false, // Dance animation
  },
  {
    id: 5,
    title: 'ALL-OUT FINALE',
    subtitle: 'SHOWTIME! ENTER THE EXPERIENCE',
    startTime: 34.0,
    endTime: 42.0,
    animFile: 'mixamo_rumba_dance.fbx',
    voiceLine: 'Our journey starts right now! Step in and talk with me whenever you are ready.',
    camera: {
      fromPos: [0.0, 1.1, 1.8],
      toPos: [0.0, 1.15, 1.5],
      fromTarget: [0.0, 1.05, 0.0],
      toTarget: [0.0, 1.05, 0.0],
      fov: 32,
    },
    lightingColor: 0xffffff,
    accentColor: '#0284c7',
    lookAtViewer: true, // Eye contact with viewer in Act 06
  },
];

const TOTAL_INTRO_DURATION = 42.0;

// Caches for zero-latency asset usage
const vrmBufferCache = new Map<string, ArrayBuffer>();
const fbxBufferCache = new Map<string, ArrayBuffer>();

async function fetchAssetBuffer(type: 'vrm' | 'fbx', fileName: string): Promise<ArrayBuffer | null> {
  const cache = type === 'vrm' ? vrmBufferCache : fbxBufferCache;
  if (cache.has(fileName)) {
    return cache.get(fileName)!.slice(0);
  }

  const candidateUrls = type === 'vrm'
    ? [
        `/api/vrm?file=${encodeURIComponent(fileName)}`,
        `${MODEL_SOURCE_DOMAIN}/${fileName}`,
        `${MODEL_FALLBACK_DOMAIN}/${fileName}`,
        `https://ai.mux8.com/${fileName}`,
        `https://muxai.vercel.app/${fileName}`,
      ]
    : [
        `/api/animation/wait?file=${encodeURIComponent(fileName)}`,
        `${MODEL_SOURCE_DOMAIN}/${fileName}`,
        `${MODEL_FALLBACK_DOMAIN}/${fileName}`,
        `https://ai.mux8.com/${fileName}`,
        `https://muxai.vercel.app/${fileName}`,
      ];

  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (buf && buf.byteLength > 1000) {
          cache.set(fileName, buf);
          return buf.slice(0);
        }
      }
    } catch {}
  }
  return null;
}

// Localize animation clips so root hips motion is centered
function localizeAnimationClip(clip: THREE.AnimationClip, vrm?: VRM): THREE.AnimationClip {
  let restHipsY = 0.85;
  if (vrm && vrm.humanoid) {
    const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hipsNode && hipsNode.position.y > 0.45) {
      restHipsY = hipsNode.position.y;
    }
  }

  for (const track of clip.tracks) {
    if (track.name.endsWith('.position') && track.values.length >= 3) {
      const values = track.values;
      const baseX = values[0];
      const baseZ = values[2];

      let sumY = 0;
      let count = 0;
      for (let i = 1; i < values.length; i += 3) {
        sumY += values[i];
        count++;
      }
      const avgY = count > 0 ? sumY / count : 0;
      const isHipsTrack = track.name.toLowerCase().includes('hips');
      const yOffset = (isHipsTrack || avgY < 0.45) ? (avgY < 0.45 ? restHipsY : 0) : 0;

      for (let i = 0; i < values.length; i += 3) {
        values[i] = (values[i] - baseX) * 0.25;
        values[i + 1] = Math.min(values[i + 1] + yOffset, 1.25);
        values[i + 2] = (values[i + 2] - baseZ) * 0.25;
      }
    }
  }
  return clip;
}

// Helper to update facial expression: Happy ONLY during Act 05 (spin dance); Smug & relaxed all other times
function applyFacialExpression(vrm: VRM | null, sceneIndex: number) {
  if (!vrm || !vrm.expressionManager) return;
  const em = vrm.expressionManager;

  // Clear previous emotion values
  em.setValue('happy', 0.0);
  em.setValue('relaxed', 0.0);
  em.setValue('surprised', 0.0);
  em.setValue('neutral', 0.0);

  if (sceneIndex === 4) {
    // Act 05 (spin dance): Radiant happy smile!
    em.setValue('happy', 0.85);
    em.setValue('relaxed', 0.2);
  }
  else if (sceneIndex === 5) {
    em.setValue('relaxed', 0.7);
    em.setValue('happy', 0.18); // slight confident smirk
  } else {
    em.setValue('happy', 0.0);
    em.setValue('relaxed', 0.50);
    em.setValue('surprised', 0.0);
    em.setValue('neutral', 0.0);
  }
  em.update();
}

// ---------------------------------------------------------------------------
// INTRO ANIME PAGE COMPONENT
// ---------------------------------------------------------------------------

export const IntroAnimePage: React.FC<IntroAnimePageProps> = ({
  onBackToChat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedlinesCanvasRef = useRef<HTMLCanvasElement>(null);

  // Loading & Preload states
  const [isPreloading, setIsPreloading] = useState<boolean>(true);
  const [preloadProgress, setPreloadProgress] = useState<number>(0);
  const [preloadStatus, setPreloadStatus] = useState<string>('INITIATING CELESTIAL STAGE...');
  const [isStarted, setIsStarted] = useState<boolean>(false);

  // Playback & Timing
  const [currentTime, setCurrentTime] = useState<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number>(0);

  // Outfit showcase state (freeze frame swap)
  const [currentOutfitIndex, setCurrentOutfitIndex] = useState<number>(0);
  const [isFreezeFrameActive, setIsFreezeFrameActive] = useState<boolean>(false);
  const [flashTrigger, setFlashTrigger] = useState<boolean>(false);

  // Three.js Core Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const floorGroupRef = useRef<THREE.Group | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);

  // VRM Model & Animation Refs
  const vrmModelsMapRef = useRef<Map<string, VRM>>(new Map());
  const activeVrmRef = useRef<VRM | null>(null);
  const activeMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const retargetedClipsMapRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const currentAnimFileRef = useRef<string>('');

  // Web Audio Context & BGM nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const bgmIntervalRef = useRef<number | null>(null);
  const lastSpokenSceneRef = useRef<number>(-1);

  // -------------------------------------------------------------------------
  // WEB AUDIO SYNTH ENGINE
  // -------------------------------------------------------------------------
  const initAudioCtx = useCallback(() => {
    if (!audioCtxRef.current && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.85, ctx.currentTime);
        master.connect(ctx.destination);
        audioCtxRef.current = ctx;
        masterGainRef.current = master;
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const stopBgm = useCallback(() => {
    if (bgmIntervalRef.current) {
      clearInterval(bgmIntervalRef.current);
      bgmIntervalRef.current = null;
    }
  }, []);

  // Complete Audio Teardown
  const fullAudioCleanup = useCallback(() => {
    stopBgm();
    if (masterGainRef.current && audioCtxRef.current) {
      try {
        masterGainRef.current.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
      } catch {}
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
      masterGainRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [stopBgm]);

  useEffect(() => {
    return () => {
      fullAudioCleanup();
    };
  }, [fullAudioCleanup]);

  const playSfx = useCallback((type: 'slash' | 'shutter' | 'stamp' | 'scratch' | 'morph' | 'fanfare') => {
    initAudioCtx();
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master) return;

    try {
      const now = ctx.currentTime;
      if (type === 'slash') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.25);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'shutter') {
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(1400, now);
        osc1.frequency.exponentialRampToValueAtTime(450, now + 0.08);
        gain1.gain.setValueAtTime(0.35, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc1.connect(gain1);
        gain1.connect(master);
        osc1.start(now);
        osc1.stop(now + 0.08);
      } else if (type === 'morph') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.22);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'fanfare') {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);
          gain.gain.setValueAtTime(0.22, now + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
          osc.connect(gain);
          gain.connect(master);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.4);
        });
      }
    } catch {}
  }, [initAudioCtx]);

  // Dynamic anime funk beat sequencer
  const startBgm = useCallback(() => {
    initAudioCtx();
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master) return;

    if (bgmIntervalRef.current) {
      clearInterval(bgmIntervalRef.current);
      bgmIntervalRef.current = null;
    }

    const bpm = 128;
    const beatSec = 60 / bpm;
    const sixteenthSec = beatSec / 4;

    const chords = [
      [146.83, 220.0, 261.63, 329.63], // Dm7
      [174.61, 261.63, 329.63, 392.0], // Fmaj7
      [196.0, 293.66, 349.23, 440.0],  // G7
      [220.0, 261.63, 329.63, 392.0],  // Am7
    ];

    let step = 0;
    const intervalId = window.setInterval(() => {
      if (!isPlayingRef.current || !audioCtxRef.current) {
        return;
      }
      const now = ctx.currentTime;
      const measure = Math.floor(step / 16) % chords.length;
      const subStep = step % 16;
      const chord = chords[measure];

      // Bass on 1, 4, 7, 10, 13
      if ([0, 3, 6, 9, 12].includes(subStep)) {
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        bassOsc.type = 'triangle';
        const root = chord[0] / 2;
        bassOsc.frequency.setValueAtTime(root, now);
        bassGain.gain.setValueAtTime(0.22, now);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        bassOsc.connect(bassGain);
        bassGain.connect(master);
        bassOsc.start(now);
        bassOsc.stop(now + 0.18);
      }

      // Snare on beat 2 and 4 (step 4, 12)
      if (subStep === 4 || subStep === 12) {
        const snareOsc = ctx.createOscillator();
        const snareGain = ctx.createGain();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(240, now);
        snareOsc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
        snareGain.gain.setValueAtTime(0.18, now);
        snareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        snareOsc.connect(snareGain);
        snareGain.connect(master);
        snareOsc.start(now);
        snareOsc.stop(now + 0.08);
      }

      // Hi-hat on every 8th note
      if (subStep % 2 === 0) {
        const hatOsc = ctx.createOscillator();
        const hatGain = ctx.createGain();
        hatOsc.type = 'square';
        hatOsc.frequency.setValueAtTime(3400 + (subStep % 4 === 0 ? 300 : 0), now);
        hatGain.gain.setValueAtTime(0.045, now);
        hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        hatOsc.connect(hatGain);
        hatGain.connect(master);
        hatOsc.start(now);
        hatOsc.stop(now + 0.04);
      }

      // Chord stab on 0, 6, 10
      if (subStep === 0 || subStep === 6 || subStep === 10) {
        chord.forEach((freq) => {
          const chordOsc = ctx.createOscillator();
          const chordGain = ctx.createGain();
          chordOsc.type = 'sine';
          chordOsc.frequency.setValueAtTime(freq, now);
          chordGain.gain.setValueAtTime(0.055, now);
          chordGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          chordOsc.connect(chordGain);
          chordGain.connect(master);
          chordOsc.start(now);
          chordOsc.stop(now + 0.2);
        });
      }

      step++;
    }, sixteenthSec * 1000);

    bgmIntervalRef.current = intervalId;
  }, [initAudioCtx]);

  // Voice synthesis speaker
  const speakSceneDialogue = useCallback(async (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const voice = await waitForPersonaVoice(800);
      const utter = new SpeechSynthesisUtterance(text);
      if (voice) utter.voice = voice;
      utter.pitch = VOICE_CONFIG.pitch || 1.25;
      utter.rate = 1.08;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {}
  }, []);

  // Keyboard navigation & audio resume listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        fullAudioCleanup();
        onBackToChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fullAudioCleanup, onBackToChat]);

  // Start Showtime Click Handler
  const handleStartShowtime = () => {
    initAudioCtx();
    setIsStarted(true);
    isPlayingRef.current = true;
    startBgm();
    playSfx('shutter');
    speakSceneDialogue(ACT_SCENES[0].voiceLine);
  };

  // -------------------------------------------------------------------------
  // 3D SCENE INITIALIZATION (BRIGHT CELESTIAL STAGE, NO GOD RAYS)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Three.js Scene
    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    // Perspective Camera
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 50);
    camera.position.set(0, 1.2, 1.8);
    camera.lookAt(0, 1.0, 0);
    cameraRef.current = camera;

    // WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Bright Daylight Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8eb, 1.7);
    dirLight.position.set(2.5, 4.0, 2.5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 12;
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const skyFillLight = new THREE.DirectionalLight(0xbae6fd, 0.85);
    skyFillLight.position.set(-2.5, 2.5, 1.5);
    scene.add(skyFillLight);

    const sunRimLight = new THREE.DirectionalLight(0xffedd5, 1.35);
    sunRimLight.position.set(-0.5, 3.0, -2.5);
    scene.add(sunRimLight);
    rimLightRef.current = sunRimLight;

    // Bright Pearlescent Floor Rings
    const floorGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.85, 1.45, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.01;
    floorGroup.add(ringMesh);

    const outerRingGeo = new THREE.RingGeometry(1.65, 1.72, 64);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRingMesh.rotation.x = -Math.PI / 2;
    outerRingMesh.position.y = 0.01;
    floorGroup.add(outerRingMesh);

    scene.add(floorGroup);
    floorGroupRef.current = floorGroup;

    // Floating Golden Sunlit Sparkles
    const particleCount = 80;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePos[i] = (Math.random() - 0.5) * 4.5;
      particlePos[i + 1] = Math.random() * 3.2;
      particlePos[i + 2] = (Math.random() - 0.5) * 4.5;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xffedd5,
      size: 0.04,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const particlePoints = new THREE.Points(particleGeo, particleMat);
    scene.add(particlePoints);
    particlesRef.current = particlePoints;

    // Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // -----------------------------------------------------------------------
    // ASSET PRELOAD PIPELINE
    // -----------------------------------------------------------------------
    let isCancelled = false;

    const runPreload = async () => {
      try {
        setPreloadStatus('INITIALIZING LUMINOUS ENGINE...');
        setPreloadProgress(10);

        const gltfLoader = new GLTFLoader();
        gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
        const fbxLoader = new FBXLoader();

        // 1. Pre-fetch and parse all showcase outfits
        const totalOutfits = SHOWCASE_OUTFITS.length;
        for (let i = 0; i < totalOutfits; i++) {
          if (isCancelled) return;
          const outfit = SHOWCASE_OUTFITS[i];
          setPreloadStatus(`CACHING OUTFIT [${i + 1}/${totalOutfits}]: ${outfit.name.toUpperCase()}...`);
          setPreloadProgress(10 + Math.round((i / totalOutfits) * 40));

          const vrmBuf = await fetchAssetBuffer('vrm', outfit.fileName);
          if (vrmBuf && !vrmModelsMapRef.current.has(outfit.fileName)) {
            await new Promise<void>((resolve) => {
              gltfLoader.parse(
                vrmBuf,
                '',
                (gltf) => {
                  const vrm = gltf.userData.vrm as VRM;
                  if (vrm) {
                    try {
                      VRMUtils.removeUnnecessaryVertices(gltf.scene);
                      VRMUtils.rotateVRM0(vrm);
                    } catch {}

                    vrm.scene.position.set(0, 0, 0);
                    vrm.scene.rotation.set(0, 0, 0);

                    // Ensure ground alignment
                    vrm.scene.updateMatrixWorld(true);
                    const bbox = new THREE.Box3().setFromObject(vrm.scene);
                    if (bbox.min.y < 0) {
                      vrm.scene.position.y = -bbox.min.y;
                    }

                    vrm.scene.traverse((obj) => {
                      obj.frustumCulled = false;
                      if ((obj as THREE.Mesh).isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                      }
                    });

                    vrmModelsMapRef.current.set(outfit.fileName, vrm);
                  }
                  resolve();
                },
                () => resolve()
              );
            });
          }
        }

        // 2. Pre-fetch and parse Mixamo animations
        const animFiles = [
          'mixamo_wave.fbx',
          'mixamo_talking.fbx',
          'mixamo_feelingshy.fbx',
          'mixamo_coolpoint.fbx',
          'mixamo_thankful.fbx',
          'mixamo_soulspin_dance.fbx',
          'mixamo_rumba_dance.fbx',
          'mixamo_idle.fbx',
        ];

        const primaryVrm = vrmModelsMapRef.current.get(SHOWCASE_OUTFITS[0].fileName);
        for (let j = 0; j < animFiles.length; j++) {
          if (isCancelled) return;
          const aFile = animFiles[j];
          setPreloadStatus(`RETARGETING SKELETON [${j + 1}/${animFiles.length}]: ${aFile.toUpperCase()}...`);
          setPreloadProgress(50 + Math.round((j / animFiles.length) * 45));

          const fbxBuf = await fetchAssetBuffer('fbx', aFile);
          if (fbxBuf && primaryVrm) {
            try {
              const fbxGroup = fbxLoader.parse(fbxBuf, '');
              const rawClip = retargetAnimation(fbxGroup, primaryVrm);
              if (rawClip) {
                const localized = localizeAnimationClip(rawClip, primaryVrm);
                retargetedClipsMapRef.current.set(aFile, localized);
              }
            } catch {}
          }
        }

        // Mount default VRM into scene
        if (primaryVrm && sceneRef.current) {
          sceneRef.current.add(primaryVrm.scene);
          activeVrmRef.current = primaryVrm;

          const mixer = new THREE.AnimationMixer(primaryVrm.scene);
          activeMixerRef.current = mixer;

          const firstClip = retargetedClipsMapRef.current.get('mixamo_wave.fbx');
          if (firstClip) {
            const act = mixer.clipAction(firstClip);
            act.play();
            currentActionRef.current = act;
            currentAnimFileRef.current = 'mixamo_wave.fbx';
          }

          // Initial expression: Smug & relaxed
          applyFacialExpression(primaryVrm, 0);
        }

        setPreloadProgress(100);
        setPreloadStatus('ALL ASSETS READY // STAGE PRIMED');

        setTimeout(() => {
          if (!isCancelled) {
            setIsPreloading(false);
          }
        }, 300);
      } catch (err) {
        console.warn('Preload non-fatal error:', err);
        setIsPreloading(false);
      }
    };

    runPreload();

    // -----------------------------------------------------------------------
    // RENDER / ANIMATION LOOP & SEAMLESS RE-INITIALIZATION ON LOOP
    // -----------------------------------------------------------------------
    const clock = new THREE.Clock();
    let animFrameId: number;

    const renderLoop = () => {
      animFrameId = requestAnimationFrame(renderLoop);
      const delta = Math.min(clock.getDelta(), 0.1);

      // Rotate floor rings
      if (floorGroupRef.current) {
        floorGroupRef.current.rotation.y += delta * 0.15;
      }

      // Drift sun particles upward
      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
        for (let i = 1; i < positions.length; i += 3) {
          positions[i] += delta * 0.25;
          if (positions[i] > 3.2) {
            positions[i] = 0.05;
          }
        }
        particlesRef.current.geometry.attributes.position.needsUpdate = true;
      }

      // Update active VRM and mixer
      if (activeMixerRef.current && isPlayingRef.current) {
        activeMixerRef.current.update(delta);
      }
      if (activeVrmRef.current) {
        activeVrmRef.current.update(delta);
      }

      // Advance cinematic time
      if (isPlayingRef.current) {
        currentTimeRef.current += delta;

        // SEAMLESS RE-INITIALIZATION ON LOOP
        if (currentTimeRef.current >= TOTAL_INTRO_DURATION) {
          currentTimeRef.current = 0;
          setCurrentTime(0);
          setCurrentSceneIndex(0);
          setCurrentOutfitIndex(0);
          lastSpokenSceneRef.current = 0;

          // Re-swap back to initial outfit (Mint Maid)
          const initialOutfit = SHOWCASE_OUTFITS[0];
          const initialVrm = vrmModelsMapRef.current.get(initialOutfit.fileName);
          if (initialVrm && sceneRef.current && activeVrmRef.current !== initialVrm) {
            if (activeVrmRef.current) {
              sceneRef.current.remove(activeVrmRef.current.scene);
            }
            sceneRef.current.add(initialVrm.scene);
            activeVrmRef.current = initialVrm;
          }

          // Reset mixer to first animation clip
          if (activeVrmRef.current) {
            const mixer = new THREE.AnimationMixer(activeVrmRef.current.scene);
            activeMixerRef.current = mixer;
            const firstClip = retargetedClipsMapRef.current.get('mixamo_wave.fbx');
            if (firstClip) {
              const act = mixer.clipAction(firstClip);
              act.reset();
              act.play();
              currentActionRef.current = act;
              currentAnimFileRef.current = 'mixamo_wave.fbx';
            }
          }

          // Reset expression to Smug & relaxed
          applyFacialExpression(activeVrmRef.current, 0);

          // Re-speak opening line
          speakSceneDialogue(ACT_SCENES[0].voiceLine);
        } else {
          setCurrentTime(currentTimeRef.current);
        }
      }

      // Cinematic Camera Choreography
      if (cameraRef.current) {
        const time = currentTimeRef.current;
        const currentScene =
          ACT_SCENES.find((s) => time >= s.startTime && time < s.endTime) || ACT_SCENES[0];

        const sceneProgress = Math.min(
          Math.max((time - currentScene.startTime) / (currentScene.endTime - currentScene.startTime), 0),
          1
        );

        const ease = sceneProgress * sceneProgress * (3 - 2 * sceneProgress);

        const camPos = new THREE.Vector3().lerpVectors(
          new THREE.Vector3(...currentScene.camera.fromPos),
          new THREE.Vector3(...currentScene.camera.toPos),
          ease
        );
        const camTarget = new THREE.Vector3().lerpVectors(
          new THREE.Vector3(...currentScene.camera.fromTarget),
          new THREE.Vector3(...currentScene.camera.toTarget),
          ease
        );

        // In Scene 2 (Wardrobe morph freeze frame), bullet-time orbit
        if (currentScene.id === 2 && time >= 13.0 && time <= 18.0) {
          const orbitTime = (time - 13.0) * 1.5;
          camPos.x = 1.35 * Math.sin(orbitTime);
          camPos.z = 1.35 * Math.cos(orbitTime);
          camPos.y = 1.15 + 0.15 * Math.sin(orbitTime * 2);
        }

        cameraRef.current.position.copy(camPos);
        cameraRef.current.lookAt(camTarget);

        // Update rim light color per scene
        if (rimLightRef.current) {
          rimLightRef.current.color.setHex(currentScene.lightingColor);
        }

        // -------------------------------------------------------------------
        // DIRECT EYE CONTACT & GAZE DURING ACT 02, ACT 04, ACT 06
        // -------------------------------------------------------------------
        const vrm = activeVrmRef.current;
        if (vrm) {
          const shouldLookAtViewer = currentScene.lookAtViewer;

          if (shouldLookAtViewer && cameraRef.current) {
            // Point eyes toward camera lens
            if (vrm.lookAt) {
              vrm.lookAt.lookAt(cameraRef.current.position);
            }

            // Smoothly rotate head and neck to look directly at the viewer
            const head = vrm.humanoid?.getNormalizedBoneNode('head');
            const neck = vrm.humanoid?.getNormalizedBoneNode('neck');

            if (head) {
              const headWorldPos = new THREE.Vector3();
              head.getWorldPosition(headWorldPos);
              const dir = new THREE.Vector3().subVectors(cameraRef.current.position, headWorldPos).normalize();

              const yaw = Math.atan2(dir.x, dir.z);
              const pitch = -Math.asin(THREE.MathUtils.clamp(dir.y, -0.6, 0.6));

              head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, THREE.MathUtils.clamp(yaw * 0.75, -0.75, 0.75), delta * 5.5);
              head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, THREE.MathUtils.clamp(pitch * 0.65, -0.4, 0.4), delta * 5.5);

              if (neck) {
                neck.rotation.y = THREE.MathUtils.lerp(neck.rotation.y, THREE.MathUtils.clamp(yaw * 0.35, -0.35, 0.35), delta * 4.5);
                neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, THREE.MathUtils.clamp(pitch * 0.3, -0.25, 0.25), delta * 4.5);
              }
            }
          }
        }
      }

      // Render Three.js frame
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animFrameId = requestAnimationFrame(renderLoop);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [speakSceneDialogue]);

  // -------------------------------------------------------------------------
  // SCENE TIMELINE COORDINATION & FREEZE-FRAME OUTFIT SWAP
  // -------------------------------------------------------------------------
  useEffect(() => {
    const time = currentTime;
    const scene = ACT_SCENES.find((s) => time >= s.startTime && time < s.endTime) || ACT_SCENES[0];

    // Trigger scene index changes
    if (scene.id !== currentSceneIndex) {
      setCurrentSceneIndex(scene.id);

      // Update facial expression: Happy ONLY during Act 05 (spin dance); Smug & relaxed all other times
      applyFacialExpression(activeVrmRef.current, scene.id);

      // Play corresponding animation if changed
      if (scene.animFile !== currentAnimFileRef.current && activeVrmRef.current) {
        const mixer = activeMixerRef.current;
        const clip = retargetedClipsMapRef.current.get(scene.animFile);
        if (mixer && clip) {
          const newAct = mixer.clipAction(clip);
          newAct.reset();
          newAct.setLoop(THREE.LoopRepeat, Infinity);
          newAct.play();
          if (currentActionRef.current) {
            currentActionRef.current.crossFadeTo(newAct, 0.35, true);
          }
          currentActionRef.current = newAct;
          currentAnimFileRef.current = scene.animFile;
        }
      }

      // Speak dialogue for the scene once
      if (lastSpokenSceneRef.current !== scene.id) {
        lastSpokenSceneRef.current = scene.id;
        speakSceneDialogue(scene.voiceLine);
      }

      // Sound effect on scene transition
      playSfx('slash');

      // Trigger confetti on Finale!
      if (scene.id === 5) {
        playSfx('fanfare');
        try {
          confetti({
            particleCount: 80,
            spread: 90,
            origin: { y: 0.6 },
            colors: ['#0284c7', '#f59e0b', '#e11d48', '#ffffff', '#10b981'],
          });
        } catch {}
      }
    }

    // -----------------------------------------------------------------------
    // ACT 2: WARDROBE FREEZE-FRAME & QUICK OUTFIT REPLACEMENT
    // -----------------------------------------------------------------------
    if (scene.id === 2) {
      if (time >= 13.0 && time < 18.0) {
        if (!isFreezeFrameActive) {
          setIsFreezeFrameActive(true);
          playSfx('shutter');
          setFlashTrigger(true);
          setTimeout(() => setFlashTrigger(false), 120);

          if (activeMixerRef.current) {
            activeMixerRef.current.timeScale = 0.0;
          }
        }

        const subTime = time - 13.0;
        const outfitIdx = Math.min(Math.floor(subTime / 0.8), SHOWCASE_OUTFITS.length - 1);

        if (outfitIdx !== currentOutfitIndex) {
          setCurrentOutfitIndex(outfitIdx);
          playSfx('morph');
          setFlashTrigger(true);
          setTimeout(() => setFlashTrigger(false), 100);

          const nextOutfit = SHOWCASE_OUTFITS[outfitIdx];
          const nextVrm = vrmModelsMapRef.current.get(nextOutfit.fileName);
          const sceneObj = sceneRef.current;

          if (nextVrm && sceneObj && activeVrmRef.current !== nextVrm) {
            const oldVrm = activeVrmRef.current;
            if (oldVrm) {
              sceneObj.remove(oldVrm.scene);
            }
            sceneObj.add(nextVrm.scene);
            activeVrmRef.current = nextVrm;

            // Retarget and freeze pose
            const newMixer = new THREE.AnimationMixer(nextVrm.scene);
            activeMixerRef.current = newMixer;
            const clip = retargetedClipsMapRef.current.get('mixamo_coolpoint.fbx');
            if (clip) {
              const act = newMixer.clipAction(clip);
              act.play();
              act.time = 1.45;
              newMixer.timeScale = 0.0;
              newMixer.update(0);
              currentActionRef.current = act;
            }

            // Keep smug & relaxed on transformed models
            applyFacialExpression(nextVrm, scene.id);
          }
        }
      } else {
        if (isFreezeFrameActive) {
          setIsFreezeFrameActive(false);
          if (activeMixerRef.current) {
            activeMixerRef.current.timeScale = 1.0;
          }
        }
      }
    } else {
      if (isFreezeFrameActive) {
        setIsFreezeFrameActive(false);
        if (activeMixerRef.current) {
          activeMixerRef.current.timeScale = 1.0;
        }
      }
    }
  }, [currentTime, currentSceneIndex, isFreezeFrameActive, currentOutfitIndex, playSfx, speakSceneDialogue]);

  // -------------------------------------------------------------------------
  // SPEEDLINES CANVAS EFFECT (Bright Sunlit Streaks)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = speedlinesCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const renderSpeedlines = () => {
      animId = requestAnimationFrame(renderSpeedlines);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isFreezeFrameActive || currentSceneIndex === 5) {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const lineCount = isFreezeFrameActive ? 32 : 16;

        ctx.strokeStyle = isFreezeFrameActive ? 'rgba(2, 132, 199, 0.35)' : 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = 1.5;

        for (let i = 0; i < lineCount; i++) {
          const angle = (i / lineCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
          const distInner = Math.min(canvas.width, canvas.height) * (0.35 + Math.random() * 0.1);
          const distOuter = Math.min(canvas.width, canvas.height) * (0.75 + Math.random() * 0.2);

          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * distInner, cy + Math.sin(angle) * distInner);
          ctx.lineTo(cx + Math.cos(angle) * distOuter, cy + Math.sin(angle) * distOuter);
          ctx.stroke();
        }
      }
    };

    renderSpeedlines();
    return () => cancelAnimationFrame(animId);
  }, [isFreezeFrameActive, currentSceneIndex]);

  const activeOutfitDef = SHOWCASE_OUTFITS[currentOutfitIndex] || SHOWCASE_OUTFITS[0];

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden select-none bg-gradient-to-br from-[#e0f2fe] via-[#f0f9ff] to-[#fffbeb] text-neutral-900 font-sans"
    >
      {/* Bright Sky Background */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Soft anime sky radiance */}
        <div className="absolute inset-0 bg-radial from-amber-100/35 via-sky-100/25 to-white/60" />

        {/* Clean Anime Halftone Dots Texture */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: `radial-gradient(#0284c7 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10 w-full h-full pointer-events-none"
      />

      {/* Speedlines 2D Canvas */}
      <canvas
        ref={speedlinesCanvasRef}
        width={typeof window !== 'undefined' ? window.innerWidth : 1280}
        height={typeof window !== 'undefined' ? window.innerHeight : 720}
        className="absolute inset-0 z-20 pointer-events-none w-full h-full"
      />

      {/* Comic Flash Overlay when outfit morphs */}
      <div
        className={`absolute inset-0 z-30 pointer-events-none bg-white transition-opacity duration-150 ${
          flashTrigger ? 'opacity-80' : 'opacity-0'
        }`}
      />

      {/* ------------------------------------------------------------------- */}
      {/* 2D FOREGROUND CANVAS: ONLY VIDEO-RELATED CONTENT (NO BUTTONS, NO BADGES) */}
      {/* ------------------------------------------------------------------- */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-center items-center p-6 sm:p-8">
        {/* Central Display: Persona 5 Angled Feature Cards (Pure Video Content) */}
        <div className="relative w-full max-w-4xl mx-auto flex flex-col items-center justify-center pointer-events-none">
          {/* SCENE 0: OVERTURE GREETING */}
          {currentSceneIndex === 0 && (
            <div className="flex flex-col items-center text-center space-y-3 animate-in fade-in zoom-in-95 duration-300">
              <div
                className="px-5 py-1.5 bg-[#e11d48] text-white font-black text-xs sm:text-sm tracking-widest uppercase transform -skew-x-12 shadow-xl border-l-4 border-white"
              >
                AUTONOMOUS DIGITAL COMPANION
              </div>
              <h1
                className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tighter text-neutral-900 uppercase drop-shadow-[4px_4px_0px_#ffffff]"
                style={{ WebkitTextStroke: '1px #0f172a' }}
              >
                WAKE UP, USER.
              </h1>
              <div
                className="px-6 py-2.5 bg-white/95 backdrop-blur-md border-2 border-sky-500 text-neutral-800 font-mono text-sm sm:text-base max-w-xl shadow-xl transform skew-x-6"
              >
                "Hello! I am <span className="text-sky-600 font-bold">Hana</span>. Welcome to your private, self-hosted AI sanctuary."
              </div>
            </div>
          )}

          {/* SCENE 1: NEURAL SOUL / DECENTRALIZED SLM (Gaze direct at viewer) */}
          {currentSceneIndex === 1 && (
            <div className="w-full flex flex-col md:flex-row items-center justify-between gap-6 animate-in fade-in slide-in-from-bottom-6 duration-300">
              <div className="flex flex-col space-y-2 max-w-md">
                <div className="inline-block px-3 py-1 bg-sky-500 text-white font-black text-xs uppercase tracking-wider transform -skew-x-12 shadow-md">
                  HARDWARE ACCELERATED // NO BIG TECH API
                </div>
                <h2 className="text-3xl sm:text-5xl font-black text-neutral-900 uppercase drop-shadow-[3px_3px_0px_#ffffff]">
                  DECENTRALIZED BRAIN
                </h2>
                <p className="text-neutral-800 text-sm font-medium leading-relaxed bg-white/95 p-3.5 border-l-4 border-sky-500 shadow-lg">
                  Runs directly on client silicon via <span className="text-sky-600 font-bold">WebGPU</span> and <span className="text-sky-600 font-bold">WASM</span>, or connect directly to local <span className="text-sky-600 font-bold">Ollama</span> servers over zero-latency tunnels.
                </p>
              </div>

              {/* Persona 5 Feature Badges */}
              <div className="flex flex-col gap-2.5">
                {[
                  { title: 'LOCAL SLMs (LLAMA 3.1 & SMOL)', icon: Zap, color: '#0284c7' },
                  { title: 'WEBGPU TRANSFORMERS IN-BROWSER', icon: Shield, color: '#0ea5e9' },
                  { title: 'PERSISTENT NEONDB STORAGE', icon: Layers, color: '#d97706' },
                  { title: 'STRICT ZERO-DATA-LEAK ARCHITECTURE', icon: CheckCircle2, color: '#059669' },
                ].map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 px-4 py-2 bg-white/95 border border-neutral-300 text-neutral-900 font-mono text-xs font-bold uppercase transform -skew-x-12 shadow-lg"
                      style={{ borderLeftColor: item.color, borderLeftWidth: 4 }}
                    >
                      <Icon className="w-4 h-4" style={{ color: item.color }} />
                      <span>{item.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SCENE 2: WARDROBE MORPH / FREEZE FRAME OUTFIT SHOWCASE */}
          {currentSceneIndex === 2 && (
            <div className="flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="px-4 py-1 bg-amber-500 text-white font-black text-xs uppercase tracking-widest transform -skew-x-12 shadow-md">
                PLENTY OF WARDROBE OUTFITS
              </div>

              <div
                className="px-6 py-3.5 bg-white/95 border-2 border-neutral-900 text-neutral-900 font-black text-2xl sm:text-4xl uppercase transform rotate-[-2deg] -skew-x-12 shadow-2xl"
                style={{
                  boxShadow: `0 0 30px ${activeOutfitDef.color}40`,
                  borderColor: activeOutfitDef.color,
                }}
              >
                <span style={{ color: activeOutfitDef.color }}>{activeOutfitDef.name}</span>
                <span className="block text-xs font-mono tracking-widest text-neutral-500 mt-0.5">
                  {activeOutfitDef.theme} /// {activeOutfitDef.badge}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl">
                {SHOWCASE_OUTFITS.map((outfit, idx) => (
                  <div
                    key={outfit.id}
                    className={`px-3 py-1 font-mono text-xs uppercase font-bold transition-all duration-150 transform -skew-x-6 border shadow-sm ${
                      idx === currentOutfitIndex
                        ? 'bg-neutral-900 text-white border-neutral-900 scale-110 shadow-md'
                        : 'bg-white/90 text-neutral-600 border-neutral-300'
                    }`}
                  >
                    {outfit.name.split(' ')[0]}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCENE 3: ACADEMIC & CAREER SUITE (Gaze direct at viewer) */}
          {currentSceneIndex === 3 && (
            <div className="w-full flex flex-col md:flex-row items-center justify-between gap-6 animate-in fade-in slide-in-from-right-6 duration-300">
              <div className="flex flex-col space-y-2 max-w-md">
                <div className="inline-block px-3 py-1 bg-sky-600 text-white font-black text-xs uppercase tracking-wider transform -skew-x-12 shadow-md">
                  CAREER & ACADEMIC PRODUCTIVITY
                </div>
                <h2 className="text-3xl sm:text-5xl font-black text-neutral-900 uppercase drop-shadow-[3px_3px_0px_#ffffff]">
                  VIRTUAL INTERACTIONS
                </h2>
                <p className="text-neutral-800 text-sm font-medium leading-relaxed bg-white/95 p-3.5 border-l-4 border-sky-600 shadow-lg">
                  Conduct realistic mock technical video screenings with visual credential verification, or convert AI text to human grade prose.
                </p>
              </div>

              {/* Productivity Action Cards */}
              <div className="flex flex-col gap-2.5">
                {[
                  {
                    title: 'AUTONOMOUS AI INTERVIEWER',
                    desc: 'Live video interview room, resume CV parsing, situational pressure tests & Q&A evaluation',
                    icon: Video,
                    color: '#0284c7',
                  },
                  {
                    title: 'TURNITIN-REVERSE AI HUMANIZER',
                    desc: 'Sentence flow rewriting, 0% AI detection bypass, natural human cadence synthesis',
                    icon: FileCheck,
                    color: '#059669',
                  },
                  {
                    title: 'EXPRESSION & EMOTION DETECTION',
                    desc: 'Real-time emotion detection morphs facial expressions across happiness, sadness, and curiosity',
                    icon: Sparkles,
                    color: '#d97706',
                  },
                ].map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={idx}
                      className="p-3 bg-white/95 border-l-4 border-t border-r border-b border-neutral-300 text-left transform -skew-x-6 shadow-lg"
                      style={{ borderLeftColor: item.color }}
                    >
                      <div className="text-neutral-900 font-black text-xs uppercase font-mono tracking-wide flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                        <span>{item.title}</span>
                      </div>
                      <div className="text-neutral-600 text-xs mt-0.5">{item.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SCENE 4: OMNICHANNEL MATRIX (Happy smile during spin dance) */}
          {currentSceneIndex === 4 && (
            <div className="w-full flex flex-col md:flex-row items-center justify-between gap-6 animate-in fade-in slide-in-from-left-6 duration-300">
              <div className="flex flex-col space-y-2 max-w-md">
                <div className="inline-block px-3 py-1 bg-amber-500 text-white font-black text-xs uppercase tracking-wider transform -skew-x-12 shadow-md">
                  VOICE & WORKFLOW INTEGRATION
                </div>
                <h2 className="text-3xl sm:text-5xl font-black text-neutral-900 uppercase drop-shadow-[3px_3px_0px_#ffffff]">
                  MULTI CHANNELS
                </h2>
                <p className="text-neutral-800 text-sm font-medium leading-relaxed bg-white/95 p-3.5 border-l-4 border-amber-500 shadow-lg">
                  Stream real-time voice with synchronized <span className="text-amber-600 font-bold">viseme mouth shapes</span>. Connect Hana directly into Discord voice channels, Twitch live streams, and automated n8n workflows.
                </p>
              </div>

              {/* Omnichannel grid */}
              <div className="grid grid-cols-2 gap-2.5 max-w-xs sm:max-w-sm">
                {[
                  { name: 'DISCORD BOT & VC', badge: 'Active Voice', icon: Radio },
                  { name: 'TWITCH LIVE CHAT', badge: 'Interactive', icon: MessageSquare },
                  { name: 'N8N AUTOMATION', badge: 'Two-Way Sync', icon: Layers },
                  { name: 'ZAPIER CONNECTOR', badge: 'App Webhooks', icon: Zap },
                ].map((gate, idx) => {
                  const GIcon = gate.icon;
                  return (
                    <div
                      key={idx}
                      className="p-3 bg-white/95 border border-neutral-300 transform -skew-x-6 shadow-md flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <GIcon className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-[10px] font-mono text-neutral-500">{gate.badge}</span>
                      </div>
                      <span className="text-neutral-900 font-bold text-xs font-mono">{gate.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SCENE 5: SHOWTIME // ALL-OUT FINALE (Gaze direct at viewer) */}
          {currentSceneIndex === 5 && (
            <div className="flex flex-col items-center text-center space-y-5 animate-in fade-in zoom-in-90 duration-300 pointer-events-none">
              <div className="px-5 py-1.5 bg-[#e11d48] text-white font-black text-sm tracking-widest uppercase transform -skew-x-12 border-2 border-white shadow-xl">
                MuxAI
              </div>

              <h1
                className="text-5xl sm:text-7xl md:text-8xl font-black uppercase text-neutral-900 tracking-tighter drop-shadow-[5px_5px_0px_#ffffff]"
                style={{ WebkitTextStroke: '2px #0f172a' }}
              >
                HANA
              </h1>

              <p className="text-neutral-800 font-mono text-xs sm:text-sm max-w-lg bg-white/95 p-3.5 border-t-2 border-b-2 border-neutral-900 shadow-xl">
                Decentralized. Private. Expressive. Welcome to our world.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* PRE-LOAD SCREEN OVERLAY */}
      {/* ------------------------------------------------------------------- */}
      {isPreloading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 backdrop-blur-md text-neutral-900 p-6 pointer-events-none">
          <div className="relative flex flex-col items-center max-w-md w-full space-y-6 text-center">
            {/* Spinning Sun Logo */}
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-amber-400 rotate-45 animate-spin" style={{ animationDuration: '4s' }} />
              <div className="absolute inset-2 border-2 border-sky-400 -rotate-12 animate-pulse" />
              <Sun className="w-8 h-8 text-amber-500" />
            </div>

            <div className="space-y-1">
              <div className="text-[#e11d48] font-black text-xs uppercase tracking-widest">
                /// ASSET PRELOAD PROTOCOL ///
              </div>
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-neutral-900">
                CACHING VRM SKINS & SKELETONS
              </h2>
            </div>

            {/* Loading Progress Bar */}
            <div className="w-full space-y-2">
              <div className="w-full h-2.5 bg-neutral-200 border border-neutral-300 rounded-sm overflow-hidden p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 via-amber-400 to-[#e11d48] transition-all duration-200"
                  style={{ width: `${preloadProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs font-mono text-neutral-600">
                <span className="truncate max-w-[280px]">{preloadStatus}</span>
                <span className="font-bold text-neutral-900">{preloadProgress}%</span>
              </div>
            </div>

            <p className="text-neutral-500 font-mono text-[11px] leading-relaxed max-w-xs">
              Pre-parsing 3D outfits and retargeting Mixamo animations into memory for instant keyframe morphing.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* START SHOWTIME SPLASH OVERLAY (Restored Start Button) */}
      {/* ------------------------------------------------------------------- */}
      {!isPreloading && !isStarted && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/90 backdrop-blur-md p-6">
          <div className="flex flex-col items-center max-w-lg w-full text-center space-y-6">
            <div className="px-4 py-1.5 bg-[#e11d48] text-white font-black text-xs uppercase tracking-widest transform -skew-x-12 border-l-4 border-white shadow-xl">
              CINEMATIC SHOWCASE
            </div>

            <h1
              className="text-4xl sm:text-6xl font-black uppercase text-neutral-900 tracking-tighter drop-shadow-[3px_3px_0px_#ffffff]"
              style={{ WebkitTextStroke: '1px #0f172a' }}
            >
              HANA SHOWTIME
            </h1>

            <p className="text-neutral-700 font-mono text-xs sm:text-sm leading-relaxed max-w-md bg-white/95 p-4 border border-neutral-300 shadow-md">
              Experience the cinematic anime opening showcase featuring dynamic camera choreography, freeze-frame outfit morphing, neural SLMs, and productivity tools.
            </p>

            <button
              type="button"
              onClick={handleStartShowtime}
              className="px-8 py-3.5 bg-[#e11d48] hover:bg-[#f43f5e] text-white font-black text-base uppercase tracking-wider shadow-2xl transform -skew-x-12 hover:scale-105 transition-all border-2 border-white flex items-center gap-3 cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>START SHOWTIME</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
