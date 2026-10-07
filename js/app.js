import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInAnonymously, signOut,
  onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect, runTransaction,
  query, orderByChild, limitToLast, serverTimestamp, connectDatabaseEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import * as G from './game.js';
import * as O from './offline.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Sviluppo locale: apri la pagina con ?emulatori per usare gli emulatori Firebase invece del progetto vero.
if (new URLSearchParams(location.search).has('emulatori')) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, location.hostname, 9000);
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
  off: O.partitaSalvata(), // partita senza campo in corso (un solo telefono), sopravvive ai ricaricamenti
};
let unsubStanze = null;
let unsubRoom = null;
let unsubConnessione = null;
let offsetServer = 0; // differenza tra l'orologio del server e quello del telefono
onValue(ref(db, '.info/serverTimeOffset'), (snap) => { offsetServer = snap.val() ?? 0; });

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
const stileRuolo = (ruolo) => (G.COLORI[ruolo] ? `--bg:${G.COLORI[ruolo].bg};--fg:${G.COLORI[ruolo].fg}` : '');
const nomeDi = (uid) => (uid === G.CIELO ? '☁️ Cielo' : S.room?.inGioco?.[uid] ?? S.room?.players?.[uid]?.nome ?? 'giocatore uscito');

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
  S.user = user;
  if (!user) {
    unsubStanze?.(); unsubRoom?.(); unsubConnessione?.();
    Object.assign(S, { stanze: [], roomId: null, room: null, mano: null, manoRound: null });
    return render();
  }
  S.nome = localStorage.getItem('lupussino.nome') || user.displayName || `Ospite ${user.uid.slice(0, 4)}`;
  render(); // senza campo le operazioni sotto restano in attesa: intanto la pagina deve funzionare
  tenta(() => update(ref(db, `users/${user.uid}`), { nome: S.nome, ultimoAccesso: serverTimestamp() }));
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
  await update(ref(db, `users/${S.user.uid}`), { nome });
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
    if (S.room.status === 'playing' && sonoHost() && tuttiHannoVotato()) calcolaRisultato();
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
  render();
}

async function esciDallaStanza() {
  const { room } = S;
  const uid = S.user.uid;
  if (room.status === 'playing' && room.inGioco?.[uid]) {
    if (!confirm('La partita è in corso: se esci gli altri non potranno finire il voto. Uscire comunque?')) return;
    return lasciaLocalmente(); // resti tra i giocatori del round: potrai rientrare dalla stessa pagina
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
}

// Se il capo stanza risulta offline da più di MARGINE_CAPO_MS, il primo giocatore online
// (in ordine fisso, uguale per tutti) diventa capo stanza. La transazione evita doppioni.
async function controllaCapo() {
  clearTimeout(controllaCapo.timer);
  const r = S.room;
  if (!r || !S.user || sonoHost()) return;
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
  const [mano, voto] = await Promise.all([
    get(ref(db, `hands/${S.roomId}/${round}/${S.user.uid}`)),
    get(ref(db, `votes/${S.roomId}/${round}/${S.user.uid}`)),
  ]);
  if (S.manoRound !== round) return;
  S.mano = mano.val();
  S.mioVoto = voto.val()?.bersaglio ?? null;
  render();
}

// Il voto è in due tempi: tocchi un nome per sceglierlo (puoi cambiare idea), poi confermi.
function scegli(bersaglio) {
  if (S.mioVoto || S.scelta === bersaglio) return;
  if (S.scelta) S.cambi++;
  S.scelta = bersaglio;
  render();
}

async function confermaVoto() {
  const bersaglio = S.scelta;
  if (S.mioVoto || !bersaglio) return;
  await update(ref(db), {
    [`votes/${S.roomId}/${S.room.round}/${S.user.uid}`]: { bersaglio, cambi: S.cambi, at: serverTimestamp() },
    [`${roomPath()}/voted/${S.user.uid}`]: true,
  });
  S.mioVoto = bersaglio;
  render();
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
    const partita = {
      ...esito, ruoli, scarti: mazzo.scarti, voti, cambi, tempi, ospiti, giocatori: S.room.inGioco, finitaIl: Date.now(),
    };
    const storico = await leggiPartite().catch(() => []);
    const result = { ...partita, fatti: G.curiosita(partita, storico) };

    await update(ref(db), {
      [`${roomPath()}/status`]: 'ended',
      [`${roomPath()}/result`]: result,
      [`games/${S.roomId}_${round}`]: { roomId: S.roomId, round, hostUid: S.user.uid, ...partita, finitaIl: serverTimestamp() },
    });
  } catch (e) {
    console.error(e); toast(e.message);
  } finally {
    S.calcolando = false;
  }
}

// Storico partite (base di classifiche e curiosità). Con pochi amici restano poche migliaia di righe.
async function leggiPartite() {
  const snap = await get(query(ref(db, 'games'), orderByChild('finitaIl'), limitToLast(2000)));
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
  $utente.innerHTML = S.user
    ? `<span>${esc(S.nome)}</span><button class="link" data-action="logout">Esci</button>`
    : '';
  if (!S.user) return ($app.innerHTML = vistaLogin());
  if (!S.room && S.vista === 'classifica') return ($app.innerHTML = vistaClassifica());
  if (!S.room) return ($app.innerHTML = vistaHome());
  const viste = { lobby: vistaLobby, playing: vistaPartita, ended: vistaRisultato };
  $app.innerHTML = viste[S.room.status]?.() ?? '';
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
          <div class="ruolo pill grande" style="${stileRuolo(m.ruolo)}">${esc(m.ruolo)}</div>
          <div class="squadra">${m.squadra}</div>
          <div>${esc(m.info)}</div>
          <p class="muted" style="margin-top:16px">Tocca per coprire</p>
        </div>`;

  const uids = Object.keys(r.inGioco ?? {});
  const votanti = uids.filter((u) => r.voted?.[u]).length;
  const mancano = uids.filter((u) => !r.voted?.[u]).map((u) => esc(r.inGioco[u])).join(', ');
  const bottone = (u, testo) => `<button data-action="scegli" data-uid="${esc(u)}" class="${S.scelta === u ? 'scelto' : ''}">${testo}</button>`;
  const voto = S.mioVoto
    ? `<p>Hai votato <strong>${esc(nomeDi(S.mioVoto))}</strong>.</p>`
    : `<div class="voti">
        ${uids.filter((u) => u !== S.user.uid).map((u) => bottone(u, esc(r.inGioco[u]))).join('')}
        ${bottone(G.CIELO, '☁️ Cielo')}
      </div>
      <button class="primary full" data-action="conferma" ${S.scelta ? '' : 'disabled'}>
        ${S.scelta ? `Conferma voto: ${esc(nomeDi(S.scelta))}` : 'Scegli chi votare'}</button>`;

  return `
    <div class="titolo-riga"><h2>${esc(r.name)} · round ${r.round}</h2>${bottoneMazzo()}</div>
    ${carta}
    <h2>Vota</h2>
    <section class="panel stack">
      ${voto}
      <p class="muted">Hanno votato ${votanti}/${uids.length}${mancano ? ` · mancano: ${mancano}` : ''}</p>
    </section>
    ${pannelloGiocatori()}`;
}

function vistaRisultato() {
  const r = S.room;
  const res = r.result;
  if (!res) return '<p class="muted">Calcolo del risultato…</p>';
  return `
    <div class="titolo-riga"><h2>${esc(r.name)} · round ${r.round}</h2>${bottoneMazzo()}</div>
    ${tabellaRisultato(res, nomeDi)}
    ${sonoHost()
    ? '<button class="primary full" data-action="nuova">Nuova partita</button>'
    : '<p class="muted">In attesa che il capo stanza avvii una nuova partita…</p>'}
    ${pannelloGiocatori()}
    <p><button class="link" data-action="esci">Lascia la stanza</button></p>`;
}

// Banner, ruoli e voti di tutti, curiosità e scarti: uguale online e senza campo.
function tabellaRisultato(res, nomeDi) {
  // Una riga per giocatore: pillola col colore del suo ruolo → pillola del giocatore votato.
  const pillola = (uid) => {
    if (uid === G.CIELO) return '<span class="pill cielo">☁️ Cielo</span>';
    const ruolo = res.ruoli?.[uid];
    return `<span class="pill" style="${stileRuolo(ruolo)}">${esc(nomeDi(uid))}</span>`;
  };
  const righe = Object.keys(res.ruoli ?? {}).map((u) => {
    const esito = res.dettaglio?.[u];
    const segno = esito === true ? '<span class="ok">✓</span>' : esito === false ? '<span class="ko">✗</span>' : '';
    const coppa = Object.values(res.vincitori ?? {}).includes(u) ? '🏆' : '';
    return `<li class="voto-riga">
        <div class="voto-chi">${pillola(u)}<small>${coppa} ${esc(res.ruoli[u])}</small></div>
        <span class="freccia">➜</span>
        <div class="voto-chi">${res.voti?.[u] ? pillola(res.voti[u]) : '<span class="muted">nessun voto</span>'}</div>
        <span class="segno">${segno}</span></li>`;
  }).join('');
  return `
    <div class="banner ${res.vincitore}">${res.vincitore === G.PAREGGIO ? 'Pareggio: non vince nessuno' : `Vincono i ${res.vincitore}!`}</div>
    <p class="muted" style="text-align:center">Voti dei buoni: ${res.giusti} giusti, ${res.sbagliati} sbagliati${res.votiMitomane ? ` (di cui ${res.votiMitomane} al Mitomane)` : ''}</p>
    <section class="panel"><ul class="list">${righe}</ul></section>
    ${Object.values(res.fatti ?? {}).length ? `<h2>💡 Lo sapevi?</h2><section class="panel"><ul class="fatti">${Object.values(res.fatti).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
    ${Object.values(res.ruoli ?? {}).some(G.isAssassino) ? '' : '<p class="muted" style="text-align:center">Non c\'erano assassini in gioco: il voto giusto era il cielo.</p>'}
    <p class="muted">Carte scartate: ${Object.values(res.scarti ?? {}).map((c) => `<span class="pill piccola" style="${stileRuolo(c)}">${esc(c)}</span>`).join(' ')}</p>`;
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
      <span class="pill" style="${stileRuolo(ruolo)}">${esc(ruolo)}</span>
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

const bottoneOffline = () => '<button class="full" data-action="off-apri">📴 Partita senza campo (un solo telefono)</button>';
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
function eccomiOff() { S.off.mostra = true; S.off.sceltaOra = Date.now(); salvaOff(); }

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
  if (o.indice < o.ordine.length - 1) { o.indice++; return salvaOff(); }
  concludiOff();
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
  o.result = { ...partita, fatti: G.curiosita(partita, O.storico()) };
  o.fase = 'fine';
  O.accoda(o.id, partita);
  salvaOff();
  sincronizza();
}

function vistaOffline() {
  const o = S.off;
  const nome = (u) => (u === G.CIELO ? '☁️ Cielo' : o.giocatori[u] ?? '???');
  const testa = (titolo) => `<div class="titolo-riga"><h2>${titolo}</h2>${bottoneMazzo()}</div>`;
  const esci = `<p><button class="link" data-action="off-chiudi">${o.fase === 'fine' || o.fase === 'setup' ? 'Torna alla home' : 'Interrompi la partita'}</button></p>`;
  const carta = (u) => {
    const m = o.mani[u];
    return `<div class="carta scoperta ${m.squadra}">
        <div class="ruolo pill grande" style="${stileRuolo(m.ruolo)}">${esc(m.ruolo)}</div>
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
    if (!o.mostra) return `${testa(`Voto · ${o.indice + 1}/${o.ordine.length}`)}${passa(u, 'off-eccomi', 'voglio votare')}${esci}`;
    const bottone = (b, testo) => `<button data-action="off-scegli" data-uid="${esc(b)}" class="${o.scelta === b ? 'scelto' : ''}">${testo}</button>`;
    return `
      ${testa(`Vota, ${esc(nome(u))}`)}
      <section class="panel stack">
        <div class="voti">
          ${o.ordine.filter((b) => b !== u).map((b) => bottone(b, esc(nome(b)))).join('')}
          ${bottone(G.CIELO, '☁️ Cielo')}
        </div>
        <button class="primary full" data-action="off-conferma" ${o.scelta ? '' : 'disabled'}>
          ${o.scelta ? `Conferma voto: ${esc(nome(o.scelta))}` : 'Scegli chi votare'}</button>
      </section>
      <p class="muted">Dopo la conferma lo schermo si copre e il voto non si vede più.</p>`;
  }

  // fine
  const caricata = !O.coda()[o.id];
  return `
    ${testa('📴 Fine partita')}
    ${tabellaRisultato(o.result, nome)}
    <p class="muted">${caricata ? '✅ Partita caricata online: conta per classifiche e curiosità.'
    : '💾 Partita salvata sul telefono: verrà caricata online appena torna internet (con il login fatto).'}</p>
    <button class="primary full" data-action="off-via">Nuova partita, stessi giocatori</button>
    <button class="full" data-action="off-setup">Cambia giocatori</button>
    ${esci}`;
}

// Carica nel database le partite finite senza campo. Parte all'avvio, al ritorno della rete e a fine partita.
async function sincronizza() {
  const coda = Object.entries(O.coda());
  if (sincronizza.attiva || !S.user || !navigator.onLine || !coda.length) return;
  sincronizza.attiva = true;
  let fatte = 0;
  try {
    for (const [id, partita] of coda) {
      try {
        await set(ref(db, `games/${id}`), { ...partita, hostUid: S.user.uid });
      } catch (e) {
        // già caricata da un tentativo precedente (le regole permettono una sola scrittura)? allora è a posto
        if (!(await get(ref(db, `games/${id}`)).catch(() => null))?.exists()) { console.warn('sincronizzazione', id, e); continue; }
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
    classifica: () => tenta(apriClassifica),
    indietro: () => { S.vista = null; render(); },
    nuova: () => tenta(nuovaPartita),
    'off-apri': apriOffline,
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
});

// Se il telefono va in background o si cambia app, la carta si ricopre da sola.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !S.coperta) { S.coperta = true; render(); }
  if (document.hidden && S.off?.mostra) { S.off.mostra = false; salvaOff(); }
});
