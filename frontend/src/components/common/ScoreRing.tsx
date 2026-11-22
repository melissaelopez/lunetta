import { useId } from 'react';

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  onDarkBanner?: boolean;
}

export function ScoreRing({ score, size = 112, strokeWidth = 8, label, onDarkBanner = false }: ScoreRingProps) {
  const gradId = useId();
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - strokeWidth - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // 260-degree open-bottom arc (from 140deg to 400deg, leaving a clean gap at the bottom)
  const startAngle = 140;
  const sweepAngle = 260;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (sweepAngle / 360) * circumference;
  const filledLength = (clamped / 100) * arcLength;

  // Compute marker dot position at the end of the filled arc
  const markerAngleDeg = startAngle + (clamped / 100) * sweepAngle;
  const markerRad = (markerAngleDeg * Math.PI) / 180;
  const dotX = cx + radius * Math.cos(markerRad);
  const dotY = cy + radius * Math.sin(markerRad);

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="55%" stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
          className={onDarkBanner ? 'text-white/20' : 'text-slate-200 dark:text-indigo-900/70'}
        />
        {/* Filled gradient progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={`${filledLength} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
          className="transition-all duration-700"
        />
        {/* Glowing marker dot at arc tip */}
        <circle
          cx={dotX}
          cy={dotY}
          r={strokeWidth * 0.72}
          fill="white"
          opacity={0.35}
          className="transition-all duration-700"
        />
        <circle
          cx={dotX}
          cy={dotY}
          r={strokeWidth * 0.42}
          fill="white"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className={`text-3xl font-bold leading-none tracking-tight ${onDarkBanner ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
          {score}
        </span>
        <span className={`mt-1.5 text-xs font-medium ${onDarkBanner ? 'text-indigo-100/90' : 'text-slate-500 dark:text-slate-300'}`}>
          {label ?? '/ 100'}
        </span>
      </div>
    </div>
  );
}
