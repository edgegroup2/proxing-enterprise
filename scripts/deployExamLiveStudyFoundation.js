'use strict';

const assert =
  require('node:assert/strict');

const crypto =
  require('node:crypto');

const fs =
  require('node:fs');

const path =
  require('node:path');

const {
  spawnSync,
} = require(
  'node:child_process'
);

const db =
  require('../src/db');

const {
  readLiveStudyConfig,
} = require(
  '../src/config/liveStudyConfig'
);

const MODE =
  String(
    process.argv[2] ||
    'preflight'
  )
    .trim()
    .toLowerCase();

const MIGRATION_PATH =
  path.resolve(
    __dirname,
    '..',
    'migrations',
    '20260721_001_exam_live_study_foundation.sql'
  );

const BACKUP_ROOT =
  path.resolve(
    __dirname,
    '..',
    'backups',
    'exam-live-study'
  );

const AUDIT_ROOT =
  path.resolve(
    __dirname,
    '..',
    'audits'
  );

const TABLES =
  Object.freeze([
    'exam_live_study_events',
    'exam_live_study_participants',
    'exam_live_study_sessions',
  ]);

const BACKUP_TABLES =
  Object.freeze([
    'public.users',
    'public.study_rooms',
    'public.study_room_members',
  ]);

const REQUIRED_INDEXES =
  Object.freeze([
    'exam_live_study_sessions_one_active_per_room',
    'exam_live_study_sessions_provider_room_unique',
  ]);

const REQUIRED_CONSTRAINTS =
  Object.freeze([
    'exam_live_study_sessions_room_id_fkey',
    'exam_live_study_sessions_waiting_room_disabled_check',
    'exam_live_study_sessions_publish_policy_check',

    'exam_live_study_participants_session_id_fkey',
    'exam_live_study_participants_user_id_fkey',

    'exam_live_study_events_session_id_fkey',
    'exam_live_study_events_actor_user_id_fkey',
    'exam_live_study_events_type_check',
  ]);

const ADVISORY_LOCK_NAMESPACE =
  'proxing';

const ADVISORY_LOCK_NAME =
  '20260721_001_exam_live_study_foundation';

function timestamp() {
  return new Date()
    .toISOString()
    .replace(
      /[-:]/g,
      ''
    )
    .replace(
      /\.\d{3}Z$/,
      'Z'
    );
}

function sha256(
  value
) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function prepareMigrationBody(
  migrationSql
) {
  assert.equal(
    /\bCONCURRENTLY\b/i.test(
      migrationSql
    ),
    false,
    'Migration must not use CREATE INDEX CONCURRENTLY'
  );

  const transactionStatements = [
    ...migrationSql.matchAll(
      /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gim
    ),
  ].map(
    (match) =>
      match[1].toUpperCase()
  );

  assert.deepEqual(
    transactionStatements,
    [
      'BEGIN',
      'COMMIT',
    ],
    'Expected exactly one BEGIN and one COMMIT wrapper'
  );

  const withoutBegin =
    migrationSql.replace(
      /^\s*BEGIN\s*;\s*$/im,
      ''
    );

  const migrationBody =
    withoutBegin.replace(
      /^\s*COMMIT\s*;\s*$/im,
      ''
    );

  assert.equal(
    /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/im.test(
      migrationBody
    ),
    false,
    'Unexpected transaction statement remains in migration body'
  );

  return migrationBody;
}

function assertRouterUnmounted() {
  const files = [
    path.resolve(
      __dirname,
      '..',
      'src',
      'index.js'
    ),

    path.resolve(
      __dirname,
      '..',
      'src',
      'routes',
      'learn.js'
    ),
  ];

  for (
    const filePath
    of files
  ) {
    const source =
      fs.readFileSync(
        filePath,
        'utf8'
      );

    assert.equal(
      source.includes(
        'learnLiveStudy'
      ),
      false,
      `Live Study router is already mounted in ${filePath}`
    );
  }
}

function assertPgDumpAvailable() {
  const result =
    spawnSync(
      'pg_dump',
      [
        '--version',
      ],
      {
        encoding:
          'utf8',
      }
    );

  assert.equal(
    result.error,
    undefined,
    'pg_dump could not be executed'
  );

  assert.equal(
    result.status,
    0,
    `pg_dump availability check failed: ${String(result.stderr || '').trim()}`
  );

  return String(
    result.stdout || ''
  ).trim();
}

function resolveConnectionParameters(
  client
) {
  const clientParameters =
    client
      ?.connectionParameters ||
    {};

  const poolOptions =
    db.pool
      ?.options ||
    {};

  const database =
    clientParameters.database ||
    poolOptions.database ||
    process.env.PGDATABASE;

  const user =
    clientParameters.user ||
    poolOptions.user ||
    process.env.PGUSER;

  const host =
    clientParameters.host ||
    poolOptions.host ||
    process.env.PGHOST ||
    'localhost';

  const port =
    clientParameters.port ||
    poolOptions.port ||
    process.env.PGPORT ||
    5432;

  const password =
    clientParameters.password ||
    poolOptions.password ||
    process.env.PGPASSWORD ||
    null;

  assert.ok(
    database,
    'Database name is unavailable for pg_dump'
  );

  assert.ok(
    user,
    'Database user is unavailable for pg_dump'
  );

  return {
    database:
      String(database),

    user:
      String(user),

    host:
      String(host),

    port:
      String(port),

    password:
      password === null ||
      password === undefined
        ? null
        : String(password),
  };
}

function createSchemaBackup({
  client,
  migrationHash,
}) {
  const deploymentTimestamp =
    timestamp();

  const directory =
    path.join(
      BACKUP_ROOT,
      deploymentTimestamp
    );

  fs.mkdirSync(
    directory,
    {
      recursive: true,
      mode: 0o700,
    }
  );

  const backupPath =
    path.join(
      directory,
      'pre-migration-dependency-schema.sql'
    );

  const manifestPath =
    path.join(
      directory,
      'deployment-manifest.json'
    );

  const connection =
    resolveConnectionParameters(
      client
    );

  const environment = {
    ...process.env,

    PGCONNECT_TIMEOUT:
      process.env
        .PGCONNECT_TIMEOUT ||
      '10',
  };

  if (
    connection.password
  ) {
    environment.PGPASSWORD =
      connection.password;
  }

  const dumpArguments = [
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--format=plain',
    '--strict-names',

    '--host',
    connection.host,

    '--port',
    connection.port,

    '--username',
    connection.user,
  ];

  for (
    const tableName
    of BACKUP_TABLES
  ) {
    dumpArguments.push(
      '--table',
      tableName
    );
  }

  dumpArguments.push(
    '--file',
    backupPath,
    connection.database
  );

  const result =
    spawnSync(
      'pg_dump',
      dumpArguments,
      {
        env:
          environment,

        encoding:
          'utf8',

        maxBuffer:
          10 * 1024 * 1024,
      }
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  assert.equal(
    result.status,
    0,
    `pg_dump failed: ${String(result.stderr || '').trim()}`
  );

  const backupStats =
    fs.statSync(
      backupPath
    );

  assert.ok(
    backupStats.size > 0,
    'Dependency schema backup was created but is empty'
  );

  const manifest = {
    status:
      'prepared',

    migration:
      path.basename(
        MIGRATION_PATH
      ),

    migrationSha256:
      migrationHash,

    database:
      connection.database,

    databaseUser:
      connection.user,

    backupType:
      'dependency-schema-only',

    backupScope:
      [...BACKUP_TABLES],

    backupPath:
      path.relative(
        path.resolve(
          __dirname,
          '..'
        ),
        backupPath
      ),

    backupBytes:
      backupStats.size,

    preparedAt:
      new Date()
        .toISOString(),
  };

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      manifest,
      null,
      2
    )}\n`,
    {
      mode: 0o600,
    }
  );

  return {
    directory,
    backupPath,
    manifestPath,
    manifest,
  };
}

async function readExistingTables(
  client
) {
  const result =
    await client.query(`
      SELECT table_name

      FROM information_schema.tables

      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])

      ORDER BY table_name
    `, [
      TABLES,
    ]);

  return result.rows.map(
    (row) =>
      row.table_name
  );
}

async function readDatabaseIdentity(
  client
) {
  const result =
    await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS active_schema,
        current_setting(
          'server_version'
        ) AS server_version
    `);

  return result.rows[0];
}

async function verifyAppliedSchema(
  client
) {
  const tables =
    await readExistingTables(
      client
    );

  assert.deepEqual(
    tables,
    [...TABLES],
    'Live Study foundation tables are incomplete'
  );

  const indexResult =
    await client.query(`
      SELECT indexname

      FROM pg_indexes

      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])

      ORDER BY indexname
    `, [
      TABLES,
    ]);

  const indexes =
    new Set(
      indexResult.rows.map(
        (row) =>
          row.indexname
      )
    );

  for (
    const requiredIndex
    of REQUIRED_INDEXES
  ) {
    assert.equal(
      indexes.has(
        requiredIndex
      ),
      true,
      `Missing required index: ${requiredIndex}`
    );
  }

  const constraintResult =
    await client.query(`
      SELECT
        constraint_name

      FROM information_schema.table_constraints

      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])

      ORDER BY constraint_name
    `, [
      TABLES,
    ]);

  const constraints =
    new Set(
      constraintResult.rows.map(
        (row) =>
          row.constraint_name
      )
    );

  for (
    const requiredConstraint
    of REQUIRED_CONSTRAINTS
  ) {
    assert.equal(
      constraints.has(
        requiredConstraint
      ),
      true,
      `Missing required constraint: ${requiredConstraint}`
    );
  }

  const countResult =
    await client.query(`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM exam_live_study_sessions
        ) AS sessions,

        (
          SELECT COUNT(*)::integer
          FROM exam_live_study_participants
        ) AS participants,

        (
          SELECT COUNT(*)::integer
          FROM exam_live_study_events
        ) AS events
    `);

  const counts =
    countResult.rows[0];

  assert.deepEqual(
    counts,
    {
      sessions: 0,
      participants: 0,
      events: 0,
    },
    'New Live Study tables must initially be empty'
  );

  return {
    tables,
    indexes:
      REQUIRED_INDEXES,
    constraints:
      REQUIRED_CONSTRAINTS,
    counts,
  };
}

async function acquireDeploymentLock(
  client
) {
  await client.query(
    `
      SELECT pg_advisory_lock(
        hashtext($1),
        hashtext($2)
      )
    `,
    [
      ADVISORY_LOCK_NAMESPACE,
      ADVISORY_LOCK_NAME,
    ]
  );
}

async function releaseDeploymentLock(
  client
) {
  await client.query(
    `
      SELECT pg_advisory_unlock(
        hashtext($1),
        hashtext($2)
      )
    `,
    [
      ADVISORY_LOCK_NAMESPACE,
      ADVISORY_LOCK_NAME,
    ]
  );
}

function writeFinalAudit({
  manifestPath,
  manifest,
  status,
  verification = null,
  error = null,
}) {
  const finalManifest = {
    ...manifest,

    status,

    completedAt:
      new Date()
        .toISOString(),

    verification,

    error:
      error
        ? {
            message:
              error.message,

            code:
              error.code ||
              null,

            constraint:
              error.constraint ||
              null,
          }
        : null,
  };

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      finalManifest,
      null,
      2
    )}\n`,
    {
      mode: 0o600,
    }
  );
}

async function run() {
  assert.equal(
    [
      'preflight',
      'apply',
    ].includes(
      MODE
    ),
    true,
    'Usage: node scripts/deployExamLiveStudyFoundation.js preflight|apply'
  );

  const migrationSql =
    fs.readFileSync(
      MIGRATION_PATH,
      'utf8'
    );

  const migrationBody =
    prepareMigrationBody(
      migrationSql
    );

  const migrationHash =
    sha256(
      migrationSql
    );

  const pgDumpVersion =
    assertPgDumpAvailable();

  assertRouterUnmounted();

  const config =
    readLiveStudyConfig();

  assert.equal(
    config.enabledDefault,
    false,
    'LIVE_STUDY_ENABLED_DEFAULT must remain false during schema deployment'
  );

  const client =
    await db.getClient();

  let lockHeld = false;
  let transactionOpen = false;
  let committed = false;
  let deploymentFiles = null;

  try {
    await acquireDeploymentLock(
      client
    );

    lockHeld = true;

    const identity =
      await readDatabaseIdentity(
        client
      );

    const existingTables =
      await readExistingTables(
        client
      );

    assert.deepEqual(
      existingTables,
      [],
      `Refusing deployment because Live Study tables already exist: ${existingTables.join(', ')}`
    );

    console.log({
      mode:
        MODE,

      database:
        identity.database_name,

      databaseUser:
        identity.database_user,

      activeSchema:
        identity.active_schema,

      serverVersion:
        identity.server_version,

      migration:
        path.basename(
          MIGRATION_PATH
        ),

      migrationSha256:
        migrationHash,

      pgDumpVersion,

      liveStudyEnabled:
        config.enabledDefault,

      providerConfigured:
        config.livekit
          ?.configured === true,

      routerMounted:
        false,

      existingLiveStudyTables:
        existingTables,
    });

    if (
      MODE === 'preflight'
    ) {
      console.log(
        'R66A STAGE 5D PREFLIGHT PASS'
      );

      return;
    }

    assert.equal(
      process.env
        .APPLY_EXAM_LIVE_STUDY_FOUNDATION,
      'YES',
      'Permanent apply requires APPLY_EXAM_LIVE_STUDY_FOUNDATION=YES'
    );

    deploymentFiles =
      createSchemaBackup({
        client,
        migrationHash,
      });

    console.log(
      `✓ Dependency schema backup created: ${path.relative(
        path.resolve(
          __dirname,
          '..'
        ),
        deploymentFiles.backupPath
      )}`
    );

    await client.query(
      'BEGIN'
    );

    transactionOpen = true;

    await client.query(
      migrationBody
    );

    const verification =
      await verifyAppliedSchema(
        client
      );

    console.log(
      '✓ Migration verification passed inside the deployment transaction'
    );

    await client.query(
      'COMMIT'
    );

    transactionOpen = false;
    committed = true;

    writeFinalAudit({
      manifestPath:
        deploymentFiles
          .manifestPath,

      manifest:
        deploymentFiles
          .manifest,

      status:
        'applied',

      verification,
    });

    const auditCopyPath =
      path.join(
        AUDIT_ROOT,
        `exam-live-study-foundation-${timestamp()}.json`
      );

    fs.mkdirSync(
      AUDIT_ROOT,
      {
        recursive: true,
      }
    );

    fs.copyFileSync(
      deploymentFiles
        .manifestPath,
      auditCopyPath
    );

    console.log(
      `✓ Deployment audit written: ${path.relative(
        path.resolve(
          __dirname,
          '..'
        ),
        auditCopyPath
      )}`
    );

    console.log(
      'R66A STAGE 5D APPLY PASS'
    );
  } catch (error) {
    if (
      transactionOpen
    ) {
      try {
        await client.query(
          'ROLLBACK'
        );

        transactionOpen =
          false;

        console.error(
          '✓ Deployment transaction rolled back'
        );
      } catch (
        rollbackError
      ) {
        console.error(
          'DEPLOYMENT ROLLBACK FAILURE:',
          rollbackError.message
        );
      }
    }

    if (
      deploymentFiles
    ) {
      try {
        writeFinalAudit({
          manifestPath:
            deploymentFiles
              .manifestPath,

          manifest:
            deploymentFiles
              .manifest,

          status:
            committed
              ? 'applied_audit_failure'
              : 'failed',

          error,
        });
      } catch (
        auditError
      ) {
        console.error(
          'AUDIT WRITE FAILURE:',
          auditError.message
        );
      }
    }

    if (
      committed
    ) {
      console.error(
        'IMPORTANT: The database transaction committed before the later failure.'
      );
    }

    throw error;
  } finally {
    if (
      lockHeld
    ) {
      try {
        await releaseDeploymentLock(
          client
        );
      } catch (
        unlockError
      ) {
        console.error(
          'ADVISORY LOCK RELEASE FAILURE:',
          unlockError.message
        );
      }
    }

    client.release();
  }
}

run()
  .catch((error) => {
    console.error(
      'R66A STAGE 5D FAIL:',
      {
        message:
          error.message,

        code:
          error.code ||
          null,

        constraint:
          error.constraint ||
          null,
      }
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
