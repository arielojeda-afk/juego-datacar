import React, { useState } from 'react';
import { Vehicle } from '../types/vehicle';
import { Photographic360Viewer } from './Photographic360Viewer';
import { ArenaHero3DStage } from './ArenaHero3DStage';
import { Fuel, Gauge, CheckCircle2, RotateCw } from 'lucide-react';

interface CarShowroom3DProps {
  vehicle: Vehicle;
}

export const CarShowroom3D: React.FC<CarShowroom3DProps> = ({ vehicle }) => {
  const [studioMode, setStudioMode] = useState(false);

  return (
    <div className="bg-[#061219]/92 border border-[#00E5F5]/35 rounded-2xl overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.8)] flex flex-col backdrop-blur-md">
      {/* Top Header Strip */}
      <div className="px-5 py-3 border-b border-[#00E5F5]/20 bg-[#040d15]/90 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-1.5 -skew-x-16 bg-[#00E5F5] shadow-[0_0_8px_#00E5F5] shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="text-[#00E5F5] font-bold uppercase">
                {vehicle.brand} {vehicle.name}
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-slate-300 font-semibold">{vehicle.trim}</span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Modelo 3D GLB interactivo · Arrastrá horizontalmente para girar en 360°
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Quick specs summary */}
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono text-slate-300 bg-[#081824]/90 px-3 py-1.5 rounded-xl border border-[#00E5F5]/25">
            <div className="flex items-center gap-1.5 text-[#00E5F5] font-bold">
              <Gauge className="w-3.5 h-3.5" />
              <span>{vehicle.powerHp} HP</span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span>{vehicle.torqueNm} Nm</span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Fuel className="w-3.5 h-3.5" />
              <span>
                {vehicle.estimatedSimulationParameters ? '≈ ' : ''}
                {vehicle.consumptionBase} L/100km
                {vehicle.estimatedSimulationParameters ? ' (sim.)' : ''}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStudioMode((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#00E5F5]/40 bg-[#102C38]/85 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#00E5F5] hover:border-[#00E5F5] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{studioMode ? 'Vista 3D GLB' : 'Visor 360° Estudio'}</span>
          </button>
        </div>
      </div>

      {/* Escenario Arena PNG por defecto (idéntico al Home) o giro continuo bajo demanda */}
      {studioMode ? (
        <div className="p-4 sm:p-6 bg-[#050d16]/70">
          <Photographic360Viewer
            key={vehicle.id}
            vehicle={vehicle}
            compact={false}
            initialMode="frames"
          />
        </div>
      ) : (
        <div className="relative h-80 sm:h-[430px] w-full overflow-hidden bg-[#061219]">
          <img
            src="/assets/aistudio/arena_home_bg_4f3f8584.webp"
            alt=""
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[center_63%] scale-[1.03]"
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 46% 24% at 50% 30%, rgba(6, 18, 25, 0.92) 0%, rgba(6, 18, 25, 0.55) 60%, rgba(6, 18, 25, 0) 100%), linear-gradient(180deg, rgba(4, 12, 18, 0.65) 0%, rgba(6, 18, 25, 0.08) 54%, rgba(3, 9, 14, 0.82) 100%)',
            }}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-full">
            <ArenaHero3DStage vehicle={vehicle} />
          </div>
        </div>
      )}

      {/* Technical Summary Bar under Showroom */}
      <div className="px-5 py-3 border-t border-[#00E5F5]/20 bg-[#040d15]/85 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            Ficha cargada en DATACAR:{' '}
            <strong className="text-white">
              {vehicle.brand} {vehicle.name}
            </strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] tabular-nums">
          <span>
            Dimensiones:{' '}
            <span className="text-slate-300">
              {vehicle.dimensions.lengthMm} × {vehicle.dimensions.widthMm} ×{' '}
              {vehicle.dimensions.heightMm} mm
            </span>
          </span>
          <span className="hidden md:inline">
            Despeje del suelo:{' '}
            <span className="text-slate-300">{vehicle.dimensions.clearanceMm} mm</span>
          </span>
          <span>
            Peso {vehicle.estimatedSimulationParameters ? 'estimado' : 'tara'}:{' '}
            <span className="text-slate-300">{vehicle.weightKg} kg</span>
          </span>
        </div>
      </div>
    </div>
  );
};
