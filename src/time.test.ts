import { describe, expect, it } from "vitest";

import {
  addTaipeiCalendarDays,
  dateFromTaipeiParts,
  taipeiStartOfDate,
  taipeiWeekday,
  toTaipeiDateKey
} from "./time";

describe("Taipei calendar helpers", () => {
  it("assigns early-morning watches to the prior 30-hour day", () => {
    const instant = new Date("2026-07-14T21:30:00.000Z");
    expect(toTaipeiDateKey(instant, "calendar")).toBe("2026-07-15");
    expect(toTaipeiDateKey(instant, "thirty-hour")).toBe("2026-07-14");
  });

  it("performs calendar arithmetic independent of the runtime timezone", () => {
    expect(addTaipeiCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addTaipeiCalendarDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(taipeiStartOfDate("2026-07-14").toISOString()).toBe("2026-07-13T16:00:00.000Z");
    expect(taipeiWeekday("2026-07-14")).toBe(2);
  });

  it("rejects impossible Taipei calendar timestamps", () => {
    expect(dateFromTaipeiParts(2026, 2, 29, 0, 0)).toBeNull();
    expect(dateFromTaipeiParts(2024, 2, 29, 23, 59)?.toISOString()).toBe("2024-02-29T15:59:00.000Z");
  });
});
