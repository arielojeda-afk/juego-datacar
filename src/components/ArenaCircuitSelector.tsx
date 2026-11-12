import React from 'react';
import { ArrowRight, Check, Info, MapPin } from 'lucide-react';
import type { AsuncionCircuit, DifficultyFilter } from '../data/asuncionCircuits';
import { matchesDifficulty } from '../data/asuncionCircuits';
import { getOfficialVehicleImageUrl } from '../data/presetVehicles';
import {
  CheckeredFlagIcon,
  CircuitWireframeSVG,
  LaurelBranchIcon,
} from './ArcadeBriefingAndResults';

export interface ArenaCircuitSelectorProps {
  circuits: AsuncionCircuit[];
  selectedCircuitId: string;
  onSelectCircuit: (circuitId: string) => void;
  difficulty: DifficultyFilter;
  onSelectDifficulty: (filter: DifficultyFilter) => void;
  laps?: number;
  onSelectLaps?: (laps: number) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  playerVehicleId?: string;
}

const DIFFICULTY_FILTERS: ReadonlyArray< readonly [DifficultyFilter, string] > = [
  ['todos', 'Todos'],
  ['facil', 'Fácil'],
  ['medio', 'Intermedio'],
  ['dificil', 'Difícil'],
  ['extremo', 'Extremo'],
];

interface CircuitVisualTheme {
  zoneClass: string;
  slashClass: string;
  scoreBadgeClass: string;
  streakWarm: boolean;
  withLaurel?: boolean;
}

function getCircuitTheme(circuitId: string): CircuitVisualTheme {
  switch (circuitId) {
    case 'avelino':
      return {
        zoneClass: 'text-[#FFAA12]',
        slashClass: 'bg-[#FFAA12] shadow-[0_0_8px_rgba(255,170,18,0.8)]',
        scoreBadgeClass: 'border-[#FFAA12]/85 text-[#FFAA12] bg-[#1A1104]/90 shadow-[0_0_14px_rgba(255,170,18,0.35)]',
        streakWarm: true,
        withLaurel: true,
      };
    case 'herrera':
      return {
        zoneClass: 'text-[#00E5F5]',
        slashClass: 'bg-[#00E5F5] shadow-[0_0_8px_rgba(0,229,245,0.8)]',
        scoreBadgeClass: 'border-[#00E5F5]/80 text-[#00E5F5] bg-[#041824]/90 shadow-[0_0_12px_rgba(0,229,245,0.3)]',
        streakWarm: false,
      };
    case 'jose-felix':
      return {
        zoneClass: 'text-[#FB923C]',
        slashClass: 'bg-[#FB923C] shadow-[0_0_8px_rgba(251,146,60,0.8)]',
        scoreBadgeClass: 'border-[#FB923C]/85 text-[#FDBA74] bg-[#1C0F05]/90 shadow-[0_0_12px_rgba(251,146,60,0.3)]',
        streakWarm: true,
      };
    case 'artigas':
      return {
        zoneClass: 'text-[#22D3EE]',
        slashClass: 'bg-[#22D3EE] shadow-[0_0_8px_rgba(34,211,238,0.8)]',
        scoreBadgeClass: 'border-[#22D3EE]/80 text-[#67E8F9] bg-[#041824]/90 shadow-[0_0_12px_rgba(34,211,238,0.3)]',
        streakWarm: false,
      };
    case 'oliva':
      return {
        zoneClass: 'text-[#C4B5FD]',
        slashClass: 'bg-[#A78BFA] shadow-[0_0_8px_rgba(167,139,250,0.8)]',
        scoreBadgeClass: 'border-[#A78BFA]/75 text-[#F3F7FC] bg-[#130E24]/90 shadow-[0_0_12px_rgba(167,139,250,0.28)]',
        streakWarm: false,
      };
    case 'aviadores':
    default:
      return {
        zoneClass: 'text-[#4ADE80]',
        slashClass: 'bg-[#4ADE80] shadow-[0_0_8px_rgba(74,222,128,0.8)]',
        scoreBadgeClass: 'border-[#4ADE80]/80 text-[#86EFAC] bg-[#051C12]/90 shadow-[0_0_12px_rgba(74,222,128,0.28)]',
        streakWarm: false,
      };
  }
}

export const ArenaCircuitSelector: React.FC<ArenaCircuitSelectorProps> = ({
  circuits,
  selectedCircuitId,
  onSelectCircuit,
  difficulty,
  onSelectDifficulty,
  laps = 1,
  onSelectLaps,
  onConfirm,
  confirmLabel = 'Elegir mi vehículo',
  playerVehicleId = 'nissan-kicks-2027',
}) => {
  const safeLaps = Math.max(1, Math.min(3, Math.round(laps)));
  const activeCircuit =
    circuits.find((item) => item.id === selectedCircuitId) || circuits[0];
  const filteredCircuits = circuits.filter((item) =>
    matchesDifficulty(item, difficulty),
  );

  return (
    <div className="relative z-10 w-full space-y-5 select-none">
      {/* 1. FRANJA HERO SUPERIOR: MODO CARRERA · ASUNCIÓN / ELEGÍ TU CIRCUITO. */}
      <section className="dc-circuit-hero relative overflow-hidden rounded-xl border border-[#00E5F5]/25 px-5 py-5 sm:px-8 sm:py-6">
        {/* Escena atmosférica derecha: postal nocturna de Asunción + piano de pista + silueta 3/4 trasera en PNG */}
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          aria-hidden="true"
        >
          <img
            src={activeCircuit.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute right-0 top-0 h-full w-full sm:w-[68%] object-cover object-center opacity-55 transition-opacity duration-300"
          />
          <div className="dc-circuit-hero-scrim absolute inset-0" />
          {/* Piano rojo/blanco estilizado de competición */}
          <div className="dc-circuit-kerb-strip hidden md:block absolute bottom-0 right-[18%] w-[34%] h-2.5 -skew-x-24 opacity-80" />
          {/* Vehículo oficial seleccionado en recorte transparente */}
          <img
            src={getOfficialVehicleImageUrl(playerVehicleId)}
            alt=""
            referrerPolicy="no-referrer"
            className="hidden lg:block absolute -right-4 -bottom-4 h-[118%] w-auto max-w-[360px] object-contain opacity-90 drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)]"
          />
        </div>

        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1" aria-hidden="true">
              <span className="h-3 w-1 -skew-x-20 bg-[#FFAA12]" />
              <span className="h-3 w-1 -skew-x-20 bg-[#FFAA12]" />
              <span className="h-3 w-1 -skew-x-20 bg-[#FFAA12]" />
              <span className="h-3 w-1 -skew-x-20 bg-[#FFAA12]/75" />
            </span>
            <span className="font-display text-xs sm:text-sm font-black italic uppercase tracking-[0.22em] text-[#FFAA12]">
              MODO CARRERA · ASUNCIÓN
            </span>
          </div>

          <h1 className="mt-1.5 font-display text-4xl sm:text-5xl md:text-[56px] font-black italic uppercase leading-[0.94] tracking-[0.02em] text-[#F3F7FC] drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
            ELEGÍ TU CIRCUITO.
          </h1>

          <p className="mt-2 max-w-2xl text-xs sm:text-sm italic leading-relaxed text-slate-200/90 drop-shadow">
            Cada tramo tiene una dificultad, adherencia y distribución de obstáculos distinta. Elegí qué desafío querés enfrentar.
          </p>
        </div>

        {/* Barra de filtros hexagonales + contador dorado */}
        <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filtrar circuitos por dificultad"
          >
            {DIFFICULTY_FILTERS.map(([id, label]) => {
              const active = difficulty === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectDifficulty(id)}
                  aria-pressed={active}
                  className={`dc-hex-filter-wrap cursor-pointer ${active ? 'active' : ''}`}
                >
                  <span className={`dc-hex-filter-inner text-xs sm:text-[13px] ${active ? 'active' : ''}`}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {onSelectLaps && (
              <div
                className="inline-flex items-center gap-1 rounded-lg border border-[#FFAA12]/55 bg-[#081724]/95 px-2.5 py-1 text-xs"
                role="group"
                aria-label="Seleccionar cantidad de vueltas"
              >
                <span className="font-display text-[11px] font-black italic uppercase tracking-wider text-[#FFAA12] mr-1">
                  Vueltas:
                </span>
                {[1, 2, 3].map((count) => {
                  const active = safeLaps === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => onSelectLaps(count)}
                      aria-pressed={active}
                      className={`rounded px-2 py-0.5 font-display text-xs font-black italic transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#FFAA12] text-[#04131A]'
                          : 'text-slate-200 hover:text-white'
                      }`}
                    >
                      {count} {count === 1 ? 'Lap' : 'Laps'}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="dc-hex-count-wrap">
              <div className="dc-hex-count-inner text-xs sm:text-[13px]">
                <CheckeredFlagIcon className="w-4 h-4 shrink-0" />
                <span>
                  {filteredCircuits.length}{' '}
                  {filteredCircuits.length === 1
                    ? 'circuito disponible'
                    : 'circuitos disponibles'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. GRILLA 3x2 DE LOS 6 CIRCUITOS TEMÁTICOS DE ASUNCIÓN */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredCircuits.map((item) => {
          const chosen = item.id === selectedCircuitId;
          const theme = getCircuitTheme(item.id);

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectCircuit(item.id)}
              aria-pressed={chosen}
              className={`dc-circuit-card group text-left cursor-pointer ${
                chosen ? 'selected' : ''
              }`}
            >
              {/* Mitad superior fotográfica con trazado neón del circuito */}
              <div className="relative h-36 sm:h-40 w-full overflow-hidden bg-[#061219]">
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                />
                {/* Scrim oscuro inferior y viñeta para resaltar el trazado luminoso */}
                <div className="dc-circuit-photo-scrim absolute inset-0" />

                {/* Acento diagonal luminoso lateral como en el mockup */}
                <div
                  className={`pointer-events-none absolute -right-4 bottom-0 h-24 w-12 -skew-x-24 opacity-65 ${
                    theme.streakWarm ? 'dc-circuit-streak-warm' : 'dc-circuit-streak-cyan'
                  }`}
                  aria-hidden="true"
                />

                {/* Insignia superior izquierda cuando está seleccionado */}
                {chosen && (
                  <span className="dc-circuit-selected-pill absolute left-3 top-3 z-20 inline-flex items-center gap-1 px-3 py-1 text-[10px] sm:text-[11px] font-black italic uppercase tracking-wider text-[#031519]">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>SELECCIONADO</span>
                  </span>
                )}

                {/* Puntaje de dificultad en esquina superior derecha */}
                <div className="absolute right-3 top-2.5 z-20 flex items-center">
                  {theme.withLaurel && (
                    <LaurelBranchIcon className="w-3.5 h-6 -mr-1 drop-shadow" />
                  )}
                  <span
                    className={`dc-circuit-score-pill inline-flex items-center justify-center border px-2.5 py-0.5 font-display text-sm sm:text-base font-black italic tabular-nums ${theme.scoreBadgeClass}`}
                  >
                    {item.difficulty.toFixed(1)}/10
                  </span>
                  {theme.withLaurel && (
                    <LaurelBranchIcon mirrored className="w-3.5 h-6 -ml-1 drop-shadow" />
                  )}
                </div>

                {/* Mapa del trazado luminoso centrado */}
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-10 pt-3">
                  <div className="w-40 sm:w-44 drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)]">
                    <CircuitWireframeSVG circuitId={item.id} />
                  </div>
                </div>
              </div>

              {/* Mitad inferior de datos del tramo */}
              <div className="relative z-10 flex flex-col justify-between px-4 pb-3.5 pt-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-3.5 w-1 -skew-x-20 shrink-0 ${theme.slashClass}`}
                      aria-hidden="true"
                    />
                    <span
                      className={`font-display text-xs font-black italic uppercase tracking-[0.12em] ${theme.zoneClass}`}
                    >
                      {item.zone}
                    </span>
                  </div>

                  <h2 className="mt-1 font-display text-xl sm:text-[23px] font-black italic leading-tight tracking-wide text-[#F3F7FC] group-hover:text-white truncate">
                    {item.name}
                  </h2>

                  <p className="mt-0.5 text-xs italic text-slate-300/90 truncate">
                    {item.hazardLabel}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-[#00E5F5]/15 pt-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-300 tabular-nums">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>
                      {item.distanceMeters * safeLaps} m ({safeLaps} {safeLaps === 1 ? 'vuelta' : 'vueltas'}) · Doble mano
                    </span>
                  </span>

                  {chosen ? (
                    <span className="inline-flex items-center gap-1 font-bold text-[#34F5C5] whitespace-nowrap shrink-0">
                      <Check className="h-3.5 w-3.5 stroke-[2.8]" />
                      <span>Elegido</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-bold text-[#00E5F5] group-hover:translate-x-0.5 transition-transform whitespace-nowrap shrink-0">
                      <span>Elegir</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 3. BANNER INFERIOR DE CIRCUITO SELECCIONADO + CTA DORADO */}
      <section
        className="dc-circuit-selected-banner relative overflow-hidden px-5 py-4 sm:px-7 sm:py-5"
        aria-label="Resumen del circuito seleccionado"
      >
        {/* Textura sutil de la calle seleccionada en el fondo del banner */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <img
            src={activeCircuit.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center opacity-22"
          />
          <div className="dc-circuit-banner-scrim absolute inset-0" />
        </div>

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-stretch gap-3.5 min-w-0">
            <span
              className="w-1.5 shrink-0 -skew-x-16 rounded-xs bg-gradient-to-b from-[#FFE082] via-[#FFAA12] to-[#D97706] shadow-[0_0_14px_rgba(255,170,18,0.85)]"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-display text-xs sm:text-sm font-black italic uppercase tracking-[0.14em] text-[#00E5F5]">
                CIRCUITO SELECCIONADO
              </p>
              <h3 className="mt-0.5 font-display text-2xl sm:text-3xl font-black italic leading-none tracking-wide text-[#F3F7FC] truncate">
                {activeCircuit.name}
              </h3>
              <p className="mt-1.5 text-xs sm:text-sm italic text-slate-200/90">
                “{activeCircuit.lore}”
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onConfirm}
            className="dc-circuit-gold-cta-wrap shrink-0 cursor-pointer"
          >
            <span className="dc-circuit-gold-cta-inner text-base sm:text-xl whitespace-nowrap">
              <span>{confirmLabel}</span>
              <ArrowRight className="h-5 w-5 stroke-[2.8]" />
            </span>
          </button>
        </div>
      </section>

      {/* 4. NOTA LEGAL INFERIOR + DATACARPY.COM */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px] italic text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-slate-400 shrink-0 not-italic" />
          <span>
            Ficción inspirada en nombres de calles reales; los peligros no son un diagnóstico de tránsito. La versión 3D utiliza tramos temáticos estilizados, no mapas viales exactos.
          </span>
        </span>
        <a
          href="https://datacarpy.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 not-italic font-bold text-[#00E5F5] hover:text-white transition-colors"
        >
          <span className="tracking-tighter text-slate-500" aria-hidden="true">
            ///
          </span>
          <span className="underline underline-offset-4">datacarpy.com</span>
        </a>
      </div>
    </div>
  );
};
