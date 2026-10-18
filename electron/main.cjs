'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const { withPrintWindow } = require('./print.cjs');
const { normalizeLayout, pageDimensions } = require('./layout.cjs');

const DEV_ORIGIN = 'http://localhost:5173';
const DEVELOPMENT = !app.isPackaged && process.env.JSCRIPT_DEV === '1';
const DIST_DIRECTORY = path.resolve(__dirname, '..', 'dist');
const INDEX_FILE = path.join(DIST_DIRECTORY, 'index.html');
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_AUTOSAVE_BYTES = 150 * 1024 * 1024;
const EXTENSIONS = ['jscript', 'docx', 'txt', 'html', 'htm'];
let mainWindow = null;
let dirty = false;
let allowClose = false;
let checkingClose = false;
let dialogOpen = false;
let pendingSaves = 0;
let autosaveQueue = Promise.resolve();

app.setName('JScript');

function autosavePath() {
  return path.join(app.getPath('userData'), 'documents.json');
}

function assertSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()
      || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Richiesta non autorizzata.');
  }
  const url = new URL(event.senderFrame.url);
  const expected = DEVELOPMENT
    ? url.origin === DEV_ORIGIN
    : url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === INDEX_FILE;
  if (!expected) throw new Error('Origine non autorizzata.');
}

function handle(channel, callback) {
  ipcMain.handle(`jscript:${channel}`, (event, ...args) => {
    assertSender(event);
    return callback(...args);
  });
}

function safeName(input, fallback = 'Documento.jscript') {
  if (typeof input !== 'string' || input.length > 500) throw new Error('Nome file non valido.');
  const name = input.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[.\s]+$/g, '').slice(0, 180) || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

async function atomicWrite(filename, data, backup = false) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await fs.open(temporary, 'wx', 0o600);
    await file.writeFile(data);
    await file.sync();
    await file.close();
    file = null;
    if (backup) {
      try {
        // Only preserve a complete, parseable previous state as the backup.
        const previous = await fs.readFile(filename, 'utf8');
        JSON.parse(previous);
        await atomicWrite(`${filename}.bak`, previous);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
    }
    await fs.rename(temporary, filename);
  } finally {
    if (file) await file.close();
    await fs.rm(temporary, { force: true });
  }
}

async function withDialog(callback) {
  if (dialogOpen) return null;
  dialogOpen = true;
  try {
    return await callback();
  } finally {
    dialogOpen = false;
  }
}

function registerHandlers() {
  handle('open-file', () => withDialog(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Apri un documento',
      buttonLabel: 'Apri',
      properties: ['openFile'],
      filters: [{ name: 'Documenti', extensions: EXTENSIONS }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0];
    if (!EXTENSIONS.includes(path.extname(filename).slice(1).toLowerCase())) {
      throw new Error('Questo formato non è supportato.');
    }
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 50 MB.');
    const data = await fs.readFile(filename);
    if (data.byteLength > MAX_FILE_BYTES) throw new Error('Il file supera il limite di 50 MB.');
    return { name: path.basename(filename), data: Array.from(data) };
  }));

  handle('save-file', (file) => withDialog(async () => {
    if (!file || !Array.isArray(file.data) || file.data.length > MAX_FILE_BYTES
        || !file.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error('Dati del file non validi o superiori a 50 MB.');
    }
    const name = safeName(file.name);
    const extension = path.extname(name).slice(1).toLowerCase();
    if (![...EXTENSIONS, 'pdf', 'md'].includes(extension)) throw new Error('Estensione del file non valida.');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salva documento', defaultPath: name, buttonLabel: 'Salva',
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, Buffer.from(file.data));
    return result.filePath;
  }));

  handle('load-autosave', async () => {
    await autosaveQueue;
    let primaryError = null;
    for (const filename of [autosavePath(), `${autosavePath()}.bak`]) {
      try {
        const stat = await fs.stat(filename);
        if (stat.size > MAX_AUTOSAVE_BYTES) throw new Error('Archivio locale troppo grande.');
        return JSON.parse(await fs.readFile(filename, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') primaryError ||= error;
      }
    }
    if (primaryError) throw new Error('Impossibile recuperare i documenti locali. Le copie originali sono state conservate.');
    return null;
  });

  handle('save-autosave', (state) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Archivio non valido.');
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AUTOSAVE_BYTES) {
      throw new Error('L’archivio locale supera il limite di 150 MB. Esporta alcuni documenti prima di rimuoverli.');
    }
    pendingSaves += 1;
    const save = autosaveQueue.then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await atomicWrite(autosavePath(), serialized, true);
      return true;
    });
    // A failed write must reject its caller, but must not poison later saves.
    autosaveQueue = save.catch(() => {}).finally(() => { pendingSaves -= 1; });
    return save;
  });

  handle('set-dirty', (value) => {
    if (typeof value !== 'boolean') throw new Error('Stato documento non valido.');
    dirty = value;
    if (mainWindow) mainWindow.setDocumentEdited(value);
    return true;
  });

  handle('export-pdf', (document) => withDialog(async () => {
    if (!document || typeof document.title !== 'string') throw new Error('Documento non valido.');
    const name = `${safeName(document.title, 'Documento').replace(/\.pdf$/i, '')}.pdf`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Esporta PDF', defaultPath: name, buttonLabel: 'Esporta',
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    const dimensions = pageDimensions(document.layout);
    const data = await withPrintWindow(document, app.getPath('temp'), (contents) => contents.printToPDF({
      // PDF pageSize uses inches. CSS supplies the exact oriented size and
      // margins, so no additional landscape rotation or margins are applied.
      pageSize: { width: dimensions.width / 25.4, height: dimensions.height / 25.4 },
      preferCSSPageSize: true, printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      generateDocumentOutline: true,
    }));
    await atomicWrite(result.filePath, data);
    return result.filePath;
  }));

  handle('print-document', (document) => withDialog(() => withPrintWindow(
    document,
    app.getPath('temp'),
    (contents) => new Promise((resolve) => {
      const layout = normalizeLayout(document.layout);
      // Native print accepts named paper sizes; its custom margins use pixels.
      contents.print({
        silent: false,
        printBackground: true,
        pageSize: layout.pageSize,
        landscape: layout.orientation === 'landscape',
        margins: {
          marginType: 'custom',
          top: layout.margins.top * 96 / 25.4,
          right: layout.margins.right * 96 / 25.4,
          bottom: layout.margins.bottom * 96 / 25.4,
          left: layout.margins.left * 96 / 25.4,
        },
      }, (success) => resolve(success));
    }),
  )));
}

function allowAppRequest(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
    if (DEVELOPMENT) return ['http:', 'ws:'].includes(parsed.protocol) && parsed.hostname === 'localhost' && parsed.port === '5173';
    if (parsed.protocol !== 'file:') return false;
    const relative = path.relative(DIST_DIRECTORY, fileURLToPath(parsed));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function createWindow() {
  allowClose = false;
  dirty = false;
  mainWindow = new BrowserWindow({
    title: 'JScript', width: 1440, height: 960, minWidth: 1000, minHeight: 700,
    icon: path.join(DIST_DIRECTORY, 'icon.png'),
    show: false, backgroundColor: '#f7f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      partition: 'persist:jscript',
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: true,
    },
  });
  const contents = mainWindow.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.webRequest.onBeforeRequest((details, reply) => reply({ cancel: !allowAppRequest(details.url) }));
  contents.session.on('will-download', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', async (event) => {
    if (allowClose || (!dirty && pendingSaves === 0)) return;
    event.preventDefault();
    if (checkingClose) return;
    checkingClose = true;
    try {
      await autosaveQueue;
      if (dirty) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: 'Modifiche non salvate',
          message: 'Alcune modifiche non sono ancora state salvate.',
          detail: 'Puoi tornare al documento per salvarle oppure chiudere e perdere soltanto le modifiche non salvate.',
          buttons: ['Torna al documento', 'Chiudi senza salvare'],
          defaultId: 0, cancelId: 0, noLink: true,
        });
        if (result.response !== 1) return;
      }
      allowClose = true;
      if (mainWindow) mainWindow.close();
    } finally {
      checkingClose = false;
    }
  });
  const load = DEVELOPMENT ? mainWindow.loadURL(DEV_ORIGIN) : mainWindow.loadFile(INDEX_FILE);
  load.catch((error) => {
    dialog.showErrorBox('Impossibile avviare JScript', DEVELOPMENT
      ? 'Avvia prima il server Vite sulla porta 5173.\n\n' + error.message
      : 'La build dell’interfaccia non è disponibile. Esegui npm run build.\n\n' + error.message);
    allowClose = true;
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerHandlers();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    dialog.showErrorBox('Errore di avvio', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
