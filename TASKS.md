# Lupussino: task verso il prodotto finale

Legenda: ✅ fatto · ⬜ da fare · ❓ serve una decisione di Mattia

## Fase 0: base (fatto)
- ✅ Logica di gioco pura e testata (configurazioni 3–9, distribuzione, info per ruolo, vincitore, cielo, pareggio)
- ✅ Login Google + ospite, lista stanze, crea/entra/esci
- ✅ Rimozione giocatori dal capo stanza, anche a partita in corso
- ✅ Presenza online con onDisconnect e promozione automatica di un nuovo capo stanza dopo 20 s offline
- ✅ Estrazioni con generatore casuale crittografico
- ✅ Avvio da parte del capo stanza, carta coperta di default (si ricopre se l'app va in background)
- ✅ Voto unico e irrevocabile, incluso il cielo, avanzamento "chi manca"
- ✅ Risultato con ruoli, voti, giusti/sbagliati, scarti; nuova partita nella stessa stanza
- ✅ Realtime Database con regole: carte e voti visibili solo al proprietario (e al capo stanza)
- ✅ Storico partite in `games/`

## Fase 1: messa online
- ⬜ Creare il progetto Firebase e incollare la config (vedi README)
- ⬜ Creare il repository GitHub, pubblicare su Pages, aggiungere il dominio autorizzato
- ⬜ Prima partita vera con amici, raccogliere feedback

## Fase 2: robustezza
- ⬜ Pulizia stanze abbandonate (es. bottone "chiudi stanza" + filtro stanze più vecchie di 24h)
- ⬜ Codice stanza breve da dettare a voce o QR code, invece di cercarla nella lista
- ⬜ Timer opzionale di discussione prima del voto
- ⬜ PWA (icona sulla home, schermo sempre acceso durante la partita con Wake Lock)

## Fase 3: classifica
I dati ci sono già in `games/` (ruoli, voti, giusti/sbagliati, vincitori per ogni partita).
- ⬜ Pagina "Classifica" che legge `games/` e calcola:
  - **Miglior giocatore**: più partite vinte (mostrare anche % vittorie, con un minimo di partite giocate)
  - **Miglior assassino**: più vittorie da Assassino
  - **Miglior mitomane**: più vittorie da Mitomane (o più volte votato)
  - **Peggior giocatore**: più voti sbagliati da buono (buono che vota buono, mitomane o cielo con assassini in gioco), in % sui voti dati
- ⬜ Aggregare in `stats/{uid}` a fine partita (transazione nel Realtime Database) invece di rileggere tutto lo storico
- ⬜ Gli ospiti non entrano in classifica (o possono "promuovere" il profilo collegando Google)
- ❓ Classifica globale o per gruppo di amici/stanza? Per stagione/mese?

## Fase 4: punteggi, moltiplicatori e bonus (proposte da scegliere)
Base proposta: chi vince prende **10 punti**, chi perde 0.

Bonus individuali proposti per i buoni:
- **Fiuto**: +5 se hai votato giusto (anche quando la tua squadra perde, +2)
- **Cielo coraggioso**: ×2 ai buoni che hanno votato cielo quando era giusto (è la scommessa più rischiosa)
- **Squadra perfetta**: +5 a tutti i buoni se nessun buono ha sbagliato
- **Investigatore efficace**: +3 se l'Investigatore vota giusto (premia chi usa bene l'informazione)
- **Malus "fuoco amico"**: -2 a chi vota un buono (alimenta anche la classifica del peggior giocatore)

Bonus per i cattivi:
- **Inosservato**: +5 all'Assassino che non ha ricevuto nessun voto
- **Bersaglio perfetto**: ×2 al Mitomane se è il giocatore più votato
- **Disastro totale**: ×2 a tutti i cattivi se tutti i voti dei buoni sono sbagliati
- **Assassino solitario**: +3 se vinci essendo l'unico assassino in gioco

Altre idee:
- Moltiplicatore per numero di giocatori (vincere in 7 vale più che in 3)
- Serie di vittorie consecutive (×1.5 dalla terza)
- ❓ Scegliere quali bonus tenere e se i punti si sommano sempre o solo nella stessa serata

## Regole confermate da Mattia (7 ottobre 2026)
- Da 3 a 9 giocatori (tutte le configurazioni).
- Pareggio giusti/sbagliati senza voti al Mitomane: **pareggio**, non vince nessuno. Con almeno un voto sbagliato al Mitomane vincono i cattivi.
- Voto al cielo con assassini in gioco: sbagliato.
- Nessun cattivo in gioco e buoni che sbagliano: vincono "i cattivi" senza nessuno a prendere i punti.
  ⬜ Idea di Mattia: in questo caso un **malus ai buoni pesato sulla potenza del ruolo** (es. Investigatore/Avvocato perdono più di un Cittadino, perché avevano più informazioni).
- Investigatore/Investigatrice e Avvocato non scelgono: la carta scartata e il buono rivelato sono estratti a caso in automatico (gli investigatori possono vedere la stessa carta).
- Non ci si può votare da soli.
