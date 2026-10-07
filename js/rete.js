// Stanza senza internet con più telefoni. Il telefono del capo tiene i dati della stanza (fa le veci
// del Realtime Database) e li manda agli altri sui canali WebRTC aperti con i QR (vedi p2p.js).
// Espone le stesse operazioni che il gioco usa con Firebase (ref, get, set, update, onValue, ...),
// così lobby, carte, voto e risultato sono gli stessi dell'online.
// Ognuno riceve solo quello che le regole del database gli farebbero leggere: la propria carta e il proprio voto.

const TIMESTAMP = '.sv';
const PERSISTENZA_CAPO = 'lupussino.rete.capo';

const clona = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const parti = (path) => String(path ?? '').split('/').filter(Boolean);

function leggi(albero, path) {
  let v = albero;
  for (const p of parti(path)) {
    if (v === null || typeof v !== 'object') return null;
    v = v[p];
  }
  return v ?? null;
}

// Scrive (o cancella, con null) un valore e toglie i nodi rimasti vuoti, come fa il database.
function scrivi(albero, path, valore) {
  const ps = parti(path);
  if (!ps.length) return valore ?? {};
  const pila = [albero];
  let nodo = albero;
  for (const p of ps.slice(0, -1)) {
    if (nodo[p] === null || typeof nodo[p] !== 'object') nodo[p] = {};
    nodo = nodo[p];
    pila.push(nodo);
  }
  const ultima = ps.at(-1);
  if (valore === null || valore === undefined || (typeof valore === 'object' && !Object.keys(valore).length)) delete nodo[ultima];
  else nodo[ultima] = valore;
  for (let i = ps.length - 2; i >= 0; i--) {
    if (!Object.keys(pila[i + 1]).length) delete pila[i][ps[i]];
  }
  return albero;
}

function conTimestamp(v) {
  if (v && typeof v === 'object') {
    if (v[TIMESTAMP] === 'timestamp') return Date.now();
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conTimestamp(x)]));
  }
  return v;
}

function istantanea(path, valore) {
  const v = clona(valore);
  return {
    key: parti(path).at(-1) ?? null,
    exists: () => v !== null,
    val: () => clona(v),
    forEach(fn) {
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (fn(istantanea(`${path}/${k}`, x)) === true) break;
    },
  };
}

// Base comune: albero in memoria e ascoltatori stile onValue.
class Db {
  constructor() {
    this.locale = true;
    this.albero = {};
    this.connesso = true;
    this.ascoltatori = new Set();
  }

  valore(path) { return path === '.info/connected' ? this.connesso : leggi(this.albero, path); }

  ascolta(path, cb) {
    const a = { path, cb, ultimo: undefined };
    this.ascoltatori.add(a);
    this.avvisa(a);
    return () => this.ascoltatori.delete(a);
  }

  avvisa(a) {
    const v = this.valore(a.path);
    const s = JSON.stringify(v);
    if (s === a.ultimo) return;
    a.ultimo = s;
    try { a.cb(istantanea(a.path, v)); } catch (e) { console.error(e); }
  }

  avvisaTutti() { for (const a of [...this.ascoltatori]) this.avvisa(a); }

  applica(modifiche) {
    for (const [path, v] of Object.entries(modifiche)) this.albero = scrivi(this.albero, path, clona(v));
    this.avvisaTutti();
  }
}

// ---------- capo ----------

export class Capo extends Db {
  constructor({ uid, albero = {}, roomId = null }) {
    super();
    this.uid = uid;
    this.albero = albero;
    this.roomId = roomId;
    this.ospiti = new Map(); // canale -> { uid, disconnessione: { path: modifiche } }
    this.inAttesa = false;
    this.alCambio = () => {};
  }

  static salvato() {
    try { return JSON.parse(localStorage.getItem(PERSISTENZA_CAPO)); } catch { return null; }
  }

  static dimentica() { try { localStorage.removeItem(PERSISTENZA_CAPO); } catch { /* niente */ } }

  async scrivi(modifiche, autore = this.uid) {
    const pronte = Object.fromEntries(Object.entries(modifiche).map(([p, v]) => [parti(p).join('/'), conTimestamp(v)]));
    if (autore !== this.uid) this.controlla(pronte, autore);
    this.applica(pronte);
    this.salva();
    this.programmaInvio();
  }

  // Sul telefono del capo: se la pagina si ricarica la stanza si può riprendere.
  salva() {
    try { localStorage.setItem(PERSISTENZA_CAPO, JSON.stringify({ roomId: this.roomId, albero: this.albero })); } catch { /* pazienza */ }
  }

  // Le stesse regole di database.rules.json, ridotte a quello che un ospite può scrivere.
  controlla(modifiche, uid) {
    for (const [path, v] of Object.entries(modifiche)) {
      const p = parti(path);
      const stanza = ['rooms', 'votes'].includes(p[0]) ? leggi(this.albero, `rooms/${p[1]}`) : null;
      const ok = (
        (p[0] === 'rooms' && p[2] === 'players' && p[3] === uid && stanza
          && (stanza.status !== 'playing' || (stanza.players?.[uid] && (p.length > 4 || v !== null))))
        || (p[0] === 'rooms' && p[2] === 'voted' && p[3] === uid && p.length === 4 && v === true
          && stanza?.status === 'playing' && stanza.inGioco?.[uid] && !stanza.voted?.[uid])
        || (p[0] === 'votes' && p[3] === uid && p.length === 4
          && leggi(this.albero, `rooms/${p[1]}/status`) === 'playing'
          && String(leggi(this.albero, `rooms/${p[1]}/round`)) === p[2]
          && v?.bersaglio && v.bersaglio !== uid)
      );
      const scaduto = stanza?.fineVoto && Date.now() > stanza.fineVoto + 3000 && (p[0] === 'votes' || p[2] === 'voted');
      if (!ok || scaduto) throw new Error(scaduto ? 'Tempo scaduto: il voto è chiuso.' : `Permesso negato: ${path}`);
    }
  }

  // Quello che un ospite può leggere: la stanza, la propria carta e il proprio voto.
  vistaPer(uid) {
    const v = { rooms: clona(this.albero.rooms ?? {}) };
    for (const [radice, dest] of [['hands', 'hands'], ['votes', 'votes']]) {
      for (const [stanza, round] of Object.entries(this.albero[radice] ?? {})) {
        for (const [r, perUid] of Object.entries(round ?? {})) {
          if (perUid?.[uid] !== undefined) scrivi(v, `${dest}/${stanza}/${r}/${uid}`, clona(perUid[uid]));
        }
      }
    }
    return v;
  }

  programmaInvio() {
    if (this.inAttesa) return;
    this.inAttesa = true;
    queueMicrotask(() => this.inviaATutti());
  }

  inviaATutti() {
    this.inAttesa = false;
    for (const [canale, o] of this.ospiti) if (o.uid) manda(canale, { t: 'albero', albero: this.vistaPer(o.uid) });
    this.alCambio();
  }

  // Un nuovo canale aperto con un ospite (o lo stesso ospite che rientra dopo essere caduto).
  collega(canale) {
    const o = { uid: null, disconnessione: {} };
    this.ospiti.set(canale, o);
    canale.addEventListener('message', (e) => this.ricevi(canale, o, JSON.parse(e.data)));
    canale.addEventListener('close', () => {
      if (this.ospiti.get(canale) !== o) return;
      this.ospiti.delete(canale);
      // solo se il giocatore è ancora nella stanza (se è stato rimosso non va ricreato)
      const ops = Object.assign({}, ...Object.values(o.disconnessione));
      for (const k of Object.keys(ops)) if (!leggi(this.albero, parti(k).slice(0, 4).join('/'))) delete ops[k];
      if (Object.keys(ops).length) this.scrivi(ops, this.uid).catch(console.warn);
      this.alCambio();
    });
  }

  async ricevi(canale, o, m) {
    if (m.t === 'ciao') {
      // stesso giocatore su un canale nuovo: il vecchio si chiude senza segnarlo offline
      for (const [c, altro] of this.ospiti) if (c !== canale && altro.uid === m.uid) { this.ospiti.delete(c); c.close(); }
      o.uid = m.uid;
      manda(canale, { t: 'albero', albero: this.vistaPer(o.uid) });
      manda(canale, { t: 'benvenuto', roomId: this.roomId, capo: this.uid });
      this.alCambio();
      return;
    }
    if (!o.uid) return;
    if (m.t === 'scrivi') {
      try {
        await this.scrivi(m.modifiche, o.uid);
        this.inviaATutti(); // prima i dati aggiornati, poi la conferma: chi ha scritto rilegge già il nuovo stato
        manda(canale, { t: 'ok', id: m.id });
      } catch (e) {
        manda(canale, { t: 'no', id: m.id, errore: e.message });
      }
    }
    if (m.t === 'disconnessione') {
      if (m.modifiche) o.disconnessione[m.path] = m.modifiche;
      else delete o.disconnessione[m.path];
    }
  }

  // Il capo rimuove un giocatore: chiude anche il suo canale.
  scollega(uid) {
    for (const [c, o] of this.ospiti) if (o.uid === uid) { this.ospiti.delete(c); o.disconnessione = {}; c.close(); }
    this.alCambio();
  }

  collegati() { return [...this.ospiti.values()].filter((o) => o.uid).map((o) => o.uid); }

  // Manda a tutti l'ultimo stato (es. la stanza chiusa) e poi chiude i canali.
  chiudi() {
    this.inviaATutti();
    const canali = [...this.ospiti.keys()];
    this.ospiti.clear();
    setTimeout(() => canali.forEach((c) => c.close()), 1000);
    Capo.dimentica();
  }
}

// ---------- ospite ----------

export class Ospite extends Db {
  constructor(canale, uid) {
    super();
    this.uid = uid;
    this.canale = canale;
    this.connesso = canale.readyState === 'open';
    this.attese = new Map();
    this.n = 0;
    this.alChiusura = () => {};
    this.benvenuto = new Promise((ok) => { this.diBenvenuto = ok; });
    canale.addEventListener('message', (e) => this.ricevi(JSON.parse(e.data)));
    canale.addEventListener('close', () => {
      this.connesso = false;
      for (const { no } of this.attese.values()) no(new Error('Collegamento col capo perso'));
      this.attese.clear();
      this.avvisaTutti();
      this.alChiusura();
    });
    manda(canale, { t: 'ciao', uid });
  }

  ricevi(m) {
    if (m.t === 'albero') { this.albero = m.albero ?? {}; this.avvisaTutti(); }
    if (m.t === 'benvenuto') this.diBenvenuto(m);
    if (m.t === 'ok') { this.attese.get(m.id)?.ok(); this.attese.delete(m.id); }
    if (m.t === 'no') { this.attese.get(m.id)?.no(new Error(m.errore)); this.attese.delete(m.id); }
  }

  scrivi(modifiche) {
    if (!this.connesso) return Promise.reject(new Error('Collegamento col capo perso'));
    const id = ++this.n;
    return new Promise((ok, no) => {
      this.attese.set(id, { ok, no });
      manda(this.canale, { t: 'scrivi', id, modifiche });
    });
  }

  disconnessione(path, modifiche) {
    if (this.connesso) manda(this.canale, { t: 'disconnessione', path, modifiche });
    return Promise.resolve();
  }

  chiudi() { this.canale.close(); }
}

function manda(canale, m) {
  if (canale.readyState === 'open') canale.send(JSON.stringify(m));
}

// ---------- stesse funzioni di firebase/database, per i riferimenti locali ----------

export const ref = (db, path = '') => ({ locale: true, db, path: parti(path).join('/'), key: parti(path).at(-1) ?? null });
export const get = async (r) => istantanea(r.path, r.db.valore(r.path));
export const onValue = (r, cb) => r.db.ascolta(r.path, cb);
export const update = (r, valori) => r.db.scrivi(Object.fromEntries(Object.entries(valori).map(([k, v]) => [[r.path, k].filter(Boolean).join('/'), v])));
export const set = (r, v) => r.db.scrivi({ [r.path]: v });
export const remove = (r) => r.db.scrivi({ [r.path]: null });

export function push(r) {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  const chiave = `L${Date.now().toString(36)}${[...buf].map((b) => b.toString(36)).join('')}`;
  return ref(r.db, `${r.path}/${chiave}`);
}

// Il capo non si disconnette da sé stesso; l'ospite chiede al capo di applicare le modifiche se cade.
export function onDisconnect(r) {
  const registra = (modifiche) => (r.db instanceof Ospite ? r.db.disconnessione(r.path, modifiche) : Promise.resolve());
  return {
    update: (v) => registra(Object.fromEntries(Object.entries(v).map(([k, x]) => [`${r.path}/${k}`, x]))),
    set: (v) => registra({ [r.path]: v }),
    remove: () => registra({ [r.path]: null }),
    cancel: () => registra(null),
  };
}
