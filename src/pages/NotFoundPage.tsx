import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-muted text-text-muted">
        <Compass className="h-8 w-8" />
      </div>
      <div>
        <h1 className="text-3xl font-semibold text-text">Page not found</h1>
        <p className="mt-1 text-text-muted">The page you’re looking for doesn’t exist.</p>
      </div>
      <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
    </div>
  );
}
