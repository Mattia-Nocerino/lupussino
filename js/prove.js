// Minigiochi delle prove (modalità Traditori). Tutti ricevono la stessa sfida: il capo estrae un seme
// e ogni telefono genera da lì le stesse domande. Il tempo si misura sul telefono, quindi la rete non conta.
// Risultato: { punti, ms }: vince chi ha più punti e, a parità, meno tempo.

export const TIPI = {
  calcolo: { emoji: '🧮', nome: 'Calcolo a raffica', spiega: '10 operazioni il più in fretta possibile. Ogni errore costa 3 secondi.' },
  riflessi: { emoji: '⚡', nome: 'Riflessi', spiega: 'Tocca appena lo schermo diventa verde. 3 manche: se tocchi prima, +1 secondo.' },
  intruso: { emoji: '👁️', nome: 'Occhio di lince', spiega: 'Trova l\'unica emoji diversa nella griglia. 5 griglie, ogni errore costa 2 secondi.' },
  memoria: { emoji: '🧠', nome: 'Memoria', spiega: 'Guarda la sequenza di emoji e ripetila. A ogni giro si allunga di uno: al primo errore ti fermi.' },
  colori: { emoji: '🎨', nome: 'Colori bugiardi', spiega: 'Tocca il colore con cui è scritta la parola, non quello che dice. 15 parole: conta chi ne azzecca di più.' },
  ricordi: { emoji: '📜', nome: 'Chi si ricorda?', spiega: '5 domande su quello che è successo in questa partita. Vince chi ne indovina di più.' },
};

// Generatore deterministico (mulberry32): stesso seme, stessa sequenza su tutti i telefoni.
export function rngDa(seme) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const intero = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

export function operazioni(seme, quante = 10) {
  const rng = rngDa(seme);
  return Array.from({ length: quante }, (_, i) => {
    const tipo = i % 4;
    if (tipo === 0) { const a = intero(rng, 3, 12); const b = intero(rng, 3, 12); return { testo: `${a} × ${b}`, risposta: a * b }; }
    if (tipo === 1) { const b = intero(rng, 2, 9); const r = intero(rng, 3, 12); return { testo: `${b * r} ÷ ${b}`, risposta: r }; }
    if (tipo === 2) { const a = intero(rng, 15, 99); const b = intero(rng, 15, 99); return { testo: `${a} + ${b}`, risposta: a + b }; }
    const a = intero(rng, 40, 120); const b = intero(rng, 5, a - 10); return { testo: `${a} − ${b}`, risposta: a - b };
  });
}

export const attese = (seme, manche = 3) => { const rng = rngDa(seme); return Array.from({ length: manche }, () => intero(rng, 1200, 3800)); };

const COPPIE = [['😀', '😃'], ['🐺', '🦊'], ['🍎', '🍅'], ['🌕', '🌝'], ['🔪', '🗡️'], ['🐸', '🐢'], ['⭐', '🌟'], ['🍋', '🍌']];
export function griglie(seme, quante = 5, lato = 6) {
  const rng = rngDa(seme);
  return Array.from({ length: quante }, () => {
    const [base, diversa] = COPPIE[intero(rng, 0, COPPIE.length - 1)];
    return { base, diversa, posto: intero(rng, 0, lato * lato - 1), lato };
  });
}

export const SIMBOLI = ['🐺', '🔪', '🛡️', '🗡️', '✉️', '☁️'];
export const sequenza = (seme, lunghezza = 12) => { const rng = rngDa(seme); return Array.from({ length: lunghezza }, () => intero(rng, 0, SIMBOLI.length - 1)); };

export const COLORI = { ROSSO: '#e5534b', BLU: '#4f8cff', VERDE: '#4fc38a', GIALLO: '#f2c23d' };
export function parole(seme, quante = 15) {
  const rng = rngDa(seme);
  const nomi = Object.keys(COLORI);
  return Array.from({ length: quante }, () => {
    const parola = nomi[intero(rng, 0, nomi.length - 1)];
    const altri = nomi.filter((n) => n !== parola);
    return { parola, inchiostro: altri[intero(rng, 0, altri.length - 1)] }; // sempre diverso: è qui il trucco
  });
}

// Domande su fatti pubblici della partita. fatti: [{ domanda, giusta, opzioni }] già preparati dall'app.
export function domande(seme, fatti, nomi, quante = 5) {
  const rng = rngDa(seme);
  const mischia = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  return mischia(fatti).slice(0, quante).map((f) => {
    const sbagliate = mischia(Object.keys(nomi).filter((u) => u !== f.giusta)).slice(0, 3);
    return { domanda: f.domanda, giusta: f.giusta, opzioni: mischia([f.giusta, ...sbagliate]).map((u) => ({ u, nome: nomi[u] })) };
  });
}

// ---------- interfaccia ----------
// Crea l'elemento del gioco una volta sola: l'app lo riaggancia alla pagina a ogni aggiornamento, così non si perde.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function creaGioco({ tipo, seme, fatti = [], nomi = {} }, fine) {
  const $el = document.createElement('div');
  $el.className = 'gioco';
  const info = TIPI[tipo];
  let inizio = 0;
  let penalita = 0;
  const finito = (punti = 0) => {
    const ms = Math.round(performance.now() - inizio + penalita);
    $el.innerHTML = `<p class="gioco-fine">Fatto! ${punti ? `${punti} risposte giuste in ` : ''}${(ms / 1000).toFixed(1)} s</p><p class="muted">Aspetta gli altri: chi vince lo saprà solo lui.</p>`;
    fine({ punti, ms });
  };
  const vibra = (ms) => navigator.vibrate?.(ms);
  const scuoti = ($x) => { $x.classList.remove('sbagliato'); void $x.offsetWidth; $x.classList.add('sbagliato'); vibra(120); };

  const giochi = {
    calcolo() {
      const ops = operazioni(seme);
      let i = 0;
      const mostra = () => {
        $el.innerHTML = `<p class="muted">${i + 1} di ${ops.length}</p><div class="gioco-grande">${ops[i].testo} = ?</div>
          <form class="row"><input inputmode="numeric" pattern="-?[0-9]*" autocomplete="off" aria-label="Risultato"><button class="primary">Ok</button></form>`;
        const $in = $el.querySelector('input');
        $in.focus();
        $el.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          if (Number($in.value) === ops[i].risposta && $in.value.trim() !== '') { i++; if (i === ops.length) finito(); else mostra(); }
          else { penalita += 3000; $in.value = ''; scuoti($el.querySelector('.gioco-grande')); }
        };
      };
      mostra();
    },
    riflessi() {
      const tempi = attese(seme);
      let i = 0;
      let totale = 0;
      const manche = () => {
        let verde = 0;
        $el.innerHTML = `<button class="riflessi aspetta">Aspetta il verde… <small>${i + 1} di ${tempi.length}</small></button>`;
        const $b = $el.querySelector('button');
        const t = setTimeout(() => { verde = performance.now(); $b.className = 'riflessi via'; $b.innerHTML = 'TOCCA!'; }, tempi[i]);
        $b.onpointerdown = () => {
          if (!verde) { clearTimeout(t); totale += 1000; scuoti($b); vibra(200); }
          else totale += performance.now() - verde;
          i++;
          if (i === tempi.length) { inizio = performance.now() - totale; finito(); } else setTimeout(manche, 400);
        };
      };
      manche();
    },
    intruso() {
      const gg = griglie(seme);
      let i = 0;
      const mostra = () => {
        const g = gg[i];
        $el.innerHTML = `<p class="muted">${i + 1} di ${gg.length}</p><div class="griglia" style="grid-template-columns:repeat(${g.lato},1fr)">${
          Array.from({ length: g.lato * g.lato }, (_, k) => `<button data-k="${k}">${k === g.posto ? g.diversa : g.base}</button>`).join('')}</div>`;
        $el.querySelector('.griglia').onclick = (e) => {
          const $b = e.target.closest('button');
          if (!$b) return;
          if (Number($b.dataset.k) === g.posto) { i++; if (i === gg.length) finito(); else mostra(); }
          else { penalita += 2000; scuoti($b); }
        };
      };
      mostra();
    },
    memoria() {
      const seq = sequenza(seme);
      let lunghezza = 3;
      const tastiera = () => `<div class="simboli">${SIMBOLI.map((e, k) => `<button data-k="${k}">${e}</button>`).join('')}</div>`;
      const giro = () => {
        $el.innerHTML = `<p class="muted">Guarda: ${lunghezza} simboli</p><div class="gioco-grande memoria-mostra">…</div>`;
        const $m = $el.querySelector('.memoria-mostra');
        let k = 0;
        const passo = () => {
          if (k === lunghezza) return ripeti();
          $m.textContent = SIMBOLI[seq[k]];
          setTimeout(() => { $m.textContent = ''; k++; setTimeout(passo, 200); }, 650);
        };
        setTimeout(passo, 500);
      };
      const ripeti = () => {
        let k = 0;
        $el.innerHTML = `<p class="muted">Ripeti la sequenza (${lunghezza})</p><div class="gioco-grande memoria-scritta">&nbsp;</div>${tastiera()}`;
        const $s = $el.querySelector('.memoria-scritta');
        $el.querySelector('.simboli').onclick = (e) => {
          const $b = e.target.closest('button');
          if (!$b) return;
          if (Number($b.dataset.k) !== seq[k]) { scuoti($b); return finito(lunghezza - 1); }
          $s.textContent = seq.slice(0, k + 1).map((x) => SIMBOLI[x]).join('');
          k++;
          if (k < lunghezza) return;
          if (lunghezza === seq.length) return finito(lunghezza);
          lunghezza++;
          setTimeout(giro, 400);
        };
      };
      giro();
    },
    colori() {
      const pp = parole(seme);
      let i = 0;
      let giuste = 0;
      const mostra = () => {
        const p = pp[i];
        $el.innerHTML = `<p class="muted">${i + 1} di ${pp.length}</p><div class="gioco-grande" style="color:${COLORI[p.inchiostro]}">${p.parola}</div>
          <div class="colori">${Object.keys(COLORI).map((n) => `<button data-c="${n}">${n.toLowerCase()}</button>`).join('')}</div>`;
        $el.querySelector('.colori').onclick = (e) => {
          const $b = e.target.closest('button');
          if (!$b) return;
          if ($b.dataset.c === p.inchiostro) giuste++; else scuoti($el.querySelector('.gioco-grande'));
          i++;
          if (i === pp.length) finito(giuste); else mostra();
        };
      };
      mostra();
    },
    ricordi() {
      const dd = domande(seme, fatti, nomi);
      let i = 0;
      let giuste = 0;
      const mostra = () => {
        const d = dd[i];
        $el.innerHTML = `<p class="muted">${i + 1} di ${dd.length}</p><p class="gioco-domanda">${esc(d.domanda)}</p>
          <div class="stack">${d.opzioni.map((o) => `<button class="full" data-u="${esc(o.u)}">${esc(o.nome)}</button>`).join('')}</div>`;
        $el.querySelector('.stack').onclick = (e) => {
          const $b = e.target.closest('button');
          if (!$b) return;
          if ($b.dataset.u === d.giusta) giuste++;
          i++;
          if (i === dd.length) finito(giuste); else mostra();
        };
      };
      mostra();
    },
  };

  $el.innerHTML = `<p><strong>${info.emoji} ${info.nome}</strong></p><p class="muted">${info.spiega}</p>
    <button class="primary full">Sono pronto: via!</button>`;
  $el.querySelector('button').onclick = () => { inizio = performance.now(); giochi[tipo](); };
  return $el;
}
