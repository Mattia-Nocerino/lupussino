# Lupussino

Gioco di bluff da 3 a 9 giocatori. Pagina statica (HTML + JS, nessun build) con Firebase Auth e Realtime Database:
si pubblica su GitHub Pages e basta.

## File

| File | Cosa contiene |
|---|---|
| `index.html`, `css/style.css` | pagina e stile (mobile first) |
| `js/game.js` | logica pura: configurazioni, distribuzione, informazioni per ruolo, calcolo del vincitore |
| `js/app.js` | interfaccia, login, stanze, partita in tempo reale sul Realtime Database, presenza online |
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
| `votes/{id}/{round}/{uid}` | quel giocatore e il capo stanza | il voto, scrivibile una volta sola |
| `games/{id}_{round}` | tutti i loggati | storico partite, base per la classifica |

- **Avvio**: il browser del capo stanza mescola il mazzo e scrive carte, mazzo e stato della stanza in un'unica scrittura atomica.
- **Voto**: ognuno scrive il proprio voto e segna `voted/{uid}`: tutti vedono chi manca, non per chi.
- **Fine**: quando tutti hanno votato, il capo stanza calcola il vincitore, rivela ruoli e voti nella stanza e salva la partita in `games/`.
- **Casualità**: mazzo, carta vista dagli investigatori e buono rivelato all'Avvocato usano il generatore crittografico del browser (`crypto.getRandomValues`).
- **Presenza**: quando un telefono si disconnette, il server lo segna `online: false` da solo (`onDisconnect`). Se il capo stanza resta offline per 20 secondi, il primo giocatore online diventa capo stanza e, se serve, chiude lui il conteggio.
- **Rimozione**: il capo stanza può rimuovere un giocatore in qualsiasi momento; a partita in corso il round prosegue senza di lui e il suo voto non conta.

Scelta consapevole: senza backend il capo stanza "fa da server", quindi con gli strumenti del browser da computer potrebbe sbirciare le carte altrui. Giocando da telefono non è un problema.

Limite noto: le regole del Realtime Database non sanno contare i figli di un nodo, quindi il massimo di 9 giocatori per stanza è controllato dall'app e non dalle regole.
