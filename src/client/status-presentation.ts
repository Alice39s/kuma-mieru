import {
  AlertTriangle,
  CircleHelp,
  CirclePause,
  Clock3,
  Construction,
  ShieldCheck,
  Siren,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

export const publicStatuses = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'paused',
  'pending',
  'unknown',
] as const;

export type PublicStatus = (typeof publicStatuses)[number];

export interface StatusPresentation {
  label: string;
  summary: string;
  Icon: LucideIcon;
  bannerClassName: string;
  iconClassName: string;
  badgeClassName: string;
}

export interface EvidenceStatus {
  status: PublicStatus;
  coverageState?: string;
  freshnessState?: string;
  sampleCount?: number;
  consumerSuccessCount?: number;
}

const presentations: Record<PublicStatus, StatusPresentation> = {
  operational: {
    label: 'All systems operational',
    summary: 'Every reporting service is operating normally.',
    Icon: ShieldCheck,
    bannerClassName: 'border-emerald-800/10 bg-emerald-700/[0.07]',
    iconClassName: 'bg-emerald-700 text-white shadow-emerald-900/15',
    badgeClassName: 'border-emerald-800/10 bg-emerald-700/[0.08] text-emerald-900',
  },
  degraded: {
    label: 'Degraded performance',
    summary: 'At least one service is responding with reduced performance.',
    Icon: AlertTriangle,
    bannerClassName: 'border-amber-800/15 bg-amber-500/[0.10]',
    iconClassName: 'bg-amber-500 text-amber-950 shadow-amber-900/15',
    badgeClassName: 'border-amber-800/15 bg-amber-500/[0.12] text-amber-950',
  },
  partial_outage: {
    label: 'Partial outage',
    summary: 'Some services or regions are currently unavailable.',
    Icon: TriangleAlert,
    bannerClassName: 'border-orange-800/15 bg-orange-500/[0.10]',
    iconClassName: 'bg-orange-600 text-white shadow-orange-900/15',
    badgeClassName: 'border-orange-800/15 bg-orange-500/[0.12] text-orange-950',
  },
  major_outage: {
    label: 'Major outage',
    summary: 'A broad service interruption is currently in progress.',
    Icon: Siren,
    bannerClassName: 'border-rose-900/15 bg-rose-600/[0.10]',
    iconClassName: 'bg-rose-600 text-white shadow-rose-950/20',
    badgeClassName: 'border-rose-900/15 bg-rose-600/[0.11] text-rose-950',
  },
  maintenance: {
    label: 'Planned maintenance',
    summary: 'Maintenance work may temporarily affect service behavior.',
    Icon: Construction,
    bannerClassName: 'border-sky-900/15 bg-sky-600/[0.09]',
    iconClassName: 'bg-sky-600 text-white shadow-sky-950/15',
    badgeClassName: 'border-sky-900/15 bg-sky-600/[0.10] text-sky-950',
  },
  paused: {
    label: 'Monitoring paused',
    summary: 'Fresh service observations are temporarily paused.',
    Icon: CirclePause,
    bannerClassName: 'border-violet-900/15 bg-violet-600/[0.08]',
    iconClassName: 'bg-violet-600 text-white shadow-violet-950/15',
    badgeClassName: 'border-violet-900/15 bg-violet-600/[0.09] text-violet-950',
  },
  pending: {
    label: 'Awaiting first signal',
    summary: 'The first local source snapshot has not arrived yet.',
    Icon: Clock3,
    bannerClassName: 'border-slate-700/10 bg-slate-500/[0.08]',
    iconClassName: 'bg-slate-600 text-white shadow-slate-950/15',
    badgeClassName: 'border-slate-700/10 bg-slate-500/[0.09] text-slate-800',
  },
  unknown: {
    label: 'Status unknown',
    summary: 'The available evidence is not sufficient to claim normal operation.',
    Icon: CircleHelp,
    bannerClassName: 'border-slate-700/15 bg-slate-600/[0.10]',
    iconClassName: 'bg-slate-700 text-white shadow-slate-950/15',
    badgeClassName: 'border-slate-700/15 bg-slate-600/[0.11] text-slate-900',
  },
};

const severity: Record<PublicStatus, number> = {
  operational: 0,
  pending: 1,
  paused: 2,
  maintenance: 3,
  degraded: 4,
  unknown: 5,
  partial_outage: 6,
  major_outage: 7,
};

export const collectingBaselinePresentation: StatusPresentation = {
  label: 'Establishing baseline',
  summary:
    'Fresh successful probes are arriving. SLA status remains provisional until burn-in is complete.',
  Icon: Clock3,
  bannerClassName: 'border-sky-900/15 bg-sky-600/[0.09]',
  iconClassName: 'bg-sky-600 text-white shadow-sky-950/15',
  badgeClassName: 'border-sky-900/15 bg-sky-600/[0.10] text-sky-950',
};

export const presentationForStatus = (status: PublicStatus) => presentations[status];

export const isCollectingBaselineEvidence = (evidence: EvidenceStatus) =>
  evidence.status === 'unknown' &&
  evidence.coverageState !== 'active' &&
  evidence.freshnessState === 'fresh' &&
  (evidence.sampleCount ?? 0) > 0 &&
  (evidence.consumerSuccessCount ?? 0) > 0;

export const worstPublicStatus = (statuses: PublicStatus[]): PublicStatus =>
  statuses.reduce<PublicStatus>(
    (worst, status) => (severity[status] > severity[worst] ? status : worst),
    statuses.length > 0 ? 'operational' : 'pending'
  );

export const statusForPublicEvidence = (
  statuses: PublicStatus[],
  freshnessWarning: boolean
): PublicStatus => {
  const observed = worstPublicStatus(statuses);
  return freshnessWarning && observed === 'operational' ? 'unknown' : observed;
};
