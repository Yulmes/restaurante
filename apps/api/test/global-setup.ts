/**
 * Prepara la base de prueba antes de las pruebas *.db.test.ts (`<base>_test`, nunca la de
 * desarrollo): la recrea, aplica las migraciones, crea el rol de la aplicación y carga la semilla.
 * Las URLs se pasan a las pruebas con `provide` / `inject`.
 */
import type { TestProject } from 'vitest/node';
import { createTestDatabase } from './test-database.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const { ownerUrl, appUrl } = await createTestDatabase('test');
  project.provide('ownerUrl', ownerUrl);
  project.provide('appUrl', appUrl);
}
