import { createHmac } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import type Database from 'better-sqlite3';
import {
  OperationSchema,
  OperationState,
  type Operation,
} from './gen/kuma/mieru/control/v1/control_pb.js';

interface OperationRow {
  request_id: string;
  request_hash: string;
  principal_id: string;
  provider_id: string;
  action: string;
  external_id: string | null;
  state: string;
  error_code: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

const stateMap: Record<string, OperationState> = {
  pending: OperationState.PENDING,
  succeeded: OperationState.SUCCEEDED,
  failed: OperationState.FAILED,
  outcome_unknown: OperationState.OUTCOME_UNKNOWN,
  resolved_applied: OperationState.RESOLVED_APPLIED,
  resolved_not_applied: OperationState.RESOLVED_NOT_APPLIED,
};

export const operationMessage = (row: OperationRow): Operation =>
  create(OperationSchema, {
    requestId: row.request_id,
    state: stateMap[row.state] ?? OperationState.UNSPECIFIED,
    action: row.action,
    providerId: row.provider_id,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: timestampFromDate(new Date(row.created_at)),
    updatedAt: timestampFromDate(new Date(row.updated_at)),
  });

export const createOperationStore = (database: Database.Database, hmacKey: string) => {
  const hash = (value: unknown) =>
    createHmac('sha256', hmacKey).update(JSON.stringify(value)).digest('hex');
  const getRow = (requestId: string) =>
    database.prepare('SELECT * FROM control_operations WHERE request_id = ?').get(requestId) as
      | OperationRow
      | undefined;

  const begin = (input: {
    requestId: string;
    principalId: string;
    providerId: string;
    action: string;
    payload: unknown;
  }) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(input.requestId)) {
      throw Object.assign(new Error('request_id must be an opaque 8-200 character identifier'), {
        code: 'invalid_argument',
      });
    }
    const requestHash = hash({
      principalId: input.principalId,
      providerId: input.providerId,
      action: input.action,
      payload: input.payload,
    });
    const existing = getRow(input.requestId);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw Object.assign(new Error('request_id was already used for a different mutation'), {
          code: 'already_exists',
        });
      }
      return { operation: operationMessage(existing), replay: true };
    }
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO control_operations
          (request_id, request_hash, principal_id, provider_id, action, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.requestId,
        requestHash,
        input.principalId,
        input.providerId,
        input.action,
        now,
        now
      );
    return { operation: operationMessage(getRow(input.requestId)!), replay: false };
  };

  const complete = (
    requestId: string,
    input: {
      state: 'succeeded' | 'failed' | 'outcome_unknown';
      externalId?: string;
      errorCode?: string;
      result?: unknown;
    }
  ) => {
    database
      .prepare(
        `UPDATE control_operations
         SET state = ?, external_id = ?, error_code = ?, result_json = ?, updated_at = ?
         WHERE request_id = ? AND state = 'pending'`
      )
      .run(
        input.state,
        input.externalId ?? null,
        input.errorCode ?? null,
        input.result === undefined ? null : JSON.stringify(input.result),
        new Date().toISOString(),
        requestId
      );
    return operationMessage(getRow(requestId)!);
  };

  const get = (requestId: string) => {
    const row = getRow(requestId);
    if (!row) throw Object.assign(new Error('Operation was not found'), { code: 'not_found' });
    return operationMessage(row);
  };

  const list = (limit: number, offset: number) =>
    (
      database
        .prepare(
          'SELECT * FROM control_operations ORDER BY created_at DESC, request_id DESC LIMIT ? OFFSET ?'
        )
        .all(limit, offset) as OperationRow[]
    ).map(operationMessage);

  const resolve = (requestId: string, applied: boolean, externalId?: string) => {
    const row = getRow(requestId);
    if (!row) throw Object.assign(new Error('Operation was not found'), { code: 'not_found' });
    if (row.state !== 'outcome_unknown') {
      throw Object.assign(new Error('Only outcome_unknown operations can be resolved'), {
        code: 'failed_precondition',
      });
    }
    if (applied && !externalId && !row.external_id) {
      throw Object.assign(new Error('Applied resolution requires an external_id'), {
        code: 'invalid_argument',
      });
    }
    database
      .prepare(
        `UPDATE control_operations
         SET state = ?, external_id = COALESCE(?, external_id), updated_at = ?
         WHERE request_id = ? AND state = 'outcome_unknown'`
      )
      .run(
        applied ? 'resolved_applied' : 'resolved_not_applied',
        externalId ?? null,
        new Date().toISOString(),
        requestId
      );
    return operationMessage(getRow(requestId)!);
  };

  return { begin, complete, get, list, resolve };
};

export type OperationStore = ReturnType<typeof createOperationStore>;
