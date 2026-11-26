import { useState } from "react";
import { DEPOT, formatKm, haversineKm } from "../lib/dispatch";
import { loadLeaflet, withAlpha } from "../lib/leaflet";

export type PickedLocation = { lat: number; lng: number; address: string };

/**
 * Pin-drop picker: the customer taps the map (or shares one position) to mark
 * where their order should be dropped. Deliberately a one-shot static pin — we
 * never stream their location, which keeps the privacy story simple.
 */
export default function LocationPicker({
  value,
  onChange,
  inputCls,
  labelCls,
}: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
  inputCls: string;
  labelCls: string;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [address, setAddress] = useState(value?.address ?? "");

  const mountMap = async (node: HTMLDivElement | null) => {
    setContainer(node);
    if (!node || ready) return;
    try {
      const L = await loadLeaflet();
      const map = L.map(node, { center: [DEPOT.lat, DEPOT.lng], zoom: 12, scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      L.circle([DEPOT.lat, DEPOT.lng], {
        radius: 400,
        color: "#111",
        weight: 2,
        fillColor: "#ffe500",
        fillOpacity: 0.35,
      })
        .bindTooltip("Butchery", { direction: "top" })
        .addTo(map);

      let marker: ReturnType<typeof L.marker> | null = null;
      if (value) {
        marker = L.marker([value.lat, value.lng], { draggable: true })
          .addTo(map)
          .on("dragend", (e) => {
            const ll = (e.target as ReturnType<typeof L.marker>).getLatLng();
            onChange({ lat: ll.lat, lng: ll.lng, address });
          });
        map.setView([value.lat, value.lng], 14);
      }

      map.on("click", (e) => {
        const ll = e.latlng;
        if (!marker) {
          marker = L.marker([ll.lat, ll.lng], { draggable: true })
            .addTo(map)
            .on("dragend", (ev) => {
              const pos = (ev.target as ReturnType<typeof L.marker>).getLatLng();
              onChange({ lat: pos.lat, lng: pos.lng, address });
            });
        } else {
          marker.setLatLng(ll);
        }
        onChange({ lat: ll.lat, lng: ll.lng, address });
        setNote(`Pinned — ${formatKm(haversineKm(DEPOT, ll))} from the butchery`);
      });

      setReady(true);
    } catch {
      setNote("The map could not load. You can still type coordinates below.");
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setNote("This browser cannot share a location.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, address };
        onChange(next);
        setBusy(false);
        setNote(`Pinned at your current position — ${formatKm(haversineKm(DEPOT, next))} from the butchery`);
      },
      () => {
        setBusy(false);
        setNote("Could not read your location. Tap the map instead, or type coordinates.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div>
      <label className={labelCls}>Drop point (optional)</label>
      <div
        ref={(node) => void mountMap(node)}
        className="mb-2 h-[220px] w-full border border-neutral-200 bg-neutral-100"
        style={value ? { boxShadow: `inset 0 0 0 2px ${withAlpha("#111111", 0.05)}` } : undefined}
      />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={locateMe}
          disabled={busy}
          className="cursor-pointer border border-neutral-300 px-2.5 py-1.5 text-[0.6rem] font-bold uppercase tracking-widest text-neutral-700 hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-50"
        >
          {busy ? "Locating…" : "Use my location"}
        </button>
        <input
          className={`${inputCls} flex-1`}
          placeholder="Drop address / landmark (e.g. Karen, Hardy shops)"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            if (value) onChange({ ...value, address: e.target.value });
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setNote(null);
            }}
            className="cursor-pointer text-[0.6rem] font-bold uppercase tracking-widest text-neutral-400 hover:text-red-600"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[0.65rem] text-neutral-500">
        {note ??
          (value
            ? `Pin set at ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)} — ${formatKm(haversineKm(DEPOT, value))} from the butchery.`
            : "Tap the map to drop a pin, drag it to fine-tune, or use your current location. We save the pin only — never live tracking.")}
      </p>
      {container === null && <span className="hidden">map</span>}
    </div>
  );
}
