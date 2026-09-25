import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowLeftRight, ShieldCheck, Ticket, Percent } from 'lucide-react';

import { Button, Card, CardBody } from '@/components/ui';
import { CityInput } from '@/components/customer/CityInput';
import { useBooking } from '@/stores/booking';
import { cmsApi } from '@/lib/api/content';
import { slugifyCityName } from '@/lib/utils';

export function HomePage() {
  const navigate = useNavigate();
  const b = useBooking();
  const [date, setDate] = useState(b.journeyDate);

  const offers = useQuery({ queryKey: ['offers'], queryFn: () => cmsApi.offers(), retry: 0 });

  const swap = () => b.setSearch({
    originCityId: b.destCityId, originLabel: b.destLabel,
    destCityId: b.originCityId, destLabel: b.originLabel,
  });

  const canSearch = b.originCityId && b.destCityId && date;
  const onSearch = () => {
    if (!canSearch) return;
    b.setSearch({ journeyDate: date });
    // Human-readable city slugs in the URL, never the raw UUID — see
    // slugifyCityName's own doc comment for why this must derive from the
    // name the same way the backend does, not carry the id at all.
    navigate(`/results?from=${slugifyCityName(b.originLabel)}&to=${slugifyCityName(b.destLabel)}&date=${date}`);
  };

  return (
    <div>
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-20">
          <p className="mx-auto mb-4 inline-flex items-center gap-2 rounded-pill border border-border px-3 py-1 text-xs font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Live seat availability across the network
          </p>
          <h1 className="font-display text-4xl leading-[1.1] tracking-tight text-text sm:text-5xl">
            Travel further, <span className="text-accent-c">booked simply.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-text-muted">
            Thousands of routes, real-time seat maps and instant signed e-tickets — a clean, fast way to book the bus.
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-9 max-w-4xl px-4">
        <Card className="elev-2">
          <CardBody>
            <div className="flex flex-col items-end gap-3 md:flex-row">
              <CityInput label="From" value={b.originLabel} onSelect={(c) => b.setSearch({ originCityId: c.id, originLabel: c.name })} />
              <button type="button" onClick={swap} className="mb-1 hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:bg-surface-muted md:flex" aria-label="Swap">
                <ArrowLeftRight className="h-4 w-4" />
              </button>
              <CityInput label="To" value={b.destLabel} onSelect={(c) => b.setSearch({ destCityId: c.id, destLabel: c.name })} />
              <div className="w-full md:w-44">
                <label className="mb-1.5 block text-sm font-medium text-text">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12 w-full rounded-input border border-border bg-surface px-3 text-sm text-text focus-ring" />
              </div>
              <Button size="lg" onClick={onSearch} disabled={!canSearch} leftIcon={<Search className="h-4 w-4" />} className="w-full md:w-auto">Search</Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: 'Secure payments', desc: 'Encrypted, PCI-friendly checkout' },
            { icon: Ticket, title: 'Instant e-tickets', desc: 'Signed QR, verified at the gate' },
            { icon: Percent, title: 'Best offers', desc: 'Live deals from operators' },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} interactive><CardBody className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"><Icon className="h-5 w-5" /></div>
              <div><div className="font-semibold text-text">{title}</div><div className="text-sm text-text-muted">{desc}</div></div>
            </CardBody></Card>
          ))}
        </div>

        {Array.isArray(offers.data?.offers) && offers.data!.offers.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 font-display text-2xl tracking-tight text-text">Live offers</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(offers.data!.offers as any[]).map((o, i) => (
                <Card key={i}><CardBody>
                  <div className="flex items-center gap-2 text-accent"><Percent className="h-4 w-4" /><span className="font-semibold">{o.title ?? o.code}</span></div>
                  {o.description && <p className="mt-1 text-sm text-text-muted">{o.description}</p>}
                  {o.couponCode && <div className="mt-2 inline-block rounded-md border border-dashed border-border px-2 py-1 text-xs font-mono">{o.couponCode}</div>}
                </CardBody></Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
