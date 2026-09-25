import { useQuery } from '@tanstack/react-query';
import { Copy, Percent, ShieldCheck, Ticket, MapPinned } from 'lucide-react';

import { Card, CardBody, Skeleton, useToast } from '@/components/ui';
import { SearchForm } from '@/components/customer/SearchForm';
import { cmsApi } from '@/lib/api/content';
import { formatDateLabel, localDateOf } from '@/lib/utils';

export function HomePage() {
  const toast = useToast();
  const banners = useQuery({ queryKey: ['banners'], queryFn: cmsApi.banners, staleTime: 5 * 60_000 });
  const offers = useQuery({ queryKey: ['offers'], queryFn: cmsApi.offers, staleTime: 5 * 60_000 });

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Code ${code} copied — apply it at checkout`);
    } catch {
      toast.info(`Your code: ${code}`);
    }
  };

  const bannerItems = banners.data?.items ?? [];
  const offerItems = offers.data?.items ?? [];

  return (
    <div>
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-16">
          <h1 className="font-display text-4xl leading-[1.1] tracking-tight text-text sm:text-5xl">
            Travel further, <span className="text-accent-c">booked simply.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-text-muted">
            Compare buses from every operator, pick your seat on a live seat map and get an instant e-ticket.
          </p>
        </div>
      </section>

      <div className="mx-auto -mt-9 max-w-5xl px-4">
        <Card className="elev-2">
          <CardBody>
            <SearchForm />
          </CardBody>
        </Card>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12">
        {banners.isLoading ? (
          <Skeleton className="mb-10 h-40 w-full" />
        ) : bannerItems.length > 0 && (
          <div className="mb-10 flex snap-x gap-4 overflow-x-auto pb-2">
            {bannerItems.map((bn) => {
              const img = <img src={bn.imageUrl} alt={bn.title} loading="lazy" className="h-40 w-full rounded-card object-cover sm:h-48" />;
              return (
                <div key={bn.id} className="w-[85%] shrink-0 snap-start sm:w-[48%]">
                  {bn.linkUrl ? <a href={bn.linkUrl} rel="noopener noreferrer">{img}</a> : img}
                </div>
              );
            })}
          </div>
        )}

        {offers.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        ) : offerItems.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-3 font-display text-2xl tracking-tight text-text">Offers for you</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {offerItems.map((o) => (
                <Card key={o.code}>
                  {o.bannerUrl && <img src={o.bannerUrl} alt="" loading="lazy" className="h-28 w-full rounded-t-card object-cover" />}
                  <CardBody>
                    <div className="flex items-center gap-2 text-accent"><Percent className="h-4 w-4" /><span className="font-semibold">{o.title}</span></div>
                    {o.description && <p className="mt-1 text-sm text-text-muted">{o.description}</p>}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      {o.couponCode ? (
                        <button
                          type="button"
                          onClick={() => void copy(o.couponCode!)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/50 px-2 py-1 font-mono text-xs text-primary hover:bg-primary/5"
                        >
                          {o.couponCode} <Copy className="h-3 w-3" />
                        </button>
                      ) : <span />}
                      <span className="text-xs text-text-muted">Valid till {formatDateLabel(localDateOf(o.validTo), { day: '2-digit', month: 'short' })}</span>
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: 'Secure payments', desc: 'UPI, cards and net banking' },
            { icon: Ticket, title: 'Instant e-tickets', desc: 'Signed QR, checked at boarding' },
            { icon: MapPinned, title: 'Live tracking', desc: 'Follow your bus on the day' },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title}><CardBody className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"><Icon className="h-5 w-5" /></div>
              <div><div className="font-semibold text-text">{title}</div><div className="text-sm text-text-muted">{desc}</div></div>
            </CardBody></Card>
          ))}
        </div>
      </div>
    </div>
  );
}
