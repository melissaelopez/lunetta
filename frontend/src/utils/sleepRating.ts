import { DateTime } from 'luxon';

export type SleepTier = 'poor' | 'fair' | 'solid' | 'good' | 'excellent';

export interface TierMeta {
  tier: SleepTier;
  label: string;
  chipClass: string;
  dotClass: string;
  headlinePhrase: string;
  subtitle: string;
}

const TIER_META: Record<SleepTier, TierMeta> = {
  excellent: {
    tier: 'excellent',
    label: 'Excellent',
    chipClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    headlinePhrase: 'an excellent night',
    subtitle: 'Restful, well-paced sleep all night.',
  },
  good: {
    tier: 'good',
    label: 'Good',
    chipClass: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
    dotClass: 'bg-lime-500 dark:bg-lime-400',
    headlinePhrase: 'a good night',
    subtitle: 'Steady rest with strong sleep stretches.',
  },
  solid: {
    tier: 'solid',
    label: 'Solid',
    chipClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    dotClass: 'bg-amber-400 dark:bg-amber-300',
    headlinePhrase: 'a solid night',
    subtitle: 'Building strong sleep skills.',
  },
  fair: {
    tier: 'fair',
    label: 'Fair',
    chipClass: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    dotClass: 'bg-orange-500 dark:bg-orange-400',
    headlinePhrase: 'a fair night',
    subtitle: 'A little uneven — room to settle in.',
  },
  poor: {
    tier: 'poor',
    label: 'Poor',
    chipClass: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    dotClass: 'bg-rose-500 dark:bg-rose-400',
    headlinePhrase: 'a tough night',
    subtitle: 'A bumpy stretch — hang in there.',
  },
};

export function getTierMeta(tier: SleepTier): TierMeta {
  return TIER_META[tier];
}

export function rateTotalScore(score: number): SleepTier {
  if (score >= 90) return 'excellent';
  if (score >= 78) return 'good';
  if (score >= 65) return 'solid';
  if (score >= 50) return 'fair';
  return 'poor';
}

export function rateDuration(durationScore: number): SleepTier {
  if (durationScore >= 35) return 'excellent';
  if (durationScore >= 30) return 'good';
  if (durationScore >= 25) return 'solid';
  if (durationScore >= 20) return 'fair';
  return 'poor';
}

export function rateContinuity(continuityScore: number): SleepTier {
  if (continuityScore >= 33) return 'excellent';
  if (continuityScore >= 28) return 'good';
  if (continuityScore >= 22) return 'solid';
  if (continuityScore >= 15) return 'fair';
  return 'poor';
}

export function rateStretch(onsetScore: number): SleepTier {
  if (onsetScore >= 15) return 'excellent';
  if (onsetScore >= 12) return 'good';
  if (onsetScore >= 9) return 'solid';
  if (onsetScore >= 6) return 'fair';
  return 'poor';
}

export function rateTiming(timingScore: number): SleepTier {
  if (timingScore >= 15) return 'excellent';
  if (timingScore >= 12) return 'good';
  if (timingScore >= 9) return 'solid';
  if (timingScore >= 6) return 'fair';
  return 'poor';
}

export function rateWakeTime(wakeIso: string, expectedWakeHour: number): SleepTier | null {
  const dt = DateTime.fromISO(wakeIso);
  if (!dt.isValid) return null;
  const localHour = dt.hour + dt.minute / 60;
  const diff = Math.abs(localHour - expectedWakeHour);
  if (diff <= 0.5) return 'excellent';
  if (diff <= 1.0) return 'good';
  if (diff <= 1.5) return 'solid';
  if (diff <= 2.25) return 'fair';
  return 'poor';
}
