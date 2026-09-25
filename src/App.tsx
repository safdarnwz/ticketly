import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { ToastProvider } from '@/components/ui';
import { router } from '@/router';
import { ApiError } from '@/lib/api/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx (not found, forbidden, validation) will not change on retry;
      // only network errors and 5xx are worth one more try.
      retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
