"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MeshPhongMaterial } from "three";
// This module is only ever imported through next/dynamic with ssr:false
// (see app/page.tsx), so a direct browser-only import is safe here and avoids
// next/dynamic swallowing the imperative ref that globe.gl needs.
import GlobeGL from "react-globe.gl";

export type GlobePoint = {
  key: string;
  label: string;
  lat: number;
  lon: number;
  confidence: number;
  band: string;
  rank: number;
};

const ACCENT = "#FF5A1F";

// Slippy-tile basemaps. Everything here is free to use with attribution and
// needs no key, which keeps the project's "no paid providers" rule intact.
const BASEMAPS = {
  satellite: {
    label: "Satellite",
    max: 19,
    url: (x: number, y: number, l: number) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`,
    credit: "Imagery: Esri World Imagery (Maxar, Earthstar Geographics)",
  },
  street: {
    label: "Street",
    max: 19,
    url: (x: number, y: number, l: number) =>
      `https://tile.openstreetmap.org/${l}/${x}/${y}.png`,
    credit: "Map data © OpenStreetMap contributors (ODbL)",
  },
  terrain: {
    label: "Terrain",
    max: 17,
    url: (x: number, y: number, l: number) =>
      `https://a.tile.opentopomap.org/${l}/${x}/${y}.png`,
    credit: "Terrain: OpenTopoMap (CC BY-SA), SRTM elevation",
  },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;
export const BASEMAP_KEYS = Object.keys(BASEMAPS) as BasemapKey[];
export const basemapLabel = (k: BasemapKey) => BASEMAPS[k].label;

// Altitude is expressed in globe radii. 0.0009 puts the camera roughly a
// kilometre up — close enough to read a road layout and match it against a
// keyframe, which is the whole point of the exercise.
const ALT_STREET = 0.0009;
const ALT_DISTRICT = 0.06;
const ALT_WORLD = 2.2;

export default function CompassGlobe({
  points,
  selected,
  onSelect,
  basemap,
  zoomToken,
}: {
  points: GlobePoint[];
  selected: string | null;
  onSelect: (key: string) => void;
  basemap: BasemapKey;
  /** Bumped by the parent to request a street-level descent. */
  zoomToken: number;
}) {
  const ref = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const g = ref.current;
    const controls = g?.controls?.();
    if (!controls) return;
    controls.enableZoom = true;
    // Rotation stops once there is something to inspect — at street level a
    // drifting camera is actively unhelpful.
    controls.autoRotate = points.length === 0;
    controls.autoRotateSpeed = 0.3;
    controls.minDistance = 100.08; // globe radius is 100; this allows a close descent
    controls.maxDistance = 600;
    controls.zoomSpeed = 0.6;
  }, [points.length, basemap]);

  const flyTo = useCallback((lat: number, lon: number, altitude: number, ms = 1400) => {
    ref.current?.pointOfView({ lat, lng: lon, altitude }, ms);
  }, []);

  // Land on the district when results arrive or the selection changes.
  useEffect(() => {
    if (!points.length) {
      flyTo(20, 10, ALT_WORLD, 1200);
      return;
    }
    const t = points.find((p) => p.key === selected) || points[0];
    flyTo(t.lat, t.lon, ALT_DISTRICT);
  }, [points, selected, flyTo]);

  // Street-level descent, requested from the rail.
  useEffect(() => {
    if (!zoomToken || !points.length) return;
    const t = points.find((p) => p.key === selected) || points[0];
    flyTo(t.lat, t.lon, ALT_STREET, 2200);
  }, [zoomToken, points, selected, flyTo]);

  const globeMaterial = useMemo(
    () => new MeshPhongMaterial({ color: "#12100E", emissive: "#000000", shininess: 1 }),
    []
  );

  const map = BASEMAPS[basemap];
  const ringData = useMemo(
    () => (points.length ? [points.find((p) => p.key === selected) || points[0]] : []),
    [points, selected]
  );

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <GlobeGL
        ref={ref}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        rendererConfig={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        showAtmosphere
        atmosphereColor="#5B7FA8"
        atmosphereAltitude={0.12}
        globeMaterial={globeMaterial}
        {...({
          // react-globe.gl's typings lag the underlying globe.gl build, which
          // has supported the slippy-tile engine since 2.3x.
          globeTileEngineUrl: map.url,
          globeTileEngineMaxLevel: map.max,
        } as any)}
        pointsData={points}
        pointLat={(d: any) => d.lat}
        pointLng={(d: any) => d.lon}
        pointColor={(d: any) => (d.key === selected ? "#FFFFFF" : ACCENT)}
        pointAltitude={0.004}
        pointRadius={(d: any) => 0.05 + d.confidence * 0.09}
        pointResolution={18}
        onPointClick={(d: any) => onSelect(d.key)}
        pointLabel={(d: any) =>
          `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:#000;border:2px solid #F4F2EC;padding:7px 9px;color:#F4F2EC;max-width:250px">
             <div style="color:${ACCENT};letter-spacing:.14em;font-weight:600">#${d.rank} · ${d.band.toUpperCase()}</div>
             <div style="margin-top:3px;font-family:Satoshi,sans-serif;font-size:12px">${d.label}</div>
             <div style="margin-top:3px;color:#8A857C">${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}</div>
           </div>`
        }
        ringsData={ringData}
        ringLat={(d: any) => d.lat}
        ringLng={(d: any) => d.lon}
        ringColor={() => (t: number) => `rgba(255,90,31,${1 - t})`}
        ringMaxRadius={1.2}
        ringAltitude={0.003}
        ringPropagationSpeed={0.5}
        ringRepeatPeriod={1500}
      />
      <p className="pointer-events-none absolute bottom-1 right-2 font-mono text-[9px] text-bone-600">
        {map.credit}
      </p>
    </div>
  );
}
