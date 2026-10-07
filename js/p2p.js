// Collegamento diretto tra telefoni senza internet: WebRTC DataChannel sulla rete locale
// (hotspot di un telefono o Wi-Fi senza connessione), con lo scambio iniziale fatto via QR code.
// Nessun server: il QR contiene solo l'essenziale dell'offerta/risposta WebRTC (~150 caratteri)
// e l'altro telefono ricostruisce la descrizione completa.

const VERSIONE = 'L1';
const ATTESA_CANDIDATI_MS = 2500;

const b64 = {
  daHex: (hex) => btoa(String.fromCharCode(...hex.split(':').map((h) => parseInt(h, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  aHex: (s) => [...atob(s.replace(/-/g, '+').replace(/_/g, '/'))]
    .map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(':'),
};

// Dalla descrizione WebRTC tiene ufrag, password, impronta del certificato e i candidati locali UDP.
export function comprimi(sdp, tipo) {
  const riga = (k) => sdp.match(new RegExp(`^a=${k}:(.*)$`, 'm'))?.[1]?.trim();
  const candidati = [...sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gm)]
    .map(([, ip, porta]) => `${ip}~${porta}`);
  const unici = [...new Set(candidati)].slice(0, 4);
  const impronta = riga('fingerprint').split(' ')[1];
  return [VERSIONE, tipo === 'offer' ? 'o' : 'a', riga('ice-ufrag'), riga('ice-pwd'), b64.daHex(impronta), unici.join(',')].join(' ');
}

export function decomprimi(codice) {
  const [v, t, ufrag, pwd, impronta, cand = ''] = codice.trim().split(' ');
  if (v !== VERSIONE || !['o', 'a'].includes(t) || !ufrag || !pwd || !impronta) throw new Error('QR non valido');
  const tipo = t === 'o' ? 'offer' : 'answer';
  const righe = [
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${b64.aHex(impronta)}`,
    `a=setup:${tipo === 'offer' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
    ...cand.split(',').filter(Boolean).map((c, i) => {
      const k = c.lastIndexOf('~');
      return `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.slice(0, k)} ${c.slice(k + 1)} typ host`;
    }),
    'a=end-of-candidates',
  ];
  return { type: tipo, sdp: `${righe.join('\r\n')}\r\n` };
}

function candidatiPronti(pc) {
  return new Promise((ok) => {
    if (pc.iceGatheringState === 'complete') return ok();
    const t = setTimeout(ok, ATTESA_CANDIDATI_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); }
    });
  });
}

// Chi si unisce: crea l'offerta da mostrare come QR, poi accetta la risposta del capo.
export async function creaOfferta() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const canale = pc.createDataChannel('lupussino', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await candidatiPronti(pc);
  return {
    pc, canale,
    codice: comprimi(pc.localDescription.sdp, 'offer'),
    accettaRisposta: (codice) => pc.setRemoteDescription(decomprimi(codice)),
  };
}

// Il capo: legge l'offerta e prepara la risposta da mostrare come QR.
export async function rispondi(codiceOfferta) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const canale = new Promise((ok) => pc.addEventListener('datachannel', (e) => ok(e.channel)));
  await pc.setRemoteDescription(decomprimi(codiceOfferta));
  await pc.setLocalDescription(await pc.createAnswer());
  await candidatiPronti(pc);
  return { pc, canale, codice: comprimi(pc.localDescription.sdp, 'answer') };
}

// Descrive i candidati di un codice, per la diagnostica (indirizzo nascosto .local, IPv4, IPv6).
export function tipiCandidati(codice) {
  const cand = codice.split(' ')[5] ?? '';
  return cand.split(',').filter(Boolean).map((c) => {
    const ip = c.slice(0, c.lastIndexOf('~'));
    return ip.endsWith('.local') ? 'mDNS' : ip.includes(':') ? 'IPv6' : `IPv4 ${ip}`;
  });
}

// ---------- QR: disegno e lettura dalla fotocamera ----------

export function qrSvg(testo) {
  const qr = window.qrcode(0, 'L');
  qr.addData(testo);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

// Apre la fotocamera posteriore nel <video> e risolve col primo QR letto. Usa BarcodeDetector
// dove esiste (Android) e jsQR altrove (iPhone). ferma() chiude la fotocamera.
export function leggiQr(video) {
  let attivo = true;
  let stream;
  const ferma = () => { attivo = false; stream?.getTracks().forEach((t) => t.stop()); };
  const letto = (async () => {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const tela = document.createElement('canvas');
    const ctx = tela.getContext('2d', { willReadFrequently: true });
    while (attivo) {
      await new Promise((ok) => requestAnimationFrame(ok));
      if (video.readyState < 2) continue;
      let testo = null;
      if (detector) {
        testo = (await detector.detect(video).catch(() => []))[0]?.rawValue ?? null;
      } else {
        const w = Math.min(640, video.videoWidth);
        const h = Math.round(video.videoHeight * (w / video.videoWidth));
        tela.width = w; tela.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        testo = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
      }
      if (testo?.startsWith(VERSIONE)) { ferma(); return testo; }
    }
    return null;
  })();
  letto.catch(ferma);
  return { letto, ferma };
}
