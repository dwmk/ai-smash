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
  Activity,
  Plus,
  Sparkles,
  Info,
  X,
  Search,
  Check,
  Skull,
  Heart,
  Hand,
} from 'lucide-react';
import {
  ALL_WARDROBE_OUTFITS,
  MODEL_SOURCE_DOMAIN,
  MODEL_FALLBACK_DOMAIN,
} from '../constants';
import { WardrobeOutfit } from '../types';

// ============================================================================
// Types & Definitions
// ============================================================================
export interface TorGamePageProps {
  onBackToChat: () => void;
  onNavigateHome?: () => void;
  onNavigateToAct?: () => void;
}

export type BloodStyle = 'crimson' | 'neon' | 'toxic';

export type BodyPartKey =
  | 'head'
  | 'neck'
  | 'chest'
  | 'spine'
  | 'hips'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg';

export interface NPCPartState {
  key: BodyPartKey;
  vrmBoneName: string;
  isDetached: boolean;
  boneNode: THREE.Object3D | null;
  stumpCap: THREE.Mesh | null;
  fountainTimer: number;
}

export interface RagdollParticle {
  name: BodyPartKey;
  boneNode: THREE.Object3D | null;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  radius: number;
}

export interface RagdollStick {
  p1: RagdollParticle;
  p2: RagdollParticle;
  restLength: number;
}

export interface HairBoneTrack {
  bone: THREE.Object3D;
  initialRot: THREE.Euler;
  swayX: number;
  swayZ: number;
  phase: number;
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
  isDead: boolean;
  isObliterated: boolean;
  health: number;
  bloodStainsCount: number;
  rootGroup: THREE.Group;
  vrm: VRM | null;
  isLoading: boolean;
  parts: Record<BodyPartKey, NPCPartState>;
  proxyColliders: THREE.Mesh[];
  staggerSpring: number;
  staggerVelocity: number;
  wanderState: 'idle' | 'walk';
  wanderTimer: number;
  wanderDir: THREE.Vector3;
  hasTakenDamage: boolean;
  dyingTimer: number;
  mixer: THREE.AnimationMixer | null;
  currentActionName: string | null;
  ragdollParticles: RagdollParticle[];
  ragdollSticks: RagdollStick[];
  hairBones: HairBoneTrack[];
}

export interface GibEntity {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  life: number;
  maxLife: number;
  isFleshCap?: boolean;
}

export interface BloodParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

// Player Default Outfit
const PLAYER_OUTFIT: WardrobeOutfit = ALL_WARDROBE_OUTFITS.find((o) => o.id === 'pain-giver');

// Blood liquid colors
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
    name: 'Neon Cyber',
  },
  toxic: {
    base: 0x39ff14,
    drip: 0x228b22,
    mist: 0x76ff03,
    name: 'Acid Pulp',
  },
};

// Collider definitions for VRM humanoid bones
const VRM_COLLIDER_DEFS: Array<{
  boneKey: BodyPartKey;
  vrmBone: string;
  geo: THREE.BufferGeometry;
  offset?: [number, number, number];
  stumpRadius: number;
  displayName: string;
}> = [
  { boneKey: 'head', vrmBone: 'head', geo: new THREE.SphereGeometry(0.16, 8, 8), offset: [0, 0.08, 0], stumpRadius: 0.07, displayName: 'Head' },
  { boneKey: 'neck', vrmBone: 'neck', geo: new THREE.SphereGeometry(0.09, 8, 8), offset: [0, 0.04, 0], stumpRadius: 0.06, displayName: 'Neck' },
  { boneKey: 'chest', vrmBone: 'chest', geo: new THREE.BoxGeometry(0.28, 0.24, 0.2), offset: [0, 0.06, 0], stumpRadius: 0.12, displayName: 'Chest' },
  { boneKey: 'spine', vrmBone: 'spine', geo: new THREE.SphereGeometry(0.18, 8, 8), offset: [0, 0, 0], stumpRadius: 0.11, displayName: 'Spine' },
  { boneKey: 'hips', vrmBone: 'hips', geo: new THREE.SphereGeometry(0.22, 8, 8), offset: [0, -0.04, 0], stumpRadius: 0.14, displayName: 'Groin / Pelvis' },
  { boneKey: 'leftUpperArm', vrmBone: 'leftUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), offset: [0, -0.1, 0], stumpRadius: 0.05, displayName: 'Left Arm' },
  { boneKey: 'rightUpperArm', vrmBone: 'rightUpperArm', geo: new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), offset: [0, -0.1, 0], stumpRadius: 0.05, displayName: 'Right Arm' },
  { boneKey: 'leftLowerArm', vrmBone: 'leftLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0], stumpRadius: 0.045, displayName: 'Left Forearm' },
  { boneKey: 'rightLowerArm', vrmBone: 'rightLowerArm', geo: new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), offset: [0, -0.1, 0], stumpRadius: 0.045, displayName: 'Right Forearm' },
  { boneKey: 'leftUpperLeg', vrmBone: 'leftUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.07, displayName: 'Left Thigh' },
  { boneKey: 'rightUpperLeg', vrmBone: 'rightUpperLeg', geo: new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.07, displayName: 'Right Thigh' },
  { boneKey: 'leftLowerLeg', vrmBone: 'leftLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.06, displayName: 'Left Leg' },
  { boneKey: 'rightLowerLeg', vrmBone: 'rightLowerLeg', geo: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), offset: [0, -0.16, 0], stumpRadius: 0.06, displayName: 'Right Leg' },
];

// ============================================================================
// Procedural Maze Generator & 3D Wall Landing Mechanics
// ============================================================================
const MAZE_GRID_SIZE = 17;
const MAZE_CELL_SIZE = 3.6;
const MAZE_WALL_HEIGHT = 2.8; // Lower height allows players to easily jump on top for shortcuts!
const GROUND_FLOOR_Y = 0.0; // Strict ground level: nothing ever sinks below this!

export interface MazeData {
  grid: number[][];
  size: number;
  cellSize: number;
  walls: Array<{ x: number; z: number; width: number; depth: number }>;
  openCells: Array<{ gx: number; gz: number; x: number; z: number }>;
}

function generateProceduralMaze(size: number = MAZE_GRID_SIZE): MazeData {
  const grid: number[][] = Array.from({ length: size }, () => Array(size).fill(1));

  const stack: [number, number][] = [];
  const startX = 1;
  const startY = 1;
  grid[startY][startX] = 0;
  stack.push([startX, startY]);

  const directions = [
    [0, -2],
    [0, 2],
    [-2, 0],
    [2, 0],
  ];

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const neighbors: [number, number, number, number][] = [];

    for (const [dx, dy] of directions) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx > 0 && nx < size - 1 && ny > 0 && ny < size - 1 && grid[ny][nx] === 1) {
        neighbors.push([nx, ny, dx, dy]);
      }
    }

    if (neighbors.length > 0) {
      const [nx, ny, dx, dy] = neighbors[Math.floor(Math.random() * neighbors.length)];
      grid[cy + dy / 2][cx + dx / 2] = 0;
      grid[ny][nx] = 0;
      stack.push([nx, ny]);
    } else {
      stack.pop();
    }
  }

  // Clear central plaza
  const mid = Math.floor(size / 2);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      grid[mid + dy][mid + dx] = 0;
    }
  }

  // Add corridor loops for open traversal
  for (let y = 2; y < size - 2; y += 2) {
    for (let x = 2; x < size - 2; x += 2) {
      if (Math.random() < 0.28) {
        grid[y][x] = 0;
      }
    }
  }

  const offset = ((size - 1) * MAZE_CELL_SIZE) / 2;
  const walls: Array<{ x: number; z: number; width: number; depth: number }> = [];
  const openCells: Array<{ gx: number; gz: number; x: number; z: number }> = [];

  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const wx = gx * MAZE_CELL_SIZE - offset;
      const wz = gz * MAZE_CELL_SIZE - offset;
      if (grid[gz][gx] === 1) {
        walls.push({
          x: wx,
          z: wz,
          width: MAZE_CELL_SIZE,
          depth: MAZE_CELL_SIZE,
        });
      } else {
        openCells.push({ gx, gz, x: wx, z: wz });
      }
    }
  }

  return { grid, size, cellSize: MAZE_CELL_SIZE, walls, openCells };
}

// Check floor/standing height at (x, z): allows standing on top of walls!
function getMazeFloorHeightAt(x: number, z: number, maze: MazeData): number {
  const offset = ((maze.size - 1) * maze.cellSize) / 2;
  const halfCell = maze.cellSize / 2;
  const gx = Math.round((x + offset) / maze.cellSize);
  const gz = Math.round((z + offset) / maze.cellSize);
  if (gx >= 0 && gx < maze.size && gz >= 0 && gz < maze.size) {
    if (maze.grid[gz][gx] === 1) {
      const wallCenterX = gx * maze.cellSize - offset;
      const wallCenterZ = gz * maze.cellSize - offset;
      if (Math.abs(x - wallCenterX) <= halfCell && Math.abs(z - wallCenterZ) <= halfCell) {
        return MAZE_WALL_HEIGHT;
      }
    }
  }
  return GROUND_FLOOR_Y;
}

// Resolve horizontal collisions with walls (only when character is BELOW wall top)
function resolveMazeCollision(pos: THREE.Vector3, radius: number, maze: MazeData): void {
  // If entity is jumping above or walking on the wall top, do not block horizontal motion!
  if (pos.y >= MAZE_WALL_HEIGHT - 0.15) {
    return;
  }

  const offset = ((maze.size - 1) * maze.cellSize) / 2;
  const halfCell = maze.cellSize / 2;

  const gx = Math.round((pos.x + offset) / maze.cellSize);
  const gz = Math.round((pos.z + offset) / maze.cellSize);

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = gx + dx;
      const cz = gz + dz;
      if (cx >= 0 && cx < maze.size && cz >= 0 && cz < maze.size) {
        if (maze.grid[cz][cx] === 1) {
          const wallCenterX = cx * maze.cellSize - offset;
          const wallCenterZ = cz * maze.cellSize - offset;

          const minX = wallCenterX - halfCell;
          const maxX = wallCenterX + halfCell;
          const minZ = wallCenterZ - halfCell;
          const maxZ = wallCenterZ + halfCell;

          const closestX = THREE.MathUtils.clamp(pos.x, minX, maxX);
          const closestZ = THREE.MathUtils.clamp(pos.z, minZ, maxZ);

          const distX = pos.x - closestX;
          const distZ = pos.z - closestZ;
          const distSq = distX * distX + distZ * distZ;

          if (distSq < radius * radius) {
            const dist = Math.sqrt(distSq);
            if (dist > 0.0001) {
              const push = (radius - dist) / dist;
              pos.x += distX * push;
              pos.z += distZ * push;
            } else {
              pos.x += radius;
            }
          }
        }
      }
    }
  }
}

// ============================================================================
// WebAudio Procedural SFX Engine
// ============================================================================
class TorAudioEngine {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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
      osc.frequency.setValueAtTime(65, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      this.chargeOsc = osc;
      this.chargeGain = gain;
    } catch {}
  }

  public updateChargeHum(progress: number) {
    if (!this.chargeOsc || !this.chargeGain || !this.ctx) return;
    try {
      const freq = 65 + progress * 240;
      const vol = 0.05 + progress * 0.15;
      this.chargeOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
      this.chargeGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
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
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
      this.playNoiseImpact(0.08, 450, 0.3);
    } catch {}
  }

  public playHeavyHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.28);

      gain.gain.setValueAtTime(0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
      this.playNoiseImpact(0.18, 650, 0.5);
    } catch {}
  }

  public playDismemberHit() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.4);

      gain.gain.setValueAtTime(0.85, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
      this.playNoiseImpact(0.35, 900, 0.65);
    } catch {}
  }

  public playObliterationBlast() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.7);

      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.7);
      this.playNoiseImpact(0.65, 1200, 0.95);
    } catch {}
  }

  public playGrabSound() {
    if (!this.enabled) return;
    this.initCtx();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.15);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  private playNoiseImpact(duration: number, cutoff: number, volume: number) {
    if (!this.ctx) return;
    try {
      const bufferSize = this.ctx.sampleRate * duration;
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
    roughness: 0.8,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ============================================================================
// VRM Buffer Fetcher & Memory Cache
// ============================================================================
const vrmBufferCache = new Map<string, ArrayBuffer>();

async function fetchVRMBuffer(
  outfit: WardrobeOutfit | { fileName: string; modelUrl?: string; fallbackModelUrl?: string }
): Promise<ArrayBuffer | null> {
  const fileName = (outfit.fileName || '').trim();

  if (fileName && vrmBufferCache.has(fileName)) {
    return vrmBufferCache.get(fileName)!.slice(0);
  }

  if (outfit.modelUrl && (outfit.modelUrl.startsWith('blob:') || outfit.modelUrl.startsWith('data:'))) {
    try {
      const resp = await fetch(outfit.modelUrl);
      if (resp.ok) {
        return await resp.arrayBuffer();
      }
    } catch (e) {
      console.warn('Failed to fetch blob VRM:', e);
    }
  }

  const candidateUrls: string[] = [];

  if (fileName) {
    candidateUrls.push(`/api/vrm?file=${encodeURIComponent(fileName)}`);
  }
  if (outfit.modelUrl && !candidateUrls.includes(outfit.modelUrl)) {
    candidateUrls.push(outfit.modelUrl);
  }
  if (outfit.fallbackModelUrl && !candidateUrls.includes(outfit.fallbackModelUrl)) {
    candidateUrls.push(outfit.fallbackModelUrl);
  }
  if (fileName) {
    candidateUrls.push(`${MODEL_SOURCE_DOMAIN}/${fileName}`);
    candidateUrls.push(`${MODEL_FALLBACK_DOMAIN}/${fileName}`);
    candidateUrls.push(`https://ai.mux8.com/${fileName}`);
    candidateUrls.push(`https://muxai.vercel.app/${fileName}`);
  }

  const uniqueUrls = Array.from(new Set(candidateUrls));

  for (const url of uniqueUrls) {
    try {
      const resp = await fetch(url, { redirect: 'follow' });
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        if (buf && buf.byteLength > 1000) {
          const header = new Uint8Array(buf, 0, 4);
          const isGlb = header[0] === 0x67 && header[1] === 0x6c && header[2] === 0x54 && header[3] === 0x46;
          if (isGlb || buf.byteLength > 10000) {
            if (fileName) {
              vrmBufferCache.set(fileName, buf);
            }
            return buf.slice(0);
          }
        }
      }
    } catch {
      // Continue
    }
  }

  return null;
}

// ============================================================================
// FBX Loader & Retargeting Cache with Hips Height Preservation
// ============================================================================
const fbxBufferCache = new Map<string, ArrayBuffer>();
const fbxLoaderInstance = new FBXLoader();

/**
 * Normalizes a retargeted Mixamo AnimationClip.
 * Crucially preserves the natural standing height of the hips bone so the
 * model's legs and feet NEVER get forced down below ground level!
 */
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

      // Calculate average Y across keyframes to detect if the clip's hips are sunken to 0
      let sumY = 0;
      let count = 0;
      for (let i = 1; i < values.length; i += 3) {
        sumY += values[i];
        count++;
      }
      const avgY = count > 0 ? sumY / count : 0;

      // If the animation clip sets hips position to 0 or negative, offset by restHipsY
      // so the hips remain at ~0.85m standing height and legs never sink below ground!
      const isHipsTrack = track.name.toLowerCase().includes('hips');
      const yOffset = (isHipsTrack || avgY < 0.45) ? (avgY < 0.45 ? restHipsY : 0) : 0;

      for (let i = 0; i < values.length; i += 3) {
        values[i] = (values[i] - baseX) * 0.25;
        values[i + 1] = values[i + 1] + yOffset;
        values[i + 2] = (values[i + 2] - baseZ) * 0.25;
      }
    }
  }
  return clip;
}

async function fetchFBXBuffer(fileName: string): Promise<ArrayBuffer | null> {
  if (fbxBufferCache.has(fileName)) {
    return fbxBufferCache.get(fileName)!.slice(0);
  }

  const candidateUrls = [
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
          fbxBufferCache.set(fileName, buf);
          return buf.slice(0);
        }
      }
    } catch {}
  }
  return null;
}

async function loadRetargetedClipFromFBX(
  fileName: string,
  vrm: VRM
): Promise<THREE.AnimationClip | null> {
  const buf = await fetchFBXBuffer(fileName);
  if (!buf) return null;
  try {
    const fbxGroup = fbxLoaderInstance.parse(buf, '');
    const rawClip = retargetAnimation(fbxGroup, vrm);
    if (rawClip) {
      return localizeAnimationClip(rawClip, vrm);
    }
  } catch (err) {
    console.warn(`Failed to parse/retarget FBX ${fileName}:`, err);
  }
  return null;
}

const STANDBY_ANIMATION_FILES = [
  'mixamo_idle.fbx',
  'mixamo_wait.fbx',
  'mixamo_yawn.fbx',
  'mixamo_armstretch.fbx',
  'mixamo_feelingshy.fbx',
  'mixamo_idle_nailcheck.fbx',
];

function flashNpcMaterials(npc: NPCEntity) {
  npc.rootGroup.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).material) {
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => {
        if ('color' in mat && (mat as any).color instanceof THREE.Color) {
          const colorProp = (mat as any).color as THREE.Color;
          if (!mesh.userData.origColor) {
            mesh.userData.origColor = colorProp.clone();
          }
          colorProp.setHex(0xff2222);
          setTimeout(() => {
            if (mesh.userData.origColor) {
              colorProp.copy(mesh.userData.origColor);
            }
          }, 180);
        }
      });
    }
  });
}

function collectHairBones(vrm: VRM): HairBoneTrack[] {
  const tracks: HairBoneTrack[] = [];
  vrm.scene.traverse((obj) => {
    const n = obj.name.toLowerCase();
    if (n.includes('hair') || n.includes('sec_') || n.includes('ribbon') || n.includes('skirt') || n.includes('tail')) {
      tracks.push({
        bone: obj,
        initialRot: obj.rotation.clone(),
        swayX: 0,
        swayZ: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  });
  return tracks;
}

/**
 * Strict ground clamping rule: checks world position of lowest bones (feet, toes)
 * and bounding box. If anything is below minGroundY, lifts the root so it rests firmly on the surface!
 */
function clampEntityAboveGround(rootGroup: THREE.Group, vrm: VRM | null, minGroundY: number): void {
  if (!vrm) return;
  const lFoot = vrm.humanoid?.getNormalizedBoneNode('leftFoot');
  const rFoot = vrm.humanoid?.getNormalizedBoneNode('rightFoot');
  const lToes = vrm.humanoid?.getNormalizedBoneNode('leftToes');
  const rToes = vrm.humanoid?.getNormalizedBoneNode('rightToes');

  let lowestY = Infinity;
  const tempV = new THREE.Vector3();
  [lFoot, rFoot, lToes, rToes].forEach((b) => {
    if (b) {
      b.getWorldPosition(tempV);
      if (tempV.y < lowestY) lowestY = tempV.y;
    }
  });

  if (lowestY === Infinity) {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    lowestY = box.min.y;
  }

  if (lowestY < minGroundY) {
    rootGroup.position.y += (minGroundY - lowestY);
  }
}

// ============================================================================
// Main Component
// ============================================================================
export const TorGamePage: React.FC<TorGamePageProps> = ({
  onBackToChat,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Three.js Core Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const mazeRef = useRef<MazeData>(generateProceduralMaze(MAZE_GRID_SIZE));

  // Entities & Simulation Refs
  const npcsRef = useRef<NPCEntity[]>([]);
  const gibsRef = useRef<GibEntity[]>([]);
  const bloodParticlesRef = useRef<BloodParticle[]>([]);
  const bloodParticleMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const bloodDecalsGroupRef = useRef<THREE.Group | null>(null);
  const bloodDecalsCountRef = useRef<number>(0);

  // Grab Mechanic: Keyframed Hand Reach & Physical Attachment
  const grabbedNpcRef = useRef<{
    npc: NPCEntity;
    partKey: BodyPartKey;
    boneNode: THREE.Object3D | null;
  } | null>(null);
  const [isGrabbingUI, setIsGrabbingUI] = useState<boolean>(false);
  const [grabbedLabelUI, setGrabbedLabelUI] = useState<string>('');

  // Player VRM State
  const playerRootRef = useRef<THREE.Group | null>(null);
  const playerVrmRef = useRef<VRM | null>(null);
  const playerMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const playerActionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const activePlayerActionRef = useRef<string>('idle');
  const playerHairBonesRef = useRef<HairBoneTrack[]>([]);
  const [playerHealthUI] = useState<number>(100);

  const playerPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const playerPrevPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const playerVelYRef = useRef<number>(0);
  const playerYawRef = useRef<number>(0);
  const isPlayerAttackingRef = useRef<boolean>(false);
  const isJumpingRef = useRef<boolean>(false);

  // Third Person Action Camera
  const cameraYawRef = useRef<number>(0);
  const cameraPitchRef = useRef<number>(0.18);
  const cameraDistanceRef = useRef<number>(3.0);
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
    partKey: BodyPartKey;
    displayName: string;
    inRange: boolean;
  } | null>(null);
  const [damagePopups, setDamagePopups] = useState<Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
  }>>([]);
  const [hitMarkerActive, setHitMarkerActive] = useState<boolean>(false);
  const [hitMessage, setHitMessage] = useState<string | null>(null);
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

  // Screen Shake
  const screenShakeRef = useRef<number>(0);

  // ----------------------------------------------------
  // Full Verlet Ragdoll System Setup
  // ----------------------------------------------------
  const setupNPCRagdoll = useCallback((npc: NPCEntity) => {
    if (!npc.vrm || !npc.vrm.humanoid) return;

    const particles: RagdollParticle[] = [];
    const sticks: RagdollStick[] = [];
    const pMap = new Map<BodyPartKey, RagdollParticle>();

    for (const def of VRM_COLLIDER_DEFS) {
      const boneNode = npc.vrm.humanoid.getNormalizedBoneNode(def.vrmBone as any);
      const worldPos = new THREE.Vector3();
      if (boneNode) {
        boneNode.getWorldPosition(worldPos);
      } else {
        worldPos.copy(npc.position).add(new THREE.Vector3(0, 1.0, 0));
      }

      // Safeguard: never let particle initialize below ground level
      worldPos.y = Math.max(def.stumpRadius || 0.1, worldPos.y);

      const p: RagdollParticle = {
        name: def.boneKey,
        boneNode,
        position: worldPos.clone(),
        prevPosition: worldPos.clone(),
        radius: def.stumpRadius || 0.1,
      };
      particles.push(p);
      pMap.set(def.boneKey, p);
    }

    const connections: Array<[BodyPartKey, BodyPartKey]> = [
      ['hips', 'spine'],
      ['spine', 'chest'],
      ['chest', 'neck'],
      ['neck', 'head'],
      ['chest', 'leftUpperArm'],
      ['leftUpperArm', 'leftLowerArm'],
      ['chest', 'rightUpperArm'],
      ['rightUpperArm', 'rightLowerArm'],
      ['hips', 'leftUpperLeg'],
      ['leftUpperLeg', 'leftLowerLeg'],
      ['hips', 'rightUpperLeg'],
      ['rightUpperLeg', 'rightLowerLeg'],
    ];

    for (const [k1, k2] of connections) {
      const p1 = pMap.get(k1);
      const p2 = pMap.get(k2);
      if (p1 && p2) {
        sticks.push({
          p1,
          p2,
          restLength: p1.position.distanceTo(p2.position) || 0.3,
        });
      }
    }

    npc.ragdollParticles = particles;
    npc.ragdollSticks = sticks;
  }, []);

  // ----------------------------------------------------
  // Spawn NPC Helper (Loads VRM Model & Standby Animations)
  // ----------------------------------------------------
  const spawnNPC = useCallback(
    (outfit: WardrobeOutfit, customPos?: THREE.Vector3) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const npcId = `npc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const rootGroup = new THREE.Group();
      rootGroup.name = `NPC_${npcId}`;

      let spawnPos = customPos ? customPos.clone() : new THREE.Vector3();
      if (!customPos) {
        const maze = mazeRef.current;
        const validOpen = maze.openCells.filter((c) => {
          const d = Math.hypot(c.x - playerPosRef.current.x, c.z - playerPosRef.current.z);
          return d > 6.0;
        });
        const cell = validOpen.length > 0
          ? validOpen[Math.floor(Math.random() * validOpen.length)]
          : maze.openCells[Math.floor(Math.random() * maze.openCells.length)];

        spawnPos.set(cell.x, GROUND_FLOOR_Y, cell.z);
      }

      spawnPos.y = GROUND_FLOOR_Y;
      rootGroup.position.copy(spawnPos);
      rootGroup.rotation.y = Math.random() * Math.PI * 2;
      scene.add(rootGroup);

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
        rotation: new THREE.Euler(0, rootGroup.rotation.y, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        angularVelocity: new THREE.Vector3(0, 0, 0),
        isRagdoll: false,
        isDead: false,
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
        wanderState: 'idle',
        wanderTimer: 2.0 + Math.random() * 4.0,
        wanderDir: new THREE.Vector3(),
        hasTakenDamage: false,
        dyingTimer: 0,
        mixer: null,
        currentActionName: null,
        ragdollParticles: [],
        ragdollSticks: [],
        hairBones: [],
      };

      const gltfLoader = new GLTFLoader();
      gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

      fetchVRMBuffer(outfit).then((buffer) => {
        if (!buffer || !rootGroup.parent) {
          console.warn(`Failed to retrieve VRM buffer for ${outfit.name}`);
          newNPC.isLoading = false;
          return;
        }

        gltfLoader.parse(
          buffer,
          '',
          (gltf) => {
            if (!rootGroup.parent) return;
            const vrm = gltf.userData.vrm as VRM;
            if (vrm) {
              try {
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.rotateVRM0(vrm);
              } catch {}

              vrm.scene.position.set(0, 0, 0);
              vrm.scene.rotation.set(0, 0, 0);

              // Auto-calibrate feet level with ground so character stands firmly at y = 0
              vrm.scene.updateMatrixWorld(true);
              const bbox = new THREE.Box3().setFromObject(vrm.scene);
              if (bbox.min.y < 0.0) {
                vrm.scene.position.y = -bbox.min.y;
              }

              newNPC.vrm = vrm;
              newNPC.isLoading = false;

              vrm.scene.traverse((obj) => {
                obj.frustumCulled = false;
                if ((obj as THREE.Mesh).isMesh) {
                  obj.castShadow = true;
                  obj.receiveShadow = true;
                }
              });

              // Apply natural anime resting arm stance
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

              rootGroup.add(vrm.scene);

              // Attach hit proxy colliders directly to VRM humanoid bones
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
                      displayName: def.displayName,
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

              newNPC.hairBones = collectHairBones(vrm);

              const mixer = new THREE.AnimationMixer(vrm.scene);
              newNPC.mixer = mixer;

              loadRetargetedClipFromFBX('mixamo_walk.fbx', vrm).then((clip) => {
                if (clip && newNPC.mixer === mixer) {
                  const act = mixer.clipAction(clip);
                  act.setLoop(THREE.LoopRepeat, Infinity);
                }
              });

              const initialStandby = STANDBY_ANIMATION_FILES[Math.floor(Math.random() * STANDBY_ANIMATION_FILES.length)];
              loadRetargetedClipFromFBX(initialStandby, vrm).then((clip) => {
                if (clip && newNPC.mixer === mixer && !newNPC.isDead && !newNPC.isRagdoll) {
                  const act = mixer.clipAction(clip);
                  act.setLoop(THREE.LoopRepeat, Infinity);
                  act.play();
                  newNPC.currentActionName = initialStandby;
                }
              });

              setupNPCRagdoll(newNPC);
              vrm.update(0);
            }
          },
          (err) => {
            console.warn(`Failed to parse VRM for ${outfit.name}:`, err);
            newNPC.isLoading = false;
          }
        );
      });

      npcsRef.current.push(newNPC);
    },
    [setupNPCRagdoll]
  );

  // Helper to play retargeted animation on an NPC
  const playNPCAnimation = useCallback(
    (npc: NPCEntity, fbxFileName: string, loop: boolean = true, clamp: boolean = false) => {
      if (!npc.vrm || !npc.mixer || npc.isObliterated) return;
      loadRetargetedClipFromFBX(fbxFileName, npc.vrm).then((clip) => {
        if (!clip || !npc.mixer || npc.isObliterated) return;
        const mixer = npc.mixer;
        const act = mixer.clipAction(clip);
        if (loop) {
          act.setLoop(THREE.LoopRepeat, Infinity);
          act.clampWhenFinished = false;
        } else {
          act.setLoop(THREE.LoopOnce, 1);
          act.clampWhenFinished = clamp;
        }
        mixer.stopAllAction();
        act.reset().play();
        npc.currentActionName = fbxFileName;
      });
    },
    []
  );

  // Helper to play player attack animations (disables movement during action)
  const playPlayerAttackAnim = useCallback((fbxFileName: string) => {
    const vrm = playerVrmRef.current;
    const mixer = playerMixerRef.current;
    if (!vrm || !mixer) return;

    loadRetargetedClipFromFBX(fbxFileName, vrm).then((clip) => {
      if (!clip || playerMixerRef.current !== mixer) return;
      const act = mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = false;

      // Lock player movement during attack animation
      isPlayerAttackingRef.current = true;
      act.reset().fadeIn(0.12).play();

      const duration = clip.duration || 1.0;
      setTimeout(() => {
        act.fadeOut(0.2);
        isPlayerAttackingRef.current = false;
      }, duration * 950);
    });
  }, []);

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
    (pos: THREE.Vector3, radius: number = 0.4) => {
      const group = bloodDecalsGroupRef.current;
      if (!group || bloodDecalsCountRef.current > 120) return;

      const colors = BLOOD_COLORS[bloodStyleRef.current];
      const decalGeo = new THREE.CircleGeometry(radius, 12);
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
  // Helper: Sever Body Part with Wireframe Damage & Extraction
  // ----------------------------------------------------
  const severBodyPartWithWireframe = useCallback(
    (
      npc: NPCEntity,
      partKey: BodyPartKey,
      punchDir: THREE.Vector3,
      forceMultiplier: number = 1.0
    ): number => {
      const scene = sceneRef.current;
      if (!scene || !npc.vrm) return 0;

      const part = npc.parts[partKey];
      if (!part || part.isDetached) return 0;

      part.isDetached = true;
      part.fountainTimer = 4.5;

      const colors = BLOOD_COLORS[bloodStyleRef.current];
      const worldPos = new THREE.Vector3();
      const def = VRM_COLLIDER_DEFS.find((d) => d.boneKey === partKey);
      const stumpRadius = def?.stumpRadius || 0.08;
      let affectedVerticesCount = 0;

      if (part.boneNode) {
        part.boneNode.getWorldPosition(worldPos);

        // 1. Calculate Wireframe Damage across NPC SkinnedMeshes
        npc.vrm.scene.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
            const mesh = obj as THREE.SkinnedMesh;
            const posAttr = mesh.geometry.attributes.position;
            if (posAttr) {
              const v = new THREE.Vector3();
              const meshMatrix = mesh.matrixWorld;
              const step = Math.max(1, Math.floor(posAttr.count / 150));
              for (let i = 0; i < posAttr.count; i += step) {
                v.fromBufferAttribute(posAttr, i);
                v.applyMatrix4(meshMatrix);
                if (v.distanceTo(worldPos) < stumpRadius * 2.8) {
                  affectedVerticesCount++;
                }
              }
            }
          }
        });

        // 2. Collapse and remove affected vertices out of NPC body by scaling bone to 0
        part.boneNode.scale.set(0.0001, 0.0001, 0.0001);

        // 3. Flesh stump cap at joint
        const stumpCap = createFleshCapMesh(stumpRadius, colors.drip);
        part.boneNode.parent?.add(stumpCap);
        stumpCap.position.copy(part.boneNode.position);
        part.stumpCap = stumpCap;
      } else {
        worldPos.copy(npc.position).add(new THREE.Vector3(0, 1.2, 0));
      }

      // 4. Create Detached Physical 3D Limb Object with Wireframe Damage Overlay
      const gibGeo = def ? def.geo.clone() : new THREE.CylinderGeometry(0.06, 0.05, 0.25, 8);
      const gibMat = new THREE.MeshStandardMaterial({
        color: colors.base,
        roughness: 0.8,
        metalness: 0.0,
      });
      const gibMesh = new THREE.Mesh(gibGeo, gibMat);
      gibMesh.position.copy(worldPos);

      // Glowing Wireframe damage edge lines
      const wireGeo = new THREE.WireframeGeometry(gibGeo);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0xff0055,
        transparent: true,
        opacity: 0.85,
      });
      const wireLines = new THREE.LineSegments(wireGeo, wireMat);
      gibMesh.add(wireLines);

      scene.add(gibMesh);

      // 5. Dynamic outward velocity & angular impulse
      const gibVel = punchDir
        .clone()
        .multiplyScalar(6.5 * forceMultiplier)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 4.0,
            2.8 + Math.random() * 3.5,
            (Math.random() - 0.5) * 4.0
          )
        );

      gibsRef.current.push({
        mesh: gibMesh,
        position: worldPos.clone(),
        velocity: gibVel,
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16
        ),
        life: 0,
        maxLife: 22,
        isFleshCap: true,
      });

      return affectedVerticesCount;
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

      let damageDealt = 0;

      // 1. NPC IMMEDIATELY STOPS WALKING AFTER GETTING HIT
      npc.hasTakenDamage = true;
      npc.wanderState = 'idle';
      npc.wanderTimer = 999999;
      npc.velocity.set(0, 0, 0);

      const isGroinAttack = partKey === 'hips';

      if (isGroinAttack) {
        playPlayerAttackAnim('mixamo_boxing_groinkick.fbx');
        playNPCAnimation(npc, 'mixamo_groin_hurt.fbx', false, true);
        damageDealt = 45;
        audio.playHeavyHit();
        setHitMessage(`GROIN KICK! [${npc.name}: -${damageDealt} HP]`);
      } else {
        if (chargeLevel === 1) {
          playPlayerAttackAnim('mixamo_headbutt.fbx');
          damageDealt = 25;
          audio.playLightHit();
          setHitMessage(`HEADBUTT [${npc.name}: -${damageDealt} HP]`);
        } else if (chargeLevel === 2) {
          playPlayerAttackAnim('mixamo_meleepunch.fbx');
          damageDealt = 50;
          audio.playHeavyHit();
          setHitMessage(`MELEE PUNCH [${npc.name}: -${damageDealt} HP]`);
        } else if (chargeLevel === 3) {
          // LEVEL 3 ATTACK: IMMEDIATELY KILL NPC WITH DYING ANIMATION
          playPlayerAttackAnim('mixamo_highkick.fbx');
          damageDealt = 100;
          audio.playDismemberHit();
          setHitMessage(`HIGH KICK FATALITY! [${npc.name} KILLED]`);
        } else {
          // LEVEL 4 ATTACK: DOOM OBLITERATION
          playPlayerAttackAnim('mixamo_torchmelee.fbx');
          damageDealt = 100;
          audio.playObliterationBlast();
          setHitMessage(`TORCH MELEE OBLITERATION! [${npc.name} PULPED]`);
        }
      }

      // Impulse velocity
      const forceMultiplier = chargeLevel === 4 ? 9.5 : chargeLevel === 3 ? 7.5 : chargeLevel === 2 ? 5.0 : 3.0;
      npc.velocity.add(punchDir.clone().multiplyScalar(forceMultiplier));
      npc.staggerVelocity += forceMultiplier * 3.5;

      emitBloodSpray(
        npc.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
        punchDir,
        chargeLevel * 16,
        chargeLevel * 2.4,
        0.5
      );
      if (chargeLevel >= 2) {
        createFloorBloodDecal(npc.position, 0.35 * chargeLevel);
      }

      // Dismemberment on Level 3: calculate wireframe vertices and detach targeted limb
      if (chargeLevel === 3 && !npc.isDead) {
        severBodyPartWithWireframe(npc, partKey, punchDir, 1.1);
      }

      // Level 4 Obliteration: detach ALL body parts and spread them around!
      if (chargeLevel === 4) {
        screenShakeRef.current = 0.65;
        npc.isObliterated = true;
        npc.isDead = true;
        npc.isRagdoll = true;

        const origin = npc.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        const colors = BLOOD_COLORS[bloodStyleRef.current];

        // Detach EVERY body part and spread around the maze with wireframe extraction
        for (const def of VRM_COLLIDER_DEFS) {
          severBodyPartWithWireframe(npc, def.boneKey, punchDir, 1.4);
        }

        // Additional 20 meat gib chunks flying in 360-degree radius
        const gibGeos = [
          new THREE.SphereGeometry(0.12, 8, 8),
          new THREE.BoxGeometry(0.18, 0.14, 0.12),
          new THREE.CylinderGeometry(0.06, 0.05, 0.22, 6),
          new THREE.SphereGeometry(0.09, 8, 8),
          new THREE.BoxGeometry(0.14, 0.1, 0.08),
        ];

        for (let i = 0; i < 20; i++) {
          const geo = gibGeos[i % gibGeos.length];
          const mat = new THREE.MeshStandardMaterial({
            color: Math.random() > 0.3 ? colors.base : colors.drip,
            roughness: 0.8,
            metalness: 0.0,
          });
          const gibMesh = new THREE.Mesh(geo, mat);
          gibMesh.position.copy(origin);
          scene.add(gibMesh);

          const burstAngle = Math.random() * Math.PI * 2;
          const radial = new THREE.Vector3(Math.cos(burstAngle), 0, Math.sin(burstAngle));
          const gibVel = radial.multiplyScalar(4.5 + Math.random() * 6.5)
            .add(punchDir.clone().multiplyScalar(4.0))
            .add(new THREE.Vector3(0, 2.5 + Math.random() * 5.5, 0));

          gibsRef.current.push({
            mesh: gibMesh,
            position: origin.clone(),
            velocity: gibVel,
            angularVelocity: new THREE.Vector3(
              (Math.random() - 0.5) * 18,
              (Math.random() - 0.5) * 18,
              (Math.random() - 0.5) * 18
            ),
            life: 0,
            maxLife: 24,
            isFleshCap: true,
          });
        }

        if (npc.vrm) {
          npc.vrm.scene.visible = false;
        }
        scene.remove(npc.rootGroup);

        emitBloodSpray(origin, punchDir, 120, 9.5, 1.4);
        createFloorBloodDecal(npc.position, 1.1);
        createFloorBloodDecal(npc.position.clone().add(new THREE.Vector3(0.5, 0, 0.4)), 0.75);
        createFloorBloodDecal(npc.position.clone().add(new THREE.Vector3(-0.5, 0, -0.4)), 0.65);
      } else {
        // Deduct health
        npc.health = Math.max(0, npc.health - damageDealt);
        npc.bloodStainsCount++;

        // Check if dead (Level 3 immediately kills, or health <= 0)
        if ((npc.health <= 0 || chargeLevel === 3) && !npc.isDead) {
          npc.isDead = true;
          npc.health = 0;
          npc.dyingTimer = 2.0;

          const npcForward = new THREE.Vector3(0, 0, -1).applyEuler(npc.rotation);
          const attackAngleDot = punchDir.dot(npcForward);

          if (chargeLevel >= 2) {
            if (attackAngleDot < -0.1) {
              playNPCAnimation(npc, 'mixamo_dying_flyback.fbx', false, true);
            } else {
              playNPCAnimation(npc, 'mixamo_dying_slideforward.fbx', false, true);
            }
          } else {
            playNPCAnimation(npc, 'mixamo_dying.fbx', false, true);
          }
        } else if (npc.health > 0 && !isGroinAttack) {
          playNPCAnimation(npc, 'mixamo_idle_injured.fbx', true, false);
        } else if (npc.isDead) {
          // If corpse is attacked again: switch immediately to free ragdoll!
          npc.isRagdoll = true;
          setupNPCRagdoll(npc);
        }
      }

      flashNpcMaterials(npc);

      // Damage Popup
      if (cameraRef.current && containerRef.current) {
        const hitScreenPos = npc.position.clone().add(new THREE.Vector3(0, 1.45, 0));
        hitScreenPos.project(cameraRef.current);
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        const screenX = (hitScreenPos.x * 0.5 + 0.5) * w;
        const screenY = (-hitScreenPos.y * 0.5 + 0.5) * h;

        const popupId = `dmg-${Date.now()}-${Math.random()}`;
        setDamagePopups((prev) => [
          ...prev.slice(-6),
          {
            id: popupId,
            text: `-${damageDealt}${chargeLevel >= 3 ? ' FATAL!' : ''}`,
            x: screenX,
            y: screenY,
            color: chargeLevel === 4 ? '#ef4444' : chargeLevel === 3 ? '#f97316' : '#55d2f6',
          },
        ]);
        setTimeout(() => {
          setDamagePopups((prev) => prev.filter((p) => p.id !== popupId));
        }, 1100);
      }

      setTimeout(() => setHitMessage(null), 2500);
    },
    [emitBloodSpray, createFloorBloodDecal, playPlayerAttackAnim, playNPCAnimation, setupNPCRagdoll, severBodyPartWithWireframe]
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
    scene.background = new THREE.Color(0x141824);
    scene.fog = new THREE.FogExp2(0x141824, 0.007);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / container.clientHeight,
      0.1,
      95.0
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

    // Bright, optimized lighting (no shiny glare)
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(12, 22, 14);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 70;
    keyLight.shadow.camera.left = -25;
    keyLight.shadow.camera.right = 25;
    keyLight.shadow.camera.top = 25;
    keyLight.shadow.camera.bottom = -25;
    scene.add(keyLight);

    const cyanFillLight = new THREE.DirectionalLight(0xa5e8fc, 1.1);
    cyanFillLight.position.set(-15, 10, -12);
    scene.add(cyanFillLight);

    // Warm & Cyan Corridor Point Lights throughout the Maze
    const corridorLights = [
      { x: 0, z: 0, color: 0x55d2f6 },
      { x: -14, z: -14, color: 0xffe8c2 },
      { x: 14, z: 14, color: 0x55d2f6 },
      { x: -14, z: 14, color: 0xffe8c2 },
      { x: 14, z: -14, color: 0x55d2f6 },
      { x: 0, z: -14, color: 0xa8f0e5 },
      { x: 0, z: 14, color: 0xffd1b3 },
      { x: -14, z: 0, color: 0x55d2f6 },
      { x: 14, z: 0, color: 0xffe8c2 },
    ];

    corridorLights.forEach((lightDef) => {
      const pl = new THREE.PointLight(lightDef.color, 2.2, 18, 1.0);
      pl.position.set(lightDef.x, 2.8, lightDef.z);
      scene.add(pl);
    });

    // ====================================================
    // Procedural Maze Construction (Matte Optimized Surfaces)
    // ====================================================
    const maze = mazeRef.current;
    const mazeTotalSpan = (maze.size + 2) * maze.cellSize;

    // Floor Mesh: Matte non-shiny optimized material displaced slightly for robust clearance
    const floorGeo = new THREE.PlaneGeometry(mazeTotalSpan, mazeTotalSpan);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e2433,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02; // Displaced slightly down so models never visually clip
    floor.receiveShadow = true;
    scene.add(floor);

    // Floor Grid Helper
    const grid = new THREE.GridHelper(mazeTotalSpan, Math.floor(mazeTotalSpan / maze.cellSize), 0x55d2f6, 0x2b3447);
    grid.position.y = 0.001;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    scene.add(grid);

    // Wall Mesh: Matte non-shiny optimized material
    const wallGeo = new THREE.BoxGeometry(maze.cellSize, MAZE_WALL_HEIGHT, maze.cellSize);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x2a3245,
      roughness: 0.95,
      metalness: 0.0,
    });

    const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, maze.walls.length);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    const dummyWallMat = new THREE.Matrix4();
    maze.walls.forEach((w, idx) => {
      dummyWallMat.setPosition(w.x, MAZE_WALL_HEIGHT / 2, w.z);
      wallMesh.setMatrixAt(idx, dummyWallMat);
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    scene.add(wallMesh);

    // Lightweight Emissive Wall Trim Lines
    const trimGeo = new THREE.BoxGeometry(maze.cellSize * 0.98, 0.06, maze.cellSize * 0.98);
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x55d2f6, transparent: true, opacity: 0.75 });
    const trimMesh = new THREE.InstancedMesh(trimGeo, trimMat, maze.walls.length);
    maze.walls.forEach((w, idx) => {
      dummyWallMat.setPosition(w.x, MAZE_WALL_HEIGHT - 0.03, w.z);
      trimMesh.setMatrixAt(idx, dummyWallMat);
    });
    trimMesh.instanceMatrix.needsUpdate = true;
    scene.add(trimMesh);

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

    // Load Player VRM
    const gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

    fetchVRMBuffer(PLAYER_OUTFIT).then((buf) => {
      if (isDisposed || !buf) return;

      gltfLoader.parse(
        buf,
        '',
        (gltf) => {
          if (isDisposed) return;
          const vrm = gltf.userData.vrm as VRM;
          if (vrm) {
            try {
              VRMUtils.removeUnnecessaryVertices(gltf.scene);
              VRMUtils.rotateVRM0(vrm);
            } catch {}
            vrm.scene.position.set(0, 0, 0);
            vrm.scene.rotation.set(0, 0, 0);

            // Auto-calibrate feet level with ground
            vrm.scene.updateMatrixWorld(true);
            const bbox = new THREE.Box3().setFromObject(vrm.scene);
            if (bbox.min.y < 0.0) {
              vrm.scene.position.y = -bbox.min.y;
            }

            vrm.scene.traverse((obj) => {
              obj.frustumCulled = false;
              if ((obj as THREE.Mesh).isMesh) {
                obj.castShadow = true;
              }
            });

            // Resting arm stance
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

            playerRoot.add(vrm.scene);
            playerVrmRef.current = vrm;
            playerHairBonesRef.current = collectHairBones(vrm);
            vrm.update(0);

            const mixer = new THREE.AnimationMixer(vrm.scene);
            playerMixerRef.current = mixer;

            loadRetargetedClipFromFBX('mixamo_walk.fbx', vrm).then((clip) => {
              if (clip && playerMixerRef.current === mixer) {
                const act = mixer.clipAction(clip);
                act.setLoop(THREE.LoopRepeat, Infinity);
                playerActionsRef.current.walk = act;
                if (activePlayerActionRef.current === 'walk') {
                  act.play();
                }
              }
            });

            loadRetargetedClipFromFBX('mixamo_jump.fbx', vrm).then((clip) => {
              if (clip && playerMixerRef.current === mixer) {
                const act = mixer.clipAction(clip);
                act.setLoop(THREE.LoopOnce, 1);
                act.clampWhenFinished = true;
                playerActionsRef.current.jump = act;
              }
            });

            loadRetargetedClipFromFBX('mixamo_idle.fbx', vrm).then((clip) => {
              if (clip && playerMixerRef.current === mixer) {
                const act = mixer.clipAction(clip);
                act.setLoop(THREE.LoopRepeat, Infinity);
                playerActionsRef.current.idle = act;
                if (activePlayerActionRef.current === 'idle') {
                  act.play();
                }
              }
            });
          }
        },
        (err) => {
          console.warn('Failed to parse player VRM:', err);
        }
      );
    });

    // Spawn 4 initial natural NPCs in open areas
    for (let i = 0; i < 4; i++) {
      const outfit = ALL_WARDROBE_OUTFITS[i % ALL_WARDROBE_OUTFITS.length];
      spawnNPC(outfit);
    }

    // --------------------------------------------------
    // Animation & Physics Loop (60 FPS)
    // --------------------------------------------------
    let lastTime = performance.now();
    let naturalSpawnTimer = 0;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      let dt = (now - lastTime) / 1000;
      lastTime = now;

      if (dt > 0.08) dt = 0.08;
      if (isSlowMoRef.current) dt *= 0.28;

      const playerPos = playerPosRef.current;
      playerPrevPosRef.current.copy(playerPos);
      const keys = keysRef.current;
      const currentMaze = mazeRef.current;

      // 0. Natural Spawner (Max 10 living NPCs)
      naturalSpawnTimer += dt;
      if (naturalSpawnTimer > 3.5) {
        naturalSpawnTimer = 0;
        const livingCount = npcsRef.current.filter((n) => !n.isDead && !n.isObliterated).length;
        if (livingCount < 10) {
          const randomOutfit = ALL_WARDROBE_OUTFITS[Math.floor(Math.random() * ALL_WARDROBE_OUTFITS.length)];
          spawnNPC(randomOutfit);
        }
      }

      // Clean up obliterated NPCs
      npcsRef.current = npcsRef.current.filter((n) => {
        if (n.isObliterated) {
          if (n.rootGroup.parent) scene.remove(n.rootGroup);
          return false;
        }
        return true;
      });

      // 1. Player Movement & Input
      const camYaw = cameraYawRef.current;
      const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      const rgt = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
      const moveDir = new THREE.Vector3();

      if (keys.KeyW) moveDir.add(fwd);
      if (keys.KeyS) moveDir.sub(fwd);
      if (keys.KeyD) moveDir.add(rgt);
      if (keys.KeyA) moveDir.sub(rgt);

      let isMoving = moveDir.lengthSq() > 0.001;

      // STRICT RULE: Disable player movement in ANY direction during attack animations!
      if (isPlayerAttackingRef.current) {
        isMoving = false;
        moveDir.set(0, 0, 0);
      }

      const speed = keys.ShiftLeft ? 5.8 : 3.4;

      if (isMoving) {
        moveDir.normalize();
        playerPos.add(moveDir.clone().multiplyScalar(speed * dt));

        resolveMazeCollision(playerPos, 0.42, currentMaze);

        const targetYaw = Math.atan2(moveDir.x, moveDir.z);
        let diff = targetYaw - playerYawRef.current;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        playerYawRef.current += diff * Math.min(1, 14 * dt);
      }

      // Current floor/standing surface height at player's location (allows standing on wall tops!)
      const targetGroundY = getMazeFloorHeightAt(playerPos.x, playerPos.z, currentMaze);

      // High Jump & Wall Landing Mechanics
      if (isJumpingRef.current || playerPos.y > targetGroundY) {
        playerVelYRef.current -= 16.0 * dt; // Gravity
        playerPos.y += playerVelYRef.current * dt;

        // Land on ground OR on wall top!
        if (playerPos.y <= targetGroundY) {
          playerPos.y = targetGroundY;
          playerVelYRef.current = 0;
          isJumpingRef.current = false;
        }
      } else if (playerPos.y < targetGroundY) {
        playerPos.y = targetGroundY;
      }

      // STRICT RULE: Never allow player position to drop below ground level!
      if (playerPos.y < GROUND_FLOOR_Y) {
        playerPos.y = GROUND_FLOOR_Y;
      }

      const playerVelH = playerPos.clone().sub(playerPrevPosRef.current).divideScalar(Math.max(dt, 0.001));

      // Update Player Animation Mixer
      if (playerMixerRef.current) {
        playerMixerRef.current.update(dt);
      }

      // Transition animations (Walk / Idle / Jump)
      if (!isPlayerAttackingRef.current) {
        const targetAnimState = isJumpingRef.current || playerPos.y > targetGroundY + 0.1
          ? 'jump'
          : isMoving
          ? 'walk'
          : 'idle';

        if (activePlayerActionRef.current !== targetAnimState) {
          const prevAnim = activePlayerActionRef.current;
          activePlayerActionRef.current = targetAnimState;

          const prevAction = playerActionsRef.current[prevAnim];
          const nextAction = playerActionsRef.current[targetAnimState];

          if (nextAction) {
            if (targetAnimState === 'jump') {
              nextAction.reset().play();
            } else {
              nextAction.reset().fadeIn(0.15).play();
            }
            if (prevAction && prevAction !== nextAction) {
              prevAction.fadeOut(0.15);
            }
          }
        }
      }

      if (playerRootRef.current) {
        playerRootRef.current.position.copy(playerPos);
        playerRootRef.current.rotation.y = playerYawRef.current;
        playerRootRef.current.updateMatrixWorld(true);

        // Strict per-frame ground clamp for player
        clampEntityAboveGround(playerRootRef.current, playerVrmRef.current, targetGroundY);
      }

      // Animation Mixing & Leg Movement Override When Moving
      const pVrm = playerVrmRef.current;
      if (pVrm && pVrm.humanoid) {
        // Whenever movement is detected, apply procedural leg kinematics and override against other animations!
        if (isMoving && !isJumpingRef.current) {
          const strideFreq = keys.ShiftLeft ? 9.5 : 6.2;
          const strideTime = now * 0.001 * strideFreq;
          const strideAmp = keys.ShiftLeft ? 0.65 : 0.45;

          const lUpLeg = pVrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
          const rUpLeg = pVrm.humanoid.getNormalizedBoneNode('rightUpperLeg');
          const lLowLeg = pVrm.humanoid.getNormalizedBoneNode('leftLowerLeg');
          const rLowLeg = pVrm.humanoid.getNormalizedBoneNode('rightLowerLeg');

          if (lUpLeg && rUpLeg) {
            const lStride = Math.sin(strideTime) * strideAmp;
            const rStride = Math.sin(strideTime + Math.PI) * strideAmp;
            lUpLeg.rotation.x = THREE.MathUtils.lerp(lUpLeg.rotation.x, lStride, 0.5);
            rUpLeg.rotation.x = THREE.MathUtils.lerp(rUpLeg.rotation.x, rStride, 0.5);

            if (lLowLeg && rLowLeg) {
              const lKnee = Math.max(0, -Math.sin(strideTime)) * strideAmp * 1.3;
              const rKnee = Math.max(0, -Math.sin(strideTime + Math.PI)) * strideAmp * 1.3;
              lLowLeg.rotation.x = THREE.MathUtils.lerp(lLowLeg.rotation.x, lKnee, 0.5);
              rLowLeg.rotation.x = THREE.MathUtils.lerp(rLowLeg.rotation.x, rKnee, 0.5);
            }
          }
        }

        // Dynamic Hair Physics for Player
        const time = now * 0.003;
        const forwardSpeed = playerVelH.length();

        for (const track of playerHairBonesRef.current) {
          const targetSwayX = -playerVelH.z * 0.05 + playerVelYRef.current * 0.03 + Math.sin(time * 6 + track.phase) * (0.04 * Math.min(forwardSpeed, 4));
          const targetSwayZ = -playerVelH.x * 0.05 + Math.cos(time * 5 + track.phase) * 0.03;
          track.swayX = THREE.MathUtils.lerp(track.swayX, targetSwayX, 0.15);
          track.swayZ = THREE.MathUtils.lerp(track.swayZ, targetSwayZ, 0.15);

          track.bone.rotation.x = track.initialRot.x + track.swayX;
          track.bone.rotation.z = track.initialRot.z + track.swayZ;
        }

        // Keyframed Hand Reach IK for Grabbing Mechanism
        const grabbed = grabbedNpcRef.current;
        if (grabbed && grabbed.boneNode && pVrm.humanoid) {
          const rArm = pVrm.humanoid.getNormalizedBoneNode('rightUpperArm');
          const rLowerArm = pVrm.humanoid.getNormalizedBoneNode('rightLowerArm');
          const rHand = pVrm.humanoid.getNormalizedBoneNode('rightHand');

          const targetWorldPos = new THREE.Vector3();
          grabbed.boneNode.getWorldPosition(targetWorldPos);

          const shoulderWorldPos = new THREE.Vector3();
          if (rArm) rArm.getWorldPosition(shoulderWorldPos);

          const toTarget = targetWorldPos.clone().sub(shoulderWorldPos);
          const reachDist = toTarget.length();
          toTarget.normalize();

          const localDir = toTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), -playerYawRef.current);

          if (rArm) {
            rArm.rotation.x = THREE.MathUtils.clamp(-localDir.y * 1.5 - 0.2, -1.8, 0.5);
            rArm.rotation.y = THREE.MathUtils.clamp(localDir.x * 1.2, -1.2, 1.2);
            rArm.rotation.z = THREE.MathUtils.clamp(0.2 - localDir.x * 0.5, -0.5, 1.0);
          }
          if (rLowerArm) {
            rLowerArm.rotation.x = THREE.MathUtils.clamp(-0.2 - reachDist * 0.1, -1.0, 0.0);
          }

          // Lock grabbed target position to hand in world space
          const handWorldPos = new THREE.Vector3();
          if (rHand) {
            rHand.getWorldPosition(handWorldPos);
          } else {
            handWorldPos.copy(playerPos).add(new THREE.Vector3(0, 1.1, 0)).add(moveDir.clone().multiplyScalar(0.8));
          }

          // Move corpse / target ragdoll along with hand
          const targetP = grabbed.npc.ragdollParticles.find((part) => part.name === grabbed.partKey);
          if (targetP) {
            targetP.position.copy(handWorldPos);
          } else {
            grabbed.npc.position.copy(handWorldPos).sub(new THREE.Vector3(0, 0.8, 0));
          }
        }

        pVrm.scene.updateMatrixWorld(true);
        pVrm.update(dt);
      }

      // Camera Orbit
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

      // Attack Charging
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
      let targetFound = false;

      if (intersects.length > 0) {
        const hit = intersects[0];
        const distFromPlayer = hit.point.distanceTo(playerPos);
        if (distFromPlayer <= 5.0) {
          const data = hit.object.userData;
          setTargetedPartUI({
            partKey: data.bodyPartKey,
            displayName: data.displayName || 'Body',
            inRange: true,
          });
          targetFound = true;
        }
      }

      if (!targetFound) {
        setTargetedPartUI(null);
      }

      // NPC AI, Hair Physics, Dying Animations, & Free Ragdoll Corpses
      for (const npc of npcsRef.current) {
        if (npc.isObliterated) continue;

        const npcGroundY = getMazeFloorHeightAt(npc.position.x, npc.position.z, currentMaze);

        // Dynamic Hair Physics for NPCs
        if (npc.vrm) {
          const time = now * 0.003;
          const npcSpeed = npc.velocity.length();
          for (const track of npc.hairBones) {
            const sway = Math.sin(time * 5 + track.phase) * (0.04 + npcSpeed * 0.03);
            track.bone.rotation.x = track.initialRot.x + sway;
            track.bone.rotation.z = track.initialRot.z + Math.cos(time * 4 + track.phase) * 0.03;
          }
        }

        // Dying sequence & corpse movement:
        if (npc.isDead && npc.dyingTimer > 0) {
          npc.dyingTimer -= dt;
          if (npc.dyingTimer <= 0) {
            npc.isRagdoll = true;
            setupNPCRagdoll(npc);
          }
        }

        // Push corpse if player walks into it!
        const distToPlayer = npc.position.distanceTo(playerPos);
        if (distToPlayer < 0.9 && npc.isDead) {
          const pushVec = npc.position.clone().sub(playerPos).setY(0).normalize();
          npc.velocity.add(pushVec.multiplyScalar(4.5 * dt));
        }

        // Living & not ragdoll: execute wandering (only if uninjured!)
        if (!npc.isDead && !npc.isRagdoll) {
          if (!npc.hasTakenDamage) {
            npc.wanderTimer -= dt;
            if (npc.wanderTimer <= 0) {
              if (npc.wanderState === 'idle') {
                npc.wanderState = 'walk';
                npc.wanderTimer = 3.0 + Math.random() * 4.0;
                const angle = Math.random() * Math.PI * 2;
                npc.wanderDir.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
                playNPCAnimation(npc, 'mixamo_walk.fbx', true, false);
              } else {
                npc.wanderState = 'idle';
                npc.wanderTimer = 2.5 + Math.random() * 5.0;
                const randomStandby = STANDBY_ANIMATION_FILES[Math.floor(Math.random() * STANDBY_ANIMATION_FILES.length)];
                playNPCAnimation(npc, randomStandby, true, false);
              }
            }

            if (npc.wanderState === 'walk') {
              const wanderSpeed = 1.6;
              npc.position.add(npc.wanderDir.clone().multiplyScalar(wanderSpeed * dt));
              resolveMazeCollision(npc.position, 0.38, currentMaze);

              const targetYaw = Math.atan2(npc.wanderDir.x, npc.wanderDir.z);
              let diff = targetYaw - npc.rotation.y;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              npc.rotation.y += diff * Math.min(1, 8 * dt);
              npc.rootGroup.rotation.y = npc.rotation.y;
            }
          }
        }

        // Apply velocity & maze wall collisions for living, dying and corpse entities!
        npc.position.add(npc.velocity.clone().multiplyScalar(dt));
        npc.velocity.multiplyScalar(Math.pow(0.85, dt * 60));
        resolveMazeCollision(npc.position, 0.38, currentMaze);

        // Strict rule: NPC position never below ground!
        if (npc.position.y < npcGroundY) {
          npc.position.y = npcGroundY;
        }

        npc.rootGroup.position.copy(npc.position);

        // ALWAYS update animation mixer so dying animations advance and play!
        if (npc.mixer) {
          npc.mixer.update(dt);
        }

        // Full Free Verlet Ragdoll Physics Simulation for Corpses & Grabbed Entities
        if (npc.isRagdoll && npc.ragdollParticles.length > 0) {
          const gravity = new THREE.Vector3(0, -16.0, 0);

          for (const p of npc.ragdollParticles) {
            const vel = p.position.clone().sub(p.prevPosition).multiplyScalar(0.94);
            p.prevPosition.copy(p.position);
            p.position.add(vel).add(gravity.clone().multiplyScalar(dt * dt));

            // Floor collision & ground friction (Strict rule: never sink below ground!)
            const minParticleY = npcGroundY + p.radius;
            if (p.position.y < minParticleY) {
              p.position.y = minParticleY;
              p.prevPosition.x = THREE.MathUtils.lerp(p.prevPosition.x, p.position.x, 0.35);
              p.prevPosition.z = THREE.MathUtils.lerp(p.prevPosition.z, p.position.z, 0.35);
            }
            resolveMazeCollision(p.position, p.radius, currentMaze);
          }

          // Skeletal distance relaxation
          for (let iter = 0; iter < 4; iter++) {
            for (const stick of npc.ragdollSticks) {
              const delta = stick.p2.position.clone().sub(stick.p1.position);
              const curDist = delta.length();
              if (curDist > 0.0001) {
                const diff = (curDist - stick.restLength) / curDist;
                stick.p1.position.add(delta.clone().multiplyScalar(0.5 * diff));
                stick.p2.position.sub(delta.clone().multiplyScalar(0.5 * diff));
              }
            }
          }

          const hipsP = npc.ragdollParticles.find((p) => p.name === 'hips');
          if (hipsP) {
            npc.position.copy(hipsP.position);
            npc.rootGroup.position.copy(npc.position);
          }

          for (const p of npc.ragdollParticles) {
            if (p.boneNode) {
              p.boneNode.position.copy(p.position).sub(npc.position);
            }
          }
        }

        // Enforce strict above-ground rule on every NPC
        clampEntityAboveGround(npc.rootGroup, npc.vrm, npcGroundY);

        if (npc.vrm) {
          npc.vrm.scene.updateMatrixWorld(true);
          npc.vrm.update(dt);
        }

        // Arterial blood fountains on severed VRM stumps
        for (const k in npc.parts) {
          const part = npc.parts[k as BodyPartKey];
          if (part.isDetached && part.fountainTimer > 0) {
            part.fountainTimer -= dt;
            if (part.stumpCap) {
              const capPos = new THREE.Vector3();
              part.stumpCap.getWorldPosition(capPos);
              emitBloodSpray(capPos, new THREE.Vector3(0, 1, 0), 2, 2.5 + Math.random() * 2.0, 0.4);
            }
          }
        }
      }

      // Gibs Physics
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

        const gibGroundY = getMazeFloorHeightAt(gib.position.x, gib.position.z, currentMaze) + 0.08;
        if (gib.position.y <= gibGroundY) {
          gib.position.y = gibGroundY;
          gib.velocity.y = -gib.velocity.y * 0.35;
          gib.velocity.x *= 0.75;
          gib.velocity.z *= 0.75;

          if (Math.random() > 0.6) {
            createFloorBloodDecal(gib.position, 0.22);
          }
        }

        resolveMazeCollision(gib.position, 0.12, currentMaze);
        gib.mesh.position.copy(gib.position);
        gib.mesh.rotation.x += gib.angularVelocity.x * dt;
        gib.mesh.rotation.y += gib.angularVelocity.y * dt;
        gib.mesh.rotation.z += gib.angularVelocity.z * dt;
        gib.angularVelocity.multiplyScalar(0.96);
      }

      // Blood Particle Simulation
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

        const pGroundY = getMazeFloorHeightAt(p.position.x, p.position.z, currentMaze) + 0.01;
        if (p.position.y <= pGroundY) {
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

      // Spacebar: High Jump with Wall-Topping Capability
      if (e.code === 'Space') {
        e.preventDefault();
        const currentGroundY = getMazeFloorHeightAt(playerPosRef.current.x, playerPosRef.current.z, mazeRef.current);
        if (!isJumpingRef.current && Math.abs(playerPosRef.current.y - currentGroundY) <= 0.15) {
          isJumpingRef.current = true;
          playerVelYRef.current = 11.5;
          const jumpAct = playerActionsRef.current.jump;
          if (jumpAct) {
            jumpAct.reset().play();
            playerActionsRef.current.walk?.fadeOut(0.12);
            playerActionsRef.current.idle?.fadeOut(0.12);
          }
        }
      }

      // "G" Key: Grab / Detach Keyframed Hand Reach & Physical Attachment
      if (e.code === 'KeyG') {
        if (grabbedNpcRef.current) {
          grabbedNpcRef.current = null;
          setIsGrabbingUI(false);
          setGrabbedLabelUI('');
          setHitMessage('DETACHED HAND');
          setTimeout(() => setHitMessage(null), 1500);
        } else {
          const raycaster = new THREE.Raycaster();
          if (cameraRef.current) {
            raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);
            const allColliders: THREE.Mesh[] = [];
            for (const n of npcsRef.current) {
              if (!n.isObliterated) allColliders.push(...n.proxyColliders);
            }
            const hits = raycaster.intersectObjects(allColliders, false);
            if (hits.length > 0) {
              const hit = hits[0];
              const dist = hit.point.distanceTo(playerPosRef.current);
              if (dist <= 5.0) {
                const data = hit.object.userData;
                const targetNPC = npcsRef.current.find((n) => n.id === data.npcId);
                if (targetNPC) {
                  targetNPC.isRagdoll = true;
                  setupNPCRagdoll(targetNPC);
                  grabbedNpcRef.current = {
                    npc: targetNPC,
                    partKey: data.bodyPartKey,
                    boneNode: data.boneNode,
                  };
                  setIsGrabbingUI(true);
                  setGrabbedLabelUI(`${targetNPC.name} (${data.displayName})`);
                  audio.playGrabSound();
                  setHitMessage(`ATTACHED TO ${targetNPC.name.toUpperCase()} [${data.displayName.toUpperCase()}]`);
                  setTimeout(() => setHitMessage(null), 1800);
                }
              }
            }
          }
        }
      }

      if (e.code === 'KeyN') {
        setIsLibraryOpen((prev) => !prev);
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

        const playerPos = playerPosRef.current;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const allColliders: THREE.Mesh[] = [];
        for (const n of npcsRef.current) {
          if (!n.isObliterated) allColliders.push(...n.proxyColliders);
        }

        const hits = raycaster.intersectObjects(allColliders, false);
        let targetNPC: NPCEntity | null = null;
        let partKey: BodyPartKey = 'chest';

        if (hits.length > 0) {
          const hit = hits[0];
          const distFromPlayer = hit.point.distanceTo(playerPos);
          if (distFromPlayer <= 5.0) {
            const npcId = hit.object.userData.npcId;
            targetNPC = npcsRef.current.find((n) => n.id === npcId) || null;
            partKey = (hit.object.userData.bodyPartKey as BodyPartKey) || 'chest';
          }
        }

        if (targetNPC) {
          executePunchImpact(targetNPC, partKey, punchLvl);
        } else {
          if (punchLvl === 1) playPlayerAttackAnim('mixamo_headbutt.fbx');
          else if (punchLvl === 2) playPlayerAttackAnim('mixamo_meleepunch.fbx');
          else if (punchLvl === 3) playPlayerAttackAnim('mixamo_highkick.fbx');
          else playPlayerAttackAnim('mixamo_torchmelee.fbx');
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
  }, [spawnNPC, executePunchImpact, emitBloodSpray, createFloorBloodDecal, playPlayerAttackAnim, setupNPCRagdoll]);

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

      spawnNPC(customOutfit);
      setIsLibraryOpen(false);
    },
    [spawnNPC]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden select-none bg-[#141824] text-white font-sans"
    >
      {/* 3D Viewport Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="w-full h-full block cursor-crosshair"
      />

      {/* TOP HEADER */}
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

          {isGrabbingUI && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-950/90 backdrop-blur-md border border-cyan-400 text-cyan-300 text-xs font-bold animate-pulse shadow-lg">
              <Hand className="w-3.5 h-3.5" />
              <span>HAND ATTACHED: {grabbedLabelUI.toUpperCase()} • PRESS [G] TO DETACH</span>
            </div>
          )}
        </div>

        {/* Right Toolbar */}
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
            <span className="hidden md:inline">Blood:</span>
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

      {/* CENTER ACTION RETICLE & CLEAN MINIMAL AIMING */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative flex items-center justify-center">
          {/* Circular Charge Ring */}
          {chargeProgressUI > 0 && (
            <div className="absolute w-24 h-24 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.15)"
                  strokeWidth="4"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={
                    chargeLevelUI === 4
                      ? '#ef4444'
                      : chargeLevelUI === 3
                      ? '#f97316'
                      : chargeLevelUI === 2
                      ? '#eab308'
                      : '#55d2f6'
                  }
                  strokeWidth="5"
                  strokeDasharray="264"
                  strokeDashoffset={264 - 264 * chargeProgressUI}
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}

          {/* Central Crosshair: Turns bright red when in range */}
          <div
            className={`w-3.5 h-3.5 border-2 rounded-full transition-all duration-100 ${
              targetedPartUI?.inRange
                ? 'border-red-500 scale-125 bg-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.8)]'
                : 'border-white/50 scale-100 bg-transparent'
            }`}
          />

          {/* Targeted body part name below crosshair */}
          {targetedPartUI && (
            <div className="absolute top-6 flex flex-col items-center">
              <span className="text-[11px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-black/75 backdrop-blur-md border border-red-500/40 text-red-300 drop-shadow">
                {targetedPartUI.displayName}
              </span>
              <span className="text-[9px] font-mono text-cyan-300 mt-0.5">
                {isGrabbingUI ? '[G] Detach Hand' : '[G] Attach Hand'}
              </span>
            </div>
          )}

          {/* Hit Marker Red X */}
          {hitMarkerActive && (
            <div className="absolute w-10 h-10 flex items-center justify-center animate-ping pointer-events-none">
              <span className="text-red-500 font-extrabold text-2xl select-none">✕</span>
            </div>
          )}
        </div>
      </div>

      {/* FLOATING 3D DAMAGE POPUPS */}
      {damagePopups.map((popup) => (
        <div
          key={popup.id}
          style={{ left: `${popup.x}px`, top: `${popup.y}px` }}
          className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-30 font-black text-2xl tracking-wider drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] animate-bounce"
        >
          <span style={{ color: popup.color }}>{popup.text}</span>
        </div>
      ))}

      {/* COMBAT HIT NOTIFICATION */}
      {hitMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-30">
          <div className="px-4 py-1.5 rounded-xl bg-neutral-900/95 border border-red-500/70 text-white font-bold text-xs tracking-wider shadow-2xl flex items-center gap-2">
            <Skull className="w-3.5 h-3.5 text-red-400" />
            <span>{hitMessage}</span>
          </div>
        </div>
      )}

      {/* BOTTOM HUD: Player Health Bar & Clean Spawn NPC Button */}
      <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between pointer-events-auto z-20">
        {/* Left: Player Own Character Health Bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 shadow-xl">
          <div className="w-9 h-9 rounded-xl bg-red-950/70 border border-red-500/40 flex items-center justify-center shrink-0">
            <Heart className="w-4 h-4 text-red-400 fill-red-500/40" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-bold text-white tracking-wide">Hana</span>
              <span className="text-[11px] font-mono font-bold text-emerald-400">{playerHealthUI} / 100 HP</span>
            </div>
            <div className="w-36 sm:w-48 h-2 bg-neutral-800 rounded-full overflow-hidden border border-neutral-700 mt-1">
              <div
                className="h-full bg-gradient-to-r from-red-500 via-amber-400 to-emerald-400 transition-all duration-200"
                style={{ width: `${Math.max(0, playerHealthUI)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: Single Spawn NPC Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[#55d2f6] hover:bg-[#38c4ed] active:scale-95 text-neutral-950 font-bold text-xs shadow-xl transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Spawn NPC</span>
          </button>
        </div>
      </div>

      {/* POP-UP MODAL: NPC LIBRARY COLLECTION */}
      {isLibraryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-4xl max-h-[85vh] bg-[#181b26] border border-[#2b3042] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[#2b3042] flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Skull className="w-5 h-5 text-[#55d2f6]" />
                  <span>Spawn NPC Model Library Collection</span>
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Spawns authentic VRM models directly into the procedural maze arena
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

            <div className="p-4 border-b border-[#2b3042] bg-neutral-900/40 flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search model by name or filename..."
                  className="w-full pl-9 pr-3 py-2 bg-[#12141d] border border-[#2b3042] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#55d2f6] transition-all"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                {['all', 'maid', 'dress', 'secret', 'premium'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setLibraryCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all cursor-pointer ${
                      libraryCategory === cat
                        ? 'bg-[#55d2f6] text-neutral-950 shadow-md font-bold'
                        : 'bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 transition-all cursor-pointer shrink-0">
                <span>Upload VRM</span>
                <input
                  type="file"
                  accept=".vrm"
                  className="hidden"
                  onChange={handleCustomVrmUpload}
                />
              </label>
            </div>

            <div className="p-5 overflow-y-auto flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
              {filteredOutfits.map((outfit) => (
                <div
                  key={outfit.id}
                  onClick={() => {
                    spawnNPC(outfit);
                    setIsLibraryOpen(false);
                  }}
                  className="group relative p-3 rounded-xl bg-[#141722] border border-[#272d3f] hover:border-[#55d2f6] transition-all cursor-pointer flex flex-col items-center text-center shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-0.5"
                >
                  <div className="w-16 h-16 rounded-xl bg-neutral-800/80 border border-neutral-700/60 flex items-center justify-center mb-2.5 overflow-hidden group-hover:border-[#55d2f6] transition-colors">
                    {(outfit as any).previewImage ? (
                      <img
                        src={(outfit as any).previewImage}
                        alt={outfit.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Skull className="w-8 h-8 text-neutral-400 group-hover:text-[#55d2f6] transition-colors" />
                    )}
                  </div>
                  <span className="text-xs font-bold text-white line-clamp-1 group-hover:text-[#55d2f6] transition-colors">
                    {outfit.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 font-mono mt-0.5 line-clamp-1">
                    {outfit.fileName}
                  </span>

                  <button
                    type="button"
                    className="mt-3 w-full py-1.5 rounded-lg bg-neutral-800 group-hover:bg-[#55d2f6] text-neutral-300 group-hover:text-neutral-950 font-bold text-[11px] transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Spawn</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CONTROLS & GUIDE MODAL [H] */}
      {isControlsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#181b26] border border-[#2b3042] rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2b3042]">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-[#55d2f6]" />
                <h3 className="text-base font-bold text-white">Tor Combat & Maze Controls</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsControlsModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-neutral-300">
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">WASD + Shift</span>
                <span className="font-mono text-neutral-400">Move / Sprint (Mixes with Leg Strides)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Left Click (Hold & Release)</span>
                <span className="font-mono text-neutral-400">Charge Attack (Levels 1-4)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Attack Movement Lock</span>
                <span className="font-mono text-neutral-400">Movement locked during attacks</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Spacebar</span>
                <span className="font-mono text-neutral-400">High Jump (Land on wall tops!)</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">G Key</span>
                <span className="font-mono text-neutral-400">Attach / Detach Hand to Body Part</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Mouse Look</span>
                <span className="font-mono text-neutral-400">Rotate Camera & Aim Reticle</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Level 3 Fatality</span>
                <span className="font-mono text-neutral-400">High Kick, Instant Kill & Dying Anim</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">Level 4 Obliterate</span>
                <span className="font-mono text-neutral-400">Detaches ALL 12 body parts in 360°</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-neutral-800">
                <span className="font-semibold text-white">N Key</span>
                <span className="font-mono text-neutral-400">Open Spawn NPC Library</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-semibold text-white">T Key</span>
                <span className="font-mono text-neutral-400">Toggle Slow Motion</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsControlsModalOpen(false)}
              className="mt-6 w-full py-2.5 rounded-xl bg-[#55d2f6] text-neutral-950 font-bold text-xs hover:bg-[#38c4ed] transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TorGamePage;
