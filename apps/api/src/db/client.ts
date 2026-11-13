/**
 * Fábrica del cliente de Prisma 7 con el adaptador de PostgreSQL (`@prisma/adapter-pg`).
 * La API usa `DATABASE_URL` (rol de la aplicación); la semilla y los scripts, el rol propietario.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type { PrismaClient };
