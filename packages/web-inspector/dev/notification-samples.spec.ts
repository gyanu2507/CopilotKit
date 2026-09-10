import { expect, test } from "vitest";
import {
  sampleVersion,
  matchingClient,
  audienceRows,
} from "./notification-samples.js";
import { compilePreview, DEFAULT_FIELDS } from "./notification-authoring.js";
test("samples real stable versions from npm ranges including OR and prerelease boundaries", () => {
  for (const range of [
    "1.70.1",
    ">=1.70.1 <1.71.0",
    "^1.69.0",
    "~1.69.0",
    "1.69.x",
    "1.68.0 - 1.69.0",
    "<1.0.0 || >=2.0.0",
    ">=2.0.0-beta.1 <2.0.0 || ^3.0.0",
  ]) {
    const feed = compilePreview({ ...DEFAULT_FIELDS, sdkVersion: range }).feed;
    expect(
      compilePreview({
        ...DEFAULT_FIELDS,
        ...matchingClient(feed.cohorts[0]!),
        sdkVersion: range,
      }).result.matches,
    ).toBe(true);
  }
  expect(sampleVersion("<1.70.2")).toBe("1.70.1");
  expect(() => sampleVersion("<0.0.0")).toThrow("No stable version");
  expect(() => sampleVersion(">=2.0.0-beta.1 <2.0.0")).toThrow(
    "No stable version",
  );
});
test("samples all required metadata and explains unknown or excluded values", () => {
  const compiled = compilePreview({
    ...DEFAULT_FIELDS,
    framework: "angular",
    intelligence: "enabled",
    plan: "pro",
    deployment: "managed",
    license: "valid",
    runtimeVersion: "^2.0.0",
  });
  const cohort = compiled.feed.cohorts[0]!;
  const client = matchingClient(cohort);
  const result = compilePreview({ ...DEFAULT_FIELDS, ...client }, [cohort]);
  expect(result.result.matches).toBe(true);
  expect(audienceRows(cohort, result.context).every((r) => r.matches)).toBe(
    true,
  );
  expect(
    audienceRows(cohort, { ...result.context, intelligence: undefined }).find(
      (r) => r.label === "Intelligence",
    ),
  ).toMatchObject({ actual: "Unknown", matches: false });
  expect(
    audienceRows(cohort, { ...result.context, sdkVersion: "1.70.2-beta.1" })[0]!
      .matches,
  ).toBe(false);
});
