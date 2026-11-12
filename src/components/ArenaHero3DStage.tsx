import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, RefreshCw, RotateCcw } from 'lucide-react';
import type { Vehicle } from '../types/vehicle';
import { getOfficialVehicleImageUrl } from '../data/presetVehicles';
import {
  clearGlbAvailabilityCache,
  createCalibratedVehicle3DInstance,
  getVehicle3DConfig,
  resolveDedicatedVehicleGLTF,
} from '../utils/vehicle3DModelLoader';
import { createVehicleWheelRig, type VehicleWheelRig } from '../utils/vehicleWheelRig';

interface ArenaHero3DStageProps {
  vehicle: Vehicle;
  compact?: boolean;
  onOpen360Modal?: (vehicleId: string) => void;
}

export interface CutoutStop {
  angle: 'front34' | 'front' | 'side' | 'rear34' | 'rear';
  flipX: boolean;
  label: string;
}

export const CUTOUT_ORBIT_STOPS: CutoutStop[] = [
  { angle: 'front34', flipX: false, label: '3/4 Delantera' },
  { angle: 'front', flipX: false, label: 'Frontal' },
  { angle: 'front34', flipX: true, label: '3/4 Delantera Der.' },
  { angle: 'side', flipX: true, label: 'Perfil Der.' },
  { angle: 'rear34', flipX: true, label: '3/4 Trasera Der.' },
  { angle: 'rear', flipX: false, label: 'Trasera' },
  { angle: 'rear34', flipX: false, label: '3/4 Trasera Izq.' },
  { angle: 'side', flipX: false, label: 'Perfil Izq.' },
];

const DEFAULT_HERO_YAW = -0.58; // Ángulo protagonista 3/4 delantero izquierdo
const DEFAULT_HERO_PITCH = 0.045; // Altura de cámara automotriz natural alineada al horizonte del estadio

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
})();

function createShowroomContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 16, 128, 128, 124);
    grad.addColorStop(0, 'rgba(1, 4, 9, 0.96)');
    grad.addColorStop(0.5, 'rgba(2, 6, 12, 0.72)');
    grad.addColorStop(0.78, 'rgba(2, 6, 12, 0.26)');
    grad.addColorStop(1, 'rgba(2, 6, 12, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Crea la textura PBR de plataforma de asfalto mojado de Garaje / Arena con:
 * - Grano mineral oscuro húmedo y charcos especulares
 * - Líneas de bahía de estacionamiento y aro luminoso cian/ámbar en perspectiva 3D real
 * - Máscara radial suave en los bordes para fundirse sin corte con la foto del estadio
 */
function createArenaBayFloorTextures(maxAnisotropy: number): {
  colorMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
} {
  const size = 512;
  const half = size / 2;

  // 1. Albedo + demarcación de bahía de garaje
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext('2d');
  if (cctx) {
    const bgGrad = cctx.createRadialGradient(half, half, 24, half, half, half);
    bgGrad.addColorStop(0, '#0d1a26');
    bgGrad.addColorStop(0.52, '#09131d');
    bgGrad.addColorStop(1, '#050c13');
    cctx.fillStyle = bgGrad;
    cctx.fillRect(0, 0, size, size);

    // Micrograno de asfalto húmedo y reflejos cian/ámbar del estadio
    for (let i = 0; i < 4200; i++) {
      const x = (i * 173.41) % size;
      const y = (i * 97.19) % size;
      const shade = i % 5 === 0 ? 'rgba(56, 232, 255, 0.055)' : i % 7 === 0 ? 'rgba(255, 170, 18, 0.045)' : 'rgba(185, 208, 226, 0.04)';
      cctx.fillStyle = shade;
      cctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 2));
    }

    // Líneas diagonales sutiles de bahía técnica de garaje
    cctx.save();
    cctx.strokeStyle = 'rgba(0, 229, 245, 0.24)';
    cctx.lineWidth = 3.2;
    const bayW = 148;
    const bayH = 264;
    const corner = 26;
    // Esquinas del cajón de garaje donde se apoya el vehículo
    const corners: Array<[number, number, number, number]> = [
      [-1, -1, 1, 1],
      [1, -1, -1, 1],
      [-1, 1, 1, -1],
      [1, 1, -1, -1],
    ];
    for (const [sx, sy, dx, dy] of corners) {
      const cx = half + sx * (bayW / 2);
      const cy = half + sy * (bayH / 2);
      cctx.beginPath();
      cctx.moveTo(cx, cy + dy * corner);
      cctx.lineTo(cx, cy);
      cctx.lineTo(cx + dx * corner, cy);
      cctx.stroke();
    }

    // Guías laterales segmentadas de bahía
    cctx.setLineDash([14, 12]);
    cctx.strokeStyle = 'rgba(226, 242, 255, 0.12)';
    cctx.lineWidth = 2;
    cctx.beginPath();
    cctx.moveTo(half - bayW / 2, half - bayH / 2 + 34);
    cctx.lineTo(half - bayW / 2, half + bayH / 2 - 34);
    cctx.moveTo(half + bayW / 2, half - bayH / 2 + 34);
    cctx.lineTo(half + bayW / 2, half + bayH / 2 - 34);
    cctx.stroke();
    cctx.setLineDash([]);

    // Aro exterior de plataforma Arena (cian izquierda, ámbar derecha como los reflectores del estadio)
    const ringGrad = cctx.createLinearGradient(60, half, size - 60, half);
    ringGrad.addColorStop(0, 'rgba(0, 229, 245, 0.42)');
    ringGrad.addColorStop(0.5, 'rgba(0, 229, 245, 0.16)');
    ringGrad.addColorStop(1, 'rgba(255, 170, 18, 0.38)');
    cctx.strokeStyle = ringGrad;
    cctx.lineWidth = 3.5;
    cctx.beginPath();
    cctx.arc(half, half, 198, 0, Math.PI * 2);
    cctx.stroke();

    cctx.strokeStyle = 'rgba(0, 229, 245, 0.12)';
    cctx.lineWidth = 1.5;
    cctx.beginPath();
    cctx.arc(half, half, 212, 0, Math.PI * 2);
    cctx.stroke();
    cctx.restore();
  }

  // 2. Mapa de rugosidad (zonas húmedas pulidas vs asfalto poroso)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  if (rctx) {
    rctx.fillStyle = '#5c5c5c'; // roughness media-baja (~0.36)
    rctx.fillRect(0, 0, size, size);
    for (let p = 0; p < 24; p++) {
      const px = half + Math.cos(p * 2.399) * (35 + (p * 17) % 165);
      const py = half + Math.sin(p * 2.399) * (35 + (p * 23) % 165);
      const pr = 26 + (p % 4) * 16;
      const g = rctx.createRadialGradient(px, py, 2, px, py, pr);
      g.addColorStop(0, '#1f1f1f'); // charco muy reflectivo
      g.addColorStop(1, 'rgba(92,92,92,0)');
      rctx.fillStyle = g;
      rctx.beginPath();
      rctx.arc(px, py, pr, 0, Math.PI * 2);
      rctx.fill();
    }
  }

  // 3. Máscara alfa radial suave para integración invisible con el fondo
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = 256;
  alphaCanvas.height = 256;
  const actx = alphaCanvas.getContext('2d');
  if (actx) {
    actx.fillStyle = '#000000';
    actx.fillRect(0, 0, 256, 256);
    const agrad = actx.createRadialGradient(128, 128, 36, 128, 128, 125);
    agrad.addColorStop(0, '#eef4ff');
    agrad.addColorStop(0.62, '#c8d4e6');
    agrad.addColorStop(0.84, '#546070');
    agrad.addColorStop(1, '#000000');
    actx.fillStyle = agrad;
    actx.fillRect(0, 0, 256, 256);
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = maxAnisotropy;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);

  return { colorMap, roughnessMap, alphaMap };
}

/**
 * Escenario protagonista 3D WebGL (`.glb` con soporte de ruedas independientes) integrado con
 * perspectiva automotriz real sobre piso 3D de asfalto mojado de Garaje / Arena.
 */
export const ArenaHero3DStage: React.FC<ArenaHero3DStageProps> = ({
  vehicle,
  compact = false,
  onOpen360Modal,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const compactRef = useRef(compact);
  compactRef.current = compact;

  const [glbStatus, setGlbStatus] = useState<'loading' | 'ready' | 'pending'>('loading');
  const [wheelSplitDetected, setWheelSplitDetected] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [cutoutStopIndex, setCutoutStopIndex] = useState(0);
  const [isRotated, setIsRotated] = useState(false);

  const stageRuntimeRef = useRef<{
    turntable: THREE.Group;
    bayFloorGroup: THREE.Group;
    envMap: THREE.Texture;
    currentYaw: number;
    targetYaw: number;
    currentPitch: number;
    targetPitch: number;
    rollMeters: number;
    wheelRig: VehicleWheelRig | null;
    requestRender: () => void;
    syncCameraFraming: () => void;
  } | null>(null);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    accumulatedDx: number;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    accumulatedDx: 0,
  });

  // Inicialización única y estable del contexto Three.js WebGL con perspectiva automotriz real
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.035);
    const envMap = envTarget.texture;
    scene.environment = envMap;
    pmremGenerator.dispose();

    // Lente automotriz teleobjetivo (25.5° ≈ 80mm equivalente): elimina distorsión de ojo de pez
    // y alinea la línea de horizonte 3D exactamente con el asfalto del estadio/garaje.
    const camera = new THREE.PerspectiveCamera(25.5, 16 / 9, 0.25, 65);

    // Iluminación de estadio / garaje nocturno sincronizada con los reflectores cian (izq) y ámbar (der)
    const hemiLight = new THREE.HemisphereLight(0xbbe8ff, 0x0a1622, 0.98);
    hemiLight.position.set(0, 12, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e2, 2.35);
    keyLight.position.set(4.2, 7.6, 5.8);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      const d = 3.4;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.camera.near = 0.8;
      keyLight.shadow.camera.far = 22;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const cyanStadiumFill = new THREE.DirectionalLight(0x28e7ff, 1.35);
    cyanStadiumFill.position.set(-6.4, 2.6, 3.8);
    scene.add(cyanStadiumFill);

    const amberStadiumRim = new THREE.DirectionalLight(0xffa424, 1.25);
    amberStadiumRim.position.set(6.2, 2.5, -4.4);
    scene.add(amberStadiumRim);

    // Rebote sutil desde el asfalto mojado hacia los bajos y guardabarros
    const wetFloorBounce = new THREE.PointLight(0x16b8df, 0.65, 7.5, 1.8);
    wetFloorBounce.position.set(-1.1, 0.22, 1.4);
    scene.add(wetFloorBounce);

    // Piso 3D físico de asfalto mojado de Garaje / Arena (perspectiva real bajo las 4 ruedas)
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const bayTextures = createArenaBayFloorTextures(maxAniso);
    const bayFloorGroup = new THREE.Group();
    scene.add(bayFloorGroup);

    const bayPadGeo = new THREE.CircleGeometry(4.35, 64);
    const bayPadMat = new THREE.MeshStandardMaterial({
      map: bayTextures.colorMap,
      roughnessMap: bayTextures.roughnessMap,
      alphaMap: bayTextures.alphaMap,
      transparent: true,
      opacity: 0.88,
      roughness: 0.42,
      metalness: 0.34,
      envMapIntensity: 1.35,
      depthWrite: false,
    });
    const bayPadMesh = new THREE.Mesh(bayPadGeo, bayPadMat);
    bayPadMesh.rotation.x = -Math.PI / 2;
    bayPadMesh.position.y = -0.004;
    bayFloorGroup.add(bayPadMesh);

    // Receptor de sombra proyectada sobre el asfalto (con offset para cero Z-fighting)
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.ShadowMaterial({ opacity: 0.52 }),
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.002;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    // Plataforma giratoria del vehículo y su sombra de oclusión de contacto
    const turntable = new THREE.Group();
    turntable.rotation.y = DEFAULT_HERO_YAW;
    scene.add(turntable);

    const contactShadowTex = createShowroomContactShadowTexture();
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const contactShadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.55, 5.25),
      contactShadowMat,
    );
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.006;
    turntable.add(contactShadowMesh);

    const syncCameraFraming = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      const aspect = width / height;
      camera.aspect = aspect;

      // Calibración de distancia para lente de 25.5° + altura de ojos baja (1.02m..1.25m)
      // Así las ruedas apoyan exactamente en el tercio inferior sobre el asfalto del estadio.
      const baseDist = compactRef.current ? 7.35 : 7.05;
      const narrowBoost = aspect < 1.42 ? (1.42 - aspect) * 3.15 : 0;
      const dist = baseDist + narrowBoost;

      const pitch = stageRuntimeRef.current?.currentPitch ?? DEFAULT_HERO_PITCH;
      const targetY = compactRef.current ? 0.64 : 0.62;
      const eyeY = targetY + 0.34 + Math.sin(pitch) * dist * 0.48;
      const eyeZ = Math.cos(pitch * 0.6) * dist;

      camera.position.set(0, eyeY, eyeZ);
      camera.lookAt(0, targetY, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    syncCameraFraming();

    let disposed = false;
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTimeMs = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((nowMs) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastTimeMs) / 1000));
        lastTimeMs = nowMs;

        const rt = stageRuntimeRef.current;
        let needsMoreFrames = false;
        if (rt) {
          const yawDiff = rt.targetYaw - rt.currentYaw;
          const pitchDiff = rt.targetPitch - rt.currentPitch;
          if (Math.abs(yawDiff) > 0.0008 || Math.abs(pitchDiff) > 0.0008) {
            rt.currentYaw = THREE.MathUtils.damp(rt.currentYaw, rt.targetYaw, 11, dt);
            rt.currentPitch = THREE.MathUtils.damp(rt.currentPitch, rt.targetPitch, 10, dt);
            rt.turntable.rotation.y = rt.currentYaw;
            rt.bayFloorGroup.rotation.y = rt.currentYaw * 0.25;
            syncCameraFraming();
            needsMoreFrames = true;
          } else {
            rt.currentYaw = rt.targetYaw;
            rt.currentPitch = rt.targetPitch;
            rt.turntable.rotation.y = rt.currentYaw;
          }
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    stageRuntimeRef.current = {
      turntable,
      bayFloorGroup,
      envMap,
      currentYaw: DEFAULT_HERO_YAW,
      targetYaw: DEFAULT_HERO_YAW,
      currentPitch: DEFAULT_HERO_PITCH,
      targetPitch: DEFAULT_HERO_PITCH,
      rollMeters: 0,
      wheelRig: null,
      requestRender,
      syncCameraFraming,
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncCameraFraming();
            requestRender();
          })
        : null;
    resizeObserver?.observe(mount);

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver?.disconnect();
      stageRuntimeRef.current = null;
      contactShadowTex.dispose();
      contactShadowMat.dispose();
      contactShadowMesh.geometry.dispose();
      bayTextures.colorMap.dispose();
      bayTextures.roughnessMap.dispose();
      bayTextures.alphaMap.dispose();
      bayPadMat.dispose();
      bayPadGeo.dispose();
      shadowFloor.geometry.dispose();
      (shadowFloor.material as THREE.Material).dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Carga reactiva del modelo `.glb` cuando cambia el vehículo seleccionado
  useEffect(() => {
    let cancelled = false;
    setCutoutStopIndex(0);
    setIsRotated(false);
    setGlbStatus('loading');
    setWheelSplitDetected(false);

    const fallbackImg = new Image();
    fallbackImg.src = vehicle.imageUrl || getOfficialVehicleImageUrl(vehicle.id);

    const rt = stageRuntimeRef.current;
    if (rt) {
      rt.currentYaw = DEFAULT_HERO_YAW;
      rt.targetYaw = DEFAULT_HERO_YAW;
      rt.currentPitch = DEFAULT_HERO_PITCH;
      rt.targetPitch = DEFAULT_HERO_PITCH;
      rt.rollMeters = 0;
      rt.turntable.rotation.y = DEFAULT_HERO_YAW;
      rt.bayFloorGroup.rotation.y = DEFAULT_HERO_YAW * 0.25;
      rt.wheelRig = null;
      while (rt.turntable.children.length > 1) {
        const prevChild = rt.turntable.children[rt.turntable.children.length - 1];
        rt.turntable.remove(prevChild);
      }
      rt.syncCameraFraming();
      rt.requestRender();
    }

    resolveDedicatedVehicleGLTF(vehicle.id)
      .then((resolved) => {
        if (cancelled) return;
        const activeRt = stageRuntimeRef.current;
        if (!resolved || !activeRt) {
          setGlbStatus('pending');
          return;
        }

        while (activeRt.turntable.children.length > 1) {
          activeRt.turntable.remove(activeRt.turntable.children[activeRt.turntable.children.length - 1]);
        }

        const instance = createCalibratedVehicle3DInstance(
          resolved.config,
          resolved.gltf,
          activeRt.envMap,
        );
        const calibratedModel = instance.children[0] as THREE.Group | undefined;
        let rig: VehicleWheelRig | null = null;
        if (calibratedModel) {
          rig = createVehicleWheelRig(calibratedModel, calibratedModel.scale.x);
          rig?.setSteeringRadians(0.21, 1);
          rig?.setDistanceMeters(0);
        }

        activeRt.wheelRig = rig;
        activeRt.turntable.add(instance);
        setWheelSplitDetected(Boolean(rig && rig.wheelCount >= 4));
        setGlbStatus('ready');
        activeRt.syncCameraFraming();
        activeRt.requestRender();
      })
      .catch(() => {
        if (!cancelled) {
          setGlbStatus('pending');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [vehicle.id, reloadNonce]);

  const resetAngle = useCallback(() => {
    setCutoutStopIndex(0);
    setIsRotated(false);
    const rt = stageRuntimeRef.current;
    if (rt) {
      rt.targetYaw = DEFAULT_HERO_YAW;
      rt.targetPitch = DEFAULT_HERO_PITCH;
      rt.rollMeters = 0;
      rt.wheelRig?.setSteeringRadians(0.21, 1);
      rt.wheelRig?.setDistanceMeters(0);
      rt.requestRender();
    }
  }, []);

  const retryGlbCheck = useCallback(() => {
    clearGlbAvailabilityCache();
    setReloadNonce((n) => n + 1);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      accumulatedDx: 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.lastX;
    const dy = e.clientY - st.lastY;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.accumulatedDx += dx;

    if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) > 6) {
      setIsRotated(true);
    }

    const rt = stageRuntimeRef.current;
    if (glbStatus === 'ready' && rt) {
      rt.targetYaw += dx * 0.011;
      rt.targetPitch = THREE.MathUtils.clamp(rt.targetPitch + dy * 0.0022, -0.015, 0.22);
      rt.rollMeters += dx * 0.008;
      rt.wheelRig?.setDistanceMeters(rt.rollMeters);
      rt.wheelRig?.setSteeringRadians(THREE.MathUtils.clamp(dx * 0.025, -0.32, 0.32), 0.12);
      rt.requestRender();
      return;
    }

    if (Math.abs(st.accumulatedDx) >= 36) {
      const steps = Math.trunc(st.accumulatedDx / 36);
      st.accumulatedDx -= steps * 36;
      setCutoutStopIndex(
        (prev) => (prev - steps + CUTOUT_ORBIT_STOPS.length * 8) % CUTOUT_ORBIT_STOPS.length,
      );
    }
  };

  const endPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    st.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const activeCutout = useMemo(
    () => CUTOUT_ORBIT_STOPS[cutoutStopIndex] || CUTOUT_ORBIT_STOPS[0],
    [cutoutStopIndex],
  );

  const expectedGlbFile = useMemo(() => {
    const cfg = getVehicle3DConfig(vehicle.id);
    const primary = cfg?.candidateUrls?.[0] || cfg?.glbUrl || `/models/${vehicle.id}.glb`;
    return primary.replace(/^\/models\//, '');
  }, [vehicle.id]);

  return (
    <div
      className="relative w-full h-full flex items-center justify-center select-none cursor-grab active:cursor-grabbing touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onDoubleClick={resetAngle}
      role="region"
      aria-label={`Escenario 3D de ${vehicle.brand} ${vehicle.name}. Arrastrá para girar en perspectiva 360 grados.`}
    >
      {/* Reflejos atmosféricos sobre el asfalto mojado */}
      <div
        className="dc-arena-floor-glow pointer-events-none absolute bottom-[4%] left-[10%] right-[10%] h-[24%] rounded-full opacity-90"
        aria-hidden="true"
      />

      {/* Contenedor WebGL dedicado para el modelo 3D `.glb` + plataforma 3D de bahía */}
      <div
        ref={canvasMountRef}
        className={`absolute inset-0 z-10 pointer-events-none transition-opacity duration-200 ${
          glbStatus === 'ready' ? 'opacity-100' : 'opacity-45'
        }`}
      />

      {/* Respaldo limpio mientras se aguarda que el archivo `.glb` específico esté en `public/models/` */}
      {glbStatus !== 'ready' && (
        <div className="relative w-full h-full flex items-end justify-center pb-[5.5%] sm:pb-[4.5%] px-4 sm:px-8 pointer-events-none z-15">
          <div
            className="dc-arena-contact-shadow absolute bottom-[4.5%] w-[76%] max-w-[640px] h-[14%] rounded-full"
            aria-hidden="true"
          />
          <img
            key={vehicle.id}
            src={vehicle.imageUrl || getOfficialVehicleImageUrl(vehicle.id)}
            alt={`${vehicle.brand} ${vehicle.name}`}
            referrerPolicy="no-referrer"
            draggable={false}
            className={`dc-arena-cutout-img relative z-10 w-auto object-contain transition-transform duration-150 ${
              compact
                ? 'max-h-[34dvh] sm:max-h-[42dvh] md:max-h-[48dvh] max-w-[88%]'
                : 'max-h-[34dvh] sm:max-h-[44dvh] lg:max-h-[52dvh] max-w-[90%]'
            } ${activeCutout.flipX ? '-scale-x-100' : ''}`}
          />
        </div>
      )}

      {/* Indicador de estado 3D GLB y controles discretos */}
      <div className="absolute top-2 right-2 sm:right-6 z-20 flex flex-wrap items-center justify-end gap-1.5">
        {glbStatus === 'ready' ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#06141d]/90 border border-[#00E5F5]/45 text-[10px] font-bold uppercase tracking-wider text-[#00E5F5] whitespace-nowrap">
            <Box size={11} />
            <span>3D GLB{wheelSplitDetected ? ' · Ruedas Split' : ''}</span>
          </span>
        ) : glbStatus === 'pending' ? (
          <button
            type="button"
            onClick={retryGlbCheck}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#06141d]/90 border border-amber-400/45 text-[10px] font-bold uppercase tracking-wider text-amber-300 hover:border-amber-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            title={`Listo para activar en cuanto subas public/models/${expectedGlbFile}. Clic para volver a comprobar.`}
          >
            <RefreshCw size={11} />
            <span className="hidden sm:inline">Esperando {expectedGlbFile}</span>
            <span className="sm:hidden">GLB pendiente</span>
          </button>
        ) : null}

        {isRotated && (
          <button
            type="button"
            onClick={resetAngle}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#061219]/90 border border-[#00E5F5]/45 text-[10px] font-bold uppercase tracking-wider text-[#00E5F5] hover:border-[#00E5F5] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Restablecer ángulo protagonista"
          >
            <RotateCcw size={12} />
            <span>Vista 3/4</span>
          </button>
        )}

        {onOpen360Modal && (
          <button
            type="button"
            onClick={() => onOpen360Modal(vehicle.id)}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#061219]/85 border border-slate-500/40 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:border-[#00E5F5]/60 hover:text-[#00E5F5] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>Visor 360°</span>
          </button>
        )}
      </div>
    </div>
  );
};
