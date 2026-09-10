import { valid, validRange } from "semver";
import {
  matchNotification,
  parseNotificationFeed,
} from "../src/lib/notifications.js";
import type {
  NotificationContext,
  NotificationFeed,
  NotificationCohort,
} from "../src/lib/notifications.js";

export type AuthoringFields = Record<string, string>;
export const CONDITION_FIELDS = [
  "sdkVersion",
  "framework",
  "intelligence",
  "plan",
  "runtimeVersion",
  "deployment",
  "license",
] as const;
export const DEFAULT_FIELDS: AuthoringFields = {
  title: "Update CopilotKit",
  body: "A new update is available.\n\nReview the release notes before updating your SDK.",
  cohortName: "Stable SDKs without Intelligence",
  sdkVersion: ">=1.70.1 <1.71.0",
  intelligence: "disabled",
  priority: "Normal",
  clientSdkVersion: "1.70.2",
  clientFramework: "react",
  clientIntelligence: "disabled",
  clientPlan: "",
};
export const PRESETS: Record<
  string,
  { label: string; fields: AuthoringFields }
> = {
  "non-intelligence": {
    label: "Version range · without Intelligence",
    fields: {},
  },
  "exact-version": {
    label: "Exact version fix",
    fields: {
      cohortName: "React 1.70.2",
      framework: "react",
      sdkVersion: "1.70.2",
      intelligence: "",
      title: "A fix for your SDK version",
      priority: "High",
    },
  },
  upgrade: {
    label: "Older SDKs",
    fields: {
      cohortName: "SDKs before 1.70.2",
      sdkVersion: "<1.70.2",
      intelligence: "",
      clientSdkVersion: "1.70.1",
      title: "Upgrade your SDK",
    },
  },
  intelligence: {
    label: "Intelligence users",
    fields: {
      cohortName: "Intelligence enabled",
      sdkVersion: "",
      intelligence: "enabled",
      clientIntelligence: "enabled",
      title: "An update for Intelligence",
    },
  },
  pro: {
    label: "Pro plan",
    fields: {
      cohortName: "Intelligence Pro",
      sdkVersion: "",
      intelligence: "enabled",
      plan: "pro",
      clientIntelligence: "enabled",
      clientPlan: "pro",
      title: "An update for Pro teams",
    },
  },
  everyone: {
    label: "All stable SDKs",
    fields: {
      cohortName: "All stable SDKs",
      sdkVersion: "",
      intelligence: "",
      title: "What's new in CopilotKit",
    },
  },
};
export function presetFields(key: string): AuthoringFields {
  return { ...DEFAULT_FIELDS, ...PRESETS[key]?.fields };
}

export function compilePreview(
  fields: AuthoringFields,
  savedCohorts?: NotificationCohort[],
): {
  feed: NotificationFeed;
  context: NotificationContext;
  result: ReturnType<typeof matchNotification>;
  prompt: string;
} {
  if (!fields.title?.trim()) throw new Error("Add a notification title.");
  if (!fields.body?.trim()) throw new Error("Add a Markdown body.");
  if (!fields.cohortName?.trim()) throw new Error("Name this cohort.");
  const conditions: Record<string, string> = {};
  for (const key of CONDITION_FIELDS) {
    const value = savedCohorts ? undefined : fields[key]?.trim();
    if (value) conditions[key] = value;
  }
  for (const key of ["sdkVersion", "runtimeVersion"]) {
    if (conditions[key] && !validRange(conditions[key]))
      throw new Error(
        `Invalid ${key} range. Use npm semver, for example >=1.70.1 <1.71.0.`,
      );
  }
  const override = fields.priorityOverride?.trim();
  if (
    override &&
    (!/^\d+$/.test(override) || !Number.isSafeInteger(Number(override)))
  )
    throw new Error("Priority override must be a nonnegative integer.");
  const feed = parseNotificationFeed({
    schemaVersion: 1,
    cohorts: savedCohorts ?? [
      {
        id: fields.id ? `${fields.id}-audience` : "preview-cohort",
        name: fields.cohortName.trim(),
        description: fields.cohortName.trim(),
        conditions,
      },
    ],
    notifications: [
      {
        id: fields.id || "preview-notification",
        title: fields.title.trim(),
        body: fields.body,
        publishedAt: fields.publishedAt || "2026-09-01T12:00:00.000Z",
        cohorts: savedCohorts?.map((c) => c.id) ?? [
          fields.id ? `${fields.id}-audience` : "preview-cohort",
        ],
        priority: fields.priority || "Normal",
        ...(override ? { priorityOverride: Number(override) } : {}),
      },
    ],
  });
  if (!feed)
    throw new Error(
      "Check the audience values, priority, and content length. Plan codes use a-z, 0-9, and hyphens.",
    );
  if (
    !fields.clientSdkVersion?.trim() ||
    !valid(fields.clientSdkVersion.trim())
  )
    throw new Error("Enter an exact client SDK version, for example 1.70.2.");
  if (
    fields.clientRuntimeVersion?.trim() &&
    !valid(fields.clientRuntimeVersion.trim())
  )
    throw new Error(
      "Enter an exact client runtime version or leave it unknown.",
    );
  if (!["react", "vue", "angular"].includes(fields.clientFramework ?? ""))
    throw new Error("Choose a client framework.");
  if (!["", "enabled", "disabled"].includes(fields.clientIntelligence ?? ""))
    throw new Error("Choose the client's Intelligence state.");
  for (const [key, allowed] of Object.entries({
    clientDeployment: ["", "managed", "self-hosted"],
    clientLicense: ["", "valid", "none", "expired", "expiring", "invalid"],
  }))
    if (!allowed.includes(fields[key] ?? ""))
      throw new Error(`Invalid ${key}.`);
  if (
    fields.clientPlan?.trim() &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.clientPlan.trim())
  )
    throw new Error("Use a valid client plan code.");
  const context: NotificationContext = {
    development: true,
    sdkVersion: fields.clientSdkVersion.trim(),
    framework: fields.clientFramework as NotificationContext["framework"],
    intelligence: (fields.clientIntelligence ||
      undefined) as NotificationContext["intelligence"],
    plan: fields.clientPlan?.trim() || undefined,
    runtimeVersion: fields.clientRuntimeVersion?.trim() || undefined,
    deployment: (fields.clientDeployment ||
      undefined) as NotificationContext["deployment"],
    license: (fields.clientLicense ||
      undefined) as NotificationContext["license"],
  };
  const notice = feed.notifications[0];
  const cohort = feed.cohorts[0];
  if (!notice || !cohort)
    throw new Error("The draft must contain a notice and cohort.");
  const prompt = [
    "Use the author-notification skill in ~/Code/Intelligence to prepare a reviewable draft PR.",
    "Reuse a suitable cohort or create one with the exact conditions below. Conditions are AND; exclude prerelease SDK installations and never match unknown metadata to a required condition.",
    `Cohort name: ${cohort.name}`,
    savedCohorts
      ? `Match ANY of these cohorts; preserve their IDs and conditions:\n${JSON.stringify(savedCohorts, null, 2)}`
      : `Audience conditions (npm semver for version ranges):\n${JSON.stringify(conditions, null, 2)}`,
    `Title (preserve exactly): ${notice.title}`,
    `Priority: ${notice.priority}${notice.priorityOverride === undefined ? "" : `; numeric override: ${notice.priorityOverride}`}`,
    `Markdown body (preserve exactly):\n${notice.body}`,
    "Choose stable cohort and notification IDs; preview-cohort and preview-notification are local placeholders. Keep the notification in draft status. Run validation and include matching/nonmatching examples and package names in the PR. Do not merge, publish, release, or perform AWS actions.",
  ].join("\n\n");
  return {
    feed,
    context,
    result: matchNotification(notice, feed, context),
    prompt,
  };
}
