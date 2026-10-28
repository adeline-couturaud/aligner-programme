import test from 'node:test';
import assert from 'node:assert/strict';
import { createWithdrawalHandler } from '../supabase/functions/request-withdrawal/handler.js';

const ORIGIN = 'https://adeline-couturaud.github.io';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'customer@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' };
const payload = { firstName: 'Camille', lastName: 'Martin', purchaseDate: '2026-10-28', orderReference: '', confirmed: true };
function fixture({ failMail = false, invalidToken = false } = {}) {
  const rows = [], emails = [], calls = [];
  const control = { failMail, invalidToken };
  const transport = async (address, options = {}) => {
    const url = new URL(address); calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return Response.json(control.invalidToken ? {} : USER, { status: control.invalidToken ? 401 : 200 });
    if (url.hostname === 'api.resend.com') {
      if (control.failMail) return Response.json({ error: 'Simulated failure' }, { status: 503 });
      emails.push({ ...JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
      return Response.json({ id: 'mail-1' });
    }
    assert.equal(url.pathname, '/rest/v1/withdrawal_requests', 'No access or payment changes are permitted');
    if (options.method === 'POST') {
      const data = JSON.parse(options.body);
      if (!rows.some(r => r.user_id === data.user_id && r.purchase_date === data.purchase_date && r.order_reference === data.order_reference))
        rows.push({ ...data, id: '22222222-2222-4222-8222-222222222222', created_at: '2026-10-28T18:00:00.000Z', receipt_sent_at: null, notification_sent_at: null });
      return new Response(null, { status: 201 });
    }
    if (options.method === 'PATCH') {
      Object.assign(rows.find(r => 'eq.' + r.id === url.searchParams.get('id')), JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    const matches = rows.filter(r => [...url.searchParams].every(([key,value]) => {
      if (key === 'select' || key === 'limit') return true;
      if (value.startsWith('gte.')) return r[key] >= value.slice(4);
      return r[key] === value.slice(3);
    }));
    return Response.json(matches.slice(0, Number(url.searchParams.get('limit')) || Infinity));
  };
  const handler = createWithdrawalHandler({ env: { SUPABASE_URL: 'https://database.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only', RESEND_API_KEY: 'mail-only' }, fetch: transport, now: () => new Date('2026-10-28T18:00:00.000Z') });
  const send = (data = payload, { origin = ORIGIN, token = 'valid-user-jwt' } = {}) => handler(new Request('https://function.example.test', {
    method: 'POST', headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(data),
  }));
  return { rows, emails, calls, control, handler, send };
}

test('rejects missing and invalid authentication before recording anything', async () => {
  const f = fixture();
  assert.equal((await f.send(payload, { token: '' })).status, 401);
  f.control.invalidToken = true;
  assert.equal((await f.send()).status, 401);
  assert.equal(f.rows.length, 0); assert.equal(f.emails.length, 0);
});
test('rejects another origin and handles the allowed preflight', async () => {
  const f = fixture();
  assert.equal((await f.send(payload, { origin: 'https://attacker.example' })).status, 403);
  const res = await f.handler(new Request('https://function.example.test', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
  assert.equal(res.status, 204); assert.equal(f.calls.length, 0);
});
test('records the authenticated owner, original server time and full declaration', async () => {
  const f = fixture();
  const res = await f.send({ ...payload, user_id: 'attacker-supplied-id', email: 'other@example.test', created_at: '2000-01-01' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.accepted, true); assert.equal(data.emailSent, true);
  assert.equal(f.rows[0].user_id, USER.id); assert.equal(f.rows[0].email, USER.email);
  assert.equal(data.receivedAt, '2026-10-28T18:00:00.000Z');
  assert.match(data.receipt, /Camille/); assert.match(data.receipt, /Martin/);
  assert.match(data.receipt, /Je vous notifie ma rétractation/);
  assert.equal(f.emails.length, 2);
  assert.deepEqual(f.emails[0].to, [USER.email]);
  assert.deepEqual(f.emails[1].to, ['contact@alignerconseil.fr']);
});
test('retries preserve the original declaration and do not duplicate requests or emails', async () => {
  const f = fixture();
  const one = await (await f.send()).json();
  const two = await (await f.send({ ...payload, firstName: 'Changed' })).json();
  assert.equal(f.rows.length, 1); assert.equal(f.emails.length, 2);
  assert.equal(one.id, two.id); assert.equal(one.receipt, two.receipt);
});
test('email failure keeps a dated receipt and a retry sends the stored declaration', async () => {
  const f = fixture({ failMail: true });
  const first = await f.send(); assert.equal(first.status, 202);
  const receipt = await first.json(); assert.equal(receipt.accepted, true); assert.equal(receipt.emailSent, false);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].receipt_sent_at, null);
  f.control.failMail = false;
  const second = await (await f.send()).json();
  assert.equal(second.emailSent, true); assert.equal(second.receipt, receipt.receipt);
  assert.equal(f.rows.length, 1); assert.equal(f.emails.length, 2);
});
test('invalid dates, unconfirmed declarations and email line injection are rejected', async () => {
  const f = fixture();
  for (const data of [{...payload, purchaseDate:'2026-02-30'}, {...payload, confirmed:false}, {...payload, firstName:'Camille\nBcc: other@example.test'}, {...payload, firstName:' '}])
    assert.equal((await f.send(data)).status, 400);
  assert.equal(f.rows.length, 0);
});
test('receives a request even if eligibility needs manual assessment', async () => {
  const f = fixture();
  assert.equal((await f.send({...payload, purchaseDate:'2025-01-01'})).status, 200);
  assert.equal(f.rows.length, 1);
});
test('limits additional requests but keeps an existing receipt accessible', async () => {
  const f = fixture();
  for (let i=0;i<5;i++) assert.equal((await f.send({...payload, orderReference:'order-'+i})).status, 200);
  assert.equal((await f.send({...payload, orderReference:'order-6'})).status, 429);
  assert.equal((await f.send({...payload, orderReference:'order-0'})).status, 200);
  assert.equal(f.rows.length, 5);
});
