import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { generateKeyPair } from './keys.js';
import { createSealer } from './seal.js';
import { openStore } from './store.js';

const K1 = 'a1'.repeat(32);
const K2 = 'b2'.repeat(32);
const SECRET = 'SEGREDO-DE-TESTE-NOME-JOAO-SILVA';

describe('createSealer', () => {
  it('cifra e decifra; cada valor tem IV próprio', () => {
    const s = createSealer(K1);
    const a = s.seal('c', SECRET);
    expect(a).not.toContain(SECRET);
    expect(s.seal('c', SECRET)).not.toBe(a);
    expect(s.open('c', a)).toBe(SECRET);
  });
  it('chave errada, coluna trocada ou dado adulterado falham', () => {
    const a = createSealer(K1).seal('c', SECRET);
    expect(() => createSealer(K2).open('c', a)).toThrow('ilegível');
    expect(() => createSealer(K1).open('outra', a)).toThrow('ilegível');
    const raw = Buffer.from(a.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => createSealer(K1).open('c', 'v1:' + raw.toString('base64'))).toThrow('ilegível');
  });
  it('dado cifrado sem chave é recusado; legado em texto puro é aceito', () => {
    const a = createSealer(K1).seal('c', SECRET);
    expect(() => createSealer(null).open('c', a)).toThrow('EDGE_STORE_KEY');
    expect(createSealer(K1).open('c', 'texto-legado')).toBe('texto-legado');
  });
  it('rejeita chave com tamanho errado', () => {
    expect(() => createSealer('abcd')).toThrow('32 bytes');
  });
});

describe('store cifrado em disco', () => {
  it('snapshot e fila ficam ilegíveis no arquivo sem a chave, mas lidos com ela', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zela-seal-'));
    const path = join(dir, 'edge.sqlite');
    try {
      const st = openStore(path, { key: K1 });
      st.saveSnapshot({
        hash: 'h',
        fetchedAt: '2026-10-07T00:00:00Z',
        body: JSON.stringify({ n: SECRET }),
      });
      st.enqueue('k1', { nome: SECRET }, '2026-10-07T00:00:00Z');
      expect(st.loadSnapshotRow().body).toContain(SECRET);
      expect(st.dueEvents('2026-10-08T00:00:00Z')[0].payload.nome).toBe(SECRET);
      st.db.exec('pragma wal_checkpoint(truncate)');
      st.close();
      expect(readFileSync(path).includes(Buffer.from(SECRET))).toBe(false);

      const reopened = openStore(path, { key: K1 });
      expect(reopened.dueEvents('2026-10-08T00:00:00Z')).toHaveLength(1);
      reopened.close();
      const wrong = openStore(path, { key: K2 });
      expect(() => wrong.loadSnapshotRow()).toThrow('ilegível');
      wrong.close();
      const none = openStore(path);
      expect(() => none.dueEvents('2026-10-08T00:00:00Z')).toThrow('EDGE_STORE_KEY');
      none.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('config EDGE_STORE_KEY', () => {
  const base = { EDGE_GATEWAY_URL: 'https://x.test/f', EDGE_AGENT_ID: 'a', EDGE_AGENT_SECRET: 's' };
  it('obrigatória em produção, válida em 64 hex', () => {
    const device = { EDGE_DEVICE_KEY: generateKeyPair().privateKey }; // obrigatória em produção (8A)
    expect(() => loadConfig({ ...base, ...device, NODE_ENV: 'production' })).toThrow(
      'EDGE_STORE_KEY',
    );
    expect(() => loadConfig({ ...base, EDGE_STORE_KEY: 'curta' })).toThrow('64 hex');
    expect(
      loadConfig({ ...base, ...device, NODE_ENV: 'production', EDGE_STORE_KEY: K1 }).storeKey,
    ).toBe(K1);
    expect(loadConfig(base).storeKey).toBeNull();
  });
});
