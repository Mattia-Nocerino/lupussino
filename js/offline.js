// Archivio locale per giocare senza campo: amici conosciuti, storico, partite da sincronizzare,
// e la partita offline in corso (così un ricaricamento della pagina non la perde).
// Tutto in localStorage, protetto da try/catch (in navigazione privata può non esserci).

const CHIAVI = {
  amici: 'lupussino.amici',           // { uid: nome } dei giocatori con account Google visti online
  storico: 'lupussino.storico',       // ultime partite (online e offline), per le curiosità
  coda: 'lupussino.daSincronizzare',  // { id: partita } finite offline e non ancora salvate online
  partita: 'lupussino.offline',       // stato della partita offline in corso
  ultimi: 'lupussino.offline.ultimi', // ultima formazione usata offline
};
const MAX_STORICO = 300;

function leggi(chiave, predefinito) {
  try { return JSON.parse(localStorage.getItem(chiave)) ?? predefinito; } catch { return predefinito; }
}
function scrivi(chiave, valore) {
  try {
    if (valore === null || valore === undefined) localStorage.removeItem(chiave);
    else localStorage.setItem(chiave, JSON.stringify(valore));
  } catch { /* spazio esaurito o storage bloccato: pazienza */ }
}

export const amici = () => leggi(CHIAVI.amici, {});
export const coda = () => leggi(CHIAVI.coda, {});
export const storico = () => leggi(CHIAVI.storico, []);
export const partitaSalvata = () => leggi(CHIAVI.partita, null);
export const salvaPartita = (stato) => scrivi(CHIAVI.partita, stato);
export const ultimi = () => leggi(CHIAVI.ultimi, []);
export const salvaUltimi = (giocatori) => scrivi(CHIAVI.ultimi, giocatori);

// Aggiorna amici e storico partendo dalle partite lette online.
export function ricordaPartite(partite, io = null) {
  const a = amici();
  for (const p of partite) {
    for (const [uid, nome] of Object.entries(p.giocatori ?? {})) {
      if (!p.ospiti?.[uid] && nome) a[uid] = nome;
    }
  }
  if (io?.uid && !io.ospite) a[io.uid] = io.nome;
  scrivi(CHIAVI.amici, a);
  const tutte = [...partite, ...Object.values(coda())]
    .sort((x, y) => (x.finitaIl ?? 0) - (y.finitaIl ?? 0))
    .slice(-MAX_STORICO);
  scrivi(CHIAVI.storico, tutte);
}

// Una partita finita offline: in coda per il database e subito nello storico locale.
export function accoda(id, partita) {
  scrivi(CHIAVI.coda, { ...coda(), [id]: partita });
  scrivi(CHIAVI.storico, [...storico(), partita].slice(-MAX_STORICO));
}

export function togliDallaCoda(id) {
  const c = coda();
  delete c[id];
  scrivi(CHIAVI.coda, c);
}

export function nuovoId(prefisso) {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return `${prefisso}_${Date.now().toString(36)}${[...buf].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
