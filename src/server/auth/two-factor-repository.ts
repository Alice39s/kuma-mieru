import type Database from 'better-sqlite3';

export interface AdminTwoFactorStatus {
  enabled: boolean;
  setupPending: boolean;
  recoveryCodesConfigured: boolean;
}

type TwoFactorStatusRow = {
  twoFactorEnabled: number | boolean;
  verified: number | boolean | null;
  twoFactorId: string | null;
};

export const getAdminTwoFactorStatus = (
  database: Database.Database,
  userId: string
): AdminTwoFactorStatus => {
  const row = database
    .prepare(
      `SELECT u."twoFactorEnabled",
              tf.id AS twoFactorId,
              tf.verified
       FROM "user" u
       LEFT JOIN "twoFactor" tf ON tf."userId" = u.id
       WHERE u.id = ?
       ORDER BY tf.id
       LIMIT 1`
    )
    .get(userId) as TwoFactorStatusRow | undefined;
  const verified = row?.verified !== null && Boolean(row?.verified);
  const configured = Boolean(row?.twoFactorId);
  return {
    enabled: Boolean(row?.twoFactorEnabled) && configured && verified,
    setupPending: configured && !verified,
    recoveryCodesConfigured: Boolean(row?.twoFactorEnabled) && configured && verified,
  };
};
