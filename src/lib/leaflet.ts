import { useEffect, useRef } from "react";
import type * as LeafletNs from "leaflet";

/**
 * Loads Leaflet from a CDN at runtime instead of bundling it.
 *
 * Reason: our CSP is strict (`script-src 'self'`, `style-src 'self' + fonts`).
 * An npm-bundled Leaflet injects its own <style> tags and marker images, which
 * the CSP would block. Loading the prebuilt CDN assets keeps Leaflet entirely
 * out of the app bundle and lets the vendored CSS/JS load as first-party URLs
 * we whitelist explicitly.
 */
const LEAFLET_VERSION = "1.9.4";
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

declare global {
  interface Window {
    L?: typeof LeafletNs;
  }
}

let loading: Promise<typeof LeafletNs> | null = null;

/** Idempotent loader: concurrent callers share one promise. */
export function loadLeaflet(): Promise<typeof LeafletNs> {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = CSS_URL;
      link.crossOrigin = "";
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${JS_URL}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => {
      if (window.L) resolve(window.L);
      else reject(new Error("Leaflet failed to initialise."));
    };
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load the map library.")), {
      once: true,
    });
    if (!existing) {
      script.src = JS_URL;
      script.crossOrigin = "";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

/** Hex "#rrggbb" at a given opacity, for tinted fills/badges. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return `rgba(115,115,115,${alpha})`;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * DivIcon marker: a numbered teardrop pin in the route colour, which is far
 * cheaper than shipping image sprites and never blocked by CSP.
 */
export function pinIcon(L: typeof LeafletNs, color: string, label: string, emphasised: boolean) {
  const size = emphasised ? 34 : 28;
  const html = `
    <div style="
      width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${color};
      border:${emphasised ? 3 : 2}px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;
    ">
      <span style="
        transform:rotate(45deg);
        font:700 ${size * 0.4}px/1 ui-sans-serif,system-ui,sans-serif;
        color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.3);
      ">${label}</span>
    </div>`;
  return L.divIcon({
    html,
    className: "kwamaiko-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

/** Small square badge used for the depot marker. */
export function depotIcon(L: typeof LeafletNs) {
  return L.divIcon({
    html: `<div style="
      width:26px;height:26px;background:#111;border:3px solid #ffe500;
      display:flex;align-items:center;justify-content:center;
      font:700 13px/1 ui-sans-serif,system-ui,sans-serif;color:#ffe500;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
    ">K</div>`,
    className: "kwamaiko-depot",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

/**
 * Mounts a Leaflet map into the returned ref. Kept deliberately thin: all
 * business state lives in React, this just mirrors it onto the map.
 */
export function useLeafletMap(
  center: [number, number],
  zoom: number,
  onReady?: (L: typeof LeafletNs, map: LeafletNs.Map) => void
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletNs.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    void loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, {
          center,
          zoom,
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: false, // page scroll stays usable on the dashboard
        });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        mapRef.current = map;
        onReady?.(L, map);
      })
      .catch(() => {
        /* the caller renders its own fallback notice */
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Center/zoom are initial values only; changing them must not rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, mapRef };
}
