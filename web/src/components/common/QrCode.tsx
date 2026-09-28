import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { Skeleton } from '@/components/ui';

/** A QR image of `value`, drawn in the browser (no third-party service sees it). */
export function QrCode({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [value, size]);
  if (failed) return <p className="text-xs text-danger">Could not draw the QR code — use the printed ticket.</p>;
  if (!src) return <Skeleton className="rounded-md" />;
  return <img src={src} width={size} height={size} alt={label} className="rounded-md bg-white p-1" />;
}
