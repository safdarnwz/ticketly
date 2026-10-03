import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, RotateCcw, Save, Type, Square, Layers } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Select, Badge, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { appearanceApi } from '@/lib/api/platform';
import { useTheme } from '@/theme/theme-context';
import { DEFAULT_THEME } from '@/theme/defaultTheme';
import { SectionTabs } from '@/components/common/SectionTabs';
import type { Theme, ThemePatch } from '@/theme/types';

const ROLE_SCOPES = [
  { label: 'Platform default (all roles)', value: '' },
  { label: 'Super Admin', value: 'super_admin' },
  { label: 'Platform Admin', value: 'platform_admin' },
  { label: 'Operator Admin', value: 'operator_admin' },
  { label: 'Operator Staff', value: 'operator_staff' },
  { label: 'Customer', value: 'customer' },
  { label: 'Owner', value: 'owner' },
  { label: 'Manager', value: 'manager' },
  { label: 'Finance', value: 'finance' },
  { label: 'Operations', value: 'ops' },
  { label: 'Support', value: 'support' },
];

const COLOR_FIELDS: { key: keyof Theme['colors']; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'primaryFg', label: 'Primary text' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surfaceMuted', label: 'Surface muted' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Text muted' },
  { key: 'success', label: 'Success' },
  { key: 'warning', label: 'Warning' },
  { key: 'danger', label: 'Danger' },
  { key: 'info', label: 'Info' },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function AppearancePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { previewTheme, resetPreview } = useTheme();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['appearance', 'overview'],
    queryFn: () => appearanceApi.overview(),
  });

  const [scope, setScope] = useState('');
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  const baseForScope = useMemo(() => {
    const override = data?.overrides.find((o) => o.scope === scope)?.theme as ThemePatch | undefined;
    return deepMerge(data?.default ?? DEFAULT_THEME, override ?? {});
  }, [data, scope]);

  useEffect(() => {
    setThemeState(baseForScope);
  }, [baseForScope]);

  // Live-preview the working theme; restore the persisted theme on unmount.
  useEffect(() => {
    previewTheme(theme);
    return () => resetPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const save = useMutation({
    mutationFn: () => (scope === '' ? appearanceApi.savePlatformDefault(theme) : appearanceApi.saveRole(scope, theme)),
    onSuccess: () => {
      toast.success(`Theme saved${scope ? ` for ${scope}` : ''}`);
      void qc.invalidateQueries({ queryKey: ['appearance'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  if (isLoading) return <PageLoader />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const setColor = (key: keyof Theme['colors'], value: string) =>
    setThemeState((t) => ({ ...t, colors: { ...t.colors, [key]: value } }));
  const setComponent = <G extends keyof Theme['components']>(group: G, key: keyof Theme['components'][G], value: number) =>
    setThemeState((t) => ({ ...t, components: { ...t.components, [group]: { ...t.components[group], [key]: value } } }));
  const setFont = (key: keyof Theme['font'], value: number | string) =>
    setThemeState((t) => ({ ...t, font: { ...t.font, [key]: value } }));

  return (
    <>
      <PageHeader
        title="Appearance"
        subtitle="Customize the design system for the whole platform — the super-admin console, every operator's own console, and the customer site. Per-role overrides layer on top of the platform default."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setThemeState(DEFAULT_THEME)} leftIcon={<RotateCcw className="h-4 w-4" />}>
              Reset
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} leftIcon={<Save className="h-4 w-4" />}>
              Save
            </Button>
          </div>
        }
      />

      <div className="mb-6 max-w-sm">
        <Select label="Editing scope" value={scope} onChange={(e) => setScope(e.target.value)} options={ROLE_SCOPES} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Editors */}
        <div className="lg:col-span-2">
          <SectionTabs
            sections={[
              {
                key: 'colors',
                label: 'Colors',
                render: () => (
                  <Card>
                    <CardHeader
                      title={
                        <span className="flex items-center gap-2">
                          <Palette className="h-4 w-4" /> Colors
                        </span>
                      }
                    />
                    <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      {COLOR_FIELDS.map(({ key, label }) => (
                        <div key={key} className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-text-muted">{label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={theme.colors[key]}
                              onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                              className="h-9 w-9 cursor-pointer rounded-md border border-border bg-surface"
                            />
                            <input
                              value={theme.colors[key]}
                              onChange={(e) => setColor(key, e.target.value)}
                              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs text-text focus-ring"
                            />
                          </div>
                        </div>
                      ))}
                    </CardBody>
                  </Card>
                ),
              },
              {
                key: 'components',
                label: 'Components',
                render: () => (
                  <Card>
                    <CardHeader
                      title={
                        <span className="flex items-center gap-2">
                          <Square className="h-4 w-4" /> Components
                        </span>
                      }
                    />
                    <CardBody className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                      <NumberField
                        label="Button height"
                        value={theme.components.button.height}
                        min={28}
                        max={64}
                        onChange={(v) => setComponent('button', 'height', v)}
                        suffix="px"
                      />
                      <NumberField
                        label="Button radius"
                        value={theme.components.button.radius}
                        min={0}
                        max={40}
                        onChange={(v) => setComponent('button', 'radius', v)}
                        suffix="px"
                      />
                      <NumberField
                        label="Input height"
                        value={theme.components.input.height}
                        min={28}
                        max={64}
                        onChange={(v) => setComponent('input', 'height', v)}
                        suffix="px"
                      />
                      <NumberField
                        label="Input radius"
                        value={theme.components.input.radius}
                        min={0}
                        max={40}
                        onChange={(v) => setComponent('input', 'radius', v)}
                        suffix="px"
                      />
                      <NumberField
                        label="Card radius"
                        value={theme.components.card.radius}
                        min={0}
                        max={40}
                        onChange={(v) => setComponent('card', 'radius', v)}
                        suffix="px"
                      />
                      <NumberField
                        label="Card padding"
                        value={theme.components.card.padding}
                        min={8}
                        max={40}
                        onChange={(v) => setComponent('card', 'padding', v)}
                        suffix="px"
                      />
                    </CardBody>
                  </Card>
                ),
              },
              {
                key: 'type',
                label: 'Typography',
                render: () => (
                  <Card>
                    <CardHeader
                      title={
                        <span className="flex items-center gap-2">
                          <Type className="h-4 w-4" /> Typography
                        </span>
                      }
                    />
                    <CardBody className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                      <NumberField
                        label="Base font size"
                        value={theme.font.sizeBase}
                        min={12}
                        max={18}
                        onChange={(v) => setFont('sizeBase', v)}
                        suffix="px"
                      />
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <span className="text-xs font-medium text-text-muted">Font family</span>
                        {/* One family for the whole platform, bundled with the app — not a free choice. */}
                        <p className="text-sm text-text">Inter — regular 400, medium 500, headings 600</p>
                        <p className="text-xs text-text-muted">
                          The same font on every screen for passengers, operators, agents and crew.
                        </p>
                      </div>
                    </CardBody>
                  </Card>
                ),
              },
            ]}
          />
        </div>

        {/* Live preview */}
        <div className="lg:col-span-1">
          <Card className="sticky top-4">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Live preview
                </span>
              }
              subtitle="Reflects your edits instantly"
            />
            <CardBody className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Primary</Button>
                <Button size="sm" variant="secondary">
                  Secondary
                </Button>
                <Button size="sm" variant="outline">
                  Outline
                </Button>
                <Button size="sm" variant="danger">
                  Danger
                </Button>
              </div>
              <Input label="Sample input" placeholder="Type here…" />
              <Select
                label="Sample dropdown"
                options={[
                  { label: 'Option A', value: 'a' },
                  { label: 'Option B', value: 'b' },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">Confirmed</Badge>
                <Badge tone="warning">Pending</Badge>
                <Badge tone="danger">Cancelled</Badge>
                <Badge tone="info">Info</Badge>
              </div>
              <Card>
                <CardBody>
                  <div className="font-semibold text-text">Card title</div>
                  <p className="mt-1 text-sm text-text-muted">
                    This card, its radius, padding and shadow all follow your tokens.
                  </p>
                </CardBody>
              </Card>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--yb-color-primary)]"
        />
        <span className="w-12 text-right text-xs tabular-nums text-text">
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}
