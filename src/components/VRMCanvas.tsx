import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { retargetAnimationFromUrl } from 'vrm-mixamo-retarget';
import { VRM_CONFIG, AI_PROFILE, THEME_COLORS, MODEL_SOURCE_DOMAIN, getWaitingAnimationCandidateUrls } from '../constants';
import { lipSyncManager } from '../lib/lipSync';
import { fetchVRMWithCache } from '../lib/vrmCache';
import { AvatarEmotion } from '../lib/emotionDetector';
import { Sparkles, AlertTriangle } from 'lucide-react';

interface VRMCanvasProps {
  isSpeaking: boolean;
  onLoaded?: () => void;
  onModelClick?: (hitRegion: 'head' | 'chest' | 'stomach' | 'skirt' | 'legs') => void;
  onFallStart?: () => void;
  isPainSoundPlaying?: boolean;
  modelFileName?: string;
  lastUserMessageAt?: number;
  emotion?: AvatarEmotion;
  interactive?: boolean;
  enablePointerTracking?: boolean;
  disableIdleWaitingAnimations?: boolean;
  nodTrigger?: number;
  customAnimationTrigger?: {
    fileName?: string;
    clipFileName?: string;
    triggerId: number;
    loopOnce?: boolean;
  } | null;
  lookTargetOffset?: {
    x?: number;
    y?: number;
    yaw?: number;
    pitch?: number;
  } | null;
}

export const VRMCanvas: React.FC<VRMCanvasProps> = ({
  isSpeaking,
  onLoaded,
  onModelClick,
  onFallStart,
  isPainSoundPlaying = false,
  modelFileName = 'hana_v1.5_vrm1.vrm',
  lastUserMessageAt = 0,
  emotion = 'neutral',
  interactive = true,
  enablePointerTracking = true,
  disableIdleWaitingAnimations = false,
  nodTrigger = 0,
  customAnimationTrigger = null,
  lookTargetOffset = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const interactiveRef = useRef(interactive);
  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  const enablePointerTrackingRef = useRef(enablePointerTracking);
  useEffect(() => {
    enablePointerTrackingRef.current = enablePointerTracking;
  }, [enablePointerTracking]);

  const disableIdleWaitingAnimationsRef = useRef(disableIdleWaitingAnimations);
  useEffect(() => {
    disableIdleWaitingAnimationsRef.current = disableIdleWaitingAnimations;
  }, [disableIdleWaitingAnimations]);

  const nodProgressRef = useRef(0);
  useEffect(() => {
    if (nodTrigger && nodTrigger > 0) {
      nodProgressRef.current = 1.0;
    }
  }, [nodTrigger]);

  const lookTargetOffsetRef = useRef<{ x?: number; y?: number; yaw?: number; pitch?: number } | null>(lookTargetOffset);
  useEffect(() => {
    lookTargetOffsetRef.current = lookTargetOffset;
  }, [lookTargetOffset]);

  const playCustomAnimationRef = useRef<((fileName: string) => void) | null>(null);
  const pendingCustomAnimFileRef = useRef<string | null>(null);
  const isCustomHeadGazeAllowedRef = useRef<boolean>(false);

  useEffect(() => {
    const targetFile = customAnimationTrigger?.fileName || customAnimationTrigger?.clipFileName;
    if (targetFile && customAnimationTrigger?.triggerId && customAnimationTrigger.triggerId > 0) {
      if (playCustomAnimationRef.current) {
        playCustomAnimationRef.current(targetFile);
      } else {
        pendingCustomAnimFileRef.current = targetFile;
      }
    }
  }, [customAnimationTrigger?.triggerId, customAnimationTrigger?.fileName, customAnimationTrigger?.clipFileName]);

  // Store emotion state in ref to avoid recreating Three.js scene while updating expressions smoothly
  const emotionRef = useRef<AvatarEmotion>(emotion);
  useEffect(() => {
    emotionRef.current = emotion || 'neutral';
  }, [emotion]);

  // Download & Loading state
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [loadingStep, setLoadingStep] = useState<string>(`Preparing ${AI_PROFILE.name} 3D...`);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFallWarningActive, setIsFallWarningActive] = useState(false);

  // Store speaking state in ref to prevent unnecessary re-mounts
  const isSpeakingRef = useRef(isSpeaking);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const onModelClickRef = useRef(onModelClick);
  useEffect(() => {
    onModelClickRef.current = onModelClick;
  }, [onModelClick]);

  const onFallStartRef = useRef(onFallStart);
  useEffect(() => {
    onFallStartRef.current = onFallStart;
  }, [onFallStart]);

  const isPainSoundPlayingRef = useRef(isPainSoundPlaying);
  useEffect(() => {
    isPainSoundPlayingRef.current = isPainSoundPlaying;
  }, [isPainSoundPlaying]);

  // Three.js, VRM and Animation references
  const vrmRef = useRef<VRM | null>(null);
  const hitProxyRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const fallActionRef = useRef<THREE.AnimationAction | null>(null);
  const getupActionRef = useRef<THREE.AnimationAction | null>(null);
  const waitingActionsRef = useRef<THREE.AnimationAction[]>([]);
  const activeWaitActionRef = useRef<THREE.AnimationAction | null>(null);
  const waitInactivityTimerRef = useRef<number>(0);
  const stopCurrentWaitAnimationRef = useRef<(() => void) | null>(null);
  const isFallSequenceActiveRef = useRef(false);
  const clickTimestampsRef = useRef<number[]>([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Mouse look tracking
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset the 60s waiting animation counter and immediately keyframe-transition back to default idle when a new message is sent
  useEffect(() => {
    if (!lastUserMessageAt) return;
    waitInactivityTimerRef.current = 0;
    stopCurrentWaitAnimationRef.current?.();
  }, [lastUserMessageAt]);

  // Main Three.js Scene Setup & VRM Loader
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDisposed = false;
    let animationFrameId: number;
    setIsLoaded(false);
    setLoadError(null);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Camera Setup: Zoomed-out portrait framing ensuring waist and hips are visible
    const camera = new THREE.PerspectiveCamera(
      VRM_CONFIG.camera.fov,
      width / height,
      VRM_CONFIG.camera.near,
      VRM_CONFIG.camera.far
    );
    camera.position.set(
      VRM_CONFIG.camera.position.x,
      VRM_CONFIG.camera.position.y,
      VRM_CONFIG.camera.position.z
    );
    camera.lookAt(
      VRM_CONFIG.camera.target.x,
      VRM_CONFIG.camera.target.y,
      VRM_CONFIG.camera.target.z
    );

    cameraRef.current = camera;

    const adjustCameraFraming = () => {
      if (!cameraRef.current || !container) return;
      cameraRef.current = camera;
    };

    adjustCameraFraming();

    // 3. Renderer Setup with hardware-adaptive pixel ratio to eliminate GPU lag
    const isLowPowerDevice =
      typeof navigator !== 'undefined' &&
      ((navigator.hardwareConcurrency || 4) <= 4 || /Mobi|Android|iPhone/i.test(navigator.userAgent));
    const targetPixelRatio = isLowPowerDevice
      ? Math.min(window.devicePixelRatio || 1, 1.25)
      : Math.min(window.devicePixelRatio || 1, 1.6);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !isLowPowerDevice,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(targetPixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;

    // 4. Studio Lighting configured from constants
    const ambientLight = new THREE.AmbientLight(
      VRM_CONFIG.lighting.ambient.color,
      VRM_CONFIG.lighting.ambient.intensity
    );
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(
      VRM_CONFIG.lighting.key.color,
      VRM_CONFIG.lighting.key.intensity
    );
    keyLight.position.set(
      VRM_CONFIG.lighting.key.position.x,
      VRM_CONFIG.lighting.key.position.y,
      VRM_CONFIG.lighting.key.position.z
    );
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(
      VRM_CONFIG.lighting.fill.color,
      VRM_CONFIG.lighting.fill.intensity
    );
    fillLight.position.set(
      VRM_CONFIG.lighting.fill.position.x,
      VRM_CONFIG.lighting.fill.position.y,
      VRM_CONFIG.lighting.fill.position.z
    );
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(
      VRM_CONFIG.lighting.rim.color,
      VRM_CONFIG.lighting.rim.intensity
    );
    rimLight.position.set(
      VRM_CONFIG.lighting.rim.position.x,
      VRM_CONFIG.lighting.rim.position.y,
      VRM_CONFIG.lighting.rim.position.z
    );
    scene.add(rimLight);

    // 5. Load VRM model with GLTFLoader and VRMLoaderPlugin
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    fetchVRMWithCache((pct, step) => {
      if (isDisposed) return;
      if (pct !== undefined) setDownloadProgress(pct);
      if (step) setLoadingStep(step);
    }, modelFileName)
      .then((buffer) => {
        if (isDisposed) return;

        loader.parse(
          buffer,
          '',
          (gltf) => {
            if (isDisposed) return;
            const vrm = gltf.userData.vrm as VRM;
            if (!vrm) {
              setLoadError('Parsed model does not contain VRM metadata.');
              return;
            }

            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.combineSkeletons(gltf.scene);

            try {
              VRMUtils.rotateVRM0(vrm);
            } catch {
              // Ignore if already VRM 1.0
            }

            // Lower model vertically so waist aligns cleanly
            vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);

            // Disable frustum culling on all meshes
            vrm.scene.traverse((obj) => {
              obj.frustumCulled = false;
            });

            // Resting arm stance as fallback
            if (vrm.humanoid) {
              const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
              const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
              const leftLowerArm = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
              const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');

              if (leftUpperArm) leftUpperArm.rotation.set(0.12, 0.05, -1.25);
              if (rightUpperArm) rightUpperArm.rotation.set(0.12, -0.05, 1.25);
              if (leftLowerArm) leftLowerArm.rotation.set(0.0, -0.22, -0.1);
              if (rightLowerArm) rightLowerArm.rotation.set(0.0, 0.22, 0.1);
            }

            // Initial preset expressions (strictly neutral)
            if (vrm.expressionManager) {
              try {
                vrm.expressionManager.setValue('relaxed', 0.0);
                vrm.expressionManager.setValue('happy', 0.0);
                vrm.expressionManager.setValue('surprised', 0.0);
                vrm.expressionManager.setValue('sad', 0.0);
                vrm.expressionManager.setValue('angry', 0.0);
              } catch {
                // Ignore if expression not defined
              }
            }

            vrmRef.current = vrm;
            scene.add(vrm.scene);

            // Lightweight hit proxy collider for instant non-blocking raycasting
            const hitProxyGeometry = new THREE.CylinderGeometry(0.26, 0.28, 1.55, 12);
            hitProxyGeometry.translate(0, 0.77, 0);
            const hitProxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
            const hitProxy = new THREE.Mesh(hitProxyGeometry, hitProxyMaterial);
            hitProxy.name = 'hitProxyCollider';
            vrm.scene.add(hitProxy);
            hitProxyRef.current = hitProxy;

            // Load and Retarget Mixamo Animations (Idle, Fall, Getup)
            const mixer = new THREE.AnimationMixer(vrm.scene);
            mixerRef.current = mixer;

            const loadAndRetargetClip = async (candidateUrls: string[], filterHeadNeck = false) => {
              for (const animUrl of candidateUrls) {
                try {
                  const clip = await retargetAnimationFromUrl(animUrl, vrm);
                  if (clip && !isDisposed) {
                    if (filterHeadNeck) {
                      const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
                      const neckNode = vrm.humanoid?.getNormalizedBoneNode('neck');
                      const headPrefix = headNode?.name ? `${headNode.name}.` : '';
                      const neckPrefix = neckNode?.name ? `${neckNode.name}.` : '';

                      clip.tracks = clip.tracks.filter((track) => {
                        if (headPrefix && track.name.startsWith(headPrefix)) return false;
                        if (neckPrefix && track.name.startsWith(neckPrefix)) return false;
                        return true;
                      });
                    }
                    return clip;
                  }
                } catch (animErr) {
                  console.warn(`Mixamo retarget failed for ${animUrl}:`, animErr);
                }
              }
              return null;
            };

            const loadAllAnimations = async () => {
              // 1. Idle animation (filters head/neck for natural procedural mouse gaze)
              const idleClip = await loadAndRetargetClip(VRM_CONFIG.candidateAnimationUrls, true);
              if (idleClip && !isDisposed && mixerRef.current) {
                const idleAction = mixerRef.current.clipAction(idleClip);
                idleAction.setLoop(THREE.LoopRepeat, Infinity);
                idleAction.play();
                idleActionRef.current = idleAction;
              }

              // 2. Fall animation (full body keyframes for tumbling to floor)
              loadAndRetargetClip(VRM_CONFIG.candidateFallAnimationUrls, false).then((fallClip) => {
                if (fallClip && !isDisposed && mixerRef.current) {
                  const fallAction = mixerRef.current.clipAction(fallClip);
                  fallAction.setLoop(THREE.LoopOnce, 1);
                  fallAction.clampWhenFinished = true;
                  fallActionRef.current = fallAction;
                }
              });

              // 3. Getup animation (full body keyframes for standing back up)
              loadAndRetargetClip(VRM_CONFIG.candidateGetupAnimationUrls, false).then((getupClip) => {
                if (getupClip && !isDisposed && mixerRef.current) {
                  const getupAction = mixerRef.current.clipAction(getupClip);
                  getupAction.setLoop(THREE.LoopOnce, 1);
                  getupAction.clampWhenFinished = true;
                  getupActionRef.current = getupAction;
                }
              });

              // 4. Waiting animations array (e.g., mixamo_yawn.fbx, mixamo_wait.fbx, extensible via VRM_CONFIG.waitingAnimationFiles)
              waitingActionsRef.current = [];
              for (const waitFileName of VRM_CONFIG.waitingAnimationFiles) {
                const candidateUrls = getWaitingAnimationCandidateUrls(waitFileName);
                loadAndRetargetClip(candidateUrls, false).then((waitClip) => {
                  if (waitClip && !isDisposed && mixerRef.current) {
                    const waitAction = mixerRef.current.clipAction(waitClip);
                    waitAction.setLoop(THREE.LoopOnce, 1);
                    waitAction.clampWhenFinished = true;
                    waitingActionsRef.current.push(waitAction);
                  }
                });
              }

              // 5. Preload & on-demand runner for interview/custom transition animations (mixamo_buttonpush.fbx, mixamo_thankful.fbx)
              const customActionCache = new Map<string, THREE.AnimationAction>();
              const getCustomCandidateUrls = (fileName: string) => [
                `${MODEL_SOURCE_DOMAIN}/${fileName}`,
                ...getWaitingAnimationCandidateUrls(fileName),
              ];

              const ensureCustomAction = async (fileName: string): Promise<THREE.AnimationAction | null> => {
                if (customActionCache.has(fileName)) {
                  return customActionCache.get(fileName)!;
                }
                const shouldFilterHeadNeck = fileName.includes('buttonpush');
                const clip = await loadAndRetargetClip(getCustomCandidateUrls(fileName), shouldFilterHeadNeck);
                if (clip && !isDisposed && mixerRef.current) {
                  const action = mixerRef.current.clipAction(clip);
                  action.setLoop(THREE.LoopOnce, 1);
                  action.clampWhenFinished = true;
                  customActionCache.set(fileName, action);
                  return action;
                }
                return null;
              };

              // Preload default transition & wrapup animations in background
              ensureCustomAction('mixamo_buttonpush.fbx');
              ensureCustomAction('mixamo_thankful.fbx');

              playCustomAnimationRef.current = async (fileName: string) => {
                if (isDisposed || isFallSequenceActiveRef.current) return;
                const action = await ensureCustomAction(fileName);
                const mixer = mixerRef.current;
                const idleAction = idleActionRef.current;
                if (!action || !mixer || !idleAction || isDisposed) return;

                if (waitFinishTimeoutId) {
                  clearTimeout(waitFinishTimeoutId);
                  waitFinishTimeoutId = null;
                }
                if (currentWaitFinishedListener) {
                  mixer.removeEventListener('finished', currentWaitFinishedListener);
                  currentWaitFinishedListener = null;
                }

                const fromAction = activeWaitActionRef.current || idleAction;
                activeWaitActionRef.current = action;
                isCustomHeadGazeAllowedRef.current = fileName.includes('buttonpush');

                action.reset();
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
                action.enabled = true;
                action.setEffectiveTimeScale(1);
                action.setEffectiveWeight(1);
                if (fromAction !== action) {
                  action.crossFadeFrom(fromAction, 0.35, false);
                } else {
                  action.fadeIn(0.25);
                }
                action.play();

                let hasHandledCustomEnd = false;
                const handleCustomComplete = () => {
                  if (hasHandledCustomEnd || isDisposed) return;
                  hasHandledCustomEnd = true;
                  isCustomHeadGazeAllowedRef.current = false;
                  if (currentWaitFinishedListener) {
                    mixer.removeEventListener('finished', currentWaitFinishedListener);
                    currentWaitFinishedListener = null;
                  }
                  if (waitFinishTimeoutId) {
                    clearTimeout(waitFinishTimeoutId);
                    waitFinishTimeoutId = null;
                  }
                  if (activeWaitActionRef.current === action) {
                    activeWaitActionRef.current = null;
                    if (!isFallSequenceActiveRef.current && idleActionRef.current) {
                      const idle = idleActionRef.current;
                      idle.reset();
                      idle.setLoop(THREE.LoopRepeat, Infinity);
                      idle.enabled = true;
                      idle.setEffectiveTimeScale(1);
                      idle.setEffectiveWeight(1);
                      idle.crossFadeFrom(action, 0.45, false);
                      idle.play();
                    }
                  }
                };

                const onCustomFinished = (e: any) => {
                  if (e.action === action) {
                    handleCustomComplete();
                  }
                };

                currentWaitFinishedListener = onCustomFinished;
                mixer.addEventListener('finished', onCustomFinished);

                const clipDurationMs = (action.getClip()?.duration || 3.2) * 1000;
                waitFinishTimeoutId = setTimeout(handleCustomComplete, Math.max(500, clipDurationMs - 120));
              };

              if (pendingCustomAnimFileRef.current) {
                const pendingFile = pendingCustomAnimFileRef.current;
                pendingCustomAnimFileRef.current = null;
                playCustomAnimationRef.current(pendingFile);
              }
            };

            loadAllAnimations();

            setIsLoaded(true);
            setDownloadProgress(null);
            onLoadedRef.current?.();
          },
          (err) => {
            console.error('VRM parse error:', err);
            setLoadError('Failed to parse VRM asset.');
          }
        );
      })
      .catch((err) => {
        console.error('VRM download error:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to download VRM.');
      });

    // 6. Animation & Interaction State Variables
    const animStartTime = performance.now();
    let lastAnimTime = performance.now();

    // Natural eye blinking
    let blinkTimer = 0;
    let nextBlinkInterval = 3.5;
    let isBlinking = false;
    let blinkProgress = 0;

    // Natural eye micro-saccades
    let saccadeTimer = 0;
    let nextSaccadeInterval = 2.0;
    let saccadeOffsetX = 0;
    let saccadeOffsetY = 0;

    // Speech facing factor
    let speechFacingFactor = 0;

    // Simplified v1-style body continuous rotation holding & auto-reset dynamics
    let isHoldingOnBody = false;
    let lastClientX = 0;
    let targetBodyRotationY = 0;
    let currentBodyRotationY = 0;

    // Physical impact impulse parameters (Region click jolts)
    let clickImpulsePitch = 0;
    let clickImpulseVelocityPitch = 0;
    let clickImpulseRoll = 0;
    let clickImpulseVelocityRoll = 0;
    let clickImpulseHipsY = 0;
    let clickImpulseVelocityHipsY = 0;
    let clickImpulseArms = 0;
    let clickImpulseVelocityArms = 0;
    let clickFlinchBlink = 0;

    // Hit-triggered expression flashes
    let hitExpressionSurprised = 0;
    let hitExpressionHappy = 0;

    // Occasional smile timer
    let smileCheckTimer = 0;
    const SMILE_CHECK_INTERVAL = VRM_CONFIG.interaction.smileCheckIntervalSec;
    let isSmiling = false;
    let smileStayTimer = 0;
    let currentRelaxed = 0.25;
    let currentHappy = 0.0;
    let currentAngry = 0.0;
    let currentSad = 0.0;
    let currentSurprised = 0.0;
    let currentMouthOpen = 0.0;

    // ----------------------------------------------------
    // Waiting Animations (60s Inactivity Random Selector & Immediate Interrupt)
    // ----------------------------------------------------
    let waitFinishTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let currentWaitFinishedListener: ((e: any) => void) | null = null;

    const stopCurrentWaitAnimation = () => {
      if (waitFinishTimeoutId) {
        clearTimeout(waitFinishTimeoutId);
        waitFinishTimeoutId = null;
      }
      const mixer = mixerRef.current;
      if (mixer && currentWaitFinishedListener) {
        mixer.removeEventListener('finished', currentWaitFinishedListener);
        currentWaitFinishedListener = null;
      }
      const activeWait = activeWaitActionRef.current;
      const idleAction = idleActionRef.current;
      if (activeWait && idleAction && !isFallSequenceActiveRef.current) {
        activeWaitActionRef.current = null;
        idleAction.reset();
        idleAction.setLoop(THREE.LoopRepeat, Infinity);
        idleAction.enabled = true;
        idleAction.setEffectiveTimeScale(1);
        idleAction.setEffectiveWeight(1);
        idleAction.crossFadeFrom(activeWait, 0.35, false);
        idleAction.play();
      } else {
        activeWaitActionRef.current = null;
      }
    };

    stopCurrentWaitAnimationRef.current = stopCurrentWaitAnimation;

    const triggerRandomWaitAnimation = () => {
      // Auto-reset the 60s counter every time a wait animation is played
      waitInactivityTimerRef.current = 0;

      if (isFallSequenceActiveRef.current) return;
      const mixer = mixerRef.current;
      const idleAction = idleActionRef.current;
      const availableWaitActions = waitingActionsRef.current;
      if (!mixer || !idleAction || availableWaitActions.length === 0) return;

      const chosenAction =
        availableWaitActions[Math.floor(Math.random() * availableWaitActions.length)];
      if (!chosenAction) return;

      if (waitFinishTimeoutId) {
        clearTimeout(waitFinishTimeoutId);
        waitFinishTimeoutId = null;
      }
      if (currentWaitFinishedListener) {
        mixer.removeEventListener('finished', currentWaitFinishedListener);
        currentWaitFinishedListener = null;
      }

      const fromAction = activeWaitActionRef.current || idleAction;
      activeWaitActionRef.current = chosenAction;

      chosenAction.reset();
      chosenAction.setLoop(THREE.LoopOnce, 1);
      chosenAction.clampWhenFinished = true;
      chosenAction.enabled = true;
      chosenAction.setEffectiveTimeScale(1);
      chosenAction.setEffectiveWeight(1);
      if (fromAction !== chosenAction) {
        chosenAction.crossFadeFrom(fromAction, 0.45, false);
      } else {
        chosenAction.fadeIn(0.35);
      }
      chosenAction.play();

      let hasHandledWaitEnd = false;
      const handleWaitComplete = () => {
        if (hasHandledWaitEnd || isDisposed) return;
        hasHandledWaitEnd = true;
        if (currentWaitFinishedListener) {
          mixer.removeEventListener('finished', currentWaitFinishedListener);
          currentWaitFinishedListener = null;
        }
        if (waitFinishTimeoutId) {
          clearTimeout(waitFinishTimeoutId);
          waitFinishTimeoutId = null;
        }
        if (activeWaitActionRef.current === chosenAction) {
          activeWaitActionRef.current = null;
          if (!isFallSequenceActiveRef.current && idleActionRef.current) {
            const idle = idleActionRef.current;
            idle.reset();
            idle.setLoop(THREE.LoopRepeat, Infinity);
            idle.enabled = true;
            idle.setEffectiveTimeScale(1);
            idle.setEffectiveWeight(1);
            idle.crossFadeFrom(chosenAction, 0.5, false);
            idle.play();
          }
        }
      };

      const onWaitFinished = (e: any) => {
        if (e.action === chosenAction) {
          handleWaitComplete();
        }
      };

      currentWaitFinishedListener = onWaitFinished;
      mixer.addEventListener('finished', onWaitFinished);

      const waitDurationMs = (chosenAction.getClip()?.duration || 4.0) * 1000;
      waitFinishTimeoutId = setTimeout(handleWaitComplete, Math.max(500, waitDurationMs - 150));
    };

    // ----------------------------------------------------
    // Fall & Get Up Multi-Click Sequence
    // ----------------------------------------------------
    let fallSequenceTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let getupFallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const triggerFallSequence = () => {
      if (isFallSequenceActiveRef.current) return;
      const mixer = mixerRef.current;
      const idleAction = idleActionRef.current;
      const fallAction = fallActionRef.current;
      const getupAction = getupActionRef.current;

      if (!mixer || !fallAction || !getupAction || !idleAction) return;

      isFallSequenceActiveRef.current = true;
      waitInactivityTimerRef.current = 0;
      setIsFallWarningActive(true);
      onFallStartRef.current?.();

      if (fallSequenceTimeoutId) clearTimeout(fallSequenceTimeoutId);
      if (getupFallbackTimeoutId) clearTimeout(getupFallbackTimeoutId);
      if (waitFinishTimeoutId) {
        clearTimeout(waitFinishTimeoutId);
        waitFinishTimeoutId = null;
      }
      if (currentWaitFinishedListener) {
        mixer.removeEventListener('finished', currentWaitFinishedListener);
        currentWaitFinishedListener = null;
      }

      const previousActiveAction = activeWaitActionRef.current || idleAction;
      activeWaitActionRef.current = null;

      // Reset any leftover click impulse forces so physics does not fight animation
      clickImpulsePitch = 0;
      clickImpulseVelocityPitch = 0;
      clickImpulseRoll = 0;
      clickImpulseVelocityRoll = 0;
      clickImpulseHipsY = 0;
      clickImpulseVelocityHipsY = 0;
      clickImpulseArms = 0;
      clickImpulseVelocityArms = 0;

      // 1. Play mixamo_fall.fbx with smooth keyframe transition from current coordinates and points
      fallAction.reset();
      fallAction.setLoop(THREE.LoopOnce, 1);
      fallAction.clampWhenFinished = true;
      fallAction.enabled = true;
      fallAction.setEffectiveTimeScale(1);
      fallAction.setEffectiveWeight(1);
      fallAction.crossFadeFrom(previousActiveAction, 0.4, false);
      fallAction.play();

      let hasHandledFallEnd = false;
      const handleFallComplete = () => {
        if (hasHandledFallEnd || isDisposed) return;
        hasHandledFallEnd = true;
        mixer.removeEventListener('finished', onFallFinished);

        // 2. Wait 2 seconds before playing mixamo_getup.fbx
        fallSequenceTimeoutId = setTimeout(() => {
          if (isDisposed) return;

          // 3. Smooth keyframe transition to first frame of mixamo_getup.fbx
          getupAction.reset();
          getupAction.setLoop(THREE.LoopOnce, 1);
          getupAction.clampWhenFinished = true;
          getupAction.enabled = true;
          getupAction.setEffectiveTimeScale(1);
          getupAction.setEffectiveWeight(1);
          getupAction.crossFadeFrom(fallAction, 0.45, false);
          getupAction.play();

          let hasHandledGetupEnd = false;
          const handleGetupComplete = () => {
            if (hasHandledGetupEnd || isDisposed) return;
            hasHandledGetupEnd = true;
            mixer.removeEventListener('finished', onGetupFinished);

            // 4. At the end of get up animation, keyframe transition to default idle animation
            idleAction.reset();
            idleAction.setLoop(THREE.LoopRepeat, Infinity);
            idleAction.enabled = true;
            idleAction.setEffectiveTimeScale(1);
            idleAction.setEffectiveWeight(1);
            idleAction.crossFadeFrom(getupAction, 0.6, false);
            idleAction.play();

            setTimeout(() => {
              isFallSequenceActiveRef.current = false;
              waitInactivityTimerRef.current = 0;
              if (!isDisposed) {
                setIsFallWarningActive(false);
              }
            }, 600);
          };

          const onGetupFinished = (e: any) => {
            if (e.action === getupAction) {
              handleGetupComplete();
            }
          };

          mixer.addEventListener('finished', onGetupFinished);

          const getupDuration = (getupAction.getClip()?.duration || 2.5) * 1000;
          getupFallbackTimeoutId = setTimeout(handleGetupComplete, getupDuration + 150);
        }, 2000); // 2 second pause on floor
      };

      const onFallFinished = (e: any) => {
        if (e.action === fallAction) {
          handleFallComplete();
        }
      };

      mixer.addEventListener('finished', onFallFinished);

      const fallDuration = (fallAction.getClip()?.duration || 2.0) * 1000;
      setTimeout(handleFallComplete, fallDuration + 150);
    };

    // Pre-allocated scratch objects to prevent per-frame garbage collection
    const scratchHeadWorldPos = new THREE.Vector3();

    // 7. Render & Animation Loop with Tab Visibility Pausing
    let isTabVisible = typeof document === 'undefined' ? true : !document.hidden;
    const handleVisibilityChange = () => {
      isTabVisible = typeof document === 'undefined' ? true : !document.hidden;
      if (isTabVisible && !isDisposed) {
        lastAnimTime = performance.now();
        cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const animate = () => {
      if (!isTabVisible || isDisposed) return;
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - lastAnimTime) / 1000, 0.1);
      lastAnimTime = now;
      const elapsed = (now - animStartTime) / 1000;
      const vrm = vrmRef.current;

      if (vrm) {
        // 60-second message inactivity counter -> select random waiting animation & auto-reset
        if (!isFallSequenceActiveRef.current && !disableIdleWaitingAnimationsRef.current) {
          waitInactivityTimerRef.current += delta;
          const waitIntervalSec = VRM_CONFIG.interaction.waitAnimationIntervalSec || 60.0;
          if (waitInactivityTimerRef.current >= waitIntervalSec) {
            waitInactivityTimerRef.current = 0;
            triggerRandomWaitAnimation();
          }
        }

        // Continuous Mixamo Body Animation Mixer
        if (mixerRef.current) {
          mixerRef.current.update(delta);
        }

        // Damped Spring Physics for Physical Impact Jolts
        const springK = 140.0;
        const springDamping = 16.0;

        const accelPitch = -springK * clickImpulsePitch - springDamping * clickImpulseVelocityPitch;
        clickImpulseVelocityPitch += accelPitch * delta;
        clickImpulsePitch += clickImpulseVelocityPitch * delta;

        const accelRoll = -springK * clickImpulseRoll - springDamping * clickImpulseVelocityRoll;
        clickImpulseVelocityRoll += accelRoll * delta;
        clickImpulseRoll += clickImpulseVelocityRoll * delta;

        const accelHipsY = -springK * clickImpulseHipsY - springDamping * clickImpulseVelocityHipsY;
        clickImpulseVelocityHipsY += accelHipsY * delta;
        clickImpulseHipsY += clickImpulseVelocityHipsY * delta;

        const accelArms = -springK * clickImpulseArms - springDamping * clickImpulseVelocityArms;
        clickImpulseVelocityArms += accelArms * delta;
        clickImpulseArms += clickImpulseVelocityArms * delta;

        if (clickFlinchBlink > 0) {
          clickFlinchBlink = Math.max(0, clickFlinchBlink - delta * 8.0);
        }

        // Decay hit expressions smoothly
        if (hitExpressionSurprised > 0) {
          hitExpressionSurprised = Math.max(0, hitExpressionSurprised - delta * 3.5);
        }
        if (hitExpressionHappy > 0) {
          hitExpressionHappy = Math.max(0, hitExpressionHappy - delta * 3.5);
        }

        // ----------------------------------------------------
        // Simplified v1 Rotational Logic:
        // Smooth lerp reset to 0 (or towards lookTargetOffset) when not holding
        // ----------------------------------------------------
        if (!isHoldingOnBody) {
          const customLook = lookTargetOffsetRef.current;
          const rawLookX = customLook
            ? Number.isFinite(customLook.yaw)
              ? customLook.yaw!
              : Number.isFinite(customLook.x)
              ? customLook.x!
              : 0
            : 0;
          const desiredBodyRotY = rawLookX * 0.22;
          if (Number.isFinite(desiredBodyRotY)) {
            targetBodyRotationY = THREE.MathUtils.lerp(targetBodyRotationY, desiredBodyRotY, delta * 3.8);
          }
        }

        if (!Number.isFinite(targetBodyRotationY)) {
          targetBodyRotationY = 0;
        }
        currentBodyRotationY = THREE.MathUtils.lerp(currentBodyRotationY, targetBodyRotationY, delta * 12.0);
        if (!Number.isFinite(currentBodyRotationY)) {
          currentBodyRotationY = 0;
        }

        // Apply position and rotation directly to scene
        vrm.scene.position.set(0, VRM_CONFIG.interaction.bodyOffsetY, 0);
        vrm.scene.rotation.set(0, currentBodyRotationY, 0);

        // Skeletal click impact layer (without angular momentum drag)
        const humanoid = vrm.humanoid;
        const isFalling = isFallSequenceActiveRef.current;
        if (humanoid && !isFalling) {
          const spineNode = humanoid.getNormalizedBoneNode('spine');
          const chestNode = humanoid.getNormalizedBoneNode('chest');
          const upperChestNode = humanoid.getNormalizedBoneNode('upperChest');
          const hipsNode = humanoid.getNormalizedBoneNode('hips');
          const leftShoulderNode = humanoid.getNormalizedBoneNode('leftShoulder');
          const rightShoulderNode = humanoid.getNormalizedBoneNode('rightShoulder');
          const leftUpperArmNode = humanoid.getNormalizedBoneNode('leftUpperArm');
          const rightUpperArmNode = humanoid.getNormalizedBoneNode('rightUpperArm');
          const leftLowerArmNode = humanoid.getNormalizedBoneNode('leftLowerArm');
          const rightLowerArmNode = humanoid.getNormalizedBoneNode('rightLowerArm');

          if (spineNode) {
            spineNode.rotation.y += clickImpulseRoll * 0.25;
            spineNode.rotation.x += clickImpulsePitch * 0.35;
          }
          if (chestNode) {
            chestNode.rotation.y += clickImpulseRoll * 0.35;
            chestNode.rotation.x += clickImpulsePitch * 0.45;
            chestNode.rotation.z += clickImpulseRoll * 0.2;
          }
          if (upperChestNode) {
            upperChestNode.rotation.y += clickImpulseRoll * 0.25;
            upperChestNode.rotation.x += clickImpulsePitch * 0.25;
          }

          if (hipsNode) {
            hipsNode.position.y += clickImpulseHipsY * 0.4;
            hipsNode.rotation.z += clickImpulseRoll * 0.15;
            hipsNode.rotation.x += clickImpulsePitch * 0.15;
          }

          if (leftShoulderNode && rightShoulderNode) {
            leftShoulderNode.rotation.y += clickImpulseRoll * 0.12;
            rightShoulderNode.rotation.y += clickImpulseRoll * 0.12;
            leftShoulderNode.rotation.z += clickImpulseArms * 0.08;
            rightShoulderNode.rotation.z -= clickImpulseArms * 0.08;
          }

          if (leftUpperArmNode && rightUpperArmNode) {
            leftUpperArmNode.rotation.z += clickImpulseArms * 0.22;
            rightUpperArmNode.rotation.z -= clickImpulseArms * 0.22;
          }

          if (leftLowerArmNode && rightLowerArmNode) {
            leftLowerArmNode.rotation.x += clickImpulseArms * 0.15;
            rightLowerArmNode.rotation.x += clickImpulseArms * 0.15;
          }
        }

        // Update VRM secondary physics (spring bones)
        vrm.update(delta);

        // Update LipSync & Viseme Engine
        lipSyncManager.update(delta, elapsed);
        const visemes = lipSyncManager.getVisemes();
        const speakingNow = isSpeakingRef.current || lipSyncManager.getIsSpeaking();

        speechFacingFactor = THREE.MathUtils.lerp(
          speechFacingFactor,
          speakingNow ? 1.0 : 0.0,
          delta * 6.0
        );

        // Occasional Smile
        smileCheckTimer += delta;
        if (smileCheckTimer >= SMILE_CHECK_INTERVAL) {
          smileCheckTimer = 0;
          if (!isSmiling && Math.random() < 0.25) {
            isSmiling = true;
            smileStayTimer = VRM_CONFIG.interaction.smileStayDurationSec;
          }
        }

        if (isSmiling) {
          smileStayTimer -= delta;
          if (smileStayTimer <= 0) {
            isSmiling = false;
            smileStayTimer = 0;
          }
        }

        // Sentiment & Emotion blending based on overall AI output sentiment
        const isPainActive = isPainSoundPlayingRef.current || isFalling;
        const currentActiveEmotion = emotionRef.current || 'neutral';

        let targetAngry = 0.0;
        let targetRelaxed = isSmiling ? 0.35 : 0.25;
        let targetHappy = isSmiling ? 0.25 : 0.0;
        let targetSad = 0.0;
        let targetSurprised = 0.0;
        let targetMouthOpen = 0.0;

        switch (currentActiveEmotion) {
          case 'happy':
            // "happy" (just need to show mouth slightly open with eyes relaxed)
            targetHappy = 0.45;
            targetRelaxed = 0.85;
            targetMouthOpen = 0.18;
            break;
          case 'smug':
            // "smug" (relaxed expression)
            targetRelaxed = 0.9;
            targetHappy = 0.2;
            targetMouthOpen = 0.0;
            break;
          case 'sad':
            // "sad"
            targetSad = 0.8;
            targetRelaxed = 0.0;
            targetHappy = 0.0;
            break;
          case 'angry':
            // "angry"
            targetAngry = 0.85;
            targetRelaxed = 0.0;
            targetHappy = 0.0;
            break;
          case 'surprised':
            // "surprised"
            targetSurprised = 0.85;
            targetRelaxed = 0.2;
            targetMouthOpen = 0.18;
            break;
          case 'neutral':
          default:
            // "neutral" strictly neutral face - no smile or relaxed smirk
            targetRelaxed = 0.0;
            targetHappy = 0.0;
            break;
        }

        // Pain sound or physical fall overrides anger
        if (isPainActive) {
          targetAngry = 0.95;
          targetRelaxed = 0.0;
          targetHappy = 0.0;
        }

        currentAngry = THREE.MathUtils.lerp(
          currentAngry,
          targetAngry,
          delta * (isPainActive ? 12.0 : 4.5)
        );
        currentRelaxed = THREE.MathUtils.lerp(currentRelaxed, targetRelaxed, delta * 3.5);
        currentHappy = THREE.MathUtils.lerp(currentHappy, targetHappy, delta * 3.5);
        currentSad = THREE.MathUtils.lerp(currentSad, targetSad, delta * 3.5);
        currentSurprised = THREE.MathUtils.lerp(currentSurprised, targetSurprised, delta * 4.5);
        currentMouthOpen = THREE.MathUtils.lerp(currentMouthOpen, targetMouthOpen, delta * 4.0);

        // Expression Manager Updates
        if (vrm.expressionManager) {
          const speakingNow = isSpeakingRef.current || lipSyncManager.getIsSpeaking();
          let dynamicMouth = 0;
          if (speakingNow && visemes.aa === 0 && visemes.ih === 0 && visemes.oh === 0) {
            const t = elapsed * 7.5;
            const cycle = Math.sin(t);
            dynamicMouth = cycle > 0.30 ? (cycle - 0.30) * 0.20 : 0;
          }

          // Subtle, natural mouth movements (capped at gentle amplitudes)
          const aaVal = speakingNow ? Math.min(0.28, Math.max(visemes.aa, dynamicMouth) + currentMouthOpen * 0.5) : 0;
          const ihVal = speakingNow ? Math.min(0.20, Math.max(visemes.ih, dynamicMouth * 0.35)) : 0;
          const ouVal = speakingNow ? Math.min(0.18, Math.max(visemes.ou, dynamicMouth * 0.25)) : 0;
          const eeVal = speakingNow ? Math.min(0.20, Math.max(visemes.ee, dynamicMouth * 0.30)) : 0;
          const ohVal = speakingNow ? Math.min(0.22, Math.max(visemes.oh, dynamicMouth * 0.35)) : 0;

          vrm.expressionManager.setValue('aa', aaVal);
          vrm.expressionManager.setValue('ih', ihVal);
          vrm.expressionManager.setValue('ou', ouVal);
          vrm.expressionManager.setValue('ee', eeVal);
          vrm.expressionManager.setValue('oh', ohVal);

          // Support VRM 0.0 blendshape fallback keys
          try { vrm.expressionManager.setValue('a' as any, aaVal); } catch {}
          try { vrm.expressionManager.setValue('i' as any, ihVal); } catch {}
          try { vrm.expressionManager.setValue('u' as any, ouVal); } catch {}
          try { vrm.expressionManager.setValue('e' as any, eeVal); } catch {}
          try { vrm.expressionManager.setValue('o' as any, ohVal); } catch {}

          // Suppress peaceful baseline expressions while angry/annoyed mood is active
          const moodSuppression = Math.max(0, 1.0 - currentAngry * 1.2);
          vrm.expressionManager.setValue('relaxed', currentRelaxed * moodSuppression);
          vrm.expressionManager.setValue('happy', Math.min(1.0, currentHappy + hitExpressionHappy) * moodSuppression);
          vrm.expressionManager.setValue('surprised', Math.min(1.0, currentSurprised + hitExpressionSurprised));
          vrm.expressionManager.setValue('sad', currentSad);
          vrm.expressionManager.setValue('angry', currentAngry);

          // Direct mesh morph target fallback for VRoid and GLTF meshes (cleanly reset to 0 when not speaking)
          vrm.scene.traverse((obj) => {
            const mesh = obj as THREE.SkinnedMesh;
            if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
              const dict = mesh.morphTargetDictionary;
              if (typeof dict['Fcl_MTH_A'] === 'number') mesh.morphTargetInfluences[dict['Fcl_MTH_A']] = aaVal;
              if (typeof dict['Fcl_MTH_I'] === 'number') mesh.morphTargetInfluences[dict['Fcl_MTH_I']] = ihVal;
              if (typeof dict['Fcl_MTH_U'] === 'number') mesh.morphTargetInfluences[dict['Fcl_MTH_U']] = ouVal;
              if (typeof dict['Fcl_MTH_E'] === 'number') mesh.morphTargetInfluences[dict['Fcl_MTH_E']] = eeVal;
              if (typeof dict['Fcl_MTH_O'] === 'number') mesh.morphTargetInfluences[dict['Fcl_MTH_O']] = ohVal;
              if (typeof dict['jawOpen'] === 'number') mesh.morphTargetInfluences[dict['jawOpen']] = aaVal;
              if (typeof dict['mouthOpen'] === 'number') mesh.morphTargetInfluences[dict['mouthOpen']] = aaVal;
            }
          });
        }

        // Blinking
        blinkTimer += delta;
        if (!isBlinking && blinkTimer > nextBlinkInterval) {
          isBlinking = true;
          blinkTimer = 0;
          blinkProgress = 0;
          nextBlinkInterval = VRM_CONFIG.interaction.blinkMinIntervalSec + Math.random() * VRM_CONFIG.interaction.blinkRandomIntervalSec;
        }

        if (vrm.expressionManager) {
          const naturalBlink = isBlinking ? Math.sin(blinkProgress * Math.PI) : 0;
          const totalBlink = Math.min(1.0, naturalBlink + clickFlinchBlink);
          vrm.expressionManager.setValue('blink', totalBlink);
          if (isBlinking) {
            blinkProgress += delta * 7.5;
            if (blinkProgress > 1) {
              isBlinking = false;
            }
          }

          // Evaluate and apply all expressions immediately to character meshes
          vrm.expressionManager.update();
        }

        // Eye Saccades
        saccadeTimer += delta;
        if (saccadeTimer > nextSaccadeInterval) {
          saccadeTimer = 0;
          nextSaccadeInterval = VRM_CONFIG.interaction.saccadeMinIntervalSec + Math.random() * VRM_CONFIG.interaction.saccadeRandomIntervalSec;
          saccadeOffsetX = (Math.random() - 0.5) * 0.025;
          saccadeOffsetY = (Math.random() - 0.5) * 0.015;
        }

        // Head & Neck Gaze Tracking (paused while full-body fall or wait animation is driving head/neck keyframes, unless custom head gaze is enabled)
        const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
        const neckNode = vrm.humanoid?.getNormalizedBoneNode('neck');
        const isWaitPlaying = Boolean(activeWaitActionRef.current) && !isCustomHeadGazeAllowedRef.current && !lookTargetOffsetRef.current;

        if (!isFalling && !isWaitPlaying && headNode && cameraRef.current) {
          headNode.getWorldPosition(scratchHeadWorldPos);
          scratchHeadWorldPos.y += 0.055;

          const headScreenPos = scratchHeadWorldPos.project(cameraRef.current);

          // Manual affirmative nod progress calculation
          let manualNodX = 0;
          if (nodProgressRef.current > 0) {
            nodProgressRef.current = Math.max(0, nodProgressRef.current - delta * 2.2);
            manualNodX = Math.sin((1.0 - nodProgressRef.current) * Math.PI) * 0.16;
          }

          // If lookTargetOffset is provided (e.g. looking towards the task panel in /interview), prioritize it;
          // otherwise use pointer tracking if enabled.
          const hasPointer = enablePointerTrackingRef.current;
          const customLook = lookTargetOffsetRef.current;

          const customX = customLook
            ? Number.isFinite(customLook.yaw)
              ? customLook.yaw!
              : Number.isFinite(customLook.x)
              ? customLook.x!
              : null
            : null;

          const customY = customLook
            ? Number.isFinite(customLook.pitch)
              ? customLook.pitch!
              : Number.isFinite(customLook.y)
              ? customLook.y!
              : null
            : null;

          const deltaX = customX !== null
            ? customX
            : hasPointer
            ? mouseRef.current.x - headScreenPos.x
            : 0;

          const deltaY = customY !== null
            ? customY
            : hasPointer
            ? mouseRef.current.y - headScreenPos.y
            : 0;

          const facingAttenuation = customLook ? speechFacingFactor * 0.3 : speechFacingFactor;
          const activeDeltaX = Number.isFinite(deltaX) ? deltaX * (1.0 - facingAttenuation) : 0;
          const activeDeltaY = Number.isFinite(deltaY) ? deltaY * (1.0 - facingAttenuation) : 0;

          const speechNodX = speechFacingFactor * Math.sin(elapsed * 4.5) * 0.02;

          const targetRotY = THREE.MathUtils.clamp(activeDeltaX * 0.75, -0.85, 0.85) + (hasPointer ? saccadeOffsetX * (1.0 - speechFacingFactor * 0.6) : saccadeOffsetX * 0.4);
          const targetRotX = THREE.MathUtils.clamp(-activeDeltaY * 0.6, -0.45, 0.45) + (hasPointer ? saccadeOffsetY * (1.0 - speechFacingFactor * 0.6) : saccadeOffsetY * 0.4) + speechNodX + manualNodX;

          if (Number.isFinite(targetRotY) && Number.isFinite(targetRotX)) {
            headNode.rotation.y = THREE.MathUtils.lerp(headNode.rotation.y, targetRotY, delta * 7.5);
            headNode.rotation.x = THREE.MathUtils.lerp(headNode.rotation.x, targetRotX, delta * 7.5);
          }

          if (neckNode) {
            const targetNeckY = THREE.MathUtils.clamp(activeDeltaX * 0.35, -0.4, 0.4);
            const targetNeckX = THREE.MathUtils.clamp(-activeDeltaY * 0.25, -0.25, 0.25) + speechNodX * 0.4 + manualNodX * 0.5;
            if (Number.isFinite(targetNeckY) && Number.isFinite(targetNeckX)) {
              neckNode.rotation.y = THREE.MathUtils.lerp(neckNode.rotation.y, targetNeckY, delta * 6.0);
              neckNode.rotation.x = THREE.MathUtils.lerp(neckNode.rotation.x, targetNeckX, delta * 6.0);
            }
          }
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // 8. Resize Handler
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const newW = container.clientWidth || window.innerWidth;
      const newH = container.clientHeight || window.innerHeight;
      if (newW <= 0 || newH <= 0) return;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      adjustCameraFraming();
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && container) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(container);
    }

    // 9. Pointer movement for gaze tracking & drag rotation (v1 rotational multiplier)
    const handlePointerMove = (e: PointerEvent) => {
      if (!enablePointerTrackingRef.current) {
        mouseRef.current = { x: 0, y: 0 };
        return;
      }

      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouseRef.current = { x, y };

      if (isHoldingOnBody) {
        const deltaX = e.clientX - lastClientX;
        lastClientX = e.clientX;
        targetBodyRotationY += deltaX * 0.009;
      }
    };

    // 10. Pointer Down on 3D Model: Detect Body Region & initiate rotation drag
    const handlePointerDown = (e: PointerEvent) => {
      if (!interactiveRef.current || !container || !cameraRef.current || !vrmRef.current) return;
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      // Instant raycast against simple hit proxy collider (eliminates heavy CPU vertex skinning on high-poly meshes)
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

      let intersects: THREE.Intersection[] = [];
      if (hitProxyRef.current) {
        intersects = raycaster.intersectObject(hitProxyRef.current, false);
      } else {
        intersects = raycaster.intersectObjects(vrmRef.current.scene.children, true);
      }

      if (intersects.length > 0) {
        isHoldingOnBody = true;
        lastClientX = e.clientX;

        // Calculate click point in VRM model local coordinate space
        const hitPoint = intersects[0].point.clone();
        vrmRef.current.scene.worldToLocal(hitPoint);

        const localY = hitPoint.y;
        const localX = hitPoint.x;

        // Check bone/mesh name hints and local height
        const objName = (intersects[0].object.name || '').toLowerCase();
        const parentName = (intersects[0].object.parent?.name || '').toLowerCase();
        const nameStr = `${objName} ${parentName}`;

        let hitRegion: 'head' | 'chest' | 'stomach' | 'skirt' | 'legs' = 'stomach';

        if (nameStr.includes('head') || nameStr.includes('hair') || nameStr.includes('face') || localY >= 1.22) {
          hitRegion = 'head';
        } else if (nameStr.includes('chest') || nameStr.includes('bust') || nameStr.includes('arm') || nameStr.includes('shoulder') || (localY >= 0.92 && localY < 1.22)) {
          hitRegion = 'chest';
        } else if (nameStr.includes('spine') || nameStr.includes('waist') || nameStr.includes('stomach') || (localY >= 0.68 && localY < 0.92)) {
          hitRegion = 'stomach';
        } else if (nameStr.includes('skirt') || nameStr.includes('hip') || (localY >= 0.40 && localY < 0.68)) {
          hitRegion = 'skirt';
        } else {
          hitRegion = 'legs';
        }

        // Trigger pain sound and voice-synthesis pause callback
        onModelClickRef.current?.(hitRegion);

        // Detect 4 or more clicks within a 3-second window to trigger fall & getup sequence
        const clickNow = performance.now();
        clickTimestampsRef.current.push(clickNow);
        clickTimestampsRef.current = clickTimestampsRef.current.filter((t) => clickNow - t <= 3000);

        if (clickTimestampsRef.current.length >= 4 && !isFallSequenceActiveRef.current) {
          clickTimestampsRef.current = [];
          triggerFallSequence();
        }

        // Apply specific physical responses & facial expressions per region if not in fall sequence
        if (!isFallSequenceActiveRef.current) {
          if (hitRegion === 'head') {
            clickImpulseVelocityPitch = -2.2;
            clickImpulseVelocityRoll = THREE.MathUtils.clamp(-localX * 12.0, -3.5, 3.5);
            clickImpulseVelocityHipsY = -0.02;
            clickImpulseVelocityArms = 1.2;
            clickFlinchBlink = 1.0;
            hitExpressionSurprised = 0.8;
            hitExpressionHappy = 0.4;
          } else if (hitRegion === 'chest') {
            clickImpulseVelocityPitch = -5.0;
            clickImpulseVelocityRoll = THREE.MathUtils.clamp(-localX * 10.0, -4.0, 4.0);
            clickImpulseVelocityHipsY = -0.06;
            clickImpulseVelocityArms = 4.0;
            clickFlinchBlink = 0.9;
            hitExpressionSurprised = 1.0;
          } else if (hitRegion === 'stomach') {
            clickImpulseVelocityPitch = -3.5;
            clickImpulseVelocityRoll = THREE.MathUtils.clamp(-localX * 8.0, -3.0, 3.0);
            clickImpulseVelocityHipsY = -0.10;
            clickImpulseVelocityArms = 2.5;
            clickFlinchBlink = 0.6;
            hitExpressionSurprised = 0.5;
          } else if (hitRegion === 'skirt') {
            clickImpulseVelocityPitch = -1.5;
            clickImpulseVelocityRoll = THREE.MathUtils.clamp(-localX * 12.0, -4.0, 4.0);
            clickImpulseVelocityHipsY = 0.08;
            clickImpulseVelocityArms = 1.8;
            clickFlinchBlink = 0.4;
            hitExpressionSurprised = 0.3;
          } else { // legs
            clickImpulseVelocityPitch = 2.5;
            clickImpulseVelocityRoll = THREE.MathUtils.clamp(-localX * 6.0, -2.5, 2.5);
            clickImpulseVelocityHipsY = 0.12;
            clickImpulseVelocityArms = 1.2;
            clickFlinchBlink = 0.3;
            hitExpressionSurprised = 0.4;
          }
        }

        canvas.style.cursor = 'grabbing';
      }
    };

    // 11. Pointer Up: Release rotation hold, trigger auto-reset
    const handlePointerUp = () => {
      if (isHoldingOnBody) {
        isHoldingOnBody = false;
        canvas.style.cursor = 'default';
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      isDisposed = true;
      stopCurrentWaitAnimationRef.current = null;
      if (fallSequenceTimeoutId) clearTimeout(fallSequenceTimeoutId);
      if (getupFallbackTimeoutId) clearTimeout(getupFallbackTimeoutId);
      if (waitFinishTimeoutId) clearTimeout(waitFinishTimeoutId);
      clickTimestampsRef.current = [];
      cancelAnimationFrame(animationFrameId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      renderer.dispose();
      scene.clear();
      if (vrmRef.current) {
        VRMUtils.deepDispose(vrmRef.current.scene);
      }
    };
  }, [modelFileName]);

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 w-full h-full overflow-hidden select-none flex items-center justify-center ${THEME_COLORS.tokens.vrmCanvasBg}`}
      style={{
        backgroundColor: 'var(--theme-bg)',
      }}
    >
      {/* Background Soft Studio Vignette */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-black/[0.03] dark:from-white/[0.015] to-transparent" />
      </div>

      {/* 3D WebGL Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full outline-none" />

      {/* Harassment Warning Banner while Fall Animation is Playing */}
      {isFallWarningActive && (
        <div className="absolute top-5 inset-x-0 z-30 flex justify-center px-4 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2.5 rounded-2xl bg-red-600/95 text-white border border-red-400/50 shadow-xl backdrop-blur-md flex items-center gap-2.5 text-xs sm:text-sm font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-200" />
            <span>Harassing {AI_PROFILE.name} will get you banned!</span>
          </div>
        </div>
      )}

      {/* Download / Caching Progress Overlay */}
      {!isLoaded && !loadError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-white/70 dark:bg-[#0f1117]/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex flex-col items-center max-w-xs w-full text-center space-y-4">
            <div className="relative">
              <div className={`w-16 h-16 rounded-full overflow-hidden shadow-xl ${THEME_COLORS.tokens.avatarRing} bg-white dark:bg-[#161822] flex items-center justify-center`}>
                <img
                  src={AI_PROFILE.avatarUrl}
                  alt={AI_PROFILE.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className={`absolute -bottom-1 -right-1 p-1 ${THEME_COLORS.tokens.accentBg} rounded-full text-white shadow-md`}>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
              </div>
            </div>

            <div>
              <h3 className="font-bold text-sm text-neutral-900 dark:text-white tracking-tight">
                Loading {AI_PROFILE.name} 3D Avatar
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{loadingStep}</p>
            </div>

            {/* Progress Bar */}
            {downloadProgress !== null && (
              <div className="w-full space-y-1.5">
                <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden shadow-inner">
                  <div
                    className={`h-full ${THEME_COLORS.tokens.accentBg} rounded-full transition-all duration-200`}
                    style={{ width: `${Math.max(5, downloadProgress)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                  <span>VRM 1.0</span>
                  <span>{downloadProgress}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Load Error State */}
      {loadError && (
        <div className={`absolute z-20 max-w-sm p-4 rounded-2xl ${THEME_COLORS.tokens.modalBg} border ${THEME_COLORS.tokens.dangerBadge} shadow-xl text-center`}>
          <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-2">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className={`px-3 py-1 text-xs rounded-xl ${THEME_COLORS.tokens.modalPrimaryButton} cursor-pointer`}
          >
            Retry Loading
          </button>
        </div>
      )}
    </div>
  );
};