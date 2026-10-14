import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { HelpTip } from "./HelpTip";

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

/** Fallback only if geolocation is unavailable. */
const FALLBACK_CENTER: [number, number] = [0, 0];

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

function getUserCenter(): Promise<[number, number] | null> {
  const wa = window.Telegram?.WebApp;
  const lm = wa?.LocationManager;

  const fromBrowser = () =>
    new Promise<[number, number] | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
      );
    });

  if (!lm) return fromBrowser();

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: [number, number] | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      lm.init(() => {
        try {
          lm.getLocation((loc) => {
            if (
              loc &&
              Number.isFinite(loc.latitude) &&
              Number.isFinite(loc.longitude)
            ) {
              done([loc.latitude, loc.longitude]);
            } else {
              void fromBrowser().then(done);
            }
          });
        } catch {
          void fromBrowser().then(done);
        }
      });
    } catch {
      void fromBrowser().then(done);
    }
    setTimeout(() => {
      void fromBrowser().then(done);
    }, 2500);
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

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const start: [number, number] = value
      ? [value.lat, value.lng]
      : FALLBACK_CENTER;
    const map = L.map(mapEl.current, {
      center: start,
      zoom: value ? 15 : 2,
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

    // Center on user location when no pin is set yet (does not place a pin).
    if (!value) {
      void getUserCenter().then((coords) => {
        if (!coords || !mapRef.current || valueRef.current) return;
        mapRef.current.setView(coords, 14);
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // init once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          name:
            valueRef.current?.name ||
            `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`,
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
        <span className="label-row">
          <span>{t(locale, "mapSearch")}</span>
          <HelpTip text={t(locale, "mapTapHint")} />
        </span>
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
