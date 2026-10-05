import { QueryClient } from '@tanstack/react-query'

/**
 * The app-wide query cache, in its own module so non-React code (the auth
 * store's logout) can clear it. Logout must drop every cached response: the
 * keys are not user-scoped and entries stay fresh for `staleTime`, so the next
 * person to sign in on this browser would otherwise see the previous user's
 * data render before anything refetches.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})