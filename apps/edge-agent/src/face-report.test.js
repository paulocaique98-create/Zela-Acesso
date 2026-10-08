import { describe, expect, it, vi } from 'vitest';
import { reportFaceCaptures } from './face-report.js';

vi.mock('./snapshot.js', () => ({ loadCache: vi.fn() }));
import { loadCache } from './snapshot.js';

const profile = (over = {}) => ({
  id: 'p1',
  provider: 'sface-edge',
  templateRef: 'face:aaaaaaaa',
  capturedAt: null,
  ...over,
});
const withProfiles = (list) =>
  loadCache.mockReturnValue({
    index: { biometricProfileByPerson: new Map(list.map((p, i) => [`pe${i}`, p])) },
  });
const store = (has = true) => ({ hasFaceTemplate: () => has, wipeCache: vi.fn() });

describe('reportFaceCaptures', () => {
  it('relata o perfil com gabarito local e sem capturedAt', async () => {
    withProfiles([profile()]);
    const t = { reportFaceCaptured: vi.fn().mockResolvedValue({ recorded: true }) };
    expect(await reportFaceCaptures({ store: store(), transport: t })).toEqual({
      status: 'ok',
      reported: 1,
    });
    expect(t.reportFaceCaptured).toHaveBeenCalledWith('p1');
  });

  it('não relata o que já tem capturedAt, o que não tem gabarito local nem outro provedor', async () => {
    const t = { reportFaceCaptured: vi.fn() };
    withProfiles([profile({ capturedAt: '2026-10-08T00:00:00Z' }), profile({ provider: 'x' })]);
    expect((await reportFaceCaptures({ store: store(), transport: t })).status).toBe('idle');
    withProfiles([profile()]);
    expect((await reportFaceCaptures({ store: store(false), transport: t })).status).toBe('idle');
    expect(t.reportFaceCaptured).not.toHaveBeenCalled();
  });

  it('rede caída = offline; 401 (null) = agente revogado e cache apagado', async () => {
    withProfiles([profile()]);
    const off = { reportFaceCaptured: vi.fn().mockRejectedValue(new Error('net')) };
    expect((await reportFaceCaptures({ store: store(), transport: off })).status).toBe('offline');
    const s = store();
    const rev = { reportFaceCaptured: vi.fn().mockResolvedValue(null) };
    expect((await reportFaceCaptures({ store: s, transport: rev })).status).toBe('revoked');
    expect(s.wipeCache).toHaveBeenCalled();
  });
});
