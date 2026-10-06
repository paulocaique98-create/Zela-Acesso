import { expect, test } from '@playwright/test';
import { API, apiRpc, apiToken, createTestOrg, localAdmin, login, loginOk } from './helpers.js';

const OWNER = 'plataforma.dono@example.test';
const SUPPORT = 'plataforma.suporte@example.test';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const row = (page, name) => page.getByRole('row', { name: new RegExp(name) });
const nav = (page) => page.getByRole('navigation', { name: 'Principal' });

async function openMenu(page, orgName, item) {
  await row(page, orgName).getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('Painel do Desenvolvedor: acesso e menus', () => {
  test('platform_owner ve os 7 menus (Faturamento em breve) e a lista com codigo ZA', async ({
    page,
  }) => {
    await loginOk(page, OWNER);
    await expect(page).toHaveURL(/\/plataforma$/);
    await expect(page.getByText('Painel do Desenvolvedor').first()).toBeVisible();
    for (const label of [
      'Gestão de Organizações',
      'Planos',
      'Logs',
      'Biometria',
      /^Suporte/,
      'Configurações',
    ]) {
      await expect(nav(page).getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav(page).getByText('Faturamento')).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Faturamento' })).toHaveCount(0);
    await expect(row(page, 'Condomínio Alfa')).toContainText(/ZA\d{3}/);
  });

  test('platform_support ve lista, logs, suporte e config, sem planos nem acoes de escrita', async ({
    page,
  }) => {
    await loginOk(page, SUPPORT);
    await expect(page).toHaveURL(/\/plataforma$/);
    await expect(row(page, 'Condomínio Alfa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cadastrar organização' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mais ações' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Planos' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Logs' })).toBeVisible();
    await page.goto('/plataforma/planos');
    await expect(page).toHaveURL(/\/plataforma$/);
    await page.goto('/plataforma/configuracoes');
    await expect(
      page.getByText('Somente o proprietário da plataforma altera esta configuração.').first(),
    ).toBeVisible();
  });

  test('proprietario de organizacao nao acessa /plataforma', async ({ page }) => {
    await loginOk(page, 'alfa.dono@example.test');
    await page.goto('/plataforma');
    await expect(page).not.toHaveURL(/plataforma/);
    await expect(page.getByRole('link', { name: 'Painel do Desenvolvedor' })).toHaveCount(0);
  });

  test('rotas /plataforma sem login vao para /login', async ({ page }) => {
    for (const path of ['/plataforma', '/plataforma/planos', '/plataforma/suporte']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test.describe('Organizacoes: cadastro, edicao e status', () => {
  test('cria organizacao com responsavel que ja tem conta', async ({ page }) => {
    await loginOk(page, OWNER);
    const slug = `e2e-${Date.now()}`;
    await page.getByRole('button', { name: 'Cadastrar organização' }).click();
    await page.getByLabel('Nome fantasia').fill(`Org ${slug}`);
    await page.getByLabel(/Identificador/).fill(slug);
    await page.getByLabel('E-mail de login').fill('responsavel.teste@example.test');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByText('Organização criada.')).toBeVisible();
    await expect(row(page, `Org ${slug}`)).toContainText(/ZA\d{3}/);
    await expect(row(page, `Org ${slug}`)).toContainText('Plano base');
  });

  test('e-mail inexistente sem senha mostra erro generico e nao cria', async ({ page }) => {
    await loginOk(page, OWNER);
    await page.getByRole('button', { name: 'Cadastrar organização' }).click();
    await page.getByLabel('Nome fantasia').fill('Org Fantasma');
    await page.getByLabel('E-mail de login').fill('ninguem@example.test');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('alert')).toContainText('Não existe usuário com esse e-mail');
  });

  test('validacoes do formulario: CNPJ invalido e senha curta', async ({ page }) => {
    await loginOk(page, OWNER);
    await page.getByRole('button', { name: 'Cadastrar organização' }).click();
    await page.getByLabel('Nome fantasia').fill('Org Validacao');
    await page.getByLabel('CNPJ').fill('11222333000182');
    await page.getByLabel('E-mail de login').fill('alfa.dono@example.test');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('alert')).toContainText('CNPJ inválido.');
    await page.getByLabel('CNPJ').fill('11222333000181');
    await page.getByLabel('Nome do responsável').fill('Fulana');
    await page.getByLabel('Senha de acesso (opcional)').fill('curta');
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('alert')).toContainText('no mínimo 8');
  });

  test('Buscar dados preenche so campos vazios a partir do CNPJ (funcao simulada)', async ({
    page,
  }) => {
    // A CNPJa nunca e chamada de verdade nos testes: a Edge Function lookup-cnpj e simulada na rede.
    let status = 200;
    let sentCnpj = null;
    await page.route('**/functions/v1/lookup-cnpj', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        });
      sentCnpj = route.request().postDataJSON().cnpj;
      const body =
        status === 200
          ? {
              company: {
                legal_name: 'EMPRESA TESTE LTDA',
                name: 'Empresa Teste',
                contact_email: 'contato@empresa.test',
                contact_phone: '(61) 3493-9002',
                postal_code: '70040912',
                street: 'Quadra 5',
                street_number: 'SN',
                address_complement: '',
                district: 'Asa Norte',
                city: 'Brasília',
                state: 'DF',
                status: 'Ativa',
              },
            }
          : { error: 'Limite de consultas atingido. Aguarde um minuto e tente de novo.' };
      return route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    await loginOk(page, OWNER);
    await page.getByRole('button', { name: 'Cadastrar organização' }).click();
    const buscar = page.getByRole('button', { name: 'Buscar dados' });
    await page.getByLabel('CNPJ').fill('00000000000192');
    await expect(buscar).toBeDisabled();
    await page.getByLabel('CNPJ').fill('00000000000191');
    await expect(buscar).toBeEnabled();

    await page.getByLabel('Cidade').fill('Cidade Digitada');
    status = 429;
    await buscar.click();
    await expect(page.getByText('Limite de consultas atingido')).toBeVisible();
    await expect(page.getByLabel('Razão social')).toHaveValue('');

    status = 200;
    await buscar.click();
    await expect(page.getByText(/campo\(s\) preenchido\(s\) pelo CNPJ/)).toBeVisible();
    expect(sentCnpj).toBe('00.000.000/0001-91');
    await expect(page.getByLabel('Razão social')).toHaveValue('EMPRESA TESTE LTDA');
    await expect(page.getByLabel('Nome fantasia')).toHaveValue('Empresa Teste');
    await expect(page.getByLabel('CEP')).toHaveValue('70040-912');
    await expect(page.getByLabel('Cidade')).toHaveValue('Cidade Digitada');
  });

  test('com senha chama a Edge Function (simulada) sem vazar a senha na tela', async ({ page }) => {
    // A funcao nao roda no Supabase local (edge-runtime desligado): a rede e simulada; a logica da funcao
    // tem testes unitarios proprios (packages/domain/src/create-tenant-owner.test.js).
    let sent = null;
    let status = 200;
    await page.route('**/functions/v1/create-tenant-owner', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        });
      sent = route.request().postDataJSON();
      const body =
        status === 200
          ? { tenant_id: 'x' }
          : { error: 'Este e-mail já está em uso por outra conta.' };
      return route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    });
    await loginOk(page, OWNER);
    await page.getByRole('button', { name: 'Cadastrar organização' }).click();
    await page.getByLabel('Nome fantasia').fill('Org Com Senha');
    await page.getByLabel('Nome do responsável').fill('Fulana de Tal');
    await page.getByLabel('E-mail de login').fill('novo.responsavel@example.test');
    await page.getByLabel('Senha de acesso (opcional)').fill('Senha-provisoria-123');
    status = 409;
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Este e-mail já está em uso por outra conta.',
    );
    status = 200;
    await page.getByRole('button', { name: 'Criar organização' }).click();
    await expect(page.getByText('Organização criada.')).toBeVisible();
    expect(sent).toMatchObject({
      name: 'Org Com Senha',
      slug: 'org-com-senha',
      owner_name: 'Fulana de Tal',
      owner_email: 'novo.responsavel@example.test',
      password: 'Senha-provisoria-123',
    });
    await expect(page.getByText('Senha-provisoria-123')).toHaveCount(0);
  });

  test('edita dados cadastrais e suspende/reativa', async ({ page }) => {
    const org = await createTestOrg('Org Edicao');
    await loginOk(page, OWNER);
    await openMenu(page, org.name, 'Editar');
    await page.getByLabel('CNPJ').fill('11222333000182');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('alert')).toContainText('CNPJ inválido.');
    await page.getByLabel('CNPJ').fill('11222333000181');
    await page.getByLabel('Razão social').fill('Edicao Ltda');
    await page.getByLabel('Notas internas da Arx').fill('nota interna');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Organização atualizada.')).toBeVisible();
    await expect(row(page, org.name)).toContainText('11.222.333/0001-81');
    await openMenu(page, org.name, 'Editar');
    await expect(page.getByLabel('Razão social')).toHaveValue('Edicao Ltda');
    await page.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('switch', { name: `Suspender acesso de ${org.name}` }).click();
    await expect(
      page.getByRole('switch', { name: `Reativar acesso de ${org.name}` }),
    ).toBeVisible();
    await page.getByRole('switch', { name: `Reativar acesso de ${org.name}` }).click();
    await expect(
      page.getByRole('switch', { name: `Suspender acesso de ${org.name}` }),
    ).toBeVisible();
  });
});

test.describe('Modulos, planos e contratacao', () => {
  test('liga um modulo, salva, ve o historico e a chave persiste', async ({ page }) => {
    const org = await createTestOrg('Org Modulos');
    await loginOk(page, OWNER);
    await openMenu(page, org.name, 'Módulos');
    await expect(page.getByRole('heading', { name: 'Módulos contratados' })).toBeVisible();
    await page
      .getByRole('button', { name: /Pontos de acesso e credenciais/ })
      .first()
      .click();
    await expect(page.getByText('Funcionalidade ainda em construção')).toBeVisible();
    const sw = page.getByRole('switch', { name: 'Pontos de acesso e credenciais' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(page.getByText('1 item alterado · não salvo')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByText('Módulos salvos.')).toBeVisible();
    await expect(page.getByText('tudo salvo')).toBeVisible();
    await expect(page.getByText(/^Ligado$/).first()).toBeVisible();
    await page.reload();
    await page
      .getByRole('button', { name: /Pontos de acesso e credenciais/ })
      .first()
      .click();
    await expect(
      page.getByRole('switch', { name: 'Pontos de acesso e credenciais' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('cria plano, contrata para uma organizacao e os modulos seguem o plano', async ({
    page,
  }) => {
    const org = await createTestOrg('Org Contrato');
    const planName = `Plano ${Date.now()}`;
    await loginOk(page, OWNER);
    await nav(page).getByRole('link', { name: 'Planos' }).click();
    await page.getByRole('button', { name: 'Novo plano' }).click();
    await page.getByLabel('Nome', { exact: true }).fill(planName);
    await page.getByRole('checkbox', { name: /Pontos de acesso e credenciais/ }).check();
    await page.getByLabel('Preço por pessoa (R$)').fill('8');
    await page.getByLabel('Mínimo mensal (R$)').fill('100');
    await page.getByLabel('Implantação (R$)', { exact: true }).fill('1000');
    await page.getByRole('checkbox', { name: 'Ativar ciclo Anual' }).check();
    await page.getByLabel('Desconto do ciclo Anual em porcentagem').fill('10');
    await page.getByRole('button', { name: 'Salvar plano' }).click();
    await expect(page.getByText(/Plano salvo/)).toBeVisible();
    await expect(page.getByText(planName)).toBeVisible();

    await nav(page).getByRole('link', { name: 'Gestão de Organizações' }).click();
    await openMenu(page, org.name, 'Contratar plano');
    const dialog = page.getByRole('dialog', { name: 'Contratar plano' });
    await dialog.getByLabel('Plano').selectOption({ label: planName });
    await dialog.getByLabel('Ciclo').selectOption({ label: 'Anual (10% off)' });
    await dialog.getByLabel('Pessoas contratadas').fill('50');
    await expect(dialog.getByText('R$ 400,00')).toBeVisible();
    await dialog.getByLabel('Valor do desconto').fill('10');
    await expect(dialog.getByText('Informe o motivo do desconto.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Revisar e contratar' })).toBeDisabled();
    await dialog.getByLabel('Motivo (obrigatório com desconto)').fill('parceria');
    await dialog.getByRole('button', { name: 'Revisar e contratar' }).click();
    await expect(dialog.getByText('Pontos de acesso e credenciais').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirmar contratação' }).click();
    await expect(page.getByText('Plano contratado e módulos atualizados.')).toBeVisible();
    await expect(row(page, org.name)).toContainText(planName);

    await openMenu(page, org.name, 'Módulos');
    await page
      .getByRole('button', { name: /Pontos de acesso e credenciais/ })
      .first()
      .click();
    await expect(
      page.getByRole('switch', { name: 'Pontos de acesso e credenciais' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('regra comercial: desconto acima do teto e rejeitado no servidor', async () => {
    const org = await createTestOrg('Org Teto');
    const token = await apiToken(OWNER);
    const headers = {
      apikey: process.env['E2E_PUBLISHABLE_KEY'] ?? '',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    const plan = await fetch(`${API}/rest/v1/platform_plans?select=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `Teto ${Date.now()}`,
        mode: 'package',
        price_per_person: 5,
        setup_fee: 500,
      }),
    }).then((r) => r.json());
    const cycle = await fetch(`${API}/rest/v1/platform_plan_cycles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ plan_id: plan[0].id, cycle: 'MONTHLY', months: 1 }),
    });
    expect(cycle.status, await cycle.text()).toBe(201);
    const bad = await apiRpc(token, 'platform_contract_plan', {
      p_tenant_id: org.id,
      p_plan_id: plan[0].id,
      p_cycle: 'MONTHLY',
      p_people: 5,
      p_discount_type: 'percent',
      p_discount: 99,
      p_reason: 'teste',
    });
    expect(bad.status, JSON.stringify(bad.body)).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(bad.body)).toContain('desconto máximo');
    const ok = await apiRpc(token, 'platform_contract_plan', {
      p_tenant_id: org.id,
      p_plan_id: plan[0].id,
      p_cycle: 'MONTHLY',
      p_people: 5,
      p_discount_type: 'percent',
      p_discount: 20,
      p_reason: 'teste',
    });
    expect(ok.status).toBe(200);
  });
});

test.describe('Suporte, logs e configuracoes', () => {
  test('conversa entre o responsavel da organizacao e a plataforma', async ({ page, browser }) => {
    const ask = `Preciso de ajuda ${Date.now()}`;
    const answer = `Resposta ${Date.now()}`;
    await loginOk(page, 'alfa.dono@example.test');
    await nav(page).getByRole('link', { name: 'Suporte' }).click();
    await page.getByLabel('Mensagem').fill(ask);
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText(ask)).toBeVisible();

    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await loginOk(staff, OWNER);
    await nav(staff)
      .getByRole('link', { name: /^Suporte/ })
      .click();
    await staff
      .getByRole('button', { name: /Condomínio Alfa/ })
      .first()
      .click();
    await expect(staff.getByText(ask)).toBeVisible();
    await staff.getByLabel('Mensagem').fill(answer);
    await staff.getByRole('button', { name: 'Enviar' }).click();
    await expect(staff.getByText(answer)).toBeVisible();
    await ctx.close();

    await page.reload();
    await expect(page.getByText(answer)).toBeVisible();
  });

  test('viewer da organizacao nao ve o menu Suporte', async ({ page }) => {
    await loginOk(page, 'alfa.visualizador@example.test');
    await expect(nav(page).getByRole('link', { name: 'Suporte' })).toHaveCount(0);
  });

  test('log de erro gravado pelo usuario aparece nos Logs, sem segredos, e pode ser resolvido', async ({
    page,
  }) => {
    const msg = `Falha E2E ${Date.now()}`;
    const alfa = await apiToken('alfa.dono@example.test');
    const r = await apiRpc(alfa, 'log_error', {
      p_source: 'client',
      p_category: 'e2e',
      p_message: msg,
      p_context: { tela: 'sites', password: 'nao-deve-aparecer', token: 'tambem-nao' },
    });
    expect(r.status).toBe(200);
    await loginOk(page, OWNER);
    await nav(page).getByRole('link', { name: 'Logs' }).click();
    await expect(page.getByText(msg)).toBeVisible();
    await page.getByText(msg).click();
    await expect(page.getByText(/"tela": "sites"/)).toBeVisible();
    await expect(page.getByText('nao-deve-aparecer')).toHaveCount(0);
    await page.getByLabel('Nota de resolução').fill('corrigido');
    await page.getByRole('button', { name: 'Marcar como resolvido' }).click();
    await expect(page.getByText(msg)).toHaveCount(0);
  });

  test('logo global: owner envia, aparece no cabecalho e remove', async ({ page }) => {
    await loginOk(page, OWNER);
    await nav(page).getByRole('link', { name: 'Configurações' }).click();
    // Estado limpo: um teste anterior interrompido pode ter deixado uma logo salva.
    const remove = page.getByRole('button', { name: 'Remover' }).first();
    if (await remove.isVisible()) {
      await remove.click();
      await page.getByRole('button', { name: 'Salvar' }).first().click();
      await expect(page.locator('header img')).toHaveCount(0);
    }
    await page
      .getByLabel('Logo global (Zela Acesso)')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
    await page.getByRole('button', { name: 'Salvar' }).first().click();
    await expect(page.getByText('Configuração salva.')).toBeVisible();
    await expect(page.locator('header img')).toBeVisible();
    await page.getByRole('button', { name: 'Remover' }).first().click();
    await page.getByRole('button', { name: 'Salvar' }).first().click();
    await expect(page.locator('header img')).toHaveCount(0);
  });

  test('logo global rejeita arquivo que nao e imagem permitida', async ({ page }) => {
    await loginOk(page, OWNER);
    await nav(page).getByRole('link', { name: 'Configurações' }).click();
    await page
      .getByLabel('Logo global (Zela Acesso)')
      .setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.getByRole('alert')).toContainText('PNG, JPG ou WebP');
  });
});

test.describe('Troca obrigatoria de senha no primeiro acesso', () => {
  test('usuario com a marca troca a senha e segue para o app', async ({ page }) => {
    const admin = localAdmin();
    const email = `senha.provisoria.${Date.now()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'Provisoria-123456',
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user.id;
    await admin.from('user_security_flags').upsert({ user_id: userId, must_change_password: true });
    try {
      await login(page, email, 'Provisoria-123456');
      await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toBeVisible();
      await page.getByLabel('Nova senha', { exact: true }).fill('curta');
      await page.getByLabel('Confirmar nova senha').fill('curta');
      await page.getByRole('button', { name: 'Salvar nova senha' }).click();
      await expect(page.getByRole('alert')).toContainText('pelo menos 8');
      await page.getByLabel('Nova senha', { exact: true }).fill('Senha-Nova-Definitiva-1');
      await page.getByLabel('Confirmar nova senha').fill('Outra-Senha-Diferente-1');
      await page.getByRole('button', { name: 'Salvar nova senha' }).click();
      await expect(page.getByRole('alert')).toContainText('não conferem');
      await page.getByLabel('Confirmar nova senha').fill('Senha-Nova-Definitiva-1');
      await page.getByRole('button', { name: 'Salvar nova senha' }).click();
      await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
      await page.getByRole('button', { name: 'Sair' }).click();
      await login(page, email, 'Senha-Nova-Definitiva-1');
      await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Crie sua senha' })).toHaveCount(0);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
