/**
 * Compila las plantillas MJML de los correos a HTML (ADR 0004): `npm run emails:build -w @marea-baja/api`.
 *
 * MJML es solo una herramienta de desarrollo: el HTML compilado se versiona y la API en
 * ejecución solo reemplaza textos (con escape). `notifications.test.ts` falla si algún HTML
 * versionado no coincide con la compilación de su plantilla.
 *
 * - `layout.mjml`: correos con enlace de un solo uso (verificación y recuperación, M3).
 * - `order-layout.mjml`: correos de pedidos y el aviso al staff (M7).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mjml2html from 'mjml';

const templates = (file: string) =>
  fileURLToPath(new URL(`../src/modules/notifications/templates/${file}`, import.meta.url));

export const SOURCE = templates('layout.mjml');
export const OUTPUT = templates('layout.html');
export const ORDER_SOURCE = templates('order-layout.mjml');
export const ORDER_OUTPUT = templates('order-layout.html');

async function compile(source: string): Promise<string> {
  const result = await mjml2html(readFileSync(source, 'utf8'), { validationLevel: 'strict', minify: false });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((e) => e.formattedMessage).join('\n'));
  }
  return `${result.html.trim()}\n`;
}

export function compileLayout(): Promise<string> {
  return compile(SOURCE);
}

export function compileOrderLayout(): Promise<string> {
  return compile(ORDER_SOURCE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUTPUT, await compileLayout());
  writeFileSync(ORDER_OUTPUT, await compileOrderLayout());
  console.log('Plantillas de correo compiladas.');
}
