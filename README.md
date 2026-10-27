# JScript

JScript è un editor di documenti per Windows, pensato per scrivere in uno spazio pulito ed essenziale. Questa prima versione è destinata all'uso personale, funziona in locale e non richiede un account.

## Scarica JScript 0.3.2

[Release v0.3.2](https://github.com/jpacci0/JScript/releases/tag/v0.3.2) per Windows x64:

| Download | Uso |
| --- | --- |
| [Installer Windows](https://github.com/jpacci0/JScript/releases/download/v0.3.2/JScript-0.3.2-Setup-x64.exe) | Installa l'app per l'utente corrente e crea i collegamenti. |
| [Eseguibile portable](https://github.com/jpacci0/JScript/releases/download/v0.3.2/JScript-0.3.2-Windows.exe) | Avvia l'app senza installazione. |
| [Codice sorgente ZIP](https://github.com/jpacci0/JScript/archive/refs/tags/v0.3.2.zip) | Archivio del sorgente associato al tag della versione. |

Gli eseguibili non sono firmati con un certificato di code signing: Windows può mostrare un avviso all'avvio.

La release **0.3.2** resta il download pubblicato indicato sopra. Il codice corrente di `main` include aggiornamenti successivi: titolo, stampa e salvataggio nella barra del logo; controlli Layout in menu compatti; importazione Word più completa; correzione delle parole spezzate al cambio pagina negli elenchi importati. Queste modifiche del sorgente non aggiornano automaticamente gli eseguibili della release 0.3.2.

## Avviare l'app

La distribuzione Windows prevede tre possibilità:

| Distribuzione | File | Come usarla |
| --- | --- | --- |
| Cartella senza installazione | `release/JScript-0.3.2-Windows/JScript.exe` | Apri `JScript.exe` e conserva insieme **tutti** i file della cartella. Puoi spostare l'intera cartella. |
| Eseguibile unico senza installazione | `release/JScript-0.3.2-Windows.exe` | Apri il file: il programma estrae temporaneamente il runtime necessario all'avvio. |
| Programma di installazione | `release/JScript-0.3.2-Setup-x64.exe` | Installa JScript per l'utente corrente, con collegamenti sul desktop e nel menu Start. |

L'app confezionata include il necessario per funzionare: non serve installare Node.js o WSL. Questi percorsi sono gli output dei comandi di creazione descritti sotto; la loro disponibilità dipende dai pacchetti effettivamente generati.

`Avvia-JScript.cmd` preferisce la cartella della versione 0.3.2; se assente prova la 0.3.1, la 0.3.0, la 0.2.1 e infine `release/JScript-Windows`. Le cartelle versionate permettono di conservare le vecchie app senza sovrascriverle.

La modalità senza installazione riguarda il programma. **Le bozze rimangono nel profilo Windows**, normalmente in `%APPDATA%/JScript`, anche quando l'eseguibile è su una chiavetta. Per portare i documenti su un altro PC, usa **Salva copia** e trasferisci i file `.jscript`.

## Scrivere e salvare

1. Crea una pagina bianca oppure parti da Appunti, Lettera o Progetto.
2. Scrivi e formatta il documento. Puoi usare titoli, font, dimensioni, colori, evidenziazione, allineamento, elenchi e citazioni.
3. Inserisci immagini PNG, JPEG o WebP e tabelle. La barra contestuale delle tabelle consente di aggiungere o eliminare righe e colonne.
4. La bozza viene salvata automaticamente sul dispositivo. **Salva copia** crea un file `.jscript` nella posizione scelta.
5. Apri **Layout** per scegliere A4, A5 o Letter, orientamento verticale/orizzontale, margini e spaziatura. Le modifiche si applicano al documento intero e vengono salvate insieme alla bozza.
6. Dal menu accanto a **Salva copia** puoi esportare in Word, PDF o testo semplice. Titolo, stato di salvataggio, stampa e comandi del documento sono nella barra superiore accanto al logo.

Sono disponibili tema chiaro e scuro, modalità concentrazione, zoom, ricerca nel testo, navigazione per titoli e conteggio di parole e caratteri. La struttura laterale serve a navigare: non inserisce un sommario automatico nel documento.

| Scorciatoia | Azione |
| --- | --- |
| `Ctrl+N` | Nuovo documento |
| `Ctrl+O` | Apri un file dal computer |
| `Ctrl+S` | Salva una copia `.jscript` |
| `Ctrl+P` | Stampa |
| `Ctrl+F` | Cerca nel documento |
| `Ctrl+B`, `Ctrl+I`, `Ctrl+U` | Grassetto, corsivo, sottolineato |
| `Ctrl+Z`, `Ctrl+Y` | Annulla, ripristina |
| `Esc` | Esci dalla concentrazione e chiudi ricerca o menu |

## Formati e compatibilità

| Formato | Apertura | Esportazione | Uso previsto |
| --- | --- | --- | --- |
| `.jscript` | Sì | Sì | Conservare contenuto, formattazione e impostazioni Layout di JScript |
| `.docx` | Sì | Sì | Scambiare testo, formattazione, tabelle e geometria di pagina supportati |
| `.txt` | Sì | Sì | Testo senza formattazione |
| `.html`, `.htm` | Sì | No | Importare contenuti essenziali, eliminando gli stili avanzati e le immagini esterne |
| `.pdf` | No | Sì | Condividere una versione con il layout scelto |
| `.doc` | No | No | Il vecchio formato Word non è supportato |

L'importazione DOCX legge direttamente il documento Word e conserva le proprietà supportate: font, dimensioni, colori anche da tema, stili ereditati, rientri, spazi prima/dopo e interlinea; elenchi, collegamenti, immagini incorporate e tabelle con larghezze, celle unite, bordi e riempimenti. Recupera formato A4/A5/Letter, orientamento e margini della prima sezione. I font assenti sul PC vengono sostituiti dal sistema.

**Non è una riproduzione completa di Word.** Formati pagina personalizzati, sezioni con geometrie diverse, tabulazioni, numerazioni speciali e oggetti flottanti possono essere adattati. Intestazioni, piè di pagina, note e commenti non sono importati; le revisioni diventano testo finale e i campi automatici non vengono ricalcolati. Se sono rilevati elementi adattati, **Dettagli Word** ne mostra l'elenco, conservato anche nella copia `.jscript`.

Il salvataggio nativo e l'esportazione DOCX mantengono gli attributi Word supportati, inclusi i rientri e le destinazioni dei collegamenti ammessi. Non viene conservato il pacchetto Word originale per una riapertura senza perdite.

L'editor mostra **fogli separati con paginazione automatica**: anche le righe vuote proseguono sul foglio successivo. Le pagine si aggiornano mentre aggiungi o elimini testo e quando modifichi il layout. Il documento resta unico, con una sola cronologia Annulla/Ripristina. Negli elenchi Word il rientro sporgente del punto o numero non viene applicato di nuovo al testo: le prime lettere restano con la riga anche al cambio pagina.

Esportazione e stampa usano le stesse impostazioni Layout. I motori di impaginazione possono però distribuire diversamente testo e tabelle: la vista dell'editor non garantisce una corrispondenza esatta con Word o PDF. Controlla il documento esportato prima di condividerlo.

Il limite di importazione è 25 MB per documento; le immagini aggiunte dalla barra possono pesare al massimo 5 MB ciascuna. Sono previsti ulteriori limiti di complessità per l'archivio locale e i file importati.

## Layout del documento

La scheda **Layout**, accanto a **Scrittura**, mostra quattro pulsanti con un riepilogo delle impostazioni. Ogni pulsante apre un pannello compatto:

- **Pagina:** formato A4, A5 o Letter e orientamento verticale/orizzontale.
- **Margini:** preset Normali (20 mm), Stretti (12,7 mm), Ampi (25,4 mm), oppure quattro valori personalizzati da 5 a 50 mm.
- **Spaziatura:** interlinea da 1 a 3 e spazio prima/dopo da 0 a 48 punti. La modifica sostituisce i corrispondenti valori importati da Word; i titoli creati in JScript conservano il proprio stile.
- **Colonne:** sezioni con due colonne uguali oppure una laterale più stretta.

I pannelli si aprono sotto **Pagina**, **Margini**, **Spaziatura** o **Colonne** e si chiudono con Esc o un clic esterno. I campi numerici restano affiancati alle etichette e alle frecce di incremento. La freccia **Riduci/Mostra** nella riga delle schede chiude o riapre gli strumenti; un clic su **Scrittura** o **Layout** li riapre. La barra superiore unica e i pannelli a comparsa lasciano più altezza al foglio sui portatili.

**Ripristina layout** ritorna ad A4 verticale, margini di 20 mm, interlinea 1,7, spazio prima 0 pt e dopo 10,8 pt.

I campi numerici si applicano premendo Invio o passando al controllo successivo. Le impostazioni valgono per il documento intero, vengono recuperate con la bozza e conservate nei file `.jscript`. I vecchi documenti senza impostazioni Layout usano i valori predefiniti. Le esportazioni DOCX, PDF e la stampa ricevono formato, orientamento, margini e spaziature; i driver di stampa possono imporre propri limiti fisici. Un file Word può mantenere spaziature diverse per paragrafo finché non le sostituisci dal pannello **Spaziatura**.

## Sezioni a due colonne

Nella scheda **Layout**, apri **Colonne** e scegli **Due uguali** (50/50) oppure **Laterale stretta** (33/67). Il paragrafo corrente o i blocchi selezionati passano nella colonna sinistra; la destra parte vuota. Puoi scrivere nelle due colonne in modo indipendente. Le sezioni vengono esportate senza bordi in Word e PDF.

- **Aggiungi sezione** inserisce un'altra coppia di colonne sotto quella corrente.
- **Tab** passa fra le celle; dall'ultima aggiunge una nuova sezione.
- **Dividi dal cursore** continua il contenuto nella stessa colonna di una nuova sezione, conservando la formattazione del testo. È disponibile nei paragrafi, titoli e blocchi di codice direttamente contenuti nella colonna.
- **Torna a una colonna** riporta ogni sezione al normale flusso del documento, leggendo prima la sinistra e poi la destra.

Le sezioni proseguono sui fogli successivi. Se una singola sezione supera l'altezza utile del foglio, l'editor mostra un avviso e rende scorrevoli le celle: usa **Dividi dal cursore** per distribuirla in sezioni più corte. Il testo non passa automaticamente dalla fine della colonna sinistra all'inizio della destra come in un giornale.

## Dove sono le bozze

JScript conserva l'archivio in `documents.json`, nella cartella dati dell'app. Durante il salvataggio mantiene anche `documents.json.bak`, una copia precedente utilizzata se il file principale manca o non è leggibile come JSON. Il backup locale non è una cronologia delle revisioni e non sostituisce una copia su un altro dispositivo.

L'apertura di un file crea una bozza nell'archivio: non modifica automaticamente il file originale. **Salva copia** ed esportazione chiedono dove scrivere il risultato. Eliminare una bozza dalla barra laterale non elimina le copie già esportate.

Non sono presenti sincronizzazione cloud, collaborazione o invio automatico dei documenti a servizi esterni.

## Sviluppo

Stack: Electron 41, React 19, TypeScript, Vite 7 e Tiptap 3. `tiptap-pagination-plus` e `tiptap-table-plus`, entrambi alla versione 3.1.0, gestiscono pagine e tabelle nell'editor. L'importatore OOXML usa JSZip per leggere i DOCX; `docx` genera le esportazioni. DOMPurify e `sanitize-html` filtrano rispettivamente l'HTML importato e quello destinato alla stampa.

Servono **Node.js per Windows 22.12 o successivo**, pnpm e Windows x64 per confezionare l'app desktop. Dalla cartella del progetto:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dev
```

| Comando | Funzione |
| --- | --- |
| `pnpm dev` | Avvia il frontend nel browser |
| `pnpm desktop:dev` | Avvia Vite ed Electron insieme |
| `pnpm build` | Controlla i tipi TypeScript e genera `dist` |
| `pnpm test` | Esegue i test dei documenti |
| `pnpm test:desktop` | Esegue le verifiche desktop, Layout, paginazione anche con elenchi Word, colonne e barra riducibile; prepara prima la build |
| `pnpm run pack` | Ricompila e crea la cartella `release/JScript-0.3.2-Windows` |
| `pnpm pack:exe` | Crea l'eseguibile unico dalla cartella già preparata |
| `pnpm pack:installer` | Crea l'installer dalla cartella già preparata |

Per distribuire questa versione esegui `pnpm run pack` prima di `pnpm pack:exe` e `pnpm pack:installer`: gli ultimi due comandi usano la cartella `JScript-0.3.2-Windows` già preparata e non ricompilano il sorgente.

WSL è facoltativo per lavorare sul frontend. Per generare questi `.exe` usa Node.js e i comandi **su Windows**; lo script della cartella portatile richiede esplicitamente Windows x64.

Nel browser le bozze sono salvate in IndexedDB e le esportazioni sono download. Questa modalità serve allo sviluppo e a una futura versione web: non è una PWA installabile completa e non condivide automaticamente le bozze con l'app desktop.

## Repository e automazione

Il repository è [jpacci0/JScript](https://github.com/jpacci0/JScript), con il codice sul ramo `main`. Il workflow [Windows build and release](https://github.com/jpacci0/JScript/actions/workflows/windows-release.yml) esegue le verifiche su pull request e aggiornamenti di `main`; l'avvio manuale prepara gli artefatti Windows.

Un tag `vX.Y.Z` corrispondente alla versione in `package.json`, per esempio `v0.3.2`, attiva la costruzione e la pubblicazione della Release con installer, portable e checksum SHA256. Gli eseguibili sono distribuiti tramite le Release e restano esclusi dalla cronologia dei sorgenti.

La distinzione fra cartella portatile, eseguibile unico e installer segue l'impostazione usata per [Folio](https://github.com/jpacci0/folio). Folio rimane un progetto separato.

Per le motivazioni tecniche e i limiti progettuali, leggi [ARCHITETTURA.md](docs/ARCHITETTURA.md).
