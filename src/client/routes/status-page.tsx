import { Alert, Button, Card, Chip, Separator } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  BarChart3,
  BellRing,
  BookOpen,
  ChevronLeft,
  Clock3,
  History,
  Megaphone,
  RadioTower,
  RefreshCw,
} from 'lucide-react';
import { Link, useLoaderData, useParams, useRouteLoaderData } from 'react-router';
import type { PublicBootstrap, SourceSnapshotState, StatusPagePayload } from '../api';
import { PublicEventTimeline } from '../public-event-timeline';
import { PublicMirroredEvents } from '../public-mirrored-events';
import { PublicSubscription } from '../public-subscription';
import {
  presentationForStatus,
  statusForPublicEvidence,
  type PublicStatus,
} from '../status-presentation';

type PublicService = SourceSnapshotState['snapshot']['services'][number];

interface ServiceGroup {
  id: string;
  name: string;
  sourceTitle: string;
  services: PublicService[];
}

const statusTone: Record<PublicStatus, string> = {
  operational: 'bg-emerald-700 text-white',
  degraded: 'bg-amber-400 text-amber-950',
  partial_outage: 'bg-orange-700 text-white',
  major_outage: 'bg-rose-700 text-white',
  maintenance: 'bg-sky-700 text-white',
  paused: 'bg-violet-700 text-white',
  pending: 'bg-zinc-800 text-white',
  unknown: 'bg-zinc-800 text-white',
};

const statusChipColor = (
  status: PublicStatus
): 'accent' | 'danger' | 'default' | 'success' | 'warning' => {
  if (status === 'operational') return 'success';
  if (status === 'major_outage' || status === 'partial_outage') return 'danger';
  if (status === 'degraded' || status === 'maintenance') return 'warning';
  if (status === 'paused') return 'accent';
  return 'default';
};

const humanizeGroupName = (name: string) => {
  if (!name.includes('-') && !name.includes('_')) return name;
  const spaced = name.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  if (spaced.length === 0) return 'Services';
  return spaced
    .split(' ')
    .filter(Boolean)
    .map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`)
    .join(' ');
};

const buildServiceGroups = (sources: SourceSnapshotState[] | undefined): ServiceGroup[] => {
  if (!sources) return [];

  return sources.flatMap(source => {
    const servicesById = new Map(
      source.snapshot.services.map(service => [service.id, service] as const)
    );
    const claimedServiceIds = new Set<string>();
    const groups = [...source.snapshot.groups]
      .sort((left, right) => left.position - right.position)
      .map(group => {
        const services = group.serviceIds.flatMap(serviceId => {
          const service = servicesById.get(serviceId);
          if (!service) return [];
          claimedServiceIds.add(serviceId);
          return [service];
        });
        return {
          id: `${source.snapshot.sourceId}:${group.id}`,
          name: humanizeGroupName(group.name),
          sourceTitle: source.snapshot.title,
          services,
        };
      })
      .filter(group => group.services.length > 0);

    const ungrouped = source.snapshot.services.filter(
      service => !claimedServiceIds.has(service.id)
    );
    if (ungrouped.length > 0) {
      groups.push({
        id: `${source.snapshot.sourceId}:ungrouped`,
        name: groups.length > 0 ? 'Other services' : 'Services',
        sourceTitle: source.snapshot.title,
        services: ungrouped,
      });
    }
    return groups;
  });
};

const tagValue = (service: PublicService, name: string) =>
  service.tags.find(tag => tag.name === name)?.value;

const PublicAction = ({
  children,
  icon: Icon,
  primary = false,
  to,
}: {
  children: React.ReactNode;
  icon: typeof History;
  primary?: boolean;
  to: string;
}) => (
  <Link
    className={buttonVariants({
      size: 'sm',
      variant: primary ? 'primary' : 'outline',
      className: 'shrink-0 gap-2',
    })}
    to={to}
  >
    <Icon aria-hidden="true" size={15} />
    {children}
  </Link>
);

const ServiceCard = ({
  pageSlug,
  service,
  sourceTitle,
}: {
  pageSlug: string;
  service: PublicService;
  sourceTitle: string;
}) => {
  const presentation = presentationForStatus(service.status);
  const StatusIcon = presentation.Icon;
  const model = tagValue(service, 'model');
  const provider = tagValue(service, 'provider_route');
  const displayName = model ?? service.name;
  const secondaryName = model ? (provider ?? sourceTitle) : sourceTitle;
  const visibleTags = service.tags
    .filter(tag => tag.name !== 'model' && tag.name !== 'provider_route')
    .slice(0, 4);

  return (
    <motion.div className="h-full" transition={{ duration: 0.18 }} whileHover={{ y: -2 }}>
      <Card className="h-full border border-separator shadow-none transition-shadow hover:shadow-md">
        <Card.Header className="flex-row items-start justify-between gap-4 pb-3">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
              <RadioTower aria-hidden="true" size={14} />
              <span className="truncate">{secondaryName}</span>
            </div>
            <Link
              aria-label={service.name}
              className="group inline-flex max-w-full items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"
              to={`/status/${encodeURIComponent(pageSlug)}/service/${encodeURIComponent(service.id)}/`}
            >
              <span className="truncate">{displayName}</span>
              <ArrowUpRight
                aria-hidden="true"
                className="shrink-0 text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                size={15}
              />
            </Link>
          </div>
          <Chip
            className="shrink-0"
            color={statusChipColor(service.status)}
            size="sm"
            variant="soft"
          >
            <StatusIcon aria-hidden="true" size={13} />
            <Chip.Label>{presentation.label}</Chip.Label>
          </Chip>
        </Card.Header>
        {visibleTags.length > 0 ? (
          <Card.Content className="flex flex-wrap gap-1.5 py-0">
            {visibleTags.map(tag => (
              <Chip
                className="max-w-full"
                color={tag.name.includes('region') ? 'success' : 'default'}
                key={`${tag.name}:${tag.value ?? ''}`}
                size="sm"
                variant="soft"
              >
                <Chip.Label className="truncate">
                  {tag.value ? `${tag.name.replaceAll('_', ' ')}: ${tag.value}` : tag.name}
                </Chip.Label>
              </Chip>
            ))}
          </Card.Content>
        ) : null}
        <Card.Footer className="mt-5 block border-t border-separator pt-4">
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[11px] font-medium text-muted">Latency</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {service.latencyMs === null ? '—' : `${service.latencyMs} ms`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium text-muted">Uptime · 24h</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                {service.uptime24h === null ? '—' : `${service.uptime24h.toFixed(2)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium text-muted">Observed</dt>
              <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-foreground">
                {service.observedAt
                  ? new Intl.DateTimeFormat(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(service.observedAt))
                  : '—'}
              </dd>
            </div>
          </dl>
        </Card.Footer>
      </Card>
    </motion.div>
  );
};

export const StatusPage = () => {
  const data = useRouteLoaderData('root') as PublicBootstrap;
  const payload = useLoaderData() as StatusPagePayload;
  const snapshot = payload.snapshot;
  const { pageId, pageSlug } = useParams();
  const slug = pageSlug ?? pageId;
  const page = data.pages.find(candidate => candidate.slug === slug || candidate.id === slug);
  const sourceStatuses = snapshot?.data.map(item => item.snapshot.status) ?? ([] as PublicStatus[]);
  const staleSourceCount = snapshot?.data.filter(item => item.health.stale).length ?? 0;
  const sourceCount = snapshot?.data.length ?? 0;
  const partialCoverage = snapshot?.meta.status === 'partial';
  const freshnessWarning = staleSourceCount > 0 || partialCoverage;
  const overallStatus = statusForPublicEvidence(sourceStatuses, freshnessWarning);
  const overallPresentation = presentationForStatus(overallStatus);
  const OverallIcon = overallPresentation.Icon;
  const latestSnapshotAt = snapshot?.data
    .map(item => Date.parse(item.snapshot.fetchedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const hasNativeMetrics =
    snapshot?.data.some(item => item.snapshot.capabilities.nativeMetrics) ?? false;
  const hasMethodology =
    snapshot?.data.some(item => {
      const extension = item.snapshot.extensions['llm-mieru'];
      if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
        return false;
      }
      const features = (extension as Record<string, unknown>).upstreamFeatures;
      return Array.isArray(features) && features.includes('methodology');
    }) ?? false;
  const serviceGroups = buildServiceGroups(snapshot?.data);
  const publicServices = [
    ...new Map<string, { id: string; name: string }>(
      (snapshot?.data ?? [])
        .flatMap(item => item.snapshot.services)
        .map(service => [service.id, { id: service.id, name: service.name }] as const)
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const serviceCount = publicServices.length;

  if (!page) {
    return (
      <Card className="mx-auto max-w-xl border border-separator shadow-none">
        <Card.Header>
          <Card.Title>Status page not found</Card.Title>
          <Card.Description>The requested public status page is not configured.</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} to="/">
            <ChevronLeft aria-hidden="true" size={16} />
            Return to overview
          </Link>
        </Card.Footer>
      </Card>
    );
  }

  const issueLabels = payload.issues.map(issue => {
    if (issue.resource === 'snapshot') return 'live service status';
    if (issue.resource === 'events') return 'published updates';
    return 'mirrored source history';
  });

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-foreground"
        to="/"
      >
        <ChevronLeft aria-hidden="true" size={16} />
        All status pages
      </Link>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip color="default" size="sm" variant="soft">
              <span className="size-1.5 rounded-full bg-muted" />
              <Chip.Label>Public status</Chip.Label>
            </Chip>
            <Chip color="default" size="sm" variant="soft">
              <Chip.Label>Local snapshot</Chip.Label>
            </Chip>
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span>
              {serviceCount} monitored {serviceCount === 1 ? 'service' : 'services'}
            </span>
            {latestSnapshotAt ? (
              <time
                className="inline-flex items-center gap-1.5"
                dateTime={new Date(latestSnapshotAt).toISOString()}
              >
                <Clock3 aria-hidden="true" size={14} />
                Updated {new Date(latestSnapshotAt).toLocaleString()}
              </time>
            ) : (
              <span>Waiting for the first successful poll</span>
            )}
          </p>
        </div>
        <nav
          aria-label="Status page navigation"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:max-w-[58%] sm:justify-end"
        >
          <PublicAction icon={History} to={`/status/${encodeURIComponent(page.slug)}/history/`}>
            History
          </PublicAction>
          <PublicAction icon={Megaphone} to={`/status/${encodeURIComponent(page.slug)}/notices/`}>
            Notices
          </PublicAction>
          <PublicAction icon={BellRing} to={`/status/${encodeURIComponent(page.slug)}/subscribe/`}>
            Subscribe
          </PublicAction>
        </nav>
      </header>

      <section
        aria-label="Overall status"
        aria-live="polite"
        className={`mt-8 overflow-hidden rounded-2xl px-5 py-5 shadow-sm sm:px-7 sm:py-6 ${statusTone[overallStatus]}`}
        role="status"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/15">
              <OverallIcon aria-hidden="true" size={23} strokeWidth={2.25} />
            </span>
            <div>
              <p className="text-lg font-semibold tracking-[-0.02em]">
                {overallPresentation.label}
              </p>
              <p className="mt-0.5 text-sm">{overallPresentation.summary}</p>
            </div>
          </div>
          <div className="shrink-0 text-sm font-medium sm:text-right">
            {!snapshot
              ? 'No current source snapshot'
              : staleSourceCount > 0
                ? `${staleSourceCount} of ${sourceCount} sources stale`
                : partialCoverage
                  ? 'Partial source coverage'
                  : `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} current`}
          </div>
        </div>
      </section>

      {payload.issues.length > 0 ? (
        <Alert className="mt-4" status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Some public data is temporarily unavailable</Alert.Title>
            <Alert.Description>
              Available status data remains visible. Missing: {issueLabels.join(', ')}.
            </Alert.Description>
          </Alert.Content>
          <Button
            aria-label="Reload public status data"
            onPress={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" size={14} />
            Retry
          </Button>
        </Alert>
      ) : null}

      <div className="mt-10 space-y-10">
        {serviceGroups.length > 0 ? (
          serviceGroups.map(group => (
            <section aria-labelledby={`group-${group.id}`} key={group.id}>
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2
                    className="text-xl font-semibold tracking-[-0.025em] text-foreground"
                    id={`group-${group.id}`}
                  >
                    {group.name}
                  </h2>
                  {snapshot && snapshot.data.length > 1 ? (
                    <p className="mt-1 text-xs text-muted">{group.sourceTitle}</p>
                  ) : null}
                </div>
                <span className="text-xs font-medium text-muted">
                  {group.services.length} {group.services.length === 1 ? 'service' : 'services'}
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.services.map(service => (
                  <ServiceCard
                    key={service.id}
                    pageSlug={page.slug}
                    service={service}
                    sourceTitle={group.sourceTitle}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <Card className="border border-separator shadow-none" variant="secondary">
            <Card.Header>
              <Card.Title>No service observations yet</Card.Title>
              <Card.Description>
                {snapshot
                  ? 'The current local snapshot does not contain a public service.'
                  : 'The first local source snapshot has not completed.'}
              </Card.Description>
            </Card.Header>
          </Card>
        )}

        {hasNativeMetrics || hasMethodology ? (
          <Card className="border border-separator shadow-none" variant="secondary">
            <Card.Content className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Measurement details</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Inspect native performance metrics and the protocol used to collect them.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasNativeMetrics ? (
                  <PublicAction
                    icon={BarChart3}
                    primary
                    to={`/status/${encodeURIComponent(page.slug)}/metrics`}
                  >
                    Metrics
                  </PublicAction>
                ) : null}
                {hasMethodology ? (
                  <PublicAction
                    icon={BookOpen}
                    to={`/status/${encodeURIComponent(page.slug)}/methodology`}
                  >
                    Methodology
                  </PublicAction>
                ) : null}
              </div>
            </Card.Content>
          </Card>
        ) : null}
      </div>

      <Separator className="my-12" />
      <PublicEventTimeline
        description="Incidents, maintenance, and notices published by the page team."
        emptyDescription="Live monitor evidence remains available above."
        emptyTitle="No incidents or maintenance reported."
        eyebrow="Status history"
        pageSlug={page.slug}
        publications={payload.publications}
        title="Recent updates"
      />
      <PublicMirroredEvents events={payload.mirroredEvents} />
      {data.meta.capabilities.emailSubscriptions ? (
        <PublicSubscription pageSlug={page.slug} services={publicServices} />
      ) : null}
    </div>
  );
};
