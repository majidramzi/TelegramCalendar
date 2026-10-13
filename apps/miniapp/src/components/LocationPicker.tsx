import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Locale } from "../i18n";
import { t } from "../i18n";

export interface PickedLocation {
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  locale: Locale;
  value: PickedLocation | null;
  onChange: (value: PickedLocation | null) => void;
}

interface SearchHit {
  name: string;
  lat: number;
  lng: number;
}

const DEFAULT_CENTER: [number, number] = [35.6892, 51.389]; // Tehran
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

async function searchPlaces(query: string): Promise<SearchHit[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "en");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: {
        name?: string;
        street?: string;
        city?: string;
        state?: string;
        country?: string;
      };
    }>;
  };
  return (data.features ?? []).map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    const name = [p.name, p.street, p.city, p.state, p.country]
      .filter(Boolean)
      .join(", ");
    return { name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng };
  });
}

export function LocationPicker({ locale, value, onChange }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const initialCenter = useMemo<[number, number]>(
    () => (value ? [value.lat, value.lng] : DEFAULT_CENTER),
    // Only for first paint
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: initialCenter,
      zoom: valueRef.current ? 15 : 11,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const current = valueRef.current;
      onChangeRef.current({
        name: current?.name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        lat,
        lng,
      });
    });

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 80);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [initialCenter]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker([value.lat, value.lng], {
        icon: markerIcon,
        draggable: true,
      }).addTo(map);
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current?.getLatLng();
        if (!pos) return;
        onChangeRef.current({
          name: valueRef.current?.name || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
          lat: pos.lat,
          lng: pos.lng,
        });
      });
    } else {
      markerRef.current.setLatLng([value.lat, value.lng]);
    }
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 14));
  }, [value]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void searchPlaces(q)
        .then((results) => {
          if (!cancelled) setHits(results);
        })
        .catch(() => {
          if (!cancelled) setSearchError(t(locale, "mapSearchFailed"));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, locale]);

  function selectHit(hit: SearchHit) {
    onChange(hit);
    setQuery(hit.name);
    setHits([]);
  }

  return (
    <div className="map-picker">
      <label>
        {t(locale, "mapSearch")}
        <input
          type="search"
          value={query}
          placeholder={t(locale, "mapSearchHint")}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      {searching && <p className="hint">{t(locale, "loading")}</p>}
      {searchError && <p className="error">{searchError}</p>}
      {hits.length > 0 && (
        <ul className="map-hits">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lng},${hit.name}`}>
              <button type="button" onClick={() => selectHit(hit)}>
                {hit.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={mapEl} className="map-canvas" />
      <p className="hint">{t(locale, "mapTapHint")}</p>
      {value && (
        <div className="actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            {t(locale, "clearLocation")}
          </button>
        </div>
      )}
    </div>
  );
}
