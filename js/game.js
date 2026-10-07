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
