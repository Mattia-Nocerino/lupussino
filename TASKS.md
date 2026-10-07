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
- ✅ Stanze abbandonate nascoste (nessuno online) e bottone "Chiudi la stanza per tutti"
- ❌ Codice stanza breve: scartato da Mattia
- ✅ Timer di discussione scelto dal capo in lobby: countdown in alto, alla scadenza il voto si chiude (anche nelle regole)
- ✅ Regolamento in app (link discreto in home, login e Carte in gioco)
- ✅ Schermo sempre acceso in stanza (Wake Lock)

## Fase 3: classifiche e curiosità
- ✅ Pagina "Classifiche" calcolata da `games/`: miglior giocatore, miglior assassino, miglior mitomane, fiuto migliore, peggior giocatore (% voti sbagliati da buono, minimo 3 voti)
- ✅ Gli ospiti non entrano in classifica
- ✅ Voto in due tempi (scegli e conferma): conta i ripensamenti
- ✅ "Lo sapevi?" a fine partita: ripensamenti, tempi di voto, serie di vittorie, mai votato, assassino invisibile, mitomane votato, voti reciproci, buoni perfetti, prime vittorie da ruolo
- ⬜ Aggregare in `stats/{uid}` a fine partita invece di rileggere tutto lo storico (serve solo con migliaia di partite)
- ✅ Ospiti che collegano Google tenendo lo stesso uid: le partite da ospite entrano in classifica (`users/{uid}/ospite`)
- ❓ Classifica globale o per gruppo di amici/stanza? Per stagione/mese?

## Fase 5: senza internet
- ✅ App installabile e utilizzabile offline (PWA con service worker)
- ✅ Modalità "un solo telefono": il telefono passa di mano, ognuno guarda la sua carta e vota di nascosto; nessuna rete necessaria
- ✅ Partite senza campo salvate sul telefono e caricate in `games/` al ritorno di internet (contano per classifiche e curiosità)
- ✅ Più telefoni senza internet: hotspot + WebRTC con QR, il telefono del capo fa da database (stesse schermate dell'online)
- ⬜ Provare su telefoni veri: iPhone capo, Android capo, misto (vedi `prova-rete.html`)
- ⬜ Web NFC su Android per collegarsi avvicinando i telefoni invece dei QR (extra)

## Fase 4: punteggi (deciso da Claude il 7 ottobre 2026, su richiesta di Mattia: i bonus personali devono pesare molto meno della squadra)
- ✅ Squadra vincente: **+10** a testa. Pareggio: nessuno prende i 10.
- ✅ Buoni: voto giusto **+2**, cielo giusto **+3**, voto sbagliato **-1**, voto sbagliato da Investigatore/Investigatrice/Avvocato **-2** (avevano un indizio).
- ✅ Assassino che nessun buono ha votato: **+2**. Mitomane: **+1** per ogni buono che l'ha votato, massimo **+3**.
- ✅ I voti dei cattivi non danno né tolgono punti (e non si mostrano a fine partita).
- ✅ Classifica della stanza in diretta (`rooms/{id}/classifica`) e "⭐ Più punti" nelle classifiche generali.
- ✅ Serie di vittorie nella stessa stanza: +1 alla terza di fila, +2 alla quarta, +3 dalla quinta.
- ❌ Moltiplicatore per numero di giocatori: scartato (gonfierebbe i punti dei gruppi grandi).

## Regole confermate da Mattia (7 ottobre 2026)
- Da 3 a 9 giocatori (tutte le configurazioni).
- Pareggio giusti/sbagliati senza voti al Mitomane: **pareggio**, non vince nessuno. Con almeno un voto sbagliato al Mitomane vincono i cattivi.
- Voto al cielo con assassini in gioco: sbagliato.
- Nessun cattivo in gioco e buoni che sbagliano: vincono "i cattivi" senza nessuno a prendere i punti.
  ⬜ Idea di Mattia: in questo caso un **malus ai buoni pesato sulla potenza del ruolo** (es. Investigatore/Avvocato perdono più di un Cittadino, perché avevano più informazioni).
- Investigatore/Investigatrice e Avvocato non scelgono: la carta scartata e il buono rivelato sono estratti a caso in automatico (gli investigatori possono vedere la stessa carta).
- Non ci si può votare da soli.
