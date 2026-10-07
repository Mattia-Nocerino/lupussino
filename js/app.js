import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInAnonymously, signOut,
  onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
  query, orderByChild, limitToLast, serverTimestamp, connectDatabaseEmulator,
} from './dati.js';
import { firebaseConfig } from './firebase-config.js';
import * as G from './game.js';
import * as O from './offline.js';
import * as P from './p2p.js';
import { Capo, Ospite } from './rete.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const dbFirebase = getDatabase(app);
let db = dbFirebase; // nella stanza senza internet diventa il telefono del capo (rete.js)

// Sviluppo locale: apri la pagina con ?emulatori per usare gli emulatori Firebase invece del progetto vero.
if (new URLSearchParams(location.search).has('emulatori')) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(dbFirebase, location.hostname, 9000);
}

const $app = document.getElementById('app');
const $utente = document.getElementById('utente');
const $toast = document.getElementById('toast');

// Stato locale della pagina. La verità sta nel Realtime Database: qui teniamo solo l'ultima copia ricevuta.
const S = {
  user: null,
  nome: '',
  stanze: [],
  roomId: null,
  room: null,
  mano: null,        // { ruolo, squadra, info } del round corrente
  manoRound: null,
  coperta: true,     // la carta parte sempre coperta
  mioVoto: null,
  scelta: null,      // voto selezionato ma non ancora confermato
  cambi: 0,          // quante volte hai cambiato scelta prima di confermare (per le curiosità)
  vista: null,       // 'classifica' quando sei fuori dalle stanze
  calcolando: false,
  cambiando: false,  // sta cambiando un voto già confermato
  off: O.partitaSalvata(), // partita senza campo in corso (un solo telefono), sopravvive ai ricaricamenti
};
let unsubStanze = null;
let unsubRoom = null;
let unsubConnessione = null;
let offsetServer = 0; // differenza tra l'orologio del server e quello del telefono
onValue(ref(dbFirebase, '.info/serverTimeOffset'), (snap) => { offsetServer = snap.val() ?? 0; });

// Presenza: il server segna "online: false" da solo quando un telefono si disconnette (onDisconnect).
// Dopo questo margine senza capo stanza, il primo giocatore online prende il suo posto.
const MARGINE_CAPO_MS = 20_000;

// ---------- utilità ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const roomPath = (id = S.roomId) => `rooms/${id}`;
const roomRef = (id = S.roomId) => ref(db, roomPath(id));
const ora = () => Date.now() + offsetServer;
const sonoHost = () => S.room?.hostUid === S.user?.uid;
const online = (uid) => S.room?.players?.[uid]?.online !== false;
// Pillola di un ruolo: emoji del ruolo davanti al testo, verde o rossa secondo la squadra.
const pillola = (ruolo, testo = ruolo, classe = '') => (G.RUOLI[ruolo]
  ? `<span class="pill ${G.squadraDi(ruolo)} ${classe}">${G.EMOJI[ruolo]} ${esc(testo)}</span>`
  : `<span class="pill ${classe}">${esc(testo)}</span>`);
const nomeDi = (uid) => (uid === G.CIELO ? `${G.EMOJI_CIELO} Cielo` : S.room?.inGioco?.[uid] ?? S.room?.players?.[uid]?.nome ?? 'giocatore uscito');

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, 3500);
}

async function tenta(fn) {
  try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e)); }
}

// ---------- auth ----------

onAuthStateChanged(auth, async (user) => {
  if (S.rete) return; // nella stanza senza internet resta l'identità con cui si è entrati
  S.user = user;
  if (!user) {
    unsubStanze?.(); unsubRoom?.(); unsubConnessione?.();
    Object.assign(S, { stanze: [], roomId: null, room: null, mano: null, manoRound: null });
    return render();
  }
  S.nome = localStorage.getItem('lupussino.nome') || user.displayName || `Ospite ${user.uid.slice(0, 4)}`;
  render(); // senza campo le operazioni sotto restano in attesa: intanto la pagina deve funzionare
  tenta(() => update(ref(dbFirebase, `users/${user.uid}`), { nome: S.nome, ultimoAccesso: serverTimestamp() }));
  ascoltaStanze();
  const salvata = localStorage.getItem('lupussino.room');
  if (salvata && navigator.onLine) await tenta(() => entraInStanza(salvata, { soloSeGiaDentro: true }));
  render();
  if (navigator.onLine) {
    sincronizza();
    leggiPartite().then((p) => O.ricordaPartite(p, { uid: user.uid, nome: S.nome, ospite: user.isAnonymous })).catch(() => {});
  }
});

async function login() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else throw e;
  }
}

async function salvaNome(nome) {
  nome = nome.trim().slice(0, 20);
  if (!nome) return;
  S.nome = nome;
  localStorage.setItem('lupussino.nome', nome);
  await update(ref(dbFirebase, `users/${S.user.uid}`), { nome });
  toast('Nome salvato');
}

// ---------- stanze ----------

function ascoltaStanze() {
  unsubStanze?.();
  const q = query(ref(db, 'rooms'), orderByChild('createdAt'), limitToLast(50));
  unsubStanze = onValue(q, (snap) => {
    const stanze = [];
    snap.forEach((c) => { stanze.push({ id: c.key, ...c.val() }); });
    S.stanze = stanze.filter((r) => r.status !== 'playing').reverse();
    // aggiorna solo la lista, così non si perde quello che l'utente sta scrivendo nei campi
    const $lista = document.getElementById('lista-stanze');
    if ($lista && !S.room) $lista.innerHTML = listaStanze();
  });
}

const mioGiocatore = () => ({ nome: S.nome, online: true, visto: serverTimestamp(), ospite: !!S.user.isAnonymous });

async function creaStanza(nome) {
  nome = nome.trim().slice(0, 30);
  if (!nome) return;
  const nuova = push(ref(db, 'rooms'));
  await set(nuova, {
    name: nome,
    hostUid: S.user.uid,
    status: 'lobby',
    round: 0,
    players: { [S.user.uid]: mioGiocatore() },
    createdAt: serverTimestamp(),
  });
  osservaStanza(nuova.key);
}

async function entraInStanza(id, { soloSeGiaDentro = false } = {}) {
  const snap = await get(roomRef(id));
  if (!snap.exists()) { localStorage.removeItem('lupussino.room'); return; }
  const room = snap.val();
  if (!room.players?.[S.user.uid]) {
    if (soloSeGiaDentro) { localStorage.removeItem('lupussino.room'); return; }
    if (room.status === 'playing') return toast('Partita già in corso, riprova dopo.');
    if (Object.keys(room.players ?? {}).length >= G.MAX_GIOCATORI) return toast('Stanza piena.');
    await set(ref(db, `${roomPath(id)}/players/${S.user.uid}`), mioGiocatore());
  }
  osservaStanza(id);
}

function osservaStanza(id) {
  unsubRoom?.();
  S.roomId = id;
  localStorage.setItem('lupussino.room', id);
  attivaPresenza(id);
  unsubRoom = onValue(roomRef(id), (snap) => {
    if (!snap.exists() || !snap.val().players?.[S.user.uid]) {
      if (S.room) toast('Sei fuori dalla stanza.');
      return lasciaLocalmente();
    }
    S.room = snap.val();
    const inGioco = !!S.room.inGioco?.[S.user.uid];
    if (S.room.status === 'playing' && inGioco && S.manoRound !== S.room.round) caricaMano();
    if (S.room.status === 'playing' && sonoHost() && tuttiHannoVotato()) chiudiVotoTraPoco();
    controllaCapo();
    render();
  }, (e) => { toast(e.message); lasciaLocalmente(); });
}

// A ogni (ri)connessione: "sono online", e chiedo al server di segnarmi offline quando cado.
function attivaPresenza(id) {
  unsubConnessione?.();
  const mioRef = ref(db, `${roomPath(id)}/players/${S.user.uid}`);
  unsubConnessione = onValue(ref(db, '.info/connected'), async (snap) => {
    if (!snap.val()) return;
    try {
      await onDisconnect(mioRef).update({ online: false, visto: serverTimestamp() });
      await update(mioRef, { online: true, visto: serverTimestamp() });
    } catch (e) { console.warn('presenza', e); } // es. sei stato rimosso dalla stanza
  });
}

async function disattivaPresenza() {
  unsubConnessione?.();
  unsubConnessione = null;
  if (S.roomId && S.user) await onDisconnect(ref(db, `${roomPath()}/players/${S.user.uid}`)).cancel().catch(() => {});
}

function lasciaLocalmente() {
  disattivaPresenza();
  unsubRoom?.();
  unsubRoom = null;
  clearTimeout(controllaCapo.timer);
  localStorage.removeItem('lupussino.room');
  Object.assign(S, { roomId: null, room: null, mano: null, manoRound: null, mioVoto: null });
  if (S.rete) chiudiRete();
  render();
}

async function esciDallaStanza() {
  const { room } = S;
  const uid = S.user.uid;
  if (room.status === 'playing' && room.inGioco?.[uid]) {
    if (!confirm('La partita è in corso: se esci gli altri non potranno finire il voto. Uscire comunque?')) return;
    return lasciaLocalmente(); // resti tra i giocatori del round: potrai rientrare dalla stessa pagina
  }
  if (S.rete?.capo) {
    if (Object.keys(room.players).length > 1 && !confirm('Senza internet la stanza vive sul tuo telefono: se esci si chiude per tutti. Chiudere?')) return;
    await remove(roomRef()); // gli altri vedono la stanza sparire ed escono
    return lasciaLocalmente();
  }
  await disattivaPresenza();
  const altri = Object.keys(room.players).filter((u) => u !== uid);
  if (sonoHost()) {
    if (altri.length === 0) await remove(roomRef());
    else {
      const nuovo = altri.find(online) ?? altri[0];
      await update(roomRef(), { hostUid: nuovo, [`players/${uid}`]: null });
    }
  } else {
    await remove(ref(db, `${roomPath()}/players/${uid}`));
  }
  lasciaLocalmente();
}

async function rimuoviGiocatore(uid) {
  if (!sonoHost() || uid === S.user.uid) return;
  const inGioco = S.room.status === 'playing' && S.room.inGioco?.[uid];
  const avviso = inGioco ? ' Il round continua senza di lui/lei: il suo voto non conta e non può essere votato/a.' : '';
  if (!confirm(`Rimuovere ${nomeDi(uid)} dalla stanza?${avviso}`)) return;
  const modifiche = { [`players/${uid}`]: null };
  if (inGioco) Object.assign(modifiche, { [`inGioco/${uid}`]: null, [`voted/${uid}`]: null });
  await update(roomRef(), modifiche);
  S.rete?.capo?.scollega(uid);
}

// Se il capo stanza risulta offline da più di MARGINE_CAPO_MS, il primo giocatore online
// (in ordine fisso, uguale per tutti) diventa capo stanza. La transazione evita doppioni.
async function controllaCapo() {
  clearTimeout(controllaCapo.timer);
  const r = S.room;
  if (!r || !S.user || sonoHost() || S.rete) return;
  const capo = r.players?.[r.hostUid];
  if (capo && capo.online !== false) return;
  const candidati = Object.keys(r.players).filter((u) => u !== r.hostUid && online(u)).sort();
  if (candidati[0] !== S.user.uid) return;
  const attesa = capo ? (capo.visto ?? 0) + MARGINE_CAPO_MS - ora() : 0;
  if (attesa > 0) {
    controllaCapo.timer = setTimeout(controllaCapo, attesa + 500); // magari nel frattempo torna
    return;
  }
  const vecchio = r.hostUid;
  try {
    const { committed } = await runTransaction(ref(db, `${roomPath()}/hostUid`), (attuale) => (attuale === vecchio ? S.user.uid : undefined));
    if (committed) toast('Il capo stanza è offline: ora sei tu il capo stanza.');
  } catch (e) {
    console.warn('promozione rifiutata', e);
    controllaCapo.timer = setTimeout(controllaCapo, 5000);
  }
}

// ---------- partita ----------

// Solo il capo stanza: distribuisce le carte, scrive a ognuno la sua mano (leggibile solo da lui)
// e conserva il mazzo completo in un nodo leggibile solo dal capo stanza. Tutto in una scrittura atomica.
async function avviaPartita() {
  const uids = Object.keys(S.room.players);
  if (!G.puoIniziare(uids.length)) return toast(`Servono da ${G.MIN_GIOCATORI} a ${G.MAX_GIOCATORI} giocatori.`);
  const nomi = Object.fromEntries(uids.map((u) => [u, S.room.players[u].nome]));
  const { assegnazioni, scarti } = G.distribuisci(uids);
  const mani = G.informazioni(assegnazioni, scarti, nomi);
  const round = (S.room.round ?? 0) + 1;

  const modifiche = {
    [`secret/${S.roomId}/${round}`]: { assegnazioni, scarti },
    [`${roomPath()}/status`]: 'playing',
    [`${roomPath()}/round`]: round,
    [`${roomPath()}/inGioco`]: nomi,
    [`${roomPath()}/iniziatoIl`]: serverTimestamp(),
    [`${roomPath()}/nGiocatori`]: uids.length, // il mazzo del round resta questo anche se poi qualcuno viene rimosso
    [`${roomPath()}/voted`]: null,
    [`${roomPath()}/result`]: null,
  };
  for (const uid of uids) modifiche[`hands/${S.roomId}/${round}/${uid}`] = mani[uid];
  await update(ref(db), modifiche);
}

async function caricaMano() {
  const round = S.room.round;
  S.manoRound = round;
  S.coperta = true;
  S.mano = null;
  S.mioVoto = null;
  S.scelta = null;
  S.cambi = 0;
  S.cambiando = false;
  const [mano, voto] = await Promise.all([
    get(ref(db, `hands/${S.roomId}/${round}/${S.user.uid}`)),
    get(ref(db, `votes/${S.roomId}/${round}/${S.user.uid}`)),
  ]);
  if (S.manoRound !== round) return;
  S.mano = mano.val();
  S.mioVoto = voto.val()?.bersaglio ?? null;
  S.cambi = voto.val()?.cambi ?? 0;
  render();
}

// Il voto è in due tempi: tocchi un nome per sceglierlo (puoi cambiare idea), poi confermi.
// Anche dopo la conferma si può cambiare voto, finché la partita non è chiusa.
function scegli(bersaglio) {
  if ((S.mioVoto && !S.cambiando) || S.scelta === bersaglio) return;
  if (S.scelta) S.cambi++;
  S.scelta = bersaglio;
  render();
}

async function confermaVoto() {
  const bersaglio = S.scelta;
  if (!bersaglio || (S.mioVoto && !S.cambiando)) return;
  if (bersaglio !== S.mioVoto) {
    const modifiche = { [`votes/${S.roomId}/${S.room.round}/${S.user.uid}`]: { bersaglio, cambi: S.cambi, at: serverTimestamp() } };
    if (!S.room.voted?.[S.user.uid]) modifiche[`${roomPath()}/voted/${S.user.uid}`] = true;
    await update(ref(db), modifiche);
  }
  S.mioVoto = bersaglio;
  S.cambiando = false;
  render();
}

function cambiaVoto() {
  S.cambiando = true;
  S.scelta = S.mioVoto;
  render();
}

// Quando tutti hanno votato restano pochi secondi per cambiare idea, poi il capo chiude il voto.
const ULTIMI_SECONDI_MS = 5000;
function chiudiVotoTraPoco() {
  if (chiudiVotoTraPoco.timer) return;
  chiudiVotoTraPoco.timer = setTimeout(() => {
    chiudiVotoTraPoco.timer = null;
    if (S.room?.status === 'playing' && sonoHost() && tuttiHannoVotato()) calcolaRisultato();
  }, ULTIMI_SECONDI_MS);
}

function tuttiHannoVotato() {
  const uids = Object.keys(S.room.inGioco ?? {});
  return uids.length > 0 && uids.every((u) => S.room.voted?.[u]);
}

// Solo il capo stanza: legge mazzo e voti, calcola il vincitore, rivela tutto e salva lo storico.
async function calcolaRisultato() {
  if (S.calcolando) return;
  S.calcolando = true;
  try {
    const round = S.room.round;
    const [mazzoSnap, votiSnap] = await Promise.all([
      get(ref(db, `secret/${S.roomId}/${round}`)),
      get(ref(db, `votes/${S.roomId}/${round}`)),
    ]);
    const mazzo = mazzoSnap.val();
    // contano solo i giocatori ancora nel round (chi è stato rimosso esce dal conteggio)
    const presenti = (u) => u in (S.room.inGioco ?? {});
    const schede = Object.entries(votiSnap.val() ?? {}).filter(([u]) => presenti(u));
    const voti = Object.fromEntries(schede.map(([u, v]) => [u, v.bersaglio]));
    const cambi = Object.fromEntries(schede.map(([u, v]) => [u, v.cambi ?? 0]));
    const inizio = S.room.iniziatoIl;
    const tempi = inizio ? Object.fromEntries(schede.filter(([, v]) => v.at).map(([u, v]) => [u, v.at - inizio])) : {};
    const esito = G.esitoVoto(mazzo.assegnazioni, voti);
    esito.vincitori = esito.vincitori.filter(presenti);
    const ruoli = Object.fromEntries(Object.entries(mazzo.assegnazioni).filter(([u]) => presenti(u)));
    const ospiti = Object.fromEntries(Object.keys(ruoli).filter((u) => S.room.players?.[u]?.ospite).map((u) => [u, true]));
    const punti = G.punteggi(ruoli, voti, esito);
    const partita = {
      ...esito, ruoli, scarti: mazzo.scarti, voti, cambi, tempi, ospiti, punti, giocatori: S.room.inGioco, finitaIl: Date.now(),
    };
    const storico = await leggiPartite().catch(() => []);
    const result = { ...partita, fatti: G.curiosita(partita, storico) };

    const modifiche = {
      [`${roomPath()}/status`]: 'ended',
      [`${roomPath()}/result`]: result,
      [`${roomPath()}/classifica`]: G.aggiungiAllaClassifica(S.room.classifica, partita),
    };
    const storia = { roomId: S.roomId, round, hostUid: S.user.uid, ...partita };
    // senza internet la partita resta sul telefono del capo e va in games/ quando torna la rete
    if (S.rete) O.accoda(`${S.roomId}_${round}`, { ...storia, offline: true });
    else modifiche[`games/${S.roomId}_${round}`] = { ...storia, finitaIl: serverTimestamp() };
    await update(ref(db), modifiche);
  } catch (e) {
    console.error(e); toast(e.message);
  } finally {
    S.calcolando = false;
  }
}

// Storico partite (base di classifiche e curiosità). Con pochi amici restano poche migliaia di righe.
async function leggiPartite() {
  if (S.rete) return O.storico();
  const snap = await get(query(ref(dbFirebase, 'games'), orderByChild('finitaIl'), limitToLast(2000)));
  const partite = [];
  snap.forEach((c) => { partite.push(c.val()); });
  return partite;
}

async function apriClassifica() {
  S.vista = 'classifica';
  S.classifiche = null;
  render();
  let partite;
  S.classificheLocali = !navigator.onLine;
  if (navigator.onLine) {
    partite = await leggiPartite().catch(() => null);
    if (partite) O.ricordaPartite(partite, { uid: S.user.uid, nome: S.nome, ospite: S.user.isAnonymous });
  }
  if (!partite) { partite = O.storico(); S.classificheLocali = true; }
  S.classifiche = G.classifiche(partite);
  render();
}

async function nuovaPartita() {
  await update(roomRef(), { status: 'lobby', inGioco: null, voted: null, result: null });
}

// ---------- viste ----------

function render() {
  if (S.off) {
    $utente.innerHTML = '<span>📴 Senza campo</span>';
    $app.innerHTML = vistaOffline();
    if (S.off.fase === 'fine') festeggia(S.off.id, S.off.result, nomiVincitori(S.off.result, (u) => S.off.giocatori[u]));
    return;
  }
  $utente.innerHTML = S.rete ? `<span>📡 ${esc(S.nome)} · senza internet</span>`
    : S.user ? `<span>${esc(S.nome)}</span><button class="link" data-action="logout">Esci</button>`
      : '';
  if (S.rete && !S.room) return ($app.innerHTML = vistaRete());
  if (S.vista === 'rete') return ($app.innerHTML = vistaRete());
  if (!S.user) return ($app.innerHTML = vistaLogin());
  if (!S.room && S.vista === 'classifica') return ($app.innerHTML = vistaClassifica());
  if (!S.room) return ($app.innerHTML = vistaHome());
  const viste = { lobby: vistaLobby, playing: vistaPartita, ended: vistaRisultato };
  $app.innerHTML = avvisoRete() + (viste[S.room.status]?.() ?? '');
  if (S.room.status === 'ended' && S.room.result) {
    const io = Object.values(S.room.result.vincitori ?? {}).includes(S.user.uid);
    festeggia(`${S.roomId}/${S.room.round}`, S.room.result, S.room.result.vincitore === G.PAREGGIO ? 'Non vince nessuno' : io ? 'Hai vinto 🎉' : 'Hai perso');
  }
}

const vistaLogin = () => `
  <section class="panel stack" style="text-align:center">
    <p>Il gioco di bluff da fare in compagnia.<br><span class="muted">Da ${G.MIN_GIOCATORI} a ${G.MAX_GIOCATORI} giocatori.</span></p>
    <button class="primary full" data-action="login">Entra con Google</button>
    <button class="full" data-action="ospite">Entra come ospite</button>
    <p class="muted">Gli ospiti non finiscono in classifica e perdono il profilo se cancellano i dati del browser.</p>
  </section>
  ${bottoneOffline()}`;

function listaStanze() {
  const stanze = S.stanze.map((r) => {
    const n = Object.keys(r.players ?? {}).length;
    const stato = r.status === 'ended' ? 'tra una partita e l\'altra' : 'in attesa';
    return `<li><div><strong>${esc(r.name)}</strong><br><span class="muted">${n}/${G.MAX_GIOCATORI} · ${stato}</span></div>
      <button data-action="entra" data-id="${esc(r.id)}" ${n >= G.MAX_GIOCATORI ? 'disabled' : ''}>Entra</button></li>`;
  }).join('');
  return stanze ? `<ul class="list">${stanze}</ul>` : '<p class="muted">Nessuna stanza aperta. Creane una!</p>';
}

function vistaClassifica() {
  const c = S.classifiche;
  if (!c) return '<p class="muted">Carico le partite…</p>';
  const blocco = (titolo, sottotitolo, righe, valore) => `
    <h2>${titolo}</h2>
    <section class="panel">
      <p class="muted">${sottotitolo}</p>
      ${righe.length ? `<ol class="classifica">${righe.map((s) => `<li><span>${esc(s.nome)}</span><strong>${valore(s)}</strong></li>`).join('')}</ol>`
        : '<p class="muted">Ancora nessuno.</p>'}
    </section>`;
  return `
    <div class="titolo-riga"><h2>🏆 Classifiche</h2><button class="mazzo-btn" data-action="indietro">← Stanze</button></div>
    ${blocco('⭐ Più punti', 'Punti totali: 10 a chi vince, più bonus e malus personali', c.punti ?? [], (s) => `${s.punti} <small>in ${s.giocate} partite</small>`)}
    ${blocco('🥇 Miglior giocatore', 'Partite vinte', c.migliore, (s) => `${s.vinte} <small>(${s.percVinte}% di ${s.giocate})</small>`)}
    ${blocco('🔪 Miglior assassino', 'Vittorie da Assassino', c.assassino, (s) => `${s.vinteAssassino} <small>su ${s.giocateAssassino}</small>`)}
    ${blocco('🤡 Miglior mitomane', 'Vittorie da Mitomane', c.mitomane, (s) => `${s.vinteMitomane} <small>su ${s.giocateMitomane}</small>`)}
    ${blocco('🎯 Fiuto migliore', 'Voti giusti da buono (almeno 3 voti)', c.fiuto, (s) => `${s.percGiusti}% <small>di ${s.votiDaBuono}</small>`)}
    ${blocco('🙈 Peggior giocatore', 'Voti sbagliati da buono (almeno 3 voti)', c.peggiore, (s) => `${s.percSbagliati}% <small>di ${s.votiDaBuono}</small>`)}
    <p class="muted">Gli ospiti non entrano in classifica: per comparire entra con Google.</p>
    ${S.classificheLocali ? '<p class="muted">📴 Sei senza campo: classifiche calcolate con le partite salvate su questo telefono.</p>' : ''}`;
}

function vistaHome() {
  return `
    ${navigator.onLine ? '' : '<p class="panel">📴 Sei senza campo: le stanze online torneranno con internet. Intanto potete giocare con un solo telefono.</p>'}
    ${bottoneOffline()}
    <button class="full" data-action="classifica">🏆 Classifiche</button>
    <section class="panel stack">
      <label class="muted" for="nome">Il tuo nome</label>
      <form data-form="nome" class="row"><input id="nome" name="nome" value="${esc(S.nome)}" maxlength="20" required><button>Salva</button></form>
    </section>
    <h2>Stanze aperte</h2>
    <section class="panel" id="lista-stanze">${listaStanze()}</section>
    <h2>Crea stanza</h2>
    <form data-form="crea" class="panel row"><input name="nome" placeholder="Nome della stanza" maxlength="30" required><button class="primary">Crea</button></form>`;
}

function listaGiocatori() {
  const r = S.room;
  return `<ul class="list">${Object.keys(r.players).map((u) => `<li>
    <span>${u === r.hostUid ? '👑 ' : ''}${esc(r.players[u].nome)}${u === S.user.uid ? ' <span class="tag">tu</span>' : ''}${online(u) ? '' : ' <span class="tag">offline</span>'}</span>
    ${sonoHost() && u !== S.user.uid ? `<button class="link" data-action="rimuovi" data-uid="${esc(u)}">rimuovi</button>` : ''}</li>`).join('')}</ul>`;
}

const pannelloGiocatori = () => `<details class="panel"><summary>Giocatori nella stanza</summary>${listaGiocatori()}</details>`;

function vistaLobby() {
  const r = S.room;
  const uids = Object.keys(r.players);
  const ok = G.puoIniziare(uids.length);
  return `
    <div class="titolo-riga"><h2>${esc(r.name)}</h2>${bottoneMazzo()}</div>
    <section class="panel">
      <p class="muted">Giocatori ${uids.length}/${G.MAX_GIOCATORI} · carte in gioco ${uids.length + G.CARTE_EXTRA}</p>
      ${listaGiocatori()}
    </section>
    ${classificaStanza(r.classifica)}
    ${bottoneTelefoni()}
    ${sonoHost()
    ? `<button class="primary full" data-action="avvia" ${ok ? '' : 'disabled'}>Avvia partita</button>
       ${ok ? '' : `<p class="muted">Servono almeno ${G.MIN_GIOCATORI} giocatori.</p>`}`
    : `<p class="muted">In attesa che ${esc(r.players[r.hostUid]?.nome)} avvii la partita…</p>`}
    <p><button class="link" data-action="esci">Lascia la stanza</button></p>`;
}

function vistaPartita() {
  const r = S.room;
  if (!r.inGioco?.[S.user.uid]) {
    return `<h2>${esc(r.name)}</h2><section class="panel"><p>Partita in corso. Entrerai dalla prossima.</p></section>
      <p><button class="link" data-action="esci">Lascia la stanza</button></p>`;
  }
  const m = S.mano;
  const carta = !m
    ? '<div class="carta coperta">Distribuzione carte…</div>'
    : S.coperta
      ? '<div class="carta coperta" data-action="gira"><div>🂠</div><div>Tocca per vedere la tua carta</div></div>'
      : `<div class="carta scoperta ${m.squadra}" data-action="gira">
          <div class="ruolo">${pillola(m.ruolo, m.ruolo, 'grande')}</div>
          <div class="squadra">${m.squadra}</div>
          <div>${esc(m.info)}</div>
          <p class="muted" style="margin-top:16px">Tocca per coprire</p>
        </div>`;

  const uids = Object.keys(r.inGioco ?? {});
  const votanti = uids.filter((u) => r.voted?.[u]).length;
  const mancano = uids.filter((u) => !r.voted?.[u]).map((u) => esc(r.inGioco[u])).join(', ');
  const bottone = (u, testo) => `<button data-action="scegli" data-uid="${esc(u)}" class="${S.scelta === u ? 'scelto' : ''}">${testo}</button>`;
  const voto = S.mioVoto && !S.cambiando
    ? `<p>Hai votato <strong>${esc(nomeDi(S.mioVoto))}</strong>.</p>
      <button class="full" data-action="cambia-voto">✏️ Cambia voto</button>`
    : `<div class="voti">${uids.filter((u) => u !== S.user.uid).map((u) => bottone(u, esc(r.inGioco[u]))).join('')}</div>
      <div class="voti-cielo">${bottone(G.CIELO, `${G.EMOJI_CIELO} Cielo: nessun assassino`)}</div>
      <button class="primary full" data-action="conferma" ${S.scelta ? '' : 'disabled'}>
        ${S.scelta ? `Conferma voto: ${esc(nomeDi(S.scelta))}` : 'Scegli chi votare'}</button>
      ${S.cambiando ? '<button class="link" data-action="annulla-cambio">Lascia il voto com\'era</button>' : ''}`;
  const ultimi = votanti === uids.length ? '<p class="ok">Hanno votato tutti: pochi secondi per cambiare idea…</p>' : '';

  return `
    <div class="titolo-riga"><h2>${esc(r.name)} · round ${r.round}</h2>${bottoneMazzo()}</div>
    ${carta}
    <h2>Vota</h2>
    <section class="panel stack">
      ${voto}
      <p class="muted">Hanno votato ${votanti}/${uids.length}${mancano ? ` · mancano: ${mancano}` : ''}</p>
      ${ultimi}
    </section>
    ${classificaStanza(r.classifica, { aperta: false })}
    ${pannelloGiocatori()}
    ${bottoneTelefoni()}`;
}

function vistaRisultato() {
  const r = S.room;
  const res = r.result;
  if (!res) return '<p class="muted">Calcolo del risultato…</p>';
  return `
    <div class="titolo-riga"><h2>${esc(r.name)} · round ${r.round}</h2>${bottoneMazzo()}</div>
    ${tabellaRisultato(res, nomeDi)}
    ${classificaStanza(r.classifica)}
    ${sonoHost()
    ? '<button class="primary full" data-action="nuova">Nuova partita</button>'
    : '<p class="muted">In attesa che il capo stanza avvii una nuova partita…</p>'}
    ${pannelloGiocatori()}
    ${bottoneTelefoni()}
    <p><button class="link" data-action="esci">Lascia la stanza</button></p>`;
}

const conSegno = (n) => (n > 0 ? `+${n}` : `${n}`);

// Punti accumulati nella stanza da quando è stata aperta, aggiornati in diretta a ogni fine partita.
function classificaStanza(classifica, { aperta = true } = {}) {
  const righe = G.ordinaClassifica(classifica);
  const corpo = righe.length
    ? `<ol class="classifica">${righe.map((r) => `<li><span>${esc(r.nome)}</span><strong>${r.punti} <small>pt · ${r.vinte}/${r.partite} vinte</small></strong></li>`).join('')}</ol>`
    : '<p class="muted">Ancora nessuna partita finita in questa stanza.</p>';
  return `<details class="panel" ${aperta ? 'open' : ''}><summary>🏆 Classifica della stanza</summary>${corpo}</details>`;
}

// Banner, ruoli e voti di tutti, curiosità e scarti: uguale online e senza campo.
function tabellaRisultato(res, nomeDi) {
  // Una riga per giocatore: emoji del suo ruolo e nome → emoji e nome del giocatore votato (solo per i buoni).
  const chi = (uid) => (uid === G.CIELO ? `<span class="pill cielo">${G.EMOJI_CIELO} Cielo</span>` : pillola(res.ruoli?.[uid], nomeDi(uid)));
  const righe = Object.keys(res.ruoli ?? {}).map((u) => {
    const esito = res.dettaglio?.[u];
    const segno = esito === true ? '<span class="ok">✓</span>' : esito === false ? '<span class="ko">✗</span>' : '';
    const coppa = Object.values(res.vincitori ?? {}).includes(u) ? '🏆' : '';
    const buono = G.RUOLI[res.ruoli[u]] && G.squadraDi(res.ruoli[u]) === G.BUONI; // i voti dei cattivi non contano: non si mostrano
    return `<li class="voto-riga">
        <div class="voto-chi">${chi(u)}<small>${coppa} ${esc(res.ruoli[u])}${res.punti?.[u] ? ` · <strong>${conSegno(res.punti[u].totale)}</strong>` : ''}</small></div>
        ${buono ? `<span class="freccia">➜</span>
        <div class="voto-chi">${res.voti?.[u] ? chi(res.voti[u]) : '<span class="muted">nessun voto</span>'}</div>` : '<span></span><span></span>'}
        <span class="segno">${segno}</span></li>`;
  }).join('');
  return `
    <div class="banner ${res.vincitore}">${res.vincitore === G.PAREGGIO ? 'Pareggio: non vince nessuno' : `Vincono i ${res.vincitore}!`}</div>
    <p class="muted" style="text-align:center">Voti dei buoni: ${res.giusti} giusti, ${res.sbagliati} sbagliati${res.votiMitomane ? ` (di cui ${res.votiMitomane} al Mitomane)` : ''}</p>
    <section class="panel"><ul class="list">${righe}</ul></section>
    ${res.punti ? `<details class="panel"><summary>📊 Come sono arrivati i punti</summary><ul class="list">${Object.keys(res.ruoli ?? {}).map((u) => `<li><span>${esc(nomeDi(u))}</span>
      <span class="muted" style="text-align:right">${Object.values(res.punti[u]?.voci ?? {}).map((v) => `${esc(v.m)} ${conSegno(v.p)}`).join('<br>') || 'nessun punto'}</span></li>`).join('')}</ul></details>` : ''}
    ${Object.values(res.fatti ?? {}).length ? `<h2>💡 Lo sapevi?</h2><section class="panel"><ul class="fatti">${Object.values(res.fatti).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
    ${Object.values(res.ruoli ?? {}).some(G.isAssassino) ? '' : '<p class="muted" style="text-align:center">Non c\'erano assassini in gioco: il voto giusto era il cielo.</p>'}
    <p class="muted">Carte scartate: ${Object.values(res.scarti ?? {}).map((c) => pillola(c, c, 'piccola')).join(' ')}</p>`;
}

// Mazzo del round (o quello che uscirebbe col numero attuale di giocatori), raggruppato per ruolo.
function bottoneMazzo() {
  return '<button class="mazzo-btn" data-action="mazzo">🃏 Carte in gioco</button>';
}

function apriMazzo() {
  if (S.off) {
    const n = S.off.fase === 'setup' ? Object.keys(S.off.giocatori).length : S.off.ordine.length;
    return mostraMazzo(n, S.off.fase === 'setup' ? `Con ${n} giocatori il mazzo sarebbe` : `Mazzo di questa partita (${n} giocatori)`);
  }
  const r = S.room;
  const n = r.status === 'lobby' ? Object.keys(r.players ?? {}).length : (r.nGiocatori ?? Object.keys(r.inGioco ?? {}).length);
  mostraMazzo(n, r.status === 'lobby' ? `Con ${n} giocatori il mazzo sarebbe` : `Mazzo di questo round (${n} giocatori)`);
}

function mostraMazzo(n, titolo) {
  const mazzo = G.CONFIGURAZIONI[n];
  const conta = {};
  for (const c of mazzo ?? []) conta[c] = (conta[c] ?? 0) + 1;
  const righe = Object.entries(conta).map(([ruolo, k]) => `<li>
      ${pillola(ruolo)}
      <span class="${G.squadraDi(ruolo) === G.BUONI ? 'ok' : 'ko'}">${k > 1 ? `×${k} · ` : ''}${G.squadraDi(ruolo)}</span></li>`).join('');
  const $d = document.createElement('dialog');
  $d.className = 'mazzo';
  $d.innerHTML = mazzo
    ? `<h2>${titolo}</h2><ul class="list">${righe}</ul>
       <p class="muted">${mazzo.length} carte: una a testa e ${G.CARTE_EXTRA} scartate a caso, quindi qualche ruolo potrebbe non essere in gioco.</p>
       <button class="primary full" data-chiudi>Chiudi</button>`
    : `<p>Servono da ${G.MIN_GIOCATORI} a ${G.MAX_GIOCATORI} giocatori.</p><button class="full" data-chiudi>Chiudi</button>`;
  $d.addEventListener('click', (e) => { if (e.target === $d || e.target.closest('[data-chiudi]')) $d.close(); });
  $d.addEventListener('close', () => $d.remove());
  document.body.append($d);
  $d.showModal();
}

// Animazione a schermo intero sulla squadra vincente, una volta per round.
function festeggia(chiave, result, sotto) {
  if (festeggia.fatto === chiave) return;
  festeggia.fatto = chiave;
  const { vincitore } = result;
  const testi = {
    [G.BUONI]: ['Vincono i buoni!', '⚖️'],
    [G.CATTIVI]: ['Vincono i cattivi!', '🔪'],
    [G.PAREGGIO]: ['Pareggio!', '🤝'],
  };
  const [testo, emoji] = testi[vincitore] ?? ['Fine partita', '🎲'];
  const $festa = document.createElement('div');
  $festa.className = `festa ${vincitore}`;
  const pioggia = Array.from({ length: 24 }, () =>
    `<span class="goccia" style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.8).toFixed(2)}s">${emoji}</span>`).join('');
  $festa.innerHTML = `${pioggia}<div class="festa-testo"><div class="festa-emoji">${emoji}</div>${testo}<small>${sotto}</small></div>`;
  $festa.addEventListener('click', () => $festa.remove());
  $festa.addEventListener('animationend', (e) => { if (e.target === $festa) $festa.remove(); });
  document.body.append($festa);
}

// ---------- senza campo: un solo telefono che passa di mano ----------
// Niente rete: il telefono mescola, ognuno guarda la sua carta e vota di nascosto, poi il risultato.
// Le partite finite restano in coda sul telefono e vanno nel database appena torna internet.

const bottoneOffline = () => `<button class="full" data-action="rete-apri">📡 Senza internet, ognuno col suo telefono</button>
  <button class="full" data-action="off-apri">📴 Senza internet, un solo telefono</button>`;
const nomiVincitori = (res, nome) => (res.vincitore === G.PAREGGIO ? 'Non vince nessuno'
  : Object.values(res.vincitori ?? {}).map((u) => esc(nome(u))).join(', ') || 'Nessuno a cui dare i punti');

function salvaOff() { O.salvaPartita(S.off); render(); }

function apriOffline() {
  const giocatori = {};
  const ospiti = {};
  for (const g of O.ultimi()) { giocatori[g.id] = g.nome; if (g.ospite) ospiti[g.id] = true; }
  if (S.user && !giocatori[S.user.uid] && Object.keys(giocatori).length < G.MAX_GIOCATORI) {
    giocatori[S.user.uid] = S.nome;
    if (S.user.isAnonymous) ospiti[S.user.uid] = true;
  }
  S.off = { fase: 'setup', giocatori, ospiti };
  salvaOff();
}

function chiudiOffline() {
  if (!['setup', 'fine'].includes(S.off.fase) && !confirm('Interrompere la partita senza campo? Non verrà salvata.')) return;
  S.off = null;
  O.salvaPartita(null);
  render();
}

function aggiungiOff(id, nome) {
  const o = S.off;
  if (Object.keys(o.giocatori).length >= G.MAX_GIOCATORI) return toast(`Massimo ${G.MAX_GIOCATORI} giocatori.`);
  nome = nome.trim().slice(0, 20);
  if (!nome) return;
  if (Object.values(o.giocatori).some((n) => n.toLowerCase() === nome.toLowerCase())) return toast(`C'è già un giocatore di nome ${nome}.`);
  if (!id) { id = O.nuovoId('ospite'); o.ospiti[id] = true; } // nome nuovo: ospite, fuori classifica
  o.giocatori[id] = nome;
  salvaOff();
}

function togliOff(id) {
  delete S.off.giocatori[id];
  delete S.off.ospiti[id];
  salvaOff();
}

function distribuisciOff() {
  const o = S.off;
  const ordine = G.mescola(Object.keys(o.giocatori)); // anche l'ordine di passaggio è casuale
  if (!G.puoIniziare(ordine.length)) return toast(`Servono da ${G.MIN_GIOCATORI} a ${G.MAX_GIOCATORI} giocatori.`);
  O.salvaUltimi(ordine.map((id) => ({ id, nome: o.giocatori[id], ospite: !!o.ospiti[id] })));
  const { assegnazioni, scarti } = G.distribuisci(ordine);
  Object.assign(o, {
    id: O.nuovoId('offline'), fase: 'carte', ordine, assegnazioni, scarti,
    mani: G.informazioni(assegnazioni, scarti, o.giocatori),
    indice: 0, mostra: false, voti: {}, cambi: {}, tempi: {}, scelta: null, cambiOra: 0,
    iniziatoIl: Date.now(), result: null, sincronizzata: false,
  });
  salvaOff();
}

// "Sono X": il giocatore di turno ha il telefono in mano.
function eccomiOff() {
  const o = S.off;
  Object.assign(o, { mostra: true, sceltaOra: Date.now() });
  const chi = o.ordine?.[o.indice];
  if (o.fase === 'voto' && o.voti[chi]) Object.assign(o, { scelta: o.voti[chi], cambiOra: o.cambi[chi] ?? 0 }); // sta cambiando voto
  salvaOff();
}

function passaOff() {
  const o = S.off;
  o.mostra = false;
  if (o.indice < o.ordine.length - 1) o.indice++;
  else Object.assign(o, { fase: 'discussione', indice: 0 });
  salvaOff();
}

function sbirciaOff(id) {
  Object.assign(S.off, { fase: 'sbircia', chi: id, mostra: false });
  salvaOff();
}

function scegliOff(bersaglio) {
  const o = S.off;
  if (o.scelta === bersaglio) return;
  if (o.scelta) o.cambiOra++;
  o.scelta = bersaglio;
  salvaOff();
}

function votaOff() {
  const o = S.off;
  const chi = o.ordine[o.indice];
  if (!o.scelta) return;
  o.voti[chi] = o.scelta;
  o.cambi[chi] = o.cambiOra;
  o.tempi[chi] = Date.now() - o.sceltaOra; // tempo passato col telefono in mano prima di confermare
  Object.assign(o, { scelta: null, cambiOra: 0, mostra: false });
  // dopo l'ultimo voto (o dopo un voto cambiato) si va alla schermata "hanno votato tutti"
  o.indice = o.ritorno || o.indice >= o.ordine.length - 1 ? o.ordine.length : o.indice + 1;
  o.ritorno = false;
  salvaOff();
}

// Dalla schermata finale: il telefono torna a chi vuole cambiare il voto già dato.
function ricambiaOff(uid) {
  Object.assign(S.off, { indice: S.off.ordine.indexOf(uid), ritorno: true, mostra: false });
  salvaOff();
}

function concludiOff() {
  const o = S.off;
  const esito = G.esitoVoto(o.assegnazioni, o.voti);
  const ospiti = Object.fromEntries(o.ordine.filter((u) => o.ospiti[u]).map((u) => [u, true]));
  const partita = {
    roomId: 'offline', round: 1, offline: true,
    ...esito, ruoli: o.assegnazioni, scarti: o.scarti, voti: o.voti, cambi: o.cambi, tempi: o.tempi, ospiti,
    giocatori: Object.fromEntries(o.ordine.map((u) => [u, o.giocatori[u]])), finitaIl: Date.now(),
  };
  partita.punti = G.punteggi(o.assegnazioni, o.voti, esito);
  o.classifica = G.aggiungiAllaClassifica(o.classifica, partita);
  o.result = { ...partita, fatti: G.curiosita(partita, O.storico()) };
  o.fase = 'fine';
  O.accoda(o.id, partita);
  salvaOff();
  sincronizza();
}

function vistaOffline() {
  const o = S.off;
  const nome = (u) => (u === G.CIELO ? `${G.EMOJI_CIELO} Cielo` : o.giocatori[u] ?? '???');
  const testa = (titolo) => `<div class="titolo-riga"><h2>${titolo}</h2>${bottoneMazzo()}</div>`;
  const esci = `<p><button class="link" data-action="off-chiudi">${o.fase === 'fine' || o.fase === 'setup' ? 'Torna alla home' : 'Interrompi la partita'}</button></p>`;
  const carta = (u) => {
    const m = o.mani[u];
    return `<div class="carta scoperta ${m.squadra}">
        <div class="ruolo">${pillola(m.ruolo, m.ruolo, 'grande')}</div>
        <div class="squadra">${m.squadra}</div>
        <div>${esc(m.info)}</div>
      </div>`;
  };
  const passa = (u, azione, testo) => `
    <section class="panel passa">
      <p class="muted">Passa il telefono a</p>
      <p class="passa-nome">${esc(nome(u))}</p>
      <p class="muted">Gli altri non guardano!</p>
    </section>
    <button class="primary full" data-action="${azione}">Sono ${esc(nome(u))}: ${testo}</button>`;

  if (o.fase === 'setup') {
    const dentro = Object.keys(o.giocatori);
    const n = dentro.length;
    const conosciuti = Object.entries({ ...O.amici(), ...Object.fromEntries(O.ultimi().map((g) => [g.id, g.nome])) })
      .filter(([id, nm]) => !o.giocatori[id] && !dentro.some((d) => o.giocatori[d].toLowerCase() === String(nm).toLowerCase()))
      .sort((a, b) => a[1].localeCompare(b[1]));
    return `
      ${testa('📴 Partita senza campo')}
      <p class="muted">Un solo telefono: passa di mano per guardare le carte e per votare. Non serve internet.</p>
      <section class="panel">
        <p class="muted">Giocatori ${n}/${G.MAX_GIOCATORI} · carte in gioco ${n + G.CARTE_EXTRA}</p>
        ${n ? `<ul class="list">${dentro.map((u) => `<li><span>${esc(o.giocatori[u])}${o.ospiti[u] ? ' <span class="tag">ospite</span>' : ''}</span>
          <button class="link" data-action="off-togli" data-uid="${esc(u)}">togli</button></li>`).join('')}</ul>` : '<p class="muted">Aggiungi i giocatori.</p>'}
      </section>
      ${conosciuti.length ? `<h2>Amici già visti</h2><section class="panel chips">${conosciuti.map(([id, nm]) =>
        `<button data-action="off-aggiungi" data-uid="${esc(id)}" data-nome="${esc(nm)}">+ ${esc(nm)}</button>`).join('')}</section>` : ''}
      <form data-form="off-nuovo" class="panel row"><input name="nome" placeholder="Nuovo giocatore" maxlength="20" required><button>Aggiungi</button></form>
      <p class="muted">Gli amici già visti online finiscono in classifica quando la partita viene caricata; i nomi nuovi contano come ospiti.</p>
      <button class="primary full" data-action="off-via" ${G.puoIniziare(n) ? '' : 'disabled'}>Distribuisci le carte</button>
      ${esci}`;
  }

  if (o.fase === 'carte') {
    const u = o.ordine[o.indice];
    const ultimo = o.indice === o.ordine.length - 1;
    return `
      ${testa(`Carte · ${o.indice + 1}/${o.ordine.length}`)}
      ${o.mostra
    ? `${carta(u)}<button class="primary full" data-action="off-passa">${ultimo ? 'Fatto: copri e inizia la discussione' : `Fatto: copri e passa a ${esc(nome(o.ordine[o.indice + 1]))}`}</button>`
    : passa(u, 'off-eccomi', 'mostra la mia carta')}
      ${esci}`;
  }

  if (o.fase === 'sbircia') {
    return `
      ${testa('Rivedi la carta')}
      ${o.mostra ? `${carta(o.chi)}<button class="primary full" data-action="off-discuti">Fatto: copri</button>`
    : `${passa(o.chi, 'off-eccomi', 'mostra la mia carta')}<button class="full" data-action="off-discuti">Annulla</button>`}`;
  }

  if (o.fase === 'discussione') {
    return `
      ${testa('🗣️ Discussione')}
      <section class="panel stack">
        <p>Tutti hanno visto la propria carta. Discutete, accusate, bluffate: quando siete pronti si vota, sempre passando il telefono.</p>
        <p class="muted">Primo a votare: <strong>${esc(nome(o.ordine[0]))}</strong>.</p>
      </section>
      <button class="primary full" data-action="off-vota">Inizia il voto</button>
      <h2>Qualcuno ha dimenticato la carta?</h2>
      <section class="panel chips">${o.ordine.map((u) => `<button data-action="off-sbircia" data-uid="${esc(u)}">👁 ${esc(nome(u))}</button>`).join('')}</section>
      ${esci}`;
  }

  if (o.fase === 'voto') {
    const u = o.ordine[o.indice];
    if (o.indice >= o.ordine.length) {
      return `${testa('🗳️ Hanno votato tutti')}
        <button class="primary full" data-action="off-risultato">Mostra il risultato</button>
        <h2>Qualcuno vuole cambiare voto?</h2>
        <section class="panel chips">${o.ordine.map((x) => `<button data-action="off-ricambia" data-uid="${esc(x)}">✏️ ${esc(nome(x))}</button>`).join('')}</section>
        ${esci}`;
    }
    if (!o.mostra) return `${testa(`Voto · ${o.indice + 1}/${o.ordine.length}`)}${passa(u, 'off-eccomi', 'voglio votare')}${esci}`;
    const bottone = (b, testo) => `<button data-action="off-scegli" data-uid="${esc(b)}" class="${o.scelta === b ? 'scelto' : ''}">${testo}</button>`;
    return `
      ${testa(`Vota, ${esc(nome(u))}`)}
      <section class="panel stack">
        <div class="voti">${o.ordine.filter((b) => b !== u).map((b) => bottone(b, esc(nome(b)))).join('')}</div>
        <div class="voti-cielo">${bottone(G.CIELO, `${G.EMOJI_CIELO} Cielo: nessun assassino`)}</div>
        <button class="primary full" data-action="off-conferma" ${o.scelta ? '' : 'disabled'}>
          ${o.scelta ? `Conferma voto: ${esc(nome(o.scelta))}` : 'Scegli chi votare'}</button>
      </section>
      <p class="muted">Dopo la conferma lo schermo si copre. Prima del risultato potrai ancora cambiare voto.</p>`;
  }

  // fine
  const caricata = !O.coda()[o.id];
  return `
    ${testa('📴 Fine partita')}
    ${tabellaRisultato(o.result, nome)}
    ${classificaStanza(o.classifica)}
    <p class="muted">${caricata ? '✅ Partita caricata online: conta per classifiche e curiosità.'
    : '💾 Partita salvata sul telefono: verrà caricata online appena torna internet (con il login fatto).'}</p>
    <button class="primary full" data-action="off-via">Nuova partita, stessi giocatori</button>
    <button class="full" data-action="off-setup">Cambia giocatori</button>
    ${esci}`;
}

// Carica nel database le partite finite senza campo. Parte all'avvio, al ritorno della rete e a fine partita.
async function sincronizza() {
  const coda = Object.entries(O.coda());
  if (sincronizza.attiva || !S.user || S.user.locale || !navigator.onLine || !coda.length) return;
  sincronizza.attiva = true;
  let fatte = 0;
  try {
    for (const [id, partita] of coda) {
      try {
        await set(ref(dbFirebase, `games/${id}`), { ...partita, hostUid: S.user.uid });
      } catch (e) {
        // già caricata da un tentativo precedente (le regole permettono una sola scrittura)? allora è a posto
        if (!(await get(ref(dbFirebase, `games/${id}`)).catch(() => null))?.exists()) { console.warn('sincronizzazione', id, e); continue; }
      }
      O.togliDallaCoda(id);
      fatte++;
    }
  } finally {
    sincronizza.attiva = false;
  }
  if (fatte) {
    toast(fatte === 1 ? 'Caricata online la partita giocata senza campo ✅' : `Caricate online ${fatte} partite giocate senza campo ✅`);
    render();
  }
}

window.addEventListener('online', () => { sincronizza(); render(); });
window.addEventListener('offline', () => render());

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}

// ---------- senza internet, ognuno col suo telefono ----------
// Hotspot (o Wi-Fi senza connessione) + WebRTC: il telefono del capo tiene la stanza (rete.js)
// e gli altri si collegano inquadrando due QR. Le schermate di gioco sono le stesse dell'online.

// Chi non ha mai fatto il login usa un'identità locale, fissa su questo telefono.
function identitaLocale() {
  if (S.user) return;
  let id = localStorage.getItem('lupussino.idLocale');
  if (!id) { id = O.nuovoId('locale'); localStorage.setItem('lupussino.idLocale', id); }
  S.user = { uid: id, isAnonymous: true, locale: true };
}

function preparaNome(nome) {
  nome = String(nome ?? '').trim().slice(0, 20);
  if (!nome) throw new Error('Scrivi il tuo nome.');
  S.nome = nome;
  localStorage.setItem('lupussino.nome', nome);
  identitaLocale();
}

function vistaRete() {
  const salvata = Capo.salvato();
  return `
    <div class="titolo-riga"><h2>📡 Senza internet</h2><button class="mazzo-btn" data-action="rete-indietro">← Indietro</button></div>
    <section class="panel stack">
      <p>1. Un telefono accende l'<strong>hotspot</strong> (servono zero giga) e gli altri si collegano a quella rete Wi-Fi.</p>
      <p>2. Uno crea la stanza e fa da capo: la partita vive sul suo telefono.</p>
      <p>3. Gli altri premono "Mi unisco" e si scambiano due QR col capo.</p>
    </section>
    <form data-form="rete" class="panel stack">
      <label class="muted" for="nome-rete">Il tuo nome</label>
      <input id="nome-rete" name="nome" value="${esc(S.nome)}" maxlength="20" required>
      <button class="primary full" name="come" value="capo">👑 Creo la stanza</button>
      <button class="full" name="come" value="ospite">📷 Mi unisco</button>
    </form>
    ${salvata?.roomId ? '<button class="full" data-action="rete-riprendi">↩️ Riprendi la stanza senza internet di prima</button>' : ''}
    <p class="muted">Su iPhone, se il collegamento non parte: Impostazioni → Privacy → Rete locale, e attiva il browser.</p>`;
}

function bottoneTelefoni() {
  if (!S.rete?.capo) return '';
  const n = S.rete.capo.collegati().length;
  return `<button class="full" data-action="rete-aggiungi">📷 Aggiungi o ricollega un telefono <span class="tag">${n} collegati</span></button>`;
}

function avvisoRete() {
  if (S.rete?.ospite?.connesso === false) {
    return `<section class="panel stack"><p class="ko">Collegamento col capo perso.</p>
      <button class="primary full" data-action="rete-ricollega">📷 Ricollegati al capo</button></section>`;
  }
  return '';
}

async function schermoAcceso() {
  try { S.rete.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* non supportato */ }
}

function chiudiRete() {
  const r = S.rete;
  S.rete = null;
  r.capo?.chiudi();
  r.ospite?.chiudi();
  r.wakeLock?.release?.().catch?.(() => {});
  chiudiDialogo();
  db = dbFirebase;
  if (S.user?.locale) S.user = auth.currentUser;
}

async function creaStanzaRete() {
  const capo = new Capo({ uid: S.user.uid });
  S.rete = { capo };
  db = capo;
  capo.alCambio = () => { const $b = document.querySelector('[data-action="rete-aggiungi"] .tag'); if ($b) $b.textContent = `${capo.collegati().length} collegati`; };
  schermoAcceso();
  await creaStanza(`Stanza di ${S.nome}`);
  capo.roomId = S.roomId;
  capo.salva();
}

async function riprendiCapo() {
  const salvata = Capo.salvato();
  identitaLocale();
  if (salvata.albero.rooms?.[salvata.roomId]?.hostUid !== S.user.uid) { Capo.dimentica(); throw new Error('Quella stanza era di un altro account.'); }
  const capo = new Capo({ uid: S.user.uid, albero: salvata.albero, roomId: salvata.roomId });
  S.rete = { capo };
  db = capo;
  capo.alCambio = () => render();
  schermoAcceso();
  // nessuno è ancora collegato: tutti offline finché non rientrano col QR
  const offline = {};
  for (const uid of Object.keys(salvata.albero.rooms[salvata.roomId].players ?? {})) if (uid !== S.user.uid) offline[`rooms/${salvata.roomId}/players/${uid}/online`] = false;
  await update(ref(db), offline);
  osservaStanza(salvata.roomId);
}

// Finestra sopra il gioco per QR e fotocamera: i render del gioco non la toccano.
function dialogo(html) {
  dialogo.scanner?.ferma();
  let $d = document.querySelector('dialog.rete');
  if (!$d) {
    $d = document.createElement('dialog');
    $d.className = 'mazzo rete';
    $d.addEventListener('close', () => { dialogo.scanner?.ferma(); $d.remove(); });
    document.body.append($d);
    $d.showModal();
  }
  $d.innerHTML = `${html}<button class="full" data-action="rete-annulla" style="margin-top:8px">Annulla</button>`;
  return $d;
}
function chiudiDialogo() { document.querySelector('dialog.rete')?.close(); }

const mostraQr = (testo, codice) => `<p>${testo}</p><div class="qr">${P.qrSvg(codice)}</div>
  <details><summary class="muted">Codice da copiare</summary><code class="codice">${esc(codice)}</code></details>`;

// Legge un QR con la fotocamera (o un codice incollato, per chi non ha fotocamera).
function inquadra(testo) {
  dialogo(`<p>${testo}</p><video class="cam" playsinline muted></video>
    <details><summary class="muted">Non funziona la fotocamera? Incolla il codice</summary>
    <form data-form="rete-codice"><textarea name="codice" rows="3"></textarea><button class="full">Usa il codice</button></form></details>`);
  return new Promise((ok, no) => {
    dialogo.codice = ok;
    dialogo.scanner = P.leggiQr(document.querySelector('dialog.rete video'));
    dialogo.scanner.letto.then((c) => c && ok(c), (e) => { console.warn(e); toast('Fotocamera non disponibile: incolla il codice.'); });
    document.querySelector('dialog.rete').addEventListener('close', () => no(new Error('annullato')), { once: true });
  });
}

const aperto = (canale, ms = 15000) => new Promise((ok, no) => {
  if (canale.readyState === 'open') return ok();
  const t = setTimeout(() => no(new Error('Collegamento non riuscito. Siete sulla stessa rete Wi-Fi o hotspot?')), ms);
  canale.addEventListener('open', () => { clearTimeout(t); ok(); }, { once: true });
});

// Capo: inquadra il QR del nuovo telefono, mostra il proprio, e il canale passa a rete.js.
async function aggiungiTelefono() {
  try {
    const offerta = await inquadra('Inquadra il QR sul telefono di chi entra.');
    dialogo('<p class="muted">Preparo la risposta…</p>');
    const r = await P.rispondi(offerta);
    dialogo(mostraQr('Ora fai inquadrare questo QR all\'altro telefono.', r.codice));
    const canale = await r.canale;
    S.rete?.capo?.collega(canale);
    await aperto(canale);
    chiudiDialogo();
    toast('Telefono collegato ✅');
  } catch (e) {
    if (e.message !== 'annullato') { chiudiDialogo(); toast(e.message); }
  }
}

// Ospite: mostra il proprio QR, inquadra quello del capo, poi entra nella stanza come online.
async function uniscitiRete() {
  if (!S.rete) S.rete = {};
  schermoAcceso();
  try {
    dialogo('<p class="muted">Preparo il QR…</p>');
    // con la fotocamera autorizzata alcuni browser usano l'indirizzo vero, che collega meglio
    try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop()); } catch { /* pazienza */ }
    const o = await P.creaOfferta();
    dialogo(`${mostraQr('1. Fai inquadrare questo QR al capo.', o.codice)}
      <button class="primary full" data-action="rete-leggi-capo">2. Fatto: inquadra il QR del capo</button>`);
    await new Promise((ok, no) => {
      dialogo.avanti = ok;
      document.querySelector('dialog.rete').addEventListener('close', () => no(new Error('annullato')), { once: true });
    });
    const risposta = await inquadra('Inquadra il QR sul telefono del capo.');
    dialogo('<p class="muted">Mi collego…</p>');
    await o.accettaRisposta(risposta);
    await aperto(o.canale);
    if (!S.rete) return o.canale.close();
    S.rete.ospite?.chiudi();
    const ospite = new Ospite(o.canale, S.user.uid);
    S.rete.ospite = ospite;
    db = ospite;
    ospite.alChiusura = () => { if (S.rete?.ospite === ospite) render(); };
    const { roomId } = await ospite.benvenuto;
    chiudiDialogo();
    await entraInStanza(roomId);
    render();
  } catch (e) {
    if (e.message !== 'annullato') { chiudiDialogo(); toast(e.message); }
    if (!S.rete?.ospite) { S.rete = null; render(); }
  }
}

// ---------- eventi ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, uid, nome } = el.dataset;
  const azioni = {
    login: () => tenta(login),
    ospite: () => tenta(() => signInAnonymously(auth)),
    logout: () => tenta(() => signOut(auth)),
    entra: () => tenta(() => entraInStanza(id)),
    esci: () => tenta(esciDallaStanza),
    rimuovi: () => tenta(() => rimuoviGiocatore(uid)),
    avvia: () => tenta(avviaPartita),
    gira: () => { S.coperta = !S.coperta; render(); },
    mazzo: apriMazzo,
    scegli: () => scegli(uid),
    conferma: () => tenta(confermaVoto),
    'cambia-voto': cambiaVoto,
    'annulla-cambio': () => { S.cambiando = false; S.scelta = null; render(); },
    classifica: () => tenta(apriClassifica),
    indietro: () => { S.vista = null; render(); },
    nuova: () => tenta(nuovaPartita),
    'off-apri': apriOffline,
    'rete-apri': () => { S.vista = 'rete'; render(); },
    'rete-indietro': () => { S.vista = null; if (S.rete && !S.room) chiudiRete(); render(); },
    'rete-riprendi': () => { S.vista = null; tenta(riprendiCapo); },
    'rete-aggiungi': aggiungiTelefono,
    'rete-ricollega': uniscitiRete,
    'rete-leggi-capo': () => dialogo.avanti?.(),
    'rete-annulla': chiudiDialogo,
    'off-chiudi': chiudiOffline,
    'off-aggiungi': () => aggiungiOff(uid, nome),
    'off-togli': () => togliOff(uid),
    'off-via': distribuisciOff,
    'off-setup': () => { S.off = { fase: 'setup', giocatori: S.off.giocatori, ospiti: S.off.ospiti }; salvaOff(); },
    'off-eccomi': eccomiOff,
    'off-passa': passaOff,
    'off-sbircia': () => sbirciaOff(uid),
    'off-discuti': () => { Object.assign(S.off, { fase: 'discussione', mostra: false }); salvaOff(); },
    'off-vota': () => { Object.assign(S.off, { fase: 'voto', indice: 0, mostra: false }); salvaOff(); },
    'off-scegli': () => scegliOff(uid),
    'off-conferma': votaOff,
    'off-ricambia': () => ricambiaOff(uid),
    'off-risultato': concludiOff,
  };
  azioni[action]?.();
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const valore = new FormData(form).get('nome') ?? '';
  if (form.dataset.form === 'nome') tenta(() => salvaNome(valore));
  if (form.dataset.form === 'crea') tenta(() => creaStanza(valore));
  if (form.dataset.form === 'off-nuovo') aggiungiOff(null, valore);
  if (form.dataset.form === 'rete-codice') dialogo.codice?.(String(new FormData(form).get('codice') ?? '').trim());
  if (form.dataset.form === 'rete') {
    const come = e.submitter?.value ?? 'ospite';
    tenta(async () => {
      preparaNome(valore);
      S.vista = null;
      if (come === 'capo') await creaStanzaRete();
      else await uniscitiRete();
    });
  }
});

// Se il telefono va in background o si cambia app, la carta si ricopre da sola.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !S.coperta) { S.coperta = true; render(); }
  if (document.hidden && S.off?.mostra) { S.off.mostra = false; salvaOff(); }
  if (!document.hidden && S.rete) schermoAcceso(); // il blocco schermo acceso si perde quando cambi app
});
