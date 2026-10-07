# Lupussino

Gioco di bluff da 3 a 9 giocatori. Pagina statica (HTML + JS, nessun build) con Firebase Auth e Realtime Database:
si pubblica su GitHub Pages e basta.

## File

| File | Cosa contiene |
|---|---|
| `index.html`, `css/style.css` | pagina e stile (mobile first) |
| `js/game.js` | logica pura: configurazioni, distribuzione, informazioni per ruolo, calcolo del vincitore |
| `js/app.js` | interfaccia, login, stanze, partita in tempo reale sul Realtime Database, presenza online |
| `js/rete.js`, `js/dati.js`, `js/p2p.js` | stanza senza internet con più telefoni: il telefono del capo fa da database, collegamento WebRTC via QR |
| `vendor/` | librerie QR (qrcode-generator MIT, jsQR Apache-2.0) |
| `prova-rete.html` | pagina per provare se i telefoni si collegano tra loro senza internet |
| `js/offline.js` | archivio sul telefono per giocare senza campo: amici, storico, partite da caricare |
| `sw.js`, `manifest.webmanifest`, `icons/` | app installabile (PWA) che si apre anche senza internet |
| `js/firebase-config.js` | **da compilare** con la config del tuo progetto Firebase |
| `database.rules.json` | regole di sicurezza del Realtime Database |
| `firebase.json` | config per pubblicare le regole e usare gli emulatori |
| `test/game.test.mjs` | test della logica (`node --test test/game.test.mjs`) |

## Setup Firebase (una volta sola, piano gratuito Spark)

1. Vai su <https://console.firebase.google.com> → **Aggiungi progetto** (Analytics non serve).
2. **Build → Authentication → Inizia**. In *Sign-in method* abilita **Google** e **Anonimo** (per gli ospiti).
3. In *Authentication → Settings → Domini autorizzati* aggiungi `TUO-UTENTE.github.io`.
4. **Build → Realtime Database → Crea database**, posizione **Belgio (europe-west1)**, avvio in **modalità bloccata**.
5. Nella scheda *Regole* sostituisci tutto con il contenuto di `database.rules.json` e premi **Pubblica**
   (oppure da terminale: `npx firebase-tools deploy --only database --project ID-PROGETTO`).
6. **Impostazioni progetto (ingranaggio) → Le tue app → icona `</>`** per registrare una web app.
   Copia l'oggetto `firebaseConfig` dentro `js/firebase-config.js` (controlla che ci sia `databaseURL`,
   l'indirizzo che vedi in cima alla pagina del Realtime Database).
   Quei valori non sono segreti: possono stare nel repository pubblico.

## Pubblicare su GitHub Pages

1. Metti questi file nella root di un repository GitHub.
2. *Settings → Pages → Build and deployment*: **Deploy from a branch**, branch `main`, cartella `/ (root)`.
3. La pagina sarà su `https://TUO-UTENTE.github.io/NOME-REPO/`.

## Provarla in locale senza toccare il progetto vero

```bash
npx firebase-tools emulators:start --project demo-lupussino   # auth :9099, database :9000
npx serve .                                                     # oppure: python3 -m http.server
```

Apri `http://localhost:3000/?emulatori` in più finestre in incognito e usa "Entra come ospite".

## Come funziona una partita

Dati nel Realtime Database:

| Percorso | Chi legge | Contenuto |
|---|---|---|
| `rooms/{id}` | tutti i loggati | nome, capo stanza, stato `lobby → playing → ended`, round, giocatori (con `online`), chi ha votato, risultato |
| `hands/{id}/{round}/{uid}` | solo quel giocatore (e il capo stanza) | la tua carta e le tue informazioni |
| `secret/{id}/{round}` | solo il capo stanza | mazzo completo e scarti |
| `votes/{id}/{round}/{uid}` | quel giocatore e il capo stanza | `{bersaglio, cambi, at}`: il voto (scrivibile una volta sola), i ripensamenti e l'ora |
| `games/{id}_{round}` | tutti i loggati | storico partite: ruoli, voti, vincitori, ripensamenti, tempi; base di classifiche e curiosità |

- **Avvio**: il browser del capo stanza mescola il mazzo e scrive carte, mazzo e stato della stanza in un'unica scrittura atomica.
- **Voto**: ognuno scrive il proprio voto e segna `voted/{uid}`: tutti vedono chi manca, non per chi.
- **Fine**: quando tutti hanno votato, il capo stanza calcola il vincitore, rivela ruoli e voti nella stanza e salva la partita in `games/`.
- **Casualità**: mazzo, carta vista dagli investigatori e buono rivelato all'Avvocato usano il generatore crittografico del browser (`crypto.getRandomValues`).
- **Presenza**: quando un telefono si disconnette, il server lo segna `online: false` da solo (`onDisconnect`). Se il capo stanza resta offline per 20 secondi, il primo giocatore online diventa capo stanza e, se serve, chiude lui il conteggio.
- **Rimozione**: il capo stanza può rimuovere un giocatore in qualsiasi momento; a partita in corso il round prosegue senza di lui e il suo voto non conta.

Scelta consapevole: senza backend il capo stanza "fa da server", quindi con gli strumenti del browser da computer potrebbe sbirciare le carte altrui. Giocando da telefono non è un problema.

Limite noto: le regole del Realtime Database non sanno contare i figli di un nodo, quindi il massimo di 9 giocatori per stanza è controllato dall'app e non dalle regole.

## Senza internet

Prima volta: aprire il sito **con internet** (meglio col login) e installarlo: Android/Chrome menu ⋮ → **Installa app**;
iPhone/Safari Condividi → **Aggiungi alla schermata Home**. Il service worker salva i file e da lì l'app si apre anche senza rete.

### 📡 Ognuno col suo telefono
1. Un telefono accende l'**hotspot** (non servono giga) e gli altri si collegano a quella rete.
2. Uno preme **👑 Creo la stanza**: la stanza vive sul suo telefono, che fa le veci del Realtime Database.
3. Gli altri premono **📷 Mi unisco**: mostrano un QR al capo, poi inquadrano il QR del capo. Da lì lobby, carte, voto,
   risultato, mazzo, curiosità e rimozione giocatori sono quelli dell'online.
4. Chi cade (schermo spento, app chiusa) preme **Ricollegati** e rifà i due QR: ritrova carta e voto.
   Se cade il capo, riapre l'app, va su 📡 e preme **Riprendi la stanza**; gli altri si ricollegano.

Come funziona: WebRTC DataChannel sulla rete locale, senza server. Il QR contiene solo l'essenziale dell'offerta
WebRTC (~100 caratteri). Il capo manda a ciascuno solo quello che le regole del database gli farebbero leggere
(la stanza, la propria carta, il proprio voto) e controlla le scritture con le stesse regole. Senza internet nessuno
subentra al capo.

Se non si collega: tutti sulla stessa rete? Alcuni Android hanno "isola i dispositivi" nell'hotspot; su iPhone serve il
permesso Impostazioni → Privacy → Rete locale per il browser. `prova-rete.html` mostra una diagnostica.

### 📴 Un solo telefono
Il telefono passa di mano: ognuno preme "Sono X" per vedere la propria carta, poi si discute e si vota allo stesso modo, di nascosto.

### Sincronizzazione
Le partite finite senza internet (su un solo telefono o sul telefono del capo) restano in `localStorage` e vengono
scritte in `games/` appena torna internet, con il login del proprietario del telefono come `hostUid`.
Gli amici già visti online contano in classifica; i nomi nuovi sono ospiti. Senza rete le classifiche si calcolano
con le partite salvate sul telefono.
