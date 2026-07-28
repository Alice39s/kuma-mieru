# Control RPC

Kuma Mieru v2 exposes an optional ConnectRPC control plane for integrating automation and other applications. Its source of truth is `proto/kuma/mieru/control/v1/control.proto`; the wire format is Protobuf JSON Mapping, not JSON-RPC 2.0.

## Listener

The Control RPC runs in the Kuma Node process on a separate listener:

```text
KUMA_MIERU_CONTROL_ADDR=127.0.0.1:3883
```

Loopback is the secure default. A non-loopback address also requires `KUMA_MIERU_CONTROL_ALLOW_REMOTE=true` and trusted TLS termination. Do not publish the plaintext listener directly.

## Authentication

An Owner creates a scoped key in **Admin → Security → Control RPC keys**. The full key appears once; copy it into the client secret store. Requests use:

```http
Authorization: Bearer <control-api-key>
Content-Type: application/json
```

`readonly` keys can inspect providers, monitors, and operations. `manager` keys can also mutate providers and monitors and resolve uncertain operations. Keys can be revoked from the same Security panel.

## Supported Providers and Operations

The first provider adapters are UptimeRobot v3 and Better Stack Uptime v2. Provider credentials are encrypted by Kuma's Secret Store and never returned through RPC.

The portable monitor boundary is deliberately narrow:

- list and get monitors;
- create and update credential-free HTTPS GET/HEAD monitors;
- pause and resume monitors.

Monitor deletion, alert-contact mutation, custom headers/bodies, and non-HTTP monitor types are not supported.

## Safe Mutation Model

Every mutation requires an opaque 8–200 character `request_id`. Retrying the same payload returns its existing operation; reusing the ID with a different payload fails. Provider config uses an expected revision, while monitor mutation uses the latest fingerprint.

If a network failure occurs after a provider request may have been sent, Kuma records `OUTCOME_UNKNOWN` and does not retry automatically. A Manager must inspect the provider and explicitly resolve the operation as applied or not applied.

## Client Generation

Generate clients from the checked-in schema with Buf/Connect tooling. Do not hand-code RPC paths or camel-case JSON fields. Additive fields preserve compatibility; breaking changes require a new protobuf package version.
