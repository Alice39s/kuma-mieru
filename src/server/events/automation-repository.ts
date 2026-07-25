import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { AuditContext } from '../config/managed-config.js';
import {
  resolveSignalAutomationConfig,
  type CanonicalConfig,
  type SignalAutomationConfig,
} from '../config/schema.js';
import { normalizedSnapshotSchema, type NormalizedSnapshot } from '../adapters/types.js';
import {
  appendIncidentUpdate,
  createIncident,
  eventError,
  getIncident,
  type IncidentRecord,
} from './repository.js';

export const signalAutomationRuleVersion = 'signal-suggest-v1';

const suggestionEvidenceSchema = z.object({
  ruleVersion: z.literal(signalAutomationRuleVersion),
  pageId: z.string(),
  sourceId: z.string(),
  sourcePageId: z.string(),
  serviceId: z.string(),
  serviceName: z.string(),
  normalizedStatus: z.string(),
  rawStatus: z.union([z.string(), z.number()]),
  observedAt: z.string().datetime({ offset: true }),
  consecutiveCount: z.number().int().positive(),
  requiredCount: z.number().int().positive(),
  snapshotStatus: z.string(),
});

type SuggestionEvidence = z.infer<typeof suggestionEvidenceSchema>;
type SignalClassification = 'healthy' | 'degraded' | 'maintenance' | 'unknown';
type SuggestionKind = 'degradation' | 'recovery';
type SuggestionState = 'pending' | 'accepted' | 'ignored' | 'superseded';

interface TrackRow {
  classification: SignalClassification;
  consecutive_count: number;
  last_observed_at: string;
  active_native_event_id: string | null;
  cooldown_until: string | null;
}

interface SuggestionRow {
  id: string;
  kind: SuggestionKind;
  state: SuggestionState;
  version: number;
  page_id: string;
  source_id: string;
  source_page_id: string;
  service_id: string;
  service_name: string;
  title: string;
  body: string;
  rule_version: string;
  evidence_json: string;
  native_event_id: string | null;
  native_event_version: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_actor: string | null;
}

interface SuggestionEntryRow {
  sequence: number;
  kind: 'created' | 'evidence_updated' | 'accepted' | 'ignored' | 'superseded';
  evidence_json: string;
  occurred_at: string;
  actor_id: string;
}

export interface AutomationSuggestionView {
  id: string;
  origin: 'automation';
  notificationEligible: false;
  kind: SuggestionKind;
  state: SuggestionState;
  version: number;
  pageId: string;
  sourceId: string;
  sourcePageId: string;
  serviceId: string;
  serviceName: string;
  title: string;
  body: string;
  ruleVersion: string;
  evidence: SuggestionEvidence;
  nativeEventId: string | null;
  nativeEventVersion: number | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionActor: string | null;
}

export interface AutomationSuggestionEntryView {
  sequence: number;
  kind: SuggestionEntryRow['kind'];
  evidence: SuggestionEvidence;
  occurredAt: string;
  actorId: string;
}

const classificationFor = (status: NormalizedSnapshot['services'][number]['status']) => {
  if (status === 'operational') return 'healthy' as const;
  if (status === 'degraded' || status === 'partial_outage' || status === 'major_outage') {
    return 'degraded' as const;
  }
  if (status === 'maintenance') return 'maintenance' as const;
  return 'unknown' as const;
};

const observationIdFor = (
  pageId: string,
  sourceId: string,
  sourcePageId: string,
  serviceId: string,
  observedAt: string
) =>
  `sig_${createHash('sha256')
    .update(`${pageId}\0${sourceId}\0${sourcePageId}\0${serviceId}\0${observedAt}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;

const truncate = (value: string, maximum: number) =>
  value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;

const viewFor = (row: SuggestionRow): AutomationSuggestionView => ({
  id: row.id,
  origin: 'automation',
  notificationEligible: false,
  kind: row.kind,
  state: row.state,
  version: row.version,
  pageId: row.page_id,
  sourceId: row.source_id,
  sourcePageId: row.source_page_id,
  serviceId: row.service_id,
  serviceName: row.service_name,
  title: row.title,
  body: row.body,
  ruleVersion: row.rule_version,
  evidence: suggestionEvidenceSchema.parse(JSON.parse(row.evidence_json)),
  nativeEventId: row.native_event_id,
  nativeEventVersion: row.native_event_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
  resolutionActor: row.resolution_actor,
});

const suggestionRow = (database: Database.Database, suggestionId: string) =>
  database.prepare('SELECT * FROM automation_suggestions WHERE id = ?').get(suggestionId) as
    | SuggestionRow
    | undefined;

const pendingSuggestion = (
  database: Database.Database,
  pageId: string,
  sourceId: string,
  sourcePageId: string,
  serviceId: string
) =>
  database
    .prepare(
      `SELECT * FROM automation_suggestions
       WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?
         AND state = 'pending'`
    )
    .get(pageId, sourceId, sourcePageId, serviceId) as SuggestionRow | undefined;

const insertEntry = (
  database: Database.Database,
  suggestion: SuggestionRow,
  kind: SuggestionEntryRow['kind'],
  evidence: SuggestionEvidence,
  occurredAt: string,
  actorId: string
) => {
  database
    .prepare(
      `INSERT INTO automation_suggestion_entries
        (id, suggestion_id, sequence, kind, evidence_json, occurred_at, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      suggestion.id,
      suggestion.version,
      kind,
      JSON.stringify(evidence),
      occurredAt,
      actorId
    );
};

const writeAutomationAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  suggestionId: string,
  after: unknown
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, after_json)
       VALUES (?, ?, ?, ?, 'automation_suggestion', ?, ?, ?, ?, 'success', ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      suggestionId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      JSON.stringify(after)
    );
};

const resolveSuggestion = (
  database: Database.Database,
  row: SuggestionRow,
  state: Extract<SuggestionState, 'accepted' | 'ignored' | 'superseded'>,
  actorId: string,
  occurredAt: string,
  nativeEvent?: IncidentRecord
) => {
  const version = row.version + 1;
  database
    .prepare(
      `UPDATE automation_suggestions
       SET state = ?, version = ?, native_event_id = COALESCE(?, native_event_id),
           native_event_version = COALESCE(?, native_event_version),
           updated_at = ?, resolved_at = ?, resolution_actor = ?
       WHERE id = ?`
    )
    .run(
      state,
      version,
      nativeEvent?.id ?? null,
      nativeEvent?.version ?? null,
      occurredAt,
      occurredAt,
      actorId,
      row.id
    );
  const resolved = suggestionRow(database, row.id) as SuggestionRow;
  insertEntry(
    database,
    resolved,
    state === 'superseded' ? 'superseded' : state,
    suggestionEvidenceSchema.parse(JSON.parse(row.evidence_json)),
    occurredAt,
    actorId
  );
  return resolved;
};

const createSuggestion = (
  database: Database.Database,
  kind: SuggestionKind,
  evidence: SuggestionEvidence,
  now: string,
  nativeEvent?: IncidentRecord
) => {
  const id = randomUUID();
  const title =
    kind === 'degradation'
      ? truncate(`${evidence.serviceName} is ${evidence.normalizedStatus}`, 200)
      : truncate(`${evidence.serviceName} appears recovered`, 200);
  const body =
    kind === 'degradation'
      ? `Kuma Mieru observed ${evidence.serviceName} as ${evidence.normalizedStatus} in ${evidence.consecutiveCount} consecutive successful source snapshots. Review the source evidence before publishing.`
      : `Kuma Mieru observed ${evidence.serviceName} as operational in ${evidence.consecutiveCount} consecutive successful source snapshots. Review the recovery evidence before resolving the linked incident.`;
  database
    .prepare(
      `INSERT INTO automation_suggestions
        (id, kind, state, version, page_id, source_id, source_page_id, service_id,
         service_name, title, body, rule_version, evidence_json, native_event_id,
         native_event_version, created_at, updated_at)
       VALUES (?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      kind,
      evidence.pageId,
      evidence.sourceId,
      evidence.sourcePageId,
      evidence.serviceId,
      truncate(evidence.serviceName, 500),
      title,
      truncate(body, 50_000),
      signalAutomationRuleVersion,
      JSON.stringify(evidence),
      nativeEvent?.id ?? null,
      nativeEvent?.version ?? null,
      now,
      now
    );
  const created = suggestionRow(database, id) as SuggestionRow;
  insertEntry(database, created, 'created', evidence, now, 'system:automation');
  return created;
};

const updateSuggestionEvidence = (
  database: Database.Database,
  row: SuggestionRow,
  evidence: SuggestionEvidence,
  now: string
) => {
  const previous = suggestionEvidenceSchema.parse(JSON.parse(row.evidence_json));
  if (
    previous.normalizedStatus === evidence.normalizedStatus &&
    previous.rawStatus === evidence.rawStatus
  ) {
    return row;
  }
  database
    .prepare(
      `UPDATE automation_suggestions
       SET version = version + 1, evidence_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(JSON.stringify(evidence), now, row.id);
  const updated = suggestionRow(database, row.id) as SuggestionRow;
  insertEntry(database, updated, 'evidence_updated', evidence, now, 'system:automation');
  return updated;
};

const insertDecision = (
  database: Database.Database,
  observationId: string,
  outcome: string,
  evidence: SuggestionEvidence,
  now: string,
  suggestionId?: string
) => {
  database
    .prepare(
      `INSERT INTO automation_decisions
        (id, observation_id, rule_version, outcome, evidence_json, suggestion_id, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      observationId,
      signalAutomationRuleVersion,
      outcome,
      JSON.stringify(evidence),
      suggestionId ?? null,
      now
    );
};

const reconcileService = (
  database: Database.Database,
  input: {
    pageId: string;
    snapshot: NormalizedSnapshot;
    service: NormalizedSnapshot['services'][number];
    policy: SignalAutomationConfig;
    recordedAt: string;
  }
) => {
  const { pageId, snapshot, service, policy, recordedAt } = input;
  const observedAt = snapshot.fetchedAt;
  const existingTrack = database
    .prepare(
      `SELECT classification, consecutive_count, last_observed_at,
              active_native_event_id, cooldown_until
       FROM signal_automation_tracks
       WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?`
    )
    .get(pageId, snapshot.sourceId, snapshot.pageId, service.id) as TrackRow | undefined;
  if (existingTrack && Date.parse(observedAt) <= Date.parse(existingTrack.last_observed_at)) {
    return 'stale';
  }

  const observationId = observationIdFor(
    pageId,
    snapshot.sourceId,
    snapshot.pageId,
    service.id,
    observedAt
  );
  const inserted = database
    .prepare(
      `INSERT OR IGNORE INTO signal_observations
        (id, page_id, source_id, source_page_id, service_id, service_name,
         normalized_status, raw_status_json, latency_ms, observed_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      observationId,
      pageId,
      snapshot.sourceId,
      snapshot.pageId,
      service.id,
      truncate(service.name, 500),
      service.status,
      JSON.stringify(service.rawStatus),
      service.latencyMs,
      observedAt,
      recordedAt
    );
  if (inserted.changes === 0) return 'duplicate';

  const classification = classificationFor(service.status);
  const consecutiveCount =
    existingTrack?.classification === classification ? existingTrack.consecutive_count + 1 : 1;
  database
    .prepare(
      `INSERT INTO signal_automation_tracks
        (page_id, source_id, source_page_id, service_id, classification, consecutive_count,
         last_observation_id, last_observed_at, active_native_event_id, cooldown_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, source_id, source_page_id, service_id) DO UPDATE SET
         classification = excluded.classification,
         consecutive_count = excluded.consecutive_count,
         last_observation_id = excluded.last_observation_id,
         last_observed_at = excluded.last_observed_at,
         updated_at = excluded.updated_at`
    )
    .run(
      pageId,
      snapshot.sourceId,
      snapshot.pageId,
      service.id,
      classification,
      consecutiveCount,
      observationId,
      observedAt,
      existingTrack?.active_native_event_id ?? null,
      existingTrack?.cooldown_until ?? null,
      recordedAt
    );

  const requiredCount =
    classification === 'healthy' ? policy.recoveryConsecutive : policy.degradedConsecutive;
  const evidence = suggestionEvidenceSchema.parse({
    ruleVersion: signalAutomationRuleVersion,
    pageId,
    sourceId: snapshot.sourceId,
    sourcePageId: snapshot.pageId,
    serviceId: service.id,
    serviceName: truncate(service.name, 500),
    normalizedStatus: service.status,
    rawStatus: service.rawStatus,
    observedAt,
    consecutiveCount,
    requiredCount,
    snapshotStatus: snapshot.status,
  });
  const pending = pendingSuggestion(
    database,
    pageId,
    snapshot.sourceId,
    snapshot.pageId,
    service.id
  );

  let outcome = 'healthy';
  let suggestion: SuggestionRow | undefined;
  if (policy.defaultAction === 'disabled') {
    if (pending) {
      resolveSuggestion(database, pending, 'superseded', 'system:automation', recordedAt);
      outcome = 'action_disabled_suggestion_superseded';
    } else {
      outcome = 'action_disabled';
    }
  } else if (classification === 'maintenance') {
    if (pending) {
      resolveSuggestion(database, pending, 'superseded', 'system:automation', recordedAt);
    }
    outcome = 'maintenance_suppressed';
  } else if (classification === 'unknown') {
    outcome = 'insufficient_evidence';
  } else if (
    existingTrack?.cooldown_until &&
    Date.parse(existingTrack.cooldown_until) > Date.parse(recordedAt)
  ) {
    outcome = 'cooldown';
  } else if (classification === 'degraded') {
    const activeIncident = existingTrack?.active_native_event_id
      ? getIncident(database, existingTrack.active_native_event_id)
      : null;
    if (activeIncident && activeIncident.state !== 'resolved') {
      if (pending?.kind === 'recovery') {
        resolveSuggestion(database, pending, 'superseded', 'system:automation', recordedAt);
        outcome = 'recovery_superseded';
      } else {
        outcome = 'active_incident';
      }
    } else if (consecutiveCount < policy.degradedConsecutive) {
      outcome = 'debouncing_degradation';
    } else {
      if (pending?.kind === 'recovery') {
        resolveSuggestion(database, pending, 'superseded', 'system:automation', recordedAt);
      }
      const current = pending?.kind === 'degradation' ? pending : undefined;
      suggestion = current
        ? updateSuggestionEvidence(database, current, evidence, recordedAt)
        : createSuggestion(database, 'degradation', evidence, recordedAt);
      outcome = current ? 'degradation_pending' : 'degradation_created';
    }
  } else {
    const activeIncident = existingTrack?.active_native_event_id
      ? getIncident(database, existingTrack.active_native_event_id)
      : null;
    if (consecutiveCount < policy.recoveryConsecutive) {
      outcome = 'debouncing_recovery';
    } else if (pending?.kind === 'degradation') {
      resolveSuggestion(database, pending, 'superseded', 'system:automation', recordedAt);
      outcome = 'degradation_superseded';
    } else if (activeIncident && activeIncident.state !== 'resolved') {
      suggestion =
        pending?.kind === 'recovery'
          ? updateSuggestionEvidence(database, pending, evidence, recordedAt)
          : createSuggestion(database, 'recovery', evidence, recordedAt, activeIncident);
      outcome = pending ? 'recovery_pending' : 'recovery_created';
    } else {
      if (existingTrack?.active_native_event_id) {
        database
          .prepare(
            `UPDATE signal_automation_tracks
             SET active_native_event_id = NULL, updated_at = ?
             WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?`
          )
          .run(recordedAt, pageId, snapshot.sourceId, snapshot.pageId, service.id);
      }
      outcome = 'healthy';
    }
  }
  insertDecision(database, observationId, outcome, evidence, recordedAt, suggestion?.id);
  return outcome;
};

export const reconcileSignalAutomation = (
  database: Database.Database,
  config: CanonicalConfig,
  rawSnapshot: NormalizedSnapshot,
  { now = () => new Date() }: { now?: () => Date } = {}
) => {
  const snapshot = normalizedSnapshotSchema.parse(rawSnapshot);
  const source = config.sources.find(candidate => candidate.id === snapshot.sourceId);
  if (!source || !source.pageIds.some(pageId => pageId === snapshot.pageId)) return {};
  const pageIds = config.pages
    .filter(page => page.sourceRefs.includes(snapshot.sourceId))
    .map(page => page.id);
  const policy = resolveSignalAutomationConfig(config.events?.automation);
  const counts = new Map<string, number>();
  return database.transaction(() => {
    for (const pageId of pageIds) {
      for (const service of snapshot.services) {
        const outcome = reconcileService(database, {
          pageId,
          snapshot,
          service,
          policy,
          recordedAt: now().toISOString(),
        });
        counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
      }
    }
    return Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    );
  })();
};

export const listAutomationSuggestions = (
  database: Database.Database,
  state?: SuggestionState
): AutomationSuggestionView[] => {
  const rows = (
    state
      ? database
          .prepare(
            `SELECT * FROM automation_suggestions
             WHERE state = ? ORDER BY updated_at DESC, id LIMIT 200`
          )
          .all(state)
      : database
          .prepare(
            `SELECT * FROM automation_suggestions
             ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, updated_at DESC, id LIMIT 200`
          )
          .all()
  ) as SuggestionRow[];
  return rows.map(viewFor);
};

export const getAutomationSuggestion = (
  database: Database.Database,
  suggestionId: string
): (AutomationSuggestionView & { entries: AutomationSuggestionEntryView[] }) | null => {
  const row = suggestionRow(database, suggestionId);
  if (!row) return null;
  const entries = database
    .prepare(
      `SELECT sequence, kind, evidence_json, occurred_at, actor_id
       FROM automation_suggestion_entries
       WHERE suggestion_id = ? ORDER BY sequence`
    )
    .all(suggestionId) as SuggestionEntryRow[];
  return {
    ...viewFor(row),
    entries: entries.map(entry => ({
      sequence: entry.sequence,
      kind: entry.kind,
      evidence: suggestionEvidenceSchema.parse(JSON.parse(entry.evidence_json)),
      occurredAt: entry.occurred_at,
      actorId: entry.actor_id,
    })),
  };
};

export const acceptAutomationSuggestion = (
  database: Database.Database,
  input: {
    suggestionId: string;
    expectedVersion: number;
    expectedNativeEventVersion?: number;
    idempotencyKey: string;
  },
  audit: AuditContext
) =>
  database.transaction(() => {
    const row = suggestionRow(database, input.suggestionId);
    if (!row) throw eventError('automation_suggestion_not_found', 'Suggestion does not exist');
    if (row.state === 'accepted' && row.native_event_id) {
      const incident = getIncident(database, row.native_event_id);
      if (!incident) throw eventError('event_not_found', 'Accepted incident no longer exists');
      return { suggestion: viewFor(row), incident };
    }
    if (row.state !== 'pending') {
      throw eventError('automation_suggestion_resolved', 'Suggestion is no longer pending');
    }
    if (row.version !== input.expectedVersion) {
      throw eventError(
        'automation_suggestion_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${row.version}`
      );
    }
    const evidence = suggestionEvidenceSchema.parse(JSON.parse(row.evidence_json));
    let incident: IncidentRecord;
    if (row.kind === 'degradation') {
      incident = createIncident(
        database,
        {
          pageId: row.page_id,
          title: truncate(row.title, 200),
          body: truncate(row.body, 50_000),
          state: 'investigating',
          affectedComponentIds: [row.service_id],
          occurredAt: evidence.observedAt,
        },
        `automation:${row.id}:${input.idempotencyKey}`,
        audit
      );
      database
        .prepare(
          `UPDATE signal_automation_tracks
           SET active_native_event_id = ?, cooldown_until = NULL, updated_at = ?
           WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?`
        )
        .run(
          incident.id,
          new Date().toISOString(),
          row.page_id,
          row.source_id,
          row.source_page_id,
          row.service_id
        );
    } else {
      if (!row.native_event_id || !row.native_event_version) {
        throw eventError('automation_target_missing', 'Recovery suggestion has no linked incident');
      }
      if (input.expectedNativeEventVersion !== row.native_event_version) {
        throw eventError(
          'automation_target_version_conflict',
          'Recovery suggestion target version must be reviewed explicitly'
        );
      }
      const current = getIncident(database, row.native_event_id);
      if (!current) throw eventError('event_not_found', 'Linked incident does not exist');
      if (current.version !== row.native_event_version) {
        throw eventError(
          'automation_target_version_conflict',
          `Linked incident advanced from version ${row.native_event_version} to ${current.version}`
        );
      }
      incident = appendIncidentUpdate(
        database,
        current.id,
        {
          expectedVersion: current.version,
          state: 'resolved',
          body: truncate(row.body, 50_000),
          affectedComponentIds: [row.service_id],
          occurredAt: evidence.observedAt,
        },
        audit
      );
      database
        .prepare(
          `UPDATE signal_automation_tracks
           SET active_native_event_id = NULL, cooldown_until = NULL, updated_at = ?
           WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?`
        )
        .run(
          new Date().toISOString(),
          row.page_id,
          row.source_id,
          row.source_page_id,
          row.service_id
        );
    }
    const accepted = resolveSuggestion(
      database,
      row,
      'accepted',
      audit.actorId,
      new Date().toISOString(),
      incident
    );
    writeAutomationAudit(database, audit, 'automation_suggestion.accept', row.id, {
      version: accepted.version,
      nativeEventId: incident.id,
      nativeEventVersion: incident.version,
    });
    return { suggestion: viewFor(accepted), incident };
  })();

export const ignoreAutomationSuggestion = (
  database: Database.Database,
  input: {
    suggestionId: string;
    expectedVersion: number;
    cooldownMs: number;
    now?: () => Date;
  },
  audit: AuditContext
) =>
  database.transaction(() => {
    const row = suggestionRow(database, input.suggestionId);
    if (!row) throw eventError('automation_suggestion_not_found', 'Suggestion does not exist');
    if (row.state === 'ignored') return viewFor(row);
    if (row.state !== 'pending') {
      throw eventError('automation_suggestion_resolved', 'Suggestion is no longer pending');
    }
    if (row.version !== input.expectedVersion) {
      throw eventError(
        'automation_suggestion_version_conflict',
        `Expected version ${input.expectedVersion}, active version is ${row.version}`
      );
    }
    const now = input.now?.() ?? new Date();
    database
      .prepare(
        `UPDATE signal_automation_tracks
         SET cooldown_until = ?, updated_at = ?
         WHERE page_id = ? AND source_id = ? AND source_page_id = ? AND service_id = ?`
      )
      .run(
        new Date(now.getTime() + input.cooldownMs).toISOString(),
        now.toISOString(),
        row.page_id,
        row.source_id,
        row.source_page_id,
        row.service_id
      );
    const ignored = resolveSuggestion(database, row, 'ignored', audit.actorId, now.toISOString());
    writeAutomationAudit(database, audit, 'automation_suggestion.ignore', row.id, {
      version: ignored.version,
      cooldownMs: input.cooldownMs,
    });
    return viewFor(ignored);
  })();
