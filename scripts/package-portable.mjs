import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');
const folderName = process.argv[2] || 'JScript-Windows';
if (!/^[a-z\d][a-z\d._-]*$/i.test(folderName) || folderName === '.' || folderName === '..') {
  throw new Error('Usa un semplice nome di cartella all’interno di release.');
}
const target = path.join(releaseRoot, folderName);
const staging = path.join(releaseRoot, `.jscript-pack-${randomUUID()}`);
const previous = path.join(releaseRoot, `.jscript-previous-${randomUUID()}`);
const require = createRequire(path.join(root, 'package.json'));
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeDependencies = ['sanitize-html'];

function assertReleaseChild(directory) {
  const absolute = path.resolve(directory);
  const relative = path.relative(releaseRoot, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Percorso del pacchetto fuori da release: ${absolute}`);
  }
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Il percorso del pacchetto non può essere un collegamento: ${absolute}`);
  }
  return absolute;
}

function removeReleaseChild(directory) {
  fs.rmSync(assertReleaseChild(directory), { recursive: true, force: true });
}

function packageDirectory(name, owner) {
  const resolver = createRequire(path.join(owner, 'package.json'));
  try {
    return fs.realpathSync(path.dirname(resolver.resolve(`${name}/package.json`)));
  } catch (error) {
    // Some packages keep package.json out of their exports map.
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Packages such as @tiptap/pm expose only subpaths, with no main entry.
    // Follow the resolver's search paths to inspect their installed manifest.
    for (const lookup of resolver.resolve.paths(name) || []) {
      const directory = path.join(lookup, name);
      const filename = path.join(directory, 'package.json');
      if (fs.existsSync(filename)) {
        const candidate = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (candidate.name === name) return fs.realpathSync(directory);
      }
    }
    let directory = path.dirname(resolver.resolve(name));
    while (true) {
      const filename = path.join(directory, 'package.json');
      if (fs.existsSync(filename)) {
        const candidate = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (candidate.name === name) return fs.realpathSync(directory);
      }
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Impossibile trovare il pacchetto ${name}.`);
      directory = parent;
    }
  }
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Crea questo pacchetto su Windows x64 usando Node.js per Windows.');
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Esegui prima la build.');
const electronRoot = path.dirname(require.resolve('electron/package.json'));
const electronDist = path.join(electronRoot, 'dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  throw new Error('Il runtime Electron Windows non è installato.');
}
assertReleaseChild(target);
assertReleaseChild(staging);
assertReleaseChild(previous);
fs.mkdirSync(releaseRoot, { recursive: true });
fs.mkdirSync(staging);

try {
  // Start from a clean Electron runtime; never include a previous release's files.
  fs.cpSync(electronDist, staging, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'electron.exe',
  });
  fs.copyFileSync(path.join(electronDist, 'electron.exe'), path.join(staging, 'JScript.exe'));
  const application = path.join(staging, 'resources', 'app');
  fs.mkdirSync(application, { recursive: true });
  fs.cpSync(path.join(root, 'dist'), path.join(application, 'dist'), { recursive: true });
  fs.cpSync(path.join(root, 'electron'), path.join(application, 'electron'), { recursive: true });
  const installed = new Map();
  const licensed = new Set();
  const licenseFolder = path.join(staging, 'Licenze');
  const notices = [];
  fs.mkdirSync(licenseFolder);

  function copyLicense(packageRoot) {
    if (licensed.has(packageRoot)) return;
    licensed.add(packageRoot);
    const info = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    notices.push({ name: info.name, version: info.version, license: info.license || 'See package license', author: info.author, repository: info.repository, homepage: info.homepage });
    const prefix = `${info.name.replace(/[@/]/g, '_')}-${info.version}`;
    for (const filename of fs.readdirSync(packageRoot)) {
      if (/^(licen[cs]e|ofl|notice|copying)(\.|$)/i.test(filename)
          && fs.statSync(path.join(packageRoot, filename)).isFile()) {
        fs.copyFileSync(path.join(packageRoot, filename), path.join(licenseFolder, `${prefix}-${filename}`));
      }
    }
  }

  function dependenciesOf(info) {
    return Object.keys({ ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies });
  }

  function isOptional(info, name) {
    return Boolean(info.optionalDependencies?.[name] || info.peerDependenciesMeta?.[name]?.optional);
  }

  function resolveDependency(name, owner, info) {
    try {
      return packageDirectory(name, owner);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && isOptional(info, name)) return null;
      throw error;
    }
  }

  function copyDependency(name, source, owner) {
    // Match Node's ancestor lookup. Reuse matching versions, and nest only when
    // an ancestor would otherwise resolve a different version of this package.
    let directory = owner;
    let conflict = false;
    while (true) {
      const candidate = path.join(directory, 'node_modules', name);
      const existing = installed.get(candidate);
      if (existing) {
        if (existing === source) return;
        conflict = true;
        break;
      }
      if (directory === application) break;
      directory = path.dirname(directory);
    }
    const destination = path.join(conflict ? owner : application, 'node_modules', name);
    installed.set(destination, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: (filename) => !['node_modules', '.git'].includes(path.basename(filename)),
    });
    const info = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    copyLicense(source);
    for (const dependency of dependenciesOf(info)) {
      const dependencySource = resolveDependency(dependency, source, info);
      if (dependencySource) copyDependency(dependency, dependencySource, destination);
    }
  }

  const dependencyVersions = {};
  for (const dependency of runtimeDependencies) {
    const source = packageDirectory(dependency, root);
    dependencyVersions[dependency] = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
    copyDependency(dependency, source, application);
  }

  // Renderer dependencies are already bundled by Vite, but retain their license
  // notices and the notices of their transitive dependencies in the distribution.
  const visitedNotices = new Set();
  function collectNotices(source) {
    if (visitedNotices.has(source)) return;
    visitedNotices.add(source);
    copyLicense(source);
    const info = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const dependency of dependenciesOf(info)) {
      const dependencySource = resolveDependency(dependency, source, info);
      if (dependencySource) collectNotices(dependencySource);
    }
  }
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    collectNotices(packageDirectory(dependency, root));
  }

  fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify({
    name: metadata.name,
    productName: 'JScript',
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    main: 'electron/main.cjs',
    type: 'module',
    dependencies: dependencyVersions,
  }, null, 2));
  fs.writeFileSync(path.join(licenseFolder, 'pacchetti.json'), JSON.stringify(
    notices.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), null, 2,
  ));
  if (fs.existsSync(path.join(root, 'README.md'))) {
    fs.copyFileSync(path.join(root, 'README.md'), path.join(staging, 'LEGGIMI.md'));
  } else {
    fs.writeFileSync(path.join(staging, 'LEGGIMI.txt'),
      'JScript\r\n\r\nAvvia JScript.exe e conserva insieme tutti i file di questa cartella.\r\nNon richiede Node.js, WSL o una connessione Internet.\r\nI documenti vengono salvati nel profilo locale di Windows.\r\n');
  }

  // Verify Node can resolve the sanitizer from the packaged application itself.
  const packagedRequire = createRequire(path.join(application, 'package.json'));
  const resolvedSanitizer = packagedRequire.resolve('sanitize-html');
  if (!resolvedSanitizer.startsWith(application + path.sep)) throw new Error('Dipendenza runtime mancante nel pacchetto.');
  const sanitizeHtml = packagedRequire('sanitize-html');
  if (sanitizeHtml('<p>JScript</p><script>bad()</script>') !== '<p>JScript</p>') {
    throw new Error('Verifica del sanitizer nel pacchetto non riuscita.');
  }

  // Replace the previous output only after the new package has been completed.
  const hadPrevious = fs.existsSync(target);
  if (hadPrevious) fs.renameSync(assertReleaseChild(target), assertReleaseChild(previous));
  try {
    fs.renameSync(assertReleaseChild(staging), assertReleaseChild(target));
  } catch (error) {
    if (hadPrevious) fs.renameSync(assertReleaseChild(previous), assertReleaseChild(target));
    throw error;
  }
  if (hadPrevious) removeReleaseChild(previous);
  console.log(`App Windows pronta: ${path.join(target, 'JScript.exe')}`);
  console.log(`Dipendenze runtime incluse: ${installed.size}; licenze conservate: ${notices.length}.`);
} catch (error) {
  removeReleaseChild(staging);
  throw error;
}
