// Stesse funzioni di firebase/database, ma i riferimenti a una stanza senza internet (rete.js)
// vanno al telefono del capo invece che a Firebase. Così app.js non deve sapere dove stanno i dati.
import * as F from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import * as L from './rete.js';

const locale = (r) => r?.locale === true;

export const { getDatabase, serverTimestamp, orderByChild, limitToLast, connectDatabaseEmulator } = F;
export const ref = (db, path) => (db?.locale ? L.ref(db, path) : F.ref(db, path));
export const get = (r) => (locale(r) ? L.get(r) : F.get(r));
export const set = (r, v) => (locale(r) ? L.set(r, v) : F.set(r, v));
export const update = (r, v) => (locale(r) ? L.update(r, v) : F.update(r, v));
export const remove = (r) => (locale(r) ? L.remove(r) : F.remove(r));
export const push = (r) => (locale(r) ? L.push(r) : F.push(r));
export const onValue = (r, cb, errore) => (locale(r) ? L.onValue(r, cb) : F.onValue(r, cb, errore));
export const onDisconnect = (r) => (locale(r) ? L.onDisconnect(r) : F.onDisconnect(r));
export const query = (r, ...vincoli) => (locale(r) ? r : F.query(r, ...vincoli));
// senza internet nessuno subentra al capo: il capo è il telefono che tiene i dati
export const runTransaction = (r, fn) => (locale(r) ? Promise.resolve({ committed: false }) : F.runTransaction(r, fn));
