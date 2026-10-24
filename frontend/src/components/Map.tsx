import L from "leaflet";
import "leaflet/dist/leaflet.css";
import icon from "leaflet/dist/images/marker-icon.png";
import icon2x from "leaflet/dist/images/marker-icon-2x.png";
import shadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { categoryLabel } from "../lib/listings";
import { directionsUrl, typeLabel, type Recycler } from "../lib/recyclers";

L.Icon.Default.mergeOptions({ iconUrl: icon, iconRetinaUrl: icon2x, shadowUrl: shadow });
type Point = { lat: number; lng: number };
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function View({ items, center }: { items: Recycler[]; center: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], 12);
    else if (items.length) map.fitBounds(L.latLngBounds(items.map((i) => [i.latitude, i.longitude] as [number, number])), { padding: [30, 30], maxZoom: 14 });
  }, [items, center, map]);
  return null;
}

export function RecyclerMap({ items, center }: { items: Recycler[]; center: Point | null }) {
  return (
    <MapContainer center={center ? [center.lat, center.lng] : [20, 0]} zoom={center ? 12 : 2} scrollWheelZoom className="isolate z-0 h-[60vh] min-h-[320px] w-full rounded-xl border border-line" aria-label="Map of recyclers">
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      <View items={items} center={center} />
      {center && <Marker position={[center.lat, center.lng]}><Popup>Search centre</Popup></Marker>}
      {items.map((r) => (
        <Marker key={r.id} position={[r.latitude, r.longitude]}>
          <Popup>
            <strong>{r.name}</strong><br />{typeLabel(r.recycler_type)}<br />
            {r.accepted_materials.map(categoryLabel).join(", ")}<br />
            <a href={directionsUrl(r)} target="_blank" rel="noopener noreferrer">Directions</a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function Clicks({ onPick }: { onPick: (p: Point) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: Number(e.latlng.lat.toFixed(5)), lng: Number(e.latlng.lng.toFixed(5)) }) });
  return null;
}
function Follow({ value }: { value: Point | null }) {
  const map = useMap();
  useEffect(() => { if (value) map.setView([value.lat, value.lng], Math.max(map.getZoom(), 14)); }, [value, map]);
  return null;
}

export function LocationPicker({ value, onChange }: { value: Point | null; onChange: (p: Point) => void }) {
  return (
    <MapContainer center={value ? [value.lat, value.lng] : [20, 0]} zoom={value ? 14 : 2} scrollWheelZoom className="isolate z-0 h-72 w-full rounded-xl border border-line" aria-label="Click the map to set the location">
      <TileLayer url={TILES} attribution={ATTRIBUTION} />
      <Clicks onPick={onChange} />
      <Follow value={value} />
      {value && <Marker position={[value.lat, value.lng]} />}
    </MapContainer>
  );
}
