/**
 * DATACAR ARENA — Reglas urbanas interactivas (semáforos, límites de velocidad
 * máxima/mínima, tránsito de mano contraria disciplinado, cinturón y alerta ADAS lateral).
 * Módulo puro en TypeScript sin dependencia de Three.js para compatibilidad con Node tests.
 *
 * Convención de ejes en vista de persecución (avance hacia +Z):
 * - Derecha de pantalla (carriles de avance del jugador y rivales): X < +1.65 (ej. -5.4 .. +1.0)
 * - Doble línea amarilla divisoria central: X = +1.65
 * - Izquierda de pantalla (mano contraria avanzando hacia -Z): X > +1.65 (carriles +3.25 y +5.05)
 */
import type { RaceTrackConfig, Vehicle } from '../types/vehicle.ts';
import { getAsuncionStreetDetails } from './asuncionStreetData.ts';
import { hasVerifiedSystem } from './vehicleSafetySystems.ts';

export const DOUBLE_YELLOW_X = 1.65;
export const FORWARD_LANE_OPTIONS = [-5.1, -3.7, -2.2, -0.8, 0.35] as const;
export const ONCOMING_LANES_X = [3.25, 5.05] as const;

export type TrafficSignalPhase = 'green' | 'yellow' | 'red';

export interface TrafficLightNode {
  id: string;
  z: number;
  label: string;
  cycleSec: number;
  greenSec: number;
  yellowSec: number;
  phaseOffsetSec: number;
}

export interface TrafficLightLiveState {
  node: TrafficLightNode;
  phase: TrafficSignalPhase;
  remainingSec: number;
  forwardStopZ: number;
  oncomingStopZ: number;
}

export interface SpeedLimitZone {
  id: string;
  fromZ: number;
  toZ: number;
  signZ: number;
  maxKmh: number;
  minKmh: number;
  label: string;
}

export interface OncomingTrafficCar {
  id: string;
  laneX: number;
  x: number;
  z: number;
  speedMps: number;
  desiredSpeedMps: number;
  lengthM: number;
  widthM: number;
  color: string;
  wheelAngle: number;
  braking: boolean;
}

export type TrafficNoticeKind = 'warning' | 'penalty' | 'ok' | 'adas';

export interface TrafficRuleNotice {
  seq: number;
  kind: TrafficNoticeKind;
  code: 'seatbelt' | 'red_light' | 'max_speed' | 'min_speed' | 'wrong_way' | 'seatbelt_ok';
  title: string;
  subtitle: string;
  pointsDelta: number;
  createdAtSec: number;
}

export interface BlindSpotFlankState {
  equipped: boolean;
  leftAlert: boolean;
  rightAlert: boolean;
  leftDistanceM: number | null;
  rightDistanceM: number | null;
}

export interface WetSplashEvent {
  seq: number;
  carId: string;
  x: number;
  z: number;
  intensity: number;
  timeSec: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function hasVerifiedBlindSpotAdas(vehicle: Vehicle): boolean {
  return (
    hasVerifiedSystem(vehicle, 'blindSpot') ||
    hasVerifiedSystem(vehicle, 'laneChangeAssist')
  );
}

export function buildTrafficLights(track: RaceTrackConfig): TrafficLightNode[] {
  const dist = track.distanceMeters;
  if (dist < 320) return [];
  const details = track.cityCircuitId
    ? getAsuncionStreetDetails(track.routeHazardProfile, dist)
    : { crossings: [], speedBumps: [] };

  const rawPositions: { z: number; label: string }[] = [];
  const step = track.routeHazardProfile === 'traffic' ? 360 : 340;
  let idx = 1;
  for (let z = 250; z < dist - 115; z += step) {
    const nearbyCross = details.crossings.find(c => Math.abs(c.z - z) < 95);
    const snappedZ = nearbyCross ? nearbyCross.z - 8 : z;
    if (snappedZ < 150 || snappedZ > dist - 95) continue;
    if (rawPositions.some(p => Math.abs(p.z - snappedZ) < 155)) continue;
    rawPositions.push({
      z: Math.round(snappedZ),
      label: nearbyCross ? `Cruce ${nearbyCross.transverse}` : `Intersección ${idx}`,
    });
    idx++;
  }

  // Calibrar desfase para que el jugador encuentre semáforos reales en amarillo/rojo
  // al llegar a ritmo urbano (~14–16 m/s) y deba poner a prueba los frenos.
  const greenSec = 8.5;
  const yellowSec = 2.5;
  const redSec = 6.8;
  const cycleSec = greenSec + yellowSec + redSec; // 17.8 s

  return rawPositions.map((pos, i) => {
    const expectedArrivalSec = pos.z / 15.2;
    // Alternar para que el 1.º y 3.º estén entrando a rojo al llegar y el 2.º requiera atención
    const targetCycleMoment = i % 2 === 0 ? greenSec + 1.4 : greenSec - 1.2;
    const rawOffset = ((targetCycleMoment - (expectedArrivalSec % cycleSec)) % cycleSec + cycleSec) % cycleSec;
    return {
      id: `semaforo-${i + 1}`,
      z: pos.z,
      label: pos.label,
      cycleSec,
      greenSec,
      yellowSec,
      phaseOffsetSec: Number(rawOffset.toFixed(2)),
    };
  });
}

export function getTrafficLightState(node: TrafficLightNode, timeSec: number): TrafficLightLiveState {
  const t = ((timeSec + node.phaseOffsetSec) % node.cycleSec + node.cycleSec) % node.cycleSec;
  let phase: TrafficSignalPhase = 'red';
  let remainingSec = 0;
  if (t < node.greenSec) {
    phase = 'green';
    remainingSec = node.greenSec - t;
  } else if (t < node.greenSec + node.yellowSec) {
    phase = 'yellow';
    remainingSec = node.greenSec + node.yellowSec - t;
  } else {
    phase = 'red';
    remainingSec = node.cycleSec - t;
  }
  return {
    node,
    phase,
    remainingSec,
    forwardStopZ: node.z - 5.5,
    oncomingStopZ: node.z + 5.8,
  };
}

export function findUpcomingTrafficLight(
  nodes: readonly TrafficLightNode[],
  z: number,
  timeSec: number,
  maxLookaheadM = 135,
): (TrafficLightLiveState & { distanceToStopM: number }) | null {
  for (const node of nodes) {
    const state = getTrafficLightState(node, timeSec);
    const dist = state.forwardStopZ - z;
    if (dist >= -4.5 && dist <= maxLookaheadM) {
      return { ...state, distanceToStopM: dist };
    }
  }
  return null;
}

export function buildSpeedLimitZones(track: RaceTrackConfig): SpeedLimitZone[] {
  const dist = track.distanceMeters;
  const fastAve = track.routeHazardProfile === 'traffic';
  const floodOrCobbles = track.routeHazardProfile === 'flood' || track.routeHazardProfile === 'cobbles';

  const templates: { maxKmh: number; minKmh: number; label: string }[] = fastAve
    ? [
        { maxKmh: 70, minKmh: 35, label: 'Avenida rápida' },
        { maxKmh: 50, minKmh: 25, label: 'Zona comercial' },
        { maxKmh: 80, minKmh: 40, label: 'Tramo ágil' },
        { maxKmh: 60, minKmh: 30, label: 'Cruce regulado' },
      ]
    : floodOrCobbles
      ? [
          { maxKmh: 50, minKmh: 25, label: 'Calzada delicada' },
          { maxKmh: 40, minKmh: 20, label: 'Precaución urbana' },
          { maxKmh: 60, minKmh: 30, label: 'Tramo principal' },
        ]
      : [
          { maxKmh: 60, minKmh: 30, label: 'Urbano principal' },
          { maxKmh: 45, minKmh: 25, label: 'Zona de cruces' },
          { maxKmh: 65, minKmh: 30, label: 'Corredor fluido' },
          { maxKmh: 50, minKmh: 25, label: 'Tramo controlado' },
        ];

  const segmentLen = 390;
  const count = Math.max(2, Math.ceil(dist / segmentLen));
  const zones: SpeedLimitZone[] = [];

  for (let i = 0; i < count; i++) {
    const fromZ = i * segmentLen;
    const toZ = i === count - 1 ? dist + 150 : (i + 1) * segmentLen;
    const tpl = templates[i % templates.length];
    zones.push({
      id: `vel-zone-${i + 1}`,
      fromZ,
      toZ,
      signZ: Math.min(dist - 40, Math.max(28, fromZ + 28)),
      maxKmh: tpl.maxKmh,
      minKmh: tpl.minKmh,
      label: tpl.label,
    });
  }
  return zones;
}

export function getActiveSpeedLimitZone(
  zones: readonly SpeedLimitZone[],
  z: number,
): SpeedLimitZone {
  const safeZ = Math.max(0, z);
  for (const zone of zones) {
    if (safeZ >= zone.fromZ && safeZ < zone.toZ) return zone;
  }
  return zones[zones.length - 1] ?? {
    id: 'default-zone',
    fromZ: 0,
    toZ: 99999,
    signZ: 30,
    maxKmh: 60,
    minKmh: 30,
    label: 'Urbano',
  };
}

const ONCOMING_PALETTE = ['#e2e8f0', '#38bdf8', '#94a3b8', '#f59e0b', '#cbd5e1', '#fb7185'];

export function createOncomingTrafficPool(track: RaceTrackConfig): OncomingTrafficCar[] {
  const dist = track.distanceMeters;
  const count = clamp(Math.round(dist / 210), 6, 18);
  const spacing = Math.max(120, (dist + 120) / count);
  const cars: OncomingTrafficCar[] = [];

  for (let i = 0; i < count; i++) {
    const laneX = ONCOMING_LANES_X[i % ONCOMING_LANES_X.length];
    const startZ = 95 + i * spacing;
    const baseSpeedMps = (44 + (i % 3) * 5) / 3.6;
    cars.push({
      id: `oncoming-${i + 1}`,
      laneX,
      x: laneX,
      z: startZ,
      speedMps: baseSpeedMps,
      desiredSpeedMps: baseSpeedMps,
      lengthM: i % 2 === 0 ? 4.45 : 4.25,
      widthM: 1.82,
      color: ONCOMING_PALETTE[i % ONCOMING_PALETTE.length],
      wheelAngle: 0,
      braking: false,
    });
  }
  return cars;
}

/**
 * Actualiza los vehículos que circulan en sentido contrario (-Z) por los carriles
 * izquierdos (X = +3.25 y +5.05). Respetan estrictamente límites de velocidad,
 * semáforos en rojo/amarillo y distancia entre sí, sin salirse jamás de su mano.
 */
export function stepOncomingTraffic(
  cars: OncomingTrafficCar[],
  lights: readonly TrafficLightNode[],
  speedZones: readonly SpeedLimitZone[],
  timeSec: number,
  dt: number,
  playerZ: number,
  trackDistanceM: number,
): void {
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    car.x = car.laneX; // Disciplina absoluta de carril: nunca invade la mano del jugador

    const zone = getActiveSpeedLimitZone(speedZones, car.z);
    // Respetan entre el 78% y 90% de la máxima permitida y nunca bajan de la mínima en verde
    const maxAllowedMps = (zone.maxKmh * 0.86) / 3.6;
    const minAllowedMps = (zone.minKmh * 1.06) / 3.6;
    let targetSpeed = clamp(maxAllowedMps, minAllowedMps, 21);
    let braking = false;

    // 1. Respeto de semáforos (avanzando hacia -Z: se detienen en oncomingStopZ = node.z + 5.8)
    for (const node of lights) {
      const st = getTrafficLightState(node, timeSec);
      if (st.phase === 'green') continue;
      const distToStop = car.z - st.oncomingStopZ;
      if (distToStop >= -0.8 && distToStop <= 46) {
        if (distToStop <= 2.2) {
          targetSpeed = 0;
          braking = true;
        } else {
          const safeApproach = Math.sqrt(2 * 4.2 * Math.max(0, distToStop - 1.5));
          if (safeApproach < targetSpeed) {
            targetSpeed = safeApproach;
            braking = true;
          }
        }
      }
    }

    // 2. Distancia de seguridad con otro auto de frente que vaya delante de él (menor Z en el mismo carril)
    for (let j = 0; j < cars.length; j++) {
      if (i === j) continue;
      const ahead = cars[j];
      if (Math.abs(ahead.laneX - car.laneX) > 0.6) continue;
      const gap = car.z - ahead.z - (car.lengthM + ahead.lengthM) * 0.5;
      if (gap > 0 && gap < 22) {
        const matchSpeed = gap < 5.5 ? 0 : Math.min(targetSpeed, ahead.speedMps * clamp((gap - 4) / 14, 0, 1));
        if (matchSpeed < targetSpeed) {
          targetSpeed = matchSpeed;
          braking = true;
        }
      }
    }

    const accelRate = targetSpeed < car.speedMps ? 6.8 : 3.2;
    car.speedMps = clamp(
      car.speedMps + clamp(targetSpeed - car.speedMps, -accelRate * dt, accelRate * dt),
      0,
      25,
    );
    if (targetSpeed === 0 && car.speedMps < 0.08) car.speedMps = 0;
    car.braking = braking && car.speedMps > 0.2;
    car.z -= car.speedMps * dt;
    car.wheelAngle = (car.wheelAngle + (car.speedMps * dt) / 0.34) % (Math.PI * 2);

    // Reciclaje continuo por delante del horizonte visual del jugador para mantener flujo en todas las vueltas
    if (car.z < playerZ - 85) {
      let maxAheadZ = playerZ + 250;
      for (const other of cars) {
        if (Math.abs(other.laneX - car.laneX) < 0.6 && other.z > maxAheadZ) {
          maxAheadZ = other.z;
        }
      }
      const respawnZ = Math.max(playerZ + 255 + (i % 4) * 38, maxAheadZ + 58);
      if (respawnZ <= trackDistanceM + 160) {
        car.z = respawnZ;
        car.speedMps = Math.min(maxAllowedMps, 13.5);
      }
    }
  }
}

/**
 * Evalúa sensores ADAS laterales (Blind Spot / Asistencia de cambio de carril)
 * SOLO si el vehículo elegido tiene el sistema confirmado en ficha.
 * Izquierda de pantalla = dx > 0; Derecha de pantalla = dx < 0.
 */
export function evaluateBlindSpotFlanks(
  playerVehicle: Vehicle,
  playerX: number,
  playerZ: number,
  rivals: ReadonlyArray<{ id: string; x: number; z: number }>,
  oncoming: ReadonlyArray<{ x: number; z: number }>,
  playerId: string,
): BlindSpotFlankState {
  const equipped = hasVerifiedBlindSpotAdas(playerVehicle);
  if (!equipped) {
    return {
      equipped: false,
      leftAlert: false,
      rightAlert: false,
      leftDistanceM: null,
      rightDistanceM: null,
    };
  }

  let leftDist: number | null = null;
  let rightDist: number | null = null;

  const inspectTarget = (tx: number, tz: number, forwardLookM: number, rearLookM: number) => {
    const dz = tz - playerZ;
    if (dz < -rearLookM || dz > forwardLookM) return;
    const dx = tx - playerX;
    const euclid = Math.hypot(dx, dz);
    // dx > 0 es IZQUIERDA del conductor; dx < 0 es DERECHA del conductor
    if (dx > 0.95 && dx <= 5.8) {
      if (leftDist === null || euclid < leftDist) leftDist = euclid;
    } else if (dx < -0.95 && dx >= -5.8) {
      if (rightDist === null || euclid < rightDist) rightDist = euclid;
    }
  };

  for (const r of rivals) {
    if (r.id === playerId) continue;
    inspectTarget(r.x, r.z, 13.5, 16.5);
  }
  for (const oc of oncoming) {
    // Autos de frente se aproximan rápido por la izquierda: ventana frontal mayor (38m)
    inspectTarget(oc.x, oc.z, 38, 9);
  }

  return {
    equipped: true,
    leftAlert: leftDist !== null,
    rightAlert: rightDist !== null,
    leftDistanceM: leftDist !== null ? Math.round(leftDist) : null,
    rightDistanceM: rightDist !== null ? Math.round(rightDist) : null,
  };
}
