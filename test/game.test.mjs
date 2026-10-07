// Esegui con: node --test test/game.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIGURAZIONI, CARTE_EXTRA, CIELO, distribuisci, informazioni, esitoVoto, puoIniziare,
} from '../js/game.js';

test('ogni configurazione ha giocatori + 3 carte', () => {
  for (const [n, mazzo] of Object.entries(CONFIGURAZIONI)) {
    assert.equal(mazzo.length, Number(n) + CARTE_EXTRA, `config ${n}`);
  }
});

test('limiti giocatori', () => {
  assert.equal(puoIniziare(2), false);
  assert.equal(puoIniziare(3), true);
  assert.equal(puoIniziare(9), true);
  assert.equal(puoIniziare(10), false);
});

test('distribuzione: una carta a testa, 3 scarti, mazzo intatto', () => {
  const uids = ['a', 'b', 'c', 'd', 'e'];
  const { assegnazioni, scarti } = distribuisci(uids);
  assert.equal(Object.keys(assegnazioni).length, 5);
  assert.equal(scarti.length, 3);
  const tutte = [...Object.values(assegnazioni), ...scarti].sort();
  assert.deepEqual(tutte, [...CONFIGURAZIONI[5]].sort());
});

test('informazioni per ruolo', () => {
  const ass = { a: 'Assassino', b: 'Assassino', c: 'Mitomane', d: 'Testimone', e: 'Avvocato', f: 'Investigatore', g: 'Cittadino' };
  const nomi = { a: 'Anna', b: 'Bea', c: 'Carlo', d: 'Dario', e: 'Elia', f: 'Fede', g: 'Gio' };
  const mani = informazioni(ass, ['Testimone', 'Cittadina', 'Investigatrice'], nomi, () => 0);
  assert.match(mani.a.info, /Bea/);
  assert.doesNotMatch(mani.a.info, /Carlo/); // l'assassino non conosce il mitomane
  assert.match(mani.c.info, /Anna, Bea/);
  assert.match(mani.d.info, /unico Testimone/);
  assert.match(mani.e.info, /Dario è buono/); // primo buono diverso da sé con rng=0
  assert.match(mani.f.info, /Testimone/);
});

test('esempio di Mattia: pareggio con voto al mitomane -> cattivi', () => {
  const ass = { b1: 'Cittadino', b2: 'Testimone', b3: 'Testimone', b4: 'Investigatore', a: 'Assassino', m: 'Mitomane' };
  const voti = { b1: 'b2', b2: 'm', b3: 'a', b4: 'a', a: 'b1', m: 'b1' };
  const r = esitoVoto(ass, voti);
  assert.equal(r.giusti, 2);
  assert.equal(r.sbagliati, 2);
  assert.equal(r.vincitore, 'cattivi');
  assert.deepEqual(r.vincitori.sort(), ['a', 'm']);
});

test('pareggio senza voti al mitomane -> pareggio, nessun vincitore', () => {
  const ass = { b1: 'Cittadino', b2: 'Testimone', a: 'Assassino', m: 'Mitomane' };
  const r = esitoVoto(ass, { b1: 'b2', b2: 'a', a: 'b1', m: 'b1' });
  assert.equal(r.vincitore, 'pareggio');
  assert.deepEqual(r.vincitori, []);
});

test('i voti dei cattivi non contano', () => {
  const ass = { b1: 'Cittadino', b2: 'Testimone', b3: 'Testimone', a: 'Assassino' };
  const r = esitoVoto(ass, { b1: 'a', b2: 'a', b3: 'b1', a: 'b1' });
  assert.equal(r.giusti, 2);
  assert.equal(r.sbagliati, 1);
  assert.equal(r.vincitore, 'buoni');
});

test('cielo: giusto solo se non ci sono assassini in gioco', () => {
  const senza = { b1: 'Cittadino', b2: 'Testimone', m: 'Mitomane' };
  assert.equal(esitoVoto(senza, { b1: CIELO, b2: CIELO, m: 'b1' }).vincitore, 'buoni');
  assert.equal(esitoVoto(senza, { b1: 'm', b2: 'b1', m: 'b1' }).vincitore, 'cattivi');

  const con = { b1: 'Cittadino', b2: 'Testimone', a: 'Assassino' };
  assert.equal(esitoVoto(con, { b1: CIELO, b2: CIELO, a: CIELO }).vincitore, 'cattivi');
});

test('casuale: generatore crittografico in [0, 1)', async () => {
  const { casuale } = await import('../js/game.js');
  for (let i = 0; i < 1000; i++) {
    const x = casuale();
    assert.ok(x >= 0 && x < 1);
  }
});

test('distribuzione uniforme: ogni ruolo arriva a ogni posto', () => {
  const conteggio = {};
  for (let i = 0; i < 3000; i++) {
    const { assegnazioni } = distribuisci(['a', 'b', 'c']);
    conteggio[assegnazioni.a] = (conteggio[assegnazioni.a] ?? 0) + 1;
  }
  // mazzo da 3: 6 carte, Testimone x2 -> ~1000, le altre ~500
  assert.ok(conteggio.Testimone > 850 && conteggio.Testimone < 1150, JSON.stringify(conteggio));
  for (const r of ['Cittadino', 'Assassino', 'Mitomane', 'Investigatore']) {
    assert.ok(conteggio[r] > 380 && conteggio[r] < 620, JSON.stringify(conteggio));
  }
});
