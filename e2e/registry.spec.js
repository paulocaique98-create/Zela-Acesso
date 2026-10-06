import { expect, test } from '@playwright/test';
import { loginOk } from './helpers.js';

// Cadastro de zonas, pessoas e grupos pela UI (organizacao Alfa do seed). Cada teste apaga o que criou.
const stamp = Date.now();
const PERSON = `Pessoa E2E ${stamp}`;
const ZONE = `Zona E2E ${stamp}`;
const GROUP = `Grupo E2E ${stamp}`;

test.describe('cadastros da Fase 2A (UI)', () => {
  test('pessoa, zona e grupo: criar, associar e excluir; Beta nao enxerga', async ({
    page,
    browser,
  }) => {
    test.slow();
    await loginOk(page, 'alfa.dono@example.test');

    // Pessoa
    await page.getByRole('link', { name: 'Pessoas' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome completo').fill(PERSON);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: PERSON })).toBeVisible();

    // Zona
    await page.getByRole('link', { name: 'Zonas' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome').fill(ZONE);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('cell', { name: ZONE })).toBeVisible();

    // Grupo + membro
    await page.getByRole('link', { name: 'Grupos' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome').fill(GROUP);
    await page.getByRole('button', { name: 'Salvar' }).click();
    const groupRow = page.getByRole('row', { name: new RegExp(GROUP) });
    await expect(groupRow).toBeVisible();
    await groupRow.getByRole('button', { name: 'Membros' }).click();
    await page.getByLabel('Pessoa').selectOption({ label: PERSON });
    await page.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: PERSON })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // Outra organizacao nao ve nada disso
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await loginOk(other, 'beta.dono@example.test');
    for (const [link, name] of [
      ['Pessoas', PERSON],
      ['Zonas', ZONE],
      ['Grupos', GROUP],
    ]) {
      await other.getByRole('link', { name: link }).click();
      await expect(other.getByRole('heading', { name: link })).toBeVisible();
      await expect(other.getByText(name)).toHaveCount(0);
    }
    await ctx.close();

    // Limpeza pela UI
    for (const [link, name, label] of [
      ['Grupos', GROUP, 'grupo'],
      ['Zonas', ZONE, 'zona'],
      ['Pessoas', PERSON, 'pessoa'],
    ]) {
      await page.getByRole('link', { name: link }).click();
      await page
        .getByRole('row', { name: new RegExp(name) })
        .getByRole('button', { name: 'Excluir' })
        .click();
      await page
        .getByRole('dialog', { name: `Excluir ${label}` })
        .getByRole('button', { name: 'Excluir' })
        .click();
      await expect(page.getByRole('cell', { name })).toHaveCount(0);
    }
  });

  test('credenciais: PIN nunca reaparece, token e mostrado uma vez, revogacao e definitiva', async ({
    page,
  }) => {
    const name = `Pessoa Cred E2E ${stamp}`;
    const PIN = '482915';
    await loginOk(page, 'alfa.dono@example.test');
    await page.getByRole('link', { name: 'Pessoas' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome completo').fill(name);
    await page.getByRole('button', { name: 'Salvar' }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Credenciais' }).click();
    const dlg = page.getByRole('dialog', { name: /Credenciais/ });

    // PIN fraco e recusado no cliente; PIN valido e emitido
    await dlg.getByLabel(/^PIN/).fill('123456');
    await dlg.getByRole('button', { name: 'Emitir' }).click();
    await expect(page.getByText('PIN muito previsível (repetido ou sequência).')).toBeVisible();
    await dlg.getByLabel(/^PIN/).fill(PIN);
    await dlg.getByRole('button', { name: 'Emitir' }).click();
    await expect(dlg.getByText('Ativa')).toBeVisible();
    await expect(dlg.getByText(PIN)).toHaveCount(0);

    // token: aparece uma vez
    await dlg.getByLabel('Tipo').selectOption('mobile_token');
    await dlg.getByRole('button', { name: 'Emitir' }).click();
    const shown = dlg.getByRole('status').filter({ hasText: 'Token emitido' });
    await expect(shown).toBeVisible();
    await expect(shown.locator('code')).toHaveText(/^[0-9a-f]{64}$/);
    await shown.getByRole('button', { name: 'Ocultar' }).click();
    await expect(dlg.getByRole('listitem').filter({ hasText: 'Token temporário' })).toBeVisible();

    // revogar o PIN e definitivo
    await dlg
      .getByRole('listitem')
      .filter({ hasText: 'PIN' })
      .getByRole('button', { name: 'Revogar' })
      .click();
    await page
      .getByRole('dialog', { name: 'Revogar credencial' })
      .getByRole('button', { name: 'Revogar' })
      .click();
    await expect(dlg.getByText('Revogada')).toBeVisible();
    await expect(
      dlg.getByRole('listitem').filter({ hasText: 'Revogada' }).getByRole('button'),
    ).toHaveCount(0);

    // limpeza (apagar a pessoa leva as credenciais)
    await dlg.getByRole('button', { name: 'Fechar', exact: true }).click();
    await row.getByRole('button', { name: 'Excluir' }).click();
    await page
      .getByRole('dialog', { name: 'Excluir pessoa' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(page.getByRole('cell', { name })).toHaveCount(0);
  });

  test('janelas de acesso e feriados: criar, vincular, trocar fuso, isolar e excluir', async ({
    page,
    browser,
  }) => {
    test.slow();
    const cal = `Calendario E2E ${stamp}`;
    const sch = `Janela E2E ${stamp}`;
    await loginOk(page, 'alfa.dono@example.test');

    // calendario + feriado
    await page.getByRole('link', { name: 'Feriados', exact: true }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome do calendário').fill(cal);
    await page.getByRole('button', { name: 'Salvar' }).click();
    const calRow = page.getByRole('row', { name: new RegExp(cal) });
    await expect(calRow).toBeVisible();
    await calRow.getByRole('button', { name: 'Feriados' }).click();
    await page.getByLabel('Data').fill('2026-12-25');
    await page.getByLabel('Descrição do feriado').fill('Natal');
    await page.getByRole('button', { name: 'Adicionar feriado' }).click();
    await expect(page.getByText('25/12/2026 — Natal')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // regra com janelas seg-sex 07:30-18:30
    await page.getByRole('link', { name: 'Janelas de acesso' }).click();
    await page.getByRole('button', { name: 'Novo' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(sch);
    await page.getByLabel('Calendário de feriados (opcional)').selectOption({ label: cal });
    await page.getByRole('button', { name: 'Salvar regra' }).click();
    await expect(page.getByRole('heading', { name: 'Janelas', exact: true })).toBeVisible();
    await page.getByLabel('Das').fill('07:30');
    await page.getByLabel('Até (exclusivo)').fill('18:30');
    await page.getByRole('button', { name: 'Adicionar janela' }).click();
    await expect(page.getByText('Qui · 07:30–18:30')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(
      page
        .getByRole('row', { name: new RegExp(sch) })
        .getByText(/Seg, Ter, Qua, Qui, Sex 07:30–18:30/),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(sch) }).getByText(/Negar acesso/),
    ).toBeVisible();

    // janela invalida (inicio >= fim) e barrada na tela
    await page
      .getByRole('row', { name: new RegExp(sch) })
      .getByRole('button', { name: 'Editar' })
      .click();
    await page.getByLabel('Das').fill('19:00');
    await page.getByLabel('Até (exclusivo)').fill('08:00');
    await page.getByRole('button', { name: 'Adicionar janela' }).click();
    await expect(page.getByText(/não atravessa a meia-noite/)).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // fuso da organizacao: troca e volta
    const tz = page.getByLabel('Fuso horário da organização');
    await tz.selectOption('America/Manaus');
    await expect(page.getByText('Fuso horário atualizado.').first()).toBeVisible();
    await tz.selectOption('America/Sao_Paulo');
    await expect(tz).toHaveValue('America/Sao_Paulo');

    // calendario em uso nao pode ser apagado
    await page.getByRole('link', { name: 'Feriados', exact: true }).click();
    await page
      .getByRole('row', { name: new RegExp(cal) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await page
      .getByRole('dialog', { name: 'Excluir calendário' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(
      page.getByText('Este registro está em uso e não pode ser excluído.'),
    ).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Excluir calendário' })
      .getByRole('button', { name: 'Cancelar' })
      .click();

    // Beta nao ve nada
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await loginOk(other, 'beta.dono@example.test');
    await other.getByRole('link', { name: 'Janelas de acesso' }).click();
    await expect(other.getByRole('heading', { name: 'Janelas de acesso' })).toBeVisible();
    await expect(other.getByText(sch)).toHaveCount(0);
    await other.getByRole('link', { name: 'Feriados', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Feriados' })).toBeVisible();
    await expect(other.getByText(cal)).toHaveCount(0);
    await ctx.close();

    // limpeza: regra primeiro, depois calendario
    await page.getByRole('link', { name: 'Janelas de acesso' }).click();
    await page
      .getByRole('row', { name: new RegExp(sch) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await page
      .getByRole('dialog', { name: 'Excluir janela de acesso' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(page.getByRole('cell', { name: sch })).toHaveCount(0);
    await page.getByRole('link', { name: 'Feriados', exact: true }).click();
    await page
      .getByRole('row', { name: new RegExp(cal) })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await page
      .getByRole('dialog', { name: 'Excluir calendário' })
      .getByRole('button', { name: 'Excluir' })
      .click();
    await expect(page.getByRole('cell', { name: cal })).toHaveCount(0);
  });

  test('visualizador nao ve botao Novo nem acoes de edicao', async ({ page }) => {
    await loginOk(page, 'alfa.visualizador@example.test');
    await page.goto('/pessoas');
    await expect(page.getByRole('button', { name: 'Novo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  });
});
