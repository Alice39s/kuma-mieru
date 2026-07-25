import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseSpecSchema, resolveReleaseRefPolicy } from "../src/server/release/spec.ts";

const spec = releaseSpecSchema.parse(
  JSON.parse(await readFile(resolve("release", "v2", "release-spec.json"), "utf8")),
);
const policy = resolveReleaseRefPolicy(spec, {
  eventName: process.env.GITHUB_EVENT_NAME ?? "pull_request",
  ref: process.env.GITHUB_REF ?? "refs/pull/local/merge",
  commit: process.env.GITHUB_SHA ?? "0000000000000000000000000000000000000000",
  repository: process.env.GITHUB_REPOSITORY ?? "Alice39s/kuma-mieru",
});
const image = spec.container.image;
const values = {
  version: spec.version,
  channel: spec.channel,
  stable: String(spec.stable),
  publish: String(policy.publish),
  require_main_ancestry: String(policy.requireMainAncestry),
  immutable_tag: policy.immutableTag,
  tags: policy.tags.map((tag) => `${image}:${tag}`).join("\n"),
};
const output = process.env.GITHUB_OUTPUT;
if (output) {
  const lines = Object.entries(values).flatMap(([key, value]) =>
    value.includes("\n") ? [`${key}<<EOF`, value, "EOF"] : [`${key}=${value}`],
  );
  await appendFile(output, `${lines.join("\n")}\n`);
}
process.stdout.write(
  `${JSON.stringify({ spec, policy, tags: values.tags.split("\n") }, null, 2)}\n`,
);
