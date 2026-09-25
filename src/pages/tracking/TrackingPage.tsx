import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Navigation, Clock, MapPin } from 'lucide-react';

import { PageLoader, ErrorState } from '@/components/ui';
import { trackingApi } from '@/lib/api/tracking';

// Leaflet is loaded from CDN, not npm — this environment has no network
// access to install packages, and a single free/open-source map library
// loaded once per view of this ONE page is a reasonable trade-off over
// bundling it into every build. `L` becomes a global once the script tag
// below finishes loading (same pattern as the e-ticket's QR-code script).
// Typed as `any` deliberately: the `leaflet` package (and its type
// declarations) isn't installed, so referencing its real types here would
// fail to compile — the CDN script provides the RUNTIME object regardless.
declare global {
  interface Window { L?: any }
}

function useLeaflet(): boolean {
  const [ready, setReady] = useState(!!window.L);
  useEffect(() => {
    if (window.L) { setReady(true); return; }
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload = () => setReady(true);
    document.body.appendChild(script);
    return () => { document.head.removeChild(css); document.body.removeChild(script); };
  }, []);
  return ready;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started yet',
  running: 'On the way',
  arrived: 'Arrived',
  completed: 'Trip completed',
};

export function TrackingPage() {
  const { token = '' } = useParams();
  const leafletReady = useLeaflet();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const location = useQuery({
    queryKey: ['tracking', token],
    queryFn: () => trackingApi.byToken(token),
    enabled: !!token,
    refetchInterval: 30_000, // OpenStreetMap tile usage policy asks for reasonable polling — 30s is a live-enough cadence without hammering it
  });

  // Initialise the map once Leaflet has loaded AND we have a first position.
  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    if (!window.L || location.data?.lat == null || location.data?.lng == null) return;

    const map = window.L.map(mapRef.current).setView([location.data.lat, location.data.lng], 12);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);
    markerRef.current = window.L.marker([location.data.lat, location.data.lng]).addTo(map);
    mapInstance.current = map;
  }, [leafletReady, location.data]);

  // Move the marker + re-centre on every refetch, without re-creating the map.
  useEffect(() => {
    if (!mapInstance.current || !markerRef.current || location.data?.lat == null || location.data?.lng == null) return;
    const pos: [number, number] = [location.data.lat, location.data.lng];
    markerRef.current.setLatLng(pos);
    mapInstance.current.panTo(pos);
  }, [location.data]);

  if (location.isLoading) return <div className="mx-auto max-w-2xl px-4 py-10"><PageLoader /></div>;
  if (location.isError) return <div className="mx-auto max-w-2xl px-4 py-10"><ErrorState error={location.error} onRetry={location.refetch} /></div>;
  const data = location.data;
  if (!data) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Live Tracking</h1>
          <p className="text-sm text-text-muted">PNR {data.pnr} — {data.fromStopName} → {data.toStopName}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{STATUS_LABEL[data.status] ?? data.status}</span>
      </div>

      {data.lat != null && data.lng != null ? (
        <div ref={mapRef} className="h-80 w-full overflow-hidden rounded-xl border border-border" />
      ) : (
        <div className="flex h-80 w-full items-center justify-center rounded-xl border border-border bg-surface-muted text-sm text-text-muted">
          <div className="flex flex-col items-center gap-2">
            <MapPin className="h-6 w-6" />
            {data.status === 'not_started' ? 'Live location will appear once the bus starts its journey.' : 'Waiting for the next location update...'}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2 rounded-lg border border-border p-3">
          <Navigation className="h-4 w-4 text-text-muted" />
          <div><div className="text-text-muted">Speed</div><div className="font-medium text-text">{Math.round(data.speedKmph)} km/h</div></div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border p-3">
          <Clock className="h-4 w-4 text-text-muted" />
          <div><div className="text-text-muted">Delay</div><div className="font-medium text-text">{data.delayMinutes > 0 ? `${data.delayMinutes} min` : 'On time'}</div></div>
        </div>
      </div>

      <p className="text-center text-xs text-text-muted">
        Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a> contributors.
        {data.lastPingAt && ` Last updated ${new Date(data.lastPingAt).toLocaleTimeString('en-IN')}.`}
      </p>
    </div>
  );
}
