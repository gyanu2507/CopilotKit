import { Range, minVersion, satisfies, prerelease, compare } from "semver";
import type {
  NotificationCohort,
  NotificationContext,
} from "../src/lib/notifications.js";
import type { AuthoringFields } from "./notification-authoring.js";

/** Resolve a stable semver example; samples are simulated, not an npm release lookup. */
export function sampleVersion(range: string, preferred = "1.70.2"): string {
  if (prerelease(preferred) === null && satisfies(preferred, range))
    return preferred;
  const candidates = new Range(range).set
    .flatMap((set) => {
      const minimum = minVersion(set.map((c) => c.value).join(" "));
      if (!minimum) return [];
      const belowUpperBounds = set
        .filter((c) => c.operator === "<" || c.operator === "<=")
        .flatMap((c) => {
          const bound = minVersion(c.value.replace(/^<=?/, ""));
          if (!bound) return [];
          const previous =
            bound.patch > 0
              ? `${bound.major}.${bound.minor}.${bound.patch - 1}`
              : bound.minor > 0
                ? `${bound.major}.${bound.minor - 1}.0`
                : bound.major > 0
                  ? `${bound.major - 1}.0.0`
                  : "0.0.0";
          return [previous, `${bound.major}.${bound.minor}.${bound.patch}`];
        });
      return [
        ...belowUpperBounds,
        `${minimum.major}.${minimum.minor}.${minimum.patch}`,
      ];
    })
    .filter((version) => satisfies(version, range))
    .sort((a, b) => compare(b, a));
  if (!candidates[0])
    throw new Error(
      `No stable version matches ${range}. Change the range to preview a stable client.`,
    );
  return candidates[0];
}
export function matchingClient(cohort: NotificationCohort): AuthoringFields {
  const c = cohort.conditions;
  return {
    clientSdkVersion: sampleVersion(c.sdkVersion || "*"),
    clientFramework: c.framework || "react",
    clientIntelligence: c.intelligence || "",
    clientPlan: c.plan || "",
    clientRuntimeVersion: c.runtimeVersion
      ? sampleVersion(c.runtimeVersion)
      : "",
    clientDeployment: c.deployment || "",
    clientLicense: c.license || "",
  };
}
export function audienceRows(
  cohort: NotificationCohort,
  context: NotificationContext,
) {
  const rules = { sdkVersion: "*", ...cohort.conditions };
  const labels: Record<string, string> = {
    sdkVersion: "SDK",
    runtimeVersion: "Runtime",
    framework: "Framework",
    intelligence: "Intelligence",
    plan: "Plan",
    deployment: "Deployment",
    license: "License",
  };
  return Object.entries(rules).map(([key, expected]) => {
    const actual = context[key as keyof NotificationContext];
    const matches =
      typeof actual === "string" &&
      (key === "sdkVersion" || key === "runtimeVersion"
        ? (key !== "sdkVersion" || prerelease(actual) === null) &&
          satisfies(actual, expected)
        : actual === expected);
    return {
      label: labels[key]!,
      expected:
        key === "sdkVersion" && expected === "*"
          ? "Any stable version"
          : expected,
      actual: typeof actual === "string" ? actual : "Unknown",
      matches,
    };
  });
}
