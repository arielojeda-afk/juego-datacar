import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Vehicle, RaceTrackConfig, VehicleRaceResult } from '../types/vehicle';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Award, 
  Volume2, 
  VolumeX, 
  Video, 
  Tv, 
  Compass, 
  Clapperboard, 
  Flag,
  Activity,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Sun,
  Moon,
  MousePointer2,
  Keyboard,
  TrafficCone,
  Zap,
  ShieldAlert,
  CloudRain,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, CircleStop, Maximize2, Smartphone, X,
  MapPin, Timer, Gauge, ChevronLeft, ChevronRight, ChevronsUp, ChevronsDown, AlertCircle,
} from 'lucide-react';
import { soundEngine } from '../utils/soundEngine';
import { canStartCountdown, raceStartupMessage } from '../utils/raceStartupGate';
import { initialRaceInsight, nextRaceInsight, type RaceInsight } from '../utils/vehicleRaceInsights';
import { hasDocumentedABS } from '../utils/brakingDynamics';
import { hasVerifiedSystem } from '../utils/vehicleSafetySystems';
import { interpolateRenderPose, snapshotRenderPose, type RenderPose } from '../utils/visualPhysicsInterpolation';
import { createVehicleEntity, VehicleEntityRunner } from '../utils/vehicle3DEntity';
import { createUrbanTrackScenery } from '../utils/urbanTrackScenery';
import { createDatacarViaducts3D } from '../utils/datacarViaducts3D';
import { finishCameraPose } from '../utils/finishCinematicCamera';
import { createWeatherVisuals3D } from '../utils/weatherVisuals3D';
import { WEATHER_CONFIG, WEATHER_OPTIONS } from '../utils/weatherDynamics';
import type { WeatherMode } from '../utils/weatherDynamics';
import { createSpeedBumps3D } from '../utils/realisticSpeedBumps3D';
import { getAsuncionStreetDetails } from '../utils/asuncionStreetData';
import { createPotholeVisualKit } from '../utils/realisticPotholes3D';
import { findUpcomingPothole, potholeCameraCue, type PotholeLookahead } from '../utils/potholeVisibility';
import { createDepressedRoadGeometry } from '../utils/depressedRoadSurface3D';
import { makeRoadPath, type CurvedRoadPath } from '../utils/curvedRoadPath';
import { makeCurvedAsphalt, bendRoadsideGroup } from '../utils/curvedRoadVisuals3D';
import { hasVehicle3DModel } from '../utils/vehicle3DModelLoader';
import { chooseDirectorShot, DirectorShot } from '../utils/cinematicDirector';
import { simulatedGear } from '../utils/powertrainDynamics';
import { InteractiveRacePhysics, PHYSICS_STEP } from '../utils/interactiveRacePhysics';
import type { TrackHazard, HazardKind } from '../utils/interactiveRacePhysics';
import { createUrbanTrafficVisuals3D } from '../utils/urbanTrafficVisuals3D';
import {
  hasVerifiedBlindSpotAdas,
  type BlindSpotFlankState,
  type SpeedLimitZone,
  type TrafficLightLiveState,
  type TrafficRuleNotice,
} from '../utils/urbanTrafficRules';
import { 
  createAsphaltTexture,
  createAsphaltMicroRelief,
  createKerbTexture, 
  createCheckeredFinishTexture,
  createDistanceSignTexture 
} from '../utils/race3dTextures';

export type CameraViewMode = 'arcade' | 'trasera' | 'lateral' | 'cenital' | 'frontal_meta' | 'automatica' | 'libre';

interface Race3DPerspectiveViewProps {
  vehicles: Vehicle[];
  track: RaceTrackConfig;
  simulationResults: VehicleRaceResult[];
  onFinishRace: (liveResults?: VehicleRaceResult[], replayHazards?: TrackHazard[], weather?: WeatherMode) => void;
  onSwitchTo2D?: () => void;
  compact?: boolean; // Para modo vertical 9:16 de TikTok LIVE
  experience?: 'legacy' | 'comparison' | 'race' | 'replay';
  playerVehicleId?: string;
  replayHazards?: TrackHazard[];
  replayWeather?: WeatherMode;
  initialWeather?: WeatherMode;
  onExitRace?: () => void;
  onRestartRace?: () => void;
  /** La carrera mobile espera el toque START después de preparar render y modelos. */
  manualStart?: boolean;
}

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

const describeArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number) => {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArcFlag = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
};

const gaugeRatio = (value: number, min: number, max: number) => THREE.MathUtils.clamp((value - min) / Math.max(1e-6, max - min), 0, 1);

type ArcadeGaugeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  accentClass: string;
  glowClass: string;
  subValue?: string;
  dangerFrom?: number;
};

const ArcadeGauge: React.FC<ArcadeGaugeProps> = ({
  label,
  value,
  min,
  max,
  unit,
  accentClass,
  glowClass,
  subValue,
  dangerFrom,
}) => {
  const ratio = gaugeRatio(value, min, max);
  const startDeg = -215;
  const endDeg = 35;
  const progressDeg = startDeg + ratio * (endDeg - startDeg);
  const dangerRatio = typeof dangerFrom === 'number' ? gaugeRatio(dangerFrom, min, max) : null;
  const dangerStart = typeof dangerRatio === 'number' ? startDeg + dangerRatio * (endDeg - startDeg) : null;

  return (
    <div className="relative w-[148px] h-[148px] rounded-full border border-sky-400/20 bg-slate-950/85 shadow-[0_8px_30px_rgba(2,6,23,0.65)] backdrop-blur-md overflow-hidden">
      <div className={`absolute inset-3 rounded-full bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.55),rgba(2,6,23,0.95)_68%)] ring-1 ring-inset ring-white/5 ${glowClass}`} />
      <svg viewBox="0 0 160 160" className="absolute inset-0 w-full h-full">
        <path d={describeArc(80, 80, 60, startDeg, endDeg)} stroke="rgba(148,163,184,0.18)" strokeWidth="11" fill="none" strokeLinecap="round" />
        {dangerStart !== null && (
          <path d={describeArc(80, 80, 60, dangerStart, endDeg)} stroke="rgba(251,191,36,0.7)" strokeWidth="11" fill="none" strokeLinecap="round" />
        )}
        <path d={describeArc(80, 80, 60, startDeg, progressDeg)} stroke="currentColor" className={accentClass} strokeWidth="11" fill="none" strokeLinecap="round" />
        {Array.from({ length: 11 }).map((_, i) => {
          const a = startDeg + (i / 10) * (endDeg - startDeg);
          const p1 = polarToCartesian(80, 80, 50, a);
          const p2 = polarToCartesian(80, 80, i % 5 === 0 ? 37 : 42, a);
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(226,232,240,0.65)" strokeWidth={i % 5 === 0 ? 2.4 : 1.2} strokeLinecap="round" />;
        })}
        <line
          x1="80"
          y1="80"
          x2={polarToCartesian(80, 80, 48, progressDeg).x}
          y2={polarToCartesian(80, 80, 48, progressDeg).y}
          stroke="white"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <circle cx="80" cy="80" r="4.5" fill="white" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <div className="text-[10px] font-bold tracking-[0.28em] text-slate-400 uppercase">{label}</div>
        <div className="mt-1 text-[34px] leading-none font-black tracking-tight text-white tabular-nums">{Math.round(value)}</div>
        <div className="text-[10px] font-semibold tracking-[0.24em] text-slate-400 uppercase">{unit}</div>
        {subValue && <div className="mt-2 text-[11px] font-mono font-bold text-slate-300">{subValue}</div>}
      </div>
    </div>
  );
};

type ArcadeRaceHudState = {
  speedKmh: number;
  rpm: number;
  gear: number;
  accelG: number;
  absActive?: boolean;
  tcsActive?: boolean;
  escActive?: boolean;
  aebActive?: boolean;
};

const ArcadeRaceHud: React.FC<{
  vehicle: Vehicle;
  state: ArcadeRaceHudState;
}> = ({ vehicle, state }) => {
  const maxRpm = vehicle.fuelType === 'hybrid' ? 7000 : vehicle.engineDescription.toLowerCase().includes('turbo') ? 6500 : 6800;
  const assistBadges = [
    { key: 'ABS', active: !!state.absActive, available: hasDocumentedABS(vehicle) },
    { key: 'TRC', active: !!state.tcsActive, available: hasVerifiedSystem(vehicle, 'tcs') },
    { key: 'ESC', active: !!state.escActive, available: hasVerifiedSystem(vehicle, 'esc') },
    { key: 'AEB', active: !!state.aebActive, available: hasVerifiedSystem(vehicle, 'aeb') },
  ].filter((b) => b.available);

  return (
    <div className="dc100-race-gauges absolute bottom-4 right-4 z-20 pointer-events-none select-none">
      <div className="relative rounded-[26px] border border-sky-400/20 bg-[linear-gradient(180deg,rgba(2,6,23,0.84),rgba(2,6,23,0.96))] px-4 pt-3 pb-2 shadow-[0_20px_45px_rgba(2,6,23,0.6)] backdrop-blur-md overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-sky-400/80 to-transparent" />
        <div className="flex items-end gap-3">
          <div className="relative">
            <ArcadeGauge
              label="Velocidad"
              value={state.speedKmh}
              min={0}
              max={Math.max(140, Math.ceil(vehicle.topSpeedKmh / 10) * 10)}
              unit="km/h"
              accentClass="text-sky-400"
              glowClass="shadow-[0_0_24px_rgba(56,189,248,0.16)]"
              subValue={`MAX ${vehicle.topSpeedKmh.toFixed(0)}`}
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/90 border border-slate-700 px-3 py-1 text-[11px] font-black tracking-[0.22em] text-sky-300 shadow-lg">
              {state.gear === 0 ? 'R' : `${state.gear}ª`}
            </div>
          </div>
          <div className="relative -ml-1">
            <ArcadeGauge
              label="Revoluciones"
              value={state.rpm}
              min={0}
              max={maxRpm}
              unit="rpm"
              accentClass="text-amber-400"
              glowClass="shadow-[0_0_24px_rgba(251,191,36,0.14)]"
              dangerFrom={maxRpm * 0.82}
              subValue={`${(state.rpm / 1000).toFixed(1)} x1000`}
            />
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 font-mono">
          <div>
            <div className="text-[9px] uppercase tracking-[0.26em] text-slate-500">Aceleración</div>
            <div className="text-[15px] font-black tabular-nums text-white">{state.accelG > 0 ? '+' : ''}{state.accelG.toFixed(2)}<span className="ml-1 text-[10px] text-slate-400">G</span></div>
          </div>
          {assistBadges.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[190px]">
              {assistBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`rounded-md border px-2 py-1 text-[10px] font-bold tracking-[0.18em] ${badge.active ? 'border-amber-400/70 bg-amber-400/20 text-amber-200' : 'border-slate-700 bg-slate-900/80 text-slate-400'}`}
                >
                  {badge.active ? (badge.key === 'ABS' ? 'ABS ACTIVO' : `${badge.key} ACTIVO`) : badge.key}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


export const formatRaceStopwatch = (sec: number): string => {
  if (isNaN(sec) || sec < 0) return '00:00.000';
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  const ms = Math.floor((sec * 1000) % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

/** Minimapa circular Mockup 5:
 * Borde cian brillante, flecha dorada del jugador, trazado con glow, bandera a cuadros en la meta,
 * y píldora inferior con POS. (dorado) y VUELTA.
 */
const RaceMiniMap: React.FC<{
  path: CurvedRoadPath;
  player: { distance: number; lateralX?: number };
  opponents: { id: string; distance: number; lateralX?: number }[];
  playerId: string;
  playerRank?: number;
  totalCars?: number;
  currentLap?: number;
  totalLaps?: number;
}> = ({
  path,
  player,
  opponents,
  playerId,
  playerRank = 2,
  totalCars = 8,
  currentLap = 2,
  totalLaps = 3,
}) => {
  const center = path.world(player.distance, player.lateralX ?? 0);
  const c = Math.cos(center.yaw), s = Math.sin(center.yaw);
  const project = (worldX: number, worldZ: number) => {
    const dx = worldX - center.x, dz = worldZ - center.z;
    const lateral = dx * c - dz * s;
    const forward = dx * s + dz * c;
    return { x: 58 + lateral * 0.44, y: 76 - forward * 0.44 };
  };
  const points: string[] = [];
  const from = Math.max(0, player.distance - 75);
  const to = Math.min(path.length, player.distance + 240);
  for (let dist = from; dist <= to; dist += 6) {
    const sample = path.at(dist);
    const q = project(sample.x, sample.z);
    points.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
  }
  const last = path.at(to);
  const lastPoint = project(last.x, last.z);
  points.push(`${lastPoint.x.toFixed(1)},${lastPoint.y.toFixed(1)}`);
  const finish = path.world(path.length);
  const finishPoint = project(finish.x, finish.z);
  const canShowFinish = path.length - player.distance < 280;

  return (
    <div className="dc100-race-map dc-mockup5-minimap absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-30 pointer-events-none flex flex-col items-start select-none">
      {/* 1. Minimapa circular con borde cian brillante */}
      <div className="relative w-[110px] h-[110px] sm:w-[116px] sm:h-[116px] rounded-full border-2 border-[#00e5ff] bg-[#030914]/90 backdrop-blur-md shadow-[0_0_20px_rgba(0,229,255,0.7),inset_0_0_14px_rgba(0,229,255,0.22)] overflow-hidden flex items-center justify-center">
        {/* Indicador brújula N con flecha hacia arriba */}
        <div className="absolute top-1 inset-x-0 flex flex-col items-center pointer-events-none z-10">
          <span className="text-[9px] font-black tracking-widest text-[#00e5ff] leading-none drop-shadow-[0_0_4px_#00e5ff]">N</span>
          <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[4px] border-b-[#00e5ff] mt-0.5" />
        </div>

        <svg viewBox="0 0 116 116" className="w-full h-full block" aria-label="Minimapa circular">
          {/* Anillos de cuadrícula de radar */}
          <circle cx="58" cy="58" r="48" fill="none" stroke="rgba(0,229,255,0.09)" strokeWidth="1" strokeDasharray="3 3"/>
          <circle cx="58" cy="58" r="28" fill="none" stroke="rgba(0,229,255,0.09)" strokeWidth="1"/>
          
          {/* Trazado base de pista */}
          <polyline points={points.join(' ')} fill="none" stroke="rgba(15,23,42,0.85)" strokeWidth="12" strokeLinejoin="round" strokeLinecap="round" />
          {/* Trazado neón cian brillante */}
          <polyline points={points.join(' ')} fill="none" stroke="#00e5ff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="drop-shadow-[0_0_6px_#00e5ff]" />
          
          {/* Bandera a cuadros en la meta */}
          {canShowFinish && (
            <g transform={`translate(${finishPoint.x},${finishPoint.y})`}>
              <circle r="7" fill="#000" stroke="#00e5ff" strokeWidth="1.5"/>
              <rect x="-4" y="-4" width="4" height="4" fill="#fff"/>
              <rect x="0" y="-4" width="4" height="4" fill="#000"/>
              <rect x="-4" y="0" width="4" height="4" fill="#000"/>
              <rect x="0" y="0" width="4" height="4" fill="#fff"/>
            </g>
          )}

          {/* Rivales */}
          {opponents.filter(v => v.id !== playerId).map(v => {
            const p = path.world(v.distance, v.lateralX ?? 0);
            const xy = project(p.x, p.z);
            return (
              <g key={v.id} transform={`translate(${xy.x},${xy.y})`}>
                <circle r="4" fill="#ff9900" stroke="#ffffff" strokeWidth="1.2" className="drop-shadow-[0_0_4px_#ff9900]" />
              </g>
            );
          })}

          {/* Flecha dorada indicando la posición y rumbo del jugador */}
          <g transform="translate(58,76)">
            <polygon points="0,-12 7,8 0,4 -7,8" fill="#ffb800" stroke="#ffffff" strokeWidth="1.4" className="drop-shadow-[0_0_8px_#ffb800]" />
          </g>
        </svg>
      </div>

      {/* Píldora inferior: POS. 2/8 (dorado) y VUELTA 2/3 */}
      <div className="mt-1.5 w-[110px] sm:w-[116px] px-2.5 py-1 bg-[#030914]/90 backdrop-blur-md border border-cyan-400/40 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.85)] flex flex-col gap-0.5">
        <div className="flex items-center justify-between text-[10px] leading-tight font-black tracking-wider">
          <span className="text-white/80">POS.</span>
          <span className="text-[#ffb800] text-[13px] font-black italic drop-shadow-[0_0_6px_rgba(255,184,0,0.7)]">{playerRank}/{totalCars}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] leading-tight font-black tracking-wider">
          <span className="text-white/80">VUELTA</span>
          <span className="text-cyan-300 text-[13px] font-black italic drop-shadow-[0_0_6px_rgba(0,229,255,0.7)]">{currentLap}/{totalLaps}</span>
        </div>
      </div>
    </div>
  );
};

/** Clúster digital arcade Mockup 5/6:
 * Botones de cámara y pausa en cristal oscuro, arco semicircular de RPM (RPM x1000) con zona roja,
 * velocidad en números gigantes 168 km/h y marcha en cuadro dorado 4.
 */
const Mockup5SpeedCluster: React.FC<{
  speedKmh: number;
  rpm: number;
  gear: number;
  onCycleCamera: () => void;
  onPause: () => void;
  onOpenDetailed?: () => void;
}> = ({ speedKmh, rpm, gear, onCycleCamera, onPause, onOpenDetailed }) => {
  const maxRpm = 8000;
  const clampedRpm = Math.max(0, Math.min(maxRpm, rpm));
  const ratio = clampedRpm / maxRpm;
  const radius = 54;
  const cx = 75;
  const cy = 64;
  const circumference = Math.PI * radius; // ~169.6
  const strokeDashoffset = circumference * (1 - ratio);

  return (
    <div className="dc-mockup5-cluster-wrapper absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-30 flex flex-col items-end gap-1.5 select-none pointer-events-none">
      {/* Botones superiores de cámara y pausa en cristal oscuro */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={onCycleCamera}
          className="w-9 h-9 rounded-xl bg-[#030914]/85 backdrop-blur-md border border-cyan-400/40 text-cyan-300 flex items-center justify-center hover:bg-cyan-950/60 active:scale-95 transition-all shadow-[0_0_12px_rgba(0,0,0,0.7)] cursor-pointer"
          aria-label="Cambiar vista de cámara"
          title="Cambiar vista de cámara"
        >
          <Video size={17} />
        </button>
        <button
          type="button"
          onClick={onPause}
          className="w-9 h-9 rounded-xl bg-[#030914]/85 backdrop-blur-md border border-cyan-400/40 text-cyan-300 flex items-center justify-center hover:bg-cyan-950/60 active:scale-95 transition-all shadow-[0_0_12px_rgba(0,0,0,0.7)] cursor-pointer"
          aria-label="Pausa"
          title="Pausa"
        >
          <Pause size={17} />
        </button>
      </div>

      {/* Tacómetro / Velocímetro digital estilo arcade */}
      <div className="dc11-mobile-speed dc-mockup5-cluster pointer-events-auto relative w-[164px] sm:w-[178px] rounded-2xl border border-cyan-400/50 bg-[#030914]/90 backdrop-blur-md px-3 pt-2 pb-2 shadow-[0_0_24px_rgba(0,229,255,0.28),inset_0_0_14px_rgba(0,229,255,0.08)] flex flex-col items-center">
        {/* Semicírculo de RPM con escala 0-8 y zona roja 7-8 */}
        <div className="relative w-[150px] h-[64px] overflow-visible">
          <svg viewBox="0 0 150 68" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="dcRpmGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="55%" stopColor="#22c55e" />
                <stop offset="75%" stopColor="#eab308" />
                <stop offset="90%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
            {/* Pista de fondo */}
            <path
              d={`M ${cx - radius},${cy} A ${radius},${radius} 0 0,1 ${cx + radius},${cy}`}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            {/* Zona roja indicativa en 7-8 */}
            <path
              d={`M ${cx + radius * Math.cos(Math.PI * 0.15)},${cy - radius * Math.sin(Math.PI * 0.15)} A ${radius},${radius} 0 0,1 ${cx + radius},${cy}`}
              fill="none"
              stroke="rgba(239,68,68,0.4)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            {/* Arco dinámico de revoluciones */}
            <path
              d={`M ${cx - radius},${cy} A ${radius},${radius} 0 0,1 ${cx + radius},${cy}`}
              fill="none"
              stroke="url(#dcRpmGrad)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-75"
            />
            {/* Marcas numéricas 0 a 8 */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
              const angle = Math.PI - (i / 8) * Math.PI;
              const tr = radius + 9;
              const tx = cx + tr * Math.cos(angle);
              const ty = cy - tr * Math.sin(angle) + 2;
              const isRed = i >= 7;
              return (
                <text
                  key={i}
                  x={tx}
                  y={ty}
                  textAnchor="middle"
                  className={`text-[8px] font-mono font-bold ${isRed ? 'fill-red-400' : 'fill-slate-300'}`}
                >
                  {i}
                </text>
              );
            })}
          </svg>
          {/* Texto RPM x1000 */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <span className="text-[8px] font-mono font-bold tracking-widest text-slate-400 uppercase">
              RPM x1000
            </span>
          </div>
        </div>

        {/* Fila: Velocidad en números gigantes + Marcha en cuadro dorado */}
        <div className="mt-1 flex items-end justify-between w-full px-1">
          {/* Velocidad en números gigantes 168 km/h */}
          <div className="flex flex-col items-start leading-none">
            <div className="flex items-baseline gap-1">
              <strong className="font-display font-black italic text-[34px] sm:text-[38px] text-white tracking-tight leading-none tabular-nums drop-shadow-[0_0_10px_rgba(255,255,255,0.7)]">
                {Math.round(speedKmh)}
              </strong>
            </div>
            <span className="text-[10px] font-extrabold text-cyan-300 tracking-wider uppercase pl-0.5 -mt-0.5">
              km/h
            </span>
          </div>

          {/* Marcha en cuadro dorado 4 */}
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg border-2 border-[#ffb800] bg-[#1a1202]/85 backdrop-blur-sm flex items-center justify-center shadow-[0_0_16px_rgba(255,184,0,0.55),inset_0_0_8px_rgba(255,184,0,0.25)]">
            <span className="font-display font-black italic text-xl sm:text-2xl text-[#ffb800] drop-shadow-[0_0_6px_#ffb800] leading-none">
              {gear === 0 ? 'R' : gear === -1 ? 'N' : gear}
            </span>
          </div>
        </div>

        {/* Pie de datos / compatibilidad de tests */}
        <footer className="w-full flex items-center justify-between mt-1 pt-1 border-t border-cyan-500/20 text-[9px] text-slate-300">
          <b>{gear === 0 ? 'R' : `${gear}ª`}</b>
          <b>{Math.round(rpm)} RPM</b>
          {onOpenDetailed && (
            <button
              type="button"
              onClick={onOpenDetailed}
              className="text-cyan-300 hover:text-white px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-500/30 font-bold text-[8px] tracking-wider"
              aria-label="Ver telemetría completa"
            >
              DATOS +
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export const Race3DPerspectiveView: React.FC<Race3DPerspectiveViewProps> = ({
  vehicles,
  track,
  simulationResults,
  onFinishRace,
  onSwitchTo2D,
  compact = false,
  experience = 'legacy',
  playerVehicleId,
  replayHazards,
  replayWeather,
  initialWeather,
  onExitRace,
  onRestartRace,
  manualStart = false,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  type TouchControl = 'left' | 'right' | 'throttle' | 'reverse' | 'brake';
  type ControlState = Record<TouchControl, boolean>;
  const neutralControls = (): ControlState => ({left:false,right:false,throttle:false,reverse:false,brake:false});
  // Teclado y touch tienen fuentes INDEPENDIENTES. La física usa el OR de ambas.
  // Esto permite acelerar + girar con dos dedos sin que pointerup o keyup de
  // un control borre la entrada del otro.
  const steeringKeysRef = useRef<ControlState>(neutralControls());
  const keyboardControlsRef = useRef<ControlState>(neutralControls());
  const touchControlsRef = useRef<ControlState>(neutralControls());
  const [touchPressed, setTouchPressed] = useState<Partial<ControlState>>({});
  const touchPointersRef = useRef<Record<TouchControl, number | null>>({left:null,right:null,throttle:null,reverse:null,brake:null});
  const syncCombinedControls = () => {
    for (const control of Object.keys(steeringKeysRef.current) as TouchControl[]) {
      steeringKeysRef.current[control] = keyboardControlsRef.current[control] || touchControlsRef.current[control];
    }
  };
  const setTouchControl = (control: TouchControl, pressed: boolean) => {
    touchControlsRef.current[control] = pressed;
    if (control === 'left' || control === 'right') keyboardSteeringRef.current = true;
    syncCombinedControls();
    setTouchPressed(previous => previous[control] === pressed ? previous : {...previous, [control]: pressed});
    if (pressed) soundEngine.unlock();
  };
  useEffect(() => {
    const reset = () => {
      for (const control of Object.keys(touchPointersRef.current) as TouchControl[]) {
        touchPointersRef.current[control] = null;
        touchControlsRef.current[control] = false;
      }
      syncCombinedControls();
      setTouchPressed({});
    };
    const onVisibility = () => { if (document.hidden) reset(); };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  const touchButton = (control: TouchControl, label: string, icon: React.ReactNode, extra = '') => (
    <button type="button" key={control} aria-label={label} aria-pressed={!!touchPressed[control]}
      className={`dc-touch-button ${extra} ${touchPressed[control] ? 'dc-touch-active' : ''}`}
      onContextMenu={event => event.preventDefault()}
      onTouchStart={event => {
        event.stopPropagation();
        setTouchControl(control, true);
      }}
      onTouchEnd={event => {
        event.stopPropagation();
        setTouchControl(control, false);
      }}
      onTouchCancel={event => {
        event.stopPropagation();
        setTouchControl(control, false);
      }}
      onPointerDown={event => {
        event.preventDefault();
        if (touchPointersRef.current[control] !== null) return;
        touchPointersRef.current[control] = event.pointerId;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer may already have been released. */ }
        setTouchControl(control, true);
      }}
      onPointerUp={event => { if (touchPointersRef.current[control] === event.pointerId) { touchPointersRef.current[control] = null; setTouchControl(control, false); } }}
      onPointerCancel={event => { if (touchPointersRef.current[control] === event.pointerId) { touchPointersRef.current[control] = null; setTouchControl(control, false); } }}
      onLostPointerCapture={event => { if (touchPointersRef.current[control] === event.pointerId) { touchPointersRef.current[control] = null; setTouchControl(control, false); } }}>
      {icon}<span className="sr-only">{label}</span>
    </button>
  );
  const enableLandscape = async () => {
    try {
      const element = document.querySelector('.dc-mobile-race') as HTMLElement | null;
      if (element && !document.fullscreenElement && element.requestFullscreen) await element.requestFullscreen();
    } catch { /* En iOS Safari / navegadores sin fullscreen se mantiene el modo normal. */ }
    try {
      const orientation = screen.orientation as ScreenOrientation & {lock?: (mode: string) => Promise<void>};
      if (orientation?.lock) await orientation.lock('landscape');
    } catch { /* El navegador puede prohibir el bloqueo: mostrar indicación de giro manual. */ }
  };

  const physicsRef = useRef<InteractiveRacePhysics | null>(null);
  const raceHazardsSnapshotRef = useRef<TrackHazard[]>([]);
  const addVisualHazardRef = useRef<((kind: HazardKind) => void) | null>(null);
  const placeHazardAtRef = useRef<((kind: HazardKind, x: number, z: number) => void) | null>(null);
  const placementKindRef = useRef<HazardKind | null>(null);
  const finalResultsRef = useRef<VehicleRaceResult[] | null>(null);
  const resetVisualRaceRef = useRef<(() => void) | null>(null);
  const keyboardSteeringRef = useRef(false);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultDeliveredRef = useRef(false);
  const timeDisplayRef = useRef<HTMLSpanElement | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  // Velocidad de reproducción visual: 0.75x por defecto según especificación
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(experience === 'legacy' ? 0.75 : 1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [stuckInPothole,setStuckInPothole] = useState(false);
  const stuckRef = useRef<{seconds:number;lastDistance:number}>({seconds:0,lastDistance:0});
  const [mobileCameraOpen, setMobileCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraViewMode>(experience === 'replay' || experience === 'legacy' ? 'automatica' : 'arcade');
  const [weatherMode, setWeatherMode] = useState<WeatherMode>(() => experience === 'replay' ? (replayWeather || 'sunny') : (initialWeather || (track.routeHazardProfile === 'flood' && experience === 'race' ? 'rain' : 'sunny')));
  const weatherModeRef = useRef<WeatherMode>(weatherMode);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [goFlash, setGoFlash] = useState(false);
  const [raceInsight, setRaceInsight] = useState<RaceInsight | null>(null);
  const insightSequenceRef = useRef(0);
  const lastUrgentInsightAtRef = useRef(0);
  const [restartSequence, setRestartSequence] = useState(0);
  const [startRequested, setStartRequested] = useState(experience !== 'race');
  const [visualReady, setVisualReady] = useState(false);
  const [showDetailedHud,setShowDetailedHud] = useState(false);
  const [showRaceInformation,setShowRaceInformation] = useState(false);
  const lastInsightIdRef = useRef<string | null>(null);
  const [hasFinished, setHasFinished] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(playerVehicleId || vehicles[0]?.id || '');
  const [isMuted, setIsMuted] = useState(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [potholeWarning, setPotholeWarning] = useState<PotholeLookahead | null>(null);
  const [steeringDemoDeg, setSteeringDemoDeg] = useState(0);
  const [headlightsOn, setHeadlightsOn] = useState(true);
  const [showVehicleLabels, setShowVehicleLabels] = useState(true);
  const [interactiveMode, setInteractiveMode] = useState(() => experience === 'race' || (experience === 'legacy' && track.distanceMeters <= 3500));
  const [hazardsEnabled, setHazardsEnabled] = useState(true);
  const [hazardCount, setHazardCount] = useState(0);
  const [placementKind, setPlacementKind] = useState<HazardKind | null>(null);
  useEffect(() => { placementKindRef.current = placementKind; }, [placementKind]);
  useEffect(() => {
    if (experience === 'race') setInteractiveMode(true);
    else if (experience === 'comparison' || experience === 'replay' || track.distanceMeters > 3500) setInteractiveMode(false);
    setSelectedVehicleId(playerVehicleId || vehicles[0]?.id || '');
    setCameraMode(experience === 'replay' || experience === 'legacy' ? 'automatica' : 'arcade');
  }, [track.distanceMeters, experience, playerVehicleId]);
  const roadPath = useMemo(() => makeRoadPath(track), [track.cityCircuitId, track.distanceMeters, track.laps]);
  const [liveVehicleStates, setLiveVehicleStates] = useState<Record<string, { lateralX?: number, distance: number, speedKmh: number, accelG: number, gear: number, rpm: number, impacts: number, slip: number, pothole: boolean, absActive: boolean, tcsActive?: boolean, escActive?: boolean, aebActive?: boolean, fcwWarning?: boolean, laneDepartureWarning?: boolean }>>({});
  const [raceEvent, setRaceEvent] = useState('');
  const [seatbeltBuckled, setSeatbeltBuckled] = useState(false);
  const [activeSpeedZone, setActiveSpeedZone] = useState<SpeedLimitZone | null>(null);
  const [upcomingTrafficLight, setUpcomingTrafficLight] = useState<(TrafficLightLiveState & { distanceToStopM: number }) | null>(null);
  const [blindSpotState, setBlindSpotState] = useState<BlindSpotFlankState>({
    equipped: false,
    leftAlert: false,
    rightAlert: false,
    leftDistanceM: null,
    rightDistanceM: null,
  });
  const [trafficNotice, setTrafficNotice] = useState<TrafficRuleNotice | null>(null);
  const [splashHudActive, setSplashHudActive] = useState(false);
  const lastNoticeSeqRef = useRef(0);
  const lastSplashSeqRef = useRef(0);
  const splashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buckleSeatbelt = () => {
    soundEngine.unlock();
    soundEngine.playSeatbeltClick();
    physicsRef.current?.setSeatbeltBuckled(true);
    setSeatbeltBuckled(true);
  };
  const [isGlbLoading, setIsGlbLoading] = useState<boolean>(() => vehicles.some((v) => hasVehicle3DModel(v.id)));
  const [loadedVehicleModels, setLoadedVehicleModels] = useState(0);
  const requiredVehicleModels = vehicles.filter(v => hasVehicle3DModel(v.id)).length;
  const [glbLoadError, setGlbLoadError] = useState<string | null>(null);
  const raceGateReady = canStartCountdown({sceneRendered: visualReady, loadedModels: loadedVehicleModels, requiredModels: requiredVehicleModels, modelError: false});
  const isPreloading = !raceGateReady;

  // Métricas de diagnóstico en tiempo real (GPU / Engine)
  const [diagStats, setDiagStats] = useState({
    fps: 60,
    frameTimeMs: 16.6,
    drawCalls: 0,
    triangles: 0,
  });

  // Referencias para el render loop de Three.js (evita pausas por re-render de React)
  const stateRef = useRef({
    isPlaying: false,
    currentTimeSec: 0,
    playbackSpeed: experience === 'legacy' ? 0.75 : 1,
    cameraMode: (experience === 'replay' || experience === 'legacy' ? 'automatica' : 'arcade') as CameraViewMode,
    countdown: null as number | null,
    hasFinished: false,
    selectedVehicleId: playerVehicleId || vehicles[0]?.id || '',
    steeringDemoDeg: 0,
    headlightsOn: true,
    showVehicleLabels: true,
    maxRaceTimeSec: 15,
    interactiveMode: false,
  });

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    // El reloj del render loop es la fuente de verdad. No copiar el estado React:
    // los commits demorados podían volverlo atrás y producir tirones en la escena.
    stateRef.current.playbackSpeed = playbackSpeed;
    stateRef.current.cameraMode = cameraMode;
    stateRef.current.countdown = countdown;
    stateRef.current.hasFinished = hasFinished;
    stateRef.current.selectedVehicleId = selectedVehicleId;
    // La lectura del volante durante el render la controla stateRef directamente.
    // NO copiar el valor del HUD aquí: los re-renders pueden revertir pulsaciones.
    stateRef.current.headlightsOn = headlightsOn;
    stateRef.current.showVehicleLabels = showVehicleLabels;
    stateRef.current.interactiveMode = interactiveMode;
  }, [isPlaying, playbackSpeed, cameraMode, countdown, hasFinished, selectedVehicleId, headlightsOn, interactiveMode, showVehicleLabels]);

  // El usuario cambia clima en caliente sin reiniciar el WebGL ni la carrera.
  useEffect(() => {
    weatherModeRef.current = weatherMode;
    physicsRef.current?.setWeather(weatherMode);
    soundEngine.setWeather(weatherMode);
  }, [weatherMode]);

  // Duración máxima de la prueba oficial
  const maxRaceTimeSec = useMemo(() => {
    return simulationResults.length > 0
      ? Math.max(...simulationResults.map((r) => r.finishTimeSec))
      : 15;
  }, [simulationResults]);

  useEffect(() => {
    stateRef.current.maxRaceTimeSec = maxRaceTimeSec;
  }, [maxRaceTimeSec]);

  /**
   * MUESTREO ULTRAFLUIDO CON INTERPOLACIÓN CONTINUA (FASE 1)
   * Elimina completamente los saltos discretos muestreando continuamente entre
   * muestras físicas oficiales mediante búsqueda binaria O(log N) y LERP suave.
   */
  const getInterpolatedVehicleState = (vId: string, time: number) => {
    const result = simulationResults.find((r) => r.vehicle.id === vId);
    if (!result || result.telemetryHistory.length === 0) {
      return {
        distance: 0,
        speedKmh: 0,
        accelG: 0,
        gear: 1,
        rpm: 1000,
        isBraking: false,
        brakeIntensity: 0, absActive: false, brakeSlip: 0,
        outOfFuel: false,
      };
    }

    const history = result.telemetryHistory;
    
    // Antes del primer instante
    if (time <= history[0].timeSec) {
      const s0 = history[0];
      return {
        distance: s0.distanceMeters,
        speedKmh: s0.speedKmh,
        accelG: s0.accelerationG,
        gear: s0.gear,
        rpm: s0.rpm,
        isBraking: s0.isBraking || false,
        brakeIntensity: s0.brakeIntensity ?? 0, absActive: s0.absActive ?? false, brakeSlip: s0.brakeSlip ?? 0,
        outOfFuel: s0.outOfFuel || false,
      };
    }

    // Después del último instante (meta alcanzada)
    const sLast = history[history.length - 1];
    if (time >= sLast.timeSec) {
      return {
        distance: sLast.distanceMeters,
        speedKmh: sLast.speedKmh,
        accelG: sLast.accelerationG,
        gear: sLast.gear,
        rpm: sLast.rpm,
        isBraking: sLast.isBraking || false,
        brakeIntensity: sLast.brakeIntensity ?? 0, absActive: sLast.absActive ?? false, brakeSlip: sLast.brakeSlip ?? 0,
        outOfFuel: sLast.outOfFuel || false,
      };
    }

    // Búsqueda binaria O(log N) para localizar el intervalo temporal exacto [prev, next]
    let low = 0;
    let high = history.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (history[mid].timeSec <= time) {
        if (mid === history.length - 1 || history[mid + 1].timeSec > time) {
          low = mid;
          break;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const prev = history[low];
    const next = history[Math.min(low + 1, history.length - 1)];

    const dt = next.timeSec - prev.timeSec;
    const alpha = dt > 0.00001 ? Math.min(1.0, Math.max(0.0, (time - prev.timeSec) / dt)) : 0;

    // Interpolación continua que garantiza desplazamiento suave sin escalones discretos
    const distance = prev.distanceMeters + alpha * (next.distanceMeters - prev.distanceMeters);
    const speedKmh = prev.speedKmh + alpha * (next.speedKmh - prev.speedKmh);
    const accelG = prev.accelerationG + alpha * (next.accelerationG - prev.accelerationG);
    const rpm = Math.round(prev.rpm + alpha * (next.rpm - prev.rpm));
    const gear = alpha > 0.5 ? next.gear : prev.gear;
    const isBraking = alpha > 0.5 ? next.isBraking : prev.isBraking;
    const outOfFuel = alpha > 0.5 ? next.outOfFuel : prev.outOfFuel;

    return {
      distance: Math.min(track.distanceMeters, distance),
      speedKmh,
      accelG,
      gear,
      rpm,
      isBraking: isBraking || false,
      brakeIntensity: (prev.brakeIntensity ?? 0) + alpha * ((next.brakeIntensity ?? 0) - (prev.brakeIntensity ?? 0)),
      absActive: alpha > .5 ? next.absActive ?? false : prev.absActive ?? false,
      brakeSlip: (prev.brakeSlip ?? 0) + alpha * ((next.brakeSlip ?? 0) - (prev.brakeSlip ?? 0)),
      outOfFuel: outOfFuel || false,
    };
  };

  /** Reproducción de la trayectoria que ocurrió realmente, NO nueva simulación. */
  const getReplayPose = (vehicleId: string, time: number) => {
    const history = simulationResults.find(result => result.vehicle.id === vehicleId)?.telemetryHistory ?? [];
    if (!history.length) return undefined;
    let low = 0, high = history.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (history[mid].timeSec <= time) low = mid;
      else high = mid - 1;
    }
    const a = history[low];
    const b = history[Math.min(history.length - 1, low + 1)];
    const ratio = b.timeSec > a.timeSec ? THREE.MathUtils.clamp((time - a.timeSec) / (b.timeSec - a.timeSec), 0, 1) : 0;
    const lerp = (key: 'lateralX' | 'yawRad' | 'steerRad' | 'slip' | 'bump') =>
      THREE.MathUtils.lerp(a[key] || 0, b[key] || 0, ratio);
    const wheelKeys = ['FL', 'FR', 'RL', 'RR'] as const;
    const wheelRoadM = Object.fromEntries(wheelKeys.map(k => [k, THREE.MathUtils.lerp(a.wheelRoadHeights?.[k] ?? 0, b.wheelRoadHeights?.[k] ?? 0, ratio)])) as { FL: number; FR: number; RL: number; RR: number };
    return { x: lerp('lateralX'), z: THREE.MathUtils.lerp(a.distanceMeters, b.distanceMeters, ratio),
      yaw: lerp('yawRad'), steer: lerp('steerRad'), slip: lerp('slip'), bump: lerp('bump'),
      suspension: { heaveM: THREE.MathUtils.lerp(a.suspensionHeaveM ?? 0, b.suspensionHeaveM ?? 0, ratio),
        pitchRad: THREE.MathUtils.lerp(a.suspensionPitchRad ?? 0, b.suspensionPitchRad ?? 0, ratio),
        rollRad: THREE.MathUtils.lerp(a.suspensionRollRad ?? 0, b.suspensionRollRad ?? 0, ratio),
        wheelRoadM, impact: lerp('bump') } };
  };

  // Cuenta regresiva cinemática al iniciar carrera o cambiar de circuito
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTimeSec(0);
    stateRef.current.currentTimeSec = 0;
    setHasFinished(false);
    setStuckInPothole(false);stuckRef.current={seconds:0,lastDistance:0};
    finalResultsRef.current = null;
    setLiveVehicleStates({});
    setRaceEvent('');
    setRaceInsight(null);
    setGoFlash(false);
    setSeatbeltBuckled(false);
    setTrafficNotice(null);
    setSplashHudActive(false);
    lastNoticeSeqRef.current = 0;
    lastSplashSeqRef.current = 0;
    insightSequenceRef.current = 0;
    lastUrgentInsightAtRef.current = 0;
    lastInsightIdRef.current = null;
    resultDeliveredRef.current = false;
    if (finishTimerRef.current !== null) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    if (experience === 'replay') {
      // Una repetición nunca empieza con cuenta regresiva ni modifica el motor físico.
      setCountdown(null);
      setIsPlaying(true);
      stateRef.current.isPlaying = true;
      return () => { soundEngine.stopAll(); };
    }
    // Si la compuerta de preparación aún no ha habilitado la largada o está precargando, esperar
    if (!startRequested || isPreloading) {
      setCountdown(null);
      stateRef.current.countdown = null;
      stateRef.current.isPlaying = false;
      return () => { soundEngine.stopAll(); };
    }
    // V11.2: cuenta regresiva de tres pasos COMPLETOS de 1 segundo.
    // En lugar de tres temporizadores absolutos (que se ejecutaban uno tras otro
    // al bloquearse el hilo principal en móviles lentos), cada paso programa el
    // siguiente solo DESPUÉS de que el anterior se haya mostrado.
    // Los pitidos y los cambios visuales nacen del mismo paso.
    let stopped = false;
    let stageTimer: ReturnType<typeof setTimeout> | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    const startStep = (step: 3 | 2 | 1 | 0) => {
      if (stopped) return;
      if (step > 0) {
        setCountdown(step);
        stateRef.current.countdown = step;
        stateRef.current.isPlaying = false;
        if (experience === 'race') soundEngine.playCountdownTone(step);
        stageTimer = setTimeout(() => startStep((step - 1) as 3 | 2 | 1 | 0), 1000);
        return;
      }
      // GO: desbloquear física y sonido en el mismo instante.
      setCountdown(null);
      setGoFlash(true);
      setIsPlaying(true);
      stateRef.current.isPlaying = true;
      stateRef.current.countdown = null;
      if (experience === 'race') {
        soundEngine.playCountdownTone(0);
        const chosen = vehicles.find(v => v.id === (playerVehicleId || vehicles[0]?.id));
        if (chosen) {
          const insight = initialRaceInsight(chosen);
          setRaceInsight(insight);
          lastInsightIdRef.current = insight.id;
        }
      }
      flashTimer = setTimeout(() => { if (!stopped) setGoFlash(false); }, 700);
    };
    // Una animación de React debe presentar la grilla antes del primer pitido.
    const firstFrame = requestAnimationFrame(() => startStep(3));
    return () => {
      stopped = true;
      cancelAnimationFrame(firstFrame);
      if (stageTimer !== null) clearTimeout(stageTimer);
      if (flashTimer !== null) clearTimeout(flashTimer);
      soundEngine.stopCountdownTones();
      if (finishTimerRef.current !== null) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
    };
  }, [track.id, vehicles, interactiveMode, hazardsEnabled, experience, restartSequence, manualStart, startRequested]);

  // Compuerta universal de preparación: precarga 3D -> pista y modelos listos -> 3, 2, 1.
  useEffect(() => {
    if (!raceGateReady || startRequested) return;
    const timer = window.setTimeout(() => {
      soundEngine.unlock();
      stateRef.current.isPlaying = false;
      setStartRequested(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [raceGateReady, startRequested]);

  // DATACAR V9.6: cápsulas educativas durante la carrera. Máximo una cada
  // 5,2 segundos, calculadas desde el auto real de esta partida, no desde
  // suposiciones de equipamiento ni mensajes aleatorios precargados.
  useEffect(() => {
    if (experience !== 'race') return;
    let lastImpactCount = 0;
    let lastPothole = false;
    const ticker = window.setInterval(() => {
      const physics = physicsRef.current;
      const car = physics?.getCar(selectedVehicleId);
      if (!car || !stateRef.current.isPlaying || stateRef.current.hasFinished ||
          stateRef.current.countdown !== null || physics!.playerFinished) return;
      if (Date.now() - lastUrgentInsightAtRef.current < 3900) return;
      const newCollision = car.impacts > lastImpactCount;
      const newPothole = car.pothole && !lastPothole;
      lastImpactCount = car.impacts;
      lastPothole = car.pothole;
      const next = nextRaceInsight(car.vehicle, {
        speedKmh: Math.abs(car.speed) * 3.6,
        accelG: car.acceleration / 9.80665,
        rpm: car.engineRpm,
        slip: car.slip,
        pothole: car.pothole,
        impacts: car.impacts,
        absActive: car.absActive,
        tcsActive: car.tcsActive,
        escActive: car.escActive,
        aebActive: car.aebActive,
        braking: car.braking,
      }, {
        throttle: steeringKeysRef.current.throttle ? 1 : 0,
        weather: weatherModeRef.current,
        elapsedSec: physics!.time,
        newCollision,
        newPothole,
      }, insightSequenceRef.current++, lastInsightIdRef.current);
      lastInsightIdRef.current = next.id;
      setRaceInsight(next);
    }, 5200);
    return () => window.clearInterval(ticker);
  }, [experience, selectedVehicleId]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    soundEngine.setMuted(next);
  };

  // Inicialización de la escena Three.js
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Detección de software GL para rendimiento óptimo
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const scene = new THREE.Scene();
    // Atmósfera de tarde clara para mostrar la pista y materiales en lugar de negro vacío.
    scene.background = new THREE.Color('#8498a8');
    scene.fog = new THREE.FogExp2('#8498a8', 0.0019);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // FOV vertical calibrado (48° desktop, 58° TikTok 9:16)
    const camera = new THREE.PerspectiveCamera(compact ? 58 : 48, width / height, 0.2, 900);
    camera.position.set(0, 3.2, -10.5);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    // El GLB segmentado aporta ~1,4 millones de tris por auto. Limitar DPR
    // recorta carga de fragmentos y estabiliza FPS en PCs y modo TikTok.
    const maxDpr = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, compact ? 1.0 : 1.3);
    let renderDpr = maxDpr;
    renderer.setPixelRatio(renderDpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    // Mapa de reflexión IBL estándar para los autos: se inyecta en los materiales de los autos
    // sin asignarse a scene.environment, preservando el asfalto oscuro y la atmósfera original del circuito.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const vehicleEnvTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;

    // Las sombras de contacto ya están dibujadas bajo cada auto. Evitar
    // renderizar tres carrocerías de alta densidad a un segundo shadow pass.
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    // Cámara libre de seguimiento: un clic+arrastre del mousepad/mouse cambia
    // la vista. Dos dedos (wheel horizontal) giran; vertical hace zoom.
    // El volante del teclado permanece independiente de la cámara.
    const orbit = { yaw: 0, pitch: 0.20, radius: 12 };
    const orbitPointer = { active: false, x: 0, y: 0 };
    let orbitInitialized = false;
    const enableOrbit = () => {
      if (stateRef.current.cameraMode !== 'libre') {
        orbitInitialized = false;
        stateRef.current.cameraMode = 'libre';
        setCameraMode('libre');
      }
      if (!orbitInitialized) {
        const focused = vehicleEntities.find(e => e.vehicle.id === stateRef.current.selectedVehicleId);
        const focus = new THREE.Vector3(
          focused?.group.position.x ?? 0, 1.05, focused?.group.position.z ?? 0,
        );
        const cameraOffset = camera.position.clone().sub(focus);
        orbit.yaw = Math.atan2(cameraOffset.x, -cameraOffset.z);
        orbit.pitch = THREE.MathUtils.clamp(
          Math.atan2(cameraOffset.y, Math.hypot(cameraOffset.x, cameraOffset.z)),
          0.04, 1.35,
        );
        orbit.radius = THREE.MathUtils.clamp(cameraOffset.length(), 6.0, 44);
        orbitInitialized = true;
      }
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (placementKindRef.current && physicsRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(pointer, camera);
        const collision = raycaster.intersectObject(road, false)[0];
        if (collision) {
          const local = roadPath.project(collision.point.x, collision.point.z);
          if (local.distance <= roadWidth / 2) {
            placeHazardAtRef.current?.(placementKindRef.current, local.lateral, local.s);
          }
          placementKindRef.current = null;
          setPlacementKind(null);
        }
        return;
      }
      orbitPointer.active = true;
      orbitPointer.x = event.clientX;
      orbitPointer.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!orbitPointer.active) return;
      const dx = event.clientX - orbitPointer.x;
      const dy = event.clientY - orbitPointer.y;
      orbitPointer.x = event.clientX;
      orbitPointer.y = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
      enableOrbit();
      orbit.yaw -= dx * 0.006;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.004, 0.04, 1.35);
    };
    const pointerUp = (event: PointerEvent) => {
      orbitPointer.active = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const wheelOrbit = (event: WheelEvent) => {
      // Los gestos de dos dedos del trackpad emiten wheel sin necesidad de hacer clic.
      event.preventDefault();
      enableOrbit();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
      const dx = event.deltaX * factor;
      const dy = event.deltaY * factor;
      if (event.shiftKey) {
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.0028, 0.04, 1.35);
      } else {
        orbit.yaw -= dx * 0.0045;
        orbit.radius = THREE.MathUtils.clamp(orbit.radius * Math.exp(dy * 0.0011), 6.0, 44);
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    renderer.domElement.addEventListener('wheel', wheelOrbit, { passive: false });

    // Flechas izquierda y derecha: dirección progresiva con autocentrado.
    // No capturamos las teclas si el usuario escribe en campos de texto.
    const isEditing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element && (element.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
    };
    const keyDown = (event: KeyboardEvent) => {
      if ((experience !== 'race' && experience !== 'legacy') || isEditing(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      if (event.code === 'KeyC') {
        event.preventDefault();
        soundEngine.unlock();
        soundEngine.playSeatbeltClick();
        physicsRef.current?.setSeatbeltBuckled(true);
        setSeatbeltBuckled(true);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Space'].includes(event.code)) {
        event.preventDefault();
        if (event.code === 'ArrowLeft') keyboardControlsRef.current.left = true;
        if (event.code === 'ArrowRight') keyboardControlsRef.current.right = true;
        if (event.code === 'ArrowUp' || event.code === 'KeyW') keyboardControlsRef.current.throttle = true;
        if (event.code === 'ArrowDown' || event.code === 'KeyS') keyboardControlsRef.current.reverse = true;
        if (event.code === 'Space') keyboardControlsRef.current.brake = true;
        keyboardSteeringRef.current = true;
        syncCombinedControls();
        soundEngine.unlock();
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft') keyboardControlsRef.current.left = false;
      if (event.code === 'ArrowRight') keyboardControlsRef.current.right = false;
      if (event.code === 'ArrowUp' || event.code === 'KeyW') keyboardControlsRef.current.throttle = false;
      if (event.code === 'ArrowDown' || event.code === 'KeyS') keyboardControlsRef.current.reverse = false;
      if (event.code === 'Space') keyboardControlsRef.current.brake = false;
      syncCombinedControls();
    };
    const releaseKeys = () => {
      keyboardControlsRef.current.left = false;
      keyboardControlsRef.current.right = false;
      keyboardControlsRef.current.throttle = false;
      keyboardControlsRef.current.reverse = false;
      keyboardControlsRef.current.brake = false;
      syncCombinedControls();
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', releaseKeys);

    // 2. Iluminación automotriz original equilibrada y luminosa
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.95);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight('#e0f2fe', '#64748b', 1.25);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
    keyLight.position.set(25, 40, -15);
    keyLight.castShadow = false;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#94a3b8', 1.1);
    fillLight.position.set(-25, 25, 20);
    scene.add(fillLight);

    // 3. Trazado de asfalto tridimensional con carriles y bordillos
    const trackLength = Math.max(track.distanceMeters + 120, 550);
    const roadWidth = 14.0;
    const trackGroup = new THREE.Group();

    // Superficie de asfalto con textura repetida
    const roadCenterZ = trackLength / 2 - 20;
    const roadGeo = roadPath.isCurved
      ? makeCurvedAsphalt(roadPath, roadWidth, trackLength, [])
      : createDepressedRoadGeometry(roadWidth, trackLength, roadCenterZ, []);
    const roadTex = createAsphaltTexture();
    roadTex.repeat.set(1, Math.round(trackLength / 18));
    const asphaltRelief = createAsphaltMicroRelief();
    asphaltRelief.repeat.copy(roadTex.repeat);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      bumpMap: asphaltRelief,
      bumpScale: .014,
      color: track.routeHazardProfile === 'flood' ? '#8ea8b9'
        : track.routeHazardProfile === 'cobbles' ? '#a6a3a7' : '#ffffff',
      roughness: track.routeHazardProfile === 'flood' ? 0.48 : 0.85,
      metalness: track.routeHazardProfile === 'flood' ? 0.2 : 0.1,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    if (!roadPath.isCurved) {
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0, roadCenterZ);
    }
    road.receiveShadow = !isSoftwareGl;
    trackGroup.add(road);

    // Bordillos de carrera rojo y blanco en los bordes
    const kerbWidth = 0.85;
    const kerbGeo = new THREE.PlaneGeometry(kerbWidth, trackLength);
    const kerbTex = createKerbTexture();
    kerbTex.repeat.set(1, Math.round(trackLength / 4));
    const kerbMat = new THREE.MeshStandardMaterial({
      map: kerbTex,
      roughness: 0.6,
      metalness: 0.1,
    });

    const leftKerb = new THREE.Mesh(kerbGeo, kerbMat);
    leftKerb.rotation.x = -Math.PI / 2;
    leftKerb.position.set(-roadWidth / 2 - kerbWidth / 2, 0.01, trackLength / 2 - 20);
    if (!track.cityCircuitId) trackGroup.add(leftKerb);

    const rightKerb = new THREE.Mesh(kerbGeo, kerbMat);
    rightKerb.rotation.x = -Math.PI / 2;
    rightKerb.position.set(roadWidth / 2 + kerbWidth / 2, 0.01, trackLength / 2 - 20);
    if (!track.cityCircuitId) trackGroup.add(rightKerb);

    // Línea de salida (blanca en z = 0)
    const startLineGeo = new THREE.PlaneGeometry(roadWidth, 0.6);
    const startLineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const startLine = new THREE.Mesh(startLineGeo, startLineMat);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(0, 0.02, 0);
    trackGroup.add(startLine);

    // Línea de meta a cuadros (Checkered pattern en track.distanceMeters)
    const finishLineGeo = new THREE.PlaneGeometry(roadWidth, 2.4);
    const finishTex = createCheckeredFinishTexture();
    const finishLineMat = new THREE.MeshBasicMaterial({ map: finishTex });
    const finishLine = new THREE.Mesh(finishLineGeo, finishLineMat);
    finishLine.rotation.x = -Math.PI / 2;
    const finalRoadPoint = roadPath.world(track.distanceMeters, 0);
    finishLine.position.set(finalRoadPoint.x, 0.02, finalRoadPoint.z);
    trackGroup.add(finishLine);

    // Estructuras de pórticos
    const gantryMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.35,
      metalness: 0.75,
    });

    // Pórtico de salida con semáforos
    const gantryGroup = new THREE.Group();
    const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.2, 0.5), gantryMat);
    leftPost.position.set(-roadWidth / 2 - 1.0, 3.1, 0);
    gantryGroup.add(leftPost);

    const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.2, 0.5), gantryMat);
    rightPost.position.set(roadWidth / 2 + 1.0, 3.1, 0);
    gantryGroup.add(rightPost);

    const topTruss = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 3.0, 0.8, 0.6), gantryMat);
    topTruss.position.set(0, 6.2, 0);
    gantryGroup.add(topTruss);

    const lightBulbs: THREE.Mesh[] = [];
    for (let l = 0; l < 3; l++) {
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 16, 16),
        new THREE.MeshBasicMaterial({ color: '#ef4444' })
      );
      bulb.position.set((l - 1) * 0.85, 5.8, 0.35);
      gantryGroup.add(bulb);
      lightBulbs.push(bulb);
    }
    bendRoadsideGroup(gantryGroup, roadPath);
    trackGroup.add(gantryGroup);

    // Arco de llegada con cartel de meta
    const finishArchGroup = new THREE.Group();
    const finishPostLeft = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), gantryMat);
    finishPostLeft.position.set(-roadWidth / 2 - 1.0, 3.6, track.distanceMeters);
    finishArchGroup.add(finishPostLeft);

    const finishPostRight = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), gantryMat);
    finishPostRight.position.set(roadWidth / 2 + 1.0, 3.6, track.distanceMeters);
    finishArchGroup.add(finishPostRight);

    const finishTruss = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 3.2, 1.4, 0.8), gantryMat);
    finishTruss.position.set(0, 7.0, track.distanceMeters);
    finishArchGroup.add(finishTruss);

    const finishBannerGeo = new THREE.PlaneGeometry(roadWidth * 0.72, 1.15);
    const finishBannerTex = createDistanceSignTexture(`🏁 META ${track.distanceMeters}m`);
    const finishBannerMat = new THREE.MeshBasicMaterial({ map: finishBannerTex });
    const finishBanner = new THREE.Mesh(finishBannerGeo, finishBannerMat);
    finishBanner.position.set(0, 7.0, track.distanceMeters - 0.42);
    finishBanner.rotation.y = Math.PI;
    finishArchGroup.add(finishBanner);

    // Cartel posterior de meta visible desde la cámara frontal
    const finishBannerRear = new THREE.Mesh(finishBannerGeo, finishBannerMat);
    finishBannerRear.position.set(0, 7.0, track.distanceMeters + 0.42);
    finishArchGroup.add(finishBannerRear);
    bendRoadsideGroup(finishArchGroup, roadPath);
    trackGroup.add(finishArchGroup);

    // Señales kilométricas laterales (50m, 100m, 200m, etc.)
    const signIntervals = [50, 100, 200, 300, 400, 500, 600, 800].filter((d) => d < track.distanceMeters);
    signIntervals.forEach((dist) => {
      const signGroup = new THREE.Group();
      const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5), gantryMat);
      signPost.position.set(roadWidth / 2 + 1.5, 1.25, dist);
      signGroup.add(signPost);

      const signBoard = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 0.8),
        new THREE.MeshBasicMaterial({ map: createDistanceSignTexture(`${dist}m`) })
      );
      signBoard.position.set(roadWidth / 2 + 1.5, 2.2, dist);
      signBoard.rotation.y = -Math.PI / 2;
      signGroup.add(signBoard);
      bendRoadsideGroup(signGroup, roadPath);
      trackGroup.add(signGroup);
    });

    // Señalización, veredas, árboles y fachadas urbanas de bajo coste GPU.
    const urbanEnvironment = createUrbanTrackScenery(roadWidth, trackLength, track.routeHazardProfile, Boolean(track.cityCircuitId));
    bendRoadsideGroup(urbanEnvironment, roadPath);
    trackGroup.add(urbanEnvironment);
    // V9.3: viaductos elevados ficticios, con publicidad aplicada a los parapetos.
    // Los apoyos están fuera de la calzada y no alteran la física.
    if (track.cityCircuitId) {
      const viaducts = createDatacarViaducts3D(roadWidth, track.distanceMeters, track.routeHazardProfile);
      bendRoadsideGroup(viaducts, roadPath);
      trackGroup.add(viaducts);
    }
    if (track.cityCircuitId) {
      const { speedBumps } = getAsuncionStreetDetails(track.routeHazardProfile, track.distanceMeters);
      const raisedBumps = createSpeedBumps3D(roadWidth, speedBumps);
      bendRoadsideGroup(raisedBumps, roadPath);
      trackGroup.add(raisedBumps);
    }
    scene.add(trackGroup);
    const weatherVisuals = createWeatherVisuals3D(scene, track.distanceMeters, track.routeHazardProfile, roadPath);
    const initialRoadColor = roadMat.color.clone();
    let lastWeatherApplied: WeatherMode | null = null;

    // 3B. Modo de carrera interactiva: obstáculos con representación y colisión real.
    const racePhysics = interactiveMode
      ? new InteractiveRacePhysics(vehicles, track, stateRef.current.selectedVehicleId, hazardsEnabled, {
          urbanTrafficRules: experience === 'race',
        })
      : null;
    physicsRef.current = racePhysics;
    racePhysics?.setWeather(weatherModeRef.current);
    setHazardCount(racePhysics?.hazards.length ?? 0);
    const urbanTrafficVisuals = racePhysics?.urbanRulesEnabled
      ? createUrbanTrafficVisuals3D({
          roadPath,
          roadWidth,
          trackDistanceMeters: track.distanceMeters,
          laps: Math.max(1, track.laps ?? 1),
          lights: racePhysics.trafficLights,
          speedZones: racePhysics.speedZones,
          oncomingCount: racePhysics.oncomingCars.length,
        })
      : null;
    if (urbanTrafficVisuals) {
      scene.add(urbanTrafficVisuals.group);
      scene.add(urbanTrafficVisuals.splashGroup);
    }
    const hazardsGroup = new THREE.Group();
    hazardsGroup.name = 'obstaculos_fisicos';
    trackGroup.add(hazardsGroup);
    const hazardGeometry = new THREE.CylinderGeometry(0.67, 0.83, 1.25, 12);
    const barrelBodyMaterial = new THREE.MeshStandardMaterial({ color: '#e97825', roughness: .67, metalness: .1 });
    const barrelStripeMaterial = new THREE.MeshStandardMaterial({ color: '#eee8da', roughness: .72 });
    const potholeMaterial = new THREE.MeshStandardMaterial({ color: '#111821', roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 });
    const potholeVisualKit = createPotholeVisualKit(track.routeHazardProfile);
    // La calzada cambia de geometría SOLO si cambia el catálogo de baches.
    // ShapeGeometry deja huecos geométricos y el kit dibuja las paredes 17 cm más abajo.
    const updateRoadCutouts = (allHazards: readonly TrackHazard[]) => {
      const oldGeometry = road.geometry;
      road.geometry = roadPath.isCurved
        ? makeCurvedAsphalt(roadPath, roadWidth, trackLength, allHazards)
        : createDepressedRoadGeometry(roadWidth, trackLength, roadCenterZ, allHazards);
      oldGeometry.dispose();
    };
    updateRoadCutouts(experience === 'replay' ? (replayHazards ?? []) : (racePhysics?.hazards ?? []));
    const addHazardVisual = (hazard: TrackHazard) => {
      const visual = new THREE.Group();
      visual.name = `hazard_${hazard.kind}_${hazard.id}`;
      const hWorld = roadPath.world(hazard.z, hazard.x);
      visual.position.set(hWorld.x, 0, hWorld.z);
      visual.rotation.y = hWorld.yaw;
      if (hazard.kind === 'pothole') {
        visual.add(potholeVisualKit.create(hazard));
      } else {
        const barrel = new THREE.Mesh(hazardGeometry, barrelBodyMaterial);
        barrel.position.y = .66;
        visual.add(barrel);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(.70, .75, .21, 12), barrelStripeMaterial);
        stripe.position.y = .77;
        visual.add(stripe);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(.66, .66, .10, 12), potholeMaterial);
        cap.position.y = 1.3;
        visual.add(cap);
      }
      hazardsGroup.add(visual);
    };
    racePhysics?.hazards.forEach(addHazardVisual);
    if (experience === 'replay') replayHazards?.forEach(addHazardVisual);
    raceHazardsSnapshotRef.current = racePhysics?.hazards ?? [];
    placeHazardAtRef.current = (kind: HazardKind, x: number, z: number) => {
      const activePhysics = physicsRef.current;
      if (!activePhysics || !hazardsEnabled) return;
      const added = activePhysics.addHazard(kind, x, z);
      if (!added) {
        setRaceEvent('No se pudo colocar: cerca de otro obstáculo, la salida o la meta.');
        return;
      }
      addHazardVisual(added);
      if (added.kind === 'pothole') updateRoadCutouts(activePhysics.hazards);
      raceHazardsSnapshotRef.current = activePhysics.hazards.map(h => ({ ...h }));
      setHazardCount(activePhysics.hazards.length);
    };
    addVisualHazardRef.current = (kind: HazardKind) => {
      const activePhysics = physicsRef.current;
      if (!activePhysics || !hazardsEnabled) return;
      const player = activePhysics.getCar(stateRef.current.selectedVehicleId);
      const ahead = (player?.z || 0) + Math.max(35, (player?.speed || 12) * 1.6);
      const x = player ? Math.max(-4.8, Math.min(4.8, player.x + (kind === 'pothole' ? 0 : 2.6))) : 0;
      placeHazardAtRef.current?.(kind, x, ahead);
    };

    // Marcas de derrape instanciadas: un solo draw call, sin crear una malla por marca.
    const skidGeometry = new THREE.PlaneGeometry(.14, .82);
    const skidMaterial = new THREE.MeshBasicMaterial({
      color: '#070b11', transparent: true, opacity: .60,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const maxSkidMarks = 900;
    const skidMarks = new THREE.InstancedMesh(skidGeometry, skidMaterial, maxSkidMarks);
    skidMarks.count = 0;
    skidMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    skidMarks.frustumCulled = false;
    trackGroup.add(skidMarks);
    const _skidMatrix = new THREE.Matrix4();
    const _skidPosition = new THREE.Vector3();
    const _skidRotation = new THREE.Quaternion();
    const _skidScale = new THREE.Vector3(1, 1, 1);
    const _skidEuler = new THREE.Euler();
    let lastSkidTime = 0;
    let skidIndex = 0;

    // 4. Instanciar los tres competidores en 3D GLB (Reutilizando la geometría única en caché)
    const vehicleEntities: VehicleEntityRunner[] = [];
    let sceneDisposed = false;
    let completedModels = 0;
    setLoadedVehicleModels(0);
    setGlbLoadError(null);
    setIsGlbLoading(requiredVehicleModels > 0);
    vehicles.forEach((vehicle, idx) => {
      const entity = createVehicleEntity(
        vehicle,
        idx,
        vehicles.length,
        () => {
          if (sceneDisposed) return;
          completedModels += 1;
          setLoadedVehicleModels(completedModels);
          if (completedModels >= requiredVehicleModels) setIsGlbLoading(false);
        },
        (err) => {
          if (sceneDisposed) return;
          console.error(err);
          setGlbLoadError(`No se pudo cargar el modelo 3D de ${vehicle.name}`);
          setIsGlbLoading(false);
        },
        vehicleEnvTexture
      );
      entity.setNameplateVisible(stateRef.current.showVehicleLabels);
      scene.add(entity.group);
      vehicleEntities.push(entity);
    });

    // Director TV: cobertura de varias cámaras con corte frontal de llegada.
    let directorShot: DirectorShot | null = null;
    let previousEffectiveShot: string | null = null;
    let lastAutoMode = stateRef.current.cameraMode;

    // Loop de animación y sincronización física-visual ultrafluida
    let animationFrameId: number;
    let sceneReadyReported = false;
    let lastTime = performance.now();
    let lastUiSyncTime = performance.now();
    let frameCount = 0;
    let lastFpsCalcTime = performance.now();
    let slowFpsStreak = 0;
    let fastFpsStreak = 0;
    // La GPU puede sufrir con 4 GLB densos. Ajustar resolución, nunca la física.
    let lastDprChangeAt = 0;

    const _camTarget = new THREE.Vector3();
    const _desiredCamPos = new THREE.Vector3();
    const _smoothedCamTarget = new THREE.Vector3();
    let cameraTargetInitialized = false;
    let lastSteeringHudSync = 0;
    let physicsAccumulator = 0;
    const lastPhysicsPose = new Map<string, RenderPose>();
    let lastRoadImpactAudioAt = -Infinity;
    // Cámara de llegada: se activa cuando el JUGADOR cruza la línea, no al llegar el último rival.
    let finishCinematicStartedAt = -Infinity;
    let finishCarPose: { x:number; z:number; yaw:number } | null = null;
    const lastImpacts = new Map<string, number>();
    const lastBumps = new Map<string, boolean>();
    resetVisualRaceRef.current = () => {
      skidMarks.count = 0;
      skidIndex = 0;
      lastSkidTime = 0;
      physicsAccumulator = 0;
      lastPhysicsPose.clear();
      lastRoadImpactAudioAt = -Infinity;
      finishCinematicStartedAt = -Infinity;
      finishCarPose = null;
      lastImpacts.clear();
      lastBumps.clear();
      skidMarks.instanceMatrix.needsUpdate = true;
    };

    const tick = (now: number) => {
      // Evitar deltas negativos y saltos tras cambiar de pestaña/GPU stall.
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05);
      lastTime = now;

      // Cálculo de métricas de rendimiento (GPU / Engine)
      frameCount++;
      if (now - lastFpsCalcTime >= 850) {
        const measuredFps = Math.round((frameCount * 1000) / (now - lastFpsCalcTime));
        setDiagStats({
          fps: measuredFps,
          frameTimeMs: parseFloat((dt * 1000).toFixed(1)),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
        // Adaptación con histéresis (cambios espaciados): menos pixel fill
        // cuando el equipo no sostiene FPS, sin zoom ni saltos de cámara.
        if (!isSoftwareGl && now - lastDprChangeAt > 3800 && experience === 'race') {
          slowFpsStreak = measuredFps < 43 ? slowFpsStreak + 1 : 0;
          fastFpsStreak = measuredFps > 57 ? fastFpsStreak + 1 : 0;
          let nextDpr = renderDpr;
          if (slowFpsStreak >= 2) nextDpr = Math.max(0.8, renderDpr - 0.15);
          else if (fastFpsStreak >= 5) nextDpr = Math.min(maxDpr, renderDpr + 0.07);
          if (Math.abs(nextDpr - renderDpr) > 0.01) {
            renderDpr = nextDpr;
            renderer.setPixelRatio(renderDpr);
            lastDprChangeAt = now;
            slowFpsStreak = fastFpsStreak = 0;
          }
        }
        frameCount = 0;
        lastFpsCalcTime = now;
      }

      // Dirección con teclado: mantener pulsada una flecha lleva el volante
      // progresivamente a +/-30°, al soltar vuelve con amortiguación suave.
      if (keyboardSteeringRef.current || steeringKeysRef.current.left || steeringKeysRef.current.right) {
        const { left, right } = steeringKeysRef.current;
        const targetDeg = left === right ? 0 : left ? -30 : 30;
        const nextDeg = THREE.MathUtils.damp(
          stateRef.current.steeringDemoDeg, targetDeg,
          left || right ? 7.2 : 5.8, dt,
        );
        stateRef.current.steeringDemoDeg = Math.abs(nextDeg - targetDeg) < 0.07 ? targetDeg : nextDeg;
        if (!left && !right && Math.abs(stateRef.current.steeringDemoDeg) < 0.07) {
          keyboardSteeringRef.current = false;
          stateRef.current.steeringDemoDeg = 0;
        }
        if (now - lastSteeringHudSync > 90 || !keyboardSteeringRef.current) {
          setSteeringDemoDeg(Math.round(stateRef.current.steeringDemoDeg));
          lastSteeringHudSync = now;
        }
      }
      const { isPlaying, playbackSpeed, maxRaceTimeSec, countdown, cameraMode, selectedVehicleId } = stateRef.current;

      // Integración física a 100 Hz, independientemente de los FPS de GPU.
      // La carrera clásica precalculada permanece disponible como alternativa.
      const livePhysics = interactiveMode ? physicsRef.current : null;
      if (livePhysics) livePhysics.playerId = selectedVehicleId;
      if (isPlaying && countdown === null) {
        if (livePhysics) {
          physicsAccumulator = Math.min(.1, physicsAccumulator + dt * playbackSpeed);
          const input = {
            steer: steeringKeysRef.current.right === steeringKeysRef.current.left ? 0 :
              steeringKeysRef.current.right ? 1 : -1,
            throttle: steeringKeysRef.current.throttle ? 1 : 0,
            reverse: steeringKeysRef.current.reverse ? 1 : 0,
            brake: steeringKeysRef.current.brake ? 1 : 0,
          };
          // El deslizador sigue siendo válido para la dirección manual.
          if (!steeringKeysRef.current.left && !steeringKeysRef.current.right &&
              !keyboardSteeringRef.current && stateRef.current.steeringDemoDeg !== 0) {
            input.steer = stateRef.current.steeringDemoDeg / 30;
          }
          let steps = 0;
          while (physicsAccumulator >= PHYSICS_STEP && steps < 12 &&
            !(experience === 'race' ? livePhysics.playerFinished : livePhysics.finished)) {
            // Snapshot justo ANTES del último paso: luego interpolaremos la
            // imagen sin tocar estados oficiales ni resultados de colisiones.
            for (const c of livePhysics.cars) lastPhysicsPose.set(c.id, snapshotRenderPose(c));
            livePhysics.step(PHYSICS_STEP, input);
            physicsAccumulator -= PHYSICS_STEP;
            steps++;
          }
          if (livePhysics.time - lastSkidTime >= .085) {
            lastSkidTime = livePhysics.time;
            for (const car of livePhysics.cars) {
              if (car.slip < .36 || car.speed < 5) continue;
              for (const side of [-.74, .74]) {
                const localSkidX = car.x + Math.sin(car.yaw) * -1.36 + Math.cos(car.yaw) * side;
                const localSkidS = car.z + Math.cos(car.yaw) * -1.36 - Math.sin(car.yaw) * side;
                const skidWorld = roadPath.world(localSkidS, localSkidX);
                _skidPosition.set(skidWorld.x, .027, skidWorld.z);
                _skidEuler.set(-Math.PI / 2, car.yaw + skidWorld.yaw, 0, 'YXZ');
                _skidRotation.setFromEuler(_skidEuler);
                _skidMatrix.compose(_skidPosition, _skidRotation, _skidScale);
                skidMarks.setMatrixAt(skidIndex % maxSkidMarks, _skidMatrix);
                skidIndex++;
              }
            }
            skidMarks.count = Math.min(maxSkidMarks, skidIndex);
            skidMarks.instanceMatrix.needsUpdate = true;
          }
          // Un golpe de suspensión produce sonido solo cuando el terreno lo causa,
          // no al tocar el freno. 350ms de espera evitan un traqueteo artificial.
          const ownSuspension = livePhysics.getCar(selectedVehicleId)?.suspension;
          if (ownSuspension && ownSuspension.impact > .17 &&
              livePhysics.time - lastRoadImpactAudioAt > .30) {
            soundEngine.playSuspensionHit(.28 + ownSuspension.impact * .72);
            lastRoadImpactAudioAt = livePhysics.time;
          }
          if (livePhysics.lastWetSplash && livePhysics.lastWetSplash.seq !== lastSplashSeqRef.current) {
            const splash = livePhysics.lastWetSplash;
            lastSplashSeqRef.current = splash.seq;
            const wp = roadPath.world(splash.z, splash.x);
            urbanTrafficVisuals?.triggerSplash(wp.x, wp.z, splash.intensity);
            if (splash.carId === selectedVehicleId) {
              soundEngine.playWaterSplash(splash.intensity);
              setSplashHudActive(true);
              if (splashTimeoutRef.current !== null) clearTimeout(splashTimeoutRef.current);
              splashTimeoutRef.current = setTimeout(() => setSplashHudActive(false), 780);
            }
          }
          stateRef.current.currentTimeSec = livePhysics.time;
        } else {
          stateRef.current.currentTimeSec += dt * playbackSpeed;
        }
        const raceDone = livePhysics ? (experience === 'race' ? livePhysics.playerFinished : livePhysics.finished) :
          stateRef.current.currentTimeSec >= maxRaceTimeSec + 0.5;
        if (raceDone && !stateRef.current.hasFinished) {
          if (!livePhysics) stateRef.current.currentTimeSec = maxRaceTimeSec;
          stateRef.current.isPlaying = false;
          stateRef.current.hasFinished = true;
          setIsPlaying(false);
          setHasFinished(true);
          if (livePhysics) finalResultsRef.current = livePhysics.makeResults(simulationResults);
          if (experience === 'race') {
            finishCinematicStartedAt = now;
            const finishedEntity = vehicleEntities.find(e => e.vehicle.id === stateRef.current.selectedVehicleId);
            finishCarPose = finishedEntity ? {x:finishedEntity.group.position.x,z:finishedEntity.group.position.z,yaw:finishedEntity.group.rotation.y}:null;
            setRaceEvent(''); // No cubrir la toma de tu auto con mensajes de llegada.
            setRaceInsight(null);
          }
          // Antes se cortaban motores y muestras instantáneamente,
          // generando clics/zumbidos al cruzar la meta.
          // Silenciar todos los motores al cruzar meta. El travelling posterior es visual.
          soundEngine.stopAll(0.08);
          // Llegada sin ovación: conservar únicamente el fundido del motor.
          if (finishTimerRef.current !== null) clearTimeout(finishTimerRef.current);
          finishTimerRef.current = setTimeout(() => {
            finishTimerRef.current = null;
            if (!resultDeliveredRef.current && stateRef.current.hasFinished) {
              resultDeliveredRef.current = true;
              onFinishRace(finalResultsRef.current ?? undefined, raceHazardsSnapshotRef.current.map(h => ({ ...h })), weatherModeRef.current);
            }
          }, 4000);
        }
        if (timeDisplayRef.current) timeDisplayRef.current.textContent = `${stateRef.current.currentTimeSec.toFixed(2)}s`;
        if (now - lastUiSyncTime >= 180) {
          const uiDeltaSeconds = Math.min(0.4, Math.max(0, (now - lastUiSyncTime) / 1000));
          setCurrentTimeSec(stateRef.current.currentTimeSec);
          if (livePhysics) {
            const player = experience === 'race' ? livePhysics.getCar(selectedVehicleId) : null;
            if (player && !stuckInPothole && !livePhysics.playerFinished) {
              const state=stuckRef.current;
              const motion=Math.abs(player.z-state.lastDistance);
              const nearPothole=livePhysics.hazards.some(h=>h.kind==='pothole' && Math.hypot(h.x-player.x,h.z-player.z)<h.radius+1.15);
              const isTrapped=(player.pothole||nearPothole) && Math.abs(player.speed)*3.6<4 && motion<.4 && (steeringKeysRef.current.throttle||steeringKeysRef.current.reverse);
              state.seconds=isTrapped?state.seconds+uiDeltaSeconds:0;
              state.lastDistance=player.z;
              if(state.seconds>=6){setStuckInPothole(true);setIsPlaying(false);stateRef.current.isPlaying=false;}
            }
            setPotholeWarning(player && !livePhysics.playerFinished
              ? findUpcomingPothole(livePhysics.hazards, player, player.vehicle.dimensions.widthMm / 1000)
              : null);
            if (livePhysics.urbanRulesEnabled && player && !livePhysics.playerFinished) {
              setSeatbeltBuckled(livePhysics.seatbeltBuckled);
              setActiveSpeedZone(livePhysics.getActiveSpeedZone(player.z));
              setUpcomingTrafficLight(livePhysics.getUpcomingTrafficLight(player.z, 135));
              setBlindSpotState(livePhysics.getBlindSpotState(selectedVehicleId));
              const notice = livePhysics.lastTrafficNotice;
              if (notice && notice.seq !== lastNoticeSeqRef.current) {
                lastNoticeSeqRef.current = notice.seq;
                setTrafficNotice(notice);
                if (notice.kind === 'penalty' || notice.kind === 'warning') {
                  soundEngine.playTrafficWarningTone(notice.kind === 'penalty');
                }
              } else if (notice && livePhysics.time - notice.createdAtSec > 4.2) {
                setTrafficNotice(prev => (prev?.seq === notice.seq ? null : prev));
              }
            }
            const snapshot: typeof liveVehicleStates = {};
            for (const car of livePhysics.cars) {
              const kmh = Math.abs(car.speed) * 3.6;
              snapshot[car.id] = {
                distance: car.z, lateralX: car.x, speedKmh: kmh, accelG: car.acceleration / 9.80665,
                gear: simulatedGear(car.vehicle,car.speed),
                rpm: Math.round(car.engineRpm),
                impacts: car.impacts, slip: car.slip, pothole: car.pothole, absActive: car.absActive, tcsActive: car.tcsActive, escActive: car.escActive, aebActive: car.aebActive, fcwWarning: car.fcwWarning, laneDepartureWarning: car.laneDepartureWarning,
              };
              if (car.impacts > (lastImpacts.get(car.id) || 0)) {
                setRaceEvent(`💥 ${car.vehicle.name}: choque y pérdida de velocidad`);
                if (car.id === selectedVehicleId) {
                  soundEngine.playImpact(.85);
                  const event = nextRaceInsight(car.vehicle, {
                    speedKmh: kmh, accelG: car.acceleration / 9.80665, rpm: car.engineRpm,
                    slip: car.slip, pothole: car.pothole, impacts: car.impacts,
                    absActive: car.absActive, tcsActive: car.tcsActive, escActive: car.escActive,
                    aebActive: car.aebActive, braking: car.braking,
                  }, {throttle: 0, weather: weatherModeRef.current, elapsedSec: livePhysics.time, newCollision: true}, 0);
                  setRaceInsight(event);
                  lastInsightIdRef.current = event.id;
                  lastUrgentInsightAtRef.current = Date.now();
                }
              }
              if (car.pothole && !lastBumps.get(car.id)) {
                setRaceEvent(`⚠ ${car.vehicle.name}: bache, baja la velocidad`);
                // El golpe ya lo genera la suspensión según su velocidad e intensidad.
                if (car.id === selectedVehicleId && Date.now() - lastUrgentInsightAtRef.current > 2200) {
                  const event = nextRaceInsight(car.vehicle, {
                    speedKmh: kmh, accelG: car.acceleration / 9.80665, rpm: car.engineRpm,
                    slip: car.slip, pothole: car.pothole, impacts: car.impacts,
                    absActive: car.absActive, tcsActive: car.tcsActive, escActive: car.escActive,
                    aebActive: car.aebActive, braking: car.braking,
                  }, {throttle: 0, weather: weatherModeRef.current, elapsedSec: livePhysics.time, newPothole: true}, 0);
                  setRaceInsight(event);
                  lastInsightIdRef.current = event.id;
                  lastUrgentInsightAtRef.current = Date.now();
                }
              }
              lastImpacts.set(car.id, car.impacts);
              lastBumps.set(car.id, car.pothole);
            }
            setLiveVehicleStates(snapshot);
          }
          lastUiSyncTime = now;
        }
        vehicles.forEach(v => {
          const liveCar = livePhysics?.getCar(v.id);
          const st = liveCar ? {
            rpm: Math.round(liveCar.engineRpm),
            speedKmh: Math.abs(liveCar.speed) * 3.6, isBraking: liveCar.braking,
            brakeIntensity: liveCar.brakeIntensity, absActive: liveCar.absActive, brakeSlip: liveCar.brakeSlip,
          } : getInterpolatedVehicleState(v.id, stateRef.current.currentTimeSec);
          soundEngine.updateTelemetry(v, st.rpm, st.speedKmh, st.isBraking, v.id === selectedVehicleId,
            liveCar?.slip ?? 0, v.id === selectedVehicleId && steeringKeysRef.current.throttle ? 1 : 0,
            st.brakeIntensity, st.absActive, st.brakeSlip);
        });
      } else if (!stateRef.current.hasFinished) {
        vehicles.forEach(v => soundEngine.updateTelemetry(v, 900, 0, false, false));
      }

      // Semáforos en pórtico
      if (countdown !== null) {
        if (countdown === 0) {
          lightBulbs.forEach((b) => (b.material as THREE.MeshBasicMaterial).color.set('#10b981'));
        } else {
          lightBulbs.forEach((b) => (b.material as THREE.MeshBasicMaterial).color.set('#ef4444'));
        }
      } else {
        lightBulbs.forEach((b) => (b.material as THREE.MeshBasicMaterial).color.set('#10b981'));
      }

      // Calcular posiciones ultrafluidas de cada vehículo
      let minZ = Infinity;
      let maxZ = -Infinity;
      let sumZ = 0;
      let sumX = 0;
      let leaderDist = 0;
      let leaderX = 0;

      const interpolationAlpha = livePhysics && isPlaying && !stateRef.current.hasFinished
        ? THREE.MathUtils.clamp(physicsAccumulator / PHYSICS_STEP, 0, 1) : 1;
      vehicleEntities.forEach((entity) => {
        const car = livePhysics?.getCar(entity.vehicle.id);
        const visualPose = car ? interpolateRenderPose(lastPhysicsPose.get(car.id), car, interpolationAlpha) : undefined;
        const recorded = experience === 'replay' ? getReplayPose(entity.vehicle.id, stateRef.current.currentTimeSec) : undefined;
        const state = car ? {
          distance: visualPose!.z,
          speedKmh: Math.abs(visualPose!.speed) * 3.6,
          accelG: car.acceleration / 9.80665,
          isBraking: car.braking,
          outOfFuel: false,
        } : getInterpolatedVehicleState(entity.vehicle.id, stateRef.current.currentTimeSec);
        const steeringAngle = car ? -visualPose!.steer : recorded ? -recorded.steer :
          entity.vehicle.id === stateRef.current.selectedVehicleId
            ? THREE.MathUtils.degToRad(stateRef.current.steeringDemoDeg) : 0;
        entity.updateState(state.distance, state.speedKmh, state.accelG,
          state.isBraking, camera.position, state.outOfFuel,
          steeringAngle, dt,
          car ? { x: visualPose!.x, z: visualPose!.z, yaw: visualPose!.yaw, slip: visualPose!.slip, bump: visualPose!.bump, suspension: visualPose!.suspension } : recorded ? { x: recorded.x, z: recorded.z, yaw: recorded.yaw, slip: recorded.slip, bump: recorded.bump, suspension: recorded.suspension } : undefined,
        );
        // Mismo trazado en física, GLB, cámara, minimapa y repetición.
        // Los datos del motor físico conservan coordenadas Frenet (s, lateral).
        const localLateral = car ? visualPose!.x : recorded ? recorded.x : entity.group.position.x;
        const globalPose = roadPath.world(state.distance, localLateral);
        entity.group.position.x = globalPose.x;
        entity.group.position.z = globalPose.z;
        entity.group.rotation.y += globalPose.yaw;
        entity.setNameplateVisible(stateRef.current.showVehicleLabels);
        entity.setHeadlights(stateRef.current.headlightsOn,
          entity.vehicle.id === stateRef.current.selectedVehicleId);
        if (state.distance < minZ) minZ = state.distance;
        if (state.distance > maxZ) {
          maxZ = state.distance;
          leaderDist = state.distance;
          leaderX = entity.group.position.x;
        }
        sumZ += state.distance;
        sumX += entity.group.position.x;
      });

      // Travelling de llegada: el vehículo avanza despacio después de cruzar meta,
      // sin reescribir física ni telemetría. La cámara frontal lo sigue.
      if (experience === 'race' && stateRef.current.hasFinished && finishCarPose) {
        const entity = vehicleEntities.find(e => e.vehicle.id === stateRef.current.selectedVehicleId);
        if (entity) {
          // Travelling uniforme durante los cuatro segundos del cierre.
          // La velocidad visual es ~18 km/h; nunca se frena hasta detenerse
          // en la imagen de meta. No modifica el resultado ni reanuda el motor.
          const elapsed = Math.max(0, (now - finishCinematicStartedAt) / 1000);
          const advance = Math.min(elapsed, 4) * 5;
          entity.group.position.x = finishCarPose.x + Math.sin(finishCarPose.yaw) * advance;
          entity.group.position.z = finishCarPose.z + Math.cos(finishCarPose.yaw) * advance;
          // El desplazamiento posterior a meta es solo visual: animar también las
          // ruedas con esos metros extra sin modificar la distancia de carrera.
          entity.advanceFinishWheelRotation?.(advance);
        }
      }
      const count = vehicleEntities.length || 1;
      const centerZ = (minZ + maxZ) / 2;
      const avgZ = sumZ / count;
      const avgX = sumX / count;
      const spreadZ = maxZ - minZ;
      const selectedEntity = vehicleEntities.find(e => e.vehicle.id === selectedVehicleId);
      const selectedX = selectedEntity?.group.position.x ?? avgX;

      // DIRECTOR CINEMATOGRÁFICO: planos de salida, persecución,
      // laterales cruzados, helicóptero y frontal fija de llegada.
      const finishDist = track.distanceMeters;
      const automaticDirector = cameraMode === 'automatica';
      if (automaticDirector) directorShot = chooseDirectorShot(leaderDist, finishDist);
      // La toma frontal de META es un cierre del juego, NO Director TV en vivo.
      const isFinishCinematic = experience === 'race' && stateRef.current.hasFinished;
      const effectiveShot = isFinishCinematic ? 'frontal_meta' : (automaticDirector ? directorShot! : cameraMode);
      if (lastAutoMode !== cameraMode) {
        previousEffectiveShot = null;
        lastAutoMode = cameraMode;
      }
      if (cameraMode === 'libre' && !orbitInitialized) enableOrbit();
      if (cameraMode !== 'libre' && !orbitPointer.active) orbitInitialized = false;

      let targetSmoothRate = 10;
      let wantedFov = compact ? 58 : 48;
      const broadcastSide = roadWidth * 0.5 + (compact ? 4.5 : 6);
      const selectedZ = selectedEntity?.group.position.z ?? centerZ;
      const currentWeather = weatherModeRef.current;
      weatherVisuals.update(currentWeather, dt, selectedX, selectedZ);
      const activeUrbanPhysics = interactiveMode ? physicsRef.current : null;
      urbanTrafficVisuals?.update(
        activeUrbanPhysics?.time ?? stateRef.current.currentTimeSec,
        dt,
        activeUrbanPhysics?.oncomingCars ?? [],
      );
      if (currentWeather !== lastWeatherApplied) {
        lastWeatherApplied = currentWeather;
        const wet = WEATHER_CONFIG[currentWeather].roadWetness;
        roadMat.roughness = THREE.MathUtils.lerp(.87, .42, wet);
        roadMat.metalness = THREE.MathUtils.lerp(.04, .15, wet);
        roadMat.color.copy(initialRoadColor).lerp(new THREE.Color('#556575'), wet * .57);
        keyLight.intensity = currentWeather === 'storm' || currentWeather === 'flood' ? 1.25 : 2.1;
        hemiLight.intensity = currentWeather === 'storm' || currentWeather === 'flood' ? .82 : 1.15;
        roadMat.needsUpdate = true;
      }

      switch (effectiveShot) {
        case 'grilla_frontal': {
          targetSmoothRate = 6;
          wantedFov = compact ? 65 : 53;
          _desiredCamPos.set(avgX * 0.22, 2.0, Math.max(19, leaderDist + 17));
          _camTarget.set(avgX, 1.05, avgZ);
          break;
        }
        case 'arcade': {
          // Cámara de conducción arcade inspirada en juegos de carreras:
          // a ras de carretera, con distancia, mirada y FOV ajustados a la velocidad.
          // Damping estable; sin vibraciones aleatorias.
          const own = livePhysics?.getCar(selectedVehicleId);
          const yaw = selectedEntity?.group.rotation.y ?? 0;
          const speed = Math.abs(own?.speed ?? 0) * 3.6;
          const speed01 = THREE.MathUtils.clamp(speed / 145, 0, 1);
          const forwardX = Math.sin(yaw);
          const forwardZ = Math.cos(yaw);
          // Mantener siempre una silueta grande en pantalla: el FOV cambia poco.
          // No transmitir la aceleración vertical de suspensión a la cámara.
          const chaseDistance = (compact ? 5.5 : 6.0) + speed01 * .48;
          const hazardLookahead = own ? findUpcomingPothole(livePhysics?.hazards ?? [], own,
            own.vehicle.dimensions.widthMm / 1000) : null;
          const roadVisibility = hazardLookahead ? potholeCameraCue(hazardLookahead.distanceM) : 0;
          // Leve elevación de perspectiva cuando un bache importante se acerca.
          // NO modificamos la distancia trasera: conserva el auto grande en pantalla.
          const camHeight = (compact ? 1.85 : 2.0) + speed01 * .12 + roadVisibility * .23;
          targetSmoothRate = 8.2;
          wantedFov = (compact ? 62 : 61) + speed01 * 5;
          const slipSway = own ? THREE.MathUtils.clamp(own.lateralSpeed * .13, -.38, .38) : 0;
          _desiredCamPos.set(selectedX - forwardX * chaseDistance + Math.cos(yaw) * slipSway,
            camHeight, selectedZ - forwardZ * chaseDistance - Math.sin(yaw) * slipSway);
          _camTarget.set(selectedX + forwardX * (5.8 + speed01 * 1.2), 1.3 - roadVisibility * .16,
            selectedZ + forwardZ * (5.8 + speed01 * 1.2));
          break;
        }
        case 'trasera': {
          if (experience !== 'race') {
            // Comparar y repeticiones siguen mostrando la grilla completa.
            targetSmoothRate = 9;
            const fullGridDist = THREE.MathUtils.clamp((compact ? 9 : 11) + spreadZ * 0.14, 8, 17);
            _desiredCamPos.set(selectedX * 0.55 + avgX * 0.45, compact ? 2.8 : 2.45, centerZ - fullGridDist);
            _camTarget.set(selectedX * 0.55 + avgX * 0.45, 1.18, centerZ + 6);
            break;
          }
          // CÁMARA DEL JUGADOR, TERCERA PERSONA (inspiración de juegos arcade).
          // Antes seguía el centro de todos los autos: cuando el jugador se
          // retrasaba o giraba, su vehículo quedaba pequeño o fuera de plano.
          // Ahora SIEMPRE anclamos el seguimiento al root físico del auto elegido.
          const ownCar = livePhysics?.getCar(selectedVehicleId);
          const carYaw = selectedEntity?.group.rotation.y ?? 0;
          const forwardX = Math.sin(carYaw);
          const forwardZ = Math.cos(carYaw);
          const speedKmh = ownCar ? ownCar.speed * 3.6 : 0;
          // Distancia fija respecto del auto: evitar zoom impredecible cuando
          // otros competidores se alejan o se acercan.
          const chaseDist = compact ? 5.7 : 6.3;
          const hazardLookahead = ownCar ? findUpcomingPothole(livePhysics?.hazards ?? [], ownCar,
            ownCar.vehicle.dimensions.widthMm / 1000) : null;
          const roadVisibility = hazardLookahead ? potholeCameraCue(hazardLookahead.distanceM) : 0;
          const chaseHeight = (compact ? 2.05 : 2.15) + roadVisibility * .22;
          const lookAhead = compact ? 5.0 : 6.3;
          targetSmoothRate = 9.5;
          wantedFov = THREE.MathUtils.clamp((compact ? 58 : 54) + speedKmh * 0.027, 54, compact ? 63 : 60);
          _desiredCamPos.set(
            selectedX - forwardX * chaseDist,
            chaseHeight,
            selectedZ - forwardZ * chaseDist,
          );
          _camTarget.set(
            selectedX + forwardX * lookAhead,
            1.25 - roadVisibility * .15,
            selectedZ + forwardZ * lookAhead,
          );
          break;
        }
        case 'persecucion_baja': {
          // Plano de conjunto para las repeticiones cinematográficas.
          targetSmoothRate = 9;
          const followDist = THREE.MathUtils.clamp((compact ? 9 : 11) + spreadZ * 0.14, 8, 17);
          _desiredCamPos.set(selectedX * 0.55 + avgX * 0.45, compact ? 2.8 : 2.45, centerZ - followDist);
          _camTarget.set(selectedX * 0.55 + avgX * 0.45, 1.18, centerZ + 6);
          break;
        }
        case 'lateral':
        case 'lateral_izquierda':
        case 'lateral_derecha': {
          // Cámara lateral vinculada al auto seleccionado, NO a la media de
          // los rivales. Trabaja en coordenadas mundiales y acompaña curvas.
          const yaw = selectedEntity?.group.rotation.y ?? 0;
          const side = effectiveShot === 'lateral_derecha' ? 1 : -1;
          const rightX = Math.cos(yaw);
          const rightZ = -Math.sin(yaw);
          const forwardX = Math.sin(yaw);
          const forwardZ = Math.cos(yaw);
          const sideDistance = compact ? 8.2 : 9.4;
          targetSmoothRate = 9.2;
          wantedFov = compact ? 51 : 46;
          // Si el auto está en la grilla de largada (|z| < 5m), adelantar levemente la cámara
          // lateral para que el pilar del semáforo/pórtico (z=0) no corte el plano de visión.
          const startGantryOffset = Math.abs(selectedZ) < 5 ? 2.6 : 0;
          _desiredCamPos.set(
            selectedX + side * rightX * sideDistance - forwardX * (2.2 - startGantryOffset),
            compact ? 2.55 : 2.75,
            selectedZ + side * rightZ * sideDistance - forwardZ * (2.2 - startGantryOffset),
          );
          _camTarget.set(selectedX + forwardX * 0.7, 1.35, selectedZ + forwardZ * 0.7);
          break;
        }
        case 'cenital':
        case 'cenital_dinamica': {
          // Pose en coordenadas de mundo: seguir al vehículo elegido sin
          // referencias indefinidas ni transformar dos veces las curvas.
          const carYaw = selectedEntity?.group.rotation.y ?? roadPath.at(0).yaw;
          const forwardX = Math.sin(carYaw);
          const forwardZ = Math.cos(carYaw);
          targetSmoothRate = 7.2;
          wantedFov = compact ? 50 : 44;
          const topHeight = compact ? 19 : 23;
          const behind = 3.2;
          const ahead = compact ? 3.8 : 5.0;
          _desiredCamPos.set(
            selectedX - forwardX * behind,
            topHeight,
            selectedZ - forwardZ * behind,
          );
          _camTarget.set(
            selectedX + forwardX * ahead,
            0.9,
            selectedZ + forwardZ * ahead,
          );
          break;
        }
        case 'libre': {
          targetSmoothRate = 11;
          _camTarget.set(selectedX, 1.03, selectedZ);
          const cosPitch = Math.cos(orbit.pitch);
          _desiredCamPos.set(
            selectedX + orbit.radius * cosPitch * Math.sin(orbit.yaw),
            1.03 + orbit.radius * Math.sin(orbit.pitch),
            selectedZ - orbit.radius * cosPitch * Math.cos(orbit.yaw),
          );
          break;
        }
        case 'frontal_seguimiento': {
          targetSmoothRate = 7.5;
          wantedFov = compact ? 63 : 53;
          const ahead = THREE.MathUtils.clamp(13 + spreadZ * 0.2, 12, 19);
          _desiredCamPos.set(avgX * 0.26, 1.9, leaderDist + ahead);
          _camTarget.set(avgX, 1.12, centerZ - 0.8);
          break;
        }
        case 'frontal_meta': {
          if (isFinishCinematic) {
            // Cámara respecto del auto y su rumbo mundial real (incluidas curvas).
            // Antes se utilizaba finishDist como Z global y se perdía el vehículo.
            const p = THREE.MathUtils.clamp((now - finishCinematicStartedAt) / 3750, 0, 1);
            const carYaw = selectedEntity?.group.rotation.y ?? roadPath.at(finishDist).yaw;
            const shot = finishCameraPose(selectedX, selectedZ, carYaw, p, compact);
            targetSmoothRate = 11;
            wantedFov = shot.fov;
            _desiredCamPos.set(shot.camera.x, shot.camera.y, shot.camera.z);
            _camTarget.set(shot.target.x, shot.target.y, shot.target.z);
          } else {
            // Director TV de las repeticiones: todos los competidores de frente.
            targetSmoothRate = 11;
            wantedFov = compact ? 65 : 55;
            const frontZ = Math.max(finishDist + 12, leaderDist + 12);
            _desiredCamPos.set(avgX * 0.20, compact ? 2.1 : 1.9, frontZ);
            _camTarget.set(avgX, 1.04, centerZ - Math.min(2, spreadZ * 0.15));
          }
          break;
        }
        default: {
          _desiredCamPos.set(avgX, 3, centerZ - 10);
          _camTarget.set(avgX, 1.2, centerZ + 5);
        }
      }

      // Director TV opera en posiciones globales. Sus planos procedentes del
      // antiguo eje Z se reorientan sobre la tangente del circuito curvo.
      // Arcade, tercera persona y libre ya utilizan la posición mundial del GLB.
      if (roadPath.isCurved && !(isFinishCinematic && effectiveShot === 'frontal_meta') && !['arcade', 'trasera', 'libre', 'lateral', 'lateral_izquierda', 'lateral_derecha', 'cenital', 'cenital_dinamica'].includes(effectiveShot)) {
        const frameX = roadPath.at(centerZ).x;
        const cameraAt = roadPath.world(_desiredCamPos.z, _desiredCamPos.x - frameX);
        const targetAt = roadPath.world(_camTarget.z, _camTarget.x - frameX);
        _desiredCamPos.x = cameraAt.x;
        _desiredCamPos.z = cameraAt.z;
        _camTarget.x = targetAt.x;
        _camTarget.z = targetAt.z;
      }

      // Resguardo: una coordenada inválida nunca debe bloquear el render 3D.
      // Se regresa a una vista detrás del coche si una pose falla.
      if (![ _desiredCamPos.x, _desiredCamPos.y, _desiredCamPos.z,
              _camTarget.x, _camTarget.y, _camTarget.z ].every(Number.isFinite)) {
        const yaw = selectedEntity?.group.rotation.y ?? 0;
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        _desiredCamPos.set(selectedX - fx * 7, 3, selectedZ - fz * 7);
        _camTarget.set(selectedX + fx * 5, 1.2, selectedZ + fz * 5);
      }

      // Cortes de televisión auténticos. El damping entre cámaras opuestas
      // cruzaba la pista y daba la impresión de saltos y colisiones.
      const cut = previousEffectiveShot !== effectiveShot;
      if (cut) {
        camera.position.copy(_desiredCamPos);
        _smoothedCamTarget.copy(_camTarget);
        cameraTargetInitialized = true;
        camera.fov = wantedFov;
        camera.updateProjectionMatrix();
        previousEffectiveShot = effectiveShot;
      } else if (Math.abs(camera.fov - wantedFov) > 0.02) {
        camera.fov = THREE.MathUtils.damp(camera.fov, wantedFov, 5, dt);
        camera.updateProjectionMatrix();
      }

      // AMORTIGUACIÓN ESTABLE E INDEPENDIENTE DE FPS: factor = 1 - exp(-lambda * dt)
      camera.position.x = THREE.MathUtils.damp(camera.position.x, _desiredCamPos.x, targetSmoothRate, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, _desiredCamPos.y, targetSmoothRate, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, _desiredCamPos.z, targetSmoothRate, dt);

      // CRÍTICO: antes la posición tenía damping pero lookAt seguía el blanco
      // sin suavizado, originando microtemblores visibles al acelerar/seguir.
      if (!cameraTargetInitialized) {
        _smoothedCamTarget.copy(_camTarget);
        cameraTargetInitialized = true;
      } else {
        _smoothedCamTarget.x = THREE.MathUtils.damp(_smoothedCamTarget.x, _camTarget.x, 9, dt);
        _smoothedCamTarget.y = THREE.MathUtils.damp(_smoothedCamTarget.y, _camTarget.y, 9, dt);
        _smoothedCamTarget.z = THREE.MathUtils.damp(_smoothedCamTarget.z, _camTarget.z, 9, dt);
      }
      camera.lookAt(_smoothedCamTarget);

      renderer.render(scene, camera);
      if (!sceneReadyReported) { sceneReadyReported = true; setVisualReady(true); }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    // Ajuste responsivo de ventana
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    const viewportResizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) handleResize();
    }) : null;
    viewportResizeObserver?.observe(container);
    requestAnimationFrame(handleResize);

    return () => {
      sceneDisposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      viewportResizeObserver?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('wheel', wheelOrbit);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', releaseKeys);
      releaseKeys();
      if (finishTimerRef.current !== null) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
      physicsRef.current = null;
      addVisualHazardRef.current = null;
      placeHazardAtRef.current = null;
      resetVisualRaceRef.current = null;
      vehicleEntities.forEach((ent) => ent.dispose());
      skidGeometry.dispose();
      skidMaterial.dispose();
      hazardGeometry.dispose();
      barrelBodyMaterial.dispose();
      barrelStripeMaterial.dispose();
      potholeMaterial.dispose();
      potholeVisualKit.dispose();
      urbanEnvironment.userData.disposeTextureMaps?.();
      weatherVisuals.dispose();
      if (splashTimeoutRef.current !== null) {
        clearTimeout(splashTimeoutRef.current);
        splashTimeoutRef.current = null;
      }
      urbanTrafficVisuals?.dispose();
      roadTex.dispose();
      kerbTex.dispose();
      trackGroup.traverse((obj) => {
        if (obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      asphaltRelief.dispose();
      vehicleEnvTexture.dispose();
      roomEnv.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
    };
  }, [track.id, vehicles, compact, track.distanceMeters, interactiveMode, hazardsEnabled, experience, replayHazards, roadPath]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (interactiveMode) return; // No se puede retroceder una simulación física acumulativa.
    const val = parseFloat(e.target.value);
    setCurrentTimeSec(val);
    stateRef.current.currentTimeSec = val;
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = `${val.toFixed(2)}s`;
    }
  };

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0];
  const selectedVehicleState = selectedVehicle
    ? interactiveMode && liveVehicleStates[selectedVehicle.id]
      ? liveVehicleStates[selectedVehicle.id]
      : getInterpolatedVehicleState(selectedVehicle.id, currentTimeSec)
    : null;

  const cycleCameraMode = () => {
    const modes: CameraViewMode[] = ['arcade', 'trasera', 'lateral', 'cenital', 'libre'];
    const currentIndex = modes.indexOf(cameraMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setCameraMode(nextMode);
    stateRef.current.cameraMode = nextMode;
  };

  const totalCars = vehicles.length || 8;
  const totalLaps = Math.max(1, track.laps ?? 1);

  const playerRank = useMemo(() => {
    if (!selectedVehicle || !liveVehicleStates[selectedVehicle.id]) return 2;
    const playerDist = liveVehicleStates[selectedVehicle.id].distance;
    let ahead = 0;
    for (const [id, st] of Object.entries(liveVehicleStates)) {
      if (id !== selectedVehicle.id && st.distance > playerDist) {
        ahead++;
      }
    }
    return 1 + ahead;
  }, [selectedVehicle, liveVehicleStates]);

  const currentLap = useMemo(() => {
    if (!selectedVehicle || !liveVehicleStates[selectedVehicle.id] || !track) return 1;
    const dist = liveVehicleStates[selectedVehicle.id].distance;
    const lapDist = Math.max(1, track.distanceMeters / totalLaps);
    return Math.min(totalLaps, Math.max(1, Math.floor(dist / lapDist) + 1));
  }, [selectedVehicle, liveVehicleStates, track, totalLaps]);

  const dynamicDrivingFeedback = useMemo(() => {
    if (raceInsight?.message) return raceInsight.message;
    if (!selectedVehicleState) return '¡Buen ritmo! Mantén la velocidad.';
    if (selectedVehicleState.speedKmh > 140) return '¡Velocidad punta alcanzada! Sostené el trazado.';
    if (touchPressed.throttle || steeringKeysRef.current.throttle) return '¡Aceleración a pleno! Controlá la salida.';
    if (touchPressed.brake || steeringKeysRef.current.brake) return 'Frenado medido. Preparate para la curva.';
    if (touchPressed.left || touchPressed.right || steeringKeysRef.current.left || steeringKeysRef.current.right) return 'Viraje preciso. Mantén la línea ideal.';
    return '¡Buen ritmo! Mantén la velocidad.';
  }, [raceInsight, selectedVehicleState, touchPressed]);

  return (
    <div className={`relative bg-[#0a0f1d] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col select-none ${experience === 'race' ? 'dc-mobile-race' : ''}`}>
      {experience === 'race' && <button type="button" onClick={enableLandscape} className="dc-landscape-toggle" title="Pantalla completa horizontal"><Maximize2 size={16}/> <span>Modo horizontal</span></button>}
      {/* Top Header Bar: Track Specs + Camera Mode Switcher + Audio */}
      <div className="px-4 py-2.5 border-b border-slate-800/90 bg-slate-950/80 flex flex-wrap items-center justify-between gap-3 z-10">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
            <span className="text-sky-400 font-bold uppercase">{track.name}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">{track.distanceMeters}m</span>
            {track.inclineGradePercent > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400 font-bold">+{track.inclineGradePercent}% Pendiente</span>
              </>
            )}
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-400/30 px-2 py-0.5 rounded font-bold">
              3D GLB · Vehículos
            </span>
            <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-400/30 px-2 py-0.5 rounded">
              Modelos 3D provisionales para Kicks y Carens
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">{track.subtitle}</p>
        </div>

        {/* View Switcher, Diagnostics & Audio */}
        <div className="flex items-center gap-2 flex-wrap">
          {onSwitchTo2D && (
            <button
              onClick={onSwitchTo2D}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-mono transition-colors"
              title="Cambiar a Vista 2D Cenital"
            >
              <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Vista 2D</span>
            </button>
          )}

          {/* Las etiquetas aéreas se ocultan en conducción para despejar la pista. */}
          <button
            type="button"
            onClick={() => setShowVehicleLabels(value => !value)}
            aria-pressed={showVehicleLabels}
            title="Mostrar u ocultar etiquetas flotantes sobre los vehículos"
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${showVehicleLabels ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'}`}
          >
            Nombres {showVehicleLabels ? 'ON' : 'OFF'}
          </button>

          {/* Toggle Diagnóstico GPU / FPS */}
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className={`p-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1 ${
              showDiagnostics
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Telemetría y Diagnóstico de Rendimiento"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">{diagStats.fps} FPS</span>
          </button>

          <button
            onClick={toggleMute}
            className={`p-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1 ${
              isMuted
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-slate-900 border-slate-700 text-sky-400 hover:bg-slate-800'
            }`}
            title={isMuted ? 'Activar sonido motor' : 'Silenciar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="hidden sm:inline">{isMuted ? 'Muted' : 'Audio ON'}</span>
          </button>

          {experience === 'race' && (
            <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-700 bg-slate-900 text-sky-200 text-xs">
              <CloudRain className="w-4 h-4" />
              <span className="hidden sm:inline">Clima</span>
              <select aria-label="Elegir clima de la carrera" value={weatherMode}
                onChange={e => setWeatherMode(e.target.value as WeatherMode)}
                className="bg-slate-900 text-sky-200 text-xs font-bold outline-none cursor-pointer">
                {WEATHER_OPTIONS.map(opt => <option value={opt.id} key={opt.id}>{opt.label}</option>)}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={() => setHeadlightsOn(value => !value)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors ${
              headlightsOn
                ? 'bg-sky-500/15 border-sky-400/40 text-sky-200 hover:bg-sky-500/25'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
            title="Encender o apagar las ópticas delanteras y su iluminación sobre el asfalto"
            aria-pressed={headlightsOn}
          >
            {headlightsOn ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>Faros {headlightsOn ? 'ON' : 'OFF'}</span>
          </button>

          <div className="bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg text-center font-mono">
            <span className="text-[9px] text-slate-500 uppercase block leading-none">Tiempo Simulado</span>
            <span ref={timeDisplayRef} className="text-sm font-bold text-white tabular-nums">
              {currentTimeSec.toFixed(2)}s
            </span>
          </div>

          {hasFinished && experience === 'replay' && <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300">REPETICIÓN TERMINADA · Podés volver a reproducir</span>}
          {hasFinished && experience !== 'replay' && (
            <button
              onClick={() => {
                if (finishTimerRef.current !== null) {
                  clearTimeout(finishTimerRef.current);
                  finishTimerRef.current = null;
                }
                if (!resultDeliveredRef.current) {
                  resultDeliveredRef.current = true;
                  onFinishRace(finalResultsRef.current ?? undefined, raceHazardsSnapshotRef.current.map(h => ({ ...h })), weatherModeRef.current);
                }
              }}
              className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md shadow-emerald-600/30 animate-pulse"
            >
              <Award className="w-3.5 h-3.5" />
              <span>Resultados</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 3D Viewport with 100% Unobstructed Center */}
      <div className="dc-race-viewport relative w-full overflow-hidden bg-[#0a0f1d]" style={{ height: compact ? '350px' : experience === 'race' ? 'min(72vh, 720px)' : '520px', minHeight: compact ? undefined : experience === 'race' ? '520px' : undefined }}>
        {experience === 'race' && <div className="dc-portrait-prompt">
          <Smartphone size={42} aria-hidden="true" />
          <strong>Girá tu celular para correr</strong>
          <span>DATACAR ARENA se juega en horizontal con controles táctiles.</span>
          <button type="button" onClick={enableLandscape}><Maximize2 size={16}/> Intentar pantalla completa</button>
        </div>}
        <div ref={mountRef} className={`w-full h-full block touch-none ${placementKind ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`} />
        {experience === 'race' && <div className="dc-mobile-game-top" aria-label="Barra de juego">
          <span className="dc-mobile-track-name">{track.name}</span>
          <span className="dc-mobile-clock">{currentTimeSec.toFixed(1)} s</span>
          <button onClick={() => setMobileCameraOpen(v => !v)} aria-label="Elegir cámara"><Video size={19}/></button>
          <button onClick={() => { setIsPlaying(false); stateRef.current.isPlaying = false; setMobileMenuOpen(true); }} aria-label="Pausar y abrir menú"><Pause size={19}/></button>
        </div>}
        {experience === 'race' && mobileCameraOpen && <div className="dc-mobile-camera-menu">
          {([['arcade','Arcade'],['trasera','Mi auto'],['lateral','Lateral'],['cenital','Cenital'],['libre','Libre']] as const).map(([mode,label]) => <button key={mode} onClick={() => { setCameraMode(mode); setMobileCameraOpen(false); }}>{label}</button>)}
        </div>}
        {experience === 'race' && mobileMenuOpen && <div className="dc-mobile-pause-screen">
          <h2>PAUSA</h2><p>DATACAR ARENA</p>
          <button className="dc-mobile-resume" onClick={() => { soundEngine.unlock(); if(startRequested){setIsPlaying(true);stateRef.current.isPlaying=true;} setMobileMenuOpen(false); }}><Play size={18}/> CONTINUAR</button>
          <button onClick={toggleMute}>{isMuted ? 'Activar sonido' : 'Silenciar sonido'}</button>
          <button onClick={() => setHeadlightsOn(v => !v)}>{headlightsOn ? 'Apagar faros' : 'Encender faros'}</button>
          <button onClick={()=>{setMobileMenuOpen(false);setShowRaceInformation(true);}}>DATOS EN CARRERA / INFORMACIÓN</button>
          {onExitRace && <button onClick={onExitRace}>ABANDONAR CARRERA</button>}
          <label>CLIMA <select value={weatherMode} onChange={e => setWeatherMode(e.target.value as WeatherMode)}>{WEATHER_OPTIONS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
        </div>}

        {showRaceInformation && <div className="dc11-race-info-dialog" role="dialog" aria-label="Datos y telemetría educativa"><div><header><h2>DATACAR · DATOS EN CARRERA</h2><button onClick={()=>{setShowRaceInformation(false);setMobileMenuOpen(true);}}>CERRAR</button></header>{raceInsight?<><h3>{raceInsight.title}</h3><p>{raceInsight.message}</p></>:<p>La información educativa aparece conforme a los eventos de conducción y a las fichas de los vehículos.</p>}<p>Ficha técnica + telemetría virtual. No constituye una prueba oficial.</p><h3>MI AUTO</h3><p>{selectedVehicle?.brand} {selectedVehicle?.name}</p>{selectedVehicleState&&<p>{selectedVehicleState.speedKmh.toFixed(1)} km/h · {selectedVehicleState.rpm} RPM · {selectedVehicleState.accelG.toFixed(2)} G · {selectedVehicleState.distance.toFixed(1)} metros</p>}</div></div>}
        {experience === 'race' && stuckInPothole && <div className="dc12-stuck-modal" role="dialog" aria-modal="true" aria-label="Auto atrapado en bache"><div><h2>VEHÍCULO ATASCADO</h2><p>Caíste en un bache y el vehículo no logra salir. Podés reiniciar la carrera o volver a elegir auto y circuito.</p><button onClick={()=>{
          // El reinicio tiene que crear una sesión NUEVA. Cambiar solo el
          // temporizador deja el motor y la posición dentro del bache.
          soundEngine.stopAll();
          stateRef.current.isPlaying = false;
          if (onRestartRace) {
            onRestartRace(); // Mobile y desktop desmontan la escena anterior.
          } else {
            // Respaldo para integraciones que todavía no pasan el callback.
            const rebuilt = new InteractiveRacePhysics(vehicles, track, stateRef.current.selectedVehicleId, hazardsEnabled, {
              urbanTrafficRules: experience === 'race',
            });
            physicsRef.current = rebuilt;
            rebuilt.setWeather(weatherModeRef.current);
            raceHazardsSnapshotRef.current = rebuilt.hazards.map(h => ({...h}));
            resetVisualRaceRef.current?.();
            stuckRef.current = {seconds:0,lastDistance:0};
            setStuckInPothole(false);
            setCurrentTimeSec(0);
            stateRef.current.currentTimeSec = 0;
            setLiveVehicleStates({});
            setStartRequested(experience !== 'race');
            setRestartSequence(n=>n+1);
          }
        }}>REINICIAR CARRERA</button><button onClick={()=>{setStuckInPothole(false);onExitRace?.();}}>SALIR DE LA CARRERA</button></div></div>}
        {experience === 'race' && !startRequested && <div className="dc11-start-gate" role="status" aria-live="polite">
          <div className="dc11-start-card"><span>DATACAR ARENA · GRILLA DE SALIDA</span>
            <h2>{glbLoadError ? 'ERROR DE CARGA' : raceGateReady ? 'PREPARATE PARA LA LARGADA' : 'PREPARANDO PISTA Y AUTOS…'}</h2>
            {glbLoadError && (
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                <button type="button" onClick={() => onRestartRace?.()} className="rounded-lg bg-slate-800 border border-slate-600 px-4 py-2 font-bold text-white hover:bg-slate-700">REINTENTAR CARGA</button>
                <button type="button" onClick={() => { setGlbLoadError(null); setLoadedVehicleModels(requiredVehicleModels); }} className="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-950 hover:bg-amber-300">LARGAR CON RESCATE 3D</button>
              </div>
            )}
          </div>
        </div>}
        {experience === 'race' && !hasFinished && (
          <div className="dc-mobile-controls dc-mockup5-controls lg:hidden" aria-label="Controles táctiles de conducción">
            {/* Lado izquierdo: Botones biselados de dirección < y > en color cian brillante para el pulgar izquierdo */}
            <div className="dc-touch-steering">
              {touchButton(
                'left',
                'Izquierda',
                <div className="skew-x-[12deg] flex items-center justify-center pointer-events-none">
                  <ChevronLeft size={34} strokeWidth={3} className="text-white drop-shadow-[0_0_8px_#00e5ff]" />
                </div>,
                'dc-touch-rhomboid dc-touch-left'
              )}
              {touchButton(
                'right',
                'Derecha',
                <div className="skew-x-[12deg] flex items-center justify-center pointer-events-none">
                  <ChevronRight size={34} strokeWidth={3} className="text-white drop-shadow-[0_0_8px_#00e5ff]" />
                </div>,
                'dc-touch-rhomboid dc-touch-right'
              )}
            </div>

            {/* Lado derecho: Botón vertical alargado dorado con doble chevron >> para ACELERAR. Al lado, botón de FRENO (!) y botón de REVERSA R \/ */}
            <div className="dc-touch-pedals">
              {/* Botón de freno y botón de reversa apilados */}
              <div className="flex flex-col gap-2">
                {touchButton(
                  'brake',
                  'Freno',
                  <div className="flex flex-col items-center justify-center pointer-events-none">
                    <div className="flex items-center gap-0.5 text-white font-mono font-black text-sm tracking-tighter">
                      <span>(</span>
                      <AlertCircle size={14} className="text-amber-300" />
                      <span>)</span>
                    </div>
                    <div className="mt-1 flex gap-1 opacity-60">
                      <div className="w-1.5 h-0.5 bg-white -skew-x-[30deg]" />
                      <div className="w-1.5 h-0.5 bg-white -skew-x-[30deg]" />
                      <div className="w-1.5 h-0.5 bg-white -skew-x-[30deg]" />
                    </div>
                  </div>,
                  'dc-touch-brake dc-touch-brake-pedal'
                )}
                {touchButton(
                  'reverse',
                  'Frenar / reversa',
                  <div className="flex flex-col items-center justify-center pointer-events-none">
                    <span className="font-display font-black text-sm text-white tracking-wider leading-none">R</span>
                    <ChevronsDown size={14} className="text-cyan-300 -mt-0.5" />
                  </div>,
                  'dc-touch-reverse dc-touch-reverse-pedal'
                )}
              </div>

              {/* Botón vertical alargado dorado >> para ACELERAR */}
              {touchButton(
                'throttle',
                'Acelerar',
                <div className="flex flex-col items-center justify-between h-full py-2.5 pointer-events-none">
                  <ChevronsUp size={34} strokeWidth={3} className="text-[#ffb800] drop-shadow-[0_0_10px_#ffb800]" />
                  <div className="flex flex-col gap-1 items-center opacity-70">
                    <div className="w-6 h-0.5 bg-[#ffb800] -skew-x-[30deg]" />
                    <div className="w-6 h-0.5 bg-[#ffb800] -skew-x-[30deg]" />
                    <div className="w-6 h-0.5 bg-[#ffb800] -skew-x-[30deg]" />
                  </div>
                </div>,
                'dc-touch-throttle dc-touch-gold-throttle'
              )}
            </div>
          </div>
        )}

        {/* 1. ESQUINA SUPERIOR IZQUIERDA: Minimapa circular con borde cian brillante y píldora inferior POS / VUELTA */}
        {experience === 'race' && !hasFinished && selectedVehicle && liveVehicleStates[selectedVehicle.id] && (
          <RaceMiniMap
            path={roadPath}
            player={liveVehicleStates[selectedVehicle.id]}
            opponents={Object.entries(liveVehicleStates).map(([id, st]) => ({ id, distance: st.distance, lateralX: st.lateralX }))}
            playerId={selectedVehicle.id}
            playerRank={playerRank}
            totalCars={totalCars}
            currentLap={currentLap}
            totalLaps={totalLaps}
          />
        )}

        {/* 2. CENTRO SUPERIOR: Logo central DATACAR ARENA y Píldora de circuito (Circuito Costanera | tiempo) */}
        {experience === 'race' && !hasFinished && (
          <div className="dc-mockup5-center-header absolute top-2.5 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center select-none max-w-[360px]">
            {/* Logo Central: DATACAR /// ARENA */}
            <div className="flex items-center gap-1.5 px-3.5 py-0.5 bg-black/60 backdrop-blur-md rounded-t-lg border-t border-x border-cyan-500/30">
              <span className="font-display font-black italic text-[13px] sm:text-[15px] tracking-wider text-white">DATACAR</span>
              <span className="font-display font-black italic text-[12px] sm:text-[14px] text-[#ffb800]">///</span>
              <span className="font-display font-black italic text-[13px] sm:text-[15px] tracking-wider text-[#ffb800]">ARENA</span>
            </div>
            <div className="w-28 sm:w-36 h-[2px] bg-gradient-to-r from-transparent via-[#00e5ff] to-transparent shadow-[0_0_8px_#00e5ff]" />

            {/* Píldora de circuito: MapPin + Circuito Costanera | Timer + 01:24.637 */}
            <div className="mt-1 flex items-center gap-2 sm:gap-2.5 px-3.5 py-1 bg-[#030914]/85 backdrop-blur-md border border-cyan-400/40 rounded-full shadow-[0_0_15px_rgba(0,229,255,0.25)] text-xs text-white">
              <div className="flex items-center gap-1 font-bold text-slate-100 text-[10px] sm:text-[11px] tracking-wide whitespace-nowrap">
                <MapPin size={12} className="text-[#00e5ff] shrink-0" />
                <span>{track?.name ?? 'Circuito Costanera'}</span>
              </div>
              <span className="text-cyan-400/50">|</span>
              <div className="flex items-center gap-1 font-mono font-black text-cyan-300 text-[11px] sm:text-[12px] tracking-wider tabular-nums">
                <Timer size={12} className="text-[#00e5ff] shrink-0" />
                <span>{formatRaceStopwatch(currentTimeSec)}</span>
              </div>
            </div>

            {/* Tarjetas viales de Límite MÁX / MÍN + Semáforo próximo + Cinturón de Seguridad */}
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 pointer-events-auto">
              {/* Tarjeta reglamentaria Velocidad MÁXIMA y MÍNIMA */}
              {activeSpeedZone && (() => {
                const curSpeed = selectedVehicleState?.speedKmh ?? 0;
                const overMax = curSpeed > activeSpeedZone.maxKmh + 5;
                const underMin = curSpeed > 4 && curSpeed < activeSpeedZone.minKmh - 4 && (!upcomingTrafficLight || upcomingTrafficLight.phase === 'green');
                return (
                  <div
                    className={`flex items-center gap-1.5 rounded-xl border px-2 py-1 bg-[#06101d]/95 shadow-lg ${
                      overMax
                        ? 'border-rose-400 ring-1 ring-rose-500/60'
                        : underMin
                          ? 'border-amber-400/80'
                          : 'border-slate-700/90'
                    }`}
                    aria-label={`Límite máximo ${activeSpeedZone.maxKmh} y mínimo ${activeSpeedZone.minKmh} kilómetros por hora`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-[2.5px] border-rose-500 bg-white text-[10px] font-black text-slate-950 tabular-nums leading-none">
                        {activeSpeedZone.maxKmh}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-rose-300 hidden sm:inline">
                        MÁX
                      </span>
                    </div>
                    <span className="h-4 w-[1px] bg-slate-700" />
                    <div className="flex items-center gap-1">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/85 bg-sky-600 text-[10px] font-black text-white tabular-nums leading-none">
                        {activeSpeedZone.minKmh}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-sky-300 hidden sm:inline">
                        MÍN
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Indicador de Semáforo Próximo */}
              {upcomingTrafficLight && upcomingTrafficLight.distanceToStopM >= -2 && (
                <div
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 bg-[#06101d]/95 shadow-lg text-[10px] font-black uppercase tracking-wide ${
                    upcomingTrafficLight.phase === 'red'
                      ? 'border-rose-500/90 text-rose-200'
                      : upcomingTrafficLight.phase === 'yellow'
                        ? 'border-amber-400/90 text-amber-200'
                        : 'border-emerald-500/70 text-emerald-200'
                  }`}
                >
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-950 px-1.5 py-0.5 border border-slate-800">
                    <span className={`h-2 w-2 rounded-full ${upcomingTrafficLight.phase === 'red' ? 'bg-rose-500 shadow-[0_0_6px_#f43f5e]' : 'bg-rose-950'}`} />
                    <span className={`h-2 w-2 rounded-full ${upcomingTrafficLight.phase === 'yellow' ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]' : 'bg-amber-950'}`} />
                    <span className={`h-2 w-2 rounded-full ${upcomingTrafficLight.phase === 'green' ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-emerald-950'}`} />
                  </span>
                  <span className="tabular-nums">
                    {Math.max(0, Math.round(upcomingTrafficLight.distanceToStopM))}m
                  </span>
                  <span>
                    {upcomingTrafficLight.phase === 'red'
                      ? '¡FRENÁ!'
                      : upcomingTrafficLight.phase === 'yellow'
                        ? 'PRECAUCIÓN'
                        : 'VERDE'}
                  </span>
                </div>
              )}

              {/* Botón interactivo de Cinturón de Seguridad [C] */}
              <button
                type="button"
                onClick={buckleSeatbelt}
                aria-pressed={seatbeltBuckled}
                title="Abrochar cinturón de seguridad (Tecla C)"
                className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                  seatbeltBuckled
                    ? 'border-emerald-500/65 bg-emerald-950/90 text-emerald-200'
                    : 'border-amber-400 bg-amber-950/95 text-amber-200 animate-pulse'
                }`}
              >
                <span>{seatbeltBuckled ? '✓ CINTURÓN OK' : '🔒 ABROCHAR CINTURÓN [C]'}</span>
              </button>
            </div>

            {/* Banner de aviso / penalización vial en vivo */}
            {trafficNotice && (
              <div
                role="status"
                className={`mt-1.5 rounded-xl border px-3 py-1 text-center shadow-xl pointer-events-none ${
                  trafficNotice.kind === 'penalty'
                    ? 'border-rose-400 bg-rose-950/95 text-rose-100'
                    : trafficNotice.kind === 'ok'
                      ? 'border-emerald-400 bg-emerald-950/95 text-emerald-100'
                      : 'border-amber-400 bg-amber-950/95 text-amber-100'
                }`}
              >
                <div className="text-[11px] font-black uppercase tracking-wide">
                  {trafficNotice.title}
                </div>
                <div className="text-[10px] font-medium opacity-90">
                  {trafficNotice.subtitle}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2B. SENSORES ADAS DE PUNTO CIEGO LATERAL (IZQUIERDA / DERECHA — solo modelos con ADAS verificado) */}
        {experience === 'race' && !hasFinished && selectedVehicle && hasVerifiedBlindSpotAdas(selectedVehicle) && (
          <>
            <div
              aria-live="polite"
              className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-30 flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-opacity duration-150 ${
                blindSpotState.leftAlert
                  ? 'border-amber-300 bg-amber-950/95 text-amber-200 opacity-100 shadow-[0_0_20px_rgba(251,191,36,0.65)]'
                  : 'border-cyan-500/25 bg-[#050f1d]/80 text-slate-400 opacity-55'
              }`}
            >
              <span
                className={`h-3.5 w-3.5 rounded-full ${
                  blindSpotState.leftAlert
                    ? 'bg-amber-400 shadow-[0_0_12px_#fbbf24] animate-ping'
                    : 'bg-slate-600'
                }`}
              />
              <div className="leading-tight">
                <div className="text-[9px] font-black uppercase tracking-widest">
                  ◀ ADAS IZQ
                </div>
                <div className="text-[10px] font-mono font-bold tabular-nums">
                  {blindSpotState.leftAlert
                    ? `AUTO ${blindSpotState.leftDistanceM ?? ''}m`
                    : 'LIBRE'}
                </div>
              </div>
            </div>

            <div
              aria-live="polite"
              className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 z-30 flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-opacity duration-150 ${
                blindSpotState.rightAlert
                  ? 'border-amber-300 bg-amber-950/95 text-amber-200 opacity-100 shadow-[0_0_20px_rgba(251,191,36,0.65)]'
                  : 'border-cyan-500/25 bg-[#050f1d]/80 text-slate-400 opacity-55'
              }`}
            >
              <div className="leading-tight text-right">
                <div className="text-[9px] font-black uppercase tracking-widest">
                  ADAS DER ▶
                </div>
                <div className="text-[10px] font-mono font-bold tabular-nums">
                  {blindSpotState.rightAlert
                    ? `AUTO ${blindSpotState.rightDistanceM ?? ''}m`
                    : 'LIBRE'}
                </div>
              </div>
              <span
                className={`h-3.5 w-3.5 rounded-full ${
                  blindSpotState.rightAlert
                    ? 'bg-amber-400 shadow-[0_0_12px_#fbbf24] animate-ping'
                    : 'bg-slate-600'
                }`}
              />
            </div>
          </>
        )}

        {/* 2C. EFECTO VISUAL DE SALPICADURA DE AGUA EN PARABRISAS AL CAER EN BACHE MOJADO */}
        {experience === 'race' && !hasFinished && splashHudActive && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-32 z-20 flex items-end justify-center pb-20 bg-[radial-gradient(ellipse_at_25%_95%,rgba(125,211,252,0.34),transparent_48%),radial-gradient(ellipse_at_75%_95%,rgba(125,211,252,0.34),transparent_48%)]"
          >
            <span className="rounded-full border border-sky-300/60 bg-sky-950/90 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-200">
              💦 Salpicadura en calzada mojada
            </span>
          </div>
        )}

        {/* 5. CENTRO INFERIOR: Píldora flotante translúcida de Driving IQ con feedback dinámico */}
        {experience === 'race' && !hasFinished && (
          <div className="dc-mockup5-driving-iq absolute bottom-3.5 md:bottom-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none select-none max-w-[min(420px,calc(100vw-540px))]">
            <div className="flex items-center gap-2 px-3.5 sm:px-4 py-1.5 bg-[#030914]/90 backdrop-blur-md border border-[#00e5ff]/50 rounded-full shadow-[0_0_18px_rgba(0,229,255,0.35)] text-white w-full overflow-hidden">
              <Gauge size={15} className="text-[#00e5ff] shrink-0 drop-shadow-[0_0_5px_#00e5ff]" />
              <span className="text-[11px] sm:text-xs font-semibold text-slate-100 tracking-wide truncate">
                {dynamicDrivingFeedback}
              </span>
            </div>
          </div>
        )}

        {/* Alertas de asistencia activa */}
        {experience === 'race' && !hasFinished && selectedVehicle && (
          <div className="absolute top-4 right-4 z-20 pointer-events-none flex flex-col items-end gap-1 font-mono text-[10px] font-bold">
            {liveVehicleStates[selectedVehicle.id]?.fcwWarning && !liveVehicleStates[selectedVehicle.id]?.aebActive && <span className="rounded-md border border-amber-400 bg-amber-500/20 px-2 py-1 text-amber-100">ALERTA DE COLISIÓN</span>}
            {liveVehicleStates[selectedVehicle.id]?.laneDepartureWarning && <span className="rounded-md border border-amber-400 bg-amber-500/20 px-2 py-1 text-amber-100">ALERTA DE CARRIL</span>}
            {liveVehicleStates[selectedVehicle.id]?.aebActive && <span className="rounded-md border border-red-400 bg-red-500/20 px-2 py-1 text-red-200">FRENADO AUTOMÁTICO</span>}
          </div>
        )}

        {/* 3. ESQUINA SUPERIOR DERECHA: Botones de cámara y pausa en cristal oscuro + Tacómetro/Velocímetro digital arcade */}
        {experience === 'race' && !hasFinished && selectedVehicle && selectedVehicleState && (
          <>
            <div className="dc-mobile-speed-wrapper lg:hidden">
              <Mockup5SpeedCluster
                speedKmh={selectedVehicleState.speedKmh}
                rpm={selectedVehicleState.rpm}
                gear={selectedVehicleState.gear}
                onCycleCamera={cycleCameraMode}
                onPause={() => {
                  soundEngine.unlock();
                  setMobileMenuOpen(true);
                  setIsPlaying(false);
                  stateRef.current.isPlaying = false;
                }}
                onOpenDetailed={() => setShowDetailedHud(true)}
              />
            </div>
            <div className="dc11-desktop-hud hidden lg:block"><ArcadeRaceHud vehicle={selectedVehicle} state={selectedVehicleState}/></div>
            {showDetailedHud && <div className="dc11-hud-backdrop" role="dialog" aria-label="Telemetría extendida">
              <button className="dc11-hud-close" onClick={()=>setShowDetailedHud(false)}><X size={17}/> VOLVER A CARRERA</button>
              <div className="dc11-hud-gauge"><ArcadeRaceHud vehicle={selectedVehicle} state={selectedVehicleState}/></div>
              <p>VELOCIDAD · RPM · MARCHA · ACELERACIÓN · ASISTENCIAS DOCUMENTADAS</p>
            </div>}
          </>
        )}
        {experience === 'race' && !hasFinished && countdown === null && raceInsight && (
          <div key={raceInsight.id} className={`dc100-race-insight absolute top-[260px] left-3 z-20 pointer-events-none w-[min(290px,calc(100%-24px))] rounded-xl border border-l-[3px] px-3 py-2.5 shadow-xl backdrop-blur-lg hidden md:block select-none ${
            raceInsight.kind === 'warning'
              ? 'border-amber-500/45 border-l-amber-400 bg-slate-950/85'
              : raceInsight.kind === 'event'
                ? 'border-emerald-500/45 border-l-emerald-400 bg-slate-950/85'
                : 'border-cyan-500/40 border-l-cyan-400 bg-slate-950/85'
          }`} aria-live="polite" aria-atomic="true">
            <div className="text-[9px] font-black uppercase tracking-[.2em] text-cyan-300">DATACAR · DATO EN CARRERA</div>
            <div className="mt-1 text-[11px] font-black uppercase tracking-wide text-white">{raceInsight.title}</div>
            <p className="mt-1 text-[11px] leading-snug text-slate-200">{raceInsight.message}</p>
            <div className="mt-1.5 text-[9px] text-slate-500">Ficha técnica + telemetría virtual · no ensayo oficial</div>
          </div>
        )}

        {/* ALERTA CENTRAL DE BACHE EN CALZADA (HUD Arcade Central) */}
        {experience === 'race' && !hasFinished && potholeWarning && (
          <div
            className="absolute top-20 sm:top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex flex-col items-center select-none"
            role="alert"
            aria-label="Advertencia de bache en la calzada"
          >
            <div className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-6 py-2 sm:py-2.5 rounded-2xl bg-gradient-to-r from-amber-950/90 via-red-950/95 to-amber-950/90 border-2 border-amber-400 shadow-[0_0_28px_rgba(245,158,11,0.7),inset_0_0_12px_rgba(239,68,68,0.35)] backdrop-blur-md animate-pulse">
              <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6 text-amber-300 shrink-0 drop-shadow-[0_0_8px_#f59e0b] animate-bounce" />
              <div className="flex flex-col text-left">
                <div className="flex items-center gap-2">
                  <span className="font-display font-black italic text-xs sm:text-sm tracking-wider text-amber-200 uppercase drop-shadow-[0_0_6px_rgba(245,158,11,0.8)]">
                    ¡BACHE EN CALZADA A {Math.round(potholeWarning.distanceM)}m!
                  </span>
                </div>
                <span className="text-[10px] sm:text-[11px] font-mono font-bold text-slate-200 tracking-wide">
                  Reducí velocidad o esquivalo por los lados
                </span>
              </div>
            </div>
          </div>
        )}

        <div className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 pointer-events-none px-3.5 py-1 text-[10px] text-slate-300 font-mono bg-slate-950/85 border border-slate-700/60 rounded-xl backdrop-blur-md shadow-lg hidden md:flex items-center gap-3 whitespace-nowrap select-none max-w-[90vw] overflow-x-auto`}>
          <span>{experience === 'race' ? '↑ Acelerar · ↓ Frenar / Reversa · Espacio Freno · ← → Dirección' : experience === 'replay' ? 'Director TV · repetición real' : 'Comparación automática'}</span>
          <span className="text-slate-600">•</span>
          <span>Arrastrá: cámara libre</span>
        </div>

        {/* Floating Diagnostics Panel (Toggleable) */}
        {showDiagnostics && (
          <div className="absolute top-14 right-3 z-30 bg-slate-950/90 backdrop-blur-md border border-slate-800 p-2.5 rounded-xl shadow-2xl font-mono text-[11px] text-slate-300 w-52 pointer-events-none">
            <div className="text-amber-400 font-bold mb-1 border-b border-slate-800 pb-1 flex items-center justify-between">
              <span>DIAGNÓSTICO 3D</span>
              <span className="text-emerald-400 font-bold">{diagStats.fps} FPS</span>
            </div>
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between"><span>Frame Time:</span><span className="text-white">{diagStats.frameTimeMs} ms</span></div>
              <div className="flex justify-between"><span>Draw Calls:</span><span className="text-white">{diagStats.drawCalls}</span></div>
              <div className="flex justify-between"><span>Triángulos:</span><span className="text-white">{(diagStats.triangles / 1000).toFixed(1)}k</span></div>
              <div className="flex justify-between"><span>Física:</span><span className="text-sky-400">{interactiveMode ? '100 Hz · Fuerzas / colisiones' : 'Replay telemetría'}</span></div>
              <div className="flex justify-between"><span>Modelos 3D:</span><span className="text-emerald-400">3x GLB Instanced</span></div>
            </div>
          </div>
        )}

        {/* Cinematic Countdown Overlay */}
        {(countdown !== null || goFlash) && (
          <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center animate-fadeIn pointer-events-none">
            <span className="text-xs font-mono font-bold text-sky-400 uppercase tracking-widest mb-1">
              GRILLA DE SALIDA · DATACAR ARENA
            </span>
            <div className="text-8xl font-black font-display text-white tracking-wider animate-bounce">
              {goFlash ? <span className="text-emerald-400">¡YA!</span> : countdown}
            </div>
            <span className="text-xs font-mono text-slate-400 mt-2">
              {track.name}
            </span>
          </div>
        )}

        {/* Floating Mini Camera Selector (Top Right of Canvas) */}
        <div className="dc100-race-camera-desktop absolute top-3 right-3 z-20 hidden lg:flex items-center gap-1 bg-slate-950/85 backdrop-blur-md p-1 rounded-xl border border-slate-800/80 shadow-xl select-none">
          {experience === 'race' && <button
            onClick={() => setCameraMode('arcade')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${cameraMode === 'arcade' ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}
            title="Cámara arcade baja y dinámica, sigue a tu auto">
            <Video className="w-3.5 h-3.5" /><span>Arcade</span>
          </button>}
          <button
            onClick={() => setCameraMode('trasera')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'trasera'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Cámara de conducción: tercera persona detrás del vehículo seleccionado"
          >
            <Video className="w-3.5 h-3.5" />
            <span>{experience === 'race' ? 'Mi auto' : 'Persecución'}</span>
          </button>

          <button
            onClick={() => setCameraMode('lateral')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'lateral'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Cámara 2: Lateral Transmisión Deportiva (Trackside TV)"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>TV</span>
          </button>

          <button
            onClick={() => setCameraMode('cenital')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'cenital'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Cámara 3: Cenital 3D (Overhead perspective)"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Cenital</span>
          </button>

          <button
            onClick={() => { setCameraMode('libre'); stateRef.current.cameraMode = 'libre'; }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'libre'
                ? 'bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Cámara libre: arrastrar con mouse/mousepad, zoom con dos dedos"
          >
            <MousePointer2 className="w-3.5 h-3.5" />
            <span>Libre</span>
          </button>

          {experience === 'replay' && (<>
          {/* Nueva Cámara Frontal de Meta (FINISH_LINE_FRONT_CAMERA) */}
          <button
            onClick={() => setCameraMode('frontal_meta')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'frontal_meta'
                ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Cámara 4: Frontal de Meta (Enfoque directo a parrillas y cruce)"
          >
            <Flag className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Frontal Meta</span>
          </button>

          <button
            onClick={() => setCameraMode('automatica')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
              cameraMode === 'automatica'
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Director cinematográfico: siete planos y llegada frontal garantizada"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Director TV</span>
          </button>
          </>)}
        </div>

        {/* Full-screen Arcade Preloader Gate */}
        {isPreloading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050914]/95 backdrop-blur-xl px-4 py-6 select-none transition-all duration-300">
            <div className="w-full max-w-xl mx-auto flex flex-col items-center text-center">
              {/* Badge */}
              <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 font-mono text-xs uppercase tracking-widest mb-3">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span>DATACAR ARENA · PREPARANDO PARRILLA</span>
              </div>

              {/* Title & Track */}
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase mb-1">
                {track.name}
              </h2>
              <p className="text-xs sm:text-sm font-mono text-slate-400 mb-6">
                {track.distanceMeters} METROS · {track.subtitle}
              </p>

              {/* Competitors List */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {vehicles.map((v, i) => {
                  const isPlayer = v.id === (playerVehicleId || vehicles[0]?.id);
                  const isModelReady = i < loadedVehicleModels;
                  return (
                    <div
                      key={v.id}
                      className={`relative rounded-xl border p-3 flex flex-col items-center text-center transition-all ${
                        isPlayer
                          ? 'border-amber-400/60 bg-amber-500/10 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                          : 'border-slate-800 bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white/20" style={{ backgroundColor: v.color }} />
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                          {isPlayer ? 'TU AUTO' : `RIVAL ${i}`}
                        </span>
                      </div>
                      <div className="text-sm font-black text-white uppercase tracking-tight">
                        {v.brand} {v.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {v.powerHp} HP · {v.torqueNm} Nm
                      </div>
                      <div className="mt-3 flex items-center gap-1 text-[10px] font-bold font-mono">
                        {isModelReady ? (
                          <span className="text-emerald-400 flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                            ✓ LISTO EN PISTA
                          </span>
                        ) : (
                          <span className="text-sky-400 flex items-center gap-1 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-md animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                            CARGANDO 3D...
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md bg-slate-900/80 rounded-full h-2.5 border border-slate-700/60 overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-amber-400 transition-all duration-300 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.8)]"
                  style={{
                    width: `${
                      requiredVehicleModels > 0
                        ? Math.min(100, Math.round((loadedVehicleModels / requiredVehicleModels) * 100))
                        : 100
                    }%`,
                  }}
                />
              </div>

              {/* Status Message */}
              <div className="text-xs font-mono text-slate-400">
                {loadedVehicleModels >= requiredVehicleModels
                  ? '¡Vehículos en pista! Iniciando largada...'
                  : `Cargando y calibrando modelos 3D (${loadedVehicleModels}/${requiredVehicleModels})...`}
              </div>

              {glbLoadError && (
                <div className="mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-lg">
                  {glbLoadError} (utilizando auto-fallback)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live Race Positions Pill (Cleanly stacked below Minimap on desktop) */}
        <div className="dc100-race-ranking absolute top-[168px] left-3 z-20 hidden md:flex flex-col gap-1 bg-slate-950/85 backdrop-blur-md p-2 rounded-xl border border-slate-800/80 shadow-xl font-mono text-[11px] pointer-events-none select-none max-w-[280px]">
          {vehicles.map((v) => {
            const st = interactiveMode && liveVehicleStates[v.id]
              ? liveVehicleStates[v.id]
              : getInterpolatedVehicleState(v.id, currentTimeSec);
            return (
              <div key={v.id} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full ring-1 ring-white/30" style={{ backgroundColor: v.color }} />
                <span className="text-white font-bold">{v.name.slice(0, 10)}</span>
                {v.id === (playerVehicleId || vehicles[0]?.id) ? (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-400/40 font-black">
                    TU AUTO
                  </span>
                ) : (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-sky-500/25 text-sky-300 border border-sky-400/40 font-bold">
                    3D GLB
                  </span>
                )}
                <span className="text-sky-400 tabular-nums">{st.speedKmh.toFixed(0)} km/h</span>
                <span className="text-slate-400 tabular-nums">{st.distance.toFixed(0)}m</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ergonomic Collapsible Bottom Control Dock */}
      <div className="border-t border-slate-800 bg-slate-950/95 flex flex-col">
        {/* Collapse / Expand Toggle Bar */}
        <div className="px-4 py-1.5 flex items-center justify-between border-b border-slate-900 bg-slate-950">
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 flex-wrap">
            <span className="text-sky-400 font-bold">CONTROLES & TELEMETRÍA</span>
            <span>·</span>
            <span>Cámara activa: <strong className="text-white uppercase">{cameraMode}</strong></span>
            <span>·</span>
            <span>Velocidad visual: <strong className="text-amber-400 font-bold">{playbackSpeed}x</strong></span>
          </div>

          <button
            onClick={() => setIsHudCollapsed(!isHudCollapsed)}
            className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
          >
            {isHudCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>{isHudCollapsed ? 'Mostrar Panel' : 'Minimizar'}</span>
          </button>
        </div>

        {!isHudCollapsed && (
          <>
            {/* Playback Controls & Timeline Scrubber */}
            <div className="px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { soundEngine.unlock(); soundEngine.setWeather(weatherModeRef.current); setIsPlaying(!isPlaying); }}
                  disabled={hasFinished && experience === 'race'}
                  className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold flex items-center justify-center transition-colors shadow-md shadow-sky-500/30"
                  title={isPlaying ? 'Pausar' : 'Reanudar'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-slate-950" /> : <Play className="w-4 h-4 fill-slate-950 ml-0.5" />}
                </button>

                <button
                  onClick={() => {
                    if (interactiveMode) {
                      // Recrear el motor dentro del loop; conservar las posiciones de los obstáculos.
                      physicsRef.current = new InteractiveRacePhysics(vehicles, track,
                        stateRef.current.selectedVehicleId, false, {
                          urbanTrafficRules: experience === 'race',
                        });
                      const rebuilt = physicsRef.current;
                      rebuilt.setWeather(weatherModeRef.current);
                      rebuilt.restoreHazards(raceHazardsSnapshotRef.current);
                      finalResultsRef.current = null;
                      setRaceEvent('');
                      setRaceInsight(null);
                      setSeatbeltBuckled(false);
                      setTrafficNotice(null);
                      setLiveVehicleStates({});
                      resetVisualRaceRef.current?.();
                    }
                    setCurrentTimeSec(0);
                    stateRef.current.currentTimeSec = 0;
                    if (timeDisplayRef.current) {
                      timeDisplayRef.current.textContent = '0.00s';
                    }
                    if (finishTimerRef.current !== null) {
                      clearTimeout(finishTimerRef.current);
                      finishTimerRef.current = null;
                    }
                    resultDeliveredRef.current = false;
                    soundEngine.unlock();
                    soundEngine.setWeather(weatherModeRef.current);
                    if (experience === 'race') {
                      setRestartSequence(value => value + 1);
                      setIsPlaying(false);
                      stateRef.current.isPlaying = false;
                    } else {
                      setIsPlaying(true);
                      stateRef.current.isPlaying = true;
                    }
                    setHasFinished(false);
                    stateRef.current.hasFinished = false;
                  }}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors border border-slate-700"
                  title="Reiniciar Carrera"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* Separación de física y reproducción visual: 0.25x, 0.5x, 0.75x (predeterminado), 1x, 2x */}
                <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 ml-1 text-xs font-mono">
                  {[0.25, 0.5, 0.75, 1, 2].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                        playbackSpeed === spd
                          ? 'bg-sky-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title={`Reproducción a ${spd}x (0.75x recomendado para disfrutar la acción)`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrubber */}
              <div className="flex-1 max-w-md w-full flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max={interactiveMode ? (track.cityCircuitId ? 420 : 180) * Math.max(1, track.laps ?? 1) : maxRaceTimeSec}
                  step="0.01"
                  disabled={interactiveMode}
                  value={currentTimeSec}
                  onChange={handleSeek}
                  aria-label="Línea de tiempo de la carrera"
                  title={interactiveMode ? 'El modo físico no permite retroceder el tiempo; usá Reiniciar' : 'Mover cronómetro'}
                  className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
                  {interactiveMode ? `${currentTimeSec.toFixed(1)} s · tiempo real` : `${currentTimeSec.toFixed(1)} / ${maxRaceTimeSec.toFixed(1)}s`}
                </span>
              </div>
            </div>

            {/* MODO CONDUCCIÓN FÍSICA Y EDICIÓN DE RIESGOS */}
            <div className="px-4 py-3 border-t border-slate-800 bg-slate-900/60 flex flex-wrap items-center gap-2">
              {experience === 'legacy' && <button type="button" onClick={() => { setPlacementKind(null); setInteractiveMode(v => !v); }}
                disabled={track.distanceMeters > 3500}
                className={`text-xs rounded-lg border px-3 py-2 font-semibold ${interactiveMode ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200' : 'bg-slate-800 border-slate-600 text-slate-300'}`}>
                <Zap className="inline w-3.5 h-3.5 mr-1" /> {interactiveMode ? 'Física interactiva ON' : 'Carrera clásica'}
              </button>}
              {interactiveMode && experience !== 'replay' && <>
                <button type="button" onClick={() => { setPlacementKind(null); setHazardsEnabled(v => !v); }}
                  className={`text-xs rounded-lg border px-2.5 py-2 ${hazardsEnabled ? 'text-amber-300 border-amber-500/50' : 'text-slate-400 border-slate-700'}`}>
                  <ShieldAlert className="inline w-3.5 h-3.5 mr-1" /> Baches/obstáculos {hazardsEnabled ? 'ON' : 'OFF'}
                </button>
                <button type="button" disabled={!hazardsEnabled} onClick={() => addVisualHazardRef.current?.('pothole')}
                  className="text-xs rounded-lg border border-slate-600 px-2.5 py-2 text-slate-200 hover:bg-slate-700 disabled:opacity-35">
                  + Bache
                </button>
                <button type="button" disabled={!hazardsEnabled} onClick={() => addVisualHazardRef.current?.('barrier')}
                  className="text-xs rounded-lg border border-slate-600 px-2.5 py-2 text-slate-200 hover:bg-slate-700 disabled:opacity-35">
                  <TrafficCone className="inline w-3.5 h-3.5 mr-1" /> + Obstáculo
                </button>
                <button type="button" disabled={!hazardsEnabled} onClick={() => setPlacementKind(p => p === 'pothole' ? null : 'pothole')}
                  className={`text-xs rounded-lg border px-2.5 py-2 ${placementKind === 'pothole' ? 'text-emerald-200 border-emerald-400' : 'text-slate-300 border-slate-600'} disabled:opacity-35`}>
                  {placementKind === 'pothole' ? '✓ Clic en pista: bache' : 'Colocar bache con mouse'}
                </button>
                <button type="button" disabled={!hazardsEnabled} onClick={() => setPlacementKind(p => p === 'barrier' ? null : 'barrier')}
                  className={`text-xs rounded-lg border px-2.5 py-2 ${placementKind === 'barrier' ? 'text-emerald-200 border-emerald-400' : 'text-slate-300 border-slate-600'} disabled:opacity-35`}>
                  {placementKind === 'barrier' ? '✓ Clic en pista: obstáculo' : 'Colocar obstáculo con mouse'}
                </button>
                <span className="text-[10px] text-slate-400">{hazardCount} riesgos · la IA intenta esquivarlos</span>
              </>}
              {experience === 'legacy' && track.distanceMeters > 3500 && <span className="text-[10px] text-amber-300">Modo interactivo disponible en pistas de hasta 3.500 m.</span>}
              <span className="w-full text-[11px] text-sky-200">
                {experience === 'race' ? '↑ / W: avanzar · ↓ / S: frenar y retroceder · Espacio: freno · ← →: dirección · mousepad: cámara' : experience === 'replay' ? 'Grabación real de tu carrera · Director TV automático · controles de reproducción disponibles' : 'Comparación automática a partir de las fichas técnicas.'}
              </span>
              {interactiveMode && raceEvent && <span className="w-full text-[11px] text-amber-300 font-semibold">{raceEvent}</span>}
            </div>

            {/* VOLANTE INTERACTIVO: mueve lateralmente y orienta el auto elegido.
                Los tiempos oficiales/ranking permanecen sin alteraciones. */}
            {experience === 'race' && (
            <div className="px-4 py-2 border-t border-slate-900 bg-slate-950 flex flex-wrap gap-3 items-center">
              <div className="flex items-center gap-2 min-w-[210px]">
                <Keyboard className="w-4 h-4 text-sky-400" />
                <span className="text-sky-400 font-mono font-bold text-xs">VOLANTE / FLECHAS ← →</span>
                <span className="text-slate-400 text-xs font-mono">{steeringDemoDeg > 0 ? '+' : ''}{steeringDemoDeg}°</span>
              </div>
              <label className="flex-1 max-w-sm flex items-center gap-3 text-xs font-mono text-slate-300">
                <span>Izq.</span>
                <input
                  type="range" min="-30" max="30" step="1"
                  aria-label="Volante: dirige lateralmente el automóvil seleccionado"
                  value={steeringDemoDeg}
                  onChange={e => {
                    keyboardSteeringRef.current = false;
                    const angle = Number(e.target.value);
                    stateRef.current.steeringDemoDeg = angle;
                    setSteeringDemoDeg(angle);
                  }}
                  className="w-full accent-amber-400 cursor-pointer"
                />
                <span>Der.</span>
              </label>
              <button
                type="button"
                className="rounded-md bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5"
                onClick={() => { keyboardSteeringRef.current = false; stateRef.current.steeringDemoDeg = 0; setSteeringDemoDeg(0); }}
              >
                Centrar volante
              </button>
              <span className="text-[10px] text-slate-400">{interactiveMode ? 'Conducción física: velocidad, adherencia, baches y choques modifican el resultado.' : 'Modo clásico: los tiempos oficiales no cambian.'}</span>
            </div>

            )}

            {/* Individual Telemetry HUD */}
            <div className="px-4 py-2 border-t border-slate-900 bg-slate-950 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">Telemetría en foco:</span>
                <div className="flex items-center gap-1">
                  {vehicles.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { if (experience === 'legacy' || experience === 'comparison') setSelectedVehicleId(v.id); }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors flex items-center gap-1.5 ${
                        selectedVehicleId === v.id
                          ? 'bg-slate-800 text-white border border-slate-700 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                      <span>{v.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedVehicle && selectedVehicleState && (
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-300 flex-wrap">
                  <div>
                    <span className="text-slate-500 mr-1.5">Velocidad:</span>
                    <strong className="text-white text-sm">{selectedVehicleState.speedKmh.toFixed(1)}</strong>
                    <span className="text-slate-400 text-[10px] ml-0.5">km/h</span>
                  </div>
                  <div>
                    <span className="text-slate-500 mr-1.5">Distancia:</span>
                    <strong className="text-sky-400 text-sm">{selectedVehicleState.distance.toFixed(1)}</strong>
                    <span className="text-slate-400 text-[10px] ml-0.5">m</span>
                  </div>
                  <div>
                    <span className="text-slate-500 mr-1.5">Aceleración:</span>
                    <strong className="text-emerald-400">{selectedVehicleState.accelG > 0 ? `+${selectedVehicleState.accelG.toFixed(2)}` : selectedVehicleState.accelG.toFixed(2)}</strong>
                    <span className="text-slate-400 text-[10px] ml-0.5">G</span>
                  </div>
                  <div>
                    <span className="text-slate-500 mr-1.5">Marcha:</span>
                    <strong className="text-amber-400">{selectedVehicleState.gear === 0 ? 'R' : `${selectedVehicleState.gear}ª`}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 mr-1.5">RPM:</span>
                    <strong className="text-slate-200">{selectedVehicleState.rpm}</strong>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
