import { getTierMeta, type SleepTier } from '../../utils/sleepRating';

interface Props {
  tier: SleepTier;
  className?: string;
}

export function StatusChip({ tier, className = '' }: Props) {
  const meta = getTierMeta(tier);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${meta.chipClass} ${className}`}
    >
      {meta.label}
    </span>
  );
}
