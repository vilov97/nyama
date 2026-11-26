import { describe, expect, it } from "vitest";
import {
  DEPOT,
  capacityLabel,
  capacityState,
  formatKm,
  haversineKm,
  pinColor,
  routeDistanceKm,
  sequenceStops,
} from "./dispatch";

const karen = { id: "karen", lat: -1.3191, lng: 36.7073 };
const westlands = { id: "westlands", lat: -1.2673, lng: 36.8065 };
const kilimani = { id: "kilimani", lat: -1.2921, lng: 36.7833 };
const embakasi = { id: "embakasi", lat: -1.3167, lng: 36.9 };

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm(DEPOT, DEPOT)).toBe(0);
  });

  it("matches a known Nairobi distance (~9km depot to Kilimani)", () => {
    const d = haversineKm(DEPOT, kilimani);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(6);
  });

  it("is symmetric", () => {
    expect(haversineKm(karen, embakasi)).toBeCloseTo(haversineKm(embakasi, karen), 6);
  });
});

describe("sequenceStops", () => {
  it("returns an empty list unchanged", () => {
    expect(sequenceStops([])).toEqual([]);
  });

  it("keeps every stop exactly once", () => {
    const out = sequenceStops([karen, westlands, kilimani, embakasi]);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((s) => s.id)).size).toBe(4);
  });

  it("never does worse than the input order", () => {
    const input = [embakasi, karen, westlands, kilimani];
    const naive = input.reduce(
      (acc, stop, i) => acc + haversineKm(i === 0 ? DEPOT : input[i - 1]!, stop),
      0
    );
    const ordered = sequenceStops(input);
    const greedy = ordered.reduce(
      (acc, stop, i) => acc + haversineKm(i === 0 ? DEPOT : ordered[i - 1]!, stop),
      0
    );
    expect(greedy).toBeLessThanOrEqual(naive);
  });

  it("picks the nearest first", () => {
    const out = sequenceStops([karen, kilimani, embakasi]);
    expect(out[0]?.id).toBe("kilimani");
  });

  it("is deterministic", () => {
    const a = sequenceStops([karen, westlands, kilimani]);
    const b = sequenceStops([kilimani, karen, westlands]);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });
});

describe("routeDistanceKm", () => {
  it("includes the return leg", () => {
    const outAndBack = routeDistanceKm([kilimani]);
    expect(outAndBack).toBeCloseTo(haversineKm(DEPOT, kilimani) * 2, 6);
  });

  it("is zero with no stops", () => {
    expect(routeDistanceKm([])).toBe(0);
  });
});

describe("capacity", () => {
  it("flags ok / near / over", () => {
    expect(capacityState(3, 5)).toBe("ok");
    expect(capacityState(5, 5)).toBe("near");
    expect(capacityState(6, 5)).toBe("over");
  });

  it("treats a zero cap as 1 instead of dividing by nothing", () => {
    expect(capacityState(1, 0)).toBe("near");
    expect(capacityState(2, 0)).toBe("over");
  });

  it("labels the state in plain words", () => {
    expect(capacityLabel(2, 5)).toBe("2 of 5 stops");
    expect(capacityLabel(5, 5)).toBe("Full — 5 of 5");
    expect(capacityLabel(7, 5)).toBe("Overloaded — 7 of 5");
  });
});

describe("formatKm", () => {
  it("switches to metres below 1km", () => {
    expect(formatKm(0.4)).toBe("400 m");
    expect(formatKm(12.44)).toBe("12.4 km");
  });

  it("survives nonsense", () => {
    expect(formatKm(Number.NaN)).toBe("—");
  });
});

describe("pinColor", () => {
  it("uses a valid hex colour", () => {
    expect(pinColor("#e11d48")).toBe("#e11d48");
  });

  it("falls back to neutral grey for missing/invalid colours", () => {
    expect(pinColor(null)).toBe("#737373");
    expect(pinColor("red")).toBe("#737373");
    expect(pinColor("#fff")).toBe("#737373");
  });
});
