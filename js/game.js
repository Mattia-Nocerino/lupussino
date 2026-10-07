// Logica pura di Lupussino: nessuna dipendenza da Firebase o dal DOM,
// così si può testare con Node (vedi test/game.test.mjs).

export const MIN_GIOCATORI = 3;
export const MAX_GIOCATORI = 9; // limite controllato dall'app (le regole del database non possono contare i giocatori)
export const CARTE_EXTRA = 3;
export const CIELO = '__cielo__';

export const BUONI = 'buoni';
export const CATTIVI = 'cattivi';
export const PAREGGIO = 'pareggio';

export const RUOLI = {
  Cittadino: { squadra: BUONI },
  Cittadina: { squadra: BUONI },
  Testimone: { squadra: BUONI },
  Investigatore: { squadra: BUONI },
  Investigatrice: { squadra: BUONI },
  Avvocato: { squadra: BUONI },
  Assassino: { squadra: CATTIVI },
  Mitomane: { squadra: CATTIVI },
};

// Colore di ogni ruolo (sfondo e testo leggibile sopra), come nella vecchia app.
export const COLORI = {
  Cittadino: { bg: '#1f6b3a', fg: '#ffffff' },      // verde scuro
  Cittadina: { bg: '#8fdc6a', fg: '#0f2408' },      // verde chiaro
  Investigatore: { bg: '#2f6fde', fg: '#ffffff' },  // blu
  Investigatrice: { bg: '#f39ac7', fg: '#2b0a1b' }, // rosa
  Assassino: { bg: '#d63a3a', fg: '#ffffff' },      // rosso
  Mitomane: { bg: '#0a0a0a', fg: '#ffffff' },       // nero
  Avvocato: { bg: '#ffffff', fg: '#111111' },       // bianco
  Testimone: { bg: '#86d4f5', fg: '#08222e' },      // celeste
};

// Chiave = numero di giocatori, valore = mazzo (sempre giocatori + 3 carte).
export const CONFIGURAZIONI = {
  3: ['Cittadino', 'Testimone', 'Testimone', 'Assassino', 'Mitomane', 'Investigatore'],
  4: ['Cittadino', 'Testimone', 'Testimone', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
  5: ['Cittadino', 'Testimone', 'Testimone', 'Assassino', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
  6: ['Cittadino', 'Cittadina', 'Testimone', 'Testimone', 'Assassino', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
  7: ['Cittadino', 'Cittadina', 'Testimone', 'Testimone', 'Avvocato', 'Assassino', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
  8: ['Cittadino', 'Cittadina', 'Testimone', 'Testimone', 'Avvocato', 'Assassino', 'Assassino', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
  9: ['Cittadino', 'Cittadina', 'Testimone', 'Testimone', 'Testimone', 'Avvocato', 'Assassino', 'Assassino', 'Assassino', 'Mitomane', 'Investigatore', 'Investigatrice'],
};

export const squadraDi = (ruolo) => RUOLI[ruolo].squadra;
export const isAssassino = (ruolo) => ruolo === 'Assassino';
const isTestimone = (ruolo) => ruolo === 'Testimone';
const isInvestigatore = (ruolo) => ruolo === 'Investigatore' || ruolo === 'Investigatrice';

// Numero casuale in [0, 1) dal generatore crittografico del browser (o di Node):
// imprevedibile, a differenza di Math.random.
export function casuale() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export function mescola(arr, rng = casuale) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pesca = (arr, rng) => arr[Math.floor(rng() * arr.length)];

export function puoIniziare(numGiocatori) {
  return numGiocatori >= MIN_GIOCATORI && numGiocatori <= MAX_GIOCATORI && !!CONFIGURAZIONI[numGiocatori];
}

// Mescola il mazzo e dà una carta a testa. Le 3 restanti sono gli scarti.
export function distribuisci(uids, rng = casuale) {
  if (!puoIniziare(uids.length)) throw new Error(`Numero di giocatori non valido: ${uids.length}`);
  const mazzo = mescola(CONFIGURAZIONI[uids.length], rng);
  const assegnazioni = {};
  uids.forEach((uid, i) => { assegnazioni[uid] = mazzo[i]; });
  return { assegnazioni, scarti: mazzo.slice(uids.length) };
}

// Calcola cosa sa ogni giocatore all'inizio del round.
// nomi: { uid: nome }. Restituisce { uid: { ruolo, squadra, info } } con info testuale.
export function informazioni(assegnazioni, scarti, nomi, rng = casuale) {
  const uids = Object.keys(assegnazioni);
  const nomeDi = (uid) => nomi[uid] ?? '???';
  const assassini = uids.filter((u) => isAssassino(assegnazioni[u]));
  const mani = {};

  for (const uid of uids) {
    const ruolo = assegnazioni[uid];
    let info;
    if (isTestimone(ruolo)) {
      const altri = uids.some((u) => u !== uid && isTestimone(assegnazioni[u]));
      info = altri ? 'Non sei solo: c\'è almeno un altro Testimone in gioco.' : 'Sei l\'unico Testimone in gioco.';
    } else if (isInvestigatore(ruolo)) {
      info = `Hai pescato una delle carte scartate: ${pesca(scarti, rng)}.`;
    } else if (ruolo === 'Avvocato') {
      const buoni = uids.filter((u) => u !== uid && squadraDi(assegnazioni[u]) === BUONI);
      info = buoni.length ? `${nomeDi(pesca(buoni, rng))} è buono/a.` : 'Non ci sono altri buoni in gioco.';
    } else if (isAssassino(ruolo)) {
      const compagni = assassini.filter((u) => u !== uid).map(nomeDi);
      info = compagni.length ? `Gli altri assassini: ${compagni.join(', ')}.` : 'Sei l\'unico assassino in gioco.';
    } else if (ruolo === 'Mitomane') {
      info = assassini.length
        ? `Gli assassini sono: ${assassini.map(nomeDi).join(', ')}. Fatti votare!`
        : 'Non ci sono assassini in gioco. Fatti votare!';
    } else {
      info = 'Sei buono/a. Non hai poteri: ragiona e vota bene.';
    }
    mani[uid] = { ruolo, squadra: squadraDi(ruolo), info };
  }
  return mani;
}

// Un voto di un buono è giusto se va a un Assassino,
// oppure al cielo quando nessun assassino è in gioco. Tutto il resto è sbagliato.
export function votoGiusto(assegnazioni, bersaglio) {
  const ciSonoAssassini = Object.values(assegnazioni).some(isAssassino);
  if (bersaglio === CIELO) return !ciSonoAssassini;
  return isAssassino(assegnazioni[bersaglio]);
}

// voti: { uid: uidVotato | CIELO }. Contano solo i voti dei buoni.
// Maggioranza giusti -> buoni; maggioranza sbagliati -> cattivi;
// pareggio -> cattivi se almeno un voto sbagliato è andato al Mitomane, altrimenti pareggio (non vince nessuno).
export function esitoVoto(assegnazioni, voti) {
  let giusti = 0;
  let sbagliati = 0;
  let votiMitomane = 0;
  const dettaglio = {};

  for (const [uid, bersaglio] of Object.entries(voti)) {
    if (!(uid in assegnazioni)) continue;
    if (squadraDi(assegnazioni[uid]) !== BUONI) { dettaglio[uid] = null; continue; }
    const ok = votoGiusto(assegnazioni, bersaglio);
    dettaglio[uid] = ok;
    if (ok) giusti++;
    else {
      sbagliati++;
      if (assegnazioni[bersaglio] === 'Mitomane') votiMitomane++;
    }
  }

  let vincitore;
  if (giusti > sbagliati) vincitore = BUONI;
  else if (sbagliati > giusti) vincitore = CATTIVI;
  else vincitore = votiMitomane > 0 ? CATTIVI : PAREGGIO;

  const vincitori = Object.keys(assegnazioni).filter((u) => squadraDi(assegnazioni[u]) === vincitore); // vuoto se pareggio
  return { vincitore, vincitori, giusti, sbagliati, votiMitomane, dettaglio };
}

// ---------- classifiche ----------

// Le partite salvate in games/ hanno: giocatori {uid: nome}, ospiti {uid: true}, ruoli {uid: ruolo},
// voti {uid: bersaglio}, dettaglio {uid: true|false} (solo buoni), vincitore, vincitori [uid], finitaIl.
const lista = (x) => Object.values(x ?? {});

export function statistiche(partite) {
  const st = {};
  const ordinate = [...partite].sort((a, b) => (a.finitaIl ?? 0) - (b.finitaIl ?? 0));
  for (const p of ordinate) {
    const vincitori = lista(p.vincitori);
    for (const [uid, ruolo] of Object.entries(p.ruoli ?? {})) {
      if (p.ospiti?.[uid]) continue; // gli ospiti non entrano in classifica
      const s = (st[uid] ??= {
        uid, nome: '', giocate: 0, vinte: 0, giocateAssassino: 0, vinteAssassino: 0,
        giocateMitomane: 0, vinteMitomane: 0, votiDaBuono: 0, votiSbagliati: 0,
      });
      s.nome = p.giocatori?.[uid] ?? s.nome; // vale l'ultimo nome usato
      s.giocate++;
      const vinto = vincitori.includes(uid);
      if (vinto) s.vinte++;
      if (ruolo === 'Assassino') { s.giocateAssassino++; if (vinto) s.vinteAssassino++; }
      if (ruolo === 'Mitomane') { s.giocateMitomane++; if (vinto) s.vinteMitomane++; }
      const esito = p.dettaglio?.[uid];
      if (esito === true || esito === false) {
        s.votiDaBuono++;
        if (esito === false) s.votiSbagliati++;
      }
    }
  }
  return Object.values(st);
}

const perc = (a, b) => (b ? Math.round((100 * a) / b) : 0);

// Restituisce le classifiche già ordinate (prime `quanti` posizioni).
export function classifiche(partite, { minimoVoti = 3, quanti = 5 } = {}) {
  const st = statistiche(partite);
  const top = (arr, chiave, ...spareggi) => [...arr]
    .sort((a, b) => [chiave, ...spareggi].reduce((r, k) => r || b[k] - a[k], 0))
    .slice(0, quanti);
  const conPerc = st.map((s) => ({
    ...s,
    percVinte: perc(s.vinte, s.giocate),
    percSbagliati: perc(s.votiSbagliati, s.votiDaBuono),
    percGiusti: perc(s.votiDaBuono - s.votiSbagliati, s.votiDaBuono),
    percAssassino: perc(s.vinteAssassino, s.giocateAssassino),
    percMitomane: perc(s.vinteMitomane, s.giocateMitomane),
  }));
  return {
    migliore: top(conPerc.filter((s) => s.vinte > 0), 'vinte', 'percVinte'),
    assassino: top(conPerc.filter((s) => s.vinteAssassino > 0), 'vinteAssassino', 'percAssassino'),
    mitomane: top(conPerc.filter((s) => s.vinteMitomane > 0), 'vinteMitomane', 'percMitomane'),
    peggiore: top(conPerc.filter((s) => s.votiDaBuono >= minimoVoti && s.votiSbagliati > 0), 'percSbagliati', 'votiSbagliati'),
    fiuto: top(conPerc.filter((s) => s.votiDaBuono >= minimoVoti), 'percGiusti', 'votiDaBuono'),
  };
}

// ---------- curiosità di fine partita ----------

// partita: il risultato appena calcolato (stessa forma di games/ più cambi {uid: n} e tempi {uid: ms dal via}).
// storico: tutte le partite precedenti, in qualsiasi ordine. Restituisce al massimo `quante` frasi.
export function curiosita(partita, storico = [], { quante = 4, rng = casuale } = {}) {
  const nomi = partita.giocatori ?? {};
  const nome = (u) => nomi[u] ?? '???';
  const uids = Object.keys(partita.ruoli ?? {});
  const voti = partita.voti ?? {};
  const fatti = []; // [priorità, frase]
  const aggiungi = (priorita, frase) => fatti.push([priorita + rng() * 0.5, frase]);

  // ripensamenti
  const [indeciso, cambi] = Object.entries(partita.cambi ?? {}).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (cambi >= 2) aggiungi(3, `${nome(indeciso)} ha cambiato idea ${cambi} volte prima di votare.`);

  // tempi di voto
  const tempi = Object.entries(partita.tempi ?? {}).filter(([u]) => uids.includes(u)).sort((a, b) => a[1] - b[1]);
  if (tempi.length >= 2) {
    const [lento, ms] = tempi.at(-1);
    if (ms >= 90_000) aggiungi(2, `${nome(lento)} ci ha messo ${Math.floor(ms / 60_000)} min e ${Math.round((ms % 60_000) / 1000)} s per votare.`);
    const [svelto, ms2] = tempi[0];
    if (ms2 <= 15_000) aggiungi(2, `${nome(svelto)} ha votato dopo appena ${Math.max(1, Math.round(ms2 / 1000))} secondi.`);
  }

  // voti ricevuti in questa partita
  const ricevuti = {};
  for (const b of Object.values(voti)) ricevuti[b] = (ricevuti[b] ?? 0) + 1;
  const [bersaglio, quanti] = Object.entries(ricevuti).filter(([b]) => b !== CIELO).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (quanti >= 3 && quanti >= uids.length / 2) aggiungi(2, `${nome(bersaglio)} ha preso ${quanti} voti su ${Object.keys(voti).length}.`);
  for (const u of uids) {
    if (partita.ruoli[u] === 'Assassino' && !ricevuti[u]) aggiungi(3, `L'assassino ${nome(u)} non ha ricevuto nemmeno un voto. 🥷`);
    if (partita.ruoli[u] === 'Mitomane' && ricevuti[u] >= 2) aggiungi(3, `Il Mitomane ${nome(u)} si è fatto votare ${ricevuti[u]} volte. 🤡`);
  }
  for (const u of uids) {
    const v = voti[u];
    if (v && v !== CIELO && voti[v] === u && u < v) aggiungi(1.5, `${nome(u)} e ${nome(v)} si sono votati a vicenda.`);
  }

  // risultato dei buoni
  const esiti = Object.values(partita.dettaglio ?? {}).filter((x) => x === true || x === false);
  if (esiti.length >= 2 && esiti.every(Boolean)) aggiungi(3, 'Buoni perfetti: tutti hanno votato giusto! 🎯');
  if (esiti.length >= 2 && !esiti.some(Boolean)) aggiungi(2.5, 'Nessun buono ha indovinato. 🙈');
  if (Object.values(voti).includes(CIELO)) {
    const ciSono = Object.values(partita.ruoli).some(isAssassino);
    aggiungi(ciSono ? 1 : 2.5, ciSono ? 'Qualcuno ha guardato il cielo, ma gli assassini c\'erano eccome.' : 'Il cielo ha fatto giustizia: niente assassini in gioco. ☁️');
  }

  // storico: serie di vittorie/sconfitte e "mai votato"
  const tutte = [...storico.filter((p) => p !== partita), partita].sort((a, b) => (a.finitaIl ?? Infinity) - (b.finitaIl ?? Infinity));
  for (const u of uids) {
    if (partita.ospiti?.[u]) continue;
    const sue = tutte.filter((p) => p.ruoli?.[u]);
    let serie = 0;
    const vintaUltima = lista(sue.at(-1)?.vincitori).includes(u);
    for (let i = sue.length - 1; i >= 0 && lista(sue[i].vincitori).includes(u) === vintaUltima; i--) serie++;
    if (vintaUltima && serie >= 3) aggiungi(4, `${nome(u)} ha vinto ${serie} partite di fila! 🔥`);
    if (!vintaUltima && serie >= 4) aggiungi(2, `${nome(u)} ha perso ${serie} partite di fila. Coraggio!`);
    const maiVotato = sue.every((p) => !Object.values(p.voti ?? {}).includes(u));
    if (sue.length >= 3 && maiVotato) aggiungi(3, `Nessuno ha mai votato ${nome(u)} in ${sue.length} partite. 😇`);
    const ruolo = partita.ruoli[u];
    if ((ruolo === 'Assassino' || ruolo === 'Mitomane') && lista(partita.vincitori).includes(u)
        && sue.filter((p) => p.ruoli[u] === ruolo && lista(p.vincitori).includes(u)).length === 1 && sue.length > 1) {
      aggiungi(2.5, `Prima vittoria da ${ruolo} per ${nome(u)}!`);
    }
  }

  return fatti.sort((a, b) => b[0] - a[0]).slice(0, quante).map(([, f]) => f);
}
