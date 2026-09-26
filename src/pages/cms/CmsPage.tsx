import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import { fromAppDateTimeInput } from '@/lib/utils';

import { Button, Card, CardBody, CardHeader, Input, EmptyState, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { cmsApi } from '@/lib/api/content';

export function CmsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState({ code: '', title: '', couponCode: '', validFrom: '', validTo: '' });

  const offers = useQuery({ queryKey: ['offers'], queryFn: () => cmsApi.offers() });
  const banners = useQuery({ queryKey: ['banners'], queryFn: () => cmsApi.banners() });

  const create = useMutation({
    mutationFn: () => cmsApi.upsertOffer({
      code: offer.code, title: offer.title, couponCode: offer.couponCode || undefined,
      validFrom: new Date(fromAppDateTimeInput(offer.validFrom)).toISOString(), validTo: new Date(fromAppDateTimeInput(offer.validTo)).toISOString(),
    }),
    onSuccess: () => { toast.success('Offer saved'); setOpen(false); void qc.invalidateQueries({ queryKey: ['offers'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to save offer'),
  });

  return (
    <>
      <PageHeader
        title="CMS & Offers"
        subtitle="Storefront content, banners and promotional offers"
        action={<Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>New offer</Button>}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Live offers</span>} />
          <CardBody>
            {offers.isLoading ? <PageLoader /> : offers.isError ? <ErrorState error={offers.error} onRetry={offers.refetch} /> :
              offers.data?.items?.length ? (
                <div className="flex flex-col gap-2">
                  {offers.data.items.map((o) => (
                    <div key={o.code} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                      <div>
                        <div className="font-medium text-text">{o.title}</div>
                        <div className="text-xs text-text-muted">{o.code}{o.couponCode ? ` · Coupon: ${o.couponCode}` : ''}</div>
                      </div>
                      <div className="text-xs text-text-muted">{new Date(o.validFrom).toLocaleDateString('en-IN')} – {new Date(o.validTo).toLocaleDateString('en-IN')}</div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No live offers" description="Create one to promote on the storefront." />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Active banners" />
          <CardBody>
            {banners.isLoading ? <PageLoader /> :
              banners.data?.items?.length ? (
                <div className="flex flex-col gap-2">
                  {banners.data.items.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                      <div className="flex items-center gap-3">
                        <img src={b.imageUrl} alt={b.title} className="h-10 w-16 rounded object-cover" />
                        <div>
                          <div className="font-medium text-text">{b.title}</div>
                          {b.linkUrl && <div className="text-xs text-text-muted">{b.linkUrl}</div>}
                        </div>
                      </div>
                      <span className="text-xs text-text-muted">#{b.sortOrder}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No banners" />}
          </CardBody>
        </Card>
      </div>

      {open && (
        <Card className="mt-6">
          <CardHeader title="New offer" action={<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>} />
          <CardBody className="flex flex-col gap-4">
            <Input label="Code" value={offer.code} onChange={(e) => setOffer({ ...offer, code: e.target.value })} />
            <Input label="Title" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
            <Input label="Coupon code (optional)" value={offer.couponCode} onChange={(e) => setOffer({ ...offer, couponCode: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Valid from" type="datetime-local" value={offer.validFrom} onChange={(e) => setOffer({ ...offer, validFrom: e.target.value })} />
              <Input label="Valid to" type="datetime-local" value={offer.validTo} onChange={(e) => setOffer({ ...offer, validTo: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} loading={create.isPending}>Save</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
