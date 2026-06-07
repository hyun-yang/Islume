"use client";

import { useRef, useEffect } from "react";
import maplibregl from "maplibre-gl";
import { MAP_CENTER_BY_LOCALE, MAP_ZOOM } from "@/lib/constants";
import { useAppStore } from "@/stores/appStore";
import type { NearbyIsland } from "@/lib/types";

interface IslumeMapProps {
  islands: NearbyIsland[];
  selectedUserId: string | null;
  selectedUserName: string | null;
  userPosition: { longitude: number; latitude: number } | null;
  findRadiusM: number;
  onPositionChange?: (lon: number, lat: number) => void;
  onIslandDoubleClick?: (userId: string, displayName: string) => void;
  onIslandClick?: (userId: string, displayName: string) => void;
}

/** Generate a GeoJSON polygon circle (64 segments). */
function createCirclePolygon(
  centerLon: number,
  centerLat: number,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const points = 64;
  const coords: [number, number][] = [];
  const earthRadius = 6371000;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusM / earthRadius) * Math.cos(angle);
    const dLon =
      (radiusM / (earthRadius * Math.cos((centerLat * Math.PI) / 180))) *
      Math.sin(angle);
    coords.push([
      centerLon + (dLon * 180) / Math.PI,
      centerLat + (dLat * 180) / Math.PI,
    ]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [coords] },
    properties: {},
  };
}

export default function IslumeMap({
  islands,
  selectedUserId,
  selectedUserName,
  userPosition,
  findRadiusM,
  onPositionChange,
  onIslandDoubleClick,
  onIslandClick,
}: IslumeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const isDraggingRef = useRef(false);

  // Stable callback refs — updated in effects per React 19 rules
  const onPositionChangeRef = useRef(onPositionChange);
  const onDoubleClickRef = useRef(onIslandDoubleClick);
  const onClickRef = useRef(onIslandClick);
  // Single-click chat fires on a timer so a double-click (visit) can cancel it.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedUserIdRef = useRef(selectedUserId);
  const findRadiusMRef = useRef(findRadiusM);
  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);
  useEffect(() => {
    onDoubleClickRef.current = onIslandDoubleClick;
  }, [onIslandDoubleClick]);
  useEffect(() => {
    onClickRef.current = onIslandClick;
  }, [onIslandClick]);
  useEffect(() => {
    selectedUserIdRef.current = selectedUserId;
  }, [selectedUserId]);
  useEffect(() => {
    findRadiusMRef.current = findRadiusM;
  }, [findRadiusM]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const styleUrl =
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
      "https://tiles.openfreemap.org/styles/bright";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      // Initial focus follows the UI locale; read non-reactively so the map is
      // built once and the user's later pan/zoom (or locale toggle) isn't reset.
      center: MAP_CENTER_BY_LOCALE[useAppStore.getState().locale],
      zoom: MAP_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-left");

    map.on("load", () => {
      // --- Radius circle source + layer ---
      map.addSource("radius-circle", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius-circle",
        paint: {
          "fill-color": "#0f6e56",
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "radius-outline",
        type: "line",
        source: "radius-circle",
        paint: {
          "line-color": "#0f6e56",
          "line-width": 2,
          "line-dasharray": [4, 3],
          "line-opacity": 0.5,
        },
      });

      // --- Island source + layers ---
      map.addSource("islands", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Circle layer — color by self/other/inactive
      map.addLayer({
        id: "islands-circle",
        type: "circle",
        source: "islands",
        paint: {
          "circle-radius": 14,
          "circle-color": [
            "case",
            ["==", ["get", "isSelf"], true],
            "#0f6e56",
            ["==", ["get", "isActive"], false],
            "#9ca3af",
            "#3b82f6",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": [
            "case",
            ["==", ["get", "isActive"], false],
            0.5,
            0.9,
          ],
        },
      });

      // Island emoji label on the circle
      map.addLayer({
        id: "islands-icon",
        type: "symbol",
        source: "islands",
        layout: {
          "text-field": "🏝️",
          "text-size": 16,
          "text-allow-overlap": true,
        },
      });

      // Name label below
      map.addLayer({
        id: "islands-label",
        type: "symbol",
        source: "islands",
        layout: {
          "text-field": ["get", "label"],
          "text-offset": [0, 2.2],
          "text-size": 12,
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#1a1a18",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // --- Hover popup ---
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 20,
      });
      popupRef.current = popup;

      map.on("mouseenter", "islands-circle", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const { label, userId } = feature.properties;
        const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(`<strong>${label}</strong><br/><span style="font-size:11px;color:#666">${String(userId).substring(0, 8)}...</span>`)
          .addTo(map);
      });

      map.on("mouseleave", "islands-circle", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      // --- Drag and drop for self island ---
      let dragFeatureId: string | null = null;

      map.on("mousedown", "islands-circle", (e) => {
        const feature = e.features?.[0];
        if (!feature?.properties?.isSelf) return;
        e.preventDefault();
        isDraggingRef.current = true;
        dragFeatureId = feature.properties.userId;
        map.getCanvas().style.cursor = "grabbing";
        popup.remove();
      });

      map.on("mousemove", (e) => {
        if (!isDraggingRef.current || !dragFeatureId) return;
        const source = map.getSource("islands") as maplibregl.GeoJSONSource | undefined;
        if (!source) return;

        // Update the self island's position in the GeoJSON
        const data = (source as unknown as { _data: GeoJSON.FeatureCollection })._data;
        if (data?.features) {
          for (const f of data.features) {
            if (f.properties?.userId === dragFeatureId) {
              (f.geometry as GeoJSON.Point).coordinates = [e.lngLat.lng, e.lngLat.lat];
            }
          }
          source.setData(data);
        }

        // Update the radius circle to follow the dragged position
        const radiusSource = map.getSource("radius-circle") as maplibregl.GeoJSONSource | undefined;
        if (radiusSource && findRadiusMRef.current > 0) {
          const circle = createCirclePolygon(e.lngLat.lng, e.lngLat.lat, findRadiusMRef.current);
          radiusSource.setData({ type: "FeatureCollection", features: [circle] });
        }
      });

      map.on("mouseup", (e) => {
        if (!isDraggingRef.current || !dragFeatureId) return;
        isDraggingRef.current = false;
        map.getCanvas().style.cursor = "";
        onPositionChangeRef.current?.(e.lngLat.lng, e.lngLat.lat);
        dragFeatureId = null;
      });

      // Single-click on another user's island → open a 1:1 chat. Fired after a
      // short delay so a double-click can cancel it and request a visit instead.
      map.on("click", "islands-circle", (e) => {
        const feature = e.features?.[0];
        if (!feature?.properties) return;
        if (feature.properties.isSelf) return;
        const userId = String(feature.properties.userId);
        const label = String(feature.properties.label || userId.substring(0, 8));
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null;
          onClickRef.current?.(userId, label);
        }, 250);
      });

      // Double-click on another user's island → request visit
      map.on("dblclick", "islands-circle", (e) => {
        const feature = e.features?.[0];
        if (!feature?.properties) return;
        if (feature.properties.isSelf) return;
        // Cancel the pending single-click (chat) action.
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        e.preventDefault();
        const userId = String(feature.properties.userId);
        const label = String(feature.properties.label || userId.substring(0, 8));
        onDoubleClickRef.current?.(userId, label);
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update island data when props change.
  // After a remount (e.g. returning from island view), the TanStack Query
  // cache hands us `islands` synchronously while the map's style is still
  // loading and the "islands" source hasn't been added yet. We must defer
  // the setData until load fires, otherwise the marker layer stays empty
  // and is never refreshed (refetch returns the same reference).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource("islands") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const allIslands: Array<{
        id: string;
        lon: number;
        lat: number;
        isSelf: boolean;
        isActive: boolean;
        label: string;
      }> = islands.map((island) => ({
        id: island.user_id,
        lon: island.longitude,
        lat: island.latitude,
        isSelf: island.user_id === selectedUserId,
        isActive: island.is_active,
        label: island.display_name || island.user_id.substring(0, 8),
      }));

      // Add self if not already in nearby list
      if (
        userPosition &&
        selectedUserId &&
        !allIslands.some((i) => i.id === selectedUserId)
      ) {
        allIslands.push({
          id: selectedUserId,
          lon: userPosition.longitude,
          lat: userPosition.latitude,
          isSelf: true,
          isActive: true,
          label: selectedUserName || selectedUserId.substring(0, 8),
        });
      }

      const features = allIslands.map((island) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [island.lon, island.lat],
        },
        properties: {
          userId: island.id,
          label: island.label,
          isSelf: island.isSelf,
          isActive: island.isActive,
        },
      }));

      source.setData({ type: "FeatureCollection", features });
    };

    if (map.isStyleLoaded() && map.getSource("islands")) {
      apply();
      return;
    }
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [islands, selectedUserId, selectedUserName, userPosition]);

  // Update radius circle. Same defer-until-load pattern as the islands
  // source above — necessary so the circle paints on first remount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource("radius-circle") as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      if (userPosition && findRadiusM > 0) {
        const circle = createCirclePolygon(
          userPosition.longitude,
          userPosition.latitude,
          findRadiusM,
        );
        source.setData({ type: "FeatureCollection", features: [circle] });
      } else {
        source.setData({ type: "FeatureCollection", features: [] });
      }
    };

    if (map.isStyleLoaded() && map.getSource("radius-circle")) {
      apply();
      return;
    }
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [userPosition, findRadiusM]);

  // Fly to user position when it changes (skip during drag)
  useEffect(() => {
    if (!mapRef.current || !userPosition || isDraggingRef.current) return;
    mapRef.current.flyTo({
      center: [userPosition.longitude, userPosition.latitude],
      zoom: MAP_ZOOM,
      duration: 1000,
    });
  }, [userPosition]);

  return <div ref={containerRef} className="w-full h-full" />;
}
