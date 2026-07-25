import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { TLSSocket } from 'node:tls';
import test from 'node:test';
import { promisify } from 'node:util';
import { SMTPServer } from 'smtp-server';
import { createSmtpTransport } from './smtp.js';

const workerEnvironment = 'KUMA_MIERU_SMTP_LIVE_WORKER';
const caPathEnvironment = 'KUMA_MIERU_SMTP_LIVE_CA_PATH';
const certificatePathEnvironment = 'KUMA_MIERU_SMTP_LIVE_CERT_PATH';
const keyPathEnvironment = 'KUMA_MIERU_SMTP_LIVE_KEY_PATH';
const execFileAsync = promisify(execFile);

const requiredEnvironment = (name: string) => {
  const value = process.env[name];
  assert.ok(value, `${name} is required by the live SMTP worker`);
  return value;
};

const createTlsFixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-smtp-live-'));
  try {
    const caKeyPath = resolve(directory, 'ca-key.pem');
    const caPath = resolve(directory, 'ca.pem');
    const certificateRequestPath = resolve(directory, 'server.csr');
    const certificatePath = resolve(directory, 'server-cert.pem');
    const keyPath = resolve(directory, 'server-key.pem');
    const extensionPath = resolve(directory, 'server.ext');
    await writeFile(
      extensionPath,
      [
        'subjectAltName=IP:127.0.0.1',
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    await execFileAsync('openssl', [
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-out',
      caKeyPath,
    ]);
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-new',
      '-key',
      caKeyPath,
      '-sha256',
      '-days',
      '1',
      '-subj',
      '/CN=Kuma Mieru Ephemeral Test CA',
      '-out',
      caPath,
    ]);
    await execFileAsync('openssl', [
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-out',
      keyPath,
    ]);
    await execFileAsync('openssl', [
      'req',
      '-new',
      '-key',
      keyPath,
      '-subj',
      '/CN=127.0.0.1',
      '-out',
      certificateRequestPath,
    ]);
    await execFileAsync('openssl', [
      'x509',
      '-req',
      '-in',
      certificateRequestPath,
      '-CA',
      caPath,
      '-CAkey',
      caKeyPath,
      '-CAcreateserial',
      '-days',
      '1',
      '-sha256',
      '-extfile',
      extensionPath,
      '-out',
      certificatePath,
    ]);
    return { caPath, certificatePath, directory, keyPath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

const listen = (server: SMTPServer) =>
  new Promise<number>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      const address = server.server.address();
      assert.ok(address && typeof address === 'object');
      resolveListen(address.port);
    });
  });

const close = (server: SMTPServer) =>
  new Promise<void>(resolveClose => {
    server.close(resolveClose);
  });

const runLiveSmtpWorker = async () => {
  const [key, cert] = await Promise.all([
    readFile(requiredEnvironment(keyPathEnvironment), 'utf8'),
    readFile(requiredEnvironment(certificatePathEnvironment), 'utf8'),
  ]);
  const received: Array<{
    envelopeFrom: string | undefined;
    envelopeTo: string[];
    raw: string;
    secure: boolean;
  }> = [];
  const protocols: string[] = [];
  let authenticationCount = 0;
  const server = new SMTPServer({
    name: 'smtp-gate.kuma-mieru.test',
    key,
    cert,
    secure: false,
    authMethods: ['PLAIN'],
    authOptional: false,
    disableReverseLookup: true,
    socketTimeout: 5_000,
    closeTimeout: 2_000,
    onSecure: (socket, session, callback) => {
      assert.ok(socket instanceof TLSSocket);
      assert.equal(session.secure, true);
      protocols.push(socket.getProtocol() ?? 'unknown');
      callback();
    },
    onAuth: (auth, session, callback) => {
      assert.equal(session.secure, true);
      if (auth.username !== 'smtp-gate' || auth.password !== 'smtp-gate-password') {
        callback(Object.assign(new Error('Invalid fixture credentials'), { responseCode: 535 }));
        return;
      }
      authenticationCount += 1;
      callback(null, { user: auth.username });
    },
    onData: (stream, session, callback) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.once('error', callback);
      stream.once('end', () => {
        received.push({
          envelopeFrom:
            session.envelope.mailFrom === false ? undefined : session.envelope.mailFrom.address,
          envelopeTo: session.envelope.rcptTo.map(recipient => recipient.address),
          raw: Buffer.concat(chunks).toString('utf8'),
          secure: session.secure,
        });
        callback(null, 'Queued by Kuma Mieru integration gate');
      });
    },
  });

  let transport: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    const port = await listen(server);
    transport = createSmtpTransport({
      host: '127.0.0.1',
      port,
      tls: 'starttls',
      username: 'smtp-gate',
      password: 'smtp-gate-password',
      from: { address: 'status@example.test', name: 'Kuma Mieru Status' },
      replyTo: 'support@example.test',
    });
    await transport.verify();
    const result = await transport.send({
      to: 'operator@example.test',
      subject: 'Kuma Mieru live SMTP gate',
      text: 'This message crossed a certificate-verified STARTTLS connection.',
      messageId: '<smtp-live-gate@kuma-mieru.test>',
      headers: { 'X-Kuma-Mieru-Gate': 'smtp-live' },
    });

    assert.equal(result.messageId, '<smtp-live-gate@kuma-mieru.test>');
    assert.equal(received.length, 1);
    assert.equal(received[0]?.secure, true);
    assert.equal(received[0]?.envelopeFrom, 'status@example.test');
    assert.deepEqual(received[0]?.envelopeTo, ['operator@example.test']);
    assert.equal(authenticationCount >= 1, true);
    assert.equal(protocols.length >= 1, true);
    assert.equal(
      protocols.every(protocol => /^TLSv1\.[23]$/u.test(protocol)),
      true
    );

    const raw = received[0]?.raw ?? '';
    assert.match(raw, /^From: "?Kuma Mieru Status"? <status@example\.test>$/mu);
    assert.match(raw, /^To: operator@example\.test$/mu);
    assert.match(raw, /^Reply-To: support@example\.test$/mu);
    assert.match(raw, /^Subject: Kuma Mieru live SMTP gate$/mu);
    assert.match(raw, /^Message-ID: <smtp-live-gate@kuma-mieru\.test>$/mu);
    assert.match(raw, /^X-Kuma-Mieru-Gate: smtp-live$/mu);
    assert.match(raw, /This message crossed a certificate-verified STARTTLS connection\./u);

    process.stdout.write(
      `${JSON.stringify({
        authenticationCount,
        deliveries: received.length,
        messageId: result.messageId,
        protocols: [...new Set(protocols)],
      })}\n`
    );
  } finally {
    transport?.close();
    await close(server);
  }
};

if (process.env[workerEnvironment] === '1') {
  await runLiveSmtpWorker();
} else {
  test(
    'delivers through a certificate-verified STARTTLS mail sink',
    { timeout: 20_000 },
    async () => {
      const fixture = await createTlsFixture();
      try {
        const child = spawn(process.execPath, [import.meta.filename], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            [caPathEnvironment]: fixture.caPath,
            [certificatePathEnvironment]: fixture.certificatePath,
            [keyPathEnvironment]: fixture.keyPath,
            [workerEnvironment]: '1',
            NODE_EXTRA_CA_CERTS: fixture.caPath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          stdout += chunk;
        });
        child.stderr.on('data', chunk => {
          stderr += chunk;
        });

        let timeout: NodeJS.Timeout | undefined;
        try {
          const result = await Promise.race([
            once(child, 'exit'),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('Live SMTP worker timed out'));
              }, 15_000);
            }),
          ]);
          const [exitCode, signal] = result;
          assert.equal(
            exitCode,
            0,
            `Live SMTP worker failed with signal ${String(signal)}:\n${stderr}`
          );
          assert.equal(stderr, '');
          const evidence = JSON.parse(stdout.trim()) as {
            authenticationCount: number;
            deliveries: number;
            messageId: string;
            protocols: string[];
          };
          assert.equal(evidence.authenticationCount >= 1, true);
          assert.equal(evidence.deliveries, 1);
          assert.equal(evidence.messageId, '<smtp-live-gate@kuma-mieru.test>');
          assert.equal(evidence.protocols.length >= 1, true);
          assert.equal(
            evidence.protocols.every(protocol => /^TLSv1\.[23]$/u.test(protocol)),
            true
          );
        } finally {
          if (timeout) clearTimeout(timeout);
          if (child.exitCode === null) child.kill('SIGKILL');
        }
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }
  );
}
