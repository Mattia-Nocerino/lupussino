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

test('classifiche: vittorie, ruoli, voti sbagliati, ospiti esclusi', async () => {
  const { classifiche } = await import('../js/game.js');
  const partita = (t, ruoli, vincitori, dettaglio, ospiti = {}) => ({
    finitaIl: t, ruoli, vincitori, dettaglio, ospiti,
    giocatori: Object.fromEntries(Object.keys(ruoli).map((u) => [u, u.toUpperCase()])),
  });
  const partite = [
    partita(1, { a: 'Assassino', b: 'Cittadino', c: 'Testimone', o: 'Mitomane' }, ['a', 'o'], { b: false, c: false }, { o: true }),
    partita(2, { a: 'Cittadino', b: 'Assassino', c: 'Mitomane' }, ['a'], { a: true }),
    partita(3, { a: 'Testimone', b: 'Cittadino', c: 'Assassino' }, ['c'], { a: false, b: false }),
    partita(4, { a: 'Cittadino', b: 'Testimone', c: 'Assassino' }, ['a', 'b'], { a: true, b: false }),
  ];
  const c = classifiche(partite);
  assert.equal(c.migliore[0].uid, 'a');
  assert.equal(c.migliore[0].vinte, 3);
  assert.equal(c.assassino[0].uid, 'a'); // 1 vittoria su 1, c ha 1 vittoria su 2
  assert.equal(c.mitomane.length, 0);    // l'unico mitomane vincente era ospite
  assert.equal(c.peggiore[0].uid, 'b');  // 3 voti su 3 sbagliati
  assert.ok(!JSON.stringify(c).includes('"o"'));
});

test('curiosità: ripensamenti, serie di vittorie, mai votato, assassino invisibile', async () => {
  const { curiosita } = await import('../js/game.js');
  const giocatori = { a: 'Anna', b: 'Bea', c: 'Carlo', d: 'Dario' };
  const vecchie = [1, 2].map((t) => ({ finitaIl: t, giocatori, ruoli: { a: 'Cittadino', b: 'Testimone', c: 'Assassino', d: 'Testimone' }, vincitori: ['a', 'b', 'd'], voti: { a: 'c', b: 'c', c: 'b', d: 'c' } }));
  const ora = {
    finitaIl: 3, giocatori,
    ruoli: { a: 'Cittadino', b: 'Mitomane', c: 'Testimone', d: 'Assassino' },
    vincitori: ['a', 'c'], dettaglio: { a: true, c: true },
    voti: { a: 'd', b: 'c', c: 'd', d: 'c' },
    cambi: { a: 0, b: 5, c: 3, d: 0 }, // Bea è Mitomane: i suoi ripensamenti non contano
  };
  const fatti = curiosita(ora, vecchie, { quante: 10, rng: () => 0 });
  const tutto = fatti.join('\n');
  assert.match(tutto, /Carlo ha cambiato idea 3 volte/);
  assert.doesNotMatch(tutto, /Bea ha cambiato idea/);
  assert.match(tutto, /Anna ha vinto 3 partite di fila/);
  assert.match(tutto, /Nessuno ha mai votato Anna in 3 partite/);
  assert.match(tutto, /Buoni perfetti/);
  assert.ok(curiosita(ora, vecchie, { rng: () => 0 }).length <= 4);
});

test('le curiosità ignorano i voti dei cattivi', async () => {
  const G = await import('../js/game.js');
  const partita = {
    ruoli: { a: 'Assassino', m: 'Mitomane', c: 'Cittadino', d: 'Cittadina' },
    voti: { a: 'm', m: 'a', c: 'a', d: 'a' },
    cambi: { a: 9, c: 0, d: 0 },
    tempi: {},
    giocatori: { a: 'A', m: 'M', c: 'C', d: 'D' },
    dettaglio: { c: true, d: true },
    vincitori: ['c', 'd'],
  };
  const fatti = G.curiosita(partita, [], { quante: 20, rng: () => 0 }).join(' | ');
  assert.doesNotMatch(fatti, /cambiato idea 9/);
  assert.doesNotMatch(fatti, /a vicenda/);
  assert.doesNotMatch(fatti, /Mitomane M si è fatto votare/);
});

test('punteggi: la squadra pesa più dei bonus personali', async () => {
  const G = await import('../js/game.js');
  const ruoli = { a: 'Assassino', m: 'Mitomane', i: 'Investigatore', c: 'Cittadino', d: 'Cittadina' };
  const voti = { a: 'i', m: 'c', i: 'a', c: 'm', d: 'm' };
  const esito = G.esitoVoto(ruoli, voti); // 1 giusto, 2 sbagliati (al Mitomane): vincono i cattivi
  const p = G.punteggi(ruoli, voti, esito);
  assert.equal(esito.vincitore, G.CATTIVI);
  assert.equal(p.a.totale, 10);              // vince, ma l'Investigatore l'ha votato
  assert.equal(p.m.totale, 10 + 2);          // vince e 2 buoni ci sono cascati
  assert.equal(p.i.totale, 2);               // perde ma vota giusto
  assert.equal(p.c.totale, -1);
  const vincente = Math.min(p.a.totale, p.m.totale);
  assert.ok(Object.values(p).every((x) => Math.abs(x.totale) < 10 || x.totale >= 10), 'solo chi vince arriva a 10');
  assert.ok(vincente > Math.max(p.i.totale, p.c.totale, p.d.totale) + 5);

  const senzaAssassini = { m: 'Mitomane', av: 'Avvocato', c: 'Cittadino' };
  const p2 = G.punteggi(senzaAssassini, { av: 'c', c: G.CIELO }, G.esitoVoto(senzaAssassini, { av: 'c', c: G.CIELO }));
  assert.equal(p2.c.voci.find((v) => v.m === 'Cielo giusto').p, 3);
  assert.equal(p2.av.voci.at(-1).p, -2); // sbaglia con un indizio in mano

  const cl = G.aggiungiAllaClassifica(G.aggiungiAllaClassifica({}, { punti: p, giocatori: { a: 'A' }, vincitori: esito.vincitori }), { punti: p, vincitori: esito.vincitori });
  assert.equal(cl.a.punti, 20);
  assert.equal(cl.a.vinte, 2);
  assert.equal(G.ordinaClassifica(cl)[0].punti, 24); // il Mitomane: 12 + 12
});
