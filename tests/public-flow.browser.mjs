import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../web/node_modules/playwright/index.mjs';

const [menuPage, trackingPage] = await Promise.all(
  ['cardapio', 'acompanhar'].map(name => readFile(new URL(`../marketing/${name}.html`, import.meta.url), 'utf8'))
);
const browser = await chromium.launch({ executablePath: process.env.PITACCO_CHROMIUM });
const origin = 'http://localhost:4179';
const orderId = '10000000-0000-0000-0000-000000000001';
const token = '20000000-0000-0000-0000-000000000001';

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const tracking = {
      375: { status: 'accepted', delivery_status: 'cancelada', fulfillment: 'delivery', label: 'Pedido cancelado' },
      768: { status: 'accepted', delivery_status: 'retirada', preparation_status: 'ready', fulfillment: 'delivery', label: 'Saiu para entrega' },
      1440: { status: 'accepted', preparation_status: 'completed', fulfillment: 'pickup', label: 'Retirado' }
    }[width];
    const scheduled = width === 768 ? '2026-11-17T21:00:00Z' : null;
    let polls=0;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    await page.route('**/*', async route => {
      const { pathname, origin: routeOrigin } = new URL(route.request().url());
      if (routeOrigin === origin && pathname === '/cardapio/') {
        return route.fulfill({ contentType: 'text/html', body: menuPage });
      }
      if (routeOrigin === origin && pathname === '/acompanhar/') {
        return route.fulfill({ contentType: 'text/html', body: trackingPage });
      }
      if (routeOrigin === 'https://esm.sh') {
        return route.fulfill({
          contentType: 'text/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: `export function createClient(){
            return { rpc: async (name, payload) => {
              const response = await fetch('/fixture/' + name,{method:'POST',body:JSON.stringify(payload)});
              const data = await response.json();
              return { status:response.status, data:response.ok?data:null, error:response.ok?null:data };
            } };
          }`
        });
      }
      if (routeOrigin !== origin || !pathname.startsWith('/fixture/')) return route.abort();

      if (pathname.endsWith('/get_public_menu')) {
        return route.fulfill({ json: {
          store: { name: 'Loja de teste', delivery_enabled: true, pickup_enabled: true, delivery_fee: 5, payment_methods: ['pix_manual'] },
          products: [{ id: 'acai', name: 'Açaí', price: 20, option_groups: [{
            id: 'adicionais', name: 'Adicionais', min: 1, max: 1,
            options: [{ id: 'morango', name: 'Morango', price: 2 }, { id: 'leite', name: 'Leite em pó', price: 3 }]
          }] }]
        } });
      }
      if(pathname.endsWith('/pitacco_public_schedule_slots')){
        assert.equal(route.request().postDataJSON().p_fulfillment,'delivery');
        return route.fulfill({json:scheduled?[scheduled]:[]});
      }
      if (pathname.endsWith('/checkout_public_order') || pathname.endsWith('/pitacco_checkout_scheduled_order')) {
        assert.equal(pathname.endsWith('/pitacco_checkout_scheduled_order'),Boolean(scheduled));
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) {
          await responseGate;
          return route.fulfill({ status: 503, json: { message: 'Resposta indisponível' } });
        }
        return route.fulfill({ json: { order_id: orderId, tracking_token: token, total: 72, payment_status: 'pending' } });
      }
      if (pathname.endsWith('/pitacco_track_public_order')) {
        assert.equal(route.request().postDataJSON().p_token, token);
        const courier_position=scheduled
          ? (++polls===1?{state:'available',latitude:-22.851,longitude:-43.453,observed_at:new Date().toISOString()}:{state:'multiple_stops'})
          : null;
        return route.fulfill({ json: { order_id: orderId, total: 72, scheduled_for:scheduled, courier_position, ...tracking } });
      }
      return route.abort();
    });

    await page.goto(origin + '/cardapio/?loja=loja-teste');
    await page.getByRole('heading', { name: 'Açaí' }).waitFor();
    await page.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    assert.match(await page.locator('#msg').innerText(), /Confira as escolhas/);
    await page.getByRole('checkbox', { name: /Morango/ }).check();
    await page.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await page.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    await page.getByRole('checkbox', { name: /Morango/ }).uncheck();
    await page.getByRole('checkbox', { name: /Leite em pó/ }).check();
    await page.getByRole('button', { name: 'Adicionar ao pedido' }).click();
    assert.equal(await page.locator('#cart .cartline').count(), 2);
    assert.equal(await page.locator('#cart input').first().inputValue(), '2');
    for (const [id, value] of [['customer', 'Cliente Teste'], ['phone', '21999999999'], ['address', 'Rua Teste 123']]) {
      await page.locator('#' + id).fill(value);
    }
    if(scheduled)await page.getByLabel('Quando deseja receber?').selectOption(scheduled);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await page.getByRole('button', { name: 'Enviando…' }).waitFor();
    assert.equal(await page.locator('#send').isDisabled(), true);
    assert.equal(await page.locator('#cart').evaluate(element => element.inert), true);
    await page.locator('#checkout').evaluate(form => form.requestSubmit());
    releaseResponse();
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByRole('heading', { name: 'Pedido recebido!' }).waitFor();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[0].p_scheduled_for,scheduled||undefined);
    assert.deepEqual(requests[0].p_items, [
      { product_id: 'acai', quantity: 2, options: ['morango'] },
      { product_id: 'acai', quantity: 1, options: ['leite'] }
    ]);
    assert.match(await page.locator('#success').innerText(), /Pagamento pendente de confirmação/);
    await page.clock.install();
    await page.getByRole('link', { name: 'Acompanhar meu pedido' }).click();
    await page.locator('#currentStatus').filter({hasText: tracking.label}).waitFor();
    if(scheduled){
      await page.locator('#scheduledFor').filter({hasText:'Agendado para'}).waitFor();
      const map=page.getByRole('link',{name:'Abrir localização aproximada no mapa'});
      await map.waitFor();
      const mapUrl=new URL(await map.getAttribute('href'));
      assert.equal(mapUrl.hostname,'www.openstreetmap.org');
      assert.equal(mapUrl.searchParams.get('mlat'),'-22.851');
      assert.equal(mapUrl.searchParams.get('mlon'),'-43.453');
      assert.equal(await map.getAttribute('rel'),'noopener noreferrer');
      await page.clock.fastForward(15001);
      await page.getByText(/rota com outras paradas/).waitFor();
      assert.equal(await map.isVisible(),false);
    }
    if (width === 375) assert.equal(await page.locator('#steps li').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS public checkout and tracking at ${width}px`);
  }
} finally {
  await browser.close();
}
