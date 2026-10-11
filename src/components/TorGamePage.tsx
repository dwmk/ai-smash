import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import {
  ALL_WARDROBE_OUTFITS,
  MODEL_SOURCE_DOMAIN,
  MODEL_FALLBACK_DOMAIN,
} from '../constants';
import { WardrobeOutfit } from '../types';
import {
  Skull,
  Crosshair,
  Volume2,
  VolumeX,
  RotateCcw,
  Plus,
  Trash2,
  Search,
  X,
  Sparkles,
  Activity,
  Layers,
  ArrowLeft,
  Upload,
  Info,
  Check,
  Loader2,
} from 'lucide-react';

// ============================================================================
// Types & Data Structures
// ============================================================================

export type BodyPartKey =
  | 'head'
  | 'neck'
  | 'chest'
  | 'spine'
  | 'hips'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'rightUpperLeg'
  | 'rightLowerLeg';

export interface NPCPartState {
  key: BodyPartKey;
  vrmBoneName: string;
  isDetached: boolean;
  boneNode: THREE.Object3D | null;
  stumpCap: THREE.Mesh | null;
  fountainTimer: number; // Seconds remaining for arterial blood fountain
}

export interface NPCEntity {
  id: string;
  name: string;
  outfit: WardrobeOutfit;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  isRagdoll: boolean;
  isObliterated: boolean;
  health: number; // 0 to 100
  bloodStainsCount: number;
  rootGroup: THREE.Group;
  vrm: VRM | null;
  isLoading: boolean;
  parts: Record<BodyPartKey, NPCPartState>;
  proxyColliders: THREE.Mesh[];
  staggerSpring: number; // Spring tension recovering to standing
  staggerVelocity: number;
}

export interface GibEntity {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
  isFleshCap: boolean;
}

export interface BloodParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

export type BloodStyle = 'crimson' | 'neon' | 'toxic';

interface TorGamePageProps {
  onBackToChat?: () => void;
  onNavigateHome?: () => void;
  onNavigateToAct?: () => void;
}

// Player avatar outfit: "hana_v1.2_darkpain_vrm1"
const PLAYER_OUTFIT: WardrobeOutfit =
  ALL_WARDROBE_OUTFITS.find((o) => o.fileName.includes('darkpain')) || {
    id: 'pain-giver',
    name: 'Dominant Top',
    fileName: 'hana_v1.2_darkpain_vrm1.vrm',
    modelUrl: `${MODEL_SOURCE_DOMAIN}/hana_v1.2_darkpain_vrm1.vrm`,
    fallbackModelUrl: `${MODEL_FALLBACK_DOMAIN}/hana_v1.2_darkpain_vrm1.vrm`,
    isPremium: false,
    isSecret: true,
  };

// Colors for blood themes
const BLOOD_COLORS: Record<BloodStyle, { base: number; drip: number; mist: number; name: string }> = {
  crimson: {
    base: 0x880808,
    drip: 0x5a0303,
    mist: 0xb31414,
    name: 'Doom Crimson',
  },
  neon: {
    base: 0xff0066,
    drip: 0xaa00aa,
    mist: 0xff3399,
    name: 'Neon Cyber Fantasy',
  },
  toxic: {
    base: 0x39ff14,
    drip: 0x228b22,
    mist: 0x76ff03,
    name: 'Acid Pulp',
  },
};

// Collider mapping definitions for real VRM humanoid bones
const VRM_COLLIDER_DEFS: Array<{
  boneKey: BodyPartKey;
  vrmBone: string;
  geo: THREE.BufferGeometry;
  offset?: [number, number, number];
  stumpRadius: number;
}> = [
  { boneKey: 'head', vrmBone: 'head', geo: new THREE.SphereGeometry(0.16, 8, 8), offset: [0, 0.08, 0], stumpRadius: 0.07 },
  { boneKey: 'neck', vrmBone: 'neck', geo: new THREE.SphereGeometry(0.09, 8, 8), offset: [0, 0.04, 0], stumpRadius: 0.06 },
  { boneKey: 'chest', vrmBone: 'chest', geo: new THREE.BoxGeometry(0.28, 0.24, 0.2), offset: [0, 0.06, 0], stumpRadius: 0.12 },
  { boneKey: 'spine', vrmBone: 'spine', geo: new THREE.SphereGeometry(0.18, 8, 8), offset: [0, 0, 0], stumpRadius: 0.11 },
  { boneKey: 'hips', vrmBone: 'hips', geo: new THREE.SphereGeometry(0.22, 8, 8), offset: [0, -0.04, 0], stumpRadius: 0.14 },
  { boneKey: 'leftUpperArm', vrmBone: 'leftUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), offset: [0, -0.1, 0], stumpRadius: 0.05 },
  { boneKey: 'rightUpperArm', vrmBone: 'rightUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), offset: [0, -0.1, 0], stumpRadius: 0.05 },
  { boneKey: 'leftLowerArm', vrmBone: 'leftLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0], stumpRadius: 0.045 },
  { boneKey: 'rightLowerArm', vrmBone: 'rightLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0], stumpRadius: 0.045 },
  { boneKey: 'leftUpperLeg', vrmBone: 'leftUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.07 },
  { boneKey: 'rightUpperLeg', vrmBone: 'rightUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.07 },
  { boneKey: 'leftLowerLeg', vrmBone: 'leftLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.06 },
  { boneKey: 'rightLowerLeg', vrmBone: 'rightLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.06 },
];

// ============================================================================
// Web Audio Synthesizer (Realistic & Punchy FX)
// ============================================================================
class TorAudioEngine {
  private ctx: AudioContext | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  public enabled: boolean = true;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public startChargeHum() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      this.stopChargeHum();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.3);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, this.ctx.currentTime);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      this.chargeOsc = osc;
      this.chargeGain = gain;
    } catch {}
  }

  public updateChargeHum(progress: number) {
    if (!this.ctx || !this.chargeOsc || !this.chargeGain) return;
    try {
      const freq = 90 + progress * 320;
      this.chargeOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
      this.chargeGain.gain.setTargetAtTime(0.05 + progress * 0.18, this.ctx.currentTime, 0.05);
    } catch {}
  }

  public stopChargeHum() {
    if (this.chargeOsc) {
      try {
        this.chargeOsc.stop();
        this.chargeOsc.disconnect();
      } catch {}
      this.chargeOsc = null;
    }
    if (this.chargeGain) {
      try {
        this.chargeGain.disconnect();
      } catch {}
      this.chargeGain = null;
    }
  }

  public playLightHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playHeavyHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(140, now);
      subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.28);

      subGain.gain.setValueAtTime(0.7, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      subOsc.connect(subGain);
      subGain.connect(this.ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.35);

      this.playNoiseBurst(0.18, 0.3, 1200);
    } catch {}
  }

  public playDismemberHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const ripOsc = this.ctx.createOscillator();
      const ripGain = this.ctx.createGain();
      ripOsc.type = 'sawtooth';
      ripOsc.frequency.setValueAtTime(320, now);
      ripOsc.frequency.exponentialRampToValueAtTime(45, now + 0.35);

      ripGain.gain.setValueAtTime(0.65, now);
      ripGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.Q.setValueAtTime(2.5, now);

      ripOsc.connect(filter);
      filter.connect(ripGain);
      ripGain.connect(this.ctx.destination);
      ripOsc.start(now);
      ripOsc.stop(now + 0.42);

      this.playNoiseBurst(0.35, 0.5, 2400);
    } catch {}
  }

  public playObliterationBlast() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const boom = this.ctx.createOscillator();
      const boomGain = this.ctx.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(180, now);
      boom.frequency.exponentialRampToValueAtTime(20, now + 0.65);

      boomGain.gain.setValueAtTime(1.0, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      boom.connect(boomGain);
      boomGain.connect(this.ctx.destination);
      boom.start(now);
      boom.stop(now + 0.72);

      this.playNoiseBurst(0.55, 0.8, 1600);
    } catch {}
  }

  private playNoiseBurst(duration: number, volume: number, cutoff: number) {
    if (!this.ctx) return;
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start();
    } catch {}
  }
}

const audio = new TorAudioEngine();

// ============================================================================
// Helper: Create Flesh Stump Cap
// ============================================================================
function createFleshCapMesh(radius: number, colorHex: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius * 0.9, 0.035, 14);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.25,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ============================================================================
// Main Component
// ============================================================================
export const TorGamePage: React.FC<TorGamePageProps> = ({
  onBackToChat,
  onNavigateHome,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js Core Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Entities & Simulation Refs
  const npcsRef = useRef<NPCEntity[]>([]);
  const gibsRef = useRef<GibEntity[]>([]);
  const bloodParticlesRef = useRef<BloodParticle[]>([]);
  const bloodParticleMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const bloodDecalsGroupRef = useRef<THREE.Group | null>(null);
  const bloodDecalsCountRef = useRef<number>(0);

  // Player VRM State
  const playerRootRef = useRef<THREE.Group | null>(null);
  const playerVrmRef = useRef<VRM | null>(null);
  const playerPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 3.5));
  const playerYawRef = useRef<number>(0);
  const playerAnimTimeRef = useRef<number>(0);
  const playerIsPunchingRef = useRef<boolean>(false);
  const playerPunchTypeRef = useRef<number>(1);
  const playerPunchProgressRef = useRef<number>(0);

  // Third Person Action Camera
  const cameraYawRef = useRef<number>(0);
  const cameraPitchRef = useRef<number>(0.18);
  const cameraDistanceRef = useRef<number>(2.8);
  const isPointerLockedRef = useRef<boolean>(false);
  const isDraggingMouseRef = useRef<boolean>(false);

  // Movement Input Keys
  const keysRef = useRef<{
    KeyW: boolean;
    KeyS: boolean;
    KeyA: boolean;
    KeyD: boolean;
    ShiftLeft: boolean;
    Space: boolean;
  }>({
    KeyW: false,
    KeyS: false,
    KeyA: false,
    KeyD: false,
    ShiftLeft: false,
    Space: false,
  });

  // Attack Charging State
  const isChargingAttackRef = useRef<boolean>(false);
  const chargeStartTimeRef = useRef<number>(0);
  const chargeProgressRef = useRef<number>(0);

  // UI state
  const [chargeLevelUI, setChargeLevelUI] = useState<number>(0);
  const [chargeProgressUI, setChargeProgressUI] = useState<number>(0);
  const [targetedPartUI, setTargetedPartUI] = useState<{
    npcName: string;
    partName: string;
    inRange: boolean;
  } | null>(null);
  const [hitMarkerActive, setHitMarkerActive] = useState<boolean>(false);
  const [hitMessage, setHitMessage] = useState<string | null>(null);
  const [activeNpcCount, setActiveNpcCount] = useState<number>(0);
  const [bloodStyle, setBloodStyle] = useState<BloodStyle>('crimson');
  const bloodStyleRef = useRef<BloodStyle>('crimson');
  useEffect(() => {
    bloodStyleRef.current = bloodStyle;
  }, [bloodStyle]);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  useEffect(() => {
    audio.enabled = soundEnabled;
  }, [soundEnabled]);

  const [isSlowMo, setIsSlowMo] = useState<boolean>(false);
  const isSlowMoRef = useRef<boolean>(false);
  useEffect(() => {
    isSlowMoRef.current = isSlowMo;
  }, [isSlowMo]);

  // Modal Library Spawner
  const [isLibraryOpen, setIsLibraryOpen] = useState<boolean>(false);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [libraryCategory, setLibraryCategory] = useState<string>('all');
  const [isControlsModalOpen, setIsControlsModalOpen] = useState<boolean>(false);
  const [isPlayerLoading, setIsPlayerLoading] = useState<boolean>(true);

  // Arena Screen Shake
  const screenShakeRef = useRef<number>(0);

  // ----------------------------------------------------
  // Spawn NPC Helper (Loads Actual VRM Model Directly!)
  // ----------------------------------------------------
  const spawnNPC = useCallback(
    (outfit: WardrobeOutfit, spawnOffset: { x: number; z: number } = { x: 0, z: 0 }) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const npcId = `npc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const rootGroup = new THREE.Group();
      rootGroup.name = `NPC_${npcId}`;

      const spawnPos = new THREE.Vector3(
        playerPosRef.current.x + spawnOffset.x,
        0,
        playerPosRef.current.z + spawnOffset.z
      );

      rootGroup.position.copy(spawnPos);
      rootGroup.rotation.y = Math.PI; // Face towards player / arena center
      scene.add(rootGroup);

      // Temporary spawn ground beacon while loading the actual VRM
      const spawnRingGeo = new THREE.RingGeometry(0.35, 0.42, 32);
      const spawnRingMat = new THREE.MeshBasicMaterial({
        color: 0x55d2f6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      });
      const spawnRing = new THREE.Mesh(spawnRingGeo, spawnRingMat);
      spawnRing.rotation.x = -Math.PI / 2;
      spawnRing.position.y = 0.01;
      rootGroup.add(spawnRing);

      const partsState: Record<BodyPartKey, NPCPartState> = {} as any;
      const proxyColliders: THREE.Mesh[] = [];

      for (const def of VRM_COLLIDER_DEFS) {
        partsState[def.boneKey] = {
          key: def.boneKey,
          vrmBoneName: def.vrmBone,
          isDetached: false,
          boneNode: null,
          stumpCap: null,
          fountainTimer: 0,
        };
      }

      const newNPC: NPCEntity = {
        id: npcId,
        name: outfit.name,
        outfit,
        position: spawnPos,
        rotation: new THREE.Euler(0, Math.PI, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        isRagdoll: false,
        isObliterated: false,
        health: 100,
        bloodStainsCount: 0,
        rootGroup,
        vrm: null,
        isLoading: true,
        parts: partsState,
        proxyColliders,
        staggerSpring: 0,
        staggerVelocity: 0,
      };

      // Load the Genuine VRM Model Directly
      const gltfLoader = new GLTFLoader();
      gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
      const modelUrl = outfit.modelUrl || outfit.fallbackModelUrl;

      if (modelUrl) {
        gltfLoader.load(
          modelUrl,
          (gltf) => {
            const vrm = gltf.userData.vrm as VRM;
            if (vrm && rootGroup.parent) {
              try {
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.combineSkeletons(gltf.scene);
                VRMUtils.rotateVRM0(vrm);
              } catch {}
              vrm.scene.position.set(0, 0, 0);
              vrm.scene.rotation.set(0, 0, 0);
              newNPC.vrm = vrm;
              newNPC.isLoading = false;

              // Remove temporary spawn beacon
              rootGroup.remove(spawnRing);

              vrm.scene.traverse((obj) => {
                obj.frustumCulled = false;
                if ((obj as THREE.Mesh).isMesh) {
                  obj.castShadow = true;
                  obj.receiveShadow = true;
                }
              });
              rootGroup.add(vrm.scene);

              // Attach hit proxy colliders directly to the VRM humanoid bone nodes
              const colliderMat = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0.0,
                depthWrite: false,
              });

              if (vrm.humanoid) {
                for (const def of VRM_COLLIDER_DEFS) {
                  const boneNode = vrm.humanoid.getNormalizedBoneNode(def.vrmBone as any);
                  if (boneNode) {
                    newNPC.parts[def.boneKey].boneNode = boneNode;

                    const colMesh = new THREE.Mesh(def.geo, colliderMat);
                    colMesh.userData = {
                      npcId,
                      bodyPartKey: def.boneKey,
                      outfitName: outfit.name,
                      boneNode,
                    };
                    if (def.offset) {
                      colMesh.position.set(def.offset[0], def.offset[1], def.offset[2]);
                    }
                    boneNode.add(colMesh);
                    newNPC.proxyColliders.push(colMesh);
                  }
                }
              }
            }
          },
          undefined,
          (err) => {
            console.warn(`Failed to load VRM for ${outfit.name}:`, err);
            newNPC.isLoading = false;
          }
        );
      }

      npcsRef.current.push(newNPC);
      setActiveNpcCount(npcsRef.current.length);
    },
    []
  );

  // Clear all NPCs
  const clearAllNPCs = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    for (const npc of npcsRef.current) {
      scene.remove(npc.rootGroup);
    }
    npcsRef.current = [];

    // Clear gibs
    for (const gib of gibsRef.current) {
      scene.remove(gib.mesh);
    }
    gibsRef.current = [];

    // Clear blood decals
    if (bloodDecalsGroupRef.current) {
      while (bloodDecalsGroupRef.current.children.length > 0) {
        const c = bloodDecalsGroupRef.current.children[0];
        bloodDecalsGroupRef.current.remove(c);
      }
      bloodDecalsCountRef.current = 0;
    }

    setActiveNpcCount(0);
    setTargetedPartUI(null);
  }, []);

  // Spawn preset circle arena of real VRMs
  const spawnCircleArena = useCallback(() => {
    clearAllNPCs();
    const count = 6;
    const radius = 4.2;
    const pool = ALL_WARDROBE_OUTFITS;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const outfit = pool[i % pool.length];
      const offsetX = Math.cos(angle) * radius;
      const offsetZ = Math.sin(angle) * radius - 3.5;
      spawnNPC(outfit, { x: offsetX, z: offsetZ });
    }
  }, [clearAllNPCs, spawnNPC]);

  // Spawn 3 default VRM dummies in front
  const spawnThreeDummies = useCallback(() => {
    const pool = ALL_WARDROBE_OUTFITS;
    spawnNPC(pool[0], { x: -1.6, z: -2.5 });
    spawnNPC(pool[1] || pool[0], { x: 0, z: -3.0 });
    spawnNPC(pool[2] || pool[0], { x: 1.6, z: -2.5 });
  }, [spawnNPC]);

  // ----------------------------------------------------
  // Liquid Blood Particle Emitter & Floor Decals
  // ----------------------------------------------------
  const emitBloodSpray = useCallback(
    (origin: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, spread: number = 0.5) => {
      const colors = BLOOD_COLORS[bloodStyleRef.current];
      for (let i = 0; i < count; i++) {
        const vel = dir
          .clone()
          .normalize()
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * spread,
              (Math.random() - 0.2) * spread,
              (Math.random() - 0.5) * spread
            )
          )
          .multiplyScalar(speed * (0.6 + Math.random() * 0.8));

        const p: BloodParticle = {
          position: origin.clone(),
          velocity: vel,
          life: 0,
          maxLife: 1.2 + Math.random() * 1.5,
          size: 0.04 + Math.random() * 0.06,
          color: new THREE.Color(Math.random() > 0.4 ? colors.base : colors.drip),
        };

        if (bloodParticlesRef.current.length < 400) {
          bloodParticlesRef.current.push(p);
        }
      }
    },
    []
  );

  const createFloorBloodDecal = useCallback(
    (pos: THREE.Vector3, radius: number = 0.25) => {
      const group = bloodDecalsGroupRef.current;
      if (!group || bloodDecalsCountRef.current > 180) return;

      const colors = BLOOD_COLORS[bloodStyleRef.current];
      const decalGeo = new THREE.CircleGeometry(radius * (0.7 + Math.random() * 0.6), 16);
      const decalMat = new THREE.MeshBasicMaterial({
        color: colors.drip,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      });

      const decalMesh = new THREE.Mesh(decalGeo, decalMat);
      decalMesh.rotation.x = -Math.PI / 2;
      decalMesh.position.set(pos.x, 0.005, pos.z);
      decalMesh.scale.set(1 + Math.random() * 0.5, 1 + Math.random() * 0.5, 1);
      group.add(decalMesh);
      bloodDecalsCountRef.current++;
    },
    []
  );

  // ----------------------------------------------------
  // Combat Impact Execution on Actual VRMs
  // ----------------------------------------------------
  const executePunchImpact = useCallback(
    (npc: NPCEntity, partKey: BodyPartKey, chargeLevel: number) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const punchDir = npc.position
        .clone()
        .sub(playerPosRef.current)
        .normalize();

      setHitMarkerActive(true);
      setTimeout(() => setHitMarkerActive(false), 220);

      // Level 1: Light Tap / Push (< 0.3s)
      if (chargeLevel === 1) {
        audio.playLightHit();
        setHitMessage(`PUSH [${npc.name}: ${partKey.toUpperCase()}]`);

        npc.velocity.add(punchDir.clone().multiplyScalar(1.8));
        npc.staggerVelocity += 4.5;
        emitBloodSpray(npc.position.clone().add(new THREE.Vector3(0, 1.2, 0)), punchDir, 4, 1.2, 0.3);
      }

      // Level 2: Heavy Strike & Blood Stain (0.3s - 0.8s)
      else if (chargeLevel === 2) {
        audio.playHeavyHit();
        setHitMessage(`HEAVY STRIKE [${npc.name}] - BLOOD STAIN`);

        npc.velocity.add(punchDir.clone().multiplyScalar(5.5));
        npc.staggerVelocity += 12.0;
        npc.health = Math.max(20, npc.health - 25);
        npc.bloodStainsCount++;

        emitBloodSpray(
          npc.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
          punchDir,
          24,
          4.5,
          0.6
        );
        createFloorBloodDecal(npc.position, 0.35);
      }

      // Level 3: Dismemberment of Actual VRM Limb (0.8s - 1.5s)
      else if (chargeLevel === 3) {
        audio.playDismemberHit();
        setHitMessage(`DISMEMBERED! [${partKey.toUpperCase()} SEVERED]`);

        screenShakeRef.current = 0.25;
        const part = npc.parts[partKey];

        if (part && !part.isDetached) {
          part.isDetached = true;
          part.fountainTimer = 3.5;

          const colors = BLOOD_COLORS[bloodStyleRef.current];
          const worldPos = new THREE.Vector3();

          // If VRM bone exists, get world position and scale it to 0 to hide on VRM!
          if (part.boneNode) {
            part.boneNode.getWorldPosition(worldPos);
            // Scaling the bone to 0.0001 hides the mesh vertices assigned to this bone
            part.boneNode.scale.set(0.0001, 0.0001, 0.0001);

            // Stump flesh cap attached to bone parent
            const stumpCap = createFleshCapMesh(0.08, colors.drip);
            part.boneNode.parent?.add(stumpCap);
            stumpCap.position.copy(part.boneNode.position);
            part.stumpCap = stumpCap;
          } else {
            worldPos.copy(npc.position).add(new THREE.Vector3(0, 1.2, 0));
          }

          // Spawn flying severed limb gib piece
          const def = VRM_COLLIDER_DEFS.find((d) => d.boneKey === partKey);
          const gibGeo = def ? def.geo.clone() : new THREE.CylinderGeometry(0.06, 0.05, 0.25, 8);
          const gibMat = new THREE.MeshStandardMaterial({
            color: colors.base,
            roughness: 0.3,
            metalness: 0.1,
          });
          const gibMesh = new THREE.Mesh(gibGeo, gibMat);
          gibMesh.position.copy(worldPos);

          const severedCap = createFleshCapMesh(0.08, colors.base);
          severedCap.position.set(0, 0.1, 0);
          gibMesh.add(severedCap);

          scene.add(gibMesh);

          const gibVel = punchDir
            .clone()
            .multiplyScalar(6.5)
            .add(new THREE.Vector3((Math.random() - 0.5) * 2, 2.8, (Math.random() - 0.5) * 2));

          gibsRef.current.push({
            mesh: gibMesh,
            position: worldPos,
            velocity: gibVel,
            angularVelocity: new THREE.Vector3(
              (Math.random() - 0.5) * 12,
              (Math.random() - 0.5) * 12,
              (Math.random() - 0.5) * 12
            ),
            life: 0,
            maxLife: 15,
            isFleshCap: true,
          });

          emitBloodSpray(worldPos, punchDir, 45, 6.0, 0.7);
          createFloorBloodDecal(worldPos, 0.55);
        }

        npc.velocity.add(punchDir.clone().multiplyScalar(7.5));
        npc.isRagdoll = true;
        npc.health = Math.max(5, npc.health - 50);
      }

      // Level 4: Doom Eternal Obliteration (1.5s+ Max)
      else if (chargeLevel === 4) {
        audio.playObliterationBlast();
        setHitMessage(`DOOM OBLITERATION! [${npc.name} PULPED]`);

        screenShakeRef.current = 0.55;
        npc.isObliterated = true;
        npc.isRagdoll = true;
        npc.health = 0;

        const origin = npc.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const colors = BLOOD_COLORS[bloodStyleRef.current];

        // Explode into 12 pulpy gib chunks
        const gibGeos = [
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.BoxGeometry(0.18, 0.14, 0.12),
          new THREE.CylinderGeometry(0.06, 0.05, 0.22, 6),
          new THREE.SphereGeometry(0.09, 8, 8),
          new THREE.BoxGeometry(0.14, 0.1, 0.08),
        ];

        for (let i = 0; i < 12; i++) {
          const geo = gibGeos[i % gibGeos.length];
          const mat = new THREE.MeshStandardMaterial({
            color: Math.random() > 0.3 ? colors.base : colors.drip,
            roughness: 0.3,
            metalness: 0.1,
          });
          const gibMesh = new THREE.Mesh(geo, mat);
          gibMesh.position.copy(origin);
          scene.add(gibMesh);

          const gibVel = new THREE.Vector3(
            (Math.random() - 0.5) * 8.5 + punchDir.x * 6,
            2.5 + Math.random() * 5.5,
            (Math.random() - 0.5) * 8.5 + punchDir.z * 6
          );

          gibsRef.current.push({
            mesh: gibMesh,
            position: origin.clone(),
            velocity: gibVel,
            angularVelocity: new THREE.Vector3(
              (Math.random() - 0.5) * 16,
              (Math.random() - 0.5) * 16,
              (Math.random() - 0.5) * 16
            ),
            life: 0,
            maxLife: 20,
            isFleshCap: true,
          });
        }

        // Hide actual VRM model
        if (npc.vrm) {
          npc.vrm.scene.visible = false;
        }
        npc.rootGroup.visible = false;

        emitBloodSpray(origin, punchDir, 90, 8.5, 1.2);
        createFloorBloodDecal(npc.position, 0.95);
        createFloorBloodDecal(
          npc.position.clone().add(new THREE.Vector3(0.4, 0, 0.3)),
          0.65
        );
      }

      setTimeout(() => setHitMessage(null), 2500);
    },
    [emitBloodSpray, createFloorBloodDecal]
  );

  // ----------------------------------------------------
  // Three.js Scene Setup & Loop
  // ----------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDisposed = false;
    let rafId = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1017);
    scene.fog = new THREE.FogExp2(0x0e1017, 0.038);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / container.clientHeight,
      0.1,
      60.0
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(6, 12, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 35;
    keyLight.shadow.camera.left = -12;
    keyLight.shadow.camera.right = 12;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -12;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff1e56, 1.1);
    rimLight.position.set(-8, 5, -8);
    scene.add(rimLight);

    const cyanFillLight = new THREE.DirectionalLight(0x55d2f6, 0.7);
    cyanFillLight.position.set(8, 4, -6);
    scene.add(cyanFillLight);

    // Arena Floor
    const floorGeo = new THREE.PlaneGeometry(28, 28, 28, 28);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x141824,
      roughness: 0.35,
      metalness: 0.5,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Floor Grid
    const grid = new THREE.GridHelper(28, 28, 0x55d2f6, 0x242d3d);
    grid.position.y = 0.002;
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    scene.add(grid);

    // Ring Perimeter
    const ringGeo = new THREE.RingGeometry(5.2, 5.35, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3b5c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    scene.add(ring);

    // Blood Decals Container
    const decalsGroup = new THREE.Group();
    scene.add(decalsGroup);
    bloodDecalsGroupRef.current = decalsGroup;

    // Blood Particles Instanced Mesh
    const bloodGeo = new THREE.SphereGeometry(1, 6, 6);
    const bloodMat = new THREE.MeshBasicMaterial({ color: 0x880808 });
    const instancedBlood = new THREE.InstancedMesh(bloodGeo, bloodMat, 500);
    instancedBlood.count = 0;
    scene.add(instancedBlood);
    bloodParticleMeshRef.current = instancedBlood;

    // Player Avatar Root
    const playerRoot = new THREE.Group();
    playerRoot.name = 'PlayerAvatar';
    playerRoot.position.copy(playerPosRef.current);
    scene.add(playerRoot);
    playerRootRef.current = playerRoot;

    // Load Actual Player VRM: "hana_v1.2_darkpain_vrm1.vrm"
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    const playerModelUrl = PLAYER_OUTFIT.modelUrl || PLAYER_OUTFIT.fallbackModelUrl;

    if (playerModelUrl) {
      gltfLoader.load(
        playerModelUrl,
        (gltf) => {
          if (isDisposed) return;
          const vrm = gltf.userData.vrm as VRM;
          if (vrm) {
            try {
              VRMUtils.removeUnnecessaryVertices(gltf.scene);
              VRMUtils.combineSkeletons(gltf.scene);
              VRMUtils.rotateVRM0(vrm);
            } catch {}
            vrm.scene.position.set(0, 0, 0);
            vrm.scene.rotation.set(0, 0, 0);
            vrm.scene.traverse((obj) => {
              obj.frustumCulled = false;
              if ((obj as THREE.Mesh).isMesh) {
                obj.castShadow = true;
              }
            });
            playerRoot.add(vrm.scene);
            playerVrmRef.current = vrm;
          }
          setIsPlayerLoading(false);
        },
        undefined,
        () => {
          setIsPlayerLoading(false);
        }
      );
    } else {
      setIsPlayerLoading(false);
    }

    // Spawn Initial Default VRM Dummies
    spawnThreeDummies();

    // --------------------------------------------------
    // Animation & Physics Loop (60 FPS)
    // --------------------------------------------------
    let lastTime = performance.now();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      let dt = (now - lastTime) / 1000;
      lastTime = now;

      if (dt > 0.08) dt = 0.08;
      if (isSlowMoRef.current) dt *= 0.28;

      const playerPos = playerPosRef.current;
      const keys = keysRef.current;

      // 1. Player Movement & Action Camera
      const camYaw = cameraYawRef.current;
      const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
      const moveDir = new THREE.Vector3();

      if (keys.KeyW) moveDir.add(forward);
      if (keys.KeyS) moveDir.sub(forward);
      if (keys.KeyD) moveDir.add(right);
      if (keys.KeyA) moveDir.sub(right);

      const isMoving = moveDir.lengthSq() > 0.001;
      const speed = keys.ShiftLeft ? 8.2 : 4.6;

      if (isMoving) {
        moveDir.normalize();
        playerPos.add(moveDir.clone().multiplyScalar(speed * dt));

        playerPos.x = THREE.MathUtils.clamp(playerPos.x, -11.5, 11.5);
        playerPos.z = THREE.MathUtils.clamp(playerPos.z, -11.5, 11.5);

        const targetYaw = Math.atan2(moveDir.x, moveDir.z);
        let diff = targetYaw - playerYawRef.current;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        playerYawRef.current += diff * Math.min(1, 14 * dt);

        playerAnimTimeRef.current += dt * (keys.ShiftLeft ? 12 : 7);
      } else {
        playerAnimTimeRef.current += dt * 2.0;
      }

      // Animate Player Actual VRM Bones
      const pVrm = playerVrmRef.current;
      if (pVrm && pVrm.humanoid) {
        const animT = playerAnimTimeRef.current;
        const hips = pVrm.humanoid.getNormalizedBoneNode('hips');
        const lLeg = pVrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
        const rLeg = pVrm.humanoid.getNormalizedBoneNode('rightUpperLeg');
        const lArm = pVrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rArm = pVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const rLowerArm = pVrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        const chest = pVrm.humanoid.getNormalizedBoneNode('chest');

        if (isMoving) {
          if (lLeg) lLeg.rotation.x = Math.sin(animT) * 0.45;
          if (rLeg) rLeg.rotation.x = -Math.sin(animT) * 0.45;
          if (lArm) lArm.rotation.x = -Math.sin(animT) * 0.35;
          if (!playerIsPunchingRef.current && rArm) {
            rArm.rotation.x = Math.sin(animT) * 0.35;
          }
          if (hips) {
            hips.position.y = Math.abs(Math.sin(animT * 2)) * 0.04;
          }
        } else {
          if (lLeg) lLeg.rotation.x = THREE.MathUtils.lerp(lLeg.rotation.x, 0, 0.2);
          if (rLeg) rLeg.rotation.x = THREE.MathUtils.lerp(rLeg.rotation.x, 0, 0.2);
          if (lArm) lArm.rotation.x = THREE.MathUtils.lerp(lArm.rotation.x, 0, 0.2);
          if (!playerIsPunchingRef.current && rArm) {
            rArm.rotation.x = THREE.MathUtils.lerp(rArm.rotation.x, 0, 0.2);
          }
          if (chest) {
            chest.rotation.x = Math.sin(animT) * 0.02;
          }
        }

        // Punch Animation Strike
        if (playerIsPunchingRef.current && rArm && rLowerArm) {
          playerPunchProgressRef.current += dt * 5.5;
          const punchProg = playerPunchProgressRef.current;
          if (punchProg < 0.5) {
            const ease = punchProg * 2;
            rArm.rotation.x = THREE.MathUtils.lerp(0, -1.35, ease);
            rArm.rotation.y = THREE.MathUtils.lerp(0, 0.25, ease);
            rLowerArm.rotation.x = THREE.MathUtils.lerp(0, -0.3, ease);
          } else if (punchProg < 1.0) {
            const ease = (punchProg - 0.5) * 2;
            rArm.rotation.x = THREE.MathUtils.lerp(-1.35, 0, ease);
            rArm.rotation.y = THREE.MathUtils.lerp(0.25, 0, ease);
            rLowerArm.rotation.x = THREE.MathUtils.lerp(-0.3, 0, ease);
          } else {
            playerIsPunchingRef.current = false;
            playerPunchProgressRef.current = 0;
            rArm.rotation.set(0, 0, 0);
            rLowerArm.rotation.set(0, 0, 0);
          }
        }
      }

      if (playerRootRef.current) {
        playerRootRef.current.position.copy(playerPos);
        playerRootRef.current.rotation.y = playerYawRef.current;
      }

      // 2. Camera Orbit
      let shakeOffsetX = 0;
      let shakeOffsetY = 0;
      if (screenShakeRef.current > 0.001) {
        shakeOffsetX = (Math.random() - 0.5) * screenShakeRef.current;
        shakeOffsetY = (Math.random() - 0.5) * screenShakeRef.current;
        screenShakeRef.current = THREE.MathUtils.damp(screenShakeRef.current, 0, 10, dt);
      }

      const camDist = cameraDistanceRef.current;
      const camPitch = cameraPitchRef.current;
      const targetLookPos = playerPos.clone().add(new THREE.Vector3(0, 1.25, 0));

      const camX = playerPos.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist + shakeOffsetX;
      const camY = playerPos.y + 1.25 + Math.sin(camPitch) * camDist + shakeOffsetY;
      const camZ = playerPos.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist;

      camera.position.set(camX, Math.max(0.3, camY), camZ);
      camera.lookAt(targetLookPos.x, targetLookPos.y, targetLookPos.z);

      // 3. Attack Charging
      if (isChargingAttackRef.current) {
        const elapsed = (now - chargeStartTimeRef.current) / 1000;
        const progress = Math.min(1.0, elapsed / 1.6);
        chargeProgressRef.current = progress;
        audio.updateChargeHum(progress);

        let lvl = 1;
        if (elapsed >= 1.5) lvl = 4;
        else if (elapsed >= 0.8) lvl = 3;
        else if (elapsed >= 0.3) lvl = 2;
        setChargeLevelUI(lvl);
        setChargeProgressUI(progress);
      }

      // Crosshair Target Raycasting
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

      const allColliders: THREE.Mesh[] = [];
      for (const n of npcsRef.current) {
        if (!n.isObliterated) {
          allColliders.push(...n.proxyColliders);
        }
      }

      const intersects = raycaster.intersectObjects(allColliders, false);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const data = hit.object.userData;
        const dist = hit.distance;
        setTargetedPartUI({
          npcName: data.outfitName || 'NPC Model',
          partName: data.bodyPartKey || 'body',
          inRange: dist <= 3.2,
        });
      } else {
        setTargetedPartUI(null);
      }

      // 4. NPC Physics & Arterial Fountains
      for (const npc of npcsRef.current) {
        if (npc.isObliterated) continue;

        npc.position.add(npc.velocity.clone().multiplyScalar(dt));
        npc.velocity.multiplyScalar(Math.pow(0.88, dt * 60));

        if (npc.position.y < 0) {
          npc.position.y = 0;
          npc.velocity.y = 0;
        }

        if (!npc.isRagdoll) {
          npc.staggerSpring += npc.staggerVelocity * dt;
          npc.staggerVelocity -= npc.staggerSpring * 35.0 * dt;
          npc.staggerVelocity *= Math.pow(0.82, dt * 60);

          npc.rootGroup.rotation.z = Math.sin(npc.staggerSpring) * 0.22;
          npc.rootGroup.rotation.x = Math.cos(npc.staggerSpring) * 0.15;

          if (Math.abs(npc.staggerVelocity) > 28) {
            npc.isRagdoll = true;
          }
        } else {
          npc.rootGroup.rotation.x = THREE.MathUtils.damp(npc.rootGroup.rotation.x, Math.PI / 2, 4, dt);
          npc.rootGroup.position.y = THREE.MathUtils.damp(npc.rootGroup.position.y, 0.1, 8, dt);
        }

        npc.rootGroup.position.copy(npc.position);

        // Arterial blood fountains on severed VRM stumps
        for (const k in npc.parts) {
          const part = npc.parts[k as BodyPartKey];
          if (part.isDetached && part.fountainTimer > 0) {
            part.fountainTimer -= dt;
            if (part.stumpCap) {
              const capPos = new THREE.Vector3();
              part.stumpCap.getWorldPosition(capPos);
              emitBloodSpray(
                capPos,
                new THREE.Vector3(0, 1, 0),
                2,
                2.5 + Math.random() * 2.0,
                0.4
              );
            }
          }
        }
      }

      // 5. Gibs Physics
      for (let i = gibsRef.current.length - 1; i >= 0; i--) {
        const gib = gibsRef.current[i];
        gib.life += dt;

        if (gib.life >= gib.maxLife) {
          scene.remove(gib.mesh);
          gibsRef.current.splice(i, 1);
          continue;
        }

        gib.velocity.y -= 14.0 * dt;
        gib.position.add(gib.velocity.clone().multiplyScalar(dt));

        if (gib.position.y <= 0.08) {
          gib.position.y = 0.08;
          gib.velocity.y = -gib.velocity.y * 0.35;
          gib.velocity.x *= 0.75;
          gib.velocity.z *= 0.75;

          if (Math.random() > 0.6) {
            createFloorBloodDecal(gib.position, 0.22);
          }
        }

        gib.mesh.position.copy(gib.position);
        gib.mesh.rotation.x += gib.angularVelocity.x * dt;
        gib.mesh.rotation.y += gib.angularVelocity.y * dt;
        gib.mesh.rotation.z += gib.angularVelocity.z * dt;
        gib.angularVelocity.multiplyScalar(0.96);
      }

      // 6. Blood Particle Simulation
      const particles = bloodParticlesRef.current;
      const instanced = bloodParticleMeshRef.current;
      const dummyMat = new THREE.Matrix4();
      const dummyPos = new THREE.Vector3();
      const dummyScale = new THREE.Vector3();
      const dummyQuat = new THREE.Quaternion();

      let activeCount = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;

        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        p.velocity.y -= 16.0 * dt;
        p.position.add(p.velocity.clone().multiplyScalar(dt));

        if (p.position.y <= 0.01) {
          createFloorBloodDecal(p.position, 0.15 + Math.random() * 0.12);
          particles.splice(i, 1);
          continue;
        }

        if (instanced && activeCount < 500) {
          dummyPos.copy(p.position);
          const s = Math.max(0.001, p.size * (1 - p.life / p.maxLife));
          dummyScale.set(s, s, s);
          dummyMat.compose(dummyPos, dummyQuat, dummyScale);
          instanced.setMatrixAt(activeCount, dummyMat);
          instanced.setColorAt(activeCount, p.color);
          activeCount++;
        }
      }

      if (instanced) {
        instanced.count = activeCount;
        instanced.instanceMatrix.needsUpdate = true;
        if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    // Keyboard & Mouse Listeners
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code in keysRef.current) {
        keysRef.current[e.code as keyof typeof keysRef.current] = true;
      }

      if (e.code === 'KeyN') {
        setIsLibraryOpen((prev) => !prev);
      } else if (e.code === 'KeyC') {
        clearAllNPCs();
      } else if (e.code === 'KeyR') {
        for (const n of npcsRef.current) {
          n.isRagdoll = !n.isRagdoll;
        }
      } else if (e.code === 'KeyT') {
        setIsSlowMo((prev) => !prev);
      } else if (e.code === 'KeyH') {
        setIsControlsModalOpen((prev) => !prev);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code in keysRef.current) {
        keysRef.current[e.code as keyof typeof keysRef.current] = false;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isPointerLockedRef.current || isDraggingMouseRef.current) {
        const sens = 0.0022;
        cameraYawRef.current -= e.movementX * sens;
        cameraPitchRef.current += e.movementY * sens;
        cameraPitchRef.current = THREE.MathUtils.clamp(
          cameraPitchRef.current,
          -Math.PI / 2.3,
          Math.PI / 2.3
        );
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isChargingAttackRef.current = true;
        chargeStartTimeRef.current = performance.now();
        audio.startChargeHum();
      } else if (e.button === 2) {
        isDraggingMouseRef.current = true;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0 && isChargingAttackRef.current) {
        isChargingAttackRef.current = false;
        audio.stopChargeHum();

        const elapsed = (performance.now() - chargeStartTimeRef.current) / 1000;
        let punchLvl = 1;
        if (elapsed >= 1.5) punchLvl = 4;
        else if (elapsed >= 0.8) punchLvl = 3;
        else if (elapsed >= 0.3) punchLvl = 2;

        playerIsPunchingRef.current = true;
        playerPunchTypeRef.current = punchLvl;
        playerPunchProgressRef.current = 0;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const allColliders: THREE.Mesh[] = [];
        for (const n of npcsRef.current) {
          if (!n.isObliterated) allColliders.push(...n.proxyColliders);
        }

        const hits = raycaster.intersectObjects(allColliders, false);
        if (hits.length > 0 && hits[0].distance <= 3.2) {
          const hit = hits[0];
          const npcId = hit.object.userData.npcId;
          const partKey = hit.object.userData.bodyPartKey as BodyPartKey;
          const targetNPC = npcsRef.current.find((n) => n.id === npcId);

          if (targetNPC) {
            executePunchImpact(targetNPC, partKey, punchLvl);
          }
        } else {
          audio.playLightHit();
        }

        setChargeLevelUI(0);
        setChargeProgressUI(0);
      } else if (e.button === 2) {
        isDraggingMouseRef.current = false;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      cameraDistanceRef.current = THREE.MathUtils.clamp(
        cameraDistanceRef.current + e.deltaY * 0.003,
        1.2,
        6.5
      );
    };

    const handlePointerLockChange = () => {
      isPointerLockedRef.current = document.pointerLockElement === canvas;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(rafId);
      audio.stopChargeHum();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [spawnThreeDummies, executePunchImpact, emitBloodSpray, createFloorBloodDecal]);

  const handleCanvasClick = useCallback(() => {
    if (canvasRef.current && !isPointerLockedRef.current) {
      canvasRef.current.requestPointerLock?.();
    }
  }, []);

  const filteredOutfits = useMemo(() => {
    return ALL_WARDROBE_OUTFITS.filter((outfit) => {
      const matchSearch =
        outfit.name.toLowerCase().includes(librarySearch.toLowerCase()) ||
        outfit.fileName.toLowerCase().includes(librarySearch.toLowerCase()) ||
        outfit.id.toLowerCase().includes(librarySearch.toLowerCase());

      if (!matchSearch) return false;
      if (libraryCategory === 'all') return true;
      if (libraryCategory === 'secret') return Boolean(outfit.isSecret);
      if (libraryCategory === 'premium') return Boolean(outfit.isPremium);
      if (libraryCategory === 'maid') return outfit.fileName.includes('maid');
      if (libraryCategory === 'dress') return outfit.fileName.includes('dress');
      return true;
    });
  }, [librarySearch, libraryCategory]);

  const handleCustomVrmUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      const customOutfit: WardrobeOutfit = {
        id: `custom-${Date.now()}`,
        name: file.name.replace('.vrm', ''),
        fileName: file.name,
        modelUrl: url,
        fallbackModelUrl: url,
        isPremium: false,
        isSecret: true,
      };

      spawnNPC(customOutfit, { x: 0, z: -2.5 });
      setIsLibraryOpen(false);
    },
    [spawnNPC]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden select-none bg-[var(--theme-bg,#0e1017)] text-[var(--theme-text,#ffffff)] font-sans"
    >
      {/* 3D Viewport Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-full block cursor-crosshair"
      />

      {/* TOP HEADER: Clean Theme-Integrated Controls */}
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

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-300 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Arena Physics &amp; VRM Testing Matrix</span>
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Blood Theme Selector */}
          <button
            type="button"
            onClick={() => {
              if (bloodStyle === 'crimson') setBloodStyle('neon');
              else if (bloodStyle === 'neon') setBloodStyle('toxic');
              else setBloodStyle('crimson');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 transition-all active:scale-95 cursor-pointer"
            title="Toggle Blood Liquid Theme"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Blood Style:</span>
            <span className="font-bold text-red-400 capitalize">{bloodStyle}</span>
          </button>

          {/* Slow Motion */}
          <button
            type="button"
            onClick={() => setIsSlowMo(!isSlowMo)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl backdrop-blur-md border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
              isSlowMo
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-neutral-900/80 border-neutral-700/60 text-neutral-200 hover:bg-neutral-800'
            }`}
            title="Toggle Slow Motion [T]"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">Slow-Mo [T]</span>
          </button>

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-200 hover:text-white hover:bg-neutral-800 transition-all active:scale-95 cursor-pointer"
            title={soundEnabled ? 'Mute Audio' : 'Unmute Audio'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Controls Guide */}
          <button
            type="button"
            onClick={() => setIsControlsModalOpen(true)}
            className="p-2 rounded-xl bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-200 hover:text-white hover:bg-neutral-800 transition-all active:scale-95 cursor-pointer"
            title="Controls & Mechanics Guide [H]"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* CENTER ACTION RETICLE & CHARGE RING */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative flex items-center justify-center">
          {chargeProgressUI > 0 && (
            <div className="absolute w-28 h-28 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeWidth="5"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke={
                    chargeLevelUI === 4
                      ? '#ef4444'
                      : chargeLevelUI === 3
                      ? '#f97316'
                      : chargeLevelUI === 2
                      ? '#eab308'
                      : 'var(--theme-accent, #55d2f6)'
                  }
                  strokeWidth="5"
                  strokeDasharray="276"
                  strokeDashoffset={276 - 276 * chargeProgressUI}
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}

          {/* Central Crosshair */}
          <div
            className={`w-3.5 h-3.5 border-2 rounded-full transition-transform duration-75 ${
              targetedPartUI?.inRange
                ? 'border-red-500 scale-125 bg-red-500/20'
                : 'border-white/50 scale-100 bg-transparent'
            }`}
          />

          {/* Hit Marker Red X */}
          {hitMarkerActive && (
            <div className="absolute w-10 h-10 flex items-center justify-center animate-ping pointer-events-none">
              <span className="text-red-500 font-extrabold text-2xl select-none">✕</span>
            </div>
          )}

          {/* Charge Level Descriptor */}
          {chargeProgressUI > 0 && (
            <div className="absolute top-16 flex flex-col items-center">
              <span
                className={`text-[11px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-lg backdrop-blur-md border ${
                  chargeLevelUI === 4
                    ? 'bg-neutral-900 border-red-500 text-red-400'
                    : chargeLevelUI === 3
                    ? 'bg-neutral-900 border-orange-500 text-orange-400'
                    : chargeLevelUI === 2
                    ? 'bg-neutral-900 border-yellow-500 text-yellow-400'
                    : 'bg-neutral-900 border-[var(--theme-accent,#55d2f6)] text-[var(--theme-accent,#55d2f6)]'
                }`}
              >
                {chargeLevelUI === 4
                  ? 'LEVEL 4: OBLITERATE!'
                  : chargeLevelUI === 3
                  ? 'LEVEL 3: DISMEMBER CUT'
                  : chargeLevelUI === 2
                  ? 'LEVEL 2: HEAVY STRIKE'
                  : 'LEVEL 1: JAB PUSH'}
              </span>
            </div>
          )}

          {/* Target HUD Tag */}
          {targetedPartUI && (
            <div className="absolute -top-12 flex flex-col items-center gap-0.5">
              <div
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-semibold backdrop-blur-md border uppercase tracking-wider ${
                  targetedPartUI.inRange
                    ? 'bg-neutral-900/90 border-red-500/60 text-red-200'
                    : 'bg-neutral-900/80 border-neutral-700/60 text-neutral-300'
                }`}
              >
                [{targetedPartUI.npcName} • {targetedPartUI.partName}]
              </div>
              {targetedPartUI.inRange && (
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">
                  HOLD LEFT CLICK TO CHARGE
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FLOATING COMBAT HIT NOTIFICATION */}
      {hitMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-none z-30">
          <div className="px-4 py-2 rounded-xl bg-neutral-900/95 border border-red-500 text-white font-bold text-xs tracking-wider shadow-2xl flex items-center gap-2">
            <Skull className="w-4 h-4 text-red-400" />
            <span>{hitMessage}</span>
          </div>
        </div>
      )}

      {/* BOTTOM CONTROLS & SPAWNER RAIL */}
      <div className="absolute bottom-6 left-6 right-6 flex flex-col sm:flex-row items-center justify-between gap-4 pointer-events-auto z-20">
        {/* Left: Player Status & Actual VRM Model Tag */}
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 shadow-xl">
          <div className="w-10 h-10 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-[var(--theme-accent,#55d2f6)]">VRM</span>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
              Player Character
            </div>
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Hana ({PLAYER_OUTFIT.name})</span>
              {isPlayerLoading && (
                <Loader2 className="w-3 h-3 text-[var(--theme-accent,#55d2f6)] animate-spin" />
              )}
            </div>
          </div>
        </div>

        {/* Center: Main Arena Spawner Controls */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 shadow-xl">
          <button
            type="button"
            onClick={() => setIsLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--theme-accent,#55d2f6)] hover:opacity-90 active:scale-95 text-neutral-950 font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Spawn NPC Library [N]</span>
          </button>

          <button
            type="button"
            onClick={spawnThreeDummies}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>Spawn 3 Dummies</span>
          </button>

          <button
            type="button"
            onClick={spawnCircleArena}
            className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Ring Coliseum (6)</span>
          </button>

          <button
            type="button"
            onClick={clearAllNPCs}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-red-950/60 hover:text-red-400 text-neutral-300 text-xs font-semibold active:scale-95 transition-all cursor-pointer"
            title="Clear all NPCs and blood splatters [C]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear [C]</span>
          </button>
        </div>

        {/* Right: Active Entities Count */}
        <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-neutral-900/85 backdrop-blur-md border border-neutral-700/60 shadow-xl">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
              Arena Status
            </div>
            <div className="text-xs font-bold text-neutral-200">
              {activeNpcCount} VRM Models Active • Click to Lock Aim
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* POP-UP MODAL: NPC LIBRARY COLLECTION OF ALL KNOWN MODELS */}
      {/* ==================================================================== */}
      {isLibraryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-4xl max-h-[85vh] bg-[var(--theme-surface,#181b26)] border border-[var(--theme-border,#2b3042)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-[var(--theme-border,#2b3042)] flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[var(--theme-text,#ffffff)] flex items-center gap-2">
                  <Skull className="w-5 h-5 text-[var(--theme-accent,#55d2f6)]" />
                  <span>Spawn NPC Model Library Collection</span>
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Spawns the authentic VRM avatar models directly into the 3D physics arena
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsLibraryOpen(false)}
                className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Search & Filters */}
            <div className="p-4 border-b border-[var(--theme-border,#2b3042)] bg-neutral-900/40 flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search model by name or filename..."
                  className="w-full pl-9 pr-3 py-2 bg-[var(--theme-card,#12141d)] border border-[var(--theme-border,#2b3042)] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[var(--theme-accent,#55d2f6)] transition-all"
                />
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                {['all', 'maid', 'dress', 'secret', 'premium'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setLibraryCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize whitespace-nowrap transition-all cursor-pointer ${
                      libraryCategory === cat
                        ? 'bg-[var(--theme-accent,#55d2f6)] text-neutral-950 shadow-sm'
                        : 'bg-[var(--theme-card,#12141d)] text-neutral-300 hover:bg-neutral-800 border border-[var(--theme-border,#2b3042)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Custom VRM Upload */}
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-[var(--theme-border,#2b3042)] text-[var(--theme-accent,#55d2f6)] text-xs font-semibold whitespace-nowrap cursor-pointer transition-all active:scale-95">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload .vrm</span>
                <input
                  type="file"
                  accept=".vrm"
                  onChange={handleCustomVrmUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Modal Models Grid */}
            <div className="p-5 flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filteredOutfits.map((outfit) => (
                <div
                  key={outfit.id}
                  className="p-3 rounded-xl bg-[var(--theme-card,#12141d)] border border-[var(--theme-border,#2b3042)] hover:border-[var(--theme-accent,#55d2f6)] transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-xs font-bold text-white">
                        {outfit.name}
                      </h3>
                      {outfit.isSecret && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-950/80 border border-purple-500/40 text-purple-300">
                          Secret
                        </span>
                      )}
                      {outfit.isPremium && !outfit.isSecret && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-950/80 border border-amber-500/40 text-amber-300">
                          Premium
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-neutral-400 truncate mt-1">
                      {outfit.fileName}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--theme-border,#2b3042)] flex items-center justify-between">
                    <span className="text-[10px] text-neutral-400">
                      VRM 1.0 Avatar
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        spawnNPC(outfit, {
                          x: (Math.random() - 0.5) * 1.5,
                          z: -2.8,
                        });
                        setIsLibraryOpen(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--theme-accent,#55d2f6)] hover:opacity-90 text-neutral-950 font-bold text-xs shadow transition-all active:scale-95 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Spawn VRM</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[var(--theme-border,#2b3042)] bg-neutral-900/60 flex items-center justify-between text-xs text-neutral-400">
              <div>
                Showing {filteredOutfits.length} of {ALL_WARDROBE_OUTFITS.length} official VRM models
              </div>
              <button
                type="button"
                onClick={() => setIsLibraryOpen(false)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-semibold transition-all cursor-pointer"
              >
                Close Library
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* POP-UP MODAL: CONTROLS & GORE MECHANICS GUIDE */}
      {/* ==================================================================== */}
      {isControlsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[var(--theme-surface,#181b26)] border border-[var(--theme-border,#2b3042)] rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[var(--theme-border,#2b3042)] pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Info className="w-5 h-5 text-[var(--theme-accent,#55d2f6)]" />
                <span>Tor Combat &amp; VRM Physics Guide</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsControlsModalOpen(false)}
                className="p-1.5 rounded-xl text-neutral-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-neutral-300">
              <div className="p-3 rounded-xl bg-[var(--theme-card,#12141d)] border border-[var(--theme-border,#2b3042)] space-y-1.5">
                <div className="font-bold text-white text-sm">Action Controls</div>
                <div>• <span className="text-[var(--theme-accent,#55d2f6)] font-bold">WASD</span>: Move avatar relative to camera view</div>
                <div>• <span className="text-[var(--theme-accent,#55d2f6)] font-bold">Shift</span>: Sprint</div>
                <div>• <span className="text-[var(--theme-accent,#55d2f6)] font-bold">Mouse Look</span>: Orbit camera freely around character (click canvas to lock mouse)</div>
                <div>• <span className="text-[var(--theme-accent,#55d2f6)] font-bold">Right Click Drag</span>: Free camera orbit without locking</div>
                <div>• <span className="text-[var(--theme-accent,#55d2f6)] font-bold">Mouse Wheel</span>: Zoom camera distance</div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--theme-card,#12141d)] border border-red-500/20 space-y-1.5">
                <div className="font-bold text-red-400 text-sm">Force Charging &amp; VRM Dismemberment</div>
                <div>
                  • <span className="text-cyan-300 font-bold">Level 1 (Tap &lt;0.3s)</span>: Light touching jab, nudges targeted VRM bone.
                </div>
                <div>
                  • <span className="text-yellow-300 font-bold">Level 2 (Hold 0.3-0.8s)</span>: Heavy punch, creates blood stains, ragdoll stagger impulse.
                </div>
                <div>
                  • <span className="text-orange-400 font-bold">Level 3 (Hold 0.8-1.5s)</span>: Dismembering strike! Rips off the targeted limb from the VRM model with bloody flesh caps and gushing arterial liquid fountain.
                </div>
                <div>
                  • <span className="text-red-400 font-bold">Level 4 (Hold 1.5s+ Max)</span>: Doom Eternal Obliteration! Completely obliterates the VRM model into flying pulpy gibs and wide blood pools.
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--theme-card,#12141d)] border border-[var(--theme-border,#2b3042)] space-y-1.5">
                <div className="font-bold text-white text-sm">Hotkeys</div>
                <div>• <span className="text-white font-mono">[N]</span>: Open NPC Spawner Library</div>
                <div>• <span className="text-white font-mono">[C]</span>: Clear Arena &amp; Blood</div>
                <div>• <span className="text-white font-mono">[T]</span>: Toggle Matrix Slow Motion</div>
                <div>• <span className="text-white font-mono">[R]</span>: Toggle Ragdoll Simulation</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsControlsModalOpen(false)}
              className="w-full py-2.5 rounded-xl bg-[var(--theme-accent,#55d2f6)] hover:opacity-90 text-neutral-950 font-bold text-xs transition-all cursor-pointer"
            >
              Close Guide
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
