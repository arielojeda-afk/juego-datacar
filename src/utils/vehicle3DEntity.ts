import * as THREE from 'three';
import { Vehicle } from '../types/vehicle';
import { 
  hasVehicle3DModel, 
  getVehicle3DConfig, 
  loadVehicleGLTF, 
  createCalibratedVehicle3DInstance,
  Vehicle3DConfig,
  RESCUE_FALLBACK_GLB_URL,
} from './vehicle3DModelLoader';
import { createContactShadowTexture } from './race3dTextures';
import { createVehicleWheelRig, VehicleWheelRig } from './vehicleWheelRig';
import { VehicleSteeringDynamics } from './vehicleSteeringDynamics';
import { screenRightSteeringToWorldYaw } from './cinematicDirector';

export interface InteractiveVehiclePose {
  x: number;
  z: number;
  yaw: number;
  slip: number;
  bump: number;
  suspension?: { heaveM: number; pitchRad: number; rollRad: number; wheelRoadM: { FL: number; FR: number; RL: number; RR: number }; impact: number };
}

export interface VehicleEntityRunner {
  group: THREE.Group; // VehicleRoot (posición y orientación física oficial)
  vehicle: Vehicle;
  laneX: number;
  is3DModel: boolean;
  updateState: (
    distanceMeters: number,
    speedKmh: number,
    accelG: number,
    isBraking: boolean,
    cameraPos: THREE.Vector3,
    outOfFuel: boolean,
    steeringAngleRadians?: number,
    frameDeltaSeconds?: number,
    dynamicPose?: InteractiveVehiclePose,
  ) => void;
  setHeadlights: (enabled: boolean, illuminateTrack: boolean) => void;
  setNameplateVisible: (visible: boolean) => void;
  // Metros recorridos solo en la toma de llegada; no altera la física.
  advanceFinishWheelRotation?: (additionalMeters: number) => void;
  dispose: () => void;
}

/**
 * Genera una textura nítida tipo placa / pill flotante para identificar inequívocamente al vehículo
 */
function createNameplateTexture(name: string, colorHex: string, isProvisional: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, 640, 128);

  // Contenedor semitransparente con borde del color del vehículo
  ctx.fillStyle = 'rgba(10, 15, 29, 0.88)';
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 4;
  
  const x = 16, y = 16, w = 608, h = 96, r = 48;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();

  // Punto luminoso del color
  ctx.fillStyle = colorHex;
  ctx.beginPath();
  ctx.arc(60, 64, 16, 0, Math.PI * 2);
  ctx.fill();

  // Nombre del vehículo con ajuste dinámico para que quepa completo
  const text = name.toUpperCase();
  let fontSize = 32;
  ctx.font = `bold ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
  const maxAllowedWidth = isProvisional ? 390 : 490;
  while (ctx.measureText(text).width > maxAllowedWidth && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`;
  }

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 90, 64);

  // Badge discreto si es 3D provisional
  if (isProvisional) {
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillStyle = colorHex;
    ctx.fillText('3D TEMP', 500, 64);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Genera textura radial suave para el halo underglow en el asfalto
 */
function createUnderglowTexture(colorHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
  grad.addColorStop(0, colorHex);
  grad.addColorStop(0.5, colorHex);
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/** Halo de LED pequeño y difuso: NO genera rectángulos blancos flotantes. */
function createHeadlightGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(235,246,255,.88)');
    gradient.addColorStop(0.16, 'rgba(195,224,255,.48)');
    gradient.addColorStop(0.56, 'rgba(130,175,235,.10)');
    gradient.addColorStop(1, 'rgba(90,150,220,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Mancha ovalada de iluminación tenue; sigue al vehículo sin sombras extra. */
function createSoftRoadBeamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.translate(64, 128);
    ctx.scale(0.90, 1.96);
    const gradient = ctx.createRadialGradient(0, 0, 1, 0, 0, 62);
    gradient.addColorStop(0, 'rgba(210,229,255,.34)');
    gradient.addColorStop(0.30, 'rgba(200,222,255,.20)');
    gradient.addColorStop(0.72, 'rgba(180,205,240,.045)');
    gradient.addColorStop(1, 'rgba(170,195,240,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Entidad 3D con arquitectura desacoplada de transformaciones:
 * - group (VehicleRoot): Control de posición física oficial (X carril, Z avance en pista)
 * - effectsGroup (VehicleEffects): Cabeceo dinámico de suspensión (dive/squat) y luces
 * - visualGroup (VehicleVisual): Malla 3D GLB calibrada con librea y materiales únicos
 */
export class Vehicle3DGLBEntity implements VehicleEntityRunner {
  public group: THREE.Group; // VehicleRoot
  public vehicle: Vehicle;
  public laneX: number;
  public is3DModel: boolean = true;

  private effectsGroup: THREE.Group; // VehicleEffects
  private modelInstance: THREE.Group | null = null;
  private wheelRig: VehicleWheelRig | null = null;
  private lastDistanceMeters = 0;
  private currentSteeringAngle = 0;
  private shadowMesh: THREE.Mesh;
  private underglowMesh: THREE.Mesh;
  private nameplateSprite: THREE.Sprite;
  private brakeLight: THREE.PointLight;
  private config: Vehicle3DConfig;
  private steeringDynamics = new VehicleSteeringDynamics();
  private headlightGroup = new THREE.Group();
  private headlightBeam: THREE.SpotLight;
  private headlightLensMaterial: THREE.MeshStandardMaterial;
  private headlightGlowTexture: THREE.CanvasTexture;
  private headlightGlowMaterial: THREE.SpriteMaterial;
  private headlightRoadPool: THREE.Mesh;
  private headlightRoadTexture: THREE.CanvasTexture;
  private isLoaded: boolean = false;
  private envMap?: THREE.Texture | null;

  constructor(
    vehicle: Vehicle, 
    laneIndex: number, 
    totalLanes: number, 
    config: Vehicle3DConfig,
    onLoaded?: () => void,
    onError?: (err: unknown) => void,
    envMap?: THREE.Texture | null
  ) {
    this.vehicle = vehicle;
    this.config = config;
    this.envMap = envMap;

    // 1. VehicleRoot: controla las coordenadas físicas mundiales
    this.group = new THREE.Group();
    this.group.name = `vehicle_root_${vehicle.id}`;

    // Calcular posición X del carril
    const laneWidth = 3.6;
    const centerOffset = ((totalLanes - 1) * laneWidth) / 2;
    this.laneX = laneIndex * laneWidth - centerOffset;
    this.group.position.x = this.laneX;
    this.group.position.y = 0;
    this.group.position.z = 0;

    // 2. VehicleEffects: aloja las inclinaciones visuales sin perturbar el Root
    this.effectsGroup = new THREE.Group();
    this.effectsGroup.name = `vehicle_effects_${vehicle.id}`;
    this.group.add(this.effectsGroup);

    // 3. Sombra de contacto de 4 ruedas en el pavimento
    const shadowGeo = new THREE.PlaneGeometry(2.2, 4.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    });
    this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.set(0, 0.015, 0);
    this.group.add(this.shadowMesh);

    // 4. Halo luminoso underglow en el asfalto (color de identificación del auto)
    const underglowGeo = new THREE.PlaneGeometry(2.6, 5.0);
    const underglowMat = new THREE.MeshBasicMaterial({
      map: createUnderglowTexture(config.brandColor),
      transparent: true,
      depthWrite: false,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    this.underglowMesh = new THREE.Mesh(underglowGeo, underglowMat);
    this.underglowMesh.rotation.x = -Math.PI / 2;
    this.underglowMesh.position.set(0, 0.018, 0);
    this.underglowMesh.visible = false; // Evitar halo artificial sobre el asfalto.
    this.group.add(this.underglowMesh);

    // 5. Etiqueta flotante 3D (Billboard nameplate sobre el techo)
    const nameplateTex = createNameplateTexture(config.identificationName, config.brandColor, config.isProvisional3D);
    const nameplateMat = new THREE.SpriteMaterial({
      map: nameplateTex,
      transparent: true,
      depthTest: true,
    });
    this.nameplateSprite = new THREE.Sprite(nameplateMat);
    this.nameplateSprite.scale.set(2.8, 0.56, 1);
    this.nameplateSprite.position.set(0, 2.25, 0);
    this.group.add(this.nameplateSprite);

    // 6. Luz de freno roja en las ópticas traseras
    this.brakeLight = new THREE.PointLight('#ef4444', 0, 8);
    this.brakeLight.position.set(0, 0.95, -2.15);
    this.effectsGroup.add(this.brakeLight);

    // 6b. Si es modelo 3D provisional, cubrir el logo de Chevrolet en el maletero con una placa estética de la marca
    if (config.isProvisional3D && config.modelId !== 'chevrolet-tracker-lite') {
      const badgeCanvas = document.createElement('canvas');
      badgeCanvas.width = 256;
      badgeCanvas.height = 64;
      const bctx = badgeCanvas.getContext('2d');
      if (bctx) {
        bctx.fillStyle = '#0a0f1d';
        bctx.fillRect(0, 0, 256, 64);
        bctx.strokeStyle = config.brandColor;
        bctx.lineWidth = 6;
        bctx.strokeRect(3, 3, 250, 58);
        bctx.fillStyle = '#ffffff';
        bctx.font = 'bold 28px sans-serif';
        bctx.textAlign = 'center';
        bctx.textBaseline = 'middle';
        bctx.fillText(vehicle.brand.toUpperCase(), 128, 34);
      }
      const badgeTex = new THREE.CanvasTexture(badgeCanvas);
      const badgeGeo = new THREE.PlaneGeometry(0.32, 0.09);
      const badgeMat = new THREE.MeshBasicMaterial({ map: badgeTex, side: THREE.DoubleSide });
      const badgeMesh = new THREE.Mesh(badgeGeo, badgeMat);
      badgeMesh.position.set(0, 0.88, -2.16);
      badgeMesh.rotation.y = Math.PI;
      this.effectsGroup.add(badgeMesh);
    }

    // 7. Faros con intensidad controlada: la V5.8 dibujaba cajas blancas
    // y un SpotLight de intensidad 120 que dejaba manchas quemadas en la pista.
    // Ahora el brillo está integrado en pequeñas ópticas, con penumbra suave.
    this.headlightGroup.name = `faros_${vehicle.id}`;
    this.headlightLensMaterial = new THREE.MeshStandardMaterial({
      color: '#d5e8ff',
      emissive: '#a8cfff',
      emissiveIntensity: 1.35,
      roughness: 0.38,
      metalness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.headlightGlowTexture = createHeadlightGlowTexture();
    this.headlightGlowMaterial = new THREE.SpriteMaterial({
      map: this.headlightGlowTexture,
      color: '#cbdfff',
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      opacity: 0.39,
    });
    for (const x of [-0.75, 0.75]) {
      // Fina firma LED; sin cajas volumétricas ni halos gigantes.
      const lens = new THREE.Mesh(
        new THREE.PlaneGeometry(0.30, 0.055),
        this.headlightLensMaterial,
      );
      lens.name = `optica_delantera_${x < 0 ? 'izquierda' : 'derecha'}`;
      lens.position.set(x, 1.11, 2.133);
      this.headlightGroup.add(lens);
      const halo = new THREE.Sprite(this.headlightGlowMaterial);
      halo.position.set(x, 1.11, 2.165);
      halo.scale.set(0.34, 0.16, 1);
      this.headlightGroup.add(halo);
    }
    // Luz físicamente proyectada solo en el auto seleccionado para evitar
    // el coste de tres spotlights sobre millones de polígonos.
    this.headlightBeam = new THREE.SpotLight('#d9e8ff', 15, 28, 0.42, 0.97, 2);
    this.headlightBeam.name = `haz_faroles_${vehicle.id}`;
    this.headlightBeam.position.set(0, 1.10, 2.12);
    this.headlightBeam.target.position.set(0, 0.04, 17);
    this.headlightBeam.castShadow = false;
    this.headlightGroup.add(this.headlightBeam, this.headlightBeam.target);
    this.effectsGroup.add(this.headlightGroup);

    // Un degradado de luz de muy baja opacidad sobre el asfalto elimina
    // el borde rígido de los círculos blancos, sin pases de render adicionales.
    this.headlightRoadTexture = createSoftRoadBeamTexture();
    this.headlightRoadPool = new THREE.Mesh(
      new THREE.PlaneGeometry(5.0, 13.0),
      new THREE.MeshBasicMaterial({
        map: this.headlightRoadTexture,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.headlightRoadPool.name = `iluminacion_asfalto_${vehicle.id}`;
    this.headlightRoadPool.rotation.x = -Math.PI / 2;
    this.headlightRoadPool.position.set(0, 0.033, 8.2);
    this.group.add(this.headlightRoadPool);
    this.setHeadlights(true, false);

    // 8. Cargar modelo 3D GLB con sistema de rescate automático (auto-fallback)
    const targetLengthMeters = (vehicle.dimensions?.lengthMm || 4300) / 1000;
    const rescueConfig: Vehicle3DConfig = {
      ...config,
      glbUrl: config.fallbackGlbUrl || RESCUE_FALLBACK_GLB_URL,
      targetLengthMeters,
      scale: targetLengthMeters / 0.12,
      rotationY: Math.PI / 2,
      verticalOffset: 0,
      isProvisional3D: true,
    };

    const attachModel = (gltf: any, activeConfig: Vehicle3DConfig) => {
      this.modelInstance = createCalibratedVehicle3DInstance(activeConfig, gltf, this.envMap);
      const calibratedModel = this.modelInstance.children[0] as THREE.Group;
      this.wheelRig = createVehicleWheelRig(calibratedModel, calibratedModel.scale.x);
      this.wheelRig?.setDistanceMeters(this.lastDistanceMeters);
      this.wheelRig?.setSteeringRadians(this.currentSteeringAngle, 1);
      this.effectsGroup.add(this.modelInstance);
      this.isLoaded = true;
      if (onLoaded) onLoaded();
    };

    const candidateUrls = config.candidateUrls && config.candidateUrls.length > 0
      ? config.candidateUrls
      : [config.glbUrl];

    const tryLoadSequence = async () => {
      for (const url of candidateUrls) {
        try {
          const gltf = await loadVehicleGLTF(url);
          attachModel(gltf, { ...config, glbUrl: url, isProvisional3D: false });
          return;
        } catch {
          // Continuar con el siguiente candidato si el archivo no existe aún en disco
        }
      }

      // Si aún no se subió el modelo 3D dedicado, conmutar al modelo provisional de rescate
      try {
        const rescueGltf = await loadVehicleGLTF(rescueConfig.glbUrl);
        attachModel(rescueGltf, rescueConfig);
      } catch {
        try {
          const secGltf = await loadVehicleGLTF(RESCUE_FALLBACK_GLB_URL);
          attachModel(secGltf, { ...rescueConfig, glbUrl: RESCUE_FALLBACK_GLB_URL });
        } catch {
          const emergencyMesh = createEmergencyChassisMesh(vehicle);
          this.effectsGroup.add(emergencyMesh);
          this.isLoaded = true;
          if (onLoaded) onLoaded();
        }
      }
    };

    tryLoadSequence();
  }

  public updateState(
    distanceMeters: number,
    speedKmh: number,
    accelG: number,
    isBraking: boolean,
    _cameraPos: THREE.Vector3,
    _outOfFuel: boolean,
    steeringAngleRadians = 0,
    frameDeltaSeconds = 1/60,
    dynamicPose?: InteractiveVehiclePose,
  ) {
    this.lastDistanceMeters = distanceMeters;
    // El juego se mira desde -Z hacia +Z: pantalla derecha equivale a -X.
    // Convertir una vez el ángulo de entrada para sincronizar ruedas y carrocería.
    const worldSteerAngle = screenRightSteeringToWorldYaw(steeringAngleRadians);
    this.currentSteeringAngle = worldSteerAngle;
    this.wheelRig?.setDistanceMeters(distanceMeters);
    this.wheelRig?.setSteeringRadians(worldSteerAngle, frameDeltaSeconds);
    if (dynamicPose?.suspension) {
      const s = dynamicPose.suspension;
      this.wheelRig?.setSuspensionContact(s.wheelRoadM, s.heaveM, s.pitchRad, s.rollRad, frameDeltaSeconds);
    } else {
      this.wheelRig?.setSuspensionContact({ FL:0, FR:0, RL:0, RR:0 }, 0, 0, 0, frameDeltaSeconds);
    }
    // 1. El eje Z mantiene la distancia oficial del motor físico. La
    // dirección del volante sí modifica la posición X y orientación del auto.
    // Mantener estas magnitudes desacopladas respeta tiempos y clasificación.
    const steerState = dynamicPose ? null : this.steeringDynamics.update(
      distanceMeters, speedKmh, worldSteerAngle, frameDeltaSeconds,
      this.laneX,
    );
    const drivenYaw = dynamicPose?.yaw ?? steerState?.yaw ?? 0;
    this.group.position.set(dynamicPose?.x ?? steerState?.x ?? this.laneX, 0, dynamicPose?.z ?? distanceMeters);
    this.group.rotation.y = drivenYaw;

    // 2. Dinámica de cabeceo de carrocería en VehicleEffects
    // Aceleración fuerte: la trompa sube suavemente (squat)
    // Frenada brusca: la trompa se clava adelante (dive)
    if (this.effectsGroup) {
      const suspension = dynamicPose?.suspension;
      const pitchTarget = (isBraking ? -0.024 : accelG > 0.15 && speedKmh < 100 ? 0.014 : 0) +
        (suspension?.pitchRad ?? 0);
      this.effectsGroup.rotation.x = THREE.MathUtils.damp(
        this.effectsGroup.rotation.x, pitchTarget, 10, Math.max(0, frameDeltaSeconds),
      );
      // Balanceo sutil en curvas, también independiente de la tasa de cuadros.
      const rollTarget = dynamicPose
        ? THREE.MathUtils.clamp(-this.group.rotation.y * 0.10 + dynamicPose.slip * Math.sign(worldSteerAngle) * 0.075, -0.09, 0.09)
        : THREE.MathUtils.clamp(-(steerState?.yaw ?? 0) * 0.11, -0.018, 0.018);
      const rollWithSuspension = THREE.MathUtils.clamp(rollTarget + (suspension?.rollRad ?? 0), -.14, .14);
      // El movimiento vertical NO se inventa con senos de distancia: se integra
      // en cuatro muelles amortiguados sobre la altura de cada neumático.
      this.effectsGroup.position.y = THREE.MathUtils.damp(
        this.effectsGroup.position.y,
        suspension?.heaveM ?? 0, 22, Math.max(0, frameDeltaSeconds),
      );
      this.effectsGroup.rotation.z = THREE.MathUtils.damp(
        this.effectsGroup.rotation.z, rollWithSuspension, 12, Math.max(0, frameDeltaSeconds),
      );
    }

    // 3. Luces de freno incandescentes al desacelerar
    this.brakeLight.intensity = THREE.MathUtils.damp(
      this.brakeLight.intensity, isBraking ? 3.2 : 0,
      12, Math.max(0, frameDeltaSeconds),
    );
  }

  /** Mantiene el rodamiento visible durante la toma final de 18 km/h. */
  public advanceFinishWheelRotation(additionalMeters: number) {
    if (!Number.isFinite(additionalMeters) || additionalMeters < 0) return;
    // updateState() restablece la distancia física cada frame. Aplicamos el
    // avance cinematográfico después, sin acumularlo dos veces.
    this.wheelRig?.setDistanceMeters(this.lastDistanceMeters + additionalMeters);
  }

  public setNameplateVisible(visible: boolean) {
    this.nameplateSprite.visible = visible;
  }

  public setHeadlights(enabled: boolean, illuminateTrack: boolean) {
    this.headlightGroup.visible = enabled;
    this.headlightBeam.visible = enabled && illuminateTrack;
    this.headlightRoadPool.visible = enabled && illuminateTrack;
  }

  public dispose() {
    this.headlightGroup.traverse(obj => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.headlightLensMaterial.dispose();
    this.headlightGlowMaterial.dispose();
    this.headlightGlowTexture.dispose();
    this.headlightRoadPool.geometry.dispose();
    (this.headlightRoadPool.material as THREE.Material).dispose();
    this.headlightRoadTexture.dispose();
    this.shadowMesh.geometry.dispose();
    (this.shadowMesh.material as THREE.Material).dispose();

    this.underglowMesh.geometry.dispose();
    (this.underglowMesh.material as THREE.Material).dispose();

    this.nameplateSprite.material.map?.dispose();
    this.nameplateSprite.material.dispose();

    if (this.modelInstance) {
      this.effectsGroup.remove(this.modelInstance);
    }
  }
}

/**
 * Fábrica polimórfica que crea una entidad 3D GLB
 */
export function createVehicleEntity(
  vehicle: Vehicle,
  laneIndex: number,
  totalLanes: number,
  onGLBLoaded?: () => void,
  onGLBError?: (err: unknown) => void,
  envMap?: THREE.Texture | null
): VehicleEntityRunner {
  const config = getVehicle3DConfig(vehicle.id);
  const targetLengthMeters = (vehicle.dimensions?.lengthMm || 4300) / 1000;
  if (config) {
    const effectiveConfig: Vehicle3DConfig = {
      ...config,
      brandColor: vehicle.color || config.brandColor,
      targetLengthMeters,
      scale: targetLengthMeters / 0.12,
    };
    return new Vehicle3DGLBEntity(vehicle, laneIndex, totalLanes, effectiveConfig, onGLBLoaded, onGLBError, envMap);
  }

  // Fallback seguro en caso de vehículo no registrado
  const defaultConfig: Vehicle3DConfig = {
    modelId: vehicle.id,
    name: vehicle.name,
    identificationName: vehicle.name,
    brandColor: vehicle.color || '#3b82f6',
    glbUrl: '/models/tracker-rs-wheels.glb',
    targetLengthMeters,
    scale: targetLengthMeters / 0.12,
    rotationY: Math.PI / 2,
    verticalOffset: 0,
    isUnifiedMesh: false,
    isProvisional3D: true,
  };
  return new Vehicle3DGLBEntity(vehicle, laneIndex, totalLanes, defaultConfig, onGLBLoaded, onGLBError, envMap);
}

/**
 * Carrocería procedural de emergencia:
 * Garantiza que incluso ante fallas catastróficas de red o GLB, el auto sea visible
 * en 3D con proporciones exactas y la carrera arranque sin quedarse congelada.
 */
function createEmergencyChassisMesh(vehicle: Vehicle): THREE.Group {
  const group = new THREE.Group();
  group.name = `emergency_chassis_${vehicle.id}`;

  const lengthM = (vehicle.dimensions?.lengthMm || 4300) / 1000;
  const widthM = (vehicle.dimensions?.widthMm || 1800) / 1000;
  const heightM = (vehicle.dimensions?.heightMm || 1600) / 1000;

  const bodyGeo = new THREE.BoxGeometry(widthM * 0.92, heightM * 0.45, lengthM * 0.95);
  const color = new THREE.Color(vehicle.color || '#00e5ff');
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.25,
    metalness: 0.65,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.y = heightM * 0.4;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const cabinGeo = new THREE.BoxGeometry(widthM * 0.82, heightM * 0.38, lengthM * 0.52);
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x0a101f,
    roughness: 0.1,
    metalness: 0.9,
  });
  const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat);
  cabinMesh.position.set(0, heightM * 0.72, -lengthM * 0.05);
  cabinMesh.castShadow = true;
  group.add(cabinMesh);

  const wheelRadius = 0.32;
  const wheelWidth = 0.22;
  const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
  const wheelPositions = [
    [-widthM * 0.46, wheelRadius, lengthM * 0.30],
    [widthM * 0.46, wheelRadius, lengthM * 0.30],
    [-widthM * 0.46, wheelRadius, -lengthM * 0.30],
    [widthM * 0.46, wheelRadius, -lengthM * 0.30],
  ];
  wheelPositions.forEach(([x, y, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    group.add(wheel);
  });

  return group;
}
