// Central data layer (RF-5): TanStack Query client + the session-level queries.
// Mutations invalidate here instead of the old whole-app `refresh()` reload.
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
})

/** Server health + account/entitlement state — the signal all routing gates read. */
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, refetchOnWindowFocus: true })

/** The active profile (null until one is created). */
export const useProfile = (enabled = true) =>
  useQuery({ queryKey: ['profile'], queryFn: api.getProfile, enabled })

export const useInterviews = () => useQuery({ queryKey: ['interviews'], queryFn: api.listInterviews })
export const useWeaknesses = () => useQuery({ queryKey: ['weaknesses'], queryFn: api.listWeaknesses })
export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: api.listProfiles })

/** After a session-shaping mutation (auth, profile switch/create/delete, plan change): drop everything. */
export function useInvalidateSession(): () => Promise<void> {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}
