/**
 * Lighthouse sobre el build de producción servido localmente (M4, §11: "Inicio y carta
 * prerenderizadas"). Uso:
 *
 *   1. API levantada y build con el mismo origen que se mide:
 *        VITE_SITE_URL=http://127.0.0.1:4173 npm run build -w @marea-baja/web
 *   2. npm run preview -w @marea-baja/web        (sirve build/client en el 4173)
 *   3. npm run lighthouse -w @marea-baja/web     (LH_BASE_URL, LH_RUNS)
 *
 * Usa el Chromium de Playwright (ya instalado para las E2E) con un puerto de depuración; no
 * descarga otro navegador. Corre cada página LH_RUNS veces (3 por defecto) en escritorio y en
 * móvil y toma la **mediana** por categoría, porque las mediciones de rendimiento varían.
 * Escribe los informes HTML de la corrida mediana y un resumen en `lighthouse-report/`
 * (ignorado por git).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import lighthouse, { desktopConfig, type Flags, type RunnerResult } from 'lighthouse';

const BASE = (process.env['LH_BASE_URL'] ?? 'http://127.0.0.1:4173').replace(/\/+$/, '');
const RUNS = Number(process.env['LH_RUNS'] ?? 3);
const OUT = fileURLToPath(new URL('../lighthouse-report/', import.meta.url));
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

interface RunSummary {
  scores: Record<Category, number>;
  metrics: { lcpMs: number; cls: number; tbtMs: number; fcpMs: number };
  failing: { id: string; title: string; score: number | null }[];
  html: string;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

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
  return {
    scores,
    metrics: {
      lcpMs: metric('largest-contentful-paint'),
      cls: metric('cumulative-layout-shift'),
      tbtMs: metric('total-blocking-time'),
      fcpMs: metric('first-contentful-paint'),
    },
    failing: [...new Map(failing.map((f) => [f.id, f])).values()],
    html,
  };
}

async function main(): Promise<void> {
  const check = await fetch(`${BASE}/sitemap.xml`).catch(() => null);
  if (!check?.ok)
    throw new Error(`No responde ${BASE}. Levantá el build con "npm run preview -w @marea-baja/web".`);

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${String(PORT)}`] });
  const results: Record<string, unknown>[] = [];
  try {
    for (const formFactor of ['desktop', 'mobile'] as const) {
      for (const path of PAGES) {
        const runs: RunSummary[] = [];
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
          runs.push(summarize(result));
        }
        // Corrida representativa: la de rendimiento mediano.
        const perf = median(runs.map((r) => r.scores.performance));
        const representative = runs.find((r) => r.scores.performance === perf) ?? runs[0];
        const name = `${formFactor}${path.replace(/\//g, '_') || '_'}`;
        writeFileSync(`${OUT}${name}.html`, representative?.html ?? '');
        const row = {
          formFactor,
          path,
          runs: RUNS,
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
            cls: Number(median(runs.map((r) => r.metrics.cls)).toFixed(3)),
          },
          failing: representative?.failing ?? [],
          // Cada corrida, para ver la variación (la mediana sola puede esconder una corrida mala).
          perRun: runs.map((r) => ({
            performance: r.scores.performance,
            lcpMs: Math.round(r.metrics.lcpMs),
            fcpMs: Math.round(r.metrics.fcpMs),
            tbtMs: Math.round(r.metrics.tbtMs),
            cls: Number(r.metrics.cls.toFixed(3)),
          })),
        };
        results.push(row);
        console.log(
          `${formFactor.padEnd(7)} ${path.padEnd(36)} ${CATEGORIES.map((c) => `${c}=${String((row.median as Record<string, number>)[c])}`).join(' ')}`,
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
    `${JSON.stringify({ lighthouseVersion, base: BASE, runs: RUNS, measuredAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  console.log(`Lighthouse ${lighthouseVersion}: resumen en ${OUT}summary.json`);
}

await main();
