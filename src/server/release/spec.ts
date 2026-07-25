import { z } from "zod";

const releaseVersionPattern =
  /^2\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>dev(?:\.\d+)?|alpha\.\d+|beta\.\d+|rc\.\d+))?$/u;

export const releaseChannelSchema = z.enum(["development", "alpha", "beta", "rc", "stable"]);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;

export const releaseSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    product: z.literal("kuma-mieru"),
    version: z.string().regex(releaseVersionPattern),
    channel: releaseChannelSchema,
    stable: z.boolean(),
    runtime: z.object({
      node: z.string().min(1),
      uid: z.number().int().positive(),
      gid: z.number().int().positive(),
      dataDirectory: z.literal("/data"),
    }),
    database: z.object({
      minimumSchemaVersion: z.number().int().nonnegative(),
      maximumSchemaVersion: z.number().int().positive(),
    }),
    container: z.object({
      image: z.string().regex(/^ghcr\.io\/[a-z0-9-]+\/[a-z0-9-]+$/u),
      developmentTag: z.literal("2-dev"),
      readOnlyRootFilesystem: z.literal(true),
      dropAllCapabilities: z.literal(true),
      noNewPrivileges: z.literal(true),
      dockerSocket: z.literal(false),
    }),
    compatibility: z.object({
      supportedMajor: z.literal(2),
      legacyRoutes: z.array(z.string().startsWith("/")).min(1),
      legacyEnvironment: z.array(z.string().min(1)).min(1),
    }),
  })
  .superRefine((spec, context) => {
    const match = releaseVersionPattern.exec(spec.version);
    const prerelease = match?.groups?.prerelease;
    const expectedChannel: ReleaseChannel = prerelease?.startsWith("dev")
      ? "development"
      : prerelease?.startsWith("alpha.")
        ? "alpha"
        : prerelease?.startsWith("beta.")
          ? "beta"
          : prerelease?.startsWith("rc.")
            ? "rc"
            : "stable";
    if (spec.channel !== expectedChannel) {
      context.addIssue({
        code: "custom",
        path: ["channel"],
        message: `version ${spec.version} requires channel ${expectedChannel}`,
      });
    }
    if (spec.stable !== (expectedChannel === "stable")) {
      context.addIssue({
        code: "custom",
        path: ["stable"],
        message: "stable must be true exactly for a stable semantic version",
      });
    }
    if (spec.database.minimumSchemaVersion > spec.database.maximumSchemaVersion) {
      context.addIssue({
        code: "custom",
        path: ["database"],
        message: "minimumSchemaVersion must not exceed maximumSchemaVersion",
      });
    }
  });

export type ReleaseSpec = z.infer<typeof releaseSpecSchema>;

export interface ReleaseRefPolicy {
  publish: boolean;
  immutableTag: string;
  tags: string[];
  requireMainAncestry: boolean;
}

export const resolveReleaseRefPolicy = (
  spec: ReleaseSpec,
  input: { eventName: string; ref: string; commit: string; repository: string },
): ReleaseRefPolicy => {
  const shortCommit = z
    .string()
    .regex(/^[0-9a-f]{7,64}$/u)
    .parse(input.commit)
    .slice(0, 12);
  const immutableTag = `sha-${shortCommit}`;
  const officialRepository = spec.container.image.slice("ghcr.io/".length);
  if (input.repository.toLowerCase() !== officialRepository) {
    return { publish: false, immutableTag, tags: [immutableTag], requireMainAncestry: false };
  }
  if (input.eventName === "pull_request" || input.eventName === "workflow_dispatch") {
    return { publish: false, immutableTag, tags: [immutableTag], requireMainAncestry: false };
  }
  if (input.eventName !== "push") {
    throw new Error(`Unsupported release event: ${input.eventName}`);
  }
  if (input.ref === "refs/heads/v2-dev") {
    if (spec.channel !== "development") {
      throw new Error("v2-dev may publish only a development release specification");
    }
    return {
      publish: true,
      immutableTag,
      tags: [spec.container.developmentTag, immutableTag],
      requireMainAncestry: false,
    };
  }
  const tag = input.ref.startsWith("refs/tags/v") ? input.ref.slice("refs/tags/v".length) : null;
  if (!tag || tag !== spec.version) {
    throw new Error("Release tags must be exactly v<release-spec.version>");
  }
  if (spec.channel === "development") {
    throw new Error("Development builds cannot be published from a Git tag");
  }
  const tags = [spec.version, immutableTag];
  if (spec.channel === "stable") {
    const [, minor] = spec.version.split(".");
    tags.push(`2.${minor}`, "2", "latest");
  }
  return {
    publish: true,
    immutableTag,
    tags,
    requireMainAncestry: spec.channel === "stable",
  };
};
