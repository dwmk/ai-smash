import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';
import {
  ArrowLeft,
  Volume2,
  VolumeX,
  Heart,
  Skull,
  Sparkles,
  RefreshCw,
  Trophy,
  Zap,
  Info,
  X,
  ArrowUp,
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  Activity,
  Award,
} from 'lucide-react';
import {
  MODEL_SOURCE_DOMAIN,
  MODEL_FALLBACK_DOMAIN,
  VOICE_CONFIG,
} from '../constants';
import { waitForPersonaVoice } from '../lib/audio';

export interface TorGameMode2Props {
  onBackToChat: () => void;
  onSwitchMode?: () => void;
}

export type TorPainTakerModeProps = TorGameMode2Props;

type Direction = 'up' | 'down' | 'left' | 'right';

interface RhythmBeat {
  id: number;
  timeMs: number;
  direction: Direction;
  hitState: 'perfect' | 'good' | 'miss' | null;
}

type ExerciseType = 'pushup' | 'situp' | 'kettlebell' | 'jumpingjacks';

interface ExerciseDef {
  type: ExerciseType;
  title: string;
  animationFile: string;
  command: string;
  description: string;
  reps: number;
}

const EXERCISES: ExerciseDef[] = [
  {
    type: 'pushup',
    title: 'Pushups',
    animationFile: 'mixamo_pushup.fbx',
    command: 'Drop down and give me pushups! Keep your back straight and do not stop!',
    description: 'Upper body endurance punishment',
    reps: 8,
  },
  {
    type: 'situp',
    title: 'Situps',
    animationFile: 'mixamo_situps.fbx',
    command: 'Down on the floor! Situps, right now! Tighten your core and stay on tempo!',
    description: 'Core compression trial',
    reps: 8,
  },
  {
    type: 'kettlebell',
    title: 'Kettlebell Swings',
    animationFile: 'mixamo_kettlebellswing.fbx',
    command: 'Grab that kettlebell! Swing with full power, do not lose your rhythm!',
    description: 'Explosive hip hinge endurance',
    reps: 8,
  },
  {
    type: 'jumpingjacks',
    title: 'Jumping Jacks',
    animationFile: 'mixamo_jumpingjacks.fbx',
    command: 'Jumping jacks! Faster! Show me you can endure the pain without whining!',
    description: 'Full-body cardiovascular strain',
    reps: 8,
  },
];

const NPC_ATTACKS = [
  'mixamo_boxing_groinkick.fbx',
  'mixamo_meleepunch.fbx',
  'mixamo_headbutt.fbx',
  'mixamo_highkick.fbx',
] as const;

const DYING_FRONT_ANIMATIONS = [
  'mixamo_dying.fbx',
  'mixamo_dying_flyback.fbx',
  'mixamo_dying_strangled.fbx',
] as const;

// Helper to localize animation clips and preserve hips height
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

// Caches
const vrmCache = new Map<string, ArrayBuffer>();
const fbxCache = new Map<string, ArrayBuffer>();

async function fetchAssetBuffer(type: 'vrm' | 'fbx', fileName: string): Promise<ArrayBuffer | null> {
  const cache = type === 'vrm' ? vrmCache : fbxCache;
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

  if (type === 'fbx' && fileName === 'mixamo_jumpingjacks.fbx') {
    candidateUrls.unshift(`/api/animation/wait?file=${encodeURIComponent('mixamo_.jumpingjacks.fbx')}`);
    candidateUrls.unshift(`${MODEL_SOURCE_DOMAIN}/mixamo_.jumpingjacks.fbx`);
  }

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

const fbxLoader = new FBXLoader();

async function loadRetargetedClip(fileName: string, vrm: VRM): Promise<THREE.AnimationClip | null> {
  const buf = await fetchAssetBuffer('fbx', fileName);
  if (!buf) return null;
  try {
    const fbxGroup = fbxLoader.parse(buf, '');
    const rawClip = retargetAnimation(fbxGroup, vrm);
    if (rawClip) {
      return localizeAnimationClip(rawClip, vrm);
    }
  } catch (err) {
    console.warn(`Failed to parse FBX ${fileName}:`, err);
  }
  return null;
}

export const TorGameMode2: React.FC<TorGameMode2Props> = ({
  onBackToChat,
  onSwitchMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js instances
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Entities
  const playerRootRef = useRef<THREE.Group>(new THREE.Group());
  const npcRootRef = useRef<THREE.Group>(new THREE.Group());
  const doorPivotLeftRef = useRef<THREE.Group | null>(null);
  const doorPivotRightRef = useRef<THREE.Group | null>(null);

  const playerVrmRef = useRef<VRM | null>(null);
  const npcVrmRef = useRef<VRM | null>(null);

  const playerMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const npcMixerRef = useRef<THREE.AnimationMixer | null>(null);

  const playerActionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const npcActionsRef = useRef<Record<string, THREE.AnimationAction>>({});

  // Dynamic ragdoll impulse state on player bone nodes
  const ragdollImpulseRef = useRef<{
    boneKey: string;
    intensity: number;
    phase: number;
  } | null>(null);

  // Camera Orbit Controls (Mouse Drag) - 3/4 angle showing both characters facing each other
  const cameraYawRef = useRef<number>(0.55);
  const cameraPitchRef = useRef<number>(0.18);
  const cameraDistanceRef = useRef<number>(3.3);
  const isDraggingRef = useRef<boolean>(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Game & Survival State
  const [gameState, setGameState] = useState<'loading' | 'cinematic' | 'training' | 'punishment' | 'gameover'>('loading');
  const gameStateRef = useRef<'loading' | 'cinematic' | 'training' | 'punishment' | 'gameover'>('loading');
  const isMountedRef = useRef<boolean>(true);

  const [loadingText, setLoadingText] = useState<string>('Summoning private torture chamber...');
  const [countdownText, setCountdownText] = useState<string>('');
  const [loadingPercent, setLoadingPercent] = useState<number>(15);

  const [lives, setLives] = useState<number>(3); // 3 -> 2 -> 1 (last chance with base model) -> 0 (game over)
  const livesRef = useRef<number>(3);

  const [round, setRound] = useState<number>(1);
  const roundRef = useRef<number>(1);

  const [survivalTimeSec, setSurvivalTimeSec] = useState<number>(0);
  const survivalTimerRef = useRef<number>(0);
  const lastSurvivalSecRef = useRef<number>(0);

  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [perfectHits, setPerfectHits] = useState<number>(0);

  // Current Exercise & Rhythm Beat Track
  const [currentExercise, setCurrentExercise] = useState<ExerciseDef>(EXERCISES[0]);
  const [beats, setBeats] = useState<RhythmBeat[]>([]);
  const beatsRef = useRef<RhythmBeat[]>([]);
  useEffect(() => {
    beatsRef.current = beats;
  }, [beats]);

  const beatElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const exerciseStartTimeRef = useRef<number>(0);
  const currentBpmRef = useRef<number>(85);

  // Dialogue & Subtitles
  const [subtitles, setSubtitles] = useState<string>('');
  const [speakerName, setSpeakerName] = useState<string>('Hana (Dominant)');
  const [hitFeedback, setHitFeedback] = useState<{ text: string; color: string; id: number } | null>(null);

  // Audio / Sound toggle
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const soundEnabledRef = useRef<boolean>(true);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  // Cinematic & Timers Management
  const cinematicActiveRef = useRef<boolean>(false);
  const doorRafRef = useRef<number | null>(null);
  const npcWalkRafRef = useRef<number | null>(null);
  const cinematicTimerRef = useRef<number | null>(null);
  const activeTimeoutsRef = useRef<number[]>([]);

  const executePunishmentRef = useRef<(() => void) | null>(null);
  const playCinematicIntroRef = useRef<(() => void) | null>(null);

  const clearCinematicTimers = useCallback(() => {
    if (doorRafRef.current) {
      cancelAnimationFrame(doorRafRef.current);
      doorRafRef.current = null;
    }
    if (npcWalkRafRef.current) {
      cancelAnimationFrame(npcWalkRafRef.current);
      npcWalkRafRef.current = null;
    }
    if (cinematicTimerRef.current) {
      clearTimeout(cinematicTimerRef.current);
      cinematicTimerRef.current = null;
    }
  }, []);

  const clearAllTimeouts = useCallback(() => {
    activeTimeoutsRef.current.forEach((id) => clearTimeout(id));
    activeTimeoutsRef.current = [];
  }, []);

  const safeTimeout = useCallback((fn: () => void, delayMs: number) => {
    const id = window.setTimeout(() => {
      activeTimeoutsRef.current = activeTimeoutsRef.current.filter((t) => t !== id);
      fn();
    }, delayMs);
    activeTimeoutsRef.current.push(id);
    return id;
  }, []);

  const updateGameState = useCallback((nextState: 'loading' | 'cinematic' | 'training' | 'punishment' | 'gameover') => {
    gameStateRef.current = nextState;
    setGameState(nextState);
  }, []);

  // Component lifecycle mount/unmount safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearAllTimeouts();
      clearCinematicTimers();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearAllTimeouts, clearCinematicTimers]);

  // Audio Context for Haptics & Rhythm Cues
  const audioCtxRef = useRef<AudioContext | null>(null);
  const initAudioCtx = useCallback(() => {
    if (!audioCtxRef.current && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const playSynthSound = useCallback((type: 'beat' | 'perfect' | 'good' | 'miss' | 'impact' | 'door') => {
    if (!soundEnabledRef.current) return;
    initAudioCtx();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'beat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'perfect') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880.0, now + 0.06); // A5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'good') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === 'miss') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.22);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'impact') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.35);
        gain.gain.setValueAtTime(0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'door') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.linearRampToValueAtTime(130, now + 0.8);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.85);
      }
    } catch {}
  }, [initAudioCtx]);

  // Voice synthesis speaker
  const speakDialogue = useCallback(async (text: string, title?: string) => {
    setSubtitles(text);
    if (title) setSpeakerName(title);
    if (!soundEnabledRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const voice = await waitForPersonaVoice(1000);
      const utter = new SpeechSynthesisUtterance(text);
      if (voice) utter.voice = voice;
      utter.pitch = VOICE_CONFIG.pitch || 1.25;
      utter.rate = VOICE_CONFIG.rate || 1.05;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {}
  }, []);

  // Helper to load / swap player VRM
  const loadPlayerVRM = useCallback(async (vrmFileName: string): Promise<VRM | null> => {
    const scene = sceneRef.current;
    if (!scene) return null;

    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    const buf = await fetchAssetBuffer('vrm', vrmFileName);
    if (!buf) return null;

    return new Promise((resolve) => {
      gltfLoader.parse(
        buf,
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

            // Ground alignment
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

            // Resting arms
            if (vrm.humanoid) {
              const lUpArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
              const rUpArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
              if (lUpArm) lUpArm.rotation.set(0.1, 0.05, -1.25);
              if (rUpArm) rUpArm.rotation.set(0.1, -0.05, 1.25);
            }

            // Clean previous player vrm children if any
            while (playerRootRef.current.children.length > 0) {
              playerRootRef.current.remove(playerRootRef.current.children[0]);
            }

            playerRootRef.current.add(vrm.scene);
            playerVrmRef.current = vrm;

            const mixer = new THREE.AnimationMixer(vrm.scene);
            playerMixerRef.current = mixer;
            playerActionsRef.current = {};

            resolve(vrm);
          } else {
            resolve(null);
          }
        },
        () => resolve(null)
      );
    });
  }, []);

  // Helper to load NPC VRM
  const loadNpcVRM = useCallback(async (vrmFileName: string): Promise<VRM | null> => {
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    const buf = await fetchAssetBuffer('vrm', vrmFileName);
    if (!buf) return null;

    return new Promise((resolve) => {
      gltfLoader.parse(
        buf,
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

            // Confident posture for Dominant NPC
            if (vrm.humanoid) {
              const lUpArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
              const rUpArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
              if (lUpArm) lUpArm.rotation.set(0.12, 0.05, -1.2);
              if (rUpArm) rUpArm.rotation.set(0.12, -0.05, 1.2);
            }

            // Smug confident expression
            if (vrm.expressionManager) {
              vrm.expressionManager.setValue('happy', 0.6);
              vrm.expressionManager.setValue('relaxed', 0.4);
              vrm.expressionManager.update();
            }

            while (npcRootRef.current.children.length > 0) {
              npcRootRef.current.remove(npcRootRef.current.children[0]);
            }

            npcRootRef.current.add(vrm.scene);
            npcVrmRef.current = vrm;

            const mixer = new THREE.AnimationMixer(vrm.scene);
            npcMixerRef.current = mixer;
            npcActionsRef.current = {};

            resolve(vrm);
          } else {
            resolve(null);
          }
        },
        () => resolve(null)
      );
    });
  }, []);

  // Helper to play an action smoothly on player
  const playPlayerAnim = useCallback(async (animFile: string, loop: boolean = true) => {
    const vrm = playerVrmRef.current;
    const mixer = playerMixerRef.current;
    if (!vrm || !mixer) return null;

    let act = playerActionsRef.current[animFile];
    if (!act) {
      const clip = await loadRetargetedClip(animFile, vrm);
      if (!clip) return null;
      act = mixer.clipAction(clip);
      playerActionsRef.current[animFile] = act;
    }

    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    act.clampWhenFinished = !loop;

    for (const key in playerActionsRef.current) {
      const other = playerActionsRef.current[key];
      if (other && other !== act && other.isRunning()) {
        other.fadeOut(0.2);
      }
    }

    act.fadeIn(0.2).play();
    return act;
  }, []);

  // Helper to play an action smoothly on NPC
  const playNpcAnim = useCallback(async (animFile: string, loop: boolean = true) => {
    const vrm = npcVrmRef.current;
    const mixer = npcMixerRef.current;
    if (!vrm || !mixer) return null;

    let act = npcActionsRef.current[animFile];
    if (!act) {
      const clip = await loadRetargetedClip(animFile, vrm);
      if (!clip) return null;
      act = mixer.clipAction(clip);
      npcActionsRef.current[animFile] = act;
    }

    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    act.clampWhenFinished = !loop;

    for (const key in npcActionsRef.current) {
      const other = npcActionsRef.current[key];
      if (other && other !== act && other.isRunning()) {
        other.fadeOut(0.2);
      }
    }

    act.fadeIn(0.2).play();
    return act;
  }, []);

  // Trigger Dynamic Ragdoll Bone Impact
  const triggerRagdollImpact = useCallback((boneKey: string, force: number = 0.8) => {
    ragdollImpulseRef.current = {
      boneKey,
      intensity: force,
      phase: 0,
    };
    playSynthSound('impact');

    cameraPitchRef.current += (Math.random() - 0.5) * 0.08;
    cameraYawRef.current += (Math.random() - 0.5) * 0.08;
  }, [playSynthSound]);

  // ----------------------------------------------------
  // Start A Training Round with New Exercise & Beat Map
  // ----------------------------------------------------
  const startTrainingRound = useCallback(async (overrideExercise?: ExerciseDef) => {
    cinematicActiveRef.current = false;
    clearCinematicTimers();

    const curRound = roundRef.current;
    const exercise = overrideExercise || EXERCISES[(curRound - 1) % EXERCISES.length];
    setCurrentExercise(exercise);
    updateGameState('training');

    // Ensure doors open and NPC positioned correctly
    if (doorPivotLeftRef.current) doorPivotLeftRef.current.rotation.y = -Math.PI * 0.45;
    if (doorPivotRightRef.current) doorPivotRightRef.current.rotation.y = Math.PI * 0.45;
    npcRootRef.current.position.set(0, 0, -1.35);
    npcRootRef.current.rotation.y = 0;

    const bpm = Math.min(48 + (curRound - 1) * 3, 72);
    currentBpmRef.current = bpm;
    const beatIntervalMs = (60 / bpm) * 1000;

    await speakDialogue(`"${exercise.command}"`, 'Hana (Dominant)');

    playerRootRef.current.rotation.y = Math.PI;
    await playPlayerAnim(exercise.animationFile, true);
    await playNpcAnim('mixamo_idle.fbx', true);

    const directions: Direction[] = ['up', 'down', 'left', 'right'];
    const totalBeats = Math.min(6 + curRound * 2, 14);
    const newBeats: RhythmBeat[] = [];

    const leadInMs = 3800;
    for (let i = 0; i < totalBeats; i++) {
      const dir = directions[Math.floor(Math.random() * directions.length)];
      newBeats.push({
        id: Date.now() + i,
        timeMs: leadInMs + i * beatIntervalMs,
        direction: dir,
        hitState: null,
      });
    }

    setBeats(newBeats);
    beatsRef.current = newBeats;
    exerciseStartTimeRef.current = performance.now();

    // Visual countdown sequence
    setCountdownText('GET READY: 3');
    safeTimeout(() => setCountdownText('2'), 1100);
    safeTimeout(() => setCountdownText('1'), 2200);
    safeTimeout(() => setCountdownText('GO!'), 3300);
    safeTimeout(() => setCountdownText(''), 4300);
  }, [clearCinematicTimers, playNpcAnim, playPlayerAnim, safeTimeout, speakDialogue, updateGameState]);

  // ----------------------------------------------------
  // Execution of Punishment on Miss / Failure
  // ----------------------------------------------------
  const executePunishment = useCallback(async () => {
    if (gameStateRef.current !== 'training') return;
    updateGameState('punishment');
    playSynthSound('miss');

    const curLives = livesRef.current;
    if (curLives <= 0) return;
    const nextLives = Math.max(0, curLives - 1);
    livesRef.current = nextLives;
    setLives(nextLives);
    setCombo(0);

    // Randomly pick combat attack from NPC
    const isGroinKick = Math.random() < 0.45;
    const chosenAttack = isGroinKick
      ? 'mixamo_boxing_groinkick.fbx'
      : NPC_ATTACKS[Math.floor(Math.random() * NPC_ATTACKS.length)];

    const punishmentTaunts = [
      "Pathetic! You missed the rhythm already?!",
      "Is that all you can endure? Take this!",
      "Slacking off during my training? Not on my watch!",
      "Too slow! You need to be punished!",
    ];
    speakDialogue(punishmentTaunts[Math.floor(Math.random() * punishmentTaunts.length)], 'Hana (Dominant)');

    // 1. NPC plays attack
    playNpcAnim(chosenAttack, false);

    // 2. Special timing rule for groin kick vs normal attack
    if (chosenAttack === 'mixamo_boxing_groinkick.fbx') {
      safeTimeout(() => {
        if (!isMountedRef.current) return;
        playPlayerAnim('mixamo_groin_hurt.fbx', false);
        triggerRagdollImpact('hips', 1.0);
      }, 1500);
    } else {
      safeTimeout(() => {
        if (!isMountedRef.current) return;
        triggerRagdollImpact('chest', 0.85);
        playPlayerAnim('mixamo_idle_injured.fbx', false);
      }, 700);
    }

    // Check lives remaining
    if (nextLives === 2) {
      // 1st strike: player gets 2 more chances.
      safeTimeout(async () => {
        if (!isMountedRef.current) return;
        await playPlayerAnim('mixamo_idle_injured.fbx', true);
        await playNpcAnim('mixamo_idle.fbx', true);
        speakDialogue("Get back up! We are not finished yet!", 'Hana (Dominant)');
        safeTimeout(() => {
          if (!isMountedRef.current) return;
          startTrainingRound();
        }, 2200);
      }, 3400);
    } else if (nextLives === 1) {
      // 2nd strike: Last chance! Stripped to base form
      safeTimeout(async () => {
        if (!isMountedRef.current) return;
        setLoadingText('Stripping to Base Natural Form...');
        await loadPlayerVRM('hana_v1.5_base_vrm1.vrm');
        await playPlayerAnim('mixamo_idle_injured.fbx', true);
        await playNpcAnim('mixamo_idle.fbx', true);
        speakDialogue("Down to your bare natural form, are you? One more mistake and you are finished!", 'Hana (Dominant)');
        safeTimeout(() => {
          if (!isMountedRef.current) return;
          startTrainingRound();
        }, 2600);
      }, 3400);
    } else {
      // 3rd strike: GAME OVER / FATAL BLOW!
      const isAlternateExecution = Math.random() < 0.5;

      if (!isAlternateExecution) {
        const dyingAnim = DYING_FRONT_ANIMATIONS[Math.floor(Math.random() * DYING_FRONT_ANIMATIONS.length)];
        safeTimeout(async () => {
          if (!isMountedRef.current) return;
          triggerRagdollImpact('spine', 1.2);
          await playPlayerAnim(dyingAnim, false);
          speakDialogue("And down you go. You have reached your absolute limit...", 'Hana (Dominant)');
          safeTimeout(() => {
            if (!isMountedRef.current) return;
            updateGameState('gameover');
          }, 3500);
        }, chosenAttack === 'mixamo_boxing_groinkick.fbx' ? 1600 : 800);
      } else {
        safeTimeout(async () => {
          if (!isMountedRef.current) return;
          speakDialogue("Turn around... I have a special final sendoff for you.", 'Hana (Dominant)');
          await playNpcAnim('mixamo_walk.fbx', true);

          const startTime = performance.now();
          const walkDuration = 1800;
          const startPos = npcRootRef.current.position.clone();
          const targetPos = new THREE.Vector3(0, 0, 1.3);

          const stepWalk = () => {
            if (!isMountedRef.current) return;
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1, elapsed / walkDuration);
            npcRootRef.current.position.lerpVectors(startPos, targetPos, progress);
            npcRootRef.current.rotation.y = Math.PI;

            if (progress < 1) {
              requestAnimationFrame(stepWalk);
            } else {
              playNpcAnim('mixamo_highkick.fbx', false);
              safeTimeout(() => {
                if (!isMountedRef.current) return;
                triggerRagdollImpact('spine', 1.3);
                playPlayerAnim('mixamo_dying_slideforward.fbx', false);
                speakDialogue("Execution complete. Game over.", 'Hana (Dominant)');
                safeTimeout(() => {
                  if (!isMountedRef.current) return;
                  updateGameState('gameover');
                }, 4000);
              }, 750);
            }
          };
          stepWalk();
        }, 1800);
      }
    }
  }, [loadPlayerVRM, playNpcAnim, playPlayerAnim, playSynthSound, safeTimeout, speakDialogue, startTrainingRound, triggerRagdollImpact, updateGameState]);

  useEffect(() => {
    executePunishmentRef.current = executePunishment;
  }, [executePunishment]);

  // ----------------------------------------------------
  // Rhythm Input Timing Evaluation
  // ----------------------------------------------------
  const handleRhythmInput = useCallback((dir: Direction) => {
    if (gameStateRef.current !== 'training') return;
    const now = performance.now();
    const elapsedMs = now - exerciseStartTimeRef.current;

    const activeBeats = beatsRef.current;
    let closestIndex = -1;
    let minDiff = Infinity;

    for (let i = 0; i < activeBeats.length; i++) {
      const beat = activeBeats[i];
      if (beat.hitState === null) {
        const diff = Math.abs(elapsedMs - beat.timeMs);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }
    }

    if (closestIndex === -1 || minDiff > 650) {
      setHitFeedback({ text: 'WAIT FOR THE LINE...', color: '#f59e0b', id: Date.now() });
      return;
    }

    const targetBeat = activeBeats[closestIndex];

    if (targetBeat.direction !== dir) {
      targetBeat.hitState = 'miss';
      setBeats([...activeBeats]);
      setHitFeedback({ text: 'WRONG ARROW!', color: '#ef4444', id: Date.now() });
      executePunishment();
      return;
    }

    if (minDiff <= 250) {
      targetBeat.hitState = 'perfect';
      playSynthSound('perfect');
      setPerfectHits((p) => p + 1);
      setCombo((c) => {
        const next = c + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      setHitFeedback({ text: 'PERFECT! +100', color: '#10b981', id: Date.now() });
    } else if (minDiff <= 500) {
      targetBeat.hitState = 'good';
      playSynthSound('good');
      setCombo((c) => {
        const next = c + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      setHitFeedback({ text: 'GOOD! +50', color: '#55d2f6', id: Date.now() });
    } else {
      targetBeat.hitState = 'miss';
      setHitFeedback({ text: 'MISSED TIMING!', color: '#ef4444', id: Date.now() });
      executePunishment();
      return;
    }

    setBeats([...activeBeats]);

    const unhitRemaining = activeBeats.filter((b) => b.hitState === null).length;
    if (unhitRemaining === 0) {
      const nextRound = roundRef.current + 1;
      roundRef.current = nextRound;
      setRound(nextRound);

      const praiseLines = [
        "Hmph. Not bad at all... You actually completed the set!",
        "Impressive endurance. But the next round will be much harder!",
        "Keep breathing! You survived this round!",
        "Good. But do not think I will go easy on you!",
      ];
      speakDialogue(praiseLines[Math.floor(Math.random() * praiseLines.length)], 'Hana (Dominant)');

      safeTimeout(() => {
        if (!isMountedRef.current) return;
        startTrainingRound();
      }, 2000);
    }
  }, [executePunishment, playSynthSound, safeTimeout, speakDialogue, startTrainingRound]);

  // Keyboard Listeners for Rhythm Directions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'training') return;

      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        handleRhythmInput('up');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        handleRhythmInput('down');
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        handleRhythmInput('left');
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        handleRhythmInput('right');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRhythmInput]);

  // ----------------------------------------------------
  // Cinematic Sequence: Door Opens -> NPC Arrives -> Taunts
  // ----------------------------------------------------
  const playCinematicIntro = useCallback(async () => {
    cinematicActiveRef.current = true;
    updateGameState('cinematic');
    playSynthSound('door');

    // 1. Swing open the heavy wooden double-doors
    const startTime = performance.now();
    const doorDuration = 1400;

    const animateDoors = () => {
      if (!cinematicActiveRef.current) return;
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / doorDuration);
      const angle = progress * (Math.PI * 0.45);

      if (doorPivotLeftRef.current) {
        doorPivotLeftRef.current.rotation.y = -angle;
      }
      if (doorPivotRightRef.current) {
        doorPivotRightRef.current.rotation.y = angle;
      }

      if (progress < 1) {
        doorRafRef.current = requestAnimationFrame(animateDoors);
      }
    };
    doorRafRef.current = requestAnimationFrame(animateDoors);

    // 2. NPC walks into the room from outside door (z = -6.0) to front of player (z = -1.35)
    await playNpcAnim('mixamo_walk.fbx', true);

    const npcWalkDuration = 3800;
    const walkStart = performance.now();
    const npcStartPos = new THREE.Vector3(0, 0, -6.0);
    const npcEndPos = new THREE.Vector3(0, 0, -1.35);

    const stepNpcWalk = () => {
      if (!cinematicActiveRef.current) return;
      const elapsed = performance.now() - walkStart;
      const progress = Math.min(1, elapsed / npcWalkDuration);
      npcRootRef.current.position.lerpVectors(npcStartPos, npcEndPos, progress);

      if (progress < 1) {
        npcWalkRafRef.current = requestAnimationFrame(stepNpcWalk);
      } else {
        playNpcAnim('mixamo_idle.fbx', true);
        speakDialogue(
          "Well, well... So you chose to receive pain. Let's see how long your body can endure my private training without breaking!",
          'Hana (Dominant)'
        );

        cinematicTimerRef.current = window.setTimeout(() => {
          if (cinematicActiveRef.current) {
            startTrainingRound();
          }
        }, 4200);
      }
    };

    cinematicTimerRef.current = window.setTimeout(() => {
      if (cinematicActiveRef.current) {
        npcWalkRafRef.current = requestAnimationFrame(stepNpcWalk);
      }
    }, 800);
  }, [clearCinematicTimers, playNpcAnim, playSynthSound, speakDialogue, startTrainingRound, updateGameState]);

  useEffect(() => {
    playCinematicIntroRef.current = playCinematicIntro;
  }, [playCinematicIntro]);

  const skipCinematic = useCallback(() => {
    cinematicActiveRef.current = false;
    clearCinematicTimers();

    if (doorPivotLeftRef.current) doorPivotLeftRef.current.rotation.y = -Math.PI * 0.45;
    if (doorPivotRightRef.current) doorPivotRightRef.current.rotation.y = Math.PI * 0.45;

    npcRootRef.current.position.set(0, 0, -1.35);
    npcRootRef.current.rotation.y = 0;

    playNpcAnim('mixamo_idle.fbx', true);
    startTrainingRound();
  }, [clearCinematicTimers, playNpcAnim, startTrainingRound]);

  // ----------------------------------------------------
  // Three.js Scene Initialization (Runs ONCE on Mount)
  // ----------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0a0c14);
    scene.fog = new THREE.FogExp2(0x0a0c14, 0.045);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 80);
    cameraRef.current = camera;
    camera.position.set(0, 1.4, 3.2);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Room Interior Construction
    const floorGeo = new THREE.PlaneGeometry(16, 20);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      roughness: 0.35,
      metalness: 0.25,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // Decorative floor grid / trial ring
    const ringGeo = new THREE.RingGeometry(1.6, 1.68, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x55d2f6,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.005;
    scene.add(ringMesh);

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x11131c,
      roughness: 0.85,
      metalness: 0.1,
    });

    const backWallLeft = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5, 0.4), wallMat);
    backWallLeft.position.set(-4.5, 2.5, -6);
    scene.add(backWallLeft);

    const backWallRight = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5, 0.4), wallMat);
    backWallRight.position.set(4.5, 2.5, -6);
    scene.add(backWallRight);

    const backWallTop = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 0.4), wallMat);
    backWallTop.position.set(0, 4.1, -6);
    scene.add(backWallTop);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 20), wallMat);
    leftWall.position.set(-8, 2.5, 0);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 20), wallMat);
    rightWall.position.set(8, 2.5, 0);
    scene.add(rightWall);

    // Heavy Double Doors in Doorframe at z = -6
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x271912,
      roughness: 0.7,
      metalness: 0.2,
    });

    const leftDoorPivot = new THREE.Group();
    leftDoorPivot.position.set(-1.25, 0, -6);
    const leftDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 3.2, 0.12), doorMat);
    leftDoorMesh.position.set(0.625, 1.6, 0);
    leftDoorPivot.add(leftDoorMesh);
    scene.add(leftDoorPivot);
    doorPivotLeftRef.current = leftDoorPivot;

    const rightDoorPivot = new THREE.Group();
    rightDoorPivot.position.set(1.25, 0, -6);
    const rightDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.25, 3.2, 0.12), doorMat);
    rightDoorMesh.position.set(-0.625, 1.6, 0);
    rightDoorPivot.add(rightDoorMesh);
    scene.add(rightDoorPivot);
    doorPivotRightRef.current = rightDoorPivot;

    // Atmospheric Lighting
    const ambientLight = new THREE.AmbientLight(0x2d1a3c, 1.4);
    scene.add(ambientLight);

    const centerSpot = new THREE.SpotLight(0xfff5ea, 3.2, 14, Math.PI / 4, 0.45, 1.2);
    centerSpot.position.set(0, 5.5, 0.5);
    centerSpot.target.position.set(0, 0, 0);
    centerSpot.castShadow = true;
    centerSpot.shadow.bias = -0.0005;
    scene.add(centerSpot);
    scene.add(centerSpot.target);

    const doorRimLight = new THREE.PointLight(0xff8833, 4.0, 10);
    doorRimLight.position.set(0, 2.8, -7.5);
    scene.add(doorRimLight);

    const sconceL = new THREE.PointLight(0x55d2f6, 1.5, 8);
    sconceL.position.set(-7.5, 2.5, 0);
    scene.add(sconceL);

    const sconceR = new THREE.PointLight(0xa855f7, 1.5, 8);
    sconceR.position.set(7.5, 2.5, 0);
    scene.add(sconceR);

    scene.add(playerRootRef.current);
    scene.add(npcRootRef.current);

    playerRootRef.current.position.set(0, 0, 0);
    playerRootRef.current.rotation.y = Math.PI;

    npcRootRef.current.position.set(0, 0, -6.0);
    npcRootRef.current.rotation.y = 0;

    async function initModels() {
      setLoadingPercent(30);
      setLoadingText('Loading Submissive Player Avatar (hana_v1.2_darkslave_vrm1.vrm)...');
      const pVrm = await loadPlayerVRM('hana_v1.2_darkslave_vrm1.vrm');

      if (!isMountedRef.current) return;
      setLoadingPercent(65);
      setLoadingText('Loading Dominant NPC Trainer (hana_v1.2_darkpain_vrm1.vrm)...');
      const nVrm = await loadNpcVRM('hana_v1.2_darkpain_vrm1.vrm');

      if (!isMountedRef.current) return;
      setLoadingPercent(90);
      setLoadingText('Synchronizing retargeted motion clips...');

      if (pVrm) {
        await playPlayerAnim('mixamo_idle.fbx', true);
      }
      if (nVrm) {
        await playNpcAnim('mixamo_idle.fbx', true);
      }

      setLoadingPercent(100);
      setLoadingText('Dungeon Ready!');

      safeTimeout(() => {
        if (isMountedRef.current) {
          playCinematicIntroRef.current?.();
        }
      }, 500);
    }

    initModels();

    let lastTime = performance.now();
    let rafId: number;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.08);
      lastTime = now;

      // Update Survival Timer if training or punishment
      if (gameStateRef.current === 'training' || gameStateRef.current === 'punishment') {
        survivalTimerRef.current += dt;
        const curSec = Math.floor(survivalTimerRef.current);
        if (curSec !== lastSurvivalSecRef.current) {
          lastSurvivalSecRef.current = curSec;
          setSurvivalTimeSec(curSec);
        }
      }

      // Update animation mixers
      if (playerMixerRef.current) playerMixerRef.current.update(dt);
      if (npcMixerRef.current) npcMixerRef.current.update(dt);
      if (playerVrmRef.current) playerVrmRef.current.update(dt);
      if (npcVrmRef.current) npcVrmRef.current.update(dt);

      // Dynamic Bone Ragdoll Harmonic Impulse
      if (ragdollImpulseRef.current && playerVrmRef.current?.humanoid) {
        const imp = ragdollImpulseRef.current;
        imp.phase += dt * 14.0;
        const decay = Math.exp(-imp.phase * 0.4);
        const oscillation = Math.sin(imp.phase) * imp.intensity * decay;

        const targetBoneNode = playerVrmRef.current.humanoid.getNormalizedBoneNode(imp.boneKey as any);
        if (targetBoneNode) {
          targetBoneNode.rotation.x += oscillation * 0.4;
          targetBoneNode.rotation.z += oscillation * 0.2;
        }

        if (decay < 0.02) {
          ragdollImpulseRef.current = null;
        }
      }

      // Camera Orbit Update
      const cy = cameraYawRef.current;
      const cp = cameraPitchRef.current;
      const cd = cameraDistanceRef.current;

      const targetLookAt = new THREE.Vector3(0, 1.05, 0);
      camera.position.set(
        targetLookAt.x + Math.sin(cy) * Math.cos(cp) * cd,
        targetLookAt.y + Math.sin(cp) * cd,
        targetLookAt.z + Math.cos(cy) * Math.cos(cp) * cd
      );
      camera.lookAt(targetLookAt);

      // 60FPS High-Precision Rhythm Highway Transform Updates & Miss Checking
      if (gameStateRef.current === 'training') {
        const elapsed = performance.now() - exerciseStartTimeRef.current;
        const activeBeats = beatsRef.current;
        const scrollSpeedPxPerSec = 135;

        for (let i = 0; i < activeBeats.length; i++) {
          const beat = activeBeats[i];
          const el = beatElementsRef.current.get(beat.id);
          const diffMs = beat.timeMs - elapsed;
          const offsetPx = (diffMs / 1000) * scrollSpeedPxPerSec;

          if (el) {
            if (Math.abs(offsetPx) > 500) {
              el.style.display = 'none';
            } else {
              el.style.display = 'flex';
              el.style.transform = `translateX(${offsetPx}px)`;
            }
          }

          if (beat.hitState === null && elapsed > beat.timeMs + 500) {
            beat.hitState = 'miss';
            setBeats([...activeBeats]);
            setHitFeedback({ text: 'MISSED BEAT!', color: '#ef4444', id: Date.now() });
            executePunishmentRef.current?.();
            break;
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []); // Run ONCE on mount

  // ----------------------------------------------------
  // Camera Mouse Drag Listeners
  // ----------------------------------------------------
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    cameraYawRef.current -= dx * 0.007;
    cameraPitchRef.current = Math.max(-0.15, Math.min(1.2, cameraPitchRef.current + dy * 0.007));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    cameraDistanceRef.current = Math.max(1.8, Math.min(5.5, cameraDistanceRef.current + e.deltaY * 0.003));
  };

  // Format MM:SS
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Restart / Try Again
  const handleRestart = async () => {
    clearAllTimeouts();
    clearCinematicTimers();

    setLives(3);
    livesRef.current = 3;
    setRound(1);
    roundRef.current = 1;
    survivalTimerRef.current = 0;
    lastSurvivalSecRef.current = 0;
    setSurvivalTimeSec(0);
    setCombo(0);
    setPerfectHits(0);
    setBeats([]);
    beatsRef.current = [];
    updateGameState('training');

    await loadPlayerVRM('hana_v1.2_darkslave_vrm1.vrm');
    playerRootRef.current.position.set(0, 0, 0);
    playerRootRef.current.rotation.y = Math.PI;
    npcRootRef.current.position.set(0, 0, -1.35);
    npcRootRef.current.rotation.y = 0;
    await playNpcAnim('mixamo_idle.fbx', true);
    startTrainingRound(EXERCISES[0]);
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className="relative w-full h-screen bg-[#0a0c14] select-none overflow-hidden font-sans"
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block cursor-grab active:cursor-grabbing" />

      {/* TOP STATUS BAR */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-auto z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToChat}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-200 hover:text-white hover:bg-neutral-800 transition-all text-xs font-semibold active:scale-95 cursor-pointer shadow-lg"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Chat</span>
          </button>

          {onSwitchMode && (
            <button
              type="button"
              onClick={onSwitchMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/80 backdrop-blur-md border border-red-500/40 text-red-300 hover:bg-red-900/80 transition-all text-xs font-semibold active:scale-95 cursor-pointer shadow-lg"
            >
              <Skull className="w-3.5 h-3.5 text-red-400" />
              <span>Switch to Giving Pain</span>
            </button>
          )}
        </div>

        {/* Center: Lives / Chances Left (3 -> 2 -> 1 -> 0) */}
        <div className="flex items-center gap-4 px-4 py-2 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 shadow-xl">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mr-1">Chances:</span>
            {[1, 2, 3].map((heartIndex) => (
              <Heart
                key={heartIndex}
                className={`w-5 h-5 transition-all duration-300 ${
                  heartIndex <= lives
                    ? heartIndex === 1 && lives === 1
                      ? 'text-red-500 fill-red-500 animate-pulse drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                      : 'text-purple-400 fill-purple-400'
                    : 'text-neutral-700 fill-neutral-800/40 opacity-40'
                }`}
              />
            ))}
          </div>

          <div className="h-4 w-px bg-neutral-700/80" />

          {/* Survival Stopwatch */}
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#55d2f6]" />
            <span className="font-mono text-sm font-black text-white tracking-wider">
              {formatTime(survivalTimeSec)}
            </span>
          </div>

          <div className="h-4 w-px bg-neutral-700/80" />

          {/* Round Counter */}
          <div className="flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-bold text-amber-300">Round {round}</span>
          </div>
        </div>

        {/* Right Tools */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-200 hover:text-white transition-all active:scale-95 cursor-pointer shadow-lg"
            title={soundEnabled ? 'Mute' : 'Unmute'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-[#55d2f6]" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className="p-2 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-200 hover:text-white transition-all active:scale-95 cursor-pointer shadow-lg"
            title="Trial Guide"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* RHYTHM HIGHWAY (ACTIVE DURING TRAINING) */}
      {gameState === 'training' && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 pointer-events-none z-30 flex flex-col items-center">
          {/* Current Exercise Banner */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-neutral-950/80 backdrop-blur-md border border-[#55d2f6]/40 text-xs font-bold text-white mb-2 shadow-lg">
            <Zap className="w-3.5 h-3.5 text-[#55d2f6]" />
            <span>COMMAND: {currentExercise.title.toUpperCase()}</span>
            <span className="text-neutral-400 font-normal">| Match the oncoming arrows at the center line!</span>
          </div>

          {/* Visual Lead-in Countdown */}
          {countdownText && (
            <div className="text-2xl sm:text-3xl font-black tracking-widest text-[#55d2f6] animate-pulse drop-shadow-[0_0_20px_rgba(85,210,246,0.9)] mb-2">
              {countdownText}
            </div>
          )}

          {/* Hit Feedback Popup */}
          {hitFeedback && !countdownText && (
            <div
              key={hitFeedback.id}
              style={{ color: hitFeedback.color }}
              className="text-lg font-black tracking-widest animate-bounce mb-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
            >
              {hitFeedback.text}
            </div>
          )}

          {/* Target Strike Bar Ring */}
          <div className="relative w-full h-22 bg-neutral-950/80 border border-neutral-800 rounded-2xl backdrop-blur-md overflow-hidden flex items-center justify-center shadow-2xl">
            {/* Target Strike Zone Line */}
            <div className="absolute left-1/2 -translate-x-1/2 w-16 h-full border-x-2 border-[#55d2f6] bg-[#55d2f6]/15 flex items-center justify-center">
              <div className="w-12 h-12 rounded-xl border-2 border-white/60 animate-pulse flex items-center justify-center text-white text-xs font-black drop-shadow">
                HIT
              </div>
            </div>

            {/* Moving Beats - Slower, generous 135px/s travel speed so moves are visible ~3.4s in advance */}
            {beats.map((beat) => {
              const dirIcons = {
                up: <ArrowUp className="w-5 h-5 text-emerald-400" />,
                down: <ArrowDown className="w-5 h-5 text-sky-400" />,
                left: <ArrowLeftIcon className="w-5 h-5 text-amber-400" />,
                right: <ArrowRightIcon className="w-5 h-5 text-purple-400" />,
              };

              const statusColor =
                beat.hitState === 'perfect'
                  ? 'border-emerald-400 bg-emerald-500/30'
                  : beat.hitState === 'good'
                  ? 'border-sky-400 bg-sky-500/30'
                  : beat.hitState === 'miss'
                  ? 'border-red-500 bg-red-500/40 opacity-40'
                  : 'border-white/40 bg-neutral-900/90';

              return (
                <div
                  key={beat.id}
                  ref={(el) => {
                    if (el) {
                      beatElementsRef.current.set(beat.id, el);
                    } else {
                      beatElementsRef.current.delete(beat.id);
                    }
                  }}
                  className={`absolute w-12 h-12 rounded-xl border-2 flex items-center justify-center shadow-lg transition-colors ${statusColor}`}
                >
                  {dirIcons[beat.direction]}
                </div>
              );
            })}
          </div>

          {/* On-screen Directional Touch/Click Pads (Friendly for mobile/mouse) */}
          <div className="mt-3 flex items-center gap-3 pointer-events-auto">
            <button
              type="button"
              onClick={() => handleRhythmInput('left')}
              className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-700 hover:border-amber-400 active:scale-95 text-amber-300 font-bold transition-all shadow-lg cursor-pointer"
            >
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleRhythmInput('up')}
                className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-700 hover:border-emerald-400 active:scale-95 text-emerald-300 font-bold transition-all shadow-lg cursor-pointer"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => handleRhythmInput('down')}
                className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-700 hover:border-sky-400 active:scale-95 text-sky-300 font-bold transition-all shadow-lg cursor-pointer"
              >
                <ArrowDown className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleRhythmInput('right')}
              className="p-3 rounded-xl bg-neutral-900/90 border border-neutral-700 hover:border-purple-400 active:scale-95 text-purple-300 font-bold transition-all shadow-lg cursor-pointer"
            >
              <ArrowRightIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* SUBTITLE & DIALOGUE BANNER */}
      {subtitles && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 pointer-events-none z-20">
          <div className="p-4 rounded-2xl bg-neutral-950/90 backdrop-blur-xl border border-neutral-700/60 shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
              <span className="text-xs font-black text-red-400 tracking-wide uppercase">{speakerName}</span>
            </div>
            <p className="text-sm font-medium text-white/95 leading-relaxed">{subtitles}</p>
          </div>
        </div>
      )}

      {/* COMBO & PERFORMANCE OVERLAY (TOP-LEFT) */}
      <div className="absolute top-20 left-4 pointer-events-none z-20 flex flex-col gap-1.5">
        {combo > 1 && (
          <div className="px-3 py-1.5 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-amber-500/50 text-amber-300 font-black text-xs tracking-wider animate-pulse flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>COMBO: {combo}x</span>
          </div>
        )}
        {perfectHits > 0 && (
          <div className="text-[11px] font-mono text-emerald-400 px-3 py-0.5 rounded-lg bg-black/40 backdrop-blur-sm">
            Perfects: {perfectHits}
          </div>
        )}
      </div>

      {/* CINEMATIC SKIP BUTTON */}
      {gameState === 'cinematic' && (
        <div className="absolute top-20 right-4 pointer-events-auto z-20">
          <button
            type="button"
            onClick={skipCinematic}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900/90 border border-[#55d2f6]/40 text-[#55d2f6] hover:bg-[#55d2f6]/20 text-xs font-bold transition-all cursor-pointer shadow-lg"
          >
            <span>Skip Cinematic</span>
          </button>
        </div>
      )}

      {/* GAME OVER RESULTS MODAL */}
      {gameState === 'gameover' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
          <div className="relative w-full max-w-md bg-[#131622] border-2 border-red-500/50 rounded-3xl p-7 shadow-[0_0_60px_rgba(239,68,68,0.25)] flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-950/80 border border-red-500/50 flex items-center justify-center mb-4 text-red-400">
              <Skull className="w-9 h-9" />
            </div>

            <h2 className="text-2xl font-black text-white tracking-wide mb-1">TRIAL FAILED</h2>
            <p className="text-xs text-neutral-400 mb-6">
              You could not endure Hana's rigorous punishment training.
            </p>

            <div className="w-full grid grid-cols-2 gap-3 mb-6">
              <div className="p-3.5 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col items-center">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Time Survived</span>
                <span className="text-xl font-black font-mono text-[#55d2f6] mt-0.5">
                  {formatTime(survivalTimeSec)}
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col items-center">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Rounds Completed</span>
                <span className="text-xl font-black font-mono text-amber-400 mt-0.5">{round}</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col items-center">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Max Combo</span>
                <span className="text-xl font-black font-mono text-purple-400 mt-0.5">{maxCombo}x</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col items-center">
                <span className="text-[10px] text-neutral-400 uppercase font-semibold">Perfect Hits</span>
                <span className="text-xl font-black font-mono text-emerald-400 mt-0.5">{perfectHits}</span>
              </div>
            </div>

            <div className="w-full flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleRestart}
                className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-black text-xs tracking-wider transition-all shadow-lg active:scale-95 cursor-pointer flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again (Full Chances)</span>
              </button>

              {onSwitchMode && (
                <button
                  type="button"
                  onClick={onSwitchMode}
                  className="w-full py-2.5 rounded-2xl bg-neutral-900 border border-red-500/40 text-red-300 hover:bg-red-950/40 text-xs font-bold transition-all cursor-pointer"
                >
                  Switch to Giving Pain Mode
                </button>
              )}

              <button
                type="button"
                onClick={onBackToChat}
                className="w-full py-2 rounded-xl text-neutral-400 hover:text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Return to Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOADING SCREEN */}
      {gameState === 'loading' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0c14] text-white">
          <div className="max-w-sm w-full mx-4 p-8 rounded-3xl bg-[#121522]/90 border border-purple-500/30 backdrop-blur-2xl shadow-2xl flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mb-4 text-purple-400">
              <Sparkles className="w-8 h-8 animate-spin" />
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Entering Punishment Chamber</h3>
            <p className="text-xs text-neutral-400 mb-5 text-center">{loadingText}</p>

            <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-sky-400 to-emerald-400 transition-all duration-300"
                style={{ width: `${loadingPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-purple-300">{loadingPercent}%</span>
          </div>
        </div>
      )}

      {/* CONTROLS & TRIAL GUIDE MODAL */}
      {isHelpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#161928] border border-neutral-700 rounded-3xl p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-4">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-[#55d2f6]" />
                <h3 className="text-sm font-bold">Getting Pain: Survival Rules</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-neutral-300">
              <p>
                In this special punishment mode, you are commanded by the dominant Hana to perform rigorous physical exercises.
              </p>
              <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 space-y-1.5">
                <div className="flex justify-between">
                  <span className="font-semibold text-white">Arrow Keys / WASD:</span>
                  <span className="text-neutral-400">Match incoming directions at the center strike bar</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-semibold text-white">Mouse Drag & Scroll:</span>
                  <span className="text-neutral-400">Orbit & zoom camera freely around your model</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 space-y-1">
                <span className="font-bold block text-red-300">Penalties on Miss:</span>
                <span>• Missing or mistiming prompts triggers an immediate brutal attack from Hana.</span>
                <span>• 1st strike: Injured stance throughout the session.</span>
                <span>• 2nd strike: Model stripped to base form (last chance).</span>
                <span>• 3rd strike: Game over fatality!</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsHelpOpen(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-[#55d2f6] text-neutral-950 font-bold text-xs hover:bg-[#38c4ed] transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const TorPainTakerMode = TorGameMode2;
export default TorGameMode2;
