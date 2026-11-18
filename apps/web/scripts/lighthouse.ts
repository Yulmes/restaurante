/**
 * Lighthouse sobre el build de producción servido localmente (M4, §11: "Inicio y carta
 * prerenderizadas"). Dos modos, con las mismas páginas, el mismo build y las mismas condiciones
 * de Lighthouse; solo cambia el transporte:
 *
 *   1. API levantada (con PostgreSQL) y build con el mismo origen que se mide:
 *        VITE_SITE_URL=http://127.0.0.1:4173 npm run build -w @marea-baja/web
 *   2a. HTTP/1.1 (referencia histórica):
 *        npm run preview -w @marea-baja/web       y luego   npm run lighthouse -w @marea-baja/web
 *   2b. HTTP/2 con TLS local (referencia de entrega, como el CDN):
 *        npm run preview:h2 -w @marea-baja/web    y luego   npm run lighthouse:h2 -w @marea-baja/web
 *
 * Usa el Chromium de Playwright (ya instalado para las E2E); no descarga otro navegador. En HTTP/2
 * acepta SOLO el certificado local de `dev-cert.ts`, por la huella de su clave pública; no
 * desactiva la validación TLS. Corre cada página LH_RUNS veces (3 por defecto) en escritorio y en
 * móvil y toma la **mediana**. Cada corrida registra el protocolo negociado y las conexiones: si
 * alguna respuesta del sitio no llegó con el protocolo del modo, la corrida es **inválida**, no
 * entra en la mediana y el comando termina con error. Los resultados de cada modo van a
 * `lighthouse-report/<h1|h2>/` (ignorado por git), con `summary.json` y el informe HTML de la
 * corrida mediana. Variables: LH_BASE_URL, LH_RUNS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:http2';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import lighthouse, { desktopConfig, type Flags, type RunnerResult } from 'lighthouse';
import { ensureDevCert } from './dev-cert.ts';

const HTTP2 = process.argv.includes('--http2');
const MODE = HTTP2 ? 'h2' : 'h1';
const EXPECTED_PROTOCOL = HTTP2 ? 'h2' : 'http/1.1';
const BASE = (process.env['LH_BASE_URL'] ?? `${HTTP2 ? 'https' : 'http'}://127.0.0.1:4173`).replace(
  /\/+$/,
  '',
);
const RUNS = Number(process.env['LH_RUNS'] ?? 3);
const OUT = fileURLToPath(new URL(`../lighthouse-report/${MODE}/`, import.meta.url));
const PORT = 9333;

export const PAGES = [
  '/',
  '/en',
  '/carta',
  '/en/menu',
  '/carta/ceviches',
  '/en/menu/ceviches',
  '/carta/ceviches/ceviche-clasico',
  '/en/menu/ceviches/ceviche-clasico',
] as const;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
type Category = (typeof CATEGORIES)[number];

interface RequestTiming {
  url: string;
  startMs: number;
  endMs: number;
  kb: number;
}

interface RunSummary {
  valid: boolean;
  protocols: Record<string, number>;
  connections: number;
  scores: Record<Category, number>;
  metrics: { lcpMs: number; cls: number; tbtMs: number; fcpMs: number; ttiMs: number };
  /** Tiempos observados (sin limitación) de las solicitudes que deciden el LCP. */
  requests: {
    document: RequestTiming | null;
    stylesheet: RequestTiming | null;
    lcpImage: (RequestTiming & { position: number }) | null;
    initialScripts: { count: number; kb: number; lastEndMs: number };
    total: number;
  };
  failing: { id: string; title: string; score: number | null }[];
  html: string;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

interface NetworkItem {
  url: string;
  resourceType?: string;
  priority?: string;
  networkRequestTime: number;
  networkEndTime: number;
  transferSize: number;
}

/** Protocolo y conexión de cada respuesta del sitio, leídos del registro de DevTools. */
function negotiated(result: RunnerResult): { protocols: Record<string, number>; connections: number } {
  const protocols: Record<string, number> = {};
  const connections = new Set<number>();
  for (const event of result.artifacts.DevtoolsLog) {
    if (event.method !== 'Network.responseReceived') continue;
    const response = (event.params as { response: { url: string; protocol?: string; connectionId: number } })
      .response;
    if (!response.url.startsWith(BASE)) continue;
    const protocol = response.protocol ?? 'desconocido';
    protocols[protocol] = (protocols[protocol] ?? 0) + 1;
    connections.add(response.connectionId);
  }
  return { protocols, connections: connections.size };
}

function requestTimings(result: RunnerResult): RunSummary['requests'] {
  const details = result.lhr.audits['network-requests']?.details as { items?: NetworkItem[] } | undefined;
  const items = (details?.items ?? []).filter((i) => i.url.startsWith(BASE));
  const toTiming = (i: NetworkItem): RequestTiming => ({
    url: i.url.replace(BASE, ''),
    startMs: Math.round(i.networkRequestTime),
    endMs: Math.round(i.networkEndTime),
    kb: Math.round(i.transferSize / 102.4) / 10,
  });
  const timing = (i: NetworkItem | undefined): RequestTiming | null => (i ? toTiming(i) : null);
  const document = items.find((i) => i.resourceType === 'Document');
  // La foto LCP es la única imagen con `fetchpriority="high"` (prioridad High); la carta no tiene.
  const imageIndex = items.findIndex((i) => i.resourceType === 'Image' && i.priority === 'High');
  const image = items[imageIndex];
  const firstWave = (document?.networkEndTime ?? 0) + 100;
  const scripts = items.filter((i) => i.resourceType === 'Script' && i.networkRequestTime <= firstWave);
  return {
    document: timing(document),
    stylesheet: timing(items.find((i) => i.resourceType === 'Stylesheet')),
    lcpImage: image ? { ...toTiming(image), position: imageIndex + 1 } : null,
    initialScripts: {
      count: scripts.length,
      kb: Math.round(scripts.reduce((a, i) => a + i.transferSize, 0) / 1024),
      lastEndMs: Math.round(Math.max(0, ...scripts.map((i) => i.networkEndTime))),
    },
    total: items.length,
  };
}

function summarize(result: RunnerResult): RunSummary {
  const lhr = result.lhr;
  const scores = Object.fromEntries(
    CATEGORIES.map((c) => [c, Math.round((lhr.categories[c]?.score ?? 0) * 100)]),
  ) as Record<Category, number>;
  const metric = (id: string) => lhr.audits[id]?.numericValue ?? 0;
  const failing = CATEGORIES.flatMap((c) => lhr.categories[c]?.auditRefs ?? [])
    .filter((ref) => ref.weight > 0)
    .map((ref) => lhr.audits[ref.id])
    .filter((audit) => audit !== undefined && audit.score !== null && audit.score < 0.9)
    .map((audit) => ({ id: audit?.id ?? '', title: audit?.title ?? '', score: audit?.score ?? null }));
  const html = Array.isArray(result.report) ? (result.report[0] ?? '') : result.report;
  const { protocols, connections } = negotiated(result);
  const total = Object.values(protocols).reduce((a, n) => a + n, 0);
  return {
    valid: total > 0 && (protocols[EXPECTED_PROTOCOL] ?? 0) === total,
    protocols,
    connections,
    scores,
    metrics: {
      lcpMs: metric('largest-contentful-paint'),
      cls: metric('cumulative-layout-shift'),
      tbtMs: metric('total-blocking-time'),
      fcpMs: metric('first-contentful-paint'),
      ttiMs: metric('interactive'),
    },
    requests: requestTimings(result),
    failing: [...new Map(failing.map((f) => [f.id, f])).values()],
    html,
  };
}

/** GET a una ruta del servidor medido. En HTTP/2 confía solo en el certificado local y exige h2. */
async function probe(path: string, ca: Buffer | null): Promise<number> {
  if (!ca) return (await fetch(`${BASE}${path}`)).status;
  return new Promise((resolve, reject) => {
    const session = connect(BASE, { ca, ALPNProtocols: ['h2'] });
    session.on('error', reject);
    const req = session.request({ ':path': path });
    req.on('response', (headers) => {
      resolve(Number(headers[':status']));
      session.close();
    });
    req.on('error', reject);
    req.resume();
    req.end();
  });
}

async function preflight(ca: Buffer | null): Promise<void> {
  const serve = `npm run ${HTTP2 ? 'preview:h2' : 'preview'} -w @marea-baja/web`;
  const site = await probe('/sitemap.xml', ca).catch(() => 0);
  if (site !== 200) throw new Error(`No responde ${BASE} (${MODE}). Levantá el build con "${serve}".`);
  const api = await probe('/api/public/catalog?locale=es-CR', ca).catch(() => 0);
  if (api === 502 || api === 0)
    throw new Error('La API no responde detrás del build. Levantala con "npm run start -w @marea-baja/api".');
  if (api >= 500)
    throw new Error(
      'La API responde pero no llega a PostgreSQL. ¿Está iniciado Docker Desktop? Luego "npm run services:up".',
    );
}

async function main(): Promise<void> {
  const cert = HTTP2 ? await ensureDevCert() : null;
  await preflight(cert?.cert ?? null);

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: [
      `--remote-debugging-port=${String(PORT)}`,
      // Solo este certificado (por la huella de su clave); cualquier otro sigue siendo inválido.
      ...(cert ? [`--ignore-certificate-errors-spki-list=${cert.spki}`] : []),
    ],
  });
  const results: Record<string, unknown>[] = [];
  let invalidRuns = 0;
  try {
    for (const formFactor of ['desktop', 'mobile'] as const) {
      for (const path of PAGES) {
        const all: RunSummary[] = [];
        for (let i = 0; i < RUNS; i += 1) {
          const flags: Flags = {
            port: PORT,
            output: 'html',
            logLevel: 'error',
            onlyCategories: [...CATEGORIES],
          };
          const result = await lighthouse(
            `${BASE}${path}`,
            flags,
            formFactor === 'desktop' ? desktopConfig : undefined,
          );
          if (!result) throw new Error(`Lighthouse no devolvió resultado para ${path}`);
          all.push(summarize(result));
        }
        // Solo corridas con el protocolo del modo: nunca se mezclan protocolos en una mediana.
        const runs = all.filter((r) => r.valid);
        invalidRuns += all.length - runs.length;
        const name = `${formFactor}${path.replace(/\//g, '_') || '_'}`;
        const perf = median(runs.map((r) => r.scores.performance));
        const representative = runs.find((r) => r.scores.performance === perf) ?? runs[0];
        if (representative) writeFileSync(`${OUT}${name}.html`, representative.html);
        const row = {
          formFactor,
          path,
          protocol: EXPECTED_PROTOCOL,
          runs: RUNS,
          validRuns: runs.length,
          median: Object.fromEntries(CATEGORIES.map((c) => [c, median(runs.map((r) => r.scores[c]))])),
          range: Object.fromEntries(
            CATEGORIES.map((c) => [
              c,
              [Math.min(...runs.map((r) => r.scores[c])), Math.max(...runs.map((r) => r.scores[c]))],
            ]),
          ),
          metricsMedian: {
            lcpMs: Math.round(median(runs.map((r) => r.metrics.lcpMs))),
            fcpMs: Math.round(median(runs.map((r) => r.metrics.fcpMs))),
            tbtMs: Math.round(median(runs.map((r) => r.metrics.tbtMs))),
            ttiMs: Math.round(median(runs.map((r) => r.metrics.ttiMs))),
            cls: Number(median(runs.map((r) => r.metrics.cls)).toFixed(3)),
          },
          failing: representative?.failing ?? [],
          // Cada corrida, válida o no, para ver la variación y el protocolo efectivo.
          perRun: all.map((r) => ({
            valid: r.valid,
            protocols: r.protocols,
            connections: r.connections,
            performance: r.scores.performance,
            lcpMs: Math.round(r.metrics.lcpMs),
            fcpMs: Math.round(r.metrics.fcpMs),
            ttiMs: Math.round(r.metrics.ttiMs),
            tbtMs: Math.round(r.metrics.tbtMs),
            cls: Number(r.metrics.cls.toFixed(3)),
            requests: r.requests,
          })),
        };
        results.push(row);
        console.log(
          `${formFactor.padEnd(7)} ${path.padEnd(36)} ${CATEGORIES.map((c) => `${c}=${String((row.median as Record<string, number>)[c])}`).join(' ')} LCP=${String(row.metricsMedian.lcpMs)} [${all.map((r) => String(Math.round(r.metrics.lcpMs))).join('/')}] ${JSON.stringify(all[0]?.protocols)} conexiones=${all.map((r) => r.connections).join('/')}${runs.length < all.length ? ` ⚠️ ${String(all.length - runs.length)} corrida(s) inválida(s)` : ''}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  const lighthouseVersion = (await import('lighthouse/package.json', { with: { type: 'json' } })).default
    .version;
  writeFileSync(
    `${OUT}summary.json`,
    `${JSON.stringify({ lighthouseVersion, mode: MODE, protocol: EXPECTED_PROTOCOL, base: BASE, runs: RUNS, invalidRuns, measuredAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  console.log(`Lighthouse ${lighthouseVersion} (${EXPECTED_PROTOCOL}): resumen en ${OUT}summary.json`);
  if (invalidRuns > 0) {
    console.error(
      `${String(invalidRuns)} corrida(s) no usaron ${EXPECTED_PROTOCOL} y quedaron fuera: la medición está incompleta.`,
    );
    process.exitCode = 1;
  }
}

await main();
