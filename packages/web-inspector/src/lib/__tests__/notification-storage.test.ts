import { afterEach, expect, test, vi } from "vitest";
import {
  loadNotificationState,
  hasNotificationPulsed,
  saveNotificationPulsedId,
  saveAnnouncementPulsedTimestamp,
  saveNotificationState,
} from "../persistence.js";
import { emptyNotificationState } from "../notifications.js";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "cpk_inspector_notifications_v1=; Max-Age=0; Path=/";
});
test("keeps selection, read and suppression separate across reloads", () => {
  const state = {
    ...emptyNotificationState(),
    activeId: "active",
    eligibleIds: ["active", "old"],
    readIds: ["read"],
    suppressedIds: ["old"],
  };
  saveNotificationState(state);
  localStorage.clear();
  expect(loadNotificationState()).toEqual(state);
});
test("uses localStorage when cookies are unavailable, and tolerates both failing", () => {
  vi.spyOn(document, "cookie", "get").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(document, "cookie", "set").mockImplementation(() => {
    throw new Error("blocked");
  });
  const state = { ...emptyNotificationState(), readIds: ["read"] };
  expect(() => saveNotificationState(state)).not.toThrow();
  expect(loadNotificationState()).toEqual(state);
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => saveNotificationState(state)).not.toThrow();
  expect(loadNotificationState()).toEqual(emptyNotificationState());
});
test("oversized history falls back without leaving a stale cookie", () => {
  saveNotificationState(emptyNotificationState());
  const state = {
    ...emptyNotificationState(),
    readIds: Array.from({ length: 300 }, (_, i) => `notice-${i}`),
  };
  saveNotificationState(state);
  expect(loadNotificationState()).toEqual(state);
  expect(document.cookie).not.toContain("cpk_inspector_notifications_v1=");
});

test("migrates legacy pulse timestamps once without conflating new IDs with equal dates", () => {
  const date = "2026-09-08T12:00:00.000Z";
  saveAnnouncementPulsedTimestamp(date);
  expect(hasNotificationPulsed("first", date)).toBe(true);
  expect(hasNotificationPulsed("second", date)).toBe(false);
  saveNotificationPulsedId("second");
  expect(hasNotificationPulsed("second", "2026-09-09T12:00:00.000Z")).toBe(
    true,
  );
});
