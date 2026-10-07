import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/rete.js';

// Coppia di canali finti che si comportano come RTCDataChannel aperti.
function coppia() {
  const crea = () => Object.assign(new EventTarget(), { readyState: 'open' });
  const a = crea(); const b = crea();
  const invia = (da, a2) => (m) => { if (da.readyState === 'open') setTimeout(() => a2.dispatchEvent(Object.assign(new Event('message'), { data: m })), 0); };
  a.send = invia(a, b); b.send = invia(b, a);
  const chiudi = () => { for (const c of [a, b]) if (c.readyState === 'open') { c.readyState = 'closed'; setTimeout(() => c.dispatchEvent(new Event('close')), 0); } };
  a.close = chiudi; b.close = chiudi;
  return [a, b];
}
const pausa = (ms = 5) => new Promise((ok) => setTimeout(ok, ms));

async function stanza() {
  const capo = new L.Capo({ uid: 'capo', roomId: 'r1' });
  await L.set(L.ref(capo, 'rooms/r1'), { hostUid: 'capo', status: 'lobby', round: 0, players: { capo: { nome: 'C' } } });
  const [lato, latoOspite] = coppia();
  capo.collega(lato);
  const ospite = new L.Ospite(latoOspite, 'u1');
  const { roomId } = await ospite.benvenuto;
  return { capo, ospite, roomId, lato };
}

test('un ospite entra, vede la stanza e scrive solo dove può', async () => {
  const { capo, ospite, roomId } = await stanza();
  assert.equal(roomId, 'r1');
  await L.set(L.ref(ospite, 'rooms/r1/players/u1'), { nome: 'Uno', online: true });
  assert.equal((await L.get(L.ref(capo, 'rooms/r1/players/u1/nome'))).val(), 'Uno');
  await assert.rejects(L.set(L.ref(ospite, 'rooms/r1/players/capo'), null), /Permesso/);
  await assert.rejects(L.set(L.ref(ospite, 'rooms/r1/status'), 'playing'), /Permesso/);
  await assert.rejects(L.update(L.ref(ospite), { 'secret/r1/1': {} }), /Permesso/);
});

test('ognuno riceve solo la propria carta e il proprio voto, mai il mazzo', async () => {
  const { capo, ospite } = await stanza();
  await L.set(L.ref(ospite, 'rooms/r1/players/u1'), { nome: 'Uno' });
  await L.update(L.ref(capo), {
    'rooms/r1/status': 'playing', 'rooms/r1/round': 1, 'rooms/r1/inGioco': { capo: 'C', u1: 'Uno', u2: 'Due' },
    'hands/r1/1/capo': { ruolo: 'Assassino' }, 'hands/r1/1/u1': { ruolo: 'Cittadino' }, 'hands/r1/1/u2': { ruolo: 'Mitomane' },
    'secret/r1/1': { assegnazioni: { capo: 'Assassino' } },
  });
  await pausa();
  assert.deepEqual(Object.keys(ospite.albero).sort(), ['hands', 'rooms']);
  assert.deepEqual(ospite.albero.hands, { r1: { 1: { u1: { ruolo: 'Cittadino' } } } });
  await L.update(L.ref(ospite), { 'votes/r1/1/u1': { bersaglio: 'capo', cambi: 0 }, 'rooms/r1/voted/u1': true });
  await assert.rejects(L.update(L.ref(ospite), { 'votes/r1/1/u1': { bersaglio: 'u2' } }), /Permesso/); // voto unico
  await assert.rejects(L.set(L.ref(ospite, 'votes/r1/1/u1'), { bersaglio: 'u1' }), /Permesso/);
  assert.equal((await L.get(L.ref(capo, 'votes/r1/1/u1/bersaglio'))).val(), 'capo');
  assert.equal(ospite.albero.votes.r1[1].u1.bersaglio, 'capo');
});

test('se un ospite cade il capo lo segna offline; se è stato rimosso non lo ricrea', async () => {
  const { capo, ospite, lato } = await stanza();
  await L.set(L.ref(ospite, 'rooms/r1/players/u1'), { nome: 'Uno', online: true });
  await L.onDisconnect(L.ref(ospite, 'rooms/r1/players/u1')).update({ online: false });
  await pausa();
  lato.close();
  await pausa(20);
  assert.equal((await L.get(L.ref(capo, 'rooms/r1/players/u1/online'))).val(), false);
  assert.equal(ospite.connesso, false);

  const altra = await stanza();
  await L.set(L.ref(altra.ospite, 'rooms/r1/players/u1'), { nome: 'Uno', online: true });
  await L.onDisconnect(L.ref(altra.ospite, 'rooms/r1/players/u1')).update({ online: false });
  await pausa();
  await L.remove(L.ref(altra.capo, 'rooms/r1/players/u1'));
  altra.lato.close();
  await pausa(20);
  assert.equal((await L.get(L.ref(altra.capo, 'rooms/r1/players/u1'))).exists(), false);
});

test('i timestamp del server diventano l’ora del capo e onValue avvisa solo se cambia', async () => {
  const capo = new L.Capo({ uid: 'capo', roomId: 'r1' });
  const visti = [];
  L.onValue(L.ref(capo, 'rooms/r1/visto'), (s) => visti.push(s.val()));
  await L.set(L.ref(capo, 'rooms/r1'), { visto: { '.sv': 'timestamp' }, altro: 1 });
  await L.set(L.ref(capo, 'rooms/r1/altro'), 2);
  assert.equal(visti.length, 2); // null iniziale + timestamp
  assert.equal(typeof visti[1], 'number');
});
