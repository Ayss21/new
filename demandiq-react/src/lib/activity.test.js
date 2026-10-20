import { describe, expect, it } from "vitest";
import { SUMMARY_MODULES, activityByRole, activityByUser, formatSessionDuration, moduleActivitySummary } from "./activity";
import { initialActivities, initialSessions } from "../data/seed";

const row = (userId, userName, roleId, module, status) => ({ userId, userName, roleId, module, status, action: "x" });
const log = [
  row("U1", "Omar", 1, "Authentication", "Completed"),
  row("U1", "Omar", 1, "Sales Upload", "Completed"),
  row("U1", "Omar", 1, "Sales Upload", "Failed"),
  row("U2", "Noura", 2, "Forecasting", "Completed"),
  row("U2", "Noura", 2, "Forecasting", "Completed"),
  row("U2", "Noura", 2, "Forecasting", "Failed"),
  row("U4", "Ahmed", 4, "Authentication", "Failed"),
  row("U4", "Ahmed", 4, "Admin Panel", "Completed"),
  row("U3", "Layla", 3, "Reports & Exports", "Processing"),
];

describe("session time formatting", () => {
  it("formats minutes and hours", () => {
    expect(formatSessionDuration("2025-06-26T09:00:00Z", "2025-06-26T09:40:00Z")).toBe("40 min");
    expect(formatSessionDuration("2025-06-26T09:00:00Z", "2025-06-26T10:25:00Z")).toBe("1 hr 25 min");
    expect(formatSessionDuration("2025-06-26T09:00:00Z", "2025-06-26T10:00:00Z")).toBe("1 hr");
    expect(formatSessionDuration("2025-06-26T09:00:00Z", "2025-06-26T11:05:00Z")).toBe("2 hr 5 min");
    expect(formatSessionDuration("2025-06-26T09:00:00Z", "2025-06-26T09:00:20Z")).toBe("Less than 1 min");
  });

  it("shows Ongoing while the session is active", () => {
    expect(formatSessionDuration("2025-06-26T09:00:00Z", null)).toBe("Ongoing");
  });
});

describe("module activity summary", () => {
  it("counts totals, successes and failures per module", () => {
    const summary = moduleActivitySummary(log);
    expect(summary.map((r) => r.module)).toEqual(SUMMARY_MODULES);
    const byModule = Object.fromEntries(summary.map((r) => [r.module, r]));
    expect(byModule.Authentication).toMatchObject({ total: 2, successful: 1, failed: 1, successRate: 0.5 });
    expect(byModule.Forecasting).toMatchObject({ total: 3, successful: 2, failed: 1 });
    expect(byModule.Forecasting.successRate).toBeCloseTo(2 / 3);
    // Processing is neither successful nor failed
    expect(byModule["Reports & Exports"]).toMatchObject({ total: 1, successful: 0, failed: 0, successRate: 0 });
    expect(byModule.Inventory).toMatchObject({ total: 0, successRate: null });
  });

  it("uses the renamed Reports & Exports module in the seed log", () => {
    expect(initialActivities.some((r) => r.module === "Reports")).toBe(false);
    expect(initialActivities.some((r) => r.module === "Reports & Exports")).toBe(true);
    expect(initialActivities.some((r) => r.status === "Failed")).toBe(true);
  });
});

describe("user activity insights", () => {
  it("counts activity by role ID", () => {
    expect(activityByRole(log).map((r) => [r.label, r.count])).toEqual([
      ["Store Manager", 3],
      ["Data Analyst", 3],
      ["Inventory Supervisor", 1],
      ["Admin", 2],
    ]);
  });

  it("lists every user, the most active first, ties by name", () => {
    expect(activityByUser(log).map((u) => [u.userName, u.total])).toEqual([
      ["Noura", 3],
      ["Omar", 3],
      ["Ahmed", 2],
      ["Layla", 1],
    ]);
    expect(activityByUser([])).toEqual([]);
  });

  it("includes accounts without activity", () => {
    const users = [
      { id: "U1", name: "Omar", roleId: 1 },
      { id: "U9", name: "Hana", roleId: 2 },
    ];
    const rows = activityByUser(log, users);
    expect(rows.map((u) => [u.userName, u.total])).toEqual([
      ["Noura", 3],
      ["Omar", 3],
      ["Ahmed", 2],
      ["Layla", 1],
      ["Hana", 0],
    ]);
    expect(rows.at(-1)).toEqual({ userId: "U9", userName: "Hana", roleId: 2, total: 0 });
  });
});

describe("seeded sessions", () => {
  it("assigns every signed-in event to a session of the same user", () => {
    const sessions = new Map(initialSessions.map((s) => [s.id, s]));
    for (const event of initialActivities.filter((e) => e.sessionId)) {
      const session = sessions.get(event.sessionId);
      expect(session).toBeDefined();
      expect(session.userId).toBe(event.userId);
      expect(event.at >= session.loginAt).toBe(true);
      if (session.logoutAt) expect(event.at <= session.logoutAt).toBe(true);
    }
  });
});
