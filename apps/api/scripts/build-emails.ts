/**
 * Compila la plantilla MJML de los correos a HTML (ADR 0004): `npm run emails:build -w @marea-baja/api`.
 *
 * MJML es solo una herramienta de desarrollo: el HTML compilado se versiona y la API en
 * ejecución solo reemplaza textos (con escape). `templates.test.ts` falla si el HTML versionado
 * no coincide con la compilación de la plantilla.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mjml2html from 'mjml';

export const SOURCE = fileURLToPath(
  new URL('../src/modules/notifications/templates/layout.mjml', import.meta.url),
);
export const OUTPUT = fileURLToPath(
  new URL('../src/modules/notifications/templates/layout.html', import.meta.url),
);

export async function compileLayout(): Promise<string> {
  const result = await mjml2html(readFileSync(SOURCE, 'utf8'), { validationLevel: 'strict', minify: false });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((e) => e.formattedMessage).join('\n'));
  }
  return `${result.html.trim()}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUTPUT, await compileLayout());
  console.log('Plantilla de correo compilada.');
}
