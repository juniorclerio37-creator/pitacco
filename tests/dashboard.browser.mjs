import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../web/node_modules/playwright/index.mjs';

const dashboard = 'http://localhost:4180';
const api = 'https://pitacco-fixture.supabase.co';
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', email: 'teste@example.invalid' };
const store = { id: '20000000-0000-0000-0000-000000000001', name: 'Loja de Teste', plan: 'saas' };
const browser = await chromium.launch({ executablePath: process.env.PITACCO_CHROMIUM });

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const ingredients = [];
    const movements = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ api }) => {
      localStorage.setItem('dg.supabase.url', api);
      localStorage.setItem('dg.supabase.key', 'sb_publishable_fixture_only_123456');
    }, { api });

    await page.route('**/*', async route => {
      const { pathname, origin } = new URL(route.request().url());
      if (origin === dashboard && (pathname === '/app/' || /^\/(assets\/[A-Za-z0-9_.-]+|pitacco-brand-013\.svg)$/.test(pathname))) {
        const file = pathname === '/app/' ? '/app/index.html' : pathname;
        const contentType = { html:'text/html', js:'text/javascript', css:'text/css', svg:'image/svg+xml' }[file.split('.').at(-1)];
        return route.fulfill({ contentType, body: await readFile(new URL('../web/dist' + file, import.meta.url)) });
      }
      if (origin !== api) return route.abort();
      const headers = {
        'access-control-allow-origin': dashboard,
        'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
        'access-control-allow-methods': 'GET,POST,OPTIONS'
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (pathname === '/auth/v1/signup') return route.fulfill({ headers, json: { user: { ...user, identities: [] }, session: null } });
      if (pathname === '/auth/v1/token') {
        return route.fulfill({ headers, json: { user, access_token:'fixture-access', refresh_token:'fixture-refresh', token_type:'bearer', expires_in:3600 } });
      }
      if (pathname === '/rest/v1/profiles') return route.fulfill({ headers, json: { ...user, role:'gestor' } });
      if (pathname === '/rest/v1/stores') return route.fulfill({ headers, json: [store] });
      if (pathname === '/rest/v1/couriers' && route.request().headers().accept?.includes('object')) {
        return route.fulfill({ headers, json: null });
      }
      if (pathname === '/rest/v1/pitacco_ingredients') {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          assert.equal(payload.store_id, store.id);
          ingredients.push({...payload, id:'fixture-ingredient', balance:0});
        }
        return route.fulfill({headers,json:ingredients});
      }
      if (pathname === '/rest/v1/pitacco_stock_movements') {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          assert.equal(payload.store_id, store.id);
          assert.equal(payload.ingredient_id, ingredients[0].id);
          ingredients[0].balance += payload.quantity;
          movements.push({...payload, created_at:new Date().toISOString()});
        }
        return route.fulfill({headers,json:movements});
      }
      return route.fulfill({ headers, json: [] });
    });

    await page.goto(dashboard + '/app/');
    await page.getByRole('button', { name:'Criar uma conta' }).click();
    await page.getByPlaceholder('Seu nome').fill('Pessoa Teste');
    await page.getByPlaceholder('E-mail', { exact:true }).fill(user.email);
    await page.getByPlaceholder('Senha (mínimo 6 caracteres)').fill('senha-de-teste');
    await page.getByRole('button', { name:'Cadastrar', exact:true }).click();
    await page.getByText(/confirme o cadastro pelo link enviado/).waitFor();
    await page.getByRole('heading', { name:'Entrar na plataforma' }).waitFor();
    await page.getByPlaceholder('E-mail', { exact:true }).fill(user.email);
    await page.getByPlaceholder('Senha (mínimo 6 caracteres)').fill('senha-de-teste');
    await page.getByRole('button', { name:'Entrar', exact:true }).click();
    await page.locator('.store-identity-copy').getByText(store.name, { exact:true }).waitFor({ state:'attached' });

    const navigation = page.getByRole('navigation', { name:'Menu principal' });
    if (width <= 800) {
      assert.equal(await navigation.isVisible(), false);
      await page.getByRole('button', { name:'Abrir menu' }).click();
      await navigation.waitFor({ state:'visible' });
    }
    await navigation.getByRole('button', { name:'Visão Geral', exact:true }).click();
    await page.getByRole('heading', { name:'Visão Geral', exact:true }).waitFor();
    if (width <= 800) assert.equal(await navigation.isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width <= 800) await page.getByRole('button', { name:'Abrir menu' }).click();
    await navigation.getByRole('button', { name:'Estoque', exact:true }).click();
    const inventory = page.getByRole('region', { name:'Controle de estoque' });
    await inventory.getByLabel('Nome').fill('Polpa de açaí');
    await inventory.getByLabel('Estoque mínimo').fill('100');
    await inventory.getByRole('button', { name:'Cadastrar insumo' }).click();
    await inventory.getByText('Estoque baixo', { exact:false }).waitFor();
    await inventory.getByRole('button', { name:'Movimentações', exact:true }).click();
    await inventory.getByLabel('Insumo').selectOption('fixture-ingredient');
    await inventory.getByLabel('Quantidade', { exact:true }).fill('250');
    await inventory.getByLabel('Motivo').fill('Compra de teste');
    await inventory.getByRole('button', { name:'Registrar movimentação' }).click();
    await inventory.getByText(/Compra de teste/).waitFor();
    await inventory.getByRole('button', { name:'Insumos', exact:true }).click();
    await inventory.getByText(/250 g/).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS dashboard authentication, navigation and inventory at ${width}px`);
  }
} finally {
  await browser.close();
}
