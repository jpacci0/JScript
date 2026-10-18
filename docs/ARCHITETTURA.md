# Architettura di JScript

JScript è un editor desktop locale per documenti personali semplici. L'obiettivo iniziale è offrire un'interfaccia essenziale e un flusso affidabile di scrittura, recupero delle bozze ed esportazione. Il formato interno descrive il documento con l'albero JSON di Tiptap; DOCX e PDF sono formati di scambio.

## Perché desktop

| Aspetto | Desktop scelto | Web app o PWA |
| --- | --- | --- |
| File del computer | Finestre native per aprire e salvare | Download e selezione file; accesso diretto dipendente dal browser |
| Lavoro offline | Frontend e runtime inclusi nella distribuzione | Richiede una strategia di installazione e cache dedicata |
| Bozze | Archivio nel profilo Windows con backup precedente | Archivio del browser, legato all'origine e al profilo |
| PDF e stampa | Chromium incluso e API Electron | Dialogo di stampa e comportamento del browser |
| Aggiornamenti | Nuova distribuzione dell'app | Aggiornamento della versione ospitata |
| Accesso da più dispositivi | Trasferimento esplicito dei file esportati | Hosting e sincronizzazione da progettare |

Per l'uso personale su Windows, il desktop rende naturale lavorare con i file locali. Electron mantiene la parte applicativa in JavaScript/TypeScript e include Chromium e Node.js. Il costo è un pacchetto più grande rispetto a un contenitore che usa la WebView del sistema.

Tauri rimane un'alternativa possibile, ma richiederebbe un altro contenitore nativo e la relativa toolchain Rust. La versione realizzata usa Electron, coerentemente con il flusso di distribuzione del progetto Folio. Non è necessario un backend: nessuna funzione attuale richiede account, database remoto o conversioni cloud.

## Componenti

| File o cartella | Responsabilità |
| --- | --- |
| `src/App.tsx` | Schermata iniziale, elenco bozze, editor, comandi, ricerca, struttura, stato di salvataggio |
| `src/styles.css` | Aspetto dell'app, temi, concentrazione e visualizzazione dei fogli |
| `src/lib/types.ts` | Tipi del documento, archivio e interfaccia del ponte desktop |
| `src/lib/storage.ts` | Accesso al salvataggio Electron o, nel browser, a IndexedDB e download |
| `src/lib/documents.ts` | Validazione `.jscript`, importazione DOCX/HTML/TXT ed esportazione DOCX |
| `src/lib/templates.ts` | Documenti iniziali per pagina bianca, appunti, lettera e progetto |
| `electron/preload.cjs` | Espone al frontend soltanto le operazioni desktop previste |
| `electron/main.cjs` | Finestra, dialoghi, archivio locale, scritture su file e gestione della chiusura |
| `electron/print.cjs` | Documento HTML filtrato e finestra isolata per stampa ed esportazione PDF |
| `scripts/` | Avvio congiunto in sviluppo e confezionamento della cartella Windows |
| `tests/` | Verifiche automatizzate delle funzioni documentali e desktop |

React gestisce l'interfaccia; Tiptap e ProseMirror gestiscono selezione, transazioni e contenuto modificabile. L'interfaccia è compilata con Vite. Le dipendenze frontend vengono incluse nella build; `sanitize-html` è conservato anche come dipendenza del processo Electron.

La paginazione usa `tiptap-pagination-plus` 3.1.0 e le tabelle `tiptap-table-plus` 3.1.0. Il contenuto rimane un solo documento JSON Tiptap con una sola cronologia: i fogli sono la sua rappresentazione nell'editor, non documenti indipendenti.

Nella versione 0.3.2 il pannello Layout è una barra compatta con quattro gruppi (Pagina, Margini, Spaziatura e Colonne), etichette e campi affiancati, testi da 10 px e controlli alti 28 px. Le frecce numeriche restano visibili. Il comando Riduci/Mostra è nella riga delle schede; un clic su Scrittura o Layout riapre anche un pannello chiuso. La riorganizzazione non modifica la logica documentale.

## Documento e persistenza

Un documento di lavoro contiene identificativo, titolo, contenuto Tiptap, impostazioni Layout e data di aggiornamento. L'archivio contiene la lista dei documenti, quello attivo e una versione dello schema.

Ogni modifica programma un salvataggio dopo circa 400 ms. Una coda serializza le scritture. Il processo desktop scrive prima in un file temporaneo e lo rinomina al completamento; prima di sostituire l'archivio conserva la precedente versione JSON leggibile in `documents.json.bak`. Alla riapertura prova il file principale e poi il backup se il primo manca o non può essere letto. La validazione dello schema avviene inoltre nel frontend.

La copia nativa `.jscript` è un JSON versionato con `format: "jscript"`, `version: 1`, titolo, contenuto e data. È il formato da usare per riaprire in JScript le caratteristiche supportate, incluse le immagini incorporate. Il salvataggio della bozza e l'esportazione di una copia sono operazioni distinte.

I dati desktop sono nel percorso `userData` di Electron, normalmente `%APPDATA%/JScript`. Non vengono spostati insieme all'eseguibile. La copia `.bak` è un recupero locale precedente, non un sistema di versionamento né una sincronizzazione.

Nel browser `storage.ts` usa IndexedDB. Il controllo `window.jscript` separa le operazioni desktop dal resto dell'interfaccia e prepara un futuro adattamento web. La modalità browser attuale non implementa un service worker, un account o la condivisione dei dati con Electron.

## DOCX, layout e PDF

L'importazione passa da Mammoth a HTML, poi da DOMPurify al contenuto Tiptap. Il filtro elimina contenuti non supportati, stili arbitrari e immagini remote. Prima della conversione sono controllati dimensioni e metadati dell'archivio DOCX.

L'esportazione `docx` ricostruisce semanticamente paragrafi, titoli, formattazioni supportate, elenchi, immagini e tabelle. Non conserva un pacchetto Word originale da modificare senza perdite. I link mantengono il testo ma non la destinazione nell'esportazione corrente.

L'editor distribuisce automaticamente il contenuto su fogli separati, comprese le righe vuote. Numero di pagine e flusso del testo vengono ricalcolati dopo le modifiche al contenuto o alle impostazioni Layout. Formato, orientamento, margini e spaziature sono salvati per documento, normalizzati e recuperati anche dai file `.jscript`; i documenti precedenti usano A4 verticale e margini di 20 mm.

Il PDF viene prodotto separatamente da Chromium usando le stesse impostazioni. Il DOCX contiene le corrispondenti proprietà di sezione e di paragrafo ed è impaginato dal programma che lo apre. La paginazione dell'editor non promette una corrispondenza esatta con Word o PDF: font, tabelle e interruzioni possono differire. L'importazione DOCX non recupera il layout originale.

Non sono implementate sezioni Word con impostazioni di pagina indipendenti, intestazioni e piè di pagina modificabili, note a piè di pagina, revisioni, commenti, sommario automatico o oggetti flottanti. La struttura laterale elenca i titoli per navigare nel testo. La ricerca corrente lavora sui singoli nodi di testo: una frase spezzata fra formattazioni diverse può non risultare come un'unica corrispondenza.

Le estensioni Tiptap utilizzate sono quelle open source; il progetto non dipende dai servizi Tiptap Pages o Conversion.

## Sezioni a due colonne

Le sezioni per CV e contenuti affiancati hanno due colonne indipendenti, larghe 50/50 oppure 33/67. Ogni sezione è una coppia di celle; aggiungere una sezione crea una nuova riga affiancata. Contenuto e formattazione restano nel documento JSON, mentre DOCX e PDF rendono le sezioni senza bordi.

La conversione inserisce il paragrafo corrente o i blocchi selezionati a sinistra e lascia la destra vuota. Tab sposta il cursore fra le celle e dall'ultima crea una sezione. **Dividi dal cursore** continua il contenuto nella stessa colonna di una nuova sezione preservando la formattazione del testo; agisce su paragrafi, titoli e blocchi di codice direttamente contenuti nella cella. Il ritorno a una colonna ricompone ogni sezione nell'ordine sinistra, destra.

La paginazione distribuisce le righe delle sezioni sui fogli. Una singola sezione più alta dell'area utile richiede una divisione: l'editor la segnala e consente di scorrere le celle per raggiungere il punto da separare. Non è implementato il flusso automatico fra colonne consecutive tipico dell'impaginazione di un giornale.

## Confine fra interfaccia e sistema

Il frontend Electron usa isolamento del contesto, sandbox e integrazione Node disattivata. Il ponte espone operazioni specifiche per apertura, salvataggio, recupero bozze, PDF, stampa e stato delle modifiche. Il processo principale controlla il mittente delle richieste e consente l'accesso ai file scelti nei dialoghi.

La distribuzione carica risorse locali; navigazioni, nuove finestre e richieste a origini esterne vengono bloccate. La stampa ha una finestra separata, JavaScript disabilitato e un filtro HTML indipendente. Sono previsti limiti di dimensione e complessità per ridurre gli errori su documenti eccessivi o non validi.

## Sviluppo e distribuzione

Lo sviluppo desktop avvia Vite ed Electron. `pnpm build` controlla TypeScript e produce il frontend; `pnpm run pack` costruisce la cartella autonoma Windows x64 `release/JScript-0.3.2-Windows`. `pack:exe` e `pack:installer` confezionano quella cartella esistente usando electron-builder. Occorre quindi rigenerare la cartella quando cambia il sorgente. Il percorso versionato conserva la precedente distribuzione anche se è ancora aperta.

L'eseguibile unico estrae temporaneamente il programma; la cartella autonoma si avvia mantenendo insieme runtime e risorse; l'installer aggiunge l'installazione per l'utente corrente e i collegamenti. Tutte le varianti usano l'archivio nel profilo Windows.

La preparazione di questi pacchetti avviene su Windows x64 con Node.js per Windows. WSL è opzionale per il frontend e non sostituisce questo ambiente di confezionamento. Nel repository [jpacci0/JScript](https://github.com/jpacci0/JScript), il workflow GitHub Actions verifica i push su main e le pull request. Un tag `vX.Y.Z` corrispondente alla versione del progetto prepara portable e installer, verifica anche l'app installata e pubblica i download con i rispettivi SHA256. Gli esiti di ciascuna esecuzione sono visibili nella sezione Actions.

## Evoluzioni possibili

Le prossime modifiche possono concentrarsi sulla qualità dei formati di scambio, su una ricerca che attraversi i nodi formattati e su una maggiore corrispondenza fra vista e stampa. Un'eventuale PWA richiederebbe una strategia di cache e gestione dei file; sincronizzazione e collaborazione richiederebbero inoltre identità, servizio remoto e gestione dei conflitti.

Per l'architettura attuale non sono necessarie queste componenti: l'archivio locale e i file esportati coprono il flusso personale previsto.
