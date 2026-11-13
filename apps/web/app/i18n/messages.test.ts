import { describe, expect, it } from 'vitest';
import { resources } from './config.ts';

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

// D2: textos completos en los dos idiomas desde la v1.
describe.each(['common', 'design', 'account'] as const)('mensajes del espacio "%s"', (ns) => {
  const es = flatten(resources['es-CR'][ns]);
  const en = flatten(resources.en[ns]);

  it('tienen exactamente las mismas claves en es-CR y en', () => {
    expect([...en.keys()].sort()).toEqual([...es.keys()].sort());
  });

  it('no tienen textos vacíos', () => {
    for (const [key, value] of [...es, ...en]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('usan las mismas variables {{…}} en los dos idiomas', () => {
    for (const [key, value] of es) {
      expect(placeholders(en.get(key) ?? ''), key).toEqual(placeholders(value));
    }
  });
});
