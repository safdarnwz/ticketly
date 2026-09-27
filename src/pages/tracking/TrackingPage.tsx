import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Navigation, Clock, MapPin, Phone, CalendarClock, CheckCircle2, XCircle, Bus } from 'lucide-react';

import { PageLoader, ErrorState } from '@/components/ui';
import { trackingApi, type CrewContact, type LiveLocation, type TrackingPhase } from '@/lib/api/tracking';
import { cn, formatDateTime, formatTime } from '@/lib/utils';

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
  not_started: 'Waiting for the first GPS fix',
  running: 'On the way',
};

const PHASE: Record<TrackingPhase, { label: string; tone: string; icon: typeof Clock }> = {
  too_early: { label: 'Not started yet', tone: 'border-warning/40 bg-warning/10 text-warning', icon: CalendarClock },
  live: { label: 'Live', tone: 'border-success/40 bg-success/10 text-success', icon: Navigation },
  ended: { label: 'Journey over', tone: 'border-border bg-surface-muted text-text-muted', icon: CheckCircle2 },
  cancelled: { label: 'Trip cancelled', tone: 'border-danger/40 bg-danger/5 text-danger', icon: XCircle },
  booking_cancelled: { label: 'Booking cancelled', tone: 'border-danger/40 bg-danger/5 text-danger', icon: XCircle },
};

const ROLE_LABEL: Record<string, string> = { driver: 'Driver', conductor: 'Conductor', attendant: 'Attendant' };

/** Drivers numbered when there are several (a long run has two or three taking turns). */
function CrewCard({ crew, busNumber }: { crew: CrewContact[]; busNumber: string | null }) {
  const drivers = crew.filter((c) => c.role === 'driver').length;
  let n = 0;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Your bus crew</h2>
        {busNumber && (
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-text">
            <Bus className="h-3.5 w-3.5" /> {busNumber}
          </span>
        )}
      </div>
      {crew.length === 0 ? (
        <p className="text-sm text-text-muted">The operator has not assigned the crew yet — their names and numbers show here once they do.</p>
      ) : (
        <ul className="divide-y divide-border">
          {crew.map((c, i) => {
            const label = c.role === 'driver' && drivers > 1 ? `Driver ${++n}` : (ROLE_LABEL[c.role] ?? c.role);
            return (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="font-medium text-text">{c.name}</div>
                  <div className="text-xs text-text-muted">{label}</div>
                </div>
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
                    <Phone className="h-3.5 w-3.5" /> {c.phone}
                  </a>
                ) : (
                  <span className="text-xs text-text-muted">No number on file</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The trip times, shown whenever the map is not. */
function TripTimes({ data }: { data: LiveLocation }) {
  const rows: [string, string][] =
    data.phase === 'too_early'
      ? [['Bus leaves', formatDateTime(data.departsAt)], ['Tracking starts', formatDateTime(data.trackingStartsAt)]]
      : data.phase === 'ended' && data.endedAt
        ? [['Bus left', formatDateTime(data.departsAt)], ['Journey ended', formatDateTime(data.endedAt)]]
        : [];
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border p-3">
          <div className="text-text-muted">{k}</div>
          <div className="font-medium text-text">{v}</div>
        </div>
      ))}
    </div>
  );
}

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
    // Live: every 30 s (the OpenStreetMap tile policy asks for reasonable
    // polling). Before the window: a minute, so the map appears on its own
    // when tracking starts. Once the journey is over, nothing changes.
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      return phase === 'live' ? 30_000 : phase === 'too_early' ? 60_000 : false;
    },
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

  const phase = PHASE[data.phase] ?? PHASE.live;
  const PhaseIcon = phase.icon;
  const live = data.phase === 'live';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl text-text">Live Tracking</h1>
          <p className="text-sm text-text-muted">PNR {data.pnr} — {data.fromStopName} → {data.toStopName}</p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', phase.tone)}>
          {live ? (STATUS_LABEL[data.status] ?? phase.label) : phase.label}
        </span>
      </div>

      {!live && (
        <div className={cn('flex items-start gap-3 rounded-xl border p-4 text-sm', phase.tone)}>
          <PhaseIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-text">{data.message}</p>
        </div>
      )}

      {live && (data.lat != null && data.lng != null ? (
        <div className="relative h-80 w-full overflow-hidden rounded-xl border border-border">
          <div ref={mapRef} className="h-full w-full" />
          {!leafletReady && (
            // The map script comes from a CDN; until it loads (or if a network blocks it) the
            // passenger still sees where the bus is and can open it in their maps app.
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-muted px-6 text-center text-sm text-text-muted">
              <MapPin className="h-6 w-6 text-primary" />
              <div>Bus last seen at {data.lat.toFixed(4)}, {data.lng.toFixed(4)}{data.lastPingAt ? ` (${formatTime(data.lastPingAt)})` : ''}</div>
              <a href={`https://www.google.com/maps?q=${data.lat},${data.lng}`} target="_blank" rel="noreferrer" className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-primary">Open in Google Maps</a>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-80 w-full items-center justify-center rounded-xl border border-border bg-surface-muted text-sm text-text-muted">
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <MapPin className="h-6 w-6" />
            The crew phone has not sent its first location yet — the bus appears here as soon as it does.
          </div>
        </div>
      ))}

      {live && (
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
      )}

      <TripTimes data={data} />

      {(live || data.phase === 'too_early') && <CrewCard crew={data.crew} busNumber={data.busNumber} />}

      {live && (
        <p className="text-center text-xs text-text-muted">
          Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a> contributors.
          {data.lastPingAt && ` Last updated ${formatTime(data.lastPingAt)}.`}
        </p>
      )}
    </div>
  );
}
