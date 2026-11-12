import * as THREE from 'three';
import type { CurvedRoadPath } from './curvedRoadPath.ts';
import {
  DOUBLE_YELLOW_X,
  getTrafficLightState,
  type OncomingTrafficCar,
  type SpeedLimitZone,
  type TrafficLightNode,
} from './urbanTrafficRules.ts';

/**
 * Visualización 3D de tránsito urbano para DATACAR ARENA:
 * - Doble línea amarilla divisoria de doble mano (X = +1.65)
 * - Pórticos de semáforos 3D con luces Roja / Amarilla / Verde dinámicas y línea PARE
 * - Carteles viales reglamentarios de Velocidad MÁXIMA (borde rojo) y MÍNIMA (disco azul)
 * - Arcos intermedios de VUELTA (cuando laps > 1)
 * - Autos 3D en sentido contrario con ópticas delanteras y luces de freno
 * - Sistema de salpicadura 3D (Water Splash) sin asignaciones por frame (0 GC)
 */

export interface UrbanTrafficVisualsController {
  group: THREE.Group;
  splashGroup: THREE.Group;
  update: (
    timeSec: number,
    dt: number,
    oncomingCars: readonly OncomingTrafficCar[],
  ) => void;
  triggerSplash: (worldX: number, worldZ: number, intensity: number) => void;
  dispose: () => void;
}

interface SplashDrop {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
}

function createSpeedSignTexture(
  valueKmh: number,
  kind: 'max' | 'min',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);
    // Placa base rectangular redondeada oscura para contraste nocturno/diurno
    ctx.fillStyle = '#0b1320';
    ctx.beginPath();
    ctx.roundRect(10, 10, 236, 236, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 5;
    ctx.stroke();

    if (kind === 'max') {
      // Señal reglamentaria MÁXIMA: fondo blanco y aro rojo intenso
      ctx.beginPath();
      ctx.arc(128, 120, 88, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      ctx.lineWidth = 22;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.font = '900 84px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(valueKmh), 128, 118);

      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 24px Arial, sans-serif';
      ctx.fillText('MÁX km/h', 128, 228);
    } else {
      // Señal reglamentaria MÍNIMA: disco azul reglamentario con borde blanco
      ctx.beginPath();
      ctx.arc(128, 120, 88, 0, Math.PI * 2);
      ctx.fillStyle = '#0284c7';
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#f8fafc';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 80px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(valueKmh), 128, 118);

      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 24px Arial, sans-serif';
      ctx.fillText('MÍN km/h', 128, 228);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function createLapBannerTexture(lapNumber: number, totalLaps: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#061322';
    ctx.fillRect(0, 0, 1024, 192);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(0, 0, 1024, 14);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(0, 178, 1024, 14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 72px Arial, sans-serif';
    ctx.fillText(`VUELTA ${lapNumber} / ${totalLaps} · DATACAR ARENA`, 512, 98);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createUrbanTrafficVisuals3D(args: {
  roadPath: CurvedRoadPath;
  roadWidth: number;
  trackDistanceMeters: number;
  laps: number;
  lights: readonly TrafficLightNode[];
  speedZones: readonly SpeedLimitZone[];
  oncomingCount: number;
}): UrbanTrafficVisualsController {
  const { roadPath, roadWidth, trackDistanceMeters, laps, lights, speedZones, oncomingCount } = args;
  const group = new THREE.Group();
  group.name = 'urban_traffic_rules_3d';
  const splashGroup = new THREE.Group();
  splashGroup.name = 'wet_pothole_splashes_3d';

  const disposableGeos: THREE.BufferGeometry[] = [];
  const disposableMats: THREE.Material[] = [];
  const disposableTexs: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposableGeos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposableMats.push(m);
    return m;
  };

  // 1. DOBLE LÍNEA AMARILLA CENTRAL (separa carriles de avance derechos de contramano izquierda)
  const segLen = 5.5;
  const segCount = Math.max(1, Math.floor((trackDistanceMeters - 10) / segLen));
  const yellowLineGeo = trackGeo(new THREE.PlaneGeometry(0.11, segLen * 0.96));
  const yellowLineMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#facc15',
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  const doubleYellowInst = new THREE.InstancedMesh(yellowLineGeo, yellowLineMat, segCount * 2);
  doubleYellowInst.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let yellowIdx = 0;
  for (let i = 0; i < segCount; i++) {
    const s = 6 + i * segLen + segLen * 0.5;
    for (const offset of [-0.13, 0.13]) {
      const wp = roadPath.world(s, DOUBLE_YELLOW_X + offset);
      dummy.position.set(wp.x, 0.032, wp.z);
      dummy.rotation.set(-Math.PI / 2, 0, -wp.yaw);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      doubleYellowInst.setMatrixAt(yellowIdx++, dummy.matrix);
    }
  }
  doubleYellowInst.count = yellowIdx;
  doubleYellowInst.instanceMatrix.needsUpdate = true;
  group.add(doubleYellowInst);

  // 2. SEMÁFOROS 3D EN INTERSECCIONES + LÍNEA DE DETENCIÓN BLANCA
  const poleMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.45, metalness: 0.72 }),
  );
  const housingMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#090d16', roughness: 0.55, metalness: 0.35 }),
  );
  const stopLineMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#f8fafc', side: THREE.DoubleSide }),
  );
  const stopLineGeo = trackGeo(new THREE.PlaneGeometry(7.9, 0.52));
  const postGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 5.5, 10));
  const armGeo = trackGeo(new THREE.BoxGeometry(5.6, 0.16, 0.16));
  const boxGeo = trackGeo(new THREE.BoxGeometry(0.58, 1.56, 0.42));
  const bulbGeo = trackGeo(new THREE.SphereGeometry(0.17, 14, 14));

  const lightMeshes: {
    node: TrafficLightNode;
    redMat: THREE.MeshBasicMaterial;
    yellowMat: THREE.MeshBasicMaterial;
    greenMat: THREE.MeshBasicMaterial;
  }[] = [];

  for (const node of lights) {
    // Poste sobre vereda derecha (-X en avance +Z) con brazo voladizo sobre carriles de avance
    const postWorld = roadPath.world(node.z, -roadWidth * 0.5 - 0.85);
    const gantry = new THREE.Group();
    gantry.position.set(postWorld.x, 0, postWorld.z);
    gantry.rotation.y = postWorld.yaw;

    const post = new THREE.Mesh(postGeo, poleMat);
    post.position.set(0, 2.75, 0);
    gantry.add(post);

    // En local del grupo (rotado con yaw): +X apunta hacia el centro de la calzada (izquierda)
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(2.7, 5.32, 0);
    gantry.add(arm);

    // Dos cabezales de semáforo para máxima visibilidad desde cámara baja y lejana
    const redMat = trackMat(new THREE.MeshBasicMaterial({ color: '#450a0a' }));
    const yellowMat = trackMat(new THREE.MeshBasicMaterial({ color: '#422006' }));
    const greenMat = trackMat(new THREE.MeshBasicMaterial({ color: '#052e16' }));

    for (const headX of [2.3, 4.7]) {
      const box = new THREE.Mesh(boxGeo, housingMat);
      box.position.set(headX, 4.95, 0);
      gantry.add(box);

      // Lentes orientadas hacia -Z (visibles para quien avanza hacia +Z) y hacia +Z (para mano contraria)
      for (const faceZ of [-0.22, 0.22]) {
        const rBulb = new THREE.Mesh(bulbGeo, redMat);
        rBulb.position.set(headX, 5.42, faceZ);
        const yBulb = new THREE.Mesh(bulbGeo, yellowMat);
        yBulb.position.set(headX, 4.95, faceZ);
        const gBulb = new THREE.Mesh(bulbGeo, greenMat);
        gBulb.position.set(headX, 4.48, faceZ);
        gantry.add(rBulb, yBulb, gBulb);
      }
    }
    group.add(gantry);

    // Línea blanca transversal de detención en carriles derechos (x de -6.5 a +1.4, centro -2.55)
    const stopWorld = roadPath.world(node.z - 5.5, -2.55);
    const stopMesh = new THREE.Mesh(stopLineGeo, stopLineMat);
    stopMesh.position.set(stopWorld.x, 0.031, stopWorld.z);
    stopMesh.rotation.set(-Math.PI / 2, 0, -stopWorld.yaw);
    group.add(stopMesh);

    // Línea de detención para mano contraria (x de +1.9 a +6.6, centro +4.25)
    const oncomingStopWorld = roadPath.world(node.z + 5.8, 4.25);
    const oncomingStopGeo = trackGeo(new THREE.PlaneGeometry(4.6, 0.45));
    const oncomingStopMesh = new THREE.Mesh(oncomingStopGeo, stopLineMat);
    oncomingStopMesh.position.set(oncomingStopWorld.x, 0.031, oncomingStopWorld.z);
    oncomingStopMesh.rotation.set(-Math.PI / 2, 0, -oncomingStopWorld.yaw);
    group.add(oncomingStopMesh);

    lightMeshes.push({ node, redMat, yellowMat, greenMat });
  }

  // 3. CARTELES REGLAMENTARIOS DE LÍMITE DE VELOCIDAD (MÁXIMA Y MÍNIMA)
  const signPoleGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.075, 3.5, 8));
  const signPlateGeo = trackGeo(new THREE.PlaneGeometry(1.18, 1.18));
  const signTexCache = new Map<string, THREE.MeshBasicMaterial>();

  const getSpeedSignMat = (val: number, kind: 'max' | 'min') => {
    const key = `${kind}_${val}`;
    let m = signTexCache.get(key);
    if (!m) {
      const tex = createSpeedSignTexture(val, kind);
      disposableTexs.push(tex);
      m = trackMat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
      signTexCache.set(key, m);
    }
    return m;
  };

  for (const zone of speedZones) {
    // Poste en vereda derecha (visible de frente en cámara arcade)
    const signWorld = roadPath.world(zone.signZ, -roadWidth * 0.5 - 1.15);
    const signPostGroup = new THREE.Group();
    signPostGroup.position.set(signWorld.x, 0, signWorld.z);
    signPostGroup.rotation.y = signWorld.yaw;

    const pole = new THREE.Mesh(signPoleGeo, poleMat);
    pole.position.set(0, 1.75, 0);
    signPostGroup.add(pole);

    const maxBoard = new THREE.Mesh(signPlateGeo, getSpeedSignMat(zone.maxKmh, 'max'));
    maxBoard.position.set(0.15, 3.15, -0.06);
    maxBoard.rotation.y = Math.PI; // Mira hacia el conductor que viene desde -Z hacia +Z
    signPostGroup.add(maxBoard);

    const minBoard = new THREE.Mesh(signPlateGeo, getSpeedSignMat(zone.minKmh, 'min'));
    minBoard.position.set(0.15, 1.92, -0.06);
    minBoard.rotation.y = Math.PI;
    signPostGroup.add(minBoard);

    group.add(signPostGroup);
  }

  // 4. ARCOS INTERMEDIOS DE VUELTA (cuando el jugador elige 2 o 3 vueltas)
  if (laps > 1) {
    const lapLength = trackDistanceMeters / laps;
    const archColumnGeo = trackGeo(new THREE.BoxGeometry(0.48, 6.6, 0.48));
    const archBeamGeo = trackGeo(new THREE.BoxGeometry(roadWidth + 2.8, 1.15, 0.62));
    const archBannerGeo = trackGeo(new THREE.PlaneGeometry(roadWidth * 0.76, 1.0));

    for (let lapIdx = 1; lapIdx < laps; lapIdx++) {
      const lapZ = lapLength * lapIdx;
      const centerWorld = roadPath.world(lapZ, 0);
      const arch = new THREE.Group();
      arch.position.set(centerWorld.x, 0, centerWorld.z);
      arch.rotation.y = centerWorld.yaw;

      const colL = new THREE.Mesh(archColumnGeo, poleMat);
      colL.position.set(-roadWidth * 0.5 - 0.9, 3.3, 0);
      const colR = new THREE.Mesh(archColumnGeo, poleMat);
      colR.position.set(roadWidth * 0.5 + 0.9, 3.3, 0);
      const beam = new THREE.Mesh(archBeamGeo, poleMat);
      beam.position.set(0, 6.45, 0);

      const bannerTex = createLapBannerTexture(lapIdx + 1, laps);
      disposableTexs.push(bannerTex);
      const bannerMat = trackMat(new THREE.MeshBasicMaterial({ map: bannerTex }));
      const banner = new THREE.Mesh(archBannerGeo, bannerMat);
      banner.position.set(0, 6.45, -0.34);
      banner.rotation.y = Math.PI;

      arch.add(colL, colR, beam, banner);
      group.add(arch);
    }
  }

  // 5. VEHÍCULOS 3D EN MANO CONTRARIA (avanzando hacia -Z con faros encendidos)
  const bodyGeo = trackGeo(new THREE.BoxGeometry(1.82, 0.68, 4.32));
  const cabinGeo = trackGeo(new THREE.BoxGeometry(1.56, 0.56, 2.25));
  const wheelGeo = trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12));
  wheelGeo.rotateZ(Math.PI / 2);
  const lampGeo = trackGeo(new THREE.PlaneGeometry(0.34, 0.16));
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(2.1, 4.7));

  const glassMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.18, metalness: 0.65 }),
  );
  const tireMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.85, metalness: 0.1 }),
  );
  const headlampMat = trackMat(new THREE.MeshBasicMaterial({ color: '#fef9c3' }));
  const taillampOnMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ff2a2a' }));
  const taillampDimMat = trackMat(new THREE.MeshBasicMaterial({ color: '#7f1d1d' }));
  const shadowMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#020617', transparent: true, opacity: 0.48, depthWrite: false }),
  );

  const oncomingVisuals: {
    root: THREE.Group;
    wheels: THREE.Mesh[];
    tailLeft: THREE.Mesh;
    tailRight: THREE.Mesh;
    bodyMat: THREE.MeshStandardMaterial;
  }[] = [];

  for (let i = 0; i < oncomingCount; i++) {
    const root = new THREE.Group();
    const bodyMat = trackMat(
      new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.32, metalness: 0.45 }),
    );
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.58;
    root.add(body);

    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(0, 1.14, -0.15);
    root.add(cabin);

    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    root.add(shadow);

    // En el sistema local del auto (frente hacia +Z local, luego rotado yaw + PI hacia -Z mundial):
    const hlL = new THREE.Mesh(lampGeo, headlampMat);
    hlL.position.set(-0.62, 0.64, 2.17);
    const hlR = new THREE.Mesh(lampGeo, headlampMat);
    hlR.position.set(0.62, 0.64, 2.17);
    root.add(hlL, hlR);

    const tailLeft = new THREE.Mesh(lampGeo, taillampDimMat);
    tailLeft.position.set(-0.62, 0.68, -2.17);
    tailLeft.rotation.y = Math.PI;
    const tailRight = new THREE.Mesh(lampGeo, taillampDimMat);
    tailRight.position.set(0.62, 0.68, -2.17);
    tailRight.rotation.y = Math.PI;
    root.add(tailLeft, tailRight);

    const wheels: THREE.Mesh[] = [];
    for (const [wx, wz] of [
      [-0.86, 1.32],
      [0.86, 1.32],
      [-0.86, -1.32],
      [0.86, -1.32],
    ]) {
      const w = new THREE.Mesh(wheelGeo, tireMat);
      w.position.set(wx, 0.34, wz);
      root.add(w);
      wheels.push(w);
    }

    root.visible = false;
    group.add(root);
    oncomingVisuals.push({ root, wheels, tailLeft, tailRight, bodyMat });
  }

  // 6. SISTEMA DE SALPICADURA 3D (WATER SPLASH) CON POOL FIJO (0 GC EN RENDER LOOP)
  const MAX_DROPS = 140;
  const dropGeo = trackGeo(new THREE.PlaneGeometry(0.32, 0.46));
  const dropCanvas = document.createElement('canvas');
  dropCanvas.width = 64;
  dropCanvas.height = 64;
  const dCtx = dropCanvas.getContext('2d');
  if (dCtx) {
    const g = dCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(224, 242, 254, 0.92)');
    g.addColorStop(0.55, 'rgba(125, 211, 252, 0.55)');
    g.addColorStop(1, 'rgba(56, 189, 248, 0)');
    dCtx.fillStyle = g;
    dCtx.fillRect(0, 0, 64, 64);
  }
  const dropTex = new THREE.CanvasTexture(dropCanvas);
  dropTex.colorSpace = THREE.SRGBColorSpace;
  disposableTexs.push(dropTex);

  const dropMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: dropTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const splashInst = new THREE.InstancedMesh(dropGeo, dropMat, MAX_DROPS);
  splashInst.frustumCulled = false;
  splashInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashGroup.add(splashInst);

  const drops: SplashDrop[] = Array.from({ length: MAX_DROPS }, () => ({
    active: false,
    age: 0,
    life: 0.6,
    x: 0,
    y: -10,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    scale: 1,
  }));
  let dropCursor = 0;
  const _dropMat4 = new THREE.Matrix4();
  const _dropPos = new THREE.Vector3();
  const _dropQuat = new THREE.Quaternion();
  const _dropScale = new THREE.Vector3();
  const _dropEuler = new THREE.Euler();

  // Inicializar ocultos
  _dropScale.set(0, 0, 0);
  for (let i = 0; i < MAX_DROPS; i++) {
    _dropMat4.compose(_dropPos, _dropQuat, _dropScale);
    splashInst.setMatrixAt(i, _dropMat4);
  }
  splashInst.instanceMatrix.needsUpdate = true;

  const triggerSplash = (worldX: number, worldZ: number, intensity: number) => {
    const strength = Math.max(0.35, Math.min(1.25, intensity));
    const spawnCount = Math.round(22 + strength * 20);
    for (let i = 0; i < spawnCount; i++) {
      const slot = drops[dropCursor % MAX_DROPS];
      dropCursor++;
      const side = i % 2 === 0 ? -1 : 1;
      const spreadAngle = (Math.random() - 0.5) * 1.1;
      slot.active = true;
      slot.age = 0;
      slot.life = 0.42 + Math.random() * 0.34;
      slot.x = worldX + side * (0.72 + Math.random() * 0.38);
      slot.y = 0.18 + Math.random() * 0.22;
      slot.z = worldZ + (Math.random() - 0.5) * 2.1;
      slot.vx = side * (2.2 + Math.random() * 3.4) * strength + Math.sin(spreadAngle);
      slot.vy = (3.4 + Math.random() * 3.8) * strength;
      slot.vz = (Math.random() - 0.35) * 2.8;
      slot.scale = (0.75 + Math.random() * 0.85) * strength;
    }
  };

  const update = (
    timeSec: number,
    dt: number,
    oncomingCars: readonly OncomingTrafficCar[],
  ) => {
    // Actualizar colores emisivos de semáforos
    for (const lm of lightMeshes) {
      const st = getTrafficLightState(lm.node, timeSec);
      lm.redMat.color.setHex(st.phase === 'red' ? 0xff2b2b : 0x3b0a0a);
      lm.yellowMat.color.setHex(st.phase === 'yellow' ? 0xfbbf24 : 0x3b2506);
      lm.greenMat.color.setHex(st.phase === 'green' ? 0x22c55e : 0x063218);
    }

    // Actualizar autos de mano contraria
    for (let i = 0; i < oncomingVisuals.length; i++) {
      const vis = oncomingVisuals[i];
      const car = oncomingCars[i];
      if (!car || car.z < -30 || car.z > trackDistanceMeters + 140) {
        vis.root.visible = false;
        continue;
      }
      vis.root.visible = true;
      vis.bodyMat.color.set(car.color);
      const wp = roadPath.world(car.z, car.x);
      vis.root.position.set(wp.x, 0, wp.z);
      vis.root.rotation.y = wp.yaw + Math.PI; // Mira hacia -Z sobre la tangente de la ruta
      for (const w of vis.wheels) {
        w.rotation.x = car.wheelAngle;
      }
      const brakeMat = car.braking ? taillampOnMat : taillampDimMat;
      vis.tailLeft.material = brakeMat;
      vis.tailRight.material = brakeMat;
    }

    // Actualizar partículas de agua (salpicadura en bache mojado)
    let anyDropChanged = false;
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = drops[i];
      if (!d.active) continue;
      anyDropChanged = true;
      d.age += dt;
      if (d.age >= d.life || d.y < -0.05) {
        d.active = false;
        _dropPos.set(0, -20, 0);
        _dropScale.set(0, 0, 0);
        _dropMat4.compose(_dropPos, _dropQuat, _dropScale);
        splashInst.setMatrixAt(i, _dropMat4);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= 11.8 * dt; // gravedad realista del spray de agua
      const lifeRatio = d.age / d.life;
      const s = d.scale * (1 + lifeRatio * 0.85) * (1 - lifeRatio * 0.55);
      _dropPos.set(d.x, d.y, d.z);
      _dropEuler.set(0, (i % 5) * 0.62, 0);
      _dropQuat.setFromEuler(_dropEuler);
      _dropScale.set(s, s, s);
      _dropMat4.compose(_dropPos, _dropQuat, _dropScale);
      splashInst.setMatrixAt(i, _dropMat4);
    }
    if (anyDropChanged) {
      splashInst.instanceMatrix.needsUpdate = true;
    }
  };

  const dispose = () => {
    disposableGeos.forEach(g => g.dispose());
    disposableMats.forEach(m => m.dispose());
    disposableTexs.forEach(t => t.dispose());
  };

  return {
    group,
    splashGroup,
    update,
    triggerSplash,
    dispose,
  };
}
