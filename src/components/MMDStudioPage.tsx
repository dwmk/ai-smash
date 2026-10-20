import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { retargetAnimation } from 'vrm-mixamo-retarget';
import {
  Play,
  Pause,
  Square,
  Upload,
  RotateCcw,
  Camera,
  Sun,
  Layers,
  ChevronDown,
  ChevronUp,
  Eye,
  Grid,
  Activity,
  Film,
  Lock,
  Unlock,
  Users,
  Trash2,
  Check,
  Crosshair,
  Sparkles,
} from 'lucide-react';
import {
  WARDROBE_OUTFITS,
  ANIMATION_SOURCE_DOMAINS,
  AI_PROFILE,
} from '../constants';
import {
  retargetVmdToVRM,
  loadMMDModel,
} from '../lib/mmdPipeline';

export interface AnimationItem {
  key: string;
  name: string;
  type: 'preset' | 'vmd' | 'fbx' | 'custom';
  candidateUrls?: string[];
  clip?: THREE.AnimationClip;
  durationSec?: number;
}

const PRESET_ANIMATIONS: AnimationItem[] = [
  {
    key: 'idle',
    name: 'MMD Idle Posture',
    type: 'preset',
    candidateUrls: [
      '/api/animation/idle',
      'https://muxai.vercel.app/mixamo_idle.fbx',
      'https://muxai.vercel.app/mixamo_idle.fbx',
    ],
  },
  {
    key: 'wave',
    name: 'MMD Wave & Greet',
    type: 'preset',
    candidateUrls: [
      '/api/animation/wave',
      'https://muxai.vercel.app/mixamo_wave.fbx',
      'https://muxai.vercel.app/mixamo_wave.fbx',
    ],
  },
  {
    key: 'walk',
    name: 'Runway Walk',
    type: 'preset',
    candidateUrls: [
      '/api/animation/walk',
      'https://muxai.vercel.app/mixamo_walk.fbx',
      'https://muxai.vercel.app/mixamo_walk.fbx',
    ],
  },
  {
    key: 'wait',
    name: 'Waiting Stance',
    type: 'preset',
    candidateUrls: [
      '/api/animation/wait',
      ...ANIMATION_SOURCE_DOMAINS.map((d) => `${d}/mixamo_wait.fbx`),
    ],
  },
  {
    key: 'yawn',
    name: 'Gentle Yawn',
    type: 'preset',
    candidateUrls: [
      '/api/animation/yawn',
      ...ANIMATION_SOURCE_DOMAINS.map((d) => `${d}/mixamo_yawn.fbx`),
    ],
  },
];

export type CameraLockTarget = 'none' | 'head' | 'face' | 'chest' | 'hips' | 'leftHand' | 'rightHand' | 'root';

export interface StudioModelEntry {
  id: string;
  name: string;
  type: 'vrm' | 'pmx';
  group: THREE.Group;
  vrm?: VRM;
  mmdMesh?: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  actionsMap: Map<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  activeAnimKey: string;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  scale: number;
  visible: boolean;
}

interface MMDStudioPageProps {
  onBackToChat?: () => void;
  onNavigateHome?: () => void;
}

export const MMDStudioPage: React.FC<MMDStudioPageProps> = ({
  onBackToChat,
  onNavigateHome,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js References
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Multi-Model Management
  const modelsMapRef = useRef<Map<string, StudioModelEntry>>(new Map());
  const [modelsList, setModelsList] = useState<
    Array<{
      id: string;
      name: string;
      type: 'vrm' | 'pmx';
      activeAnimKey: string;
      visible: boolean;
      posX: number;
      posY: number;
      posZ: number;
      rotY: number;
      scale: number;
    }>
  >([]);
  const [activeModelId, setActiveModelId] = useState<string>('model_0');
  const [targetModelForAnim, setTargetModelForAnim] = useState<string>('active');

  // Loading State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingMessage, setLoadingMessage] = useState<string>('Initializing MMD Engine...');

  // Active Model Transforms
  const [modelPosX, setModelPosX] = useState<number>(0);
  const [modelPosY, setModelPosY] = useState<number>(0);
  const [modelPosZ, setModelPosZ] = useState<number>(0);
  const [modelRotY, setModelRotY] = useState<number>(0);
  const [modelScale, setModelScale] = useState<number>(1.0);
  const [isWireframe, setIsWireframe] = useState<boolean>(false);

  // Morph / Expressions on Active Model
  const [morphWeights, setMorphWeights] = useState<Record<string, number>>({
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
    blink: 0,
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  });

  // Motion & Animation State
  const [animations, setAnimations] = useState<AnimationItem[]>(PRESET_ANIMATIONS);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [durationSec, setDurationSec] = useState<number>(3.0);
  const [pipelineNote, setPipelineNote] = useState<string>('MMD Multi-Model Studio Engine Active');

  // Camera Settings & Camera Lock State
  const [cameraFov, setCameraFov] = useState<number>(28);
  const [cameraLockTarget, setCameraLockTarget] = useState<CameraLockTarget>('none');
  const [cameraLockModelId, setCameraLockModelId] = useState<string>('active');
  const [cameraLockFollowRotation, setCameraLockFollowRotation] = useState<boolean>(true);
  const cameraLockOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 1.2));
  const isCameraLockInitializedRef = useRef<boolean>(false);

  // Lighting & Stage Settings
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const shadowPlaneRef = useRef<THREE.Mesh | null>(null);

  const [keyLightIntensity, setKeyLightIntensity] = useState<number>(1.2);
  const [keyLightColor, setKeyLightColor] = useState<string>('#ffffff');
  const [ambientLightIntensity, setAmbientLightIntensity] = useState<number>(0.8);
  const [ambientLightColor, setAmbientLightColor] = useState<string>('#ffffff');
  const [rimLightIntensity, setRimLightIntensity] = useState<number>(0.4);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAxes, setShowAxes] = useState<boolean>(false);
  const [stageBackground, setStageBackground] = useState<'studio' | 'horizon' | 'cyber' | 'black'>(
    'studio'
  );

  // UI Dock & Rail
  const [isRailExpanded, setIsRailExpanded] = useState<boolean>(true);
  const [activeDockTab, setActiveDockTab] = useState<'model' | 'motion' | 'camera' | 'stage' | 'pipeline'>('model');
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);

  // Synchronize UI models list with ref
  const syncModelsListFromRef = useCallback(() => {
    const list = Array.from(modelsMapRef.current.values()).map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      activeAnimKey: m.activeAnimKey,
      visible: m.visible,
      posX: m.posX,
      posY: m.posY,
      posZ: m.posZ,
      rotY: m.rotY,
      scale: m.scale,
    }));
    setModelsList(list);
  }, []);

  // Update transform states when active model changes
  const handleSelectActiveModel = useCallback((modelId: string) => {
    setActiveModelId(modelId);
    const m = modelsMapRef.current.get(modelId);
    if (m) {
      setModelPosX(m.posX);
      setModelPosY(m.posY);
      setModelPosZ(m.posZ);
      setModelRotY(m.rotY);
      setModelScale(m.scale);
    }
  }, []);

  // Apply transforms to active model
  useEffect(() => {
    const entry = modelsMapRef.current.get(activeModelId);
    if (entry) {
      entry.posX = modelPosX;
      entry.posY = modelPosY;
      entry.posZ = modelPosZ;
      entry.rotY = modelRotY;
      entry.scale = modelScale;
      entry.group.position.set(modelPosX, modelPosY, modelPosZ);
      entry.group.rotation.y = (modelRotY * Math.PI) / 180;
      entry.group.scale.set(modelScale, modelScale, modelScale);
      syncModelsListFromRef();
    }
  }, [activeModelId, modelPosX, modelPosY, modelPosZ, modelRotY, modelScale, syncModelsListFromRef]);

  // Update Wireframe
  useEffect(() => {
    modelsMapRef.current.forEach((entry) => {
      entry.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = (child as THREE.Mesh).material;
          if (Array.isArray(m)) {
            m.forEach((mat) => {
              if ('wireframe' in mat) (mat as any).wireframe = isWireframe;
            });
          } else if (m && 'wireframe' in m) {
            (m as any).wireframe = isWireframe;
          }
        }
      });
    });
  }, [isWireframe]);

  // Update Morph Weights on active VRM model
  const handleMorphChange = useCallback(
    (morphKey: string, value: number) => {
      setMorphWeights((prev) => ({ ...prev, [morphKey]: value }));
      const entry = modelsMapRef.current.get(activeModelId);
      if (entry?.vrm?.expressionManager) {
        entry.vrm.expressionManager.setValue(morphKey as any, value);
        entry.vrm.expressionManager.update();
      }
    },
    [activeModelId]
  );

  // Toggle Visibility of a Model
  const handleToggleModelVisibility = useCallback(
    (modelId: string) => {
      const entry = modelsMapRef.current.get(modelId);
      if (entry) {
        entry.visible = !entry.visible;
        entry.group.visible = entry.visible;
        syncModelsListFromRef();
      }
    },
    [syncModelsListFromRef]
  );

  // Remove a Model from the Scene
  const handleRemoveModel = useCallback(
    (modelId: string) => {
      const entry = modelsMapRef.current.get(modelId);
      const scene = sceneRef.current;
      if (entry && scene) {
        scene.remove(entry.group);
        if (entry.vrm) {
          VRMUtils.deepDispose(entry.group);
        }
        modelsMapRef.current.delete(modelId);
        syncModelsListFromRef();
        if (activeModelId === modelId) {
          const remaining = Array.from(modelsMapRef.current.keys())[0] || '';
          setActiveModelId(remaining);
        }
      }
    },
    [activeModelId, syncModelsListFromRef]
  );

  // ----------------------------------------------------
  // Animation Playback for Multi-Model System
  // ----------------------------------------------------
  const playAnimationOnEntry = useCallback(
    (entry: StudioModelEntry, key: string, crossFadeDuration = 0.25) => {
      const targetAction = entry.actionsMap.get(key);
      if (!targetAction) return;

      const prevAction = entry.currentAction;
      targetAction.reset();
      targetAction.timeScale = playbackSpeed;
      targetAction.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      targetAction.clampWhenFinished = !isLooping;
      targetAction.fadeIn(crossFadeDuration);
      targetAction.play();

      if (prevAction && prevAction !== targetAction) {
        prevAction.fadeOut(crossFadeDuration);
      }

      entry.currentAction = targetAction;
      entry.activeAnimKey = key;

      const clip = targetAction.getClip();
      if (clip) {
        setDurationSec(clip.duration);
      }
    },
    [isLooping, playbackSpeed]
  );

  // Public method to trigger animation on Active Model, Specific Model, or All Models
  const playAnimationByKey = useCallback(
    (key: string, targetChoice?: string) => {
      const target = targetChoice || targetModelForAnim;
      if (target === 'all') {
        modelsMapRef.current.forEach((entry) => {
          playAnimationOnEntry(entry, key);
        });
      } else {
        const targetId = target === 'active' ? activeModelId : target;
        const entry = modelsMapRef.current.get(targetId);
        if (entry) {
          playAnimationOnEntry(entry, key);
        }
      }
      setIsPlaying(true);
      syncModelsListFromRef();
      setPipelineNote(`Applied Motion: "${key}" to ${target === 'all' ? 'All Models' : target}`);
    },
    [targetModelForAnim, activeModelId, playAnimationOnEntry, syncModelsListFromRef]
  );

  // Transport Controls
  const handleTogglePlay = useCallback(() => {
    modelsMapRef.current.forEach((entry) => {
      if (entry.currentAction) {
        entry.currentAction.paused = isPlaying;
      }
    });
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleStop = useCallback(() => {
    modelsMapRef.current.forEach((entry) => {
      if (entry.currentAction) {
        entry.currentAction.stop();
        entry.currentAction.reset();
      }
    });
    setIsPlaying(false);
    setCurrentTimeSec(0);
  }, []);

  const handleSeek = useCallback((time: number) => {
    modelsMapRef.current.forEach((entry) => {
      if (entry.currentAction) {
        entry.currentAction.time = time;
        entry.mixer.update(0);
      }
    });
    setCurrentTimeSec(time);
  }, []);

  // Update speed across all models
  useEffect(() => {
    modelsMapRef.current.forEach((entry) => {
      if (entry.currentAction) {
        entry.currentAction.timeScale = playbackSpeed;
      }
    });
  }, [playbackSpeed]);

  // Update looping across all models
  useEffect(() => {
    modelsMapRef.current.forEach((entry) => {
      if (entry.currentAction) {
        entry.currentAction.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        entry.currentAction.clampWhenFinished = !isLooping;
      }
    });
  }, [isLooping]);

  // ----------------------------------------------------
  // Camera Lock & Viewport Helpers
  // ----------------------------------------------------
  const handleSetCameraLock = useCallback((target: CameraLockTarget) => {
    setCameraLockTarget(target);
    isCameraLockInitializedRef.current = false;
  }, []);

  const setCameraPreset = useCallback(
    (preset: 'front' | 'face' | 'bust' | 'full' | 'isometric' | 'low') => {
      const cam = cameraRef.current;
      const controls = controlsRef.current;
      if (!cam || !controls) return;

      setCameraLockTarget('none');
      isCameraLockInitializedRef.current = false;

      if (preset === 'front') {
        cam.position.set(0.0, 1.25, 2.2);
        controls.target.set(0.0, 1.1, 0.0);
      } else if (preset === 'face') {
        cam.position.set(0.0, 1.35, 0.75);
        controls.target.set(0.0, 1.32, 0.0);
      } else if (preset === 'bust') {
        cam.position.set(0.0, 1.25, 1.3);
        controls.target.set(0.0, 1.15, 0.0);
      } else if (preset === 'full') {
        cam.position.set(0.0, 0.9, 3.4);
        controls.target.set(0.0, 0.85, 0.0);
      } else if (preset === 'isometric') {
        cam.position.set(1.8, 1.8, 2.0);
        controls.target.set(0.0, 1.0, 0.0);
      } else if (preset === 'low') {
        cam.position.set(0.0, 0.25, 1.8);
        controls.target.set(0.0, 1.0, 0.0);
      }
      controls.update();
    },
    []
  );

  // Update camera FOV
  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.fov = cameraFov;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [cameraFov]);

  // Lighting Updates
  useEffect(() => {
    if (keyLightRef.current) {
      keyLightRef.current.intensity = keyLightIntensity;
      keyLightRef.current.color.set(keyLightColor);
    }
  }, [keyLightIntensity, keyLightColor]);

  useEffect(() => {
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = ambientLightIntensity;
      ambientLightRef.current.color.set(ambientLightColor);
    }
  }, [ambientLightIntensity, ambientLightColor]);

  useEffect(() => {
    if (rimLightRef.current) {
      rimLightRef.current.intensity = rimLightIntensity;
    }
  }, [rimLightIntensity]);

  useEffect(() => {
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = showGrid;
    }
  }, [showGrid]);

  useEffect(() => {
    if (axesHelperRef.current) {
      axesHelperRef.current.visible = showAxes;
    }
  }, [showAxes]);

  // ----------------------------------------------------
  // Preload Preset Animations onto a VRM Entry
  // ----------------------------------------------------
  const loadPresetAnimationsForVRMEntry = useCallback(
    async (entry: StudioModelEntry) => {
      const vrm = entry.vrm;
      if (!vrm) return;
      const fbxLoader = new FBXLoader();

      for (const anim of PRESET_ANIMATIONS) {
        if (!anim.candidateUrls) continue;
        for (const url of anim.candidateUrls) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const buffer = await resp.arrayBuffer();
            const fbx = fbxLoader.parse(buffer, '');
            const clip = retargetAnimation(fbx, vrm);
            if (clip) {
              const action = entry.mixer.clipAction(clip);
              entry.actionsMap.set(anim.key, action);
              break;
            }
          } catch {
            // Next candidate URL
          }
        }
      }

      const idleAction = entry.actionsMap.get('idle');
      if (idleAction) {
        idleAction.play();
        entry.currentAction = idleAction;
        entry.activeAnimKey = 'idle';
      }
    },
    []
  );

  // ----------------------------------------------------
  // Register and Add Model into Scene
  // ----------------------------------------------------
  const registerNewModel = useCallback(
    async (params: {
      name: string;
      type: 'vrm' | 'pmx';
      group: THREE.Group;
      vrm?: VRM;
      mmdMesh?: THREE.SkinnedMesh;
      spawnOffsetX?: number;
    }) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const modelId = `model_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const mixer = new THREE.AnimationMixer(params.type === 'vrm' ? params.vrm!.scene : params.mmdMesh!);
      const spawnX = params.spawnOffsetX !== undefined ? params.spawnOffsetX : 0;

      params.group.position.set(spawnX, 0, 0);
      scene.add(params.group);

      const entry: StudioModelEntry = {
        id: modelId,
        name: params.name,
        type: params.type,
        group: params.group,
        vrm: params.vrm,
        mmdMesh: params.mmdMesh,
        mixer,
        actionsMap: new Map(),
        currentAction: null,
        activeAnimKey: 'idle',
        posX: spawnX,
        posY: 0,
        posZ: 0,
        rotY: 0,
        scale: params.type === 'pmx' ? 0.08 : 1.0,
        visible: true,
      };

      modelsMapRef.current.set(modelId, entry);

      if (params.type === 'vrm') {
        await loadPresetAnimationsForVRMEntry(entry);
      }

      setActiveModelId(modelId);
      syncModelsListFromRef();
      return entry;
    },
    [loadPresetAnimationsForVRMEntry, syncModelsListFromRef]
  );

  // ----------------------------------------------------
  // MULTI-MODEL UPLOAD HANDLER: Allows uploading multiple files at once (.vrm / .pmx / .pmd)
  // ----------------------------------------------------
  const handleMultipleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    setIsLoading(true);
    setLoadingMessage(`Importing ${files.length} model(s)...`);

    try {
      const gltfLoader = new GLTFLoader();
      gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

      const count = files.length;
      const spacing = 1.3;

      for (let i = 0; i < count; i++) {
        const file = files[i];
        const lowerName = file.name.toLowerCase();
        const offsetX = (i - (count - 1) / 2) * spacing;

        if (lowerName.endsWith('.vrm')) {
          const buffer = await file.arrayBuffer();
          await new Promise<void>((resolve) => {
            gltfLoader.parse(
              buffer,
              '',
              async (gltf) => {
                const vrm = gltf.userData.vrm as VRM;
                if (vrm) {
                  VRMUtils.rotateVRM0(vrm);
                  const group = new THREE.Group();
                  group.add(vrm.scene);
                  await registerNewModel({
                    name: file.name.replace(/\.vrm$/i, ''),
                    type: 'vrm',
                    group,
                    vrm,
                    spawnOffsetX: offsetX,
                  });
                }
                resolve();
              },
              (err) => {
                console.error('Error parsing VRM file:', err);
                resolve();
              }
            );
          });
        } else if (lowerName.endsWith('.pmx') || lowerName.endsWith('.pmd')) {
          const mesh = await loadMMDModel(file);
          const group = new THREE.Group();
          mesh.scale.set(0.08, 0.08, 0.08);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);

          await registerNewModel({
            name: file.name.replace(/\.(pmx|pmd)$/i, ''),
            type: 'pmx',
            group,
            mmdMesh: mesh,
            spawnOffsetX: offsetX,
          });
        }
      }

      setPipelineNote(`Loaded ${count} model(s) into stage`);
    } catch (err) {
      console.error('Failed to import models:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ----------------------------------------------------
  // MULTI-MOTION UPLOAD HANDLER (.vmd or .fbx)
  // ----------------------------------------------------
  const handleMotionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    setIsLoading(true);
    setLoadingMessage(`Importing Motion ${file.name}...`);

    try {
      const buffer = await file.arrayBuffer();
      const motionKey = `motion_${Date.now()}`;
      let motionClip: THREE.AnimationClip | null = null;
      let motionDuration = 3.0;

      // Determine target model
      const targetEntries: StudioModelEntry[] =
        targetModelForAnim === 'all'
          ? Array.from(modelsMapRef.current.values())
          : [modelsMapRef.current.get(targetModelForAnim === 'active' ? activeModelId : targetModelForAnim)].filter(
              Boolean
            ) as StudioModelEntry[];

      if (lowerName.endsWith('.vmd')) {
        for (const entry of targetEntries) {
          if (entry.vrm) {
            const result = retargetVmdToVRM(buffer, entry.vrm);
            motionClip = result.clip;
            motionDuration = result.durationSec;
            const action = entry.mixer.clipAction(result.clip);
            action.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
            entry.actionsMap.set(motionKey, action);
          }
        }
      } else if (lowerName.endsWith('.fbx')) {
        const fbxLoader = new FBXLoader();
        const fbxGroup = fbxLoader.parse(buffer, '');
        for (const entry of targetEntries) {
          if (entry.vrm) {
            const clip = retargetAnimation(fbxGroup, entry.vrm);
            if (clip) {
              motionClip = clip;
              motionDuration = clip.duration;
              const action = entry.mixer.clipAction(clip);
              action.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
              entry.actionsMap.set(motionKey, action);
            }
          }
        }
      }

      if (motionClip) {
        setAnimations((prev) => [
          ...prev,
          {
            key: motionKey,
            name: file.name.replace(/\.(vmd|fbx)$/i, ''),
            type: lowerName.endsWith('.vmd') ? 'vmd' : 'fbx',
            clip: motionClip!,
            durationSec: motionDuration,
          },
        ]);
        playAnimationByKey(motionKey);
      }
    } catch (err) {
      console.error('Failed to parse motion:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ----------------------------------------------------
  // Three.js Scene Initialization & Render Loop
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
      cameraFov,
      container.clientWidth / container.clientHeight,
      0.1,
      60.0
    );
    camera.position.set(0.0, 1.25, 2.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0.0, 1.1, 0.0);
    controls.minDistance = 0.4;
    controls.maxDistance = 12.0;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(ambientLightColor, ambientLightIntensity);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const keyLight = new THREE.DirectionalLight(keyLightColor, keyLightIntensity);
    keyLight.position.set(2.0, 3.5, 2.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    const rimLight = new THREE.DirectionalLight(0xffffff, rimLightIntensity);
    rimLight.position.set(-2.0, 3.0, -2.5);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    // Grid & Shadow Plane
    const grid = new THREE.GridHelper(12, 24, 0x55d2f6, 0x334155);
    grid.position.y = 0;
    scene.add(grid);
    gridHelperRef.current = grid;

    const axes = new THREE.AxesHelper(1.5);
    axes.position.y = 0.001;
    axes.visible = showAxes;
    scene.add(axes);
    axesHelperRef.current = axes;

    const shadowGeo = new THREE.PlaneGeometry(12, 12);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);
    shadowPlaneRef.current = shadowPlane;

    // Load initial default outfit (VRM)
    const initialOutfit = WARDROBE_OUTFITS[0];
    const modelUrl = `/api/vrm?file=${encodeURIComponent(initialOutfit.fileName)}`;
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    fetch(modelUrl)
      .then((r) => (r.ok ? r.arrayBuffer() : fetch(initialOutfit.modelUrl).then((res) => res.arrayBuffer())))
      .then((buf) => {
        if (isDisposed) return;
        gltfLoader.parse(
          buf,
          '',
          async (gltf) => {
            if (isDisposed) return;
            const vrm = gltf.userData.vrm as VRM;
            if (vrm) {
              VRMUtils.rotateVRM0(vrm);
              const group = new THREE.Group();
              group.add(vrm.scene);
              await registerNewModel({
                name: initialOutfit.name,
                type: 'vrm',
                group,
                vrm,
                spawnOffsetX: 0,
              });
              setIsLoading(false);
            }
          },
          (err) => console.error(err)
        );
      })
      .catch((err) => {
        console.error('Failed to load initial outfit:', err);
        setIsLoading(false);
      });

    // Clock & Render Loop
    const clock = new THREE.Clock();

    const animate = () => {
      if (isDisposed) return;
      rafId = requestAnimationFrame(animate);

      const delta = clock.getDelta();

      // Update mixers and VRMs across ALL active models
      modelsMapRef.current.forEach((entry) => {
        if (entry.visible) {
          entry.mixer.update(delta);
          if (entry.vrm) {
            entry.vrm.update(delta);
          }
        }
      });

      // Update timeline scrubber from active model
      const activeEntry = modelsMapRef.current.get(activeModelId);
      if (activeEntry?.currentAction) {
        setCurrentTimeSec(activeEntry.currentAction.time % durationSec);
      }

      // ----------------------------------------------------
      // CAMERA LOCKING: Keep camera fixed at body part relative to local space
      // ----------------------------------------------------
      if (cameraLockTarget !== 'none') {
        const targetModel =
          cameraLockModelId === 'active'
            ? modelsMapRef.current.get(activeModelId)
            : modelsMapRef.current.get(cameraLockModelId) || Array.from(modelsMapRef.current.values())[0];

        if (targetModel && targetModel.group) {
          const targetWorldPos = new THREE.Vector3();
          const targetQuat = new THREE.Quaternion();
          targetModel.group.getWorldQuaternion(targetQuat);

          let foundBone = false;
          if (targetModel.vrm?.humanoid) {
            let boneName = '';
            if (cameraLockTarget === 'head' || cameraLockTarget === 'face') boneName = 'head';
            else if (cameraLockTarget === 'chest') boneName = 'chest';
            else if (cameraLockTarget === 'hips') boneName = 'hips';
            else if (cameraLockTarget === 'leftHand') boneName = 'leftHand';
            else if (cameraLockTarget === 'rightHand') boneName = 'rightHand';

            if (boneName) {
              const boneNode = targetModel.vrm.humanoid.getNormalizedBoneNode(boneName as any);
              if (boneNode) {
                boneNode.getWorldPosition(targetWorldPos);
                if (cameraLockTarget === 'face') {
                  targetWorldPos.y += 0.06; // Eye level slight adjustment
                }
                foundBone = true;
              }
            }
          }

          if (!foundBone) {
            targetModel.group.getWorldPosition(targetWorldPos);
            if (cameraLockTarget === 'head' || cameraLockTarget === 'face') targetWorldPos.y += 1.35;
            else if (cameraLockTarget === 'chest') targetWorldPos.y += 1.05;
            else if (cameraLockTarget === 'hips') targetWorldPos.y += 0.75;
          }

          // Compute initial local offset when lock first engages
          if (!isCameraLockInitializedRef.current) {
            const worldDiff = camera.position.clone().sub(targetWorldPos);
            const invQuat = targetQuat.clone().invert();
            cameraLockOffsetRef.current = worldDiff.applyQuaternion(invQuat);

            // If offset is zero or too close, default to comfortable preset offset
            if (cameraLockOffsetRef.current.lengthSq() < 0.05) {
              if (cameraLockTarget === 'head' || cameraLockTarget === 'face') {
                cameraLockOffsetRef.current.set(0, 0.02, 0.85);
              } else if (cameraLockTarget === 'chest') {
                cameraLockOffsetRef.current.set(0, 0, 1.25);
              } else if (cameraLockTarget === 'hips') {
                cameraLockOffsetRef.current.set(0, 0, 1.6);
              } else {
                cameraLockOffsetRef.current.set(0, 0, 1.2);
              }
            }
            isCameraLockInitializedRef.current = true;
          }

          // Position camera firmly relative to the model's body part & local coordinate space
          if (cameraLockFollowRotation) {
            const rotatedOffset = cameraLockOffsetRef.current.clone().applyQuaternion(targetQuat);
            camera.position.copy(targetWorldPos).add(rotatedOffset);
          } else {
            camera.position.copy(targetWorldPos).add(cameraLockOffsetRef.current);
          }
          controls.target.copy(targetWorldPos);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // Snapshot Tool
  const handleTakeSnapshot = useCallback(() => {
    if (!rendererRef.current) return;
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `mmd_snapshot_${Date.now()}.png`;
    a.click();
  }, []);

  // Background style
  const bgClass =
    stageBackground === 'studio'
      ? 'bg-gradient-to-b from-[#181a24] to-[#0c0d14]'
      : stageBackground === 'horizon'
      ? 'bg-gradient-to-b from-[#1e293b] via-[#0f172a] to-[#020617]'
      : stageBackground === 'cyber'
      ? 'bg-gradient-to-b from-[#09182b] to-[#040814]'
      : 'bg-[#000000]';

  return (
    <div className={`relative h-screen w-screen overflow-hidden select-none ${bgClass} text-white font-sans`}>
      {/* 3D Canvas Viewport */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full">
        <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing touch-none" />
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl border-4 border-[var(--theme-accent,#55d2f6)] border-t-transparent animate-spin mb-3 shadow-lg" />
          <p className="text-sm font-semibold tracking-wide text-white">{loadingMessage}</p>
          <p className="text-xs text-neutral-400 mt-1 font-mono">MMD Multi-Model Studio</p>
        </div>
      )}

      {/* Top Left Navigation & Branding */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        {onBackToChat && (
          <button
            type="button"
            onClick={onBackToChat}
            className="px-3.5 py-2 rounded-2xl bg-[#161822]/85 hover:bg-[#1e2230] border border-white/10 text-xs font-semibold backdrop-blur-xl flex items-center gap-1.5 shadow-xl transition-all active:scale-95 cursor-pointer text-white"
          >
            <span>&larr;</span>
            <span>Back to Chat</span>
          </button>
        )}

        {onNavigateHome && (
          <button
            type="button"
            onClick={onNavigateHome}
            className="p-2 rounded-2xl bg-[#161822]/85 hover:bg-[#1e2230] border border-white/10 text-xs font-semibold backdrop-blur-xl flex items-center justify-center shadow-xl transition-all active:scale-95 cursor-pointer text-neutral-300 hover:text-white"
            title="Home"
          >
            <span>Home</span>
          </button>
        )}

        {/* Camera Lock Quick Status Indicator on Top Bar */}
        {cameraLockTarget !== 'none' && (
          <div className="px-3 py-1.5 rounded-2xl bg-[var(--theme-accent,#55d2f6)]/20 border border-[var(--theme-accent,#55d2f6)]/50 backdrop-blur-md text-xs font-mono flex items-center gap-1.5 text-[var(--theme-accent,#55d2f6)]">
            <Lock className="w-3.5 h-3.5 animate-pulse" />
            <span>
              Locked: {cameraLockTarget.toUpperCase()} ({cameraLockFollowRotation ? 'Local' : 'World'})
            </span>
            <button
              type="button"
              onClick={() => handleSetCameraLock('none')}
              className="ml-1 text-white hover:text-red-400 cursor-pointer"
              title="Unlock Camera"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {/* Right Top Viewport Quick Tools Rail */}
      <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="p-2 rounded-2xl bg-[#161822]/90 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setIsRailExpanded(!isRailExpanded)}
            className="p-1.5 rounded-xl text-neutral-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Toggle Quick Tools"
          >
            <Activity className="w-4 h-4" />
          </button>

          <span className="font-semibold text-xs px-1 text-neutral-200">
            {modelsList.length} Model{modelsList.length === 1 ? '' : 's'} Active
          </span>
        </div>

        {/* Expanded Rail Details */}
        {isRailExpanded && (
          <div className="p-3 rounded-2xl bg-[#161822]/90 backdrop-blur-xl border border-white/10 shadow-2xl space-y-2 text-xs w-64">
            <div className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.04] border border-white/5 text-[11px] text-neutral-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              <div className="truncate flex items-center gap-1 min-w-0">
                <span className="truncate">{pipelineNote}</span>
              </div>
            </div>

            {/* Camera Lock Quick Buttons */}
            <div className="space-y-1 pt-1 border-t border-white/10">
              <span className="text-[10px] font-mono text-neutral-400 block flex items-center gap-1">
                <Crosshair className="w-3 h-3 text-[var(--theme-accent,#55d2f6)]" />
                Camera Body Lock:
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { key: 'none', label: 'Free' },
                    { key: 'head', label: 'Head' },
                    { key: 'face', label: 'Face' },
                    { key: 'chest', label: 'Chest' },
                    { key: 'hips', label: 'Hips' },
                    { key: 'leftHand', label: 'L Hand' },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => handleSetCameraLock(b.key)}
                    className={`py-1 px-1.5 rounded-lg text-[10px] font-medium border text-center transition-all cursor-pointer ${
                      cameraLockTarget === b.key
                        ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 border-transparent font-bold shadow-xs'
                        : 'bg-white/5 border-white/5 text-neutral-300 hover:bg-white/10'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="grid grid-cols-4 gap-1.5 pt-1 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowGrid(!showGrid)}
                className={`py-1.5 px-2 rounded-xl text-[10px] font-medium border flex flex-col items-center gap-1 cursor-pointer transition-all ${
                  showGrid
                    ? 'bg-[var(--theme-accent,#55d2f6)]/20 border-[var(--theme-accent,#55d2f6)] text-white'
                    : 'bg-white/5 border-white/5 text-neutral-400'
                }`}
                title="Toggle MMD stage grid"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>

              <button
                type="button"
                onClick={() => setIsWireframe(!isWireframe)}
                className={`py-1.5 px-2 rounded-xl text-[10px] font-medium border flex flex-col items-center gap-1 cursor-pointer transition-all ${
                  isWireframe
                    ? 'bg-[var(--theme-accent,#55d2f6)]/20 border-[var(--theme-accent,#55d2f6)] text-white'
                    : 'bg-white/5 border-white/5 text-neutral-400'
                }`}
                title="Toggle mesh wireframe"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Wire</span>
              </button>

              <button
                type="button"
                onClick={() => setCameraPreset('front')}
                className="py-1.5 px-2 rounded-xl text-[10px] font-medium bg-white/5 border border-white/5 text-neutral-300 hover:bg-white/10 flex flex-col items-center gap-1 cursor-pointer transition-all"
                title="Reset Camera to front"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={handleTakeSnapshot}
                className="py-1.5 px-2 rounded-xl text-[10px] font-medium bg-white/5 border border-white/5 text-neutral-300 hover:bg-white/10 flex flex-col items-center gap-1 cursor-pointer transition-all"
                title="Save screenshot PNG"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Photo</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------
          Bottom MMD Studio Dock (Multi-Model / Motion / Camera / Stage)
         ---------------------------------------------------- */}
      <div className="absolute bottom-4 left-4 right-4 z-20 flex justify-center pointer-events-none">
        <div className="w-full max-w-4xl backdrop-blur-xl bg-[#13151f]/95 border border-white/10 rounded-3xl shadow-2xl overflow-hidden pointer-events-auto transition-all duration-200">
          {/* Dock Header & Tab Switcher */}
          <div className="px-3 sm:px-4 py-2 border-b border-white/10 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto">
              {[
                { key: 'model', label: 'Models', icon: Users },
                { key: 'motion', label: 'Motion & VMD', icon: Film },
                { key: 'camera', label: 'Camera & Lock', icon: Camera },
                { key: 'stage', label: 'Stage & Light', icon: Sun },
                { key: 'pipeline', label: 'Pipeline', icon: Activity },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeDockTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setActiveDockTab(tab.key as any);
                      setIsDockCollapsed(false);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isActive && !isDockCollapsed
                        ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setIsDockCollapsed(!isDockCollapsed)}
              className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/5 cursor-pointer shrink-0 transition-colors"
              title={isDockCollapsed ? 'Expand Dock' : 'Collapse Dock'}
            >
              {isDockCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Dock Body */}
          {!isDockCollapsed && (
            <div className="p-3 sm:p-4 max-h-64 sm:max-h-72 overflow-y-auto text-xs space-y-4">
              {/* TAB 1: MULTI-MODEL MANAGEMENT */}
              {activeDockTab === 'model' && (
                <div className="space-y-3">
                  {/* Multi-Model Upload Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-neutral-200 block text-xs">Stage Models</span>
                      <span className="text-[11px] text-neutral-400">
                        Select multiple .vrm / .pmx files to upload and pose simultaneously
                      </span>
                    </div>

                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--theme-accent,#55d2f6)] text-neutral-950 font-semibold text-xs cursor-pointer transition-transform active:scale-95 shadow-md">
                      <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Upload Multiple Models</span>
                      <input
                        type="file"
                        multiple
                        accept=".vrm,.pmx,.pmd"
                        onChange={handleMultipleModelUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Active Loaded Models Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {modelsList.map((m) => {
                      const isSelected = activeModelId === m.id;
                      return (
                        <div
                          key={m.id}
                          className={`p-2.5 rounded-2xl border transition-all flex items-center justify-between gap-2 ${
                            isSelected
                              ? 'bg-[var(--theme-accent,#55d2f6)]/15 border-[var(--theme-accent,#55d2f6)] ring-1 ring-[var(--theme-accent,#55d2f6)]'
                              : 'bg-white/5 border-white/5 hover:border-white/15'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectActiveModel(m.id)}
                            className="flex-1 text-left min-w-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-white truncate">{m.name}</span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-white/10 uppercase">
                                {m.type}
                              </span>
                            </div>
                            <span className="text-[10px] text-neutral-400 font-mono block truncate mt-0.5">
                              Anim: {m.activeAnimKey} &bull; X: {m.posX.toFixed(1)}m
                            </span>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleModelVisibility(m.id)}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                m.visible ? 'text-neutral-300 hover:text-white' : 'text-neutral-600 hover:text-neutral-400'
                              }`}
                              title={m.visible ? 'Hide Model' : 'Show Model'}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {modelsList.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveModel(m.id)}
                                className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 transition-colors cursor-pointer"
                                title="Remove Model from Stage"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Preset Wardrobe Additions */}
                  <div className="pt-2 border-t border-white/10 space-y-1.5">
                    <span className="text-[11px] font-semibold text-neutral-300 block">
                      Quick Add Character Outfits:
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {WARDROBE_OUTFITS.slice(0, 6).map((outfit) => (
                        <button
                          key={outfit.id}
                          type="button"
                          onClick={() => {
                            setIsLoading(true);
                            setLoadingMessage(`Adding ${outfit.name}...`);
                            const gltfLoader = new GLTFLoader();
                            gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
                            fetch(`/api/vrm?file=${encodeURIComponent(outfit.fileName)}`)
                              .then((r) => r.arrayBuffer())
                              .then((buf) => {
                                gltfLoader.parse(buf, '', async (g) => {
                                  if (g.userData.vrm) {
                                    const vrm = g.userData.vrm as VRM;
                                    VRMUtils.rotateVRM0(vrm);
                                    const group = new THREE.Group();
                                    group.add(vrm.scene);
                                    const nextOffset = (modelsMapRef.current.size % 2 === 0 ? 1 : -1) * (1.1 + modelsMapRef.current.size * 0.4);
                                    await registerNewModel({
                                      name: outfit.name,
                                      type: 'vrm',
                                      group,
                                      vrm,
                                      spawnOffsetX: nextOffset,
                                    });
                                    setIsLoading(false);
                                  }
                                });
                              })
                              .catch(() => setIsLoading(false));
                          }}
                          className="px-2.5 py-1 rounded-xl text-[11px] font-medium bg-white/5 border border-white/5 text-neutral-300 hover:bg-white/10 cursor-pointer transition-all"
                        >
                          + {outfit.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Active Model Transform Controls */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/10">
                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400">
                        <span>Position X</span>
                        <span>{modelPosX.toFixed(2)}m</span>
                      </div>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.05"
                        value={modelPosX}
                        onChange={(e) => setModelPosX(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400">
                        <span>Position Z</span>
                        <span>{modelPosZ.toFixed(2)}m</span>
                      </div>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.05"
                        value={modelPosZ}
                        onChange={(e) => setModelPosZ(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400">
                        <span>Rotation Y</span>
                        <span>{modelRotY}°</span>
                      </div>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="5"
                        value={modelRotY}
                        onChange={(e) => setModelRotY(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-neutral-400">
                        <span>Scale</span>
                        <span>{modelScale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.3"
                        max="2.5"
                        step="0.05"
                        value={modelScale}
                        onChange={(e) => setModelScale(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Morph / Expression BlendShapes for Active VRM */}
                  <div className="space-y-2 pt-2 border-t border-white/10">
                    <span className="font-semibold text-neutral-300 block">
                      Active Model Facial Expressions:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['happy', 'angry', 'sad', 'relaxed', 'blink', 'aa', 'ih', 'ou'].map((key) => (
                        <div key={key} className="p-2 rounded-xl bg-white/[0.03] border border-white/5">
                          <div className="flex justify-between text-[10px] text-neutral-400 capitalize">
                            <span>{key}</span>
                            <span>{((morphWeights[key] || 0) * 100).toFixed(0)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={morphWeights[key] || 0}
                            onChange={(e) => handleMorphChange(key, parseFloat(e.target.value))}
                            className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MOTION & VMD / FBX (With Unique Animation Routing) */}
              {activeDockTab === 'motion' && (
                <div className="space-y-3">
                  {/* Target Model for Motion Routing */}
                  <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/5 flex items-center justify-between gap-2">
                    <span className="text-xs text-neutral-300 font-semibold flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)]" />
                      Apply Motion To:
                    </span>
                    <select
                      value={targetModelForAnim}
                      onChange={(e) => setTargetModelForAnim(e.target.value)}
                      className="bg-[#161822] text-xs text-white border border-white/10 rounded-xl px-2.5 py-1 focus:outline-none cursor-pointer"
                    >
                      <option value="active">Active Model (Selected)</option>
                      <option value="all">All Models (Synchronized)</option>
                      {modelsList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.type.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Transport & Timeline Scrubber */}
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleTogglePlay}
                          className="p-2 rounded-xl bg-[var(--theme-accent,#55d2f6)] text-neutral-950 font-bold hover:opacity-90 cursor-pointer"
                        >
                          {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        </button>
                        <button
                          type="button"
                          onClick={handleStop}
                          className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/15 cursor-pointer"
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsLooping(!isLooping)}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium border cursor-pointer ${
                            isLooping
                              ? 'bg-[var(--theme-accent,#55d2f6)]/20 border-[var(--theme-accent,#55d2f6)] text-white'
                              : 'bg-white/5 border-white/5 text-neutral-400'
                          }`}
                        >
                          Loop: {isLooping ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      <div className="font-mono text-[11px] text-neutral-300">
                        {(currentTimeSec).toFixed(2)}s / {(durationSec).toFixed(2)}s
                      </div>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={durationSec}
                      step="0.033"
                      value={currentTimeSec}
                      onChange={(e) => handleSeek(parseFloat(e.target.value))}
                      className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                    />

                    {/* Speed Multiplier */}
                    <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-1">
                      <span>Playback Speed:</span>
                      <div className="flex items-center gap-1">
                        {[0.5, 1.0, 1.5, 2.0].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setPlaybackSpeed(s)}
                            className={`px-2 py-0.5 rounded-lg font-mono cursor-pointer ${
                              playbackSpeed === s
                                ? 'bg-white text-neutral-900 font-bold'
                                : 'bg-white/5 hover:bg-white/10 text-neutral-300'
                            }`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Motion Presets Library */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-300">Animation Library</span>
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[11px] cursor-pointer transition-colors">
                        <Upload className="w-3 h-3" />
                        <span>Import .vmd / .fbx</span>
                        <input
                          type="file"
                          accept=".vmd,.fbx"
                          onChange={handleMotionUpload}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {animations.map((anim) => {
                        const activeEntry = modelsMapRef.current.get(activeModelId);
                        const isSelected = activeEntry?.activeAnimKey === anim.key;
                        return (
                          <button
                            key={anim.key}
                            type="button"
                            onClick={() => playAnimationByKey(anim.key)}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                              isSelected
                                ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 border-transparent font-semibold shadow-xs'
                                : 'bg-white/5 border-white/5 text-neutral-300 hover:bg-white/10'
                            }`}
                          >
                            <span className="truncate">{anim.name}</span>
                            <span className="text-[10px] font-mono opacity-60 uppercase">{anim.type}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: CAMERA & LOCAL SPACE CAMERA LOCKING */}
              {activeDockTab === 'camera' && (
                <div className="space-y-4">
                  {/* Camera Body Part Locking Section */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-neutral-200 block text-xs flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-[var(--theme-accent,#55d2f6)]" />
                          Body Part Camera Locking
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          Lock camera to stay fixed at a body part relative to the model's local space
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-neutral-300 flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cameraLockFollowRotation}
                            onChange={(e) => setCameraLockFollowRotation(e.target.checked)}
                            className="rounded accent-[var(--theme-accent,#55d2f6)]"
                          />
                          <span>Follow Local Rotation</span>
                        </label>
                      </div>
                    </div>

                    {/* Model to Lock Target */}
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-neutral-400">Lock Target Model:</span>
                      <select
                        value={cameraLockModelId}
                        onChange={(e) => {
                          setCameraLockModelId(e.target.value);
                          isCameraLockInitializedRef.current = false;
                        }}
                        className="bg-[#161822] text-xs text-white border border-white/10 rounded-xl px-2.5 py-1 focus:outline-none cursor-pointer"
                      >
                        <option value="active">Active Model</option>
                        {modelsList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Locking Buttons Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      {[
                        { key: 'none', label: 'Unlocked (Free Orbit)', icon: Unlock },
                        { key: 'head', label: 'Lock: Head', icon: Lock },
                        { key: 'face', label: 'Lock: Face / Eyes', icon: Lock },
                        { key: 'chest', label: 'Lock: Chest', icon: Lock },
                        { key: 'hips', label: 'Lock: Hips / Center', icon: Lock },
                        { key: 'leftHand', label: 'Lock: Left Hand', icon: Lock },
                        { key: 'rightHand', label: 'Lock: Right Hand', icon: Lock },
                        { key: 'root', label: 'Lock: Model Base', icon: Lock },
                      ].map((item) => {
                        const isLocked = cameraLockTarget === item.key;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => handleSetCameraLock(item.key as CameraLockTarget)}
                            className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 text-xs ${
                              isLocked
                                ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 font-bold border-transparent shadow-md'
                                : 'bg-white/5 border-white/5 text-neutral-300 hover:bg-white/10'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Standard Camera Presets */}
                  <div className="space-y-2">
                    <span className="font-semibold text-neutral-300 block">MMD Camera Presets</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { key: 'front', label: 'Front' },
                        { key: 'face', label: 'Face' },
                        { key: 'bust', label: 'Bust Shot' },
                        { key: 'full', label: 'Full Body' },
                        { key: 'isometric', label: 'Isometric' },
                        { key: 'low', label: 'Heroic Low' },
                      ].map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setCameraPreset(p.key as any)}
                          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-center text-xs text-neutral-200 transition-all cursor-pointer"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Camera FOV */}
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/5 space-y-2">
                    <div className="flex justify-between text-[11px] text-neutral-300">
                      <span>Field of View (FOV)</span>
                      <span className="font-mono">{cameraFov}°</span>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="75"
                      step="1"
                      value={cameraFov}
                      onChange={(e) => setCameraFov(parseInt(e.target.value))}
                      className="w-full accent-[var(--theme-accent,#55d2f6)] cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* TAB 4: STAGE & LIGHTING */}
              {activeDockTab === 'stage' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/5 space-y-1.5">
                      <div className="flex justify-between text-[11px] text-neutral-300">
                        <span>Key Light</span>
                        <span>{keyLightIntensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="3"
                        step="0.1"
                        value={keyLightIntensity}
                        onChange={(e) => setKeyLightIntensity(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)]"
                      />
                    </div>

                    <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/5 space-y-1.5">
                      <div className="flex justify-between text-[11px] text-neutral-300">
                        <span>Ambient Light</span>
                        <span>{ambientLightIntensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={ambientLightIntensity}
                        onChange={(e) => setAmbientLightIntensity(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)]"
                      />
                    </div>

                    <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/5 space-y-1.5">
                      <div className="flex justify-between text-[11px] text-neutral-300">
                        <span>Rim Light</span>
                        <span>{rimLightIntensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={rimLightIntensity}
                        onChange={(e) => setRimLightIntensity(parseFloat(e.target.value))}
                        className="w-full accent-[var(--theme-accent,#55d2f6)]"
                      />
                    </div>
                  </div>

                  {/* Background Selector */}
                  <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
                    <span className="text-neutral-300">Stage Backdrop:</span>
                    <div className="flex items-center gap-1.5">
                      {(['studio', 'horizon', 'cyber', 'black'] as const).map((bg) => (
                        <button
                          key={bg}
                          type="button"
                          onClick={() => setStageBackground(bg)}
                          className={`px-2.5 py-1 rounded-xl capitalize font-mono text-[11px] border cursor-pointer ${
                            stageBackground === bg
                              ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 border-transparent font-bold'
                              : 'bg-white/5 border-white/5 text-neutral-300'
                          }`}
                        >
                          {bg}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: PIPELINE & SPECS */}
              {activeDockTab === 'pipeline' && (
                <div className="space-y-2 text-neutral-300 leading-relaxed text-xs">
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/5 space-y-1.5">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[var(--theme-accent,#55d2f6)]" />
                      Multi-Model MMD Architecture &amp; Camera Lock
                    </div>
                    <p className="text-neutral-400 text-[11px]">
                      &bull; Multi-Model Upload: Upload multiple VRM and PMX models at once with distinct stage positioning.
                    </p>
                    <p className="text-neutral-400 text-[11px]">
                      &bull; Unique Animations: Apply different VMD or FBX motions to individual models or synchronize across all models.
                    </p>
                    <p className="text-neutral-400 text-[11px]">
                      &bull; Local Space Camera Locking: Keep the viewport camera firmly pinned to any human bone (Head, Face, Chest, Hips, Hands) relative to the model's local space coordinates.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
