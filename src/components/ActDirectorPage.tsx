import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { retargetAnimation, retargetAnimationFromUrl } from 'vrm-mixamo-retarget';
import {
  VRM_CONFIG,
  VOICE_CONFIG,
  WARDROBE_OUTFITS,
  ACT_STANDBY_ANIMATIONS,
  ACT_EMOTIONS,
  ACT_INITIAL_CUES,
} from '../constants';
import { TimelineCue } from '../types';
import { lipSyncManager } from '../lib/lipSync';
import { waitForPersonaVoice } from '../lib/audio';
import { VRMSubtitles } from './VRMSubtitles';
import {
  Play,
  Square,
  Plus,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronDown,
  Film,
  Box,
  Search,
  X,
  Check,
  Sparkles,
  Loader2,
  Camera,
  Move,
  RotateCcw,
  Skull,
  ArrowLeft,
} from 'lucide-react';

export interface AnimationItem {
  key: string;
  name: string;
  fileName?: string;
  category?: 'standby' | 'emote' | 'dance' | 'action' | 'dramatic' | 'pose' | 'custom';
  candidateUrls?: string[];
  clip?: THREE.AnimationClip;
  isCustom?: boolean;
}

const KNOWN_ANIMATIONS: AnimationItem[] = ACT_STANDBY_ANIMATIONS.map((item) => ({
  ...item,
}));

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All Motions',
  standby: 'Idle & Standby',
  emote: 'Emotes & Social',
  dance: 'Dances',
  action: 'Action & Fitness',
  pose: 'Poses',
  dramatic: 'Dramatic & Fall',
  custom: 'Custom FBX',
};

/**
 * Normalizes a retargeted Mixamo AnimationClip so that root/hips translation tracks
 * play strictly in the local space of the model around its local (0, y, 0) origin
 * instead of snapping or drifting to world-space FBX coordinates.
 */
function localizeAnimationClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    if (track.name.endsWith('.position') && track.values.length >= 3) {
      const values = track.values;
      const baseX = values[0];
      const baseZ = values[2];
      for (let i = 0; i < values.length; i += 3) {
        // Keep subtle local sway around 0 in X/Z while stripping world-space root displacement
        values[i] = (values[i] - baseX) * 0.25;
        values[i + 2] = (values[i + 2] - baseZ) * 0.25;
      }
    }
  }
  return clip;
}

interface ActDirectorPageProps {
  onBackToChat?: () => void;
  onNavigateHome?: () => void;
}

export const ActDirectorPage: React.FC<ActDirectorPageProps> = ({
  onBackToChat,
  onNavigateHome,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // Three.js References
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootGroupRef = useRef<THREE.Group | null>(null);
  const modelSelectionRingRef = useRef<THREE.Group | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsMapRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const loadingAnimPromisesRef = useRef<Map<string, Promise<THREE.AnimationAction | null>>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);

  // Viewport Interaction Toolbar: Camera Movement vs. Model Movement (Local Space)
  const [interactionMode, setInteractionMode] = useState<'camera' | 'model'>('camera');
  const interactionModeRef = useRef<'camera' | 'model'>('camera');
  const [modelMoveSubMode, setModelMoveSubMode] = useState<'xy' | 'xz' | 'rotate'>('xy');
  const modelMoveSubModeRef = useRef<'xy' | 'xz' | 'rotate'>('xy');
  const [modelTransformDisplay, setModelTransformDisplay] = useState<{
    x: number;
    y: number;
    z: number;
    yawDeg: number;
  }>({ x: 0, y: 0, z: 0, yawDeg: 0 });
  const isDraggingModelRef = useRef<boolean>(false);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    if (controlsRef.current) {
      controlsRef.current.enabled = interactionMode === 'camera' && !isForceTestActiveRef.current;
    }
    if (modelSelectionRingRef.current) {
      modelSelectionRingRef.current.visible = interactionMode === 'model';
    }
  }, [interactionMode]);

  useEffect(() => {
    modelMoveSubModeRef.current = modelMoveSubMode;
  }, [modelMoveSubMode]);

  const handleResetModelTransform = useCallback(() => {
    if (modelRootGroupRef.current) {
      modelRootGroupRef.current.position.set(0, 0, 0);
      modelRootGroupRef.current.rotation.set(0, 0, 0);
      modelRootGroupRef.current.updateMatrixWorld(true);
    }
    setModelTransformDisplay({ x: 0, y: 0, z: 0, yawDeg: 0 });
  }, []);

  // Character & Asset state
  const [selectedOutfitId, setSelectedOutfitId] = useState<string>('mint-maid-apron');
  const [customVrmName, setCustomVrmName] = useState<string | null>(null);
  const [customVrmBuffer, setCustomVrmBuffer] = useState<ArrayBuffer | null>(null);
  const [animations, setAnimations] = useState<AnimationItem[]>(KNOWN_ANIMATIONS);
  const animationsRef = useRef<AnimationItem[]>(KNOWN_ANIMATIONS);
  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeAnimKey, setActiveAnimKey] = useState<string>('idle');
  const [loadingAnimKey, setLoadingAnimKey] = useState<string | null>(null);

  // Pop-up Animation Selector Modal State
  const [isAnimModalOpen, setIsAnimModalOpen] = useState<boolean>(false);
  const [animModalTargetCueId, setAnimModalTargetCueId] = useState<string | null>(null);
  const [animSearchQuery, setAnimSearchQuery] = useState<string>('');
  const [animCategoryFilter, setAnimCategoryFilter] = useState<string>('all');

  // Emotion / Expression state (Slot 2)
  const [activeEmotionKey, setActiveEmotionKey] = useState<string>('neutral');
  const activeEmotionRef = useRef<string>('neutral');
  const currentEmotionWeightsRef = useRef<Record<string, number>>({});

  // Minimal Collapsible Control Rail (like muxai-3d-preview.html)
  const [isRailExpanded, setIsRailExpanded] = useState<boolean>(true);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState<boolean>(true);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [autoplayOnClose, setAutoplayOnClose] = useState<boolean>(false);

  // Force Test (Invisible forcefield / pressure physics)
  const [isForceTestActive, setIsForceTestActive] = useState<boolean>(false);
  const isForceTestActiveRef = useRef<boolean>(false);
  useEffect(() => {
    isForceTestActiveRef.current = isForceTestActive;
    if (!isForceTestActive) {
      if (forceIndicatorRef.current) forceIndicatorRef.current.visible = false;
      if (controlsRef.current) {
        controlsRef.current.enabled = interactionModeRef.current === 'camera';
      }
    }
  }, [isForceTestActive]);

  const isPointerDownRef = useRef<boolean>(false);
  const pointerInsideCanvasRef = useRef<boolean>(false);
  const pointerDownTimeRef = useRef<number>(0);
  const pointerNdcRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const prevHitPointRef = useRef<THREE.Vector3 | null>(null);
  const forceIndicatorRef = useRef<THREE.Group | null>(null);
  const forcePhysicsRef = useRef<{
    activeBone: THREE.Object3D | null;
    targetOffset: THREE.Vector3;
    currentOffset: THREE.Vector3;
    velocity: THREE.Vector3;
    isContact: boolean;
    contactPoint: THREE.Vector3;
    pressure: number;
  }>({
    activeBone: null,
    targetOffset: new THREE.Vector3(),
    currentOffset: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    isContact: false,
    contactPoint: new THREE.Vector3(),
    pressure: 0,
  });

  // Fast bone proxy colliders for zero-lag raycasting & accurate animated touch
  const proxyCollidersRef = useRef<THREE.Mesh[]>([]);

  // Look at Camera (biomechanical human limits)
  const [lookAtCamera, setLookAtCamera] = useState<boolean>(true);
  const lookAtCameraRef = useRef<boolean>(true);
  useEffect(() => {
    lookAtCameraRef.current = lookAtCamera;
  }, [lookAtCamera]);

  // Remote Fetcher State
  const [useRemoteFetcher, setUseRemoteFetcher] = useState<boolean>(false);
  const [remoteModelVersion, setRemoteModelVersion] = useState<string>('1.2');
  const [remoteModelOutfit, setRemoteModelOutfit] = useState<string>('');
  const [isFetchingRemoteModel, setIsFetchingRemoteModel] = useState<boolean>(false);
  const [remoteAnimName, setRemoteAnimName] = useState<string>('dance');
  const [isFetchingRemoteAnim, setIsFetchingRemoteAnim] = useState<boolean>(false);
  const [remoteStatusMessage, setRemoteStatusMessage] = useState<string | null>(null);

  // Timeline Script State
  const [cues, setCues] = useState<TimelineCue[]>(ACT_INITIAL_CUES);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activePlayingIndex, setActivePlayingIndex] = useState<number | null>(null);

  const applyEmotionByKey = useCallback((emotionKey: string) => {
    activeEmotionRef.current = emotionKey;
    setActiveEmotionKey(emotionKey);
  }, []);

  // Subtitles & Voice Engine state (identical to /chat 3D mode)
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

  const cancelPlaybackRef = useRef<boolean>(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------------------------------
  // On-Demand Animation Loader & Playback Helper
  // Ensures animations selected from browser loop until another is picked
  // ----------------------------------------------------
  const ensureAnimationAction = useCallback(
    async (key: string, loop = true): Promise<THREE.AnimationAction | null> => {
      const mixer = mixerRef.current;
      const vrm = vrmRef.current;
      if (!mixer || !vrm) return null;

      const existing = actionsMapRef.current.get(key);
      if (existing) {
        if (loop) {
          existing.setLoop(THREE.LoopRepeat, Infinity);
          existing.clampWhenFinished = false;
        } else {
          existing.setLoop(THREE.LoopOnce, 1);
          existing.clampWhenFinished = true;
        }
        return existing;
      }

      const inFlight = loadingAnimPromisesRef.current.get(key);
      if (inFlight) return inFlight;

      const animItem = animationsRef.current.find((a) => a.key === key);
      if (!animItem) {
        return actionsMapRef.current.get('idle') || null;
      }

      if (animItem.clip) {
        const action = mixer.clipAction(animItem.clip);
        if (loop) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actionsMapRef.current.set(key, action);
        return action;
      }

      const loadPromise = (async (): Promise<THREE.AnimationAction | null> => {
        if (!animItem.candidateUrls || animItem.candidateUrls.length === 0) {
          return actionsMapRef.current.get('idle') || null;
        }
        for (const url of animItem.candidateUrls) {
          try {
            const rawClip = await retargetAnimationFromUrl(url, vrm);
            if (rawClip && mixerRef.current === mixer && vrmRef.current === vrm) {
              const clip = localizeAnimationClip(rawClip);
              animItem.clip = clip;
              const action = mixer.clipAction(clip);
              if (loop) {
                action.setLoop(THREE.LoopRepeat, Infinity);
                action.clampWhenFinished = false;
              } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              actionsMapRef.current.set(key, action);
              return action;
            }
          } catch {
            // Try next candidate URL
          }
        }
        return actionsMapRef.current.get('idle') || null;
      })();

      loadingAnimPromisesRef.current.set(key, loadPromise);
      try {
        return await loadPromise;
      } finally {
        loadingAnimPromisesRef.current.delete(key);
      }
    },
    []
  );

  const playAnimationByKey = useCallback(
    async (key: string, crossFadeDuration = 0.35, loop = true) => {
      setActiveAnimKey(key);
      const mixer = mixerRef.current;
      if (!mixer) return;

      let targetAction = actionsMapRef.current.get(key) || null;
      if (!targetAction) {
        setLoadingAnimKey(key);
        targetAction = await ensureAnimationAction(key, loop);
        setLoadingAnimKey((prev) => (prev === key ? null : prev));
      }

      if (!targetAction) {
        targetAction = actionsMapRef.current.get('idle') || null;
      }

      if (!targetAction) return;

      if (loop) {
        targetAction.setLoop(THREE.LoopRepeat, Infinity);
        targetAction.clampWhenFinished = false;
      } else {
        targetAction.setLoop(THREE.LoopOnce, 1);
        targetAction.clampWhenFinished = true;
      }

      const prevAction = currentActionRef.current;
      if (prevAction === targetAction) {
        if (!targetAction.isRunning()) {
          targetAction.reset();
          targetAction.play();
        }
        return;
      }

      targetAction.reset();
      targetAction.fadeIn(crossFadeDuration);
      targetAction.play();

      if (prevAction) {
        prevAction.fadeOut(crossFadeDuration);
      }

      currentActionRef.current = targetAction;
    },
    [ensureAnimationAction]
  );

  // Stop animations and return to default rest pose (T-pose / bind pose)
  const stopAllAnimationsToDefaultPose = useCallback((crossFadeDuration = 0.25) => {
    setActiveAnimKey('none');
    const mixer = mixerRef.current;
    const vrm = vrmRef.current;

    if (currentActionRef.current) {
      currentActionRef.current.fadeOut(crossFadeDuration);
      setTimeout(() => {
        currentActionRef.current?.stop();
        currentActionRef.current = null;
      }, crossFadeDuration * 1000);
    }

    if (mixer) {
      mixer.stopAllAction();
    }

    if (vrm?.humanoid) {
      const allBoneNames = [
        'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
        'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
        'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
        'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
        'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
      ];
      for (const bName of allBoneNames) {
        const normNode = vrm.humanoid.getNormalizedBoneNode(bName as any);
        if (normNode) {
          normNode.quaternion.identity();
          normNode.position.set(0, 0, 0);
        }
        const rawNode = vrm.humanoid.getRawBoneNode(bName as any);
        if (rawNode) {
          rawNode.quaternion.identity();
        }
      }
      vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);
      vrm.scene.rotation.set(0, 0, 0);
      vrm.scene.updateMatrixWorld(true);
    }
  }, []);

  // Toggle animation or disable back to default rest pose if already active
  const handleToggleOrPlayAnimation = useCallback(
    (key: string) => {
      if (activeAnimKey === key) {
        stopAllAnimationsToDefaultPose();
      } else {
        playAnimationByKey(key, 0.35, true);
      }
    },
    [activeAnimKey, stopAllAnimationsToDefaultPose, playAnimationByKey]
  );

  // ----------------------------------------------------
  // Speech Playback Helper (Exact same voice engine as /chat)
  // ----------------------------------------------------
  const speakTextPrompt = (text: string): Promise<void> => {
    return new Promise(async (resolve) => {
      if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      // Resolve prioritized persona female voice from VOICE_CONFIG
      const voice = await waitForPersonaVoice(VOICE_CONFIG.waitVoiceTimeoutMs);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = VOICE_CONFIG.pitch;
      utterance.rate = VOICE_CONFIG.rate;
      if (voice) {
        utterance.voice = voice;
      }

      activeUtteranceRef.current = utterance;

      utterance.onstart = () => {
        lipSyncManager.startSpeech(text);
        setSubtitleState({
          isActive: true,
          text,
          charIndex: 0,
          currentWord: text.split(/\s+/)[0] || '',
        });
      };

      utterance.onboundary = (event) => {
        const charIndex = event.charIndex || 0;
        let charLength = event.charLength || 0;
        if (!charLength) {
          const m = text.slice(charIndex).match(/^\S+/);
          charLength = m ? m[0].length : 5;
        }
        const word = text.slice(charIndex, charIndex + charLength);
        lipSyncManager.onBoundary(word);

        setSubtitleState((prev) => ({
          ...prev,
          isActive: true,
          text,
          charIndex,
          currentWord: word,
        }));
      };

      const handleEnd = () => {
        lipSyncManager.endSpeech();
        activeUtteranceRef.current = null;
        setSubtitleState((prev) => ({
          ...prev,
          isActive: false,
          charIndex: prev.text.length,
        }));
        resolve();
      };

      utterance.onend = handleEnd;
      utterance.onerror = handleEnd;

      window.speechSynthesis.speak(utterance);
    });
  };

  // ----------------------------------------------------
  // Sequential Timeline Playback
  // ----------------------------------------------------
  const handlePlayTimeline = async () => {
    if (cues.length === 0) return;

    cancelPlaybackRef.current = false;
    setIsPlaying(true);

    for (let i = 0; i < cues.length; i++) {
      if (cancelPlaybackRef.current) break;

      const cue = cues[i];
      setActivePlayingIndex(i);

      // Scroll card into view
      if (timelineScrollRef.current) {
        const card = timelineScrollRef.current.children[i] as HTMLElement;
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

      // 1. Play animation (or idle)
      const animKey = cue.animationKey || 'idle';
      await playAnimationByKey(animKey);
      if (cancelPlaybackRef.current) break;

      // 2. Apply facial emotion (Slot 2)
      const emoKey = cue.emotionKey || 'neutral';
      applyEmotionByKey(emoKey);

      // 3. Execute script
      const hasScript = Boolean(cue.text && cue.text.trim().length > 0);
      if (hasScript) {
        await speakTextPrompt(cue.text);
        await new Promise((r) => setTimeout(r, 400));
      } else {
        // Silent animation scenario
        const durationMs = Math.max(1, (cue.durationSec || 3.5) * 1000);
        await new Promise((resolve) => {
          timeoutIdRef.current = setTimeout(resolve, durationMs);
        });
      }
    }

    handleStopPlayback();
  };

  const handleStopPlayback = () => {
    cancelPlaybackRef.current = true;
    if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    lipSyncManager.endSpeech();
    setIsPlaying(false);
    setActivePlayingIndex(null);
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    playAnimationByKey('idle');
    applyEmotionByKey('neutral');
  };

  const handleCollapseRail = () => {
    setIsRailExpanded(false);
    if (autoplayOnClose) {
      setIsScriptEditorOpen(false);
      if (!isPlaying) {
        handlePlayTimeline();
      }
    }
  };

  const handleToggleRail = () => {
    if (isRailExpanded) {
      handleCollapseRail();
    } else {
      // Reopening the control panel via logo stops active animation sequence
      handleStopPlayback();
      setIsRailExpanded(true);
    }
  };

  // ----------------------------------------------------
  // Three.js Stage, Lighting & Render Loop
  // ----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDisposed = false;
    let rafId = 0;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      28,
      container.clientWidth / container.clientHeight,
      0.1,
      50.0
    );
    camera.position.set(0.0, 1.2, 2.0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0.0, 1.05, 0.0);
    controls.minDistance = 0.8;
    controls.maxDistance = 4.5;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1.5, 2.5, 2.0);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.6);
    fillLight.position.set(-1.5, 1.5, 1.5);
    scene.add(fillLight);

    // Floor Grid (subtle)
    const grid = new THREE.GridHelper(8, 16, 0x55d2f6, 0x94a3b8);
    grid.position.y = -0.16;
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);

    // Dedicated Model Root Group so user can grab & move the model in world space
    // while all VRM & Mixamo animations play strictly in the model's local coordinate space
    const modelRootGroup = new THREE.Group();
    modelRootGroup.name = 'ActModelRootGroup';
    scene.add(modelRootGroup);
    modelRootGroupRef.current = modelRootGroup;

    // Local-Space Selection Ring & Facing Arrow Gizmo under the model's feet
    const selectionRingGroup = new THREE.Group();
    selectionRingGroup.position.set(0, -0.155, 0);
    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.37, 48),
      new THREE.MeshBasicMaterial({
        color: 0x55d2f6,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    baseRing.rotation.x = -Math.PI / 2;
    selectionRingGroup.add(baseRing);

    const innerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 48),
      new THREE.MeshBasicMaterial({
        color: 0x55d2f6,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    innerDisc.rotation.x = -Math.PI / 2;
    selectionRingGroup.add(innerDisc);

    // Forward direction indicator (+Z local forward)
    const dirCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.14, 16),
      new THREE.MeshBasicMaterial({
        color: 0x55d2f6,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    );
    dirCone.rotation.x = Math.PI / 2;
    dirCone.position.set(0, 0.01, 0.43);
    selectionRingGroup.add(dirCone);

    selectionRingGroup.visible = interactionModeRef.current === 'model';
    modelRootGroup.add(selectionRingGroup);
    modelSelectionRingRef.current = selectionRingGroup;

    // Force Test Visual Indicator (invisible forcefield ripple halo)
    const forceGroup = new THREE.Group();
    const innerOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff3b5c,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      })
    );
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.085, 32),
      new THREE.MeshBasicMaterial({
        color: 0x55d2f6,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    forceGroup.add(innerOrb);
    forceGroup.add(outerRing);
    forceGroup.visible = false;
    scene.add(forceGroup);
    forceIndicatorRef.current = forceGroup;

    // Raycaster for Force Test & Model Grabbing interaction
    const forceRaycaster = new THREE.Raycaster();
    const modelDragPlane = new THREE.Plane();
    const dragStartPlaneHit = new THREE.Vector3();
    let hasValidStartPlaneHit = false;
    const dragStartModelPos = new THREE.Vector3();
    let dragStartYaw = 0;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragButton = 0;

    const syncModelTransformState = () => {
      if (!modelRootGroupRef.current) return;
      const p = modelRootGroupRef.current.position;
      const r = modelRootGroupRef.current.rotation;
      setModelTransformDisplay({
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        yawDeg: Math.round((r.y * 180) / Math.PI),
      });
    };

    // Canvas Pointer Event Listeners for Force Test & Model Movement
    const updatePointerPos = (e: PointerEvent) => {
      if (!canvas) return;
      pointerInsideCanvasRef.current = true;
      const rect = canvas.getBoundingClientRect();
      pointerNdcRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdcRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (interactionModeRef.current === 'model') {
        e.preventDefault();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      updatePointerPos(e);

      if (isForceTestActiveRef.current) {
        isPointerDownRef.current = true;
        pointerDownTimeRef.current = performance.now();
        return;
      }

      if (interactionModeRef.current === 'model' && modelRootGroupRef.current && cameraRef.current) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        isDraggingModelRef.current = true;
        dragButton = e.button;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        dragStartModelPos.copy(modelRootGroupRef.current.position);
        dragStartYaw = modelRootGroupRef.current.rotation.y;

        forceRaycaster.setFromCamera(
          new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
          cameraRef.current
        );

        const subMode = modelMoveSubModeRef.current;
        if (subMode === 'xy') {
          const camDir = new THREE.Vector3();
          cameraRef.current.getWorldDirection(camDir).negate();
          const anchor = modelRootGroupRef.current.position
            .clone()
            .add(new THREE.Vector3(0, 0.85, 0));
          modelDragPlane.setFromNormalAndCoplanarPoint(camDir, anchor);
          hasValidStartPlaneHit = Boolean(
            forceRaycaster.ray.intersectPlane(modelDragPlane, dragStartPlaneHit)
          );
        } else if (subMode === 'xz') {
          modelDragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            modelRootGroupRef.current.position
          );
          hasValidStartPlaneHit =
            Math.abs(forceRaycaster.ray.direction.y) > 0.16 &&
            Boolean(forceRaycaster.ray.intersectPlane(modelDragPlane, dragStartPlaneHit));
        } else {
          hasValidStartPlaneHit = false;
        }

        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {}
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      updatePointerPos(e);

      if (isForceTestActiveRef.current) {
        return;
      }

      if (
        isDraggingModelRef.current &&
        interactionModeRef.current === 'model' &&
        modelRootGroupRef.current &&
        cameraRef.current
      ) {
        const subMode = modelMoveSubModeRef.current;
        const isRotateAction = dragButton === 2 || e.shiftKey || subMode === 'rotate';

        if (isRotateAction) {
          const deltaX = e.clientX - dragStartClientX;
          modelRootGroupRef.current.rotation.y = dragStartYaw + deltaX * 0.012;
        } else if (subMode === 'xy' && hasValidStartPlaneHit) {
          forceRaycaster.setFromCamera(
            new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
            cameraRef.current
          );
          const currentHit = new THREE.Vector3();
          if (forceRaycaster.ray.intersectPlane(modelDragPlane, currentHit)) {
            const offset = currentHit.sub(dragStartPlaneHit);
            modelRootGroupRef.current.position.copy(dragStartModelPos).add(offset);
          }
        } else if (subMode === 'xz') {
          forceRaycaster.setFromCamera(
            new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
            cameraRef.current
          );
          const currentHit = new THREE.Vector3();
          if (
            hasValidStartPlaneHit &&
            Math.abs(forceRaycaster.ray.direction.y) > 0.16 &&
            forceRaycaster.ray.intersectPlane(modelDragPlane, currentHit)
          ) {
            const offset = currentHit.sub(dragStartPlaneHit);
            if (offset.length() < 8.0) {
              modelRootGroupRef.current.position.set(
                dragStartModelPos.x + offset.x,
                dragStartModelPos.y,
                dragStartModelPos.z + offset.z
              );
            }
          } else {
            // Fallback screen-to-floor projection for shallow camera angles
            const dx = (e.clientX - dragStartClientX) * 0.0045;
            const dy = (e.clientY - dragStartClientY) * 0.0045;
            const camForward = new THREE.Vector3();
            cameraRef.current.getWorldDirection(camForward);
            camForward.y = 0;
            if (camForward.lengthSq() > 0.0001) camForward.normalize();
            else camForward.set(0, 0, -1);
            const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

            modelRootGroupRef.current.position.set(
              dragStartModelPos.x + camRight.x * dx - camForward.x * dy,
              dragStartModelPos.y,
              dragStartModelPos.z + camRight.z * dx - camForward.z * dy
            );
          }
        }

        modelRootGroupRef.current.updateMatrixWorld(true);
        syncModelTransformState();
      }
    };

    const handlePointerUp = (e?: PointerEvent) => {
      isPointerDownRef.current = false;
      isDraggingModelRef.current = false;
      prevHitPointRef.current = null;
      if (e && canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }
      if (controlsRef.current && !isForceTestActiveRef.current) {
        controlsRef.current.enabled = interactionModeRef.current === 'camera';
      }
    };

    const handlePointerLeave = () => {
      pointerInsideCanvasRef.current = false;
      if (!isDraggingModelRef.current) {
        isPointerDownRef.current = false;
        prevHitPointRef.current = null;
        if (controlsRef.current && !isForceTestActiveRef.current) {
          controlsRef.current.enabled = interactionModeRef.current === 'camera';
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (
        interactionModeRef.current === 'model' &&
        !isForceTestActiveRef.current &&
        modelRootGroupRef.current
      ) {
        e.preventDefault();
        const step = -Math.sign(e.deltaY) * 0.08;
        const subMode = modelMoveSubModeRef.current;
        if (subMode === 'rotate') {
          modelRootGroupRef.current.rotation.y += step * 1.5;
        } else if (subMode === 'xz') {
          modelRootGroupRef.current.position.y += step;
        } else {
          modelRootGroupRef.current.position.z += step;
        }
        modelRootGroupRef.current.updateMatrixWorld(true);
        syncModelTransformState();
      }
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Blinking
    let nextBlinkTime = 2.5;
    let blinkTimer = 0;
    let isBlinking = false;
    const clock = new THREE.Clock();

    const animate = () => {
      if (isDisposed) return;
      rafId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (controls.enabled) {
        controls.update();
      }

      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      if (vrmRef.current) {
        if (modelRootGroupRef.current) {
          modelRootGroupRef.current.updateMatrixWorld(true);
        }
        // Crucial: synchronize animated skeleton matrices so proxy colliders match the active pose
        vrmRef.current.scene.updateMatrixWorld(true);

        // ----------------------------------------------------
        // 1. NATURAL "LOOK AT CAMERA" ANGLE CLAMPING
        // Evaluates relative to character torso and slerps over active animations
        // ----------------------------------------------------
        if (lookAtCameraRef.current && vrmRef.current.humanoid && cameraRef.current) {
          const head = vrmRef.current.humanoid.getNormalizedBoneNode('head');
          const neck = vrmRef.current.humanoid.getNormalizedBoneNode('neck');

          if (head) {
            const headWorldPos = new THREE.Vector3();
            head.getWorldPosition(headWorldPos);

            const toCamWorld = cameraRef.current.position.clone().sub(headWorldPos).normalize();
            const charQuat = new THREE.Quaternion();
            vrmRef.current.scene.getWorldQuaternion(charQuat);

            const localDir = toCamWorld.applyQuaternion(charQuat.clone().invert()).normalize();

            // Calculate yaw and pitch relative to character body (+Z forward, +Y up, +X right)
            const yaw = Math.atan2(localDir.x, localDir.z);
            const pitch = -Math.atan2(localDir.y, Math.hypot(localDir.x, localDir.z));

            // Human limits: max natural yaw ~55deg; smoothly fade out if camera is behind (> 55deg to 85deg)
            const maxYaw = 55 * (Math.PI / 180);
            const fadeStartYaw = 55 * (Math.PI / 180);
            const cutoffYaw = 85 * (Math.PI / 180);

            let influence = 1.0;
            const absYaw = Math.abs(yaw);
            if (absYaw >= cutoffYaw) {
              influence = 0.0;
            } else if (absYaw > fadeStartYaw) {
              influence = 1.0 - (absYaw - fadeStartYaw) / (cutoffYaw - fadeStartYaw);
            }

            if (influence > 0.001) {
              const clampedYaw = Math.max(-maxYaw, Math.min(maxYaw, yaw)) * influence;
              const clampedPitch = Math.max(-25 * (Math.PI / 180), Math.min(30 * (Math.PI / 180), pitch)) * influence;

              // Smoothly blend head and neck towards camera direction over current animation pose
              const headTargetQuat = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(clampedPitch * 0.65, clampedYaw * 0.65, 0, 'YXZ')
              );
              head.quaternion.slerp(headTargetQuat, 0.85 * influence);

              if (neck) {
                const neckTargetQuat = new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(clampedPitch * 0.35, clampedYaw * 0.35, 0, 'YXZ')
                );
                neck.quaternion.slerp(neckTargetQuat, 0.65 * influence);
              }
            }
          }
        }

        // ----------------------------------------------------
        // 2. ULTRA-FAST REAL-TIME FORCEFIELD & PRESSURE PHYSICS ("FORCE TEST")
        // Uses bone proxy colliders for 0.01ms instantaneous raycasting (zero lag)
        // Works dynamically even during active animations!
        // ----------------------------------------------------
        if (isForceTestActiveRef.current && cameraRef.current && proxyCollidersRef.current.length > 0) {
          // Raycast only when pointer is active over canvas or down (eliminates all idle loop lag)
          if (pointerInsideCanvasRef.current || isPointerDownRef.current) {
            forceRaycaster.setFromCamera(
              new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
              cameraRef.current
            );

            // Fast raycast against proxy colliders only (eliminates lag from 50k skinned triangles)
            const intersects = forceRaycaster.intersectObjects(proxyCollidersRef.current, false);
            const hit = intersects[0];
            const phys = forcePhysicsRef.current;

            if (hit) {
              phys.isContact = true;
              phys.contactPoint.copy(hit.point);

              // While touching/interacting with model, disable orbit controls so pointer acts directly on model
              if (controlsRef.current) {
                controlsRef.current.enabled = false;
              }

              // Position and show forcefield halo
              if (forceIndicatorRef.current) {
                forceIndicatorRef.current.position.copy(hit.point);
                const normal = hit.face
                  ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
                  : new THREE.Vector3(0, 0, 1);
                forceIndicatorRef.current.lookAt(hit.point.clone().add(normal));
                forceIndicatorRef.current.visible = true;
              }

              // Pressure & holding depth accumulation
              let pressure = 0.25;
              if (isPointerDownRef.current) {
                const holdSec = (performance.now() - pointerDownTimeRef.current) / 1000;
                pressure = Math.min(1.0, 0.42 + holdSec * 1.5);
              }
              phys.pressure = pressure;

              if (forceIndicatorRef.current) {
                const s = 0.85 + pressure * 1.15;
                forceIndicatorRef.current.scale.set(s, s, s);
              }

              const hitBone = hit.object.userData.boneNode as THREE.Object3D;
              if (hitBone) {
                phys.activeBone = hitBone;

                // Push vector: ray direction pushes inward into the body
                const pushDirWorld = forceRaycaster.ray.direction
                  .clone()
                  .multiplyScalar(0.045 + pressure * 0.09);

                // Tangential dragging / rubbing friction effect
                if (isPointerDownRef.current && prevHitPointRef.current) {
                  const dragVector = hit.point.clone().sub(prevHitPointRef.current);
                  pushDirWorld.add(dragVector.multiplyScalar(0.8));
                }
                prevHitPointRef.current = hit.point.clone();

                // Convert push force into local coordinate space of bone parent
                if (hitBone.parent) {
                  const parentInvQuat = new THREE.Quaternion();
                  hitBone.parent.getWorldQuaternion(parentInvQuat);
                  parentInvQuat.invert();
                  phys.targetOffset.copy(pushDirWorld.applyQuaternion(parentInvQuat));
                } else {
                  phys.targetOffset.copy(pushDirWorld);
                }

                // Reactive micro-expression (gentle blink or shy reaction on poke/press)
                if (isPointerDownRef.current && vrmRef.current.expressionManager) {
                  try {
                    vrmRef.current.expressionManager.setValue('blink', Math.min(0.5, pressure * 0.6));
                    if (pressure > 0.62) {
                      vrmRef.current.expressionManager.setValue('surprised', 0.32);
                    }
                  } catch {}
                }
              }
            } else {
              phys.isContact = false;
              phys.targetOffset.set(0, 0, 0);
              prevHitPointRef.current = null;
              if (forceIndicatorRef.current) {
                forceIndicatorRef.current.visible = false;
              }
              if (controlsRef.current && !isPointerDownRef.current) {
                controlsRef.current.enabled = interactionModeRef.current === 'camera';
              }
            }
          }

          // Spring-damper physics simulation for bone displacement and bouncy recoil
          const phys = forcePhysicsRef.current;
          if (phys.activeBone) {
            const k = 160.0;
            const damping = 15.0;
            const force = phys.targetOffset.clone().sub(phys.currentOffset).multiplyScalar(k);
            const damp = phys.velocity.clone().multiplyScalar(damping);
            const accel = force.sub(damp);

            phys.velocity.add(accel.multiplyScalar(delta));
            phys.currentOffset.add(phys.velocity.clone().multiplyScalar(delta));
            phys.activeBone.position.add(phys.currentOffset);

            // Subtle posture tilt impulse so pushed bone visibly flexes and springs back
            const tiltQuat = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                -phys.currentOffset.z * 3.2,
                phys.currentOffset.x * 2.5,
                -phys.currentOffset.x * 2.0,
                'YXZ'
              )
            );
            phys.activeBone.quaternion.multiply(tiltQuat);

            if (!phys.isContact && phys.currentOffset.lengthSq() < 0.00001 && phys.velocity.lengthSq() < 0.00001) {
              phys.activeBone = null;
            }
          }
        } else {
          if (forceIndicatorRef.current && forceIndicatorRef.current.visible) {
            forceIndicatorRef.current.visible = false;
          }
          if (controlsRef.current) {
            const shouldEnableOrbit = interactionModeRef.current === 'camera';
            if (controlsRef.current.enabled !== shouldEnableOrbit) {
              controlsRef.current.enabled = shouldEnableOrbit;
            }
          }
        }

        // ----------------------------------------------------
        // 3. VRM UPDATE - Propagates normalized bone rotations & procedural offsets to skeleton & SkinnedMeshes!
        // ----------------------------------------------------
        vrmRef.current.update(delta);

        // ----------------------------------------------------
        // 4. Update LipSync, Visemes & Facial Expressions
        // ----------------------------------------------------
        lipSyncManager.update(delta, clock.getElapsedTime());
        const visemes = lipSyncManager.getVisemes();

        if (vrmRef.current.expressionManager) {
          vrmRef.current.expressionManager.setValue('aa', visemes.aa);
          vrmRef.current.expressionManager.setValue('ih', visemes.ih);
          vrmRef.current.expressionManager.setValue('ou', visemes.ou);
          vrmRef.current.expressionManager.setValue('ee', visemes.ee);
          vrmRef.current.expressionManager.setValue('oh', visemes.oh);

          // Smoothly interpolate active emotion channels (Slot 2)
          const activeEmo = ACT_EMOTIONS.find((e) => e.key === activeEmotionRef.current) || ACT_EMOTIONS[0];
          const targetBlends = activeEmo.blendValues || {};

          const emotionChannels = [
            'happy', 'joy', 'sad', 'sorrow', 'angry', 'surprised', 'relaxed', 'fun',
            'blinkLeft', 'blinkRight'
          ];

          for (const channel of emotionChannels) {
            const targetVal = targetBlends[channel] || 0;
            const currentVal = currentEmotionWeightsRef.current[channel] || 0;
            const nextVal = currentVal + (targetVal - currentVal) * Math.min(1, delta * 7.5);
            currentEmotionWeightsRef.current[channel] = nextVal;
            try {
              vrmRef.current.expressionManager.setValue(channel, nextVal);
            } catch {}
          }

          // Direct setting of custom named blendshapes if present
          if (activeEmo.key !== 'neutral') {
            try {
              vrmRef.current.expressionManager.setValue(activeEmo.key, 1.0);
            } catch {}
          }

          // Blinking
          blinkTimer += delta;
          if (blinkTimer > nextBlinkTime) {
            isBlinking = true;
            blinkTimer = 0;
            nextBlinkTime = 2.0 + Math.random() * 3.5;
          }

          if (isBlinking) {
            const progress = blinkTimer / 0.18;
            if (progress <= 0.5) {
              vrmRef.current.expressionManager.setValue('blink', progress * 2);
            } else if (progress <= 1.0) {
              vrmRef.current.expressionManager.setValue('blink', (1.0 - progress) * 2);
            } else {
              vrmRef.current.expressionManager.setValue('blink', 0);
              isBlinking = false;
            }
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('pointercancel', handlePointerUp);
      canvas.removeEventListener('wheel', handleWheel);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // ----------------------------------------------------
  // Load VRM Model
  // ----------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    let isDisposed = false;
    setIsLoading(true);

    if (vrmRef.current) {
      if (vrmRef.current.scene.parent) {
        vrmRef.current.scene.parent.remove(vrmRef.current.scene);
      } else {
        scene.remove(vrmRef.current.scene);
      }
      VRMUtils.deepDispose(vrmRef.current.scene);
      vrmRef.current = null;
    }

    actionsMapRef.current.clear();
    loadingAnimPromisesRef.current.clear();
    currentActionRef.current = null;

    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    const onModelLoaded = async (gltf: any) => {
      if (isDisposed) return;
      const vrm = gltf.userData.vrm as VRM;
      if (!vrm) {
        setIsLoading(false);
        return;
      }

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      try {
        VRMUtils.rotateVRM0(vrm);
      } catch {}

      vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);
      vrm.scene.rotation.set(0, 0, 0);
      vrm.scene.traverse((obj) => {
        obj.frustumCulled = false;
      });

      vrmRef.current = vrm;
      if (modelRootGroupRef.current) {
        modelRootGroupRef.current.add(vrm.scene);
      } else {
        scene.add(vrm.scene);
      }

      // Build lightweight proxy colliders on humanoid bones for ultra-fast (0.01ms) raycasting & animated hit tracking
      proxyCollidersRef.current = [];
      if (vrm.humanoid) {
        const colliderDefs: Array<{
          boneName: string;
          geo: THREE.BufferGeometry;
          offset?: [number, number, number];
        }> = [
          { boneName: 'head', geo: new THREE.SphereGeometry(0.14, 8, 8), offset: [0, 0.08, 0] },
          { boneName: 'neck', geo: new THREE.SphereGeometry(0.08, 8, 8), offset: [0, 0.04, 0] },
          { boneName: 'chest', geo: new THREE.BoxGeometry(0.26, 0.22, 0.18), offset: [0, 0.06, 0] },
          { boneName: 'spine', geo: new THREE.SphereGeometry(0.15, 8, 8) },
          { boneName: 'hips', geo: new THREE.SphereGeometry(0.2, 8, 8), offset: [0, -0.04, 0] },
          { boneName: 'leftUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.22, 6), offset: [0, -0.1, 0] },
          { boneName: 'rightUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.22, 6), offset: [0, -0.1, 0] },
          { boneName: 'leftLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0] },
          { boneName: 'rightLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0] },
          { boneName: 'leftUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.32, 6), offset: [0, -0.15, 0] },
          { boneName: 'rightUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.32, 6), offset: [0, -0.15, 0] },
          { boneName: 'leftLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6), offset: [0, -0.15, 0] },
          { boneName: 'rightLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6), offset: [0, -0.15, 0] },
        ];

        const proxyMat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
        });

        for (const def of colliderDefs) {
          const boneNode = vrm.humanoid.getNormalizedBoneNode(def.boneName as any);
          if (boneNode) {
            const mesh = new THREE.Mesh(def.geo, proxyMat);
            mesh.visible = true;
            if (def.offset) {
              mesh.position.set(def.offset[0], def.offset[1], def.offset[2]);
            }
            mesh.userData = { boneName: def.boneName, boneNode };
            boneNode.add(mesh);
            proxyCollidersRef.current.push(mesh);
          }
        }
      }

      const mixer = new THREE.AnimationMixer(vrm.scene);
      mixerRef.current = mixer;

      // Load default Idle animation immediately so the stage is ready right away
      const idleAction = await ensureAnimationAction('idle');
      if (idleAction && !isDisposed) {
        idleAction.play();
        currentActionRef.current = idleAction;
        setActiveAnimKey('idle');
      }

      if (!isDisposed) {
        setIsLoading(false);
      }

      // Pre-warm core initial cue animations in the background
      const priorityKeys = ['wave', 'wait', 'yawn', 'walk', 'armstretch', 'feelingshy', 'idle_nailcheck'];
      for (const key of priorityKeys) {
        if (isDisposed) break;
        ensureAnimationAction(key).catch(() => {});
      }
    };

    if (customVrmBuffer) {
      gltfLoader.parse(customVrmBuffer, '', onModelLoaded);
    } else {
      const outfit = WARDROBE_OUTFITS.find((o) => o.id === selectedOutfitId) || WARDROBE_OUTFITS[0];
      const modelUrl = `/api/vrm?file=${encodeURIComponent(outfit.fileName)}`;

      fetch(modelUrl)
        .then((r) => (r.ok ? r.arrayBuffer() : fetch(outfit.modelUrl).then((res) => res.arrayBuffer())))
        .then((buf) => {
          if (!isDisposed) gltfLoader.parse(buf, '', onModelLoaded);
        })
        .catch(() => setIsLoading(false));
    }

    return () => {
      isDisposed = true;
    };
  }, [selectedOutfitId, customVrmBuffer, ensureAnimationAction]);

  // Upload Custom FBX
  const handleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !vrmRef.current || !mixerRef.current) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fbxLoader = new FBXLoader();
      const fbxGroup = fbxLoader.parse(arrayBuffer, '');
      const rawClip = retargetAnimation(fbxGroup, vrmRef.current);
      if (rawClip) {
        const clip = localizeAnimationClip(rawClip);
        const key = `custom_${Date.now()}`;
        const name = file.name.replace(/\.fbx$/i, '');
        const action = mixerRef.current.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        actionsMapRef.current.set(key, action);

        const newItem: AnimationItem = {
          key,
          name,
          fileName: file.name,
          category: 'custom',
          isCustom: true,
          clip,
        };
        setAnimations((prev) => [...prev, newItem]);
        animationsRef.current = [...animationsRef.current, newItem];
        playAnimationByKey(key, 0.35, true);
      }
    } catch (err) {
      console.error('FBX upload error:', err);
    } finally {
      e.target.value = '';
    }
  };

  // Upload Custom VRM
  const handleVrmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      setCustomVrmName(file.name);
      setCustomVrmBuffer(buf);
    } catch (err) {
      console.error('VRM upload error:', err);
    }
  };

  // Remote Fetcher: Fetch VRM Model Directly from Remote URL
  const handleFetchRemoteModel = async () => {
    const version = remoteModelVersion.trim() || '1.2';
    const outfit = remoteModelOutfit.trim();
    const fileName = outfit ? `hana_v${version}_${outfit}_vrm1.vrm` : `hana_v${version}_vrm1.vrm`;

    setIsFetchingRemoteModel(true);
    setRemoteStatusMessage(`Fetching ${fileName}...`);

    const candidateUrls = [
      `/api/vrm?file=${encodeURIComponent(fileName)}`,
      `https://muxai.vercel.app/${fileName}`,
      `https://ai.mux8.com/${fileName}`,
    ];

    let buffer: ArrayBuffer | null = null;
    for (const url of candidateUrls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf && buf.byteLength > 1000) {
            buffer = buf;
            break;
          }
        }
      } catch {
        // try next candidate
      }
    }

    if (buffer) {
      setCustomVrmName(fileName);
      setCustomVrmBuffer(buffer);
      setRemoteStatusMessage(`Successfully loaded ${fileName}`);
    } else {
      setRemoteStatusMessage(`Unable to fetch ${fileName} from remote sources.`);
    }
    setIsFetchingRemoteModel(false);
    setTimeout(() => setRemoteStatusMessage(null), 4000);
  };

  // Remote Fetcher: Fetch Mixamo Animation (.fbx) from Remote URL
  const handleFetchRemoteAnimation = async () => {
    const animName = remoteAnimName.trim() || 'dance';
    const fileName = `mixamo_${animName}.fbx`;

    if (!vrmRef.current || !mixerRef.current) {
      setRemoteStatusMessage('No character model active to apply animation to.');
      return;
    }

    setIsFetchingRemoteAnim(true);
    setRemoteStatusMessage(`Fetching ${fileName}...`);

    const candidateUrls = [
      `/api/animation/${animName}`,
      `https://muxai.vercel.app/${fileName}`,
      `https://ai.mux8.com/${fileName}`,
    ];

    let buffer: ArrayBuffer | null = null;
    for (const url of candidateUrls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf && buf.byteLength > 1000) {
            buffer = buf;
            break;
          }
        }
      } catch {
        // try next candidate
      }
    }

    if (buffer) {
      try {
        const fbxLoader = new FBXLoader();
        const fbxGroup = fbxLoader.parse(buffer, '');
        const rawClip = retargetAnimation(fbxGroup, vrmRef.current);
        if (rawClip) {
          const clip = localizeAnimationClip(rawClip);
          const key = `remote_${animName}_${Date.now()}`;
          const action = mixerRef.current.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          actionsMapRef.current.set(key, action);

          const newItem: AnimationItem = {
            key,
            name: `Remote: ${animName}`,
            fileName,
            category: 'custom',
            isCustom: true,
            clip,
          };
          setAnimations((prev) => [...prev, newItem]);
          animationsRef.current = [...animationsRef.current, newItem];
          await playAnimationByKey(key, 0.35, true);
          setRemoteStatusMessage(`Playing ${fileName} in loop`);
        } else {
          setRemoteStatusMessage(`Failed to retarget animation from ${fileName}`);
        }
      } catch (err) {
        console.error(err);
        setRemoteStatusMessage(`Failed to parse FBX animation from ${fileName}`);
      }
    } else {
      setRemoteStatusMessage(`Unable to fetch ${fileName} from remote sources.`);
    }

    setIsFetchingRemoteAnim(false);
    setTimeout(() => setRemoteStatusMessage(null), 4000);
  };

  // Timeline Step Operations
  const handleAddStep = () => {
    const newCue: TimelineCue = {
      id: `cue_${Date.now()}`,
      name: `Step ${cues.length + 1}`,
      text: '',
      animationKey: 'idle',
      emotionKey: 'happy',
      durationSec: 3.5,
    };
    setCues((prev) => [...prev, newCue]);
  };

  const handleDeleteStep = (id: string) => {
    setCues((prev) => prev.filter((c) => c.id !== id));
  };

  const handleUpdateStep = (id: string, updates: Partial<TimelineCue>) => {
    setCues((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const openAnimationModalForCue = (cueId: string | null) => {
    setAnimModalTargetCueId(cueId);
    setAnimSearchQuery('');
    setIsAnimModalOpen(true);
  };

  const filteredModalAnimations = useMemo(() => {
    const q = animSearchQuery.trim().toLowerCase();
    return animations.filter((anim) => {
      if (animCategoryFilter !== 'all') {
        const cat = anim.isCustom ? 'custom' : anim.category || 'standby';
        if (cat !== animCategoryFilter) return false;
      }
      if (!q) return true;
      return (
        anim.name.toLowerCase().includes(q) ||
        anim.key.toLowerCase().includes(q) ||
        (anim.fileName || '').toLowerCase().includes(q)
      );
    });
  }, [animations, animSearchQuery, animCategoryFilter]);

  const targetCueIndex = useMemo(() => {
    if (!animModalTargetCueId) return null;
    const idx = cues.findIndex((c) => c.id === animModalTargetCueId);
    return idx >= 0 ? idx : null;
  }, [animModalTargetCueId, cues]);

  const currentSelectedModalAnimKey = useMemo(() => {
    if (animModalTargetCueId) {
      const cue = cues.find((c) => c.id === animModalTargetCueId);
      return cue?.animationKey || 'idle';
    }
    return activeAnimKey;
  }, [animModalTargetCueId, cues, activeAnimKey]);

  const hasModelOffset =
    Math.abs(modelTransformDisplay.x) > 0.01 ||
    Math.abs(modelTransformDisplay.y) > 0.01 ||
    Math.abs(modelTransformDisplay.z) > 0.01 ||
    Math.abs(modelTransformDisplay.yawDeg) > 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none bg-[#f0f2f5] dark:bg-[#0f1117] text-neutral-800 dark:text-neutral-100 font-sans">
      {/* 3D Canvas Viewport */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full">
        <canvas
          ref={canvasRef}
          className={`w-full h-full block touch-none ${
            interactionMode === 'model'
              ? 'cursor-move active:cursor-grabbing'
              : 'cursor-grab active:cursor-grabbing'
          }`}
        />
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs text-white">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--theme-accent,#55d2f6)] border-t-transparent animate-spin mb-2" />
          <span className="text-xs font-mono font-medium">Loading 3D Actor...</span>
        </div>
      )}

      {/* Top-Center Viewport Mode Toolbar: Select Between Camera Movement & Model Movement */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-auto">
        <div className="p-1.5 rounded-2xl backdrop-blur-md bg-white/90 dark:bg-[#13151f]/90 border border-black/10 dark:border-white/10 shadow-xl flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setInteractionMode('camera')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              interactionMode === 'camera'
                ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 shadow-xs font-bold'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Orbit, pan, and zoom the 3D camera"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Camera Move</span>
          </button>

          <button
            type="button"
            onClick={() => setInteractionMode('model')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              interactionMode === 'model'
                ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 shadow-xs font-bold'
                : 'text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
            title="Grab and move the 3D model directly (animations play in local space)"
          >
            <Move className="w-3.5 h-3.5" />
            <span>Model Move</span>
          </button>

          {interactionMode === 'model' && (
            <>
              <div className="h-4 w-px bg-black/10 dark:bg-white/10 mx-0.5" />
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'xy', label: 'Free 3D', tip: 'Drag X/Y parallel to view (Wheel = Z depth)' },
                    { id: 'xz', label: 'Floor XZ', tip: 'Slide across floor X/Z (Wheel = Y height)' },
                    { id: 'rotate', label: 'Rotate', tip: 'Spin model local facing direction (or Right-drag)' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setModelMoveSubMode(sub.id)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      modelMoveSubMode === sub.id
                        ? 'bg-sky-500/20 border border-sky-400/50 text-sky-700 dark:text-sky-300 font-bold'
                        : 'text-neutral-500 dark:text-neutral-400 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    title={sub.tip}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {hasModelOffset && (
            <button
              type="button"
              onClick={handleResetModelTransform}
              className="px-2 py-1 rounded-lg bg-neutral-100 dark:bg-white/10 hover:bg-neutral-200 dark:hover:bg-white/15 text-[11px] font-mono font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 cursor-pointer transition-all"
              title="Reset model position & rotation to stage center (0, 0, 0)"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>

        {interactionMode === 'model' && (
          <div className="px-2.5 py-1 rounded-xl backdrop-blur-md bg-white/80 dark:bg-[#13151f]/80 border border-black/10 dark:border-white/10 text-[10px] font-mono text-neutral-600 dark:text-neutral-300 flex items-center gap-2 shadow-sm">
            <span className="text-sky-600 dark:text-sky-400 font-semibold">Local Space Active</span>
            <span>&bull;</span>
            <span>
              Pos: ({modelTransformDisplay.x}, {modelTransformDisplay.y}, {modelTransformDisplay.z})
            </span>
            <span>&bull;</span>
            <span>Yaw: {modelTransformDisplay.yawDeg}&deg;</span>
          </div>
        )}
      </div>

      {/* Top Left Floating Control Rail (Directly styled after muxai-3d-preview.html) */}
      <div
        className={`absolute top-4 left-4 z-20 backdrop-blur-md rounded-2xl border border-black/10 dark:border-white/10 shadow-xl transition-all duration-200 overflow-hidden bg-white/85 dark:bg-[#13151f]/85 ${
          isRailExpanded ? 'w-72 sm:w-80 p-3' : 'w-12 p-1.5'
        }`}
      >
        {/* Rail Header */}
        <div className="flex items-center justify-between min-h-[36px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={handleToggleRail}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs cursor-pointer overflow-hidden p-0 border border-black/10 dark:border-white/10 transition-transform active:scale-95"
              style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
              title={isRailExpanded ? 'Fold panel' : 'Unfold panel'}
            >
              <img
                src="https://muxai.vercel.app/logo.png"
                alt="MuxAI Logo"
                className="w-full h-full object-cover scale-125"
              />
            </button>

            {isRailExpanded && (
              <div className="min-w-0">
                <h1 className="text-xs font-bold font-heading truncate text-neutral-900 dark:text-white">
                  MuxAI 3D Director
                </h1>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight">
                  Act Stage & Studio
                </p>
              </div>
            )}
          </div>

          {isRailExpanded && (
            <div className="flex items-center gap-1">
              {onBackToChat && (
                <button
                  type="button"
                  onClick={onBackToChat}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white text-xs font-medium cursor-pointer transition-colors"
                  title="Return to /chat"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={handleCollapseRail}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white text-xs font-medium cursor-pointer transition-colors"
                title="Fold up panel"
                aria-label="Fold up panel"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded Rail Content */}
        {isRailExpanded && (
          <div className="mt-3 space-y-3 text-xs">
            {/* Status Box with Green Dot (Direct reference to muxai-3d-preview.html) */}
            <div className="flex items-center gap-2 p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 text-[11px] text-neutral-600 dark:text-neutral-300">
              {loadingAnimKey ? (
                <Loader2 className="w-3 h-3 text-[var(--theme-accent,#55d2f6)] animate-spin shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              )}
              <div className="truncate flex items-center gap-1.5 min-w-0">
                <span className="truncate">
                  Motion: <strong>{animations.find((a) => a.key === activeAnimKey)?.name || activeAnimKey}</strong>
                </span>
                <span className="opacity-40">&bull;</span>
                <span className="truncate">
                  Emotion: <strong>{ACT_EMOTIONS.find((e) => e.key === activeEmotionKey)?.name || activeEmotionKey}</strong>
                </span>
              </div>
            </div>

            {/* Viewport Interaction Mode Selector in Control Rail */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Drag Control Mode
                </span>
                {hasModelOffset && (
                  <button
                    type="button"
                    onClick={handleResetModelTransform}
                    className="text-[10px] font-mono text-[var(--theme-accent,#55d2f6)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset Pos</span>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setInteractionMode('camera')}
                  className={`py-1.5 px-2 rounded-xl font-semibold text-[11px] flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                    interactionMode === 'camera'
                      ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold'
                      : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Camera Move</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInteractionMode('model')}
                  className={`py-1.5 px-2 rounded-xl font-semibold text-[11px] flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                    interactionMode === 'model'
                      ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold'
                      : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                  <span>Model Move</span>
                </button>
              </div>
            </div>

            {/* Quick Mixamo Motion Buttons + Pop-up Modal Trigger */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Quick Motions
                </span>
                <button
                  type="button"
                  onClick={() => openAnimationModalForCue(null)}
                  className="text-[10px] font-mono font-semibold text-[var(--theme-accent,#55d2f6)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Film className="w-3 h-3" />
                  <span>All ({animations.length})</span>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {animations.slice(0, 6).map((anim) => (
                  <button
                    key={anim.key}
                    onClick={() => handleToggleOrPlayAnimation(anim.key)}
                    className={`py-1.5 px-2 rounded-xl font-medium text-[11px] truncate border transition-all cursor-pointer ${
                      activeAnimKey === anim.key
                        ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {anim.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => openAnimationModalForCue(null)}
                className="w-full py-1.5 px-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-[11px] font-semibold text-neutral-700 dark:text-neutral-200 flex items-center justify-between gap-2 transition-all cursor-pointer"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Film className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)] shrink-0" />
                  <span className="truncate">Browse Standby Animations</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold shrink-0">
                  {animations.length}
                </span>
              </button>
            </div>

            {/* Quick VRM Emotion Buttons */}
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block mb-1.5">
                Quick Emotions
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {ACT_EMOTIONS.slice(0, 6).map((emo) => (
                  <button
                    key={emo.key}
                    onClick={() => applyEmotionByKey(emo.key)}
                    className={`py-1.5 px-1.5 rounded-xl font-medium text-[11px] truncate border transition-all cursor-pointer ${
                      activeEmotionKey === emo.key
                        ? 'border-rose-400 bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300'
                    }`}
                    title={emo.description}
                  >
                    <span>{emo.emoji} {emo.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Upload Buttons Row */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-black/5 dark:border-white/5">
              <label className="py-2 px-2.5 rounded-xl border border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] flex items-center justify-center gap-1.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer transition-all">
                <Upload className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)]" />
                <span>Upload FBX</span>
                <input type="file" accept=".fbx" onChange={handleFbxUpload} className="hidden" />
              </label>

              <label className="py-2 px-2.5 rounded-xl border border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] flex items-center justify-center gap-1.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer transition-all">
                <Box className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)]" />
                <span>Upload VRM</span>
                <input type="file" accept=".vrm" onChange={handleVrmUpload} className="hidden" />
              </label>
            </div>

            {/* Big Script Editor Button */}
            <button
              type="button"
              onClick={() => setIsScriptEditorOpen((prev) => !prev)}
              className={`w-full py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95 ${
                isScriptEditorOpen
                  ? 'text-white shadow-sm'
                  : 'border border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]'
              }`}
              style={isScriptEditorOpen ? { backgroundColor: 'var(--theme-accent, #55d2f6)' } : undefined}
            >
              <span>Script Editor</span>
              <span className="text-[10px] font-mono opacity-80 font-normal">
                ({isScriptEditorOpen ? 'Hide' : 'Show'})
              </span>
            </button>

            {/* Force Test Button (enable/disable) below Script Editor */}
            <button
              type="button"
              onClick={() => setIsForceTestActive((prev) => !prev)}
              className={`w-full py-2.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-95 ${
                isForceTestActive
                  ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-md ring-2 ring-rose-400/50'
                  : 'border border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-200 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${isForceTestActive ? 'animate-pulse text-amber-200' : 'text-neutral-500'}`} />
              <span>Force Test</span>
              <span className="text-[10px] font-mono opacity-80 font-normal">
                ({isForceTestActive ? 'Enabled' : 'Disabled'})
              </span>
            </button>

            {/* Current Checkmark Options Row: Show Subtitles & Autoplay on close */}
            <div className="flex items-center gap-3 pt-1 px-1 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showSubtitles}
                  onChange={(e) => setShowSubtitles(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-black/20 dark:border-white/20 accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                />
                <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  Show subtitles
                </span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoplayOnClose}
                  onChange={(e) => setAutoplayOnClose(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-black/20 dark:border-white/20 accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                />
                <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  Autoplay on close
                </span>
              </label>
            </div>

            {/* Below the current row: Checkmark for "Look at camera" and "Use remote fetcher" */}
            <div className="flex items-center gap-3 pt-0.5 px-1 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={lookAtCamera}
                  onChange={(e) => setLookAtCamera(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-black/20 dark:border-white/20 accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                />
                <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  Look at camera
                </span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useRemoteFetcher}
                  onChange={(e) => setUseRemoteFetcher(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-black/20 dark:border-white/20 accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                />
                <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                  Use remote fetcher
                </span>
              </label>
            </div>

            {/* Remote Fetcher UI Panel (when Use remote fetcher is enabled) */}
            {useRemoteFetcher && (
              <div className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] space-y-2.5">
                {remoteStatusMessage && (
                  <div className="text-[10px] font-mono px-2 py-1 rounded bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-semibold truncate">
                    {remoteStatusMessage}
                  </div>
                )}

                {/* Model Remote Fetcher: "hana_v" [] "_" [] "_vrm1.vrm" */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block">
                    Remote Model
                  </span>
                  <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.05] p-1.5 rounded-lg text-xs font-mono border border-black/5 dark:border-white/5">
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">hana_v</span>
                    <input
                      type="text"
                      value={remoteModelVersion}
                      onChange={(e) => setRemoteModelVersion(e.target.value)}
                      placeholder="1.2"
                      className="w-10 bg-white dark:bg-black/40 border border-black/15 dark:border-white/15 rounded px-1 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent,#55d2f6)] text-neutral-900 dark:text-white"
                      title="Model version"
                    />
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">_</span>
                    <input
                      type="text"
                      value={remoteModelOutfit}
                      onChange={(e) => setRemoteModelOutfit(e.target.value)}
                      placeholder="pinkmaid"
                      className="flex-1 min-w-0 bg-white dark:bg-black/40 border border-black/15 dark:border-white/15 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent,#55d2f6)] text-neutral-900 dark:text-white"
                      title="Outfit code (optional, e.g. pinkmaid, redhoodie, or leave blank for default)"
                    />
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">_vrm1.vrm</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchRemoteModel}
                    disabled={isFetchingRemoteModel}
                    className="w-full py-1.5 px-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                    style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
                  >
                    {isFetchingRemoteModel ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Fetching Model...</span>
                      </>
                    ) : (
                      <>
                        <Box className="w-3.5 h-3.5" />
                        <span>Fetch & Load VRM</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Animation Remote Fetcher: "mixamo_" [] ".fbx" */}
                <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block">
                    Remote Motion
                  </span>
                  <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.05] p-1.5 rounded-lg text-xs font-mono border border-black/5 dark:border-white/5">
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">mixamo_</span>
                    <input
                      type="text"
                      value={remoteAnimName}
                      onChange={(e) => setRemoteAnimName(e.target.value)}
                      placeholder="dance"
                      className="flex-1 min-w-0 bg-white dark:bg-black/40 border border-black/15 dark:border-white/15 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent,#55d2f6)] text-neutral-900 dark:text-white"
                      title="Mixamo animation name (e.g. dance, wave, walk, idle, wait)"
                    />
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">.fbx</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchRemoteAnimation}
                    disabled={isFetchingRemoteAnim}
                    className="w-full py-1.5 px-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                    style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
                  >
                    {isFetchingRemoteAnim ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Fetching Motion...</span>
                      </>
                    ) : (
                      <>
                        <Film className="w-3.5 h-3.5" />
                        <span>Fetch & Loop Motion</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Karaoke Subtitles Overlay (Exact same component from /chat 3D mode) */}
      {showSubtitles && (
        <div className="absolute bottom-28 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <VRMSubtitles
            isActive={subtitleState.isActive}
            text={subtitleState.text}
            charIndex={subtitleState.charIndex}
            currentWord={subtitleState.currentWord}
          />
        </div>
      )}

      {/* Minimal Bottom Timeline Bar */}
      {isScriptEditorOpen && (
        <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-center">
          <div className="w-full max-w-4xl p-2.5 sm:p-3 rounded-2xl backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-2xl flex items-center gap-2.5 overflow-hidden bg-white/90 dark:bg-[#13151f]/90">
            {/* Play / Stop Button */}
            {!isPlaying ? (
              <button
                onClick={handlePlayTimeline}
                className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md active:scale-95 transition-all cursor-pointer"
                style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
                title="Play script sequentially"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
              </button>
            ) : (
              <button
                onClick={handleStopPlayback}
                className="w-11 h-11 rounded-xl flex items-center justify-center bg-red-500 hover:bg-red-600 text-white shrink-0 shadow-md active:scale-95 transition-all cursor-pointer"
                title="Stop playback"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            )}

            {/* Horizontally Scrollable Steps List */}
            <div
              ref={timelineScrollRef}
              className="flex-1 flex items-center gap-2 overflow-x-auto py-1 scroll-smooth"
            >
              {cues.map((cue, idx) => {
                const isStepActive = isPlaying && activePlayingIndex === idx;
                const selectedAnim = animations.find((a) => a.key === cue.animationKey) || animations[0];
                return (
                  <div
                    key={cue.id}
                    className={`w-64 sm:w-72 shrink-0 p-2.5 rounded-xl border flex flex-col gap-2 transition-all ${
                      isStepActive
                        ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.1))] ring-2 ring-[var(--theme-accent,#55d2f6)]'
                        : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-neutral-500 dark:text-neutral-400">
                        #{idx + 1}
                      </span>

                      <button
                        onClick={() => handleDeleteStep(cue.id)}
                        className="p-1 rounded text-neutral-400 hover:text-red-500 transition-colors cursor-pointer"
                        title="Remove step"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* 2 Slots: Slot 1 Motion (Pop-up Modal Trigger), Slot 2 Emotion */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      {/* Slot 1: Motion Pop-up Modal Trigger Button */}
                      <button
                        type="button"
                        onClick={() => openAnimationModalForCue(cue.id)}
                        className="flex items-center justify-between gap-1 px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] border border-black/5 dark:border-white/5 hover:border-[var(--theme-accent,#55d2f6)] min-w-0 cursor-pointer transition-all text-left"
                        title="Slot 1: Click to choose Character Motion"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-neutral-400 shrink-0">1:</span>
                          <span className="text-[11px] font-semibold text-[var(--theme-accent,#55d2f6)] truncate">
                            {selectedAnim?.name || cue.animationKey}
                          </span>
                        </div>
                        <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                      </button>

                      {/* Slot 2: Emotion */}
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 min-w-0">
                        <span className="text-[10px] font-mono font-bold text-neutral-400 shrink-0">2:</span>
                        <select
                          value={cue.emotionKey || 'neutral'}
                          onChange={(e) => {
                            handleUpdateStep(cue.id, { emotionKey: e.target.value });
                            applyEmotionByKey(e.target.value);
                          }}
                          className="w-full bg-transparent text-[11px] font-semibold text-rose-500 dark:text-rose-400 focus:outline-none cursor-pointer truncate"
                          title="Slot 2: Facial Emotion / Expression"
                        >
                          {ACT_EMOTIONS.map((emo) => (
                            <option key={emo.key} value={emo.key}>
                              {emo.emoji} {emo.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Optional Script Input */}
                    <input
                      type="text"
                      value={cue.text}
                      onChange={(e) => handleUpdateStep(cue.id, { text: e.target.value })}
                      placeholder="(Optional) Speech text..."
                      className="w-full px-2 py-1.5 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-xs focus:outline-none text-neutral-800 dark:text-neutral-100"
                    />
                  </div>
                );
              })}

              {/* Quick Add Step Button */}
              <button
                onClick={handleAddStep}
                className="h-14 px-3 rounded-xl border-2 border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] text-neutral-400 hover:text-[var(--theme-accent,#55d2f6)] flex items-center justify-center gap-1 text-xs font-semibold shrink-0 cursor-pointer transition-all"
                title="Add step"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                <span>Step</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Animation Selector Modal (Replaces Dropdown Menu) */}
      {isAnimModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsAnimModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] rounded-3xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#13151f] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-3 bg-neutral-50/70 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: 'var(--theme-accent-soft, rgba(85,210,246,0.15))',
                    color: 'var(--theme-accent, #55d2f6)',
                  }}
                >
                  <Film className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-bold font-heading text-neutral-900 dark:text-white truncate">
                      {targetCueIndex !== null
                        ? `Select Motion for Step #${targetCueIndex + 1}`
                        : 'Standby Animation Collection'}
                    </h2>
                    <span
                      className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold shrink-0"
                      style={{
                        backgroundColor: 'var(--theme-accent-soft, rgba(85,210,246,0.15))',
                        color: 'var(--theme-accent, #55d2f6)',
                      }}
                    >
                      {animations.length} Motions
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                    {targetCueIndex !== null
                      ? 'Choose a Mixamo FBX animation to assign to this timeline cue and preview on stage.'
                      : 'Click any Mixamo FBX animation below to preview it live on the 3D stage.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsAnimModalOpen(false)}
                className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Category Filter Bar */}
            <div className="p-3.5 sm:px-5 border-b border-black/5 dark:border-white/10 space-y-2.5 bg-white dark:bg-[#13151f]">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={animSearchQuery}
                  onChange={(e) => setAnimSearchQuery(e.target.value)}
                  placeholder="Search animations by name or filename (e.g. dance, sit, jump, mixamo_...)..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl text-xs bg-black/[0.04] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:border-[var(--theme-accent,#55d2f6)] text-neutral-900 dark:text-white"
                  autoFocus
                />
                {animSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setAnimSearchQuery('')}
                    className="absolute right-2.5 p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                {(['all', 'standby', 'emote', 'dance', 'action', 'pose', 'dramatic', ...(animations.some((a) => a.isCustom) ? ['custom'] : [])] as const).map(
                  (cat) => {
                    const isActiveCat = animCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setAnimCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                          isActiveCat
                            ? 'text-white font-semibold shadow-xs'
                            : 'bg-black/[0.04] dark:bg-white/[0.05] text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.08] dark:hover:bg-white/[0.09]'
                        }`}
                        style={
                          isActiveCat
                            ? { backgroundColor: 'var(--theme-accent, #55d2f6)' }
                            : undefined
                        }
                      >
                        {CATEGORY_LABELS[cat] || cat}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Scrollable Animations Grid */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-5">
              {filteredModalAnimations.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-neutral-400 mx-auto" />
                  <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    No animations match &ldquo;{animSearchQuery}&rdquo;
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {filteredModalAnimations.map((anim) => {
                    const isSelected = currentSelectedModalAnimKey === anim.key;
                    const isThisLoading = loadingAnimKey === anim.key;
                    const catLabel = anim.isCustom
                      ? 'Custom'
                      : CATEGORY_LABELS[anim.category || 'standby'] || 'Standby';

                    return (
                      <button
                        key={anim.key}
                        type="button"
                        onClick={() => {
                          if (animModalTargetCueId) {
                            handleUpdateStep(animModalTargetCueId, { animationKey: anim.key });
                            playAnimationByKey(anim.key);
                            setIsAnimModalOpen(false);
                          } else {
                            handleToggleOrPlayAnimation(anim.key);
                          }
                        }}
                        className={`group p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 cursor-pointer ${
                          isSelected
                            ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.12))] ring-2 ring-[var(--theme-accent,#55d2f6)] shadow-xs'
                            : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-neutral-400 dark:hover:border-neutral-600 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5 w-full">
                          <div className="min-w-0">
                            <span className="block text-xs font-bold text-neutral-900 dark:text-white truncate">
                              {anim.name}
                            </span>
                            <span className="block text-[10px] font-mono text-neutral-400 dark:text-neutral-500 truncate mt-0.5">
                              {anim.fileName || `${anim.key}.fbx`}
                            </span>
                          </div>

                          <div className="shrink-0">
                            {isThisLoading ? (
                              <Loader2 className="w-4 h-4 text-[var(--theme-accent,#55d2f6)] animate-spin" />
                            ) : isSelected ? (
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                                style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
                              >
                                <Check className="w-3 h-3 stroke-[3]" />
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-black/5 dark:border-white/5 w-full">
                          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.06] text-neutral-500 dark:text-neutral-400">
                            {catLabel}
                          </span>
                          <span className="text-[10px] font-semibold text-[var(--theme-accent,#55d2f6)] opacity-0 group-hover:opacity-100 transition-opacity">
                            {animModalTargetCueId ? 'Select' : 'Play'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:px-5 border-t border-black/5 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.02] flex items-center justify-between gap-3">
              <label className="py-1.5 px-3 rounded-xl border border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] flex items-center gap-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer transition-all">
                <Upload className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)]" />
                <span>Upload Custom FBX</span>
                <input type="file" accept=".fbx" onChange={handleFbxUpload} className="hidden" />
              </label>

              <button
                type="button"
                onClick={() => setIsAnimModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-xs active:scale-95 transition-all cursor-pointer"
                style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
