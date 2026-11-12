import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Vehicle, VehicleRaceResult } from './types/vehicle';
import { PRESET_VEHICLES, PRESET_TRACKS, getOfficialVehicleImageUrl } from './data/presetVehicles';
import { ASUNCION_CIRCUITS, matchesDifficulty, toRaceTrack } from './data/asuncionCircuits';
import type { DifficultyFilter } from './data/asuncionCircuits';
import { simulateFullRace } from './utils/physicsEngine';
import { Race3DPerspectiveView } from './components/Race3DPerspectiveView';
import { WEATHER_OPTIONS } from './utils/weatherDynamics';
import type { WeatherMode } from './utils/weatherDynamics';
import { CarShowroom3D } from './components/CarShowroom3D';
import { IntroSplash } from './components/IntroSplash';
import MobileGameExperience from './components/mobile/MobileGameExperience';
import { VehicleSpecsPanel } from './components/VehicleSpecsPanel';
import { DetailedSpecsTable } from './components/DetailedSpecsTable';
import { DrivingIQResults } from './components/DrivingIQResults';
import { rankDrivingIQ } from './utils/drivingIQ';
import { soundEngine } from './utils/soundEngine';
import type { TrackHazard } from './utils/interactiveRacePhysics';
import { preloadVehicleModels } from './utils/vehicle3DModelLoader';
import {
  ArcadeBriefingStage,
  ArcadeResultsStage,
} from './components/ArcadeBriefingAndResults';
import { ArenaCircuitSelector } from './components/ArenaCircuitSelector';
import {
  ArenaFlowTopBar,
  ArenaSectionBackdrop,
} from './components/ArenaVisualKit';
import type { ArenaFlowStepItem } from './components/ArenaVisualKit';
import {
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Clapperboard,
  FlagTriangleRight, GitCompareArrows, Play, RotateCcw,
  ShieldAlert, Smartphone, Trophy, MousePointer2,
} from 'lucide-react';

type Screen =
  | 'intro' | 'home' | 'compare-choose' | 'compare-run' | 'compare-results'
  | 'circuit-choose' | 'garage' | 'briefing' | 'race-run' | 'race-results' | 'replay';

const allCars = PRESET_VEHICLES;
const compareTracks = PRESET_TRACKS.filter(track => track.distanceMeters <= 3500);
const buttonPrimary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';
const buttonSecondary = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600/80 bg-[#081724]/90 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-cyan-400/70 hover:bg-[#0d2436]';
const panel = 'rounded-2xl border border-[#00E5F5]/25 bg-[#06131f]/88 backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.72)]';
const getCar = (id: string) => allCars.find(car => car.id === id) || allCars[0];
const getPreviewUrl = (id: string) => getOfficialVehicleImageUrl(id);

function RealCarsCTA() {
  return <section aria-label="Pasá del juego a los autos reales" className="rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-[#06131f]/95 via-[#091c2b]/95 to-cyan-950/60 p-6 shadow-xl sm:p-8 backdrop-blur-md">
    <p className="text-[11px] font-black uppercase tracking-[.22em] text-cyan-300">EL JUEGO TERMINÓ. EL PRÓXIMO AUTO ES REAL.</p>
    <h2 className="mt-2 max-w-3xl text-2xl font-black leading-tight sm:text-3xl">¿Querés dejar los jueguitos y pasar a los autos reales?</h2>
    <p className="mt-2 max-w-2xl text-sm text-slate-300">Explorá modelos, compará opciones y encontrá tu próximo vehículo en DATACAR Paraguay.</p>
    <a className={`${buttonPrimary} mt-5`} href="https://datacarpy.com" target="_blank" rel="noopener noreferrer">Conocer autos reales en datacarpy.com <ArrowRight size={17}/></a>
  </section>;
}

function PrettyCar({car}: {car: Vehicle}) {
  return <img src={getPreviewUrl(car.id)} alt={`${car.brand} ${car.name}`} referrerPolicy="no-referrer" className="dc-arena-cutout-img h-36 w-full rounded-xl object-contain object-center" />;
}

export default function App() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(pointer: coarse) and (max-width: 1100px)').matches);
  useEffect(() => { const query = window.matchMedia('(pointer: coarse) and (max-width: 1100px)'); const update = () => setIsMobile(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  const [screen, setScreen] = useState<Screen>('intro');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparePreviewId, setComparePreviewId] = useState<string>(allCars[0].id);
  const [compareTrackIndex, setCompareTrackIndex] = useState(0);
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('todos');
  const [circuitId, setCircuitId] = useState('oliva');
  const [playerId, setPlayerId] = useState(allCars[2].id);
  const [raceResults, setRaceResults] = useState<VehicleRaceResult[] | null>(null);
  const [raceHazards, setRaceHazards] = useState<TrackHazard[]>([]);
  const [replayWeather, setReplayWeather] = useState<WeatherMode>('sunny');
  const [raceWeather, setRaceWeather] = useState<WeatherMode>('sunny');
  const [raceLaps, setRaceLaps] = useState<number>(2);
  // Cada reinicio crea una escena y un motor físico NUEVOS desde la grilla.
  const [raceSession, setRaceSession] = useState(0);
  const [arcadeView, setArcadeView] = useState(false);
  const [briefingLoadPercent, setBriefingLoadPercent] = useState(72);
  const [briefingActivelyLoading, setBriefingActivelyLoading] = useState(false);
  const [showExtendedDetails, setShowExtendedDetails] = useState(false);
  const touchX = useRef<number | null>(null);

  const circuit = ASUNCION_CIRCUITS.find(item => item.id === circuitId) || ASUNCION_CIRCUITS[0];
  const raceTrack = useMemo(() => toRaceTrack(circuit, raceLaps), [circuit, raceLaps]);
  const compareTrack = compareTracks[compareTrackIndex] || compareTracks[0];
  const compareCars = useMemo(() => compareIds.map(getCar), [compareIds]);
  const comparePreviewCar = getCar(comparePreviewId);
  const compareResults = useMemo(() => simulateFullRace(compareCars, compareTrack), [compareCars, compareTrack]);
  const raceCars = useMemo(() => [getCar(playerId), ...allCars.filter(car => car.id !== playerId).slice(0, 2)], [playerId]);
  const raceBaseResults = useMemo(() => simulateFullRace(raceCars, raceTrack), [raceCars, raceTrack]);
  const playerIndex = allCars.findIndex(car => car.id === playerId);
  const playerCar = getCar(playerId);
  const podium = raceResults?.slice().sort((a, b) => a.finishPosition - b.finishPosition);
  const drivingAssessments = useMemo(() => raceResults
    ? rankDrivingIQ(raceResults, raceBaseResults, raceTrack.distanceMeters)
    : [], [raceResults, raceBaseResults, raceTrack.distanceMeters]);

  useEffect(() => {
    if (screen !== 'briefing') return;
    let cancelled = false;
    setBriefingActivelyLoading(true);
    setBriefingLoadPercent(28);
    const timer72 = window.setTimeout(() => {
      if (!cancelled) setBriefingLoadPercent(prev => Math.max(prev, 72));
    }, 260);
    void preloadVehicleModels(
      raceCars.map(v => v.id),
      {
        allowFallback: true,
        onProgress: fraction => {
          if (!cancelled) {
            setBriefingLoadPercent(Math.min(96, Math.max(36, Math.round(fraction * 96))));
          }
        },
      },
    ).then(() => {
      window.setTimeout(() => {
        if (!cancelled) {
          setBriefingLoadPercent(100);
          setBriefingActivelyLoading(false);
        }
      }, 420);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer72);
    };
  }, [screen, raceCars]);

  const startRace = () => { soundEngine.unlock(); setRaceSession(n => n + 1); setRaceResults(null); setRaceHazards([]); setReplayWeather(raceWeather); setScreen('race-run'); };
  const chooseDifficulty = (filter: DifficultyFilter) => {
    setDifficulty(filter);
    if (!matchesDifficulty(circuit, filter)) {
      const firstAvailable = ASUNCION_CIRCUITS.find(item => matchesDifficulty(item, filter));
      if (firstAvailable) setCircuitId(firstAvailable.id);
    }
  };
  const rotateSelection = (offset: number) => {
    setPlayerId(allCars[(playerIndex + offset + allCars.length) % allCars.length].id);
  };
  const toggleCompare = (id: string) => {
    setCompareIds(previous => {
      if (previous.includes(id)) return previous.filter(item => item !== id);
      return previous.length >= 2 ? [previous[1], id] : [...previous, id];
    });
  };
  const goHome = () => setScreen('home');
  const goIntro = () => setScreen('intro');
  const isComparison = screen.startsWith('compare');
  const isCareerFlow = ['circuit-choose', 'garage', 'briefing', 'race-run', 'race-results', 'replay'].includes(screen);

  const careerStepIndex =
    screen === 'circuit-choose'
      ? 0
      : screen === 'garage'
        ? 1
        : screen === 'briefing'
          ? 2
          : screen === 'race-run'
            ? 3
            : 4;

  const compareStepIndex =
    screen === 'compare-choose' ? 0 : screen === 'compare-run' ? 1 : 2;

  const flowSteps: ArenaFlowStepItem[] | undefined = isCareerFlow
    ? [
        { label: 'CIRCUITO', onSelect: () => setScreen('circuit-choose') },
        { label: 'TU AUTO 360°', onSelect: () => setScreen('garage') },
        { label: 'PREPARAR', onSelect: () => setScreen('briefing') },
        { label: 'CORRER' },
        { label: 'RESULTADOS', onSelect: podium ? () => setScreen('race-results') : undefined },
      ]
    : isComparison
      ? [
          { label: 'MODELOS', onSelect: () => setScreen('compare-choose') },
          { label: 'SIMULACIÓN', onSelect: compareIds.length === 2 ? () => setScreen('compare-run') : undefined },
          { label: 'RESULTADOS' },
        ]
      : undefined;

  if (isMobile) return <MobileGameExperience />;
  if (arcadeView) return <MobileGameExperience initialPlayerId={playerId} forceArcadeMode onExitArcadeMode={() => setArcadeView(false)} />;

  if (screen === 'intro') {
    return (
      <IntroSplash
        vehicles={allCars}
        onStart={() => setScreen('home')}
        onGarage={id => { setPlayerId(id); setScreen('garage'); }}
        onCompare={id => { if (id) setComparePreviewId(id); setScreen('compare-choose'); }}
        onCircuits={id => { setPlayerId(id); setScreen('circuit-choose'); }}
        onRace={id => { setPlayerId(id); setScreen('briefing'); }}
        onOpenArcade={() => setArcadeView(true)}
      />
    );
  }

  return <div className="dc-app-shell relative min-h-screen bg-[#061219] text-slate-50 selection:bg-cyan-400 selection:text-slate-950">
    {/* Fondo nocturno genérico de estadio DATACAR ARENA para todas las secciones */}
    <ArenaSectionBackdrop fixed />

    <ArenaFlowTopBar
      steps={flowSteps}
      currentStep={isCareerFlow ? careerStepIndex : isComparison ? compareStepIndex : undefined}
      onLogoClick={goIntro}
      rightSlot={
        <>
          <button
            type="button"
            onClick={() => setArcadeView(true)}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#FFAA12]/55 bg-[#FFAA12]/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#FFAA12] hover:bg-[#FFAA12]/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Smartphone size={13} />
            <span>Vista Arcade</span>
          </button>
          <button
            type="button"
            onClick={goIntro}
            className="rounded-lg border border-[#00E5F5]/40 bg-[#0A1D2A]/90 px-3 py-1.5 text-xs font-bold text-[#00E5F5] hover:border-[#00E5F5] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Inicio
          </button>
        </>
      }
    />

    <main className="dc-app-main relative z-10 mx-auto w-full max-w-[1380px] px-4 pb-16 pt-6 sm:px-8">
      {screen === 'home' && <div className="dc-game-home space-y-8">
        <button type="button" onClick={() => setScreen('intro')} className="text-xs font-bold uppercase tracking-widest text-cyan-400 hover:text-white">← Volver a Los más buscados</button>
        <div className="mx-auto max-w-3xl py-6 text-center">
          <p className="mb-3 text-xs font-black uppercase tracking-[.32em] text-cyan-400">Dos maneras de vivir DATACAR</p>
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-6xl">ELEGÍ TU <span className="text-cyan-400">EXPERIENCIA.</span></h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-400">Compará el rendimiento de dos vehículos en pruebas predeterminadas, o conducí contra rivales automáticos en circuitos ficticios inspirados en Asunción.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <button onClick={() => setScreen('compare-choose')} className={`${panel} group flex min-h-[330px] flex-col items-start justify-between overflow-hidden p-7 text-left transition hover:border-cyan-400/60 hover:bg-slate-800/85`}>
            <span className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-cyan-300"><GitCompareArrows size={28}/></span>
            <div><p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-cyan-400">Modalidad 01 · Automática</p><h2 className="text-4xl font-black">COMPARAR</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">Elegí exactamente dos modelos. La simulación se calcula a partir de sus fichas técnicas, sin manejar manualmente.</p></div>
            <span className="flex items-center gap-2 text-sm font-bold text-cyan-300">Elegir 2 autos <ArrowRight className="transition group-hover:translate-x-1" size={17}/></span>
          </button>
          <button onClick={() => setScreen('circuit-choose')} className={`${panel} group flex min-h-[330px] flex-col items-start justify-between overflow-hidden border-emerald-400/20 p-7 text-left transition hover:border-emerald-400/70 hover:bg-slate-800/85`}>
            <span className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-300"><FlagTriangleRight size={28}/></span>
            <div><p className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-emerald-400">Modalidad 02 · Interactiva</p><h2 className="text-4xl font-black">MODO CARRERA</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">Elegí un circuito, seleccioná tu auto en el showroom 360° y conducí. Los rivales intentan esquivar los peligros.</p></div>
            <span className="flex items-center gap-2 text-sm font-bold text-emerald-300">Elegir circuito <ArrowRight className="transition group-hover:translate-x-1" size={17}/></span>
          </button>
        </div>
        <p className="text-center text-xs text-slate-500">Los circuitos son escenarios de ficción inspirados en calles reales. No representan el estado actual de las vías.</p>
      </div>}

      {screen === 'compare-choose' && <div className="space-y-6">
        <div><p className="text-xs font-black uppercase tracking-[.2em] text-cyan-400">COMPARAR</p><h1 className="mt-2 font-display text-3xl font-black italic uppercase sm:text-5xl">DOS AUTOS. UNA PRUEBA.</h1><p className="mt-2 text-sm text-slate-300">Elegí un modelo a la izquierda, giralo libremente en el escenario Arena y añadilo a la comparación.</p></div>
        {/* Primero explorar el vehículo con giro manual, luego añadirlo al comparador. */}
        <div className="grid items-start gap-4 lg:grid-cols-[225px_minmax(0,1fr)_290px]">
          <div className={`${panel} space-y-2.5 p-4`}>
            <p className="text-xs font-black uppercase tracking-widest text-cyan-300">MODELOS DISPONIBLES</p>
            {allCars.map(car => <button type="button" key={car.id} onClick={() => setComparePreviewId(car.id)} aria-pressed={comparePreviewId === car.id} className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition cursor-pointer ${comparePreviewId === car.id ? 'border-cyan-400 bg-cyan-400/15 shadow-[0_0_14px_rgba(0,229,245,0.2)]' : 'border-slate-700/80 bg-[#040c14]/85 hover:border-cyan-400/50'}`}>
              <img src={getPreviewUrl(car.id)} alt="" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]" />
              <span className="min-w-0"><span className="block truncate text-[10px] font-bold uppercase tracking-wider text-cyan-300">{car.brand}</span><span className="block truncate text-sm font-black">{car.name}</span><span className="block text-[11px] text-slate-400">{car.powerHp} HP</span></span>
            </button>)}
            <div className="border-t border-slate-700/80 pt-3">
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">TU COMPARATIVA · {compareIds.length}/2</p>
              {[0,1].map(slot => <div key={slot} className="mb-2 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/75 px-3 py-2 text-sm"><span className="text-slate-300">Auto {slot+1}</span><span className="font-bold text-cyan-300">{compareIds[slot] ? getCar(compareIds[slot]).name : 'Sin elegir'}</span></div>)}
              <button type="button" onClick={() => toggleCompare(comparePreviewId)} aria-pressed={compareIds.includes(comparePreviewId)} className={`mt-2 w-full rounded-xl px-4 py-3 text-sm font-black transition cursor-pointer ${compareIds.includes(comparePreviewId) ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20' : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'}`}>
                {compareIds.includes(comparePreviewId) ? 'Quitar de la comparación' : compareIds.length === 2 ? 'Reemplazar el más antiguo' : 'Elegir este auto'}
              </button>
            </div>
          </div>
          <div className="min-w-0">
            <CarShowroom3D key={comparePreviewId} vehicle={comparePreviewCar} />
            <p className="mt-3 text-center text-xs text-slate-300">Explorá el auto arrastrando horizontalmente y consultá su ficha antes de elegirlo.</p>
          </div>
          <aside className="min-w-0 lg:sticky lg:top-5" aria-label="Características del modelo que estás explorando">
            <VehicleSpecsPanel key={comparePreviewCar.id} vehicle={comparePreviewCar} context="compare" />
          </aside>
        </div>
        <div className={`${panel} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}>
          <label className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-300">Prueba predeterminada
            <select value={compareTrackIndex} onChange={event => setCompareTrackIndex(Number(event.target.value))} className="mt-2 block w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm font-semibold text-white">
              {compareTracks.map((track, index) => <option key={track.id} value={index}>{track.name}</option>)}
            </select>
          </label>
          <button disabled={compareIds.length !== 2} onClick={() => setScreen('compare-run')} className={buttonPrimary}><Play size={16}/> Ejecutar comparación</button>
        </div>
        <button onClick={goIntro} className={buttonSecondary}><ArrowLeft size={16}/> Volver a Los más buscados</button>
      </div>}

      {screen === 'compare-run' && <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-400">COMPARACIÓN AUTOMÁTICA</p><h1 className="mt-1 font-display text-3xl font-black italic uppercase">{compareTrack.name}</h1><p className="mt-2 text-sm text-slate-300">No necesitás acelerar ni girar. Se reproducen los resultados calculados.</p></div><button onClick={() => setScreen('compare-choose')} className={buttonSecondary}><ArrowLeft size={16}/> Cambiar modelos</button></div>
        <Race3DPerspectiveView key={`comparison-${compareTrack.id}-${compareIds.join('-')}`} experience="comparison" vehicles={compareCars} track={compareTrack} simulationResults={compareResults} onFinishRace={() => setScreen('compare-results')}/>
        <button onClick={() => setScreen('compare-results')} className={buttonSecondary}>Ver resultados calculados <ArrowRight size={16}/></button>
      </div>}

      {screen === 'compare-results' && <div className="space-y-6">
        <div><p className="text-xs font-bold uppercase tracking-widest text-cyan-400">RESULTADOS DE COMPARACIÓN</p><h1 className="mt-1 font-display text-4xl font-black italic uppercase">FRENTE A FRENTE</h1><p className="mt-2 text-sm text-slate-300">Prueba: {compareTrack.name}. Valores referenciales calculados a partir de atributos técnicos.</p></div>
        <div className="grid gap-4 md:grid-cols-2">{compareResults.slice().sort((a,b)=>a.finishPosition-b.finishPosition).map((item, index) => <div key={item.vehicle.id} className={`${panel} p-5`}>
          <span className="text-xs font-black text-cyan-400">PUESTO {index + 1}</span><PrettyCar car={item.vehicle}/><h2 className="text-xl font-black">{item.vehicle.brand} {item.vehicle.name}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3"><div><span className="text-xs text-slate-400">Tiempo</span><p className="text-2xl font-black tabular-nums">{item.finishTimeSec.toFixed(2)} s</p></div><div><span className="text-xs text-slate-400">Velocidad máxima</span><p className="text-2xl font-black tabular-nums">{item.topSpeedAchievedKmh.toFixed(1)} <span className="text-xs">km/h</span></p></div></div>
        </div>)}</div>
        <DetailedSpecsTable vehicles={compareCars}/>
        <RealCarsCTA/>
        <div className="flex flex-wrap gap-3"><button onClick={() => setScreen('compare-run')} className={buttonPrimary}><RotateCcw size={16}/> Ver simulación otra vez</button><button onClick={() => setScreen('compare-choose')} className={buttonSecondary}>Cambiar vehículos</button><button onClick={goIntro} className={buttonSecondary}>Inicio</button></div>
      </div>}

      {screen === 'circuit-choose' && (
        <ArenaCircuitSelector
          circuits={ASUNCION_CIRCUITS}
          selectedCircuitId={circuitId}
          onSelectCircuit={setCircuitId}
          difficulty={difficulty}
          onSelectDifficulty={chooseDifficulty}
          laps={raceLaps}
          onSelectLaps={setRaceLaps}
          onConfirm={() => setScreen('garage')}
          confirmLabel="Elegir mi vehículo"
          playerVehicleId={playerId}
        />
      )}

      {screen === 'garage' && <div className="space-y-6">
        <div><p className="text-xs font-black uppercase tracking-[.25em] text-[#00E5F5]">SHOWROOM ARENA · 7 SUVS</p><h1 className="mt-1 font-display text-3xl font-black italic uppercase sm:text-5xl">ELEGÍ TU MÁQUINA.</h1><p className="mt-2 text-sm text-slate-300">Seleccioná tu SUV y arrastrá horizontalmente sobre el escenario para explorar todos sus ángulos.</p></div>
        <div className={`${panel} p-4`}>
          <div className="flex items-center gap-3"><button className={buttonSecondary} onClick={() => rotateSelection(-1)} aria-label="Modelo anterior"><ChevronLeft size={22}/></button>
            <div className="flex min-w-0 flex-1 select-none gap-3 overflow-x-auto py-2" onTouchStart={event => { touchX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={event => { if (touchX.current === null) return; const delta = event.changedTouches[0]?.clientX - touchX.current; if (delta !== undefined && Math.abs(delta) > 55) rotateSelection(delta < 0 ? 1 : -1); touchX.current = null; }}>
              {allCars.map(car => <button key={car.id} onClick={() => setPlayerId(car.id)} className={`min-w-[155px] flex-1 rounded-xl border px-3 py-2.5 text-left transition cursor-pointer ${car.id === playerId ? 'border-[#00E5F5] bg-[#00E5F5]/15 shadow-[0_0_16px_rgba(0,229,245,0.28)]' : 'border-slate-700/80 bg-[#040c14]/80 hover:border-[#00E5F5]/50'}`}>
                <img src={getPreviewUrl(car.id)} alt="" referrerPolicy="no-referrer" className="h-14 w-full object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.85)]" />
                <p className={`mt-1 text-[10px] font-bold uppercase tracking-wider ${car.id === playerId ? 'text-[#00E5F5]' : 'text-slate-400'}`}>{car.brand}</p>
                <p className="truncate text-sm font-black text-white">{car.name}</p>
              </button>)}
            </div>
            <button className={buttonSecondary} onClick={() => rotateSelection(1)} aria-label="Modelo siguiente"><ChevronRight size={22}/></button></div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400"><span>← Deslizá los 7 modelos →</span><span className="flex items-center gap-1"><MousePointer2 size={13}/> Giro interactivo por arrastre</span></div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0"><CarShowroom3D key={playerId} vehicle={playerCar}/></div>
          <aside className="min-w-0 lg:sticky lg:top-5" aria-label="Ficha técnica del vehículo seleccionado">
            <VehicleSpecsPanel key={playerCar.id} vehicle={playerCar} context="race" />
          </aside>
        </div>
        <div className={`${panel} flex flex-wrap items-center justify-between gap-5 p-5`}>
          <div className="flex items-center gap-4">
            <img src={getPreviewUrl(playerCar.id)} alt="" referrerPolicy="no-referrer" className="hidden sm:block h-16 w-28 object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.85)]" />
            <div><span className="text-xs font-bold uppercase tracking-widest text-[#00E5F5]">TU ELECCIÓN · CIRCUITO: {circuit.name.toUpperCase()}</span><h2 className="mt-1 font-display text-2xl font-black italic uppercase">{playerCar.brand} {playerCar.name}</h2><p className="mt-1 text-sm text-slate-300">{playerCar.powerHp} HP · {playerCar.torqueNm} Nm · {playerCar.weightKg} kg{playerCar.estimatedSimulationParameters ? ' (parámetros de simulación calibrados)' : ''}</p></div>
          </div>
          <div className="flex gap-2.5"><button onClick={() => setScreen('circuit-choose')} className={buttonSecondary}><ArrowLeft size={16}/> Circuitos</button><button onClick={() => setScreen('briefing')} className="dc-circuit-gold-cta-wrap cursor-pointer"><span className="dc-circuit-gold-cta-inner text-base">Confirmar vehículo <ArrowRight size={17}/></span></button></div>
        </div>
      </div>}

      {screen === 'briefing' && <div className="space-y-6">
        <ArcadeBriefingStage
          car={playerCar}
          circuit={circuit}
          weather={raceWeather}
          onWeatherChange={setRaceWeather}
          laps={raceLaps}
          onLapsChange={setRaceLaps}
          loadPercent={briefingLoadPercent}
          loadLabel="Cargando pista y vehículos"
          isActivelyLoading={briefingActivelyLoading}
          loadingContext="race"
          onStartRace={startRace}
          onChangeCar={() => setScreen('garage')}
          onChangeCircuit={() => setScreen('circuit-choose')}
          getCarImageUrl={getPreviewUrl}
        />
        <div className={`${panel} p-5`}><h3 className="flex items-center gap-2 text-sm font-black"><ShieldAlert className="h-4 w-4 text-amber-400"/> MECÁNICA DE LA PARTIDA Y NORMAS VIALES</h3><p className="mt-3 text-sm leading-relaxed text-slate-300">Acelerá con ↑ o W. Con ↓ o S frenás y, cuando el auto se detiene, activás la marcha atrás. Espacio es el freno independiente y <strong>C abrocha el cinturón de seguridad</strong>. Circulá por tu mano derecha respetando los <strong>semáforos en rojo</strong> (prueba real de frenado), los <strong>carteles de velocidad máxima y mínima</strong> y el tránsito que viene de frente por el carril izquierdo. Si tu SUV equipa <strong>ADAS de punto ciego</strong>, recibirás avisos luminosos laterales izquierda/derecha.</p></div>
      </div>}

      {screen === 'race-run' && <div className="dc-game-running space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-400">MODO CARRERA · CONDUCCIÓN EN VIVO · {raceLaps} {raceLaps === 1 ? 'VUELTA' : 'VUELTAS'}</p><h1 className="mt-1 font-display text-3xl font-black italic uppercase">{circuit.name}</h1><p className="mt-1 text-sm text-slate-300">Vos: {playerCar.brand} {playerCar.name} · IA + tránsito doble mano con semáforos y límites</p></div><button onClick={() => setScreen('briefing')} className={buttonSecondary}><ArrowLeft size={16}/> Abandonar partida</button></div>
        <Race3DPerspectiveView key={`race-${circuitId}-${playerId}-${raceLaps}-${raceSession}`} experience="race" playerVehicleId={playerId} initialWeather={raceWeather} vehicles={raceCars} track={raceTrack} simulationResults={raceBaseResults} onRestartRace={() => setRaceSession(n => n + 1)} onFinishRace={(results, hazards, weather) => { setRaceResults(results || null); setRaceHazards(hazards || []); setReplayWeather(weather || 'sunny'); setScreen('race-results'); }}/>
        <p className="text-xs text-slate-400">Física jugable aproximada: agarre, aceleración, frenada en semáforos, salpicaduras en piso mojado e infracciones afectan el Driving IQ.</p>
      </div>}

      {screen === 'race-results' && <div className="space-y-6">
        {!podium ? (
          <div className={`${panel} p-8`}>
            <p>No hay resultados registrados todavía. Podés volver a correr.</p>
          </div>
        ) : (
          <>
            <ArcadeResultsStage
              circuitName={circuit.name}
              trackDistanceMeters={raceTrack.distanceMeters}
              podium={podium}
              assessments={drivingAssessments}
              playerId={playerId}
              fallbackCar={playerCar}
              onBackToGarage={() => setScreen('garage')}
              onRepeatRace={startRace}
              onWatchReplay={() => setScreen('replay')}
              onShowAllData={() => setShowExtendedDetails(v => !v)}
              getCarImageUrl={getPreviewUrl}
            />
            {(() => {
              // Protagonista del jugador conservado en resumen compacto y accesible.
              const result = podium.find(item => item.vehicle.id === playerId);
              const hero = result?.vehicle ?? playerCar;
              return (
                <section className={`${panel} relative overflow-hidden border-cyan-400/25 p-4 sm:p-5`} aria-label="Tu vehículo al finalizar la carrera">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <img
                        src={getPreviewUrl(hero.id)}
                        alt={`${hero.brand} ${hero.name} — vehículo elegido para tu carrera`}
                        referrerPolicy="no-referrer"
                        className="h-16 w-28 object-contain"
                      />
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[.22em] text-cyan-300">TU LLEGADA · {circuit.name}</p>
                        <h2 className="text-lg font-black uppercase text-white">{hero.brand} {hero.name}</h2>
                        <p className="text-xs text-slate-400">
                          {result?.isDnf ? 'Recorrido no completado (DNF)' : `Puesto ${result?.finishPosition ?? '—'} · ${result ? `${result.finishTimeSec.toFixed(2)} s` : '—'} · Punta ${result ? result.topSpeedAchievedKmh.toFixed(1) : '—'} km/h`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setShowExtendedDetails(v => !v)} className={buttonSecondary}>
                        {showExtendedDetails ? 'Ocultar desglose técnico' : 'Ver desglose completo Driving IQ'}
                      </button>
                      <button type="button" onClick={() => setScreen('replay')} className={buttonPrimary}>
                        <Clapperboard size={16}/> Director TV · Repetición
                      </button>
                    </div>
                  </div>
                </section>
              );
            })()}
            {showExtendedDetails && <DrivingIQResults results={podium} assessments={drivingAssessments} playerId={playerId} />}
          </>
        )}
        <RealCarsCTA/>
        <div className="flex flex-wrap gap-3"><button onClick={startRace} className={buttonSecondary}><RotateCcw size={16}/> Volver a correr</button><button onClick={() => setScreen('circuit-choose')} className={buttonSecondary}>Elegir otro circuito</button><button onClick={goIntro} className={buttonSecondary}>Inicio</button></div>
      </div>}

      {screen === 'replay' && raceResults && <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400"><Clapperboard size={16}/> REPETICIÓN EXCLUSIVA · DIRECTOR TV</p><h1 className="mt-1 text-3xl font-black">ASÍ FUE TU CARRERA.</h1><p className="mt-2 text-sm text-slate-400">Se muestran las trayectorias que quedaron registradas durante la partida.</p></div><button onClick={() => setScreen('race-results')} className={buttonSecondary}><ArrowLeft size={16}/> Resultados</button></div>
        <Race3DPerspectiveView key={`replay-${circuitId}-${playerId}`} experience="replay" playerVehicleId={playerId} vehicles={raceCars} track={raceTrack} simulationResults={raceResults} replayHazards={raceHazards} replayWeather={replayWeather} onFinishRace={() => {}} />
        <RealCarsCTA/>
        <div className="flex gap-3"><button onClick={() => setScreen('race-results')} className={buttonPrimary}><Trophy size={16}/> Volver al podio</button><button onClick={startRace} className={buttonSecondary}><RotateCcw size={16}/> Nueva carrera</button></div>
      </div>}
    </main>
    <footer className="relative z-10 border-t border-slate-800 bg-slate-950/80 px-5 py-6 text-center text-xs leading-relaxed text-slate-500">DATACAR ARENA V13 · Prototipo interactivo · Las condiciones de los circuitos son ficticias e inspiradas en Asunción, no información actual sobre el estado de sus calles. Los resultados técnicos son referenciales; algunos parámetros del Corolla Cross son estimados para la simulación. · <a className="font-bold text-cyan-400 underline" href="https://datacarpy.com" target="_blank" rel="noreferrer">datacarpy.com</a></footer>
  </div>;
}
