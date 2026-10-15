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
  ChevronRight,
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
  Eye,
  EyeOff,
  Users,
  UserPlus,
  Volume2,
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
        values[i] = (values[i] - baseX) * 0.25;
        values[i + 2] = (values[i + 2] - baseZ) * 0.25;
      }
    }
  }
  return clip;
}

/**
 * High-level Actor Model State.
 * Each model has independent identity, position/rotation, active animation/emotion,
 * visibility, and its own independent Script (Timeline Cues).
 */
export interface ActModelItem {
  id: string;
  name: string;
  fileName?: string;
  outfitId?: string;
  isCustom?: boolean;
  visible: boolean;
  activeAnimKey: string;
  activeEmotionKey: string;
  cues: TimelineCue[];
  isPlaying: boolean;
  activePlayingIndex: number | null;
  transform: {
    x: number;
    y: number;
    z: number;
    yawDeg: number;
  };
}

/**
 * Low-level Three.js & Animation Mixers for an individual active VRM on the stage.
 */
interface RuntimeModelInstance {
  id: string;
  rootGroup: THREE.Group;
  selectionRing: THREE.Group;
  vrm: VRM;
  mixer: THREE.AnimationMixer;
  actionsMap: Map<string, THREE.AnimationAction>;
  loadingAnimPromises: Map<string, Promise<THREE.AnimationAction | null>>;
  currentAction: THREE.AnimationAction | null;
  currentEmotionWeights: Record<string, number>;
  proxyColliders: THREE.Mesh[];
  blinkTimer: number;
  nextBlinkTime: number;
  isBlinking: boolean;
  cancelPlayback: boolean;
  timeoutId: NodeJS.Timeout | null;
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

  // Runtime Models Map (id -> RuntimeModelInstance)
  const runtimeModelsRef = useRef<Map<string, RuntimeModelInstance>>(new Map());

  // Multi-Model React State
  const [models, setModels] = useState<ActModelItem[]>([
    {
      id: 'model-1',
      name: 'Hana (Maid)',
      outfitId: 'mint-maid-apron',
      visible: true,
      activeAnimKey: 'idle',
      activeEmotionKey: 'neutral',
      cues: ACT_INITIAL_CUES.map((c) => ({ ...c })),
      isPlaying: false,
      activePlayingIndex: null,
      transform: { x: 0, y: 0, z: 0, yawDeg: 0 },
    },
  ]);
  const [activeModelId, setActiveModelId] = useState<string>('model-1');
  const activeModelIdRef = useRef<string>('model-1');
  useEffect(() => {
    activeModelIdRef.current = activeModelId;
  }, [activeModelId]);

  const activeModel = useMemo(() => {
    return models.find((m) => m.id === activeModelId) || models[0] || null;
  }, [models, activeModelId]);

  // Viewport Interaction Toolbar: Camera Movement vs. Model Movement (Local Space)
  const [interactionMode, setInteractionMode] = useState<'camera' | 'model'>('camera');
  const interactionModeRef = useRef<'camera' | 'model'>('camera');
  const [modelMoveSubMode, setModelMoveSubMode] = useState<'xy' | 'xz' | 'rotate'>('xy');
  const modelMoveSubModeRef = useRef<'xy' | 'xz' | 'rotate'>('xy');
  const isDraggingModelRef = useRef<boolean>(false);

  // Side Toolbars expansion states
  const [isRailExpanded, setIsRailExpanded] = useState<boolean>(true); // Left toolbar
  const [isRightToolbarExpanded, setIsRightToolbarExpanded] = useState<boolean>(true); // Right Multi-Model toolbar
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState<boolean>(true);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [autoplayOnClose, setAutoplayOnClose] = useState<boolean>(false);

  // Animation Library State
  const [animations, setAnimations] = useState<AnimationItem[]>(KNOWN_ANIMATIONS);
  const animationsRef = useRef<AnimationItem[]>(KNOWN_ANIMATIONS);
  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingAnimKey, setLoadingAnimKey] = useState<string | null>(null);

  // Pop-up Animation Selector Modal State
  const [isAnimModalOpen, setIsAnimModalOpen] = useState<boolean>(false);
  const [animModalTargetCueId, setAnimModalTargetCueId] = useState<string | null>(null);
  const [animSearchQuery, setAnimSearchQuery] = useState<string>('');
  const [animCategoryFilter, setAnimCategoryFilter] = useState<string>('all');

  // Add Model Preset Modal / Popover
  const [isAddOutfitModalOpen, setIsAddOutfitModalOpen] = useState<boolean>(false);

  // Force Test (Invisible forcefield / pressure physics)
  const [isForceTestActive, setIsForceTestActive] = useState<boolean>(false);
  const isForceTestActiveRef = useRef<boolean>(false);
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

  // Subtitles & Voice Engine state
  const [subtitleState, setSubtitleState] = useState<{
    isActive: boolean;
    text: string;
    speakerName?: string;
    charIndex: number;
    currentWord: string;
  }>({
    isActive: false,
    text: '',
    speakerName: '',
    charIndex: 0,
    currentWord: '',
  });

  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Synchronize selection rings visibility when interactionMode or activeModelId changes
  useEffect(() => {
    interactionModeRef.current = interactionMode;
    if (controlsRef.current) {
      controlsRef.current.enabled = interactionMode === 'camera' && !isForceTestActiveRef.current;
    }
    runtimeModelsRef.current.forEach((rm, id) => {
      const isTarget = id === activeModelId && interactionMode === 'model';
      const isModelVisible = models.find((m) => m.id === id)?.visible ?? true;
      rm.selectionRing.visible = isTarget && isModelVisible;
    });
  }, [interactionMode, activeModelId, models]);

  useEffect(() => {
    modelMoveSubModeRef.current = modelMoveSubMode;
  }, [modelMoveSubMode]);

  useEffect(() => {
    isForceTestActiveRef.current = isForceTestActive;
    if (!isForceTestActive) {
      if (forceIndicatorRef.current) forceIndicatorRef.current.visible = false;
      if (controlsRef.current) {
        controlsRef.current.enabled = interactionModeRef.current === 'camera';
      }
    }
  }, [isForceTestActive]);

  // ----------------------------------------------------
  // Animation Loading for a Specific Model
  // ----------------------------------------------------
  const ensureAnimationActionForModel = useCallback(
    async (
      modelId: string,
      key: string,
      loop = true
    ): Promise<THREE.AnimationAction | null> => {
      const rm = runtimeModelsRef.current.get(modelId);
      if (!rm || !rm.mixer || !rm.vrm) return null;

      const existing = rm.actionsMap.get(key);
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

      const inFlight = rm.loadingAnimPromises.get(key);
      if (inFlight) return inFlight;

      const animItem = animationsRef.current.find((a) => a.key === key);
      if (!animItem) {
        return rm.actionsMap.get('idle') || null;
      }

      if (animItem.clip) {
        const action = rm.mixer.clipAction(animItem.clip);
        if (loop) {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        } else {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        rm.actionsMap.set(key, action);
        return action;
      }

      const loadPromise = (async (): Promise<THREE.AnimationAction | null> => {
        if (!animItem.candidateUrls || animItem.candidateUrls.length === 0) {
          return rm.actionsMap.get('idle') || null;
        }
        for (const url of animItem.candidateUrls) {
          try {
            const rawClip = await retargetAnimationFromUrl(url, rm.vrm);
            if (rawClip && runtimeModelsRef.current.get(modelId) === rm) {
              const clip = localizeAnimationClip(rawClip);
              animItem.clip = clip;
              const action = rm.mixer.clipAction(clip);
              if (loop) {
                action.setLoop(THREE.LoopRepeat, Infinity);
                action.clampWhenFinished = false;
              } else {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              }
              rm.actionsMap.set(key, action);
              return action;
            }
          } catch {
            // Try next candidate
          }
        }
        return rm.actionsMap.get('idle') || null;
      })();

      rm.loadingAnimPromises.set(key, loadPromise);
      try {
        return await loadPromise;
      } finally {
        rm.loadingAnimPromises.delete(key);
      }
    },
    []
  );

  const playAnimationForModel = useCallback(
    async (modelId: string, key: string, crossFadeDuration = 0.35, loop = true) => {
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, activeAnimKey: key } : m))
      );
      const rm = runtimeModelsRef.current.get(modelId);
      if (!rm || !rm.mixer) return;

      let targetAction = rm.actionsMap.get(key) || null;
      if (!targetAction) {
        if (modelId === activeModelIdRef.current) {
          setLoadingAnimKey(key);
        }
        targetAction = await ensureAnimationActionForModel(modelId, key, loop);
        if (modelId === activeModelIdRef.current) {
          setLoadingAnimKey((p) => (p === key ? null : p));
        }
      }

      if (!targetAction) {
        targetAction = rm.actionsMap.get('idle') || null;
      }
      if (!targetAction) return;

      if (loop) {
        targetAction.setLoop(THREE.LoopRepeat, Infinity);
        targetAction.clampWhenFinished = false;
      } else {
        targetAction.setLoop(THREE.LoopOnce, 1);
        targetAction.clampWhenFinished = true;
      }

      const prevAction = rm.currentAction;
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
      rm.currentAction = targetAction;
    },
    [ensureAnimationActionForModel]
  );

  const stopAnimationForModelToRestPose = useCallback((modelId: string, crossFadeDuration = 0.25) => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, activeAnimKey: 'none' } : m))
    );
    const rm = runtimeModelsRef.current.get(modelId);
    if (!rm) return;

    if (rm.currentAction) {
      rm.currentAction.fadeOut(crossFadeDuration);
      setTimeout(() => {
        rm.currentAction?.stop();
        rm.currentAction = null;
      }, crossFadeDuration * 1000);
    }

    if (rm.mixer) {
      rm.mixer.stopAllAction();
    }

    if (rm.vrm?.humanoid) {
      const allBoneNames = [
        'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
        'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
        'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
        'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
        'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
      ];
      for (const bName of allBoneNames) {
        const normNode = rm.vrm.humanoid.getNormalizedBoneNode(bName as any);
        if (normNode) {
          normNode.quaternion.identity();
          normNode.position.set(0, 0, 0);
        }
        const rawNode = rm.vrm.humanoid.getRawBoneNode(bName as any);
        if (rawNode) {
          rawNode.quaternion.identity();
        }
      }
      rm.vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);
      rm.vrm.scene.rotation.set(0, 0, 0);
      rm.vrm.scene.updateMatrixWorld(true);
    }
  }, []);

  const handleToggleOrPlayAnimation = useCallback(
    (key: string) => {
      const activeId = activeModelIdRef.current;
      const cur = models.find((m) => m.id === activeId);
      if (cur?.activeAnimKey === key) {
        stopAnimationForModelToRestPose(activeId);
      } else {
        playAnimationForModel(activeId, key, 0.35, true);
      }
    },
    [models, stopAnimationForModelToRestPose, playAnimationForModel]
  );

  const applyEmotionForModel = useCallback((modelId: string, emotionKey: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, activeEmotionKey: emotionKey } : m))
    );
  }, []);

  // ----------------------------------------------------
  // Speech Playback Helper
  // ----------------------------------------------------
  const speakTextPrompt = (text: string, speakerName?: string): Promise<void> => {
    return new Promise(async (resolve) => {
      if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
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
          speakerName,
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
          speakerName,
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
  // Play Script for a Specific Model (Independent Execution!)
  // ----------------------------------------------------
  const handlePlayModelScript = async (modelId: string) => {
    const targetModel = models.find((m) => m.id === modelId);
    if (!targetModel || targetModel.cues.length === 0) return;

    const rm = runtimeModelsRef.current.get(modelId);
    if (rm) rm.cancelPlayback = false;

    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? { ...m, isPlaying: true, activePlayingIndex: 0 } : m
      )
    );

    const cues = targetModel.cues;
    for (let i = 0; i < cues.length; i++) {
      if (rm?.cancelPlayback) break;

      const cue = cues[i];
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId ? { ...m, activePlayingIndex: i } : m
        )
      );

      // Scroll timeline if this is active model
      if (modelId === activeModelIdRef.current && timelineScrollRef.current) {
        const card = timelineScrollRef.current.children[i] as HTMLElement;
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

      // 1. Play motion
      const animKey = cue.animationKey || 'idle';
      await playAnimationForModel(modelId, animKey);
      if (rm?.cancelPlayback) break;

      // 2. Apply facial emotion
      const emoKey = cue.emotionKey || 'neutral';
      applyEmotionForModel(modelId, emoKey);

      // 3. Spoken script
      const hasScript = Boolean(cue.text && cue.text.trim().length > 0);
      if (hasScript) {
        await speakTextPrompt(cue.text, targetModel.name);
        await new Promise((r) => setTimeout(r, 400));
      } else {
        const durationMs = Math.max(1, (cue.durationSec || 3.5) * 1000);
        await new Promise((resolve) => {
          if (rm) {
            rm.timeoutId = setTimeout(resolve, durationMs);
          } else {
            setTimeout(resolve, durationMs);
          }
        });
      }
    }

    handleStopModelScript(modelId);
  };

  const handleStopModelScript = (modelId: string) => {
    const rm = runtimeModelsRef.current.get(modelId);
    if (rm) {
      rm.cancelPlayback = true;
      if (rm.timeoutId) clearTimeout(rm.timeoutId);
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    lipSyncManager.endSpeech();

    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId ? { ...m, isPlaying: false, activePlayingIndex: null } : m
      )
    );
    setSubtitleState((prev) => ({ ...prev, isActive: false }));
    playAnimationForModel(modelId, 'idle');
    applyEmotionForModel(modelId, 'neutral');
  };

  const handleStopAllScripts = () => {
    models.forEach((m) => {
      handleStopModelScript(m.id);
    });
  };

  const handlePlayAllScriptsSimultaneously = () => {
    models.filter((m) => m.visible).forEach((m) => {
      handlePlayModelScript(m.id);
    });
  };

  // ----------------------------------------------------
  // Helper to Build VRM Scene & Attach Components
  // ----------------------------------------------------
  const instantiateVrmInstance = async (
    id: string,
    vrm: VRM,
    initialOffset = new THREE.Vector3(0, 0, 0),
    initialYaw = 0
  ): Promise<RuntimeModelInstance> => {
    const scene = sceneRef.current;
    if (!scene) throw new Error('Scene not ready');

    vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);
    vrm.scene.rotation.set(0, 0, 0);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    // Model Root Group for independent local/world positioning
    const rootGroup = new THREE.Group();
    rootGroup.name = `ActModelRootGroup_${id}`;
    rootGroup.position.copy(initialOffset);
    rootGroup.rotation.y = initialYaw;
    rootGroup.add(vrm.scene);
    scene.add(rootGroup);

    // Selection Ring Gizmo under the model's feet
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

    selectionRingGroup.visible =
      id === activeModelIdRef.current && interactionModeRef.current === 'model';
    rootGroup.add(selectionRingGroup);

    // Proxy Colliders for raycast & hit detection
    const proxyColliders: THREE.Mesh[] = [];
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
          mesh.userData = { modelId: id, boneName: def.boneName, boneNode };
          boneNode.add(mesh);
          proxyColliders.push(mesh);
        }
      }
    }

    const mixer = new THREE.AnimationMixer(vrm.scene);
    const rm: RuntimeModelInstance = {
      id,
      rootGroup,
      selectionRing: selectionRingGroup,
      vrm,
      mixer,
      actionsMap: new Map(),
      loadingAnimPromises: new Map(),
      currentAction: null,
      currentEmotionWeights: {},
      proxyColliders,
      blinkTimer: 0,
      nextBlinkTime: 2.0 + Math.random() * 2.0,
      isBlinking: false,
      cancelPlayback: false,
      timeoutId: null,
    };

    runtimeModelsRef.current.set(id, rm);

    // Load default idle animation
    ensureAnimationActionForModel(id, 'idle').then((action) => {
      if (action) {
        action.play();
        rm.currentAction = action;
      }
    });

    return rm;
  };

  // ----------------------------------------------------
  // Add a New Model from VRM ArrayBuffer
  // ----------------------------------------------------
  const addNewModelFromBuffer = async (
    name: string,
    buffer: ArrayBuffer,
    fileName?: string,
    outfitId?: string
  ): Promise<string> => {
    setIsLoading(true);
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      gltfLoader.parse(
        buffer,
        '',
        async (gltf) => {
          const vrm = gltf.userData.vrm as VRM;
          if (!vrm) {
            setIsLoading(false);
            return reject(new Error('Invalid VRM asset'));
          }

          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          try {
            VRMUtils.rotateVRM0(vrm);
          } catch {}

          const newId = `model-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const currentCount = runtimeModelsRef.current.size;

          // Stagger placement on X axis so characters stand side-by-side
          const xOffset =
            currentCount === 0
              ? 0
              : (currentCount % 2 === 1 ? 1 : -1) * 0.75 * Math.ceil(currentCount / 2);

          const initialPos = new THREE.Vector3(xOffset, 0, 0);
          await instantiateVrmInstance(newId, vrm, initialPos, 0);

          const newModelItem: ActModelItem = {
            id: newId,
            name,
            fileName: fileName || `${name}.vrm`,
            outfitId,
            isCustom: !outfitId,
            visible: true,
            activeAnimKey: 'idle',
            activeEmotionKey: 'neutral',
            cues: [
              {
                id: `cue_${Date.now()}_1`,
                name: 'Intro Step',
                text: `Hello! I am ${name}, ready to act on stage!`,
                animationKey: 'wave',
                emotionKey: 'happy',
                durationSec: 3.5,
              },
              {
                id: `cue_${Date.now()}_2`,
                name: 'Standby',
                text: '',
                animationKey: 'dance',
                emotionKey: 'fun',
                durationSec: 4.0,
              },
            ],
            isPlaying: false,
            activePlayingIndex: null,
            transform: {
              x: Number(xOffset.toFixed(2)),
              y: 0,
              z: 0,
              yawDeg: 0,
            },
          };

          setModels((prev) => [...prev, newModelItem]);
          setActiveModelId(newId);
          setIsLoading(false);
          resolve(newId);
        },
        (err) => {
          setIsLoading(false);
          reject(err);
        }
      );
    });
  };

  // ----------------------------------------------------
  // Add a New Model from Preset Outfit
  // ----------------------------------------------------
  const handleAddPresetModel = async (outfitId: string) => {
    setIsAddOutfitModalOpen(false);
    setIsLoading(true);
    const outfit = WARDROBE_OUTFITS.find((o) => o.id === outfitId) || WARDROBE_OUTFITS[0];
    const modelUrl = `/api/vrm?file=${encodeURIComponent(outfit.fileName)}`;

    try {
      const resp = await fetch(modelUrl);
      const buf = resp.ok
        ? await resp.arrayBuffer()
        : await fetch(outfit.modelUrl).then((r) => r.arrayBuffer());

      await addNewModelFromBuffer(
        `Hana (${outfit.name.replace(/Hana\s*/i, '').trim() || outfit.id})`,
        buf,
        outfit.fileName,
        outfit.id
      );
    } catch (err) {
      console.error('Failed to add preset outfit model:', err);
      setIsLoading(false);
    }
  };

  // ----------------------------------------------------
  // Upload Custom VRM -> Adds as a New Independent Model
  // ----------------------------------------------------
  const handleVrmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const cleanName = file.name.replace(/\.vrm$/i, '');
      await addNewModelFromBuffer(cleanName || `Custom Actor ${models.length + 1}`, buf, file.name);
    } catch (err) {
      console.error('VRM upload error:', err);
    } finally {
      e.target.value = '';
    }
  };

  // ----------------------------------------------------
  // Remote Fetcher: Fetch VRM Model -> Adds as a New Independent Model
  // ----------------------------------------------------
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
      } catch {}
    }

    if (buffer) {
      try {
        const actorName = outfit
          ? `Hana (${outfit.charAt(0).toUpperCase() + outfit.slice(1)})`
          : `Hana v${version}`;
        await addNewModelFromBuffer(actorName, buffer, fileName);
        setRemoteStatusMessage(`Successfully added ${fileName} as a new model!`);
      } catch (err) {
        setRemoteStatusMessage(`Failed to parse fetched model ${fileName}`);
      }
    } else {
      setRemoteStatusMessage(`Unable to fetch ${fileName} from remote sources.`);
    }

    setIsFetchingRemoteModel(false);
    setTimeout(() => setRemoteStatusMessage(null), 4000);
  };

  // ----------------------------------------------------
  // Toggle Show / Hide Model
  // ----------------------------------------------------
  const handleToggleModelVisibility = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setModels((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          const nextVis = !m.visible;
          const rm = runtimeModelsRef.current.get(id);
          if (rm) {
            rm.rootGroup.visible = nextVis;
            rm.selectionRing.visible =
              nextVis && id === activeModelIdRef.current && interactionModeRef.current === 'model';
          }
          return { ...m, visible: nextVis };
        }
        return m;
      })
    );
  };

  // ----------------------------------------------------
  // Remove Model from Multi-Model Cast
  // ----------------------------------------------------
  const handleRemoveModel = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const rm = runtimeModelsRef.current.get(id);
    if (rm) {
      handleStopModelScript(id);
      if (rm.rootGroup.parent) {
        rm.rootGroup.parent.remove(rm.rootGroup);
      }
      VRMUtils.deepDispose(rm.vrm.scene);
      runtimeModelsRef.current.delete(id);
    }

    setModels((prev) => {
      const remaining = prev.filter((m) => m.id !== id);
      if (remaining.length === 0) {
        // If user deletes last model, spawn a fresh default model so stage never breaks
        setTimeout(() => {
          const defaultOutfit = WARDROBE_OUTFITS[0];
          fetch(`/api/vrm?file=${encodeURIComponent(defaultOutfit.fileName)}`)
            .then((r) => r.arrayBuffer())
            .then((buf) => {
              addNewModelFromBuffer('Hana (Default)', buf, defaultOutfit.fileName, defaultOutfit.id);
            })
            .catch(() => {});
        }, 100);
      } else if (activeModelId === id) {
        setActiveModelId(remaining[0].id);
      }
      return remaining;
    });
  };

  // ----------------------------------------------------
  // Upload Custom FBX -> Adds Motion to Animation Library
  // ----------------------------------------------------
  const handleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const rm = runtimeModelsRef.current.get(activeModelId);
    if (!file || !rm || !rm.vrm || !rm.mixer) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const fbxLoader = new FBXLoader();
      const fbxGroup = fbxLoader.parse(arrayBuffer, '');
      const rawClip = retargetAnimation(fbxGroup, rm.vrm);
      if (rawClip) {
        const clip = localizeAnimationClip(rawClip);
        const key = `custom_${Date.now()}`;
        const name = file.name.replace(/\.fbx$/i, '');
        const action = rm.mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        rm.actionsMap.set(key, action);

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
        playAnimationForModel(activeModelId, key, 0.35, true);
      }
    } catch (err) {
      console.error('FBX upload error:', err);
    } finally {
      e.target.value = '';
    }
  };

  // ----------------------------------------------------
  // Remote Fetcher: Fetch Mixamo Animation (.fbx)
  // ----------------------------------------------------
  const handleFetchRemoteAnimation = async () => {
    const animName = remoteAnimName.trim() || 'dance';
    const fileName = `mixamo_${animName}.fbx`;
    const rm = runtimeModelsRef.current.get(activeModelId);

    if (!rm || !rm.vrm || !rm.mixer) {
      setRemoteStatusMessage('No active model selected to apply animation to.');
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
      } catch {}
    }

    if (buffer) {
      try {
        const fbxLoader = new FBXLoader();
        const fbxGroup = fbxLoader.parse(buffer, '');
        const rawClip = retargetAnimation(fbxGroup, rm.vrm);
        if (rawClip) {
          const clip = localizeAnimationClip(rawClip);
          const key = `remote_${animName}_${Date.now()}`;
          const action = rm.mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          rm.actionsMap.set(key, action);

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
          await playAnimationForModel(activeModelId, key, 0.35, true);
          setRemoteStatusMessage(`Playing ${fileName} in loop on ${activeModel?.name}`);
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

  // Reset Model Transform
  const handleResetActiveModelTransform = useCallback(() => {
    const rm = runtimeModelsRef.current.get(activeModelIdRef.current);
    if (rm) {
      rm.rootGroup.position.set(0, 0, 0);
      rm.rootGroup.rotation.set(0, 0, 0);
      rm.rootGroup.updateMatrixWorld(true);
    }
    setModels((prev) =>
      prev.map((m) =>
        m.id === activeModelIdRef.current
          ? { ...m, transform: { x: 0, y: 0, z: 0, yawDeg: 0 } }
          : m
      )
    );
  }, []);

  // ----------------------------------------------------
  // Timeline Step Operations (Active Model's Independent Script)
  // ----------------------------------------------------
  const handleAddStep = () => {
    if (!activeModel) return;
    const newCue: TimelineCue = {
      id: `cue_${Date.now()}`,
      name: `Step ${activeModel.cues.length + 1}`,
      text: '',
      animationKey: 'idle',
      emotionKey: 'happy',
      durationSec: 3.5,
    };
    setModels((prev) =>
      prev.map((m) => (m.id === activeModelId ? { ...m, cues: [...m.cues, newCue] } : m))
    );
  };

  const handleDeleteStep = (cueId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === activeModelId
          ? { ...m, cues: m.cues.filter((c) => c.id !== cueId) }
          : m
      )
    );
  };

  const handleUpdateStep = (cueId: string, updates: Partial<TimelineCue>) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === activeModelId
          ? {
              ...m,
              cues: m.cues.map((c) => (c.id === cueId ? { ...c, ...updates } : c)),
            }
          : m
      )
    );
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
    if (!animModalTargetCueId || !activeModel) return null;
    const idx = activeModel.cues.findIndex((c) => c.id === animModalTargetCueId);
    return idx >= 0 ? idx : null;
  }, [animModalTargetCueId, activeModel]);

  const currentSelectedModalAnimKey = useMemo(() => {
    if (animModalTargetCueId && activeModel) {
      const cue = activeModel.cues.find((c) => c.id === animModalTargetCueId);
      return cue?.animationKey || 'idle';
    }
    return activeModel?.activeAnimKey || 'idle';
  }, [animModalTargetCueId, activeModel]);

  // ----------------------------------------------------
  // Three.js Stage, Lighting, Interactions & Multi-Model Render Loop
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
      0.001,
      10000.0
    );
    camera.position.set(0.0, 1.2, 2.4);
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
    // Unconstrained zoom and full 360 degree camera angles without any limits
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1.5, 2.5, 2.0);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.65);
    fillLight.position.set(-1.5, 1.5, 1.5);
    scene.add(fillLight);

    // Floor Grid
    const grid = new THREE.GridHelper(10, 20, 0x55d2f6, 0x94a3b8);
    grid.position.y = -0.16;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    scene.add(grid);

    // Force Test Visual Indicator
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

    // Raycasters & Dragging math
    const raycaster = new THREE.Raycaster();
    const modelDragPlane = new THREE.Plane();
    const dragStartPlaneHit = new THREE.Vector3();
    let hasValidStartPlaneHit = false;
    const dragStartModelPos = new THREE.Vector3();
    let dragStartYaw = 0;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragButton = 0;

    const syncModelTransformToState = (rm: RuntimeModelInstance) => {
      const p = rm.rootGroup.position;
      const r = rm.rootGroup.rotation;
      setModels((prev) =>
        prev.map((m) =>
          m.id === rm.id
            ? {
                ...m,
                transform: {
                  x: Number(p.x.toFixed(2)),
                  y: Number(p.y.toFixed(2)),
                  z: Number(p.z.toFixed(2)),
                  yawDeg: Math.round((r.y * 180) / Math.PI),
                },
              }
            : m
        )
      );
    };

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

      if (cameraRef.current) {
        raycaster.setFromCamera(
          new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
          cameraRef.current
        );

        // Raycast against all visible models' proxy colliders to allow clicking on a model to select it!
        const allColliders: THREE.Mesh[] = [];
        runtimeModelsRef.current.forEach((rm) => {
          if (rm.rootGroup.visible) {
            allColliders.push(...rm.proxyColliders);
          }
        });

        const hits = raycaster.intersectObjects(allColliders, false);
        if (hits.length > 0) {
          const hitModelId = hits[0].object.userData.modelId as string;
          if (hitModelId && hitModelId !== activeModelIdRef.current) {
            setActiveModelId(hitModelId);
          }
        }
      }

      const activeRm = runtimeModelsRef.current.get(activeModelIdRef.current);
      if (interactionModeRef.current === 'model' && activeRm && cameraRef.current) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        isDraggingModelRef.current = true;
        dragButton = e.button;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        dragStartModelPos.copy(activeRm.rootGroup.position);
        dragStartYaw = activeRm.rootGroup.rotation.y;

        raycaster.setFromCamera(
          new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
          cameraRef.current
        );

        const subMode = modelMoveSubModeRef.current;
        if (subMode === 'xy') {
          const camDir = new THREE.Vector3();
          cameraRef.current.getWorldDirection(camDir).negate();
          const anchor = activeRm.rootGroup.position.clone().add(new THREE.Vector3(0, 0.85, 0));
          modelDragPlane.setFromNormalAndCoplanarPoint(camDir, anchor);
          hasValidStartPlaneHit = Boolean(
            raycaster.ray.intersectPlane(modelDragPlane, dragStartPlaneHit)
          );
        } else if (subMode === 'xz') {
          modelDragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            activeRm.rootGroup.position
          );
          hasValidStartPlaneHit =
            Math.abs(raycaster.ray.direction.y) > 0.16 &&
            Boolean(raycaster.ray.intersectPlane(modelDragPlane, dragStartPlaneHit));
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
      if (isForceTestActiveRef.current) return;

      const activeRm = runtimeModelsRef.current.get(activeModelIdRef.current);
      if (
        isDraggingModelRef.current &&
        interactionModeRef.current === 'model' &&
        activeRm &&
        cameraRef.current
      ) {
        const subMode = modelMoveSubModeRef.current;
        const isRotateAction = dragButton === 2 || e.shiftKey || subMode === 'rotate';

        if (isRotateAction) {
          const deltaX = e.clientX - dragStartClientX;
          activeRm.rootGroup.rotation.y = dragStartYaw + deltaX * 0.012;
        } else if (subMode === 'xy' && hasValidStartPlaneHit) {
          raycaster.setFromCamera(
            new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
            cameraRef.current
          );
          const currentHit = new THREE.Vector3();
          if (raycaster.ray.intersectPlane(modelDragPlane, currentHit)) {
            const offset = currentHit.sub(dragStartPlaneHit);
            activeRm.rootGroup.position.copy(dragStartModelPos).add(offset);
          }
        } else if (subMode === 'xz') {
          raycaster.setFromCamera(
            new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
            cameraRef.current
          );
          const currentHit = new THREE.Vector3();
          if (
            hasValidStartPlaneHit &&
            Math.abs(raycaster.ray.direction.y) > 0.16 &&
            raycaster.ray.intersectPlane(modelDragPlane, currentHit)
          ) {
            const offset = currentHit.sub(dragStartPlaneHit);
            if (offset.length() < 12.0) {
              activeRm.rootGroup.position.set(
                dragStartModelPos.x + offset.x,
                dragStartModelPos.y,
                dragStartModelPos.z + offset.z
              );
            }
          } else {
            const dx = (e.clientX - dragStartClientX) * 0.0045;
            const dy = (e.clientY - dragStartClientY) * 0.0045;
            const camForward = new THREE.Vector3();
            cameraRef.current.getWorldDirection(camForward);
            camForward.y = 0;
            if (camForward.lengthSq() > 0.0001) camForward.normalize();
            else camForward.set(0, 0, -1);
            const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

            activeRm.rootGroup.position.set(
              dragStartModelPos.x + camRight.x * dx - camForward.x * dy,
              dragStartModelPos.y,
              dragStartModelPos.z + camRight.z * dx - camForward.z * dy
            );
          }
        }

        activeRm.rootGroup.updateMatrixWorld(true);
        syncModelTransformToState(activeRm);
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
      const activeRm = runtimeModelsRef.current.get(activeModelIdRef.current);
      if (
        interactionModeRef.current === 'model' &&
        !isForceTestActiveRef.current &&
        activeRm
      ) {
        e.preventDefault();
        const step = -Math.sign(e.deltaY) * 0.08;
        const subMode = modelMoveSubModeRef.current;
        if (subMode === 'rotate') {
          activeRm.rootGroup.rotation.y += step * 1.5;
        } else if (subMode === 'xz') {
          activeRm.rootGroup.position.y += step;
        } else {
          activeRm.rootGroup.position.z += step;
        }
        activeRm.rootGroup.updateMatrixWorld(true);
        syncModelTransformToState(activeRm);
      }
    };

    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Load initial default model
    const initialOutfit = WARDROBE_OUTFITS[0];
    const initialUrl = `/api/vrm?file=${encodeURIComponent(initialOutfit.fileName)}`;
    fetch(initialUrl)
      .then((r) => (r.ok ? r.arrayBuffer() : fetch(initialOutfit.modelUrl).then((res) => res.arrayBuffer())))
      .then((buf) => {
        if (!isDisposed) {
          const gltfLoader = new GLTFLoader();
          gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
          gltfLoader.parse(buf, '', async (gltf) => {
            const vrm = gltf.userData.vrm as VRM;
            if (!vrm || isDisposed) return;
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.combineSkeletons(gltf.scene);
            try {
              VRMUtils.rotateVRM0(vrm);
            } catch {}
            await instantiateVrmInstance('model-1', vrm, new THREE.Vector3(0, 0, 0), 0);
            setIsLoading(false);
          });
        }
      })
      .catch(() => setIsLoading(false));

    const clock = new THREE.Clock();

    // ----------------------------------------------------
    // Unified Multi-Model Render Loop
    // ----------------------------------------------------
    const animate = () => {
      if (isDisposed) return;
      rafId = requestAnimationFrame(animate);

      const delta = clock.getDelta();
      if (controls.enabled) {
        controls.update();
      }

      // Collect all proxy colliders for raycasting
      const allActiveColliders: THREE.Mesh[] = [];

      // Update all active models
      runtimeModelsRef.current.forEach((rm, modelId) => {
        if (!rm.rootGroup.visible) return;

        allActiveColliders.push(...rm.proxyColliders);

        // 1. Animation mixer update
        if (rm.mixer) {
          rm.mixer.update(delta);
        }

        rm.rootGroup.updateMatrixWorld(true);
        rm.vrm.scene.updateMatrixWorld(true);

        // 2. Look at camera per model (relative to character head world coordinate)
        if (lookAtCameraRef.current && rm.vrm.humanoid && cameraRef.current) {
          const head = rm.vrm.humanoid.getNormalizedBoneNode('head');
          const neck = rm.vrm.humanoid.getNormalizedBoneNode('neck');

          if (head) {
            const headWorldPos = new THREE.Vector3();
            head.getWorldPosition(headWorldPos);

            const toCamWorld = cameraRef.current.position.clone().sub(headWorldPos).normalize();
            const charQuat = new THREE.Quaternion();
            rm.vrm.scene.getWorldQuaternion(charQuat);

            const localDir = toCamWorld.applyQuaternion(charQuat.clone().invert()).normalize();
            const yaw = Math.atan2(localDir.x, localDir.z);
            const pitch = -Math.atan2(localDir.y, Math.hypot(localDir.x, localDir.z));

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

        // 3. VRM update (computes spring bones, secondary physics, blendshapes)
        rm.vrm.update(delta);

        // 4. Expressions & Visemes & Blinking
        if (rm.vrm.expressionManager) {
          // If this model is currently speaking or is the active model
          const isThisSpeaking = subtitleState.isActive && subtitleState.speakerName === models.find((m) => m.id === modelId)?.name;
          if (isThisSpeaking || modelId === activeModelIdRef.current) {
            const visemes = lipSyncManager.getVisemes();
            rm.vrm.expressionManager.setValue('aa', visemes.aa);
            rm.vrm.expressionManager.setValue('ih', visemes.ih);
            rm.vrm.expressionManager.setValue('ou', visemes.ou);
            rm.vrm.expressionManager.setValue('ee', visemes.ee);
            rm.vrm.expressionManager.setValue('oh', visemes.oh);
          }

          // Active emotion for this model
          const targetEmoKey = models.find((m) => m.id === modelId)?.activeEmotionKey || 'neutral';
          const activeEmo = ACT_EMOTIONS.find((e) => e.key === targetEmoKey) || ACT_EMOTIONS[0];
          const targetBlends = activeEmo.blendValues || {};

          const emotionChannels = [
            'happy', 'joy', 'sad', 'sorrow', 'angry', 'surprised', 'relaxed', 'fun',
            'blinkLeft', 'blinkRight'
          ];

          for (const channel of emotionChannels) {
            const targetVal = targetBlends[channel] || 0;
            const currentVal = rm.currentEmotionWeights[channel] || 0;
            const nextVal = currentVal + (targetVal - currentVal) * Math.min(1, delta * 7.5);
            rm.currentEmotionWeights[channel] = nextVal;
            try {
              rm.vrm.expressionManager.setValue(channel, nextVal);
            } catch {}
          }

          if (activeEmo.key !== 'neutral') {
            try {
              rm.vrm.expressionManager.setValue(activeEmo.key, 1.0);
            } catch {}
          }

          // Natural blinking per character
          rm.blinkTimer += delta;
          if (rm.blinkTimer > rm.nextBlinkTime) {
            rm.isBlinking = true;
            rm.blinkTimer = 0;
            rm.nextBlinkTime = 2.0 + Math.random() * 3.5;
          }

          if (rm.isBlinking) {
            const progress = rm.blinkTimer / 0.18;
            if (progress <= 0.5) {
              rm.vrm.expressionManager.setValue('blink', progress * 2);
            } else if (progress <= 1.0) {
              rm.vrm.expressionManager.setValue('blink', (1.0 - progress) * 2);
            } else {
              rm.vrm.expressionManager.setValue('blink', 0);
              rm.isBlinking = false;
            }
          }
        }
      });

      // 5. Forcefield & Pressure Physics across models
      if (isForceTestActiveRef.current && cameraRef.current && allActiveColliders.length > 0) {
        if (pointerInsideCanvasRef.current || isPointerDownRef.current) {
          raycaster.setFromCamera(
            new THREE.Vector2(pointerNdcRef.current.x, pointerNdcRef.current.y),
            cameraRef.current
          );

          const intersects = raycaster.intersectObjects(allActiveColliders, false);
          const hit = intersects[0];
          const phys = forcePhysicsRef.current;

          if (hit) {
            phys.isContact = true;
            phys.contactPoint.copy(hit.point);

            if (controlsRef.current) {
              controlsRef.current.enabled = false;
            }

            if (forceIndicatorRef.current) {
              forceIndicatorRef.current.position.copy(hit.point);
              const normal = hit.face
                ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
                : new THREE.Vector3(0, 0, 1);
              forceIndicatorRef.current.lookAt(hit.point.clone().add(normal));
              forceIndicatorRef.current.visible = true;
            }

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
            const hitModelId = hit.object.userData.modelId as string;
            const targetRm = runtimeModelsRef.current.get(hitModelId);

            if (hitBone) {
              phys.activeBone = hitBone;
              const pushDirWorld = raycaster.ray.direction
                .clone()
                .multiplyScalar(0.045 + pressure * 0.09);

              if (isPointerDownRef.current && prevHitPointRef.current) {
                const dragVector = hit.point.clone().sub(prevHitPointRef.current);
                pushDirWorld.add(dragVector.multiplyScalar(0.8));
              }
              prevHitPointRef.current = hit.point.clone();

              if (hitBone.parent) {
                const parentInvQuat = new THREE.Quaternion();
                hitBone.parent.getWorldQuaternion(parentInvQuat);
                parentInvQuat.invert();
                phys.targetOffset.copy(pushDirWorld.applyQuaternion(parentInvQuat));
              } else {
                phys.targetOffset.copy(pushDirWorld);
              }

              if (isPointerDownRef.current && targetRm?.vrm.expressionManager) {
                try {
                  targetRm.vrm.expressionManager.setValue('blink', Math.min(0.5, pressure * 0.6));
                  if (pressure > 0.62) {
                    targetRm.vrm.expressionManager.setValue('surprised', 0.32);
                  }
                } catch {}
              }
            }
          } else {
            phys.isContact = false;
            phys.targetOffset.set(0, 0, 0);
            prevHitPointRef.current = null;
            if (forceIndicatorRef.current) forceIndicatorRef.current.visible = false;
            if (controlsRef.current && !isPointerDownRef.current) {
              controlsRef.current.enabled = interactionModeRef.current === 'camera';
            }
          }
        }

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
      runtimeModelsRef.current.forEach((rm) => {
        VRMUtils.deepDispose(rm.vrm.scene);
      });
      runtimeModelsRef.current.clear();
    };
  }, []);

  const hasModelOffset =
    activeModel &&
    (Math.abs(activeModel.transform.x) > 0.01 ||
      Math.abs(activeModel.transform.y) > 0.01 ||
      Math.abs(activeModel.transform.z) > 0.01 ||
      Math.abs(activeModel.transform.yawDeg) > 0);

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
          <span className="text-xs font-mono font-medium">Loading 3D Actors...</span>
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
            title="Grab and move the active 3D model directly (animations play in local space)"
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
              onClick={handleResetActiveModelTransform}
              className="px-2 py-1 rounded-lg bg-neutral-100 dark:bg-white/10 hover:bg-neutral-200 dark:hover:bg-white/15 text-[11px] font-mono font-semibold text-neutral-700 dark:text-neutral-200 flex items-center gap-1 cursor-pointer transition-all"
              title="Reset active model position & rotation"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </div>

        {interactionMode === 'model' && activeModel && (
          <div className="px-2.5 py-1 rounded-xl backdrop-blur-md bg-white/80 dark:bg-[#13151f]/80 border border-black/10 dark:border-white/10 text-[10px] font-mono text-neutral-600 dark:text-neutral-300 flex items-center gap-2 shadow-sm">
            <span className="text-sky-600 dark:text-sky-400 font-semibold truncate max-w-[140px]">
              Active: {activeModel.name}
            </span>
            <span>&bull;</span>
            <span>
              Pos: ({activeModel.transform.x}, {activeModel.transform.y}, {activeModel.transform.z})
            </span>
            <span>&bull;</span>
            <span>Yaw: {activeModel.transform.yawDeg}&deg;</span>
          </div>
        )}
      </div>

      {/* Top Left Floating Control Rail (Stage, Motions, Emotions, Inputs) */}
      <div
        className={`absolute top-4 left-4 z-30 backdrop-blur-md rounded-2xl border border-black/10 dark:border-white/10 shadow-xl transition-all duration-200 pointer-events-auto bg-white/85 dark:bg-[#13151f]/85 ${
          isRailExpanded ? 'w-72 sm:w-80 p-3 max-h-[calc(100vh-2rem)] overflow-y-auto' : 'w-12 p-1.5'
        }`}
      >
        {/* Rail Header */}
        <div className="flex items-center justify-between min-h-[36px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setIsRailExpanded((p) => !p)}
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
              <button
                type="button"
                onClick={() => setIsRailExpanded(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white text-xs font-medium cursor-pointer transition-colors"
                title="Fold up panel"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded Rail Content */}
        {isRailExpanded && (
          <div className="mt-3 space-y-3 text-xs">
            {/* Active Model Indicator */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 text-[11px] text-neutral-600 dark:text-neutral-300">
              <div className="flex items-center gap-2 truncate min-w-0">
                {loadingAnimKey ? (
                  <Loader2 className="w-3 h-3 text-[var(--theme-accent,#55d2f6)] animate-spin shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                )}
                <span className="truncate">
                  Actor: <strong className="text-neutral-900 dark:text-white">{activeModel?.name || 'None'}</strong>
                </span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold shrink-0">
                {models.length} Model{models.length > 1 ? 's' : ''}
              </span>
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
                    onClick={handleResetActiveModelTransform}
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
                  Quick Motions (Active)
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
                      activeModel?.activeAnimKey === anim.key
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
                Quick Emotions (Active)
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {ACT_EMOTIONS.slice(0, 6).map((emo) => (
                  <button
                    key={emo.key}
                    onClick={() => applyEmotionForModel(activeModelId, emo.key)}
                    className={`py-1.5 px-1.5 rounded-xl font-medium text-[11px] truncate border transition-all cursor-pointer ${
                      activeModel?.activeEmotionKey === emo.key
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

            {/* Upload & Add Actor Buttons Row */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-black/5 dark:border-white/5">
              <label className="py-2 px-1 rounded-xl border border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] flex items-center justify-center gap-1 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer transition-all" title="Upload FBX animation">
                <Upload className="w-3 h-3 text-[var(--theme-accent,#55d2f6)]" />
                <span>+ FBX</span>
                <input type="file" accept=".fbx" onChange={handleFbxUpload} className="hidden" />
              </label>

              <label className="py-2 px-1 rounded-xl border border-dashed border-black/15 dark:border-white/15 hover:border-[var(--theme-accent,#55d2f6)] flex items-center justify-center gap-1 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer transition-all" title="Upload VRM to add a new model to stage">
                <Box className="w-3 h-3 text-[var(--theme-accent,#55d2f6)]" />
                <span>+ VRM</span>
                <input type="file" accept=".vrm" onChange={handleVrmUpload} className="hidden" />
              </label>

              <button
                type="button"
                onClick={() => setIsAddOutfitModalOpen(true)}
                className="py-2 px-1 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.07] dark:hover:bg-white/[0.08] text-[10px] font-semibold text-neutral-700 dark:text-neutral-300 flex items-center justify-center gap-1 transition-all cursor-pointer"
                title="Add actor from wardrobe outfits"
              >
                <UserPlus className="w-3 h-3 text-[var(--theme-accent,#55d2f6)]" />
                <span>+ Outfit</span>
              </button>
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

            {/* Force Test Button */}
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

            {/* Checkmark Options Row */}
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

            {/* Remote Fetcher UI Panel */}
            {useRemoteFetcher && (
              <div className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] space-y-2.5">
                {remoteStatusMessage && (
                  <div className="text-[10px] font-mono px-2 py-1 rounded bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-semibold truncate">
                    {remoteStatusMessage}
                  </div>
                )}

                {/* Model Remote Fetcher -> Adds as New Model */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block">
                    Remote Model (+ New Model)
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
                      title="Outfit code"
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
                        <Plus className="w-3.5 h-3.5" />
                        <span>Fetch & Add As New Model</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Animation Remote Fetcher */}
                <div className="space-y-1.5 pt-2 border-t border-black/5 dark:border-white/5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold block">
                    Remote Motion (Active Actor)
                  </span>
                  <div className="flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.05] p-1.5 rounded-lg text-xs font-mono border border-black/5 dark:border-white/5">
                    <span className="text-neutral-500 font-semibold shrink-0 select-none">mixamo_</span>
                    <input
                      type="text"
                      value={remoteAnimName}
                      onChange={(e) => setRemoteAnimName(e.target.value)}
                      placeholder="dance"
                      className="flex-1 min-w-0 bg-white dark:bg-black/40 border border-black/15 dark:border-white/15 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent,#55d2f6)] text-neutral-900 dark:text-white"
                      title="Mixamo animation name"
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

      {/* =================================================================== */}
      {/* Right Floating Multi-Model Toolbar (Mirroring Left Side Toolbar)    */}
      {/* Displays Cast of Models with Show/Hide, Remove, Select, and Scripts */}
      {/* =================================================================== */}
      <div
        className={`absolute top-4 right-4 z-30 backdrop-blur-md rounded-2xl border border-black/10 dark:border-white/10 shadow-xl transition-all duration-200 pointer-events-auto bg-white/85 dark:bg-[#13151f]/85 ${
          isRightToolbarExpanded ? 'w-72 sm:w-80 p-3 max-h-[calc(100vh-2rem)] overflow-y-auto' : 'w-12 p-1.5'
        }`}
      >
        {/* Right Toolbar Header */}
        <div className="flex items-center justify-between min-h-[36px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setIsRightToolbarExpanded((p) => !p)}
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs cursor-pointer border border-black/10 dark:border-white/10 transition-transform active:scale-95 text-white"
              style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
              title={isRightToolbarExpanded ? 'Fold model toolbar' : 'Unfold model toolbar'}
            >
              <Users className="w-5 h-5 text-neutral-950" />
            </button>

            {isRightToolbarExpanded && (
              <div className="min-w-0">
                <h2 className="text-xs font-bold font-heading truncate text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <span>Models & Cast</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-[var(--theme-accent-soft,rgba(85,210,246,0.15))] text-[var(--theme-accent,#55d2f6)] font-bold">
                    {models.length}
                  </span>
                </h2>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 leading-tight truncate">
                  Multi-Actor Management
                </p>
              </div>
            )}
          </div>

          {isRightToolbarExpanded && (
            <button
              type="button"
              onClick={() => setIsRightToolbarExpanded(false)}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white text-xs font-medium cursor-pointer transition-colors"
              title="Fold model toolbar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expanded Right Toolbar Content */}
        {isRightToolbarExpanded && (
          <div className="mt-3 space-y-3 text-xs">

            {/* Batch Play All / Stop All Action Row */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handlePlayAllScriptsSimultaneously}
                className="py-1.5 px-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                title="Play all actors' scripts simultaneously on stage"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Play All Cast</span>
              </button>

              <button
                type="button"
                onClick={handleStopAllScripts}
                className="py-1.5 px-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                title="Stop all acting sequences and return characters to rest pose"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop All</span>
              </button>
            </div>

            {/* List of Models */}
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-0.5">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold px-0.5">
                <span>Stage Actors ({models.length})</span>
                <span>Click to Select</span>
              </div>

              {models.map((model, idx) => {
                const isActive = model.id === activeModelId;
                const isPlayingThis = model.isPlaying;

                return (
                  <div
                    key={model.id}
                    onClick={() => setActiveModelId(model.id)}
                    className={`p-2.5 rounded-2xl border transition-all cursor-pointer relative ${
                      isActive
                        ? 'border-[var(--theme-accent,#55d2f6)] bg-[var(--theme-accent-soft,rgba(85,210,246,0.12))] ring-2 ring-[var(--theme-accent,#55d2f6)]/60 shadow-xs'
                        : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] hover:border-neutral-400 dark:hover:border-neutral-600'
                    } ${!model.visible ? 'opacity-60 grayscale-[35%]' : ''}`}
                  >
                    {/* Header Row: Actor Name + Action Buttons */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 font-mono font-bold text-xs"
                          style={{
                            backgroundColor: isActive
                              ? 'var(--theme-accent, #55d2f6)'
                              : 'rgba(0,0,0,0.06)',
                            color: isActive ? '#000' : 'inherit',
                          }}
                        >
                          #{idx + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-neutral-900 dark:text-white truncate">
                              {model.name}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-md bg-[var(--theme-accent,#55d2f6)] text-neutral-950 font-bold shrink-0">
                                Active
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-neutral-400 font-mono truncate block">
                            Pos: ({model.transform.x}, {model.transform.z})
                          </span>
                        </div>
                      </div>

                      {/* Show/Hide & Remove Options */}
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Play/Stop Script Button for this Model */}
                        <button
                          type="button"
                          onClick={() => {
                            if (isPlayingThis) {
                              handleStopModelScript(model.id);
                            } else {
                              handlePlayModelScript(model.id);
                            }
                          }}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isPlayingThis
                              ? 'bg-red-500/20 text-red-600 hover:bg-red-500/30'
                              : 'text-neutral-500 hover:text-emerald-500 hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                          title={isPlayingThis ? 'Stop script' : 'Play this model\'s independent script'}
                        >
                          {isPlayingThis ? (
                            <Square className="w-3.5 h-3.5 fill-current" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          )}
                        </button>

                        {/* Show / Hide Option */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleModelVisibility(model.id, e)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            model.visible
                              ? 'text-neutral-500 hover:text-neutral-800 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'
                              : 'text-neutral-400 bg-black/10 dark:bg-white/10'
                          }`}
                          title={model.visible ? 'Hide model from 3D stage' : 'Show model on 3D stage'}
                        >
                          {model.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-neutral-400" />
                          )}
                        </button>

                        {/* Remove Option */}
                        <button
                          type="button"
                          onClick={(e) => handleRemoveModel(model.id, e)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Remove model from stage"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Model Details & Script info */}
                    <div className="mt-2 pt-1.5 border-t border-black/5 dark:border-white/5 flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">
                          Motion: <strong>{model.activeAnimKey}</strong>
                        </span>
                        <span>&bull;</span>
                        <span className="truncate">
                          Emotion: <strong>{model.activeEmotionKey}</strong>
                        </span>
                      </div>
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.05] shrink-0">
                        {model.cues.length} Cues
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Preset Outfit Modal (Spawns a new model with chosen outfit) */}
      {isAddOutfitModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsAddOutfitModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#13151f] shadow-2xl p-4 sm:p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[var(--theme-accent,#55d2f6)]" />
                <h3 className="text-sm font-bold font-heading text-neutral-900 dark:text-white">
                  Add Actor from Wardrobe
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOutfitModalOpen(false)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Select an outfit to spawn an additional character onto the 3D stage with its own independent script and animations.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto p-1">
              {WARDROBE_OUTFITS.map((outfit) => (
                <button
                  key={outfit.id}
                  type="button"
                  onClick={() => handleAddPresetModel(outfit.id)}
                  className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:border-[var(--theme-accent,#55d2f6)] hover:bg-[var(--theme-accent-soft,rgba(85,210,246,0.1))] text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5"
                >
                  <span className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                    {outfit.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono truncate">
                    {outfit.fileName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Live Karaoke Subtitles Overlay */}
      {showSubtitles && (
        <div className="absolute bottom-28 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <VRMSubtitles
            isActive={subtitleState.isActive}
            text={
              subtitleState.speakerName
                ? `[${subtitleState.speakerName}]: ${subtitleState.text}`
                : subtitleState.text
            }
            charIndex={subtitleState.charIndex}
            currentWord={subtitleState.currentWord}
          />
        </div>
      )}

      {/* Minimal Bottom Timeline Bar (Edits Active Model's Independent Script) */}
      {isScriptEditorOpen && activeModel && (
        <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-center pointer-events-none">
          <div className="w-full max-w-4xl p-2.5 sm:p-3 rounded-2xl backdrop-blur-xl border border-black/10 dark:border-white/10 shadow-2xl flex flex-col gap-2 bg-white/90 dark:bg-[#13151f]/90 pointer-events-auto">
            {/* Script Actor Indicator & Switcher Tab */}
            <div className="flex items-center justify-between text-xs pb-1 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Script for:
                </span>
                <div className="flex items-center gap-1">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setActiveModelId(m.id)}
                      className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 ${
                        m.id === activeModelId
                          ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 font-bold shadow-xs'
                          : 'bg-black/5 dark:bg-white/5 text-neutral-600 dark:text-neutral-300 hover:bg-black/10 dark:hover:bg-white/10'
                      }`}
                    >
                      <span className="truncate max-w-[100px]">{m.name}</span>
                      {m.isPlaying && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-neutral-400">
                  {activeModel.cues.length} step{activeModel.cues.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {/* Play Button & Steps Row */}
            <div className="flex items-center gap-2.5 overflow-hidden">
              {/* Play / Stop Button for Active Model Script */}
              {!activeModel.isPlaying ? (
                <button
                  onClick={() => handlePlayModelScript(activeModel.id)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-md active:scale-95 transition-all cursor-pointer"
                  style={{ backgroundColor: 'var(--theme-accent, #55d2f6)' }}
                  title={`Play ${activeModel.name}'s script sequentially`}
                >
                  <Play className="w-4 h-4 fill-current ml-0.5 text-neutral-950" />
                </button>
              ) : (
                <button
                  onClick={() => handleStopModelScript(activeModel.id)}
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
                {activeModel.cues.map((cue, idx) => {
                  const isStepActive = activeModel.isPlaying && activeModel.activePlayingIndex === idx;
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

                      {/* 2 Slots: Slot 1 Motion, Slot 2 Emotion */}
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => openAnimationModalForCue(cue.id)}
                          className="flex items-center justify-between gap-1 px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] border border-black/5 dark:border-white/5 hover:border-[var(--theme-accent,#55d2f6)] min-w-0 cursor-pointer transition-all text-left"
                          title="Slot 1: Choose Motion"
                        >
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-[10px] font-mono font-bold text-neutral-400 shrink-0">1:</span>
                            <span className="text-[11px] font-semibold text-[var(--theme-accent,#55d2f6)] truncate">
                              {selectedAnim?.name || cue.animationKey}
                            </span>
                          </div>
                          <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                        </button>

                        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] border border-black/5 dark:border-white/5 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-neutral-400 shrink-0">2:</span>
                          <select
                            value={cue.emotionKey || 'neutral'}
                            onChange={(e) => {
                              handleUpdateStep(cue.id, { emotionKey: e.target.value });
                              applyEmotionForModel(activeModelId, e.target.value);
                            }}
                            className="w-full bg-transparent text-[11px] font-semibold text-rose-500 dark:text-rose-400 focus:outline-none cursor-pointer truncate"
                            title="Slot 2: Emotion"
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
                  title="Add step to active actor script"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Step</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Animation Selector Modal */}
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
                        : `Motions for ${activeModel?.name || 'Active Actor'}`}
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
                      : 'Click any Mixamo FBX animation below to preview it live on the active actor.'}
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
                            playAnimationForModel(activeModelId, anim.key);
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
