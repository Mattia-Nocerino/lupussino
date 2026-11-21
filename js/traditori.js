// Modalità Traditori: logica pura (niente Firebase, niente DOM), testata in test/traditori.test.mjs.
// Fedeli contro Traditori, partita lunga a eliminazione: tavola rotonda di giorno, omicidio di notte,
// prove per scudi, pugnali e buste, finale a 4 col voto al cielo.
import { casuale, mescola, CIELO, BUONI, CATTIVI } from './game.js';

export const MIN = 7;
export const MAX = 16;
export const SOGLIA_FINALE = 4; // da qui niente più notti né prove: si vota "finiamo qui" o si espelle ancora

export const FEDELE = 'Fedele';
export const TRADITORE = 'Traditore';
export const EMOJI = { [FEDELE]: '😇', [TRADITORE]: '😈' };
export const PREMI = {
  scudo: { emoji: '🛡️', nome: 'Scudo', spiega: 'ti salva da un omicidio notturno' },
  pugnale: { emoji: '🗡️', nome: 'Pugnale', spiega: 'il tuo voto alla tavola rotonda vale doppio, una volta' },
  busta: { emoji: '✉️', nome: 'Busta', spiega: 'tre nomi: almeno uno è un Traditore' },
};

// Durate delle fasi (la tavola rotonda usa il timer di discussione della stanza).
export const DURATA = { notte: 90_000, prova: 90_000, ballottaggio: 120_000, finale: 180_000 };

export const puoGiocare = (n) => n >= MIN && n <= MAX;

export function numeroTraditori(n) {
  if (n >= 14) return 4;
  if (n >= 10) return 3;
  return 2;
}

export const squadra = (ruolo) => (ruolo === TRADITORE ? CATTIVI : BUONI);

export function assegnaRuoli(uids, rng = casuale) {
  if (!puoGiocare(uids.length)) throw new Error(`Servono da ${MIN} a ${MAX} giocatori.`);
  const mischiati = mescola(uids, rng);
  const k = numeroTraditori(uids.length);
  return Object.fromEntries(mischiati.map((u, i) => [u, i < k ? TRADITORE : FEDELE]));
}

// Parola segreta del primo giorno: i Fedeli hanno la parola, i Traditori solo la categoria.
export const PAROLE = {
  Vacanze: ['spiaggia', 'montagna', 'campeggio', 'crociera', 'valigia', 'ombrellone'],
  Cucina: ['lasagna', 'tiramisù', 'carbonara', 'pizza', 'risotto', 'parmigiana'],
  Animali: ['giraffa', 'pinguino', 'canguro', 'polpo', 'elefante', 'gufo'],
  Sport: ['calcio', 'tennis', 'sci', 'nuoto', 'pallavolo', 'boxe'],
  Mestieri: ['pompiere', 'dentista', 'pilota', 'cuoco', 'idraulico', 'maestra'],
  Casa: ['divano', 'frigorifero', 'lavatrice', 'specchio', 'lampadario', 'tappeto'],
  Musica: ['chitarra', 'batteria', 'violino', 'karaoke', 'concerto', 'pianoforte'],
  Natale: ['presepe', 'panettone', 'renna', 'albero', 'tombola', 'calza'],
  Città: ['Venezia', 'Napoli', 'Parigi', 'Londra', 'New York', 'Roma'],
  Trasporti: ['treno', 'mongolfiera', 'monopattino', 'traghetto', 'elicottero', 'tram'],
  Scuola: ['lavagna', 'zaino', 'interrogazione', 'gita', 'ricreazione', 'pagella'],
  Feste: ['matrimonio', 'compleanno', 'Capodanno', 'Carnevale', 'laurea', 'battesimo'],
  Film: ['Titanic', 'Il Re Leone', 'Harry Potter', 'Rocky', 'Shrek', 'Frozen'],
  Natura: ['vulcano', 'cascata', 'deserto', 'foresta', 'ghiacciaio', 'arcobaleno'],
};

export function scegliParola(rng = casuale) {
  const categorie = Object.keys(PAROLE);
  const categoria = categorie[Math.floor(rng() * categorie.length)];
  const parole = PAROLE[categoria];
  return { categoria, parola: parole[Math.floor(rng() * parole.length)] };
}

const pesca = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const vivi = (tr) => Object.keys(tr?.vivi ?? {});

// Cosa sa ognuno all'inizio: ruolo, compagni (se Traditore), parola o categoria del primo giorno.
export function mani(ruoli, nomi, { categoria, parola }) {
  const traditori = Object.keys(ruoli).filter((u) => ruoli[u] === TRADITORE);
  return Object.fromEntries(Object.entries(ruoli).map(([u, ruolo]) => {
    const t = ruolo === TRADITORE;
    const compagni = traditori.filter((x) => x !== u).map((x) => nomi[x] ?? '???');
    return [u, {
      ruolo,
      squadra: squadra(ruolo),
      info: t
        ? `Gli altri Traditori: ${compagni.join(', ')}. Di notte scegliete insieme chi uccidere.`
        : 'Sei Fedele: scopri i Traditori ed espellili alla tavola rotonda.',
      parola: t ? null : parola,
      categoria,
    }];
  }));
}

// voti: { uid: { b: bersaglio, pugnale?: true } }. Contano solo i votanti ammessi e i bersagli validi.
// Il pugnale vale doppio solo se chi lo usa lo possiede davvero (premi[uid].pugnale).
export function contaVoti(voti, { votanti, bersagli, cielo = false, premi = {} }) {
  const conteggio = {};
  const validi = {};
  const pugnali = [];
  for (const [u, v] of Object.entries(voti ?? {})) {
    if (!votanti.includes(u) || !v) continue;
    const b = v.b;
    if (b === u) continue;
    if (!(b === CIELO ? cielo : bersagli.includes(b))) continue;
    const doppio = !!v.pugnale && !!premi[u]?.pugnale && b !== CIELO;
    if (doppio) pugnali.push(u);
    validi[u] = doppio ? { b, x2: true } : { b };
    conteggio[b] = (conteggio[b] ?? 0) + (doppio ? 2 : 1);
  }
  const max = Math.max(0, ...Object.values(conteggio));
  const primi = Object.keys(conteggio).filter((b) => conteggio[b] === max && max > 0);
  return { conteggio, validi, pugnali, primi };
}

// Esito della tavola rotonda. Il primo giorno vale anche il cielo: se è il più votato non esce nessuno.
// Parità tra nomi: ballottaggio (o, se è già un ballottaggio, estrazione a caso tra i pari).
export function esitoTavola({ primi }, { ballottaggio = false, rng = casuale } = {}) {
  if (!primi.length) return { nessuno: true };
  if (primi.includes(CIELO)) return { nessuno: true };
  if (primi.length === 1) return { espulso: primi[0] };
  if (ballottaggio) return { espulso: pesca(primi, rng), sorteggio: primi };
  return { pari: primi };
}

// Notte: i Traditori vivi votano una vittima tra i Fedeli vivi. Vince la più votata, parità a sorte;
// se nessuno ha scelto, la vittima è estratta a caso. Lo scudo salva e si consuma.
export function esitoNotte(scelte, { ruoli, tr, premi = {}, rng = casuale }) {
  const traditoriVivi = vivi(tr).filter((u) => ruoli[u] === TRADITORE);
  const fedeliVivi = vivi(tr).filter((u) => ruoli[u] !== TRADITORE);
  if (!fedeliVivi.length) return { nessuno: true };
  const conta = {};
  for (const [u, b] of Object.entries(scelte ?? {})) {
    if (traditoriVivi.includes(u) && fedeliVivi.includes(b)) conta[b] = (conta[b] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(conta));
  const primi = Object.keys(conta).filter((b) => conta[b] === max && max > 0);
  const vittima = primi.length ? pesca(primi, rng) : pesca(fedeliVivi, rng);
  if (premi[vittima]?.scudo) return { salvo: vittima };
  return { ucciso: vittima };
}

// Chi vince adesso (o null se si continua): senza Traditori vivi vincono i Fedeli.
export function vincitoreSubito(tr, ruoli) {
  const v = vivi(tr);
  if (!v.some((u) => ruoli[u] === TRADITORE)) return BUONI;
  if (!v.some((u) => ruoli[u] !== TRADITORE)) return CATTIVI;
  return null;
}

// Fine del finale: almeno un Traditore vivo → vincono i Traditori.
export const vincitoreFinale = (tr, ruoli) => (vivi(tr).some((u) => ruoli[u] === TRADITORE) ? CATTIVI : BUONI);

// Finale: tutti al cielo (chi non ha votato conta come cielo) → fine. Altrimenti si espelle il più votato.
export function esitoFinale(voti, { votanti, rng = casuale }) {
  const nomi = {};
  for (const u of votanti) {
    const b = voti?.[u]?.b;
    if (b && b !== CIELO && b !== u && votanti.includes(b)) nomi[b] = (nomi[b] ?? 0) + 1;
  }
  if (!Object.keys(nomi).length) return { fine: true };
  const max = Math.max(...Object.values(nomi));
  const primi = Object.keys(nomi).filter((b) => nomi[b] === max);
  return { espulso: pesca(primi, rng), ...(primi.length > 1 && { sorteggio: primi }) };
}

// Busta: un Traditore vivo e due altri vivi a caso (mai chi la riceve), mescolati.
export function busta(ricevente, { ruoli, tr, rng = casuale }) {
  const v = vivi(tr).filter((u) => u !== ricevente);
  const traditori = v.filter((u) => ruoli[u] === TRADITORE);
  if (!traditori.length) return [];
  const t = pesca(traditori, rng);
  const altri = mescola(v.filter((u) => u !== t), rng).slice(0, 2);
  return mescola([t, ...altri], rng);
}

// Prova: vince il miglior risultato tra i vivi (più punti, poi meno tempo). Chi ha già quel premio passa il turno.
export function vincitoreProva(risultati, { tr, premio, premi = {} }) {
  const ordinati = Object.entries(risultati ?? {})
    .filter(([u, r]) => tr.vivi?.[u] && r && Number.isFinite(r.ms))
    .sort(([, a], [, b]) => (b.punti ?? 0) - (a.punti ?? 0) || a.ms - b.ms);
  const libero = ordinati.find(([u]) => premio === 'busta' || !premi[u]?.[premio]);
  return libero?.[0] ?? null;
}

// ---------- punti ----------
export const PUNTI = {
  vittoria: 10,
  votoTraditore: 2,   // Fedele che vota un Traditore alla tavola rotonda
  votoFedele: -1,     // Fedele che vota un altro Fedele
  sospettoGiusto: 1,  // sondaggio notturno su un Traditore
  traditoreVivo: 3,   // Traditore arrivato alla fine senza farsi scoprire
  scommessa: 1,       // fantasma che indovina l'espulso
  montepremi: 1,      // ai vincitori ancora vivi, per ogni prova giocata
};

// storia (dal segreto del capo): { voti: {chiave: {uid: b}}, sondaggi: {giorno: {uid: b}}, scommesse: {chiave: {uid: b, espulso}}, prove: n }
export function punteggi(ruoli, tr, storia, vincitore) {
  const t = (u) => ruoli[u] === TRADITORE;
  const punti = {};
  for (const u of Object.keys(ruoli)) {
    const voci = [];
    const vinto = squadra(ruoli[u]) === vincitore;
    if (vinto) voci.push({ m: 'Squadra vincente', p: PUNTI.vittoria });
    if (!t(u)) {
      let giusti = 0; let sbagliati = 0;
      for (const voti of Object.values(storia.voti ?? {})) {
        const b = voti?.[u];
        if (!b || b === CIELO || !(b in ruoli)) continue;
        if (t(b)) giusti++; else sbagliati++;
      }
      if (giusti) voci.push({ m: `${giusti} voti a un Traditore`, p: giusti * PUNTI.votoTraditore });
      if (sbagliati) voci.push({ m: `${sbagliati} voti a un Fedele`, p: sbagliati * PUNTI.votoFedele });
      const sospetti = Object.values(storia.sondaggi ?? {}).filter((s) => t(s?.[u])).length;
      if (sospetti) voci.push({ m: `${sospetti} sospetti giusti di notte`, p: sospetti * PUNTI.sospettoGiusto });
    }
    if (t(u) && tr.vivi?.[u]) voci.push({ m: 'Mai scoperto', p: PUNTI.traditoreVivo });
    const scommesse = Object.values(storia.scommesse ?? {}).filter((s) => s?.espulso && s[u] === s.espulso).length;
    if (scommesse) voci.push({ m: `${scommesse} scommesse da fantasma`, p: scommesse * PUNTI.scommessa });
    if (vinto && tr.vivi?.[u] && storia.prove) voci.push({ m: `Montepremi (${storia.prove} prove)`, p: storia.prove * PUNTI.montepremi });
    punti[u] = { totale: voci.reduce((s, v) => s + v.p, 0), voci };
  }
  return punti;
}
