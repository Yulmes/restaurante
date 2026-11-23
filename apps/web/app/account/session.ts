import {
  meResponseSchema,
  sessionResponseSchema,
  sessionStateResponseSchema,
  type PublicUser,
} from '@marea-baja/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet, rememberCsrfToken } from './api.ts';

/** Sesión actual (TanStack Query, §4.4). `null` = invitado. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<PublicUser | null> {
  try {
    return (await apiGet('/api/auth/me', meResponseSchema)).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, staleTime: 30_000, retry: false });
}

/**
 * M5: sesión para el pedido y la barra de las páginas públicas. Usa `/api/auth/session`, que
 * responde 200 también al invitado: ninguna página pública registra un 401 en la consola.
 */
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

export function useSessionUser() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => (await apiGet('/api/auth/session', sessionStateResponseSchema)).user,
    staleTime: 30_000,
    retry: false,
  });
}

/** Guarda la sesión que devolvió la API (login, verificación, cambio de contraseña). */
export function useApplySession() {
  const client = useQueryClient();
  return (response: unknown) => {
    const session = sessionResponseSchema.parse(response);
    rememberCsrfToken(session.csrfToken);
    client.setQueryData(ME_QUERY_KEY, session.user);
    client.setQueryData(SESSION_QUERY_KEY, session.user);
    return session.user;
  };
}

/** Tras cerrar sesión: el token CSRF de la sesión ya no sirve y el usuario pasa a invitado. */
export function useClearSession() {
  const client = useQueryClient();
  return () => {
    rememberCsrfToken(null);
    client.setQueryData(ME_QUERY_KEY, null);
    client.setQueryData(SESSION_QUERY_KEY, null);
  };
}
