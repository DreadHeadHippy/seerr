import type { SeasonPhase } from '@app/utils/seasonProgress';

export interface RingSegment {
  /** 0 to 1. */
  progress: number;
  phase: SeasonPhase;
}

interface DownloadRingProps {
  /** 0 to 1, shown as the percentage in the middle. */
  progress: number;
  /** Downloaded; being imported. */
  importing?: boolean;
  /** One arc per season, filling separately; a single arc when left out. */
  segments?: RingSegment[];
  /** lg: on a poster, with the percentage. sm: inline, no text. */
  size?: 'lg' | 'sm';
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A ring that fills as a download progresses. For a series it is split into
 * one arc per season: grey while waiting, filling while downloading, pulsing
 * while imported, green once in the library.
 */
const DownloadRing = ({
  progress,
  importing = false,
  segments,
  size = 'lg',
}: DownloadRingProps) => {
  const arcs: RingSegment[] = segments?.length
    ? segments
    : [
        {
          progress: importing ? 1 : progress,
          phase: importing ? 'importing' : 'downloading',
        },
      ];
  const shown = importing ? 1 : Math.min(1, Math.max(0, progress));
  const percent = Math.floor(shown * 100);
  const split = arcs.length > 1;
  const slot = CIRCUMFERENCE / arcs.length;
  // Round caps reach past the arc's end; plain ones keep the gaps clean.
  const gap = split ? Math.min(5, slot * 0.3) : 0;
  const length = slot - gap;
  const strokeWidth = size === 'lg' ? 5 : 9;
  const pulseAll = !split && importing;

  return (
    <div
      className={`relative rounded-full ${
        size === 'lg'
          ? 'h-16 w-16 bg-gray-900/70 shadow-lg backdrop-blur-sm sm:h-20 sm:w-20'
          : 'h-5 w-5'
      } ${pulseAll ? 'animate-pulse' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        {arcs.map((arc, index) => {
          const offset = -(index * slot + gap / 2);
          const filled =
            length *
            Math.min(
              1,
              Math.max(0, arc.phase === 'available' ? 1 : arc.progress)
            );

          return (
            <g key={index}>
              <circle
                cx="32"
                cy="32"
                r={RADIUS}
                fill="none"
                strokeWidth={strokeWidth}
                strokeDasharray={`${length} ${CIRCUMFERENCE}`}
                strokeDashoffset={offset}
                className="stroke-white/20"
              />
              <circle
                cx="32"
                cy="32"
                r={RADIUS}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap={split ? 'butt' : 'round'}
                strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
                strokeDashoffset={offset}
                // Readings arrive about every 1.5s; gliding between them
                // keeps it smooth without running ahead of qBittorrent.
                className={`transition-[stroke-dasharray] duration-[1500ms] ease-linear ${
                  arc.phase === 'available'
                    ? 'stroke-green-400'
                    : 'stroke-indigo-400'
                } ${split && arc.phase === 'importing' ? 'animate-pulse' : ''} ${
                  filled === 0 ? 'opacity-0' : ''
                }`}
              />
            </g>
          );
        })}
      </svg>
      {size === 'lg' && (
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white sm:text-base">
          {percent}%
        </span>
      )}
    </div>
  );
};

export default DownloadRing;
