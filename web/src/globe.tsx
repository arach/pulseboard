// Halftone globe: land sampled onto an even dot lattice, rotating slowly on a
// canvas. Countries with realtime activity are pinged.

import { useEffect, useMemo, useRef } from "react";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import type { CountryBreakdown } from "./types";

const CENTROIDS: Record<string, [number, number]> = {
  "United States": [-97, 38], "United Kingdom": [-2, 54], Germany: [10, 51], Canada: [-106, 56],
  France: [2, 46], India: [78, 21], Japan: [138, 36], Brazil: [-55, -10], Australia: [134, -25],
  Netherlands: [5, 52], Spain: [-4, 40], Italy: [12, 42], Sweden: [15, 62], Poland: [19, 52],
  China: [105, 35], "South Korea": [128, 36], Mexico: [-102, 23], Singapore: [103.8, 1.3],
  Switzerland: [8, 47], Ireland: [-8, 53], Nigeria: [8, 9], Cameroon: [12, 6], Ukraine: [32, 49],
  Russia: [90, 60], Turkey: [35, 39], "Türkiye": [35, 39], Indonesia: [118, -2], Vietnam: [108, 16],
  Argentina: [-64, -34], "South Africa": [24, -29], Belgium: [4.5, 50.5], Portugal: [-8, 39.5],
  Norway: [8, 61], Denmark: [10, 56], Finland: [26, 64], Austria: [14.5, 47.5], Israel: [35, 31],
  Philippines: [122, 13], Pakistan: [70, 30], Egypt: [30, 27], Taiwan: [121, 23.7],
  "Hong Kong": [114.2, 22.3], "New Zealand": [174, -41], Colombia: [-74, 4], Chile: [-71, -35],
  Kenya: [38, 0], Morocco: [-6, 32], Thailand: [101, 15], Malaysia: [102, 4], "Czechia": [15, 49.8],
  Romania: [25, 46], Greece: [22, 39], Hungary: [19.5, 47], Bangladesh: [90, 24],
};

interface LandDot { lon: number; lat: number; }

function sampleLand(): LandDot[] {
  const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  const out: LandDot[] = [];
  const step = 2.4;
  for (let lat = -58; lat <= 78; lat += step) {
    const ring = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / step));
    for (let k = 0; k < ring; k++) {
      const lon = -180 + (k / ring) * 360;
      if (geoContains(land, [lon, lat])) out.push({ lon, lat });
    }
  }
  return out;
}

// Even lattice over the whole sphere; drawn faintly so the globe reads as a body.
function sampleSphere(): LandDot[] {
  const out: LandDot[] = [];
  const step = 4.8;
  for (let lat = -84; lat <= 84; lat += step) {
    const ring = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / step));
    for (let k = 0; k < ring; k++) out.push({ lon: -180 + (k / ring) * 360, lat });
  }
  return out;
}

let cachedLand: LandDot[] | null = null;
let cachedSphere: LandDot[] | null = null;

export function DotGlobe({ countries, size = 360 }: { countries: CountryBreakdown[]; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const land = useMemo(() => (cachedLand ??= sampleLand()), []);
  const sphere = useMemo(() => (cachedSphere ??= sampleSphere()), []);
  const pings = useMemo(
    () =>
      countries
        .filter((c) => CENTROIDS[c.country])
        .map((c) => ({ lonlat: CENTROIDS[c.country], weight: c.shareOfTotal })),
    [countries],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const R = size * 0.46;
    const c = size / 2;
    const tilt = (22 * Math.PI) / 180; // look down from the north
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    let raf = 0;
    const start = performance.now();

    const project = (lon: number, lat: number, rot: number) => {
      const l = ((lon + rot) * Math.PI) / 180;
      const p = (lat * Math.PI) / 180;
      const x = Math.cos(p) * Math.sin(l);
      const y0 = Math.sin(p);
      const z0 = Math.cos(p) * Math.cos(l);
      const y = y0 * cosT - z0 * sinT;
      const z = y0 * sinT + z0 * cosT;
      return { x: c + x * R, y: c - y * R, z };
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      // Start with the North Atlantic facing the viewer, then drift east slowly.
      const rot = 45 + (reduce ? 0 : t * 3);
      const ink = getComputedStyle(canvas).color;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = ink;

      // Limb: a faint ring of dots marks the sphere edge.
      const limb = 120;
      for (let i = 0; i < limb; i++) {
        const a = (i / limb) * Math.PI * 2;
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * (R + 6), c + Math.sin(a) * (R + 6), 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const d of sphere) {
        const p = project(d.lon, d.lat, rot);
        if (p.z <= 0) continue;
        ctx.globalAlpha = 0.05 + p.z * 0.07;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const d of land) {
        const p = project(d.lon, d.lat, rot);
        if (p.z <= 0.02) continue;
        ctx.globalAlpha = 0.18 + p.z * 0.72;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.55 + p.z * 1.25, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const ping of pings) {
        const p = project(ping.lonlat[0], ping.lonlat[1], rot);
        if (p.z <= 0.05) continue;
        const phase = reduce ? 0.4 : (((t * 0.6 + ping.lonlat[0] / 90) % 1) + 1) % 1;
        ctx.globalAlpha = (1 - phase) * 0.8 * p.z;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 + phase * (14 + ping.weight * 34), 0, Math.PI * 2);
        ctx.stroke();
        // Solid core with a knockout ring so pings separate from the land dots.
        const core = 3 + ping.weight * 4;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(p.x, p.y, core + 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 0.4 + p.z * 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, core, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // With motion reduced there is no loop, so repaint once when the theme flips.
    const observer = new MutationObserver(() => reduce && requestAnimationFrame(draw));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-hudson-theme"] });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [land, sphere, pings, size]);

  return <canvas ref={canvasRef} className="globe" style={{ width: size, height: size }} aria-hidden="true" />;
}
