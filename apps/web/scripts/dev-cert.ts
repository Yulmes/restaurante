/**
 * Certificado TLS local, SOLO para servir el build con HTTP/2 en las mediciones (M4):
 *
 *   npm run cert:dev -w @marea-baja/web              (crea o reutiliza; muestra el estado)
 *   npm run cert:dev -w @marea-baja/web -- --renew   (renovación forzada)
 *
 * - Autofirmado para `localhost` y `127.0.0.1`, clave EC P-256, firma SHA-256, uso `serverAuth`.
 *   No es una autoridad de certificación (no puede firmar otros) y no sirve para producción.
 * - Vive FUERA del repositorio: `%LOCALAPPDATA%\marea-baja\dev-certs` en Windows o
 *   `~/.cache/marea-baja/dev-certs` en otros sistemas (`DEV_CERT_DIR` para cambiarlo). La carpeta
 *   del perfil ya está limitada al usuario; además los archivos se escriben con permisos 0600.
 * - Vale 30 días y se renueva solo si falta, si vence en menos de 3 días, si no cubre los nombres
 *   o si la clave no coincide con el certificado.
 * - No se instala en el almacén de confianza del sistema. Solo lo acepta el Chromium de las
 *   pruebas, por la huella de su clave pública (`--ignore-certificate-errors-spki-list`): cualquier
 *   otro certificado inválido sigue rechazándose.
 */
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';

export const DEV_CERT_HOSTS = { dns: 'localhost', ip: '127.0.0.1' } as const;
const VALID_DAYS = 30;
const RENEW_BEFORE_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

export interface DevCert {
  keyPath: string;
  certPath: string;
  key: Buffer;
  cert: Buffer;
  /** SHA-256 de la clave pública (SPKI), en base64: lo que acepta Chromium. */
  spki: string;
  validTo: Date;
  created: boolean;
}

export function devCertDir(): string {
  if (process.env['DEV_CERT_DIR']) return process.env['DEV_CERT_DIR'];
  const base = process.env['LOCALAPPDATA'] ?? join(homedir(), '.cache');
  return join(base, 'marea-baja', 'dev-certs');
}

function spkiOf(cert: X509Certificate): string {
  return createHash('sha256')
    .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
}

/** Motivo por el que hay que (re)generar, o `null` si el certificado sirve. */
function problem(keyPath: string, certPath: string, now: Date): string | null {
  if (!existsSync(keyPath) || !existsSync(certPath)) return 'no existe';
  try {
    const cert = new X509Certificate(readFileSync(certPath));
    if (!cert.checkPrivateKey(createPrivateKey(readFileSync(keyPath)))) return 'la clave no coincide';
    if (!cert.checkHost(DEV_CERT_HOSTS.dns) || !cert.checkIP(DEV_CERT_HOSTS.ip))
      return 'no cubre los nombres';
    if (new Date(cert.validTo).getTime() - now.getTime() < RENEW_BEFORE_DAYS * DAY) return 'vence pronto';
    return null;
  } catch {
    return 'archivo ilegible';
  }
}

export async function ensureDevCert({ renew = false } = {}): Promise<DevCert> {
  const dir = devCertDir();
  const keyPath = join(dir, 'marea-baja-local.key.pem');
  const certPath = join(dir, 'marea-baja-local.cert.pem');
  const now = new Date();
  const reason = renew ? 'renovación pedida' : problem(keyPath, certPath, now);
  if (reason) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const pems = await generate([{ name: 'commonName', value: 'Marea Baja · medición local' }], {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate: new Date(now.getTime() - 60_000),
      notAfterDate: new Date(now.getTime() + VALID_DAYS * DAY),
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: DEV_CERT_HOSTS.dns },
            { type: 7, ip: DEV_CERT_HOSTS.ip },
          ],
        },
      ],
    });
    writeFileSync(keyPath, pems.private, { mode: 0o600 });
    writeFileSync(certPath, pems.cert, { mode: 0o644 });
    const check = problem(keyPath, certPath, now);
    if (check) throw new Error(`El certificado local recién generado no es válido: ${check}`);
  }
  const cert = readFileSync(certPath);
  const x509 = new X509Certificate(cert);
  return {
    keyPath,
    certPath,
    key: readFileSync(keyPath),
    cert,
    spki: spkiOf(x509),
    validTo: new Date(x509.validTo),
    created: reason !== null,
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/') ?? ''}`) {
  const cert = await ensureDevCert({ renew: process.argv.includes('--renew') });
  console.log(
    `${cert.created ? 'Certificado local generado' : 'Certificado local vigente'}: ${cert.certPath}`,
  );
  console.log(`Vence: ${cert.validTo.toISOString()} · SPKI SHA-256: ${cert.spki}`);
}
