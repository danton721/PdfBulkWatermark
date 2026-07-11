// Patches electron-builder's NSIS "portable" template before each build (run by
// `npm run dist`). Two changes, both aimed at launch time and launch feedback:
//
// 1. Extraction cache: stock portable exes re-extract their whole payload into
//    a fresh %TEMP% dir on EVERY launch and delete it on exit. We extract into
//    a fixed dir (portable.unpackDirName) and leave a marker file named after
//    the payload hash; when the marker matches on the next launch, extraction
//    is skipped entirely and the app starts in a couple of seconds. A rebuild
//    changes the hash, which invalidates the cache automatically.
//
// 2. Splash: electron-builder's splashImage uses the BgImage plugin, which
//    paints the DESKTOP WALLPAPER and is effectively invisible behind other
//    windows. We instead show a Banner plugin window ("starting..." floating
//    dialog) during first-launch extraction. Cached launches skip it.
//
// The patch is applied to a pristine backup (portable.nsi.orig) each time, so
// it is idempotent and survives npm reinstalls (which restore the stock file).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appBuilderLib = path.dirname(require.resolve('app-builder-lib/package.json'));
const templatePath = path.join(appBuilderLib, 'templates', 'nsis', 'portable.nsi');
const backupPath = templatePath + '.orig';

if (!existsSync(backupPath)) copyFileSync(templatePath, backupPath);
let nsi = readFileSync(backupPath, 'utf8');

// Replacer FUNCTIONS are used so "$1", "$INSTDIR" etc. in the NSIS snippets are
// never interpreted as String.replace substitution patterns.
function replaceOnce(name, pattern, replacement) {
  if (!pattern.test(nsi)) {
    throw new Error(`patch-portable-nsi: pattern not found for "${name}" - electron-builder template changed?`);
  }
  nsi = nsi.replace(pattern, () => replacement);
}

// 1) Before extraction: skip everything if this exact payload is already
//    cached; otherwise show the Banner and proceed with a clean extract.
replaceOnce(
  'cache check + banner before extraction',
  /  RMDir \/r \$INSTDIR\r?\n  SetOutPath \$INSTDIR/,
  [
    '  !ifdef APP_64_HASH',
    '    IfFileExists "$INSTDIR\\.extracted-${APP_64_HASH}" app_cached',
    '  !endif',
    '',
    '  Banner::show /NOUNLOAD "Starting ${PRODUCT_NAME}..."',
    '',
    '  RMDir /r $INSTDIR',
    '  SetOutPath $INSTDIR'
  ].join('\n')
);

// 2) After extraction: write the cache marker, close the Banner, and define
//    the label the cached path jumps to.
replaceOnce(
  'marker + banner destroy + cached label',
  /  System::Call 'Kernel32::SetEnvironmentVariable\(t, t\)i \("PORTABLE_EXECUTABLE_DIR", "\$EXEDIR"\)\.r0'/,
  [
    '  !ifdef APP_64_HASH',
    '    FileOpen $1 "$INSTDIR\\.extracted-${APP_64_HASH}" w',
    '    FileClose $1',
    '  !endif',
    '',
    '  Banner::destroy',
    '',
    'app_cached:',
    '  SetOutPath $INSTDIR',
    '',
    `  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'`
  ].join('\n')
);

// 3) At exit: keep the extracted payload (the whole point of the cache).
replaceOnce(
  'keep cache on exit',
  /  SetOutPath \$EXEDIR\r?\n\s*RMDir \/r \$INSTDIR\r?\nSectionEnd/,
  '  SetOutPath $EXEDIR\nSectionEnd'
);

writeFileSync(templatePath, nsi);
console.log('Patched', templatePath, '(extraction cache + Banner splash)');
