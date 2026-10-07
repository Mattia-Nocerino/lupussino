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
  calcolando: false,
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
  await tenta(() => update(ref(db, `users/${user.uid}`), { nome: S.nome, ultimoAccesso: serverTimestamp() }));
  ascoltaStanze();
  const salvata = localStorage.getItem('lupussino.room');
  if (salvata) await tenta(() => entraInStanza(salvata, { soloSeGiaDentro: true }));
  render();
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

const mioGiocatore = () => ({ nome: S.nome, online: true, visto: serverTimestamp() });

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
  const [mano, voto] = await Promise.all([
    get(ref(db, `hands/${S.roomId}/${round}/${S.user.uid}`)),
    get(ref(db, `votes/${S.roomId}/${round}/${S.user.uid}`)),
  ]);
  if (S.manoRound !== round) return;
  S.mano = mano.val();
  S.mioVoto = voto.val();
  render();
}

async function vota(bersaglio) {
  if (S.mioVoto) return;
  if (!confirm(`Confermi il voto per ${nomeDi(bersaglio)}? Non potrai cambiarlo.`)) return;
  await update(ref(db), {
    [`votes/${S.roomId}/${S.room.round}/${S.user.uid}`]: bersaglio,
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
    const voti = Object.fromEntries(Object.entries(votiSnap.val() ?? {}).filter(([u]) => presenti(u)));
    const esito = G.esitoVoto(mazzo.assegnazioni, voti);
    esito.vincitori = esito.vincitori.filter(presenti);
    const ruoli = Object.fromEntries(Object.entries(mazzo.assegnazioni).filter(([u]) => presenti(u)));
    const result = { ...esito, ruoli, scarti: mazzo.scarti, voti };

    await update(ref(db), {
      [`${roomPath()}/status`]: 'ended',
      [`${roomPath()}/result`]: result,
      [`games/${S.roomId}_${round}`]: {
        roomId: S.roomId, round, hostUid: S.user.uid, giocatori: S.room.inGioco, ...result, finitaIl: serverTimestamp(),
      },
    });
  } catch (e) {
    console.error(e); toast(e.message);
  } finally {
    S.calcolando = false;
  }
}

async function nuovaPartita() {
  await update(roomRef(), { status: 'lobby', inGioco: null, voted: null, result: null });
}

// ---------- viste ----------

function render() {
  $utente.innerHTML = S.user
    ? `<span>${esc(S.nome)}</span><button class="link" data-action="logout">Esci</button>`
    : '';
  if (!S.user) return ($app.innerHTML = vistaLogin());
  if (!S.room) return ($app.innerHTML = vistaHome());
  const viste = { lobby: vistaLobby, playing: vistaPartita, ended: vistaRisultato };
  $app.innerHTML = viste[S.room.status]?.() ?? '';
  if (S.room.status === 'ended' && S.room.result) festeggia();
}

const vistaLogin = () => `
  <section class="panel stack" style="text-align:center">
    <p>Il gioco di bluff da fare in compagnia.<br><span class="muted">Da ${G.MIN_GIOCATORI} a ${G.MAX_GIOCATORI} giocatori.</span></p>
    <button class="primary full" data-action="login">Entra con Google</button>
    <button class="full" data-action="ospite">Entra come ospite</button>
    <p class="muted">Gli ospiti non finiscono in classifica e perdono il profilo se cancellano i dati del browser.</p>
  </section>`;

function listaStanze() {
  const stanze = S.stanze.map((r) => {
    const n = Object.keys(r.players ?? {}).length;
    const stato = r.status === 'ended' ? 'tra una partita e l\'altra' : 'in attesa';
    return `<li><div><strong>${esc(r.name)}</strong><br><span class="muted">${n}/${G.MAX_GIOCATORI} · ${stato}</span></div>
      <button data-action="entra" data-id="${esc(r.id)}" ${n >= G.MAX_GIOCATORI ? 'disabled' : ''}>Entra</button></li>`;
  }).join('');
  return stanze ? `<ul class="list">${stanze}</ul>` : '<p class="muted">Nessuna stanza aperta. Creane una!</p>';
}

function vistaHome() {
  return `
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
  const voto = S.mioVoto
    ? `<p>Hai votato <strong>${esc(nomeDi(S.mioVoto))}</strong>.</p>`
    : `<div class="voti">
        ${uids.filter((u) => u !== S.user.uid).map((u) => `<button data-action="vota" data-uid="${esc(u)}">${esc(r.inGioco[u])}</button>`).join('')}
        <button data-action="vota" data-uid="${G.CIELO}">☁️ Cielo</button>
      </div>`;

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
    <div class="titolo-riga"><h2>${esc(r.name)} · round ${r.round}</h2>${bottoneMazzo()}</div>
    <div class="banner ${res.vincitore}">${res.vincitore === G.PAREGGIO ? 'Pareggio: non vince nessuno' : `Vincono i ${res.vincitore}!`}</div>
    <p class="muted" style="text-align:center">Voti dei buoni: ${res.giusti} giusti, ${res.sbagliati} sbagliati${res.votiMitomane ? ` (di cui ${res.votiMitomane} al Mitomane)` : ''}</p>
    <section class="panel"><ul class="list">${righe}</ul></section>
    ${Object.values(res.ruoli ?? {}).some(G.isAssassino) ? '' : '<p class="muted" style="text-align:center">Non c\'erano assassini in gioco: il voto giusto era il cielo.</p>'}
    <p class="muted">Carte scartate: ${Object.values(res.scarti ?? {}).map((c) => `<span class="pill piccola" style="${stileRuolo(c)}">${esc(c)}</span>`).join(' ')}</p>
    ${sonoHost()
    ? '<button class="primary full" data-action="nuova">Nuova partita</button>'
    : '<p class="muted">In attesa che il capo stanza avvii una nuova partita…</p>'}
    ${pannelloGiocatori()}
    <p><button class="link" data-action="esci">Lascia la stanza</button></p>`;
}

// Mazzo del round (o quello che uscirebbe col numero attuale di giocatori), raggruppato per ruolo.
function bottoneMazzo() {
  return '<button class="mazzo-btn" data-action="mazzo">🃏 Carte in gioco</button>';
}

function apriMazzo() {
  const r = S.room;
  const n = r.status === 'lobby' ? Object.keys(r.players ?? {}).length : (r.nGiocatori ?? Object.keys(r.inGioco ?? {}).length);
  const mazzo = G.CONFIGURAZIONI[n];
  const conta = {};
  for (const c of mazzo ?? []) conta[c] = (conta[c] ?? 0) + 1;
  const righe = Object.entries(conta).map(([ruolo, k]) => `<li>
      <span class="pill" style="${stileRuolo(ruolo)}">${esc(ruolo)}</span>
      <span class="${G.squadraDi(ruolo) === G.BUONI ? 'ok' : 'ko'}">${k > 1 ? `×${k} · ` : ''}${G.squadraDi(ruolo)}</span></li>`).join('');
  const titolo = r.status === 'lobby' ? `Con ${n} giocatori il mazzo sarebbe` : `Mazzo di questo round (${n} giocatori)`;
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
function festeggia() {
  const chiave = `${S.roomId}/${S.room.round}`;
  if (festeggia.fatto === chiave) return;
  festeggia.fatto = chiave;
  const { vincitore } = S.room.result;
  const testi = {
    [G.BUONI]: ['Vincono i buoni!', '⚖️'],
    [G.CATTIVI]: ['Vincono i cattivi!', '🔪'],
    [G.PAREGGIO]: ['Pareggio!', '🤝'],
  };
  const [testo, emoji] = testi[vincitore] ?? ['Fine partita', '🎲'];
  const io = Object.values(S.room.result.vincitori ?? {}).includes(S.user.uid);
  const sotto = vincitore === G.PAREGGIO ? 'Non vince nessuno' : io ? 'Hai vinto 🎉' : 'Hai perso';
  const $festa = document.createElement('div');
  $festa.className = `festa ${vincitore}`;
  const pioggia = Array.from({ length: 24 }, () =>
    `<span class="goccia" style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.8).toFixed(2)}s">${emoji}</span>`).join('');
  $festa.innerHTML = `${pioggia}<div class="festa-testo"><div class="festa-emoji">${emoji}</div>${testo}<small>${sotto}</small></div>`;
  $festa.addEventListener('click', () => $festa.remove());
  $festa.addEventListener('animationend', (e) => { if (e.target === $festa) $festa.remove(); });
  document.body.append($festa);
}

// ---------- eventi ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, uid } = el.dataset;
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
    vota: () => tenta(() => vota(uid)),
    nuova: () => tenta(nuovaPartita),
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
});

// Se il telefono va in background o si cambia app, la carta si ricopre da sola.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !S.coperta) { S.coperta = true; render(); }
});
