import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigation, Clock, RefreshCw } from 'lucide-react';

import { Card, CardBody, Badge } from '@/components/ui';
import { trackingApi } from '@/lib/api/tracking';

/**
 * Text-based live status (ETA, delay, last-ping time) rather than an actual
 * map — a full interactive map needs a maps SDK (Google Maps/Leaflet) which
 * is a separate integration; this covers "where's my bus" without one.
 * Polls every 20s while mounted.
 */
export function LiveTrackingCard({ tripId }: { tripId: string }) {
  const [enabled, setEnabled] = useState(false);
  const live = useQuery({
    queryKey: ['live-trip', tripId],
    queryFn: () => trackingApi.live(tripId),
    enabled,
    refetchInterval: enabled ? 20_000 : false,
  });

  useEffect(() => { setEnabled(true); }, []);

  if (!enabled) return null;

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-text"><Navigation className="h-4 w-4" /> Live tracking</span>
          <button type="button" onClick={() => void live.refetch()} className="text-text-muted hover:text-text">
            <RefreshCw className={`h-4 w-4 ${live.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!live.data ? (
          <p className="text-sm text-text-muted">No GPS data yet — tracking starts once the bus departs.</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            {live.data.status && <Badge tone={live.data.status === 'on_time' ? 'success' : live.data.status === 'delayed' ? 'warning' : 'neutral'}>{live.data.status.replace('_', ' ')}</Badge>}
            {live.data.delayMinutes !== null && live.data.delayMinutes > 0 && (
              <div className="flex items-center gap-1.5 text-warning"><Clock className="h-4 w-4" /> Running {live.data.delayMinutes} min late</div>
            )}
            {live.data.nextStopEtaAt && (
              <div className="flex justify-between"><span className="text-text-muted">Next stop ETA</span><span className="font-medium">{new Date(live.data.nextStopEtaAt).toLocaleTimeString()}</span></div>
            )}
            {live.data.speedKmph !== null && (
              <div className="flex justify-between"><span className="text-text-muted">Speed</span><span className="font-medium">{live.data.speedKmph} km/h</span></div>
            )}
            {live.data.lastPingAt && (
              <p className="text-[11px] text-text-muted">Updated {new Date(live.data.lastPingAt).toLocaleTimeString()}</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
