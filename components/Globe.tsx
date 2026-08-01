"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function CompassGlobe({
  points,
  selected,
  onSelect,
}: {
  points: GlobePoint[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const ref = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [countries, setCountries] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/countries.geojson")
      .then((r) => r.json())
      .then((j) => !cancelled && setCountries(j))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Idle rotation, stopped as soon as there is something to look at.
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const controls = g.controls?.();
    if (!controls) return;
    controls.enableZoom = true;
    // Always rotating, slowly. Beyond looking alive, this keeps WebGL painting
    // every frame — a static globe leaves a stale buffer behind on resize.
    controls.autoRotate = true;
    controls.autoRotateSpeed = points.length ? 0.12 : 0.3;
    controls.minDistance = 130;
    controls.maxDistance = 520;
  }, [points.length, countries]);

  // Fly to the leading candidate when results land, or to a manual selection.
  useEffect(() => {
    const g = ref.current;
    if (!g || !points.length) return;
    const target = points.find((p) => p.key === selected) || points[0];
    g.pointOfView({ lat: target.lat, lng: target.lon, altitude: 1.7 }, 1200);
  }, [points, selected]);

  const globeMaterial = useMemo(
    () =>
      new MeshPhongMaterial({
        color: "#0D0D0D",
        emissive: "#000000",
        specular: "#241A12",
        shininess: 4,
        transparent: true,
        opacity: 0.96,
      }),
    []
  );

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
        atmosphereColor="#7A5233"
        atmosphereAltitude={0.15}
        globeMaterial={globeMaterial}
        hexPolygonsData={countries?.features || []}
        hexPolygonResolution={3}
        hexPolygonMargin={0.28}
        hexPolygonAltitude={0.007}
        hexPolygonColor={() => "rgba(244, 242, 236, 0.42)"}
        pointsData={points}
        pointLat={(d: any) => d.lat}
        pointLng={(d: any) => d.lon}
        pointColor={(d: any) => (d.key === selected ? "#F4F2EC" : ACCENT)}
        pointAltitude={(d: any) => 0.02 + d.confidence * 0.22}
        pointRadius={(d: any) => 0.32 + d.confidence * 0.55}
        pointResolution={16}
        onPointClick={(d: any) => onSelect(d.key)}
        pointLabel={(d: any) =>
          `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:#000;border:2px solid #F4F2EC;padding:7px 9px;color:#F4F2EC;max-width:250px">
             <div style="color:${ACCENT};letter-spacing:.14em;font-weight:600">#${d.rank} · ${d.band.toUpperCase()}</div>
             <div style="margin-top:3px;font-family:Satoshi,sans-serif;font-size:12px">${d.label}</div>
             <div style="margin-top:3px;color:#8A857C">${(d.confidence * 100).toFixed(0)}% of evidence weight</div>
           </div>`
        }
        ringsData={ringData}
        ringLat={(d: any) => d.lat}
        ringLng={(d: any) => d.lon}
        ringColor={() => (t: number) => `rgba(255,90,31,${1 - t})`}
        ringMaxRadius={5}
        ringAltitude={0.005}
        ringPropagationSpeed={1.6}
        ringRepeatPeriod={1400}
      />
    </div>
  );
}
