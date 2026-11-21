// Esegui con: node --test test/traditori.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CIELO, BUONI, CATTIVI } from '../js/game.js';
import * as T from '../js/traditori.js';
import { operazioni, griglie, attese, domande, sequenza, parole, SIMBOLI } from '../js/prove.js';

const uids = (n) => Array.from({ length: n }, (_, i) => `u${i}`);
const tr = (vivi) => ({ vivi: Object.fromEntries(vivi.map((u) => [u, true])) });
const sempre = (x) => () => x;

test('limiti e numero di Traditori', () => {
  assert.equal(T.puoGiocare(6), false);
  assert.equal(T.puoGiocare(7), true);
  assert.equal(T.puoGiocare(16), true);
  assert.equal(T.puoGiocare(17), false);
  assert.deepEqual([7, 9, 10, 13, 14, 16].map(T.numeroTraditori), [2, 2, 3, 3, 4, 4]);
  for (const n of [7, 10, 14]) {
    const ruoli = T.assegnaRuoli(uids(n));
    assert.equal(Object.values(ruoli).filter((r) => r === T.TRADITORE).length, T.numeroTraditori(n));
    assert.equal(Object.keys(ruoli).length, n);
  }
});

test('mani: i Traditori si conoscono e non hanno la parola', () => {
  const ruoli = { a: T.TRADITORE, b: T.TRADITORE, c: T.FEDELE };
  const m = T.mani(ruoli, { a: 'Anna', b: 'Bruno', c: 'Carla' }, { categoria: 'Cucina', parola: 'pizza' });
  assert.match(m.a.info, /Bruno/);
  assert.equal(m.a.parola, null);
  assert.equal(m.c.parola, 'pizza');
  assert.equal(m.c.categoria, 'Cucina');
  assert.equal(m.c.squadra, BUONI);
});

test('tavola: pugnale doppio solo se posseduto, niente autovoto', () => {
  const voti = { a: { b: 'c' }, b: { b: 'd', pugnale: true }, c: { b: 'c' }, d: { b: 'd', pugnale: true } };
  const r = T.contaVoti(voti, { votanti: ['a', 'b', 'c', 'd'], bersagli: ['a', 'b', 'c', 'd'], premi: { b: { pugnale: true } } });
  assert.deepEqual(r.conteggio, { c: 1, d: 2 });
  assert.deepEqual(r.pugnali, ['b']);
  assert.deepEqual(r.primi, ['d']);
  assert.deepEqual(T.esitoTavola(r), { espulso: 'd' });
});

test('tavola: cielo solo quando ammesso, parità → ballottaggio, poi sorte', () => {
  const voti = { a: { b: CIELO }, b: { b: CIELO }, c: { b: 'a' } };
  const base = { votanti: ['a', 'b', 'c'], bersagli: ['a', 'b', 'c'] };
  assert.deepEqual(T.esitoTavola(T.contaVoti(voti, { ...base, cielo: true })), { nessuno: true });
  assert.deepEqual(T.esitoTavola(T.contaVoti(voti, base)), { espulso: 'a' });
  const pari = T.contaVoti({ a: { b: 'b' }, b: { b: 'a' } }, base);
  assert.deepEqual(T.esitoTavola(pari).pari.sort(), ['a', 'b']);
  assert.equal(T.esitoTavola(pari, { ballottaggio: true, rng: sempre(0) }).espulso, pari.primi[0]);
  assert.deepEqual(T.esitoTavola(T.contaVoti({}, base)), { nessuno: true });
});

test('notte: vittima più scelta tra i Fedeli, scudo salva, scelte non valide ignorate', () => {
  const ruoli = { a: T.TRADITORE, b: T.TRADITORE, c: T.FEDELE, d: T.FEDELE, e: T.FEDELE };
  const t = tr(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(T.esitoNotte({ a: 'c', b: 'c', d: 'e' }, { ruoli, tr: t }), { ucciso: 'c' });
  assert.deepEqual(T.esitoNotte({ a: 'c' }, { ruoli, tr: t, premi: { c: { scudo: true } } }), { salvo: 'c' });
  assert.deepEqual(T.esitoNotte({ a: 'b' }, { ruoli, tr: t, rng: sempre(0) }), { ucciso: 'c' }); // un compagno non vale: a caso
});

test('vincitori: subito senza Traditori, nel finale basta un Traditore vivo', () => {
  const ruoli = { a: T.TRADITORE, b: T.FEDELE, c: T.FEDELE };
  assert.equal(T.vincitoreSubito(tr(['b', 'c']), ruoli), BUONI);
  assert.equal(T.vincitoreSubito(tr(['a', 'b']), ruoli), null);
  assert.equal(T.vincitoreSubito(tr(['a']), ruoli), CATTIVI);
  assert.equal(T.vincitoreFinale(tr(['a', 'b']), ruoli), CATTIVI);
  assert.equal(T.vincitoreFinale(tr(['b', 'c']), ruoli), BUONI);
});

test('finale: tutti al cielo (o senza voto) chiude, un nome espelle', () => {
  const votanti = ['a', 'b', 'c', 'd'];
  assert.deepEqual(T.esitoFinale({ a: { b: CIELO }, b: { b: CIELO } }, { votanti }), { fine: true });
  assert.deepEqual(T.esitoFinale({ a: { b: CIELO }, b: { b: 'c' } }, { votanti }), { espulso: 'c' });
  assert.deepEqual(T.esitoFinale({ a: { b: 'a' } }, { votanti }), { fine: true }); // autovoto non vale
});

test('busta: tre nomi, almeno un Traditore, mai chi la riceve', () => {
  const ruoli = Object.fromEntries(uids(9).map((u, i) => [u, i < 2 ? T.TRADITORE : T.FEDELE]));
  const t = tr(uids(9));
  for (let k = 0; k < 50; k++) {
    const nomi = T.busta('u5', { ruoli, tr: t });
    assert.equal(nomi.length, 3);
    assert.equal(new Set(nomi).size, 3);
    assert.ok(!nomi.includes('u5'));
    assert.ok(nomi.some((u) => ruoli[u] === T.TRADITORE));
  }
});

test('prova: classifica tra i vivi, premio a scelta, asta', () => {
  const t = tr(['a', 'b', 'c']);
  const ris = { a: { punti: 0, ms: 9000 }, b: { punti: 0, ms: 7000 }, c: { punti: 0, ms: 8000 }, z: { punti: 0, ms: 1 } };
  assert.deepEqual(T.classificaProva(ris, { tr: t }), ['b', 'c', 'a']);
  assert.deepEqual(T.classificaProva({ a: { punti: 4, ms: 9000 }, b: { punti: 3, ms: 1000 } }, { tr: t }), ['a', 'b']);
  assert.equal(T.premioPer('pugnale', {}), 'pugnale');
  assert.equal(T.premioPer('scudo', { scudo: true }), 'pugnale');
  assert.equal(T.premioPer(undefined, { scudo: true, pugnale: true }), 'busta');
  assert.equal(T.premioPer('busta', { scudo: true }), 'busta');
  const monete = { a: 10, b: 5, c: 10 };
  assert.deepEqual(T.esitoAsta({ a: { offerta: 3 }, b: { offerta: 5 }, c: { offerta: 0 } }, { tr: t, monete }), { vincitore: 'b', offerta: 5 });
  assert.equal(T.esitoAsta({ b: { offerta: 6 } }, { tr: t, monete }).vincitore, null); // più di quante ne ha
  assert.equal(T.esitoAsta({ z: { offerta: 3 } }, { tr: t, monete: { z: 10 } }).vincitore, null); // fantasma o estraneo
  assert.deepEqual(T.esitoAsta({ a: { offerta: 2 }, c: { offerta: 2 } }, { tr: t, monete, rng: () => 0 }).sorteggio, ['a', 'c']);
});

test('punti: squadra, voti, sospetti, scommesse, montepremi', () => {
  const ruoli = { a: T.TRADITORE, b: T.FEDELE, c: T.FEDELE, g: T.FEDELE };
  const storia = {
    voti: { 0: { b: 'a', c: 'b', a: 'b' }, 1: { b: 'a', c: CIELO } },
    sondaggi: { 1: { b: 'a', c: 'a' } },
    scommesse: { x: { g: 'a', espulso: 'a' } },
    prove: 2,
    monete: { b: 5, a: 1 },
  };
  const p = T.punteggi(ruoli, tr(['b', 'c']), storia, BUONI);
  assert.equal(p.b.totale, 10 + 2 * 2 + 1 + 2 + 2); // vittoria, 2 voti giusti, 1 sospetto, montepremi, 5 monete
  assert.equal(p.c.totale, 10 - 1 + 1 + 2);
  assert.equal(p.g.totale, 10 + 1); // fantasma: vittoria e scommessa, niente montepremi
  assert.equal(p.a.totale, 0);
  const q = T.punteggi(ruoli, tr(['a', 'b']), {}, CATTIVI);
  assert.equal(q.a.totale, 10 + 3);
});

test('prove: stessa sfida dallo stesso seme', () => {
  assert.deepEqual(operazioni(42), operazioni(42));
  assert.notDeepEqual(operazioni(42), operazioni(43));
  for (const o of operazioni(7)) assert.ok(Number.isInteger(o.risposta) && o.risposta > 0, o.testo);
  assert.deepEqual(griglie(5), griglie(5));
  assert.deepEqual(attese(9), attese(9));
  assert.deepEqual(sequenza(4), sequenza(4));
  assert.ok(sequenza(4).every((k) => k >= 0 && k < SIMBOLI.length));
  assert.deepEqual(parole(8), parole(8));
  assert.ok(parole(8).every((p) => p.parola !== p.inchiostro));
  const fatti = [{ domanda: 'x', giusta: 'a' }, { domanda: 'y', giusta: 'b' }];
  const nomi = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
  const d = domande(3, fatti, nomi);
  assert.equal(d.length, 2);
  for (const q of d) { assert.equal(q.opzioni.length, 4); assert.ok(q.opzioni.some((o) => o.u === q.giusta)); }
  assert.deepEqual(d, domande(3, fatti, nomi));
});
