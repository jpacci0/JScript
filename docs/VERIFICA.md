# Verifica delle versioni

## Versione 0.3.2 — barra Layout riducibile

Il pannello Layout è riorganizzato in quattro gruppi compatti con campi ed etichette affiancati, testi da 10 px e controlli alti 28 px. La freccia Riduci/Mostra nella riga delle schede chiude o riapre il pannello; quando è chiuso, anche Scrittura e Layout lo riaprono. La logica documentale rimane invariata.

TypeScript e build Vite completati. La nuova verifica `ribbon-desktop.cjs`, inclusa in `test:desktop`, è superata sull'eseguibile confezionato con un profilo temporaneo isolato. Il pannello misura 135 px a larghezze di 2048 e 1424 px, e 182 px a 1280 e 1024 px, anche con tutti i comandi delle colonne attivi. Nessuno scorrimento orizzontale, dieci campi a 10 px e 28 px di altezza, quattordici frecce visibili.

Verificati riduzione e riapertura degli strumenti, spazio recuperato dal foglio, applicazione del valore numerico in modifica prima della chiusura, scrittura con pannello nascosto, frecce dell'interlinea e passaggio fra schede tramite tastiera. Controllo visivo in tema chiaro e scuro; nessun errore JavaScript. Le suite documentali complete non sono state rieseguite per questa modifica dell'interfaccia; lo storico seguente rimane riferito alle rispettive versioni.

Generati la cartella autonoma, l'eseguibile unico portable e l'installer Windows x64 0.3.2. L'installer è stato compilato ma non installato nel profilo dell'utente.

## Versione 0.3.1 — controlli Layout compatti

Ritocco dello stile: etichette, valori e legende da 12 px, controlli alti 34 px, note da 11 px e frecce numeriche visibili. Da 1700 px di larghezza, margini e spaziatura mostrano rispettivamente quattro e tre campi affiancati. La logica del documento, delle colonne e della paginazione rimane invariata.

Build Vite completata. Controllo visivo dell'eseguibile confezionato a 2040 × 1000 e 1424 × 920 px, con profilo temporaneo isolato: dieci campi con etichette e valori a 12 px, controlli alti 34 px, nessuna eccedenza orizzontale del pannello. Verificate le quattordici frecce e l'aumento/riduzione dell'interlinea; nessun errore JavaScript rilevato. Le suite documentali complete non sono state rieseguite per questo ritocco CSS; gli esiti sotto appartengono alle versioni precedenti.

Generati la cartella autonoma, l'eseguibile unico portable e l'installer Windows x64 0.3.1. L'installer è stato compilato ma non installato nel profilo dell'utente.

## Versione 0.3.0 — colonne e controlli Layout

Sono confermati 30 test unitari superati sul motore documentale, inclusi layout a colonne, bordi, larghezze, spazio centrale, immagini e HTML realmente prodotto dall'editor per il PDF. La suite desktop include `columns-desktop.cjs`, oltre alle verifiche generali, Layout e paginazione.

TypeScript e build Vite completati. Le suite Layout e paginazione sono superate sulla build aggiornata. La suite colonne è superata anche avviando l'eseguibile confezionato, con un profilo temporaneo isolato: dimensioni dei caratteri, sette campi con frecce, limiti, tastiera, autosalvataggio, proporzioni, annulla/ripristina, divisione delle sezioni, riapertura, 35 sezioni su più pagine e ritorno al testo senza perdita.

Il PDF effettivamente esportato è stato riletto con pypdf e pdfplumber e controllato visivamente: A4, colonne 1:2 allineate, margine di 20 mm, spazio centrale, tutti i testi e nessun bordo visibile. Il DOCX è verificato per contenuti, larghezze e assenza di bordi.

Generati la cartella autonoma, l'eseguibile unico portable e l'installer Windows x64 0.3.0. L'installer è stato compilato ma non installato nel profilo dell'utente. I risultati sotto riguardano le versioni precedenti.

## Versione 0.2.1 — paginazione

Verifiche locali confermate su Windows x64:

- TypeScript e build Vite completati; 22 test unitari superati.
- Suite `desktop.cjs`, `layout-desktop.cjs` e `pagination-desktop.cjs` superate.
- Paginazione verificata con 42 pressioni di Invio, annulla/ripristina, riduzione del contenuto a una pagina, un singolo paragrafo lungo e formattazione attraverso più fogli.
- Verificati salvataggio e riapertura, formato nativo, DOCX, PDF, cambiamenti Layout e una tabella di 35 righe.
- PDF riletti con pypdf: il caso con righe vuote produce due pagine A4 con il marcatore sulla seconda; il paragrafo lungo produce quattro pagine con testo iniziale e finale conservati.
- Suite di paginazione superata anche avviando `release/JScript-0.2.1-Windows/JScript.exe`, con un profilo di prova isolato.

Generati la cartella autonoma, l'eseguibile unico portable e l'installer Windows x64 della versione 0.2.1. L'installer è stato compilato ma non installato nel profilo dell'utente. I risultati della versione precedente sono conservati sotto come riferimento storico.

## Versione 0.2.0 — risultati precedenti

Verifiche locali eseguite il 18 ottobre 2026 su Windows x64:

- TypeScript e build Vite completati.
- 17 test del formato nativo, del layout e del motore DOCX superati: documenti precedenti, limiti dei valori, dimensioni, margini e spaziature OOXML, immagini entro la larghezza utile e titoli indipendenti dalla spaziatura del testo.
- Avvio effettivo dell'app Electron e controllo visivo di home ed editor.
- Test end-to-end sulla build di sviluppo e sulla cartella portatile confezionata: modifica Unicode, inserimento tabella, annulla/ripristina, salvataggio automatico e riapertura, salvataggio `.jscript`, esportazione e reimportazione DOCX, esportazione PDF, tema scuro e modalità concentrazione.
- PDF di prova riletto con un parser indipendente: formato A4, una pagina, testo Unicode presente.
- Layout provato nell'app: A5 orizzontale, quattro margini differenti, interlinea e spaziatura; salvataggio e riapertura, esportazione e reimportazione `.jscript`, isolamento fra documenti e ripristino dei valori iniziali.
- PDF Layout riletto con pypdf e pdfplumber: pagina 210 × 148 mm, testo Unicode, margine sinistro di 15 mm e testo entro i limiti richiesti; controllo visivo della pagina renderizzata.
- Nessun errore JavaScript rilevato dai test end-to-end.

I test usano un profilo temporaneo separato dalle bozze dell'utente. Le schermate e i documenti di prova sono esclusi dai sorgenti distribuiti.

Queste verifiche coprono documenti semplici. Non certificano la compatibilità con tutte le versioni di Word, con layout complessi o con ogni driver di stampa. La stampa fisica non è stata provata.

Il workflow GitHub è predisposto nel sorgente; non è stato eseguito su un repository remoto di JScript in questa sessione.
