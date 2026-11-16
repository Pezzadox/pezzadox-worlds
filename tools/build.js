// Builds the parts of www/ that are generated: the bundled app script and the fonts.
// www/index.html, www/data and www/runners are source files and are edited directly.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www'), fonts = path.join(www, 'fonts');
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src/app.js')], bundle: true, format: 'iife', minify: true,
  target: ['safari15', 'chrome100'], outfile: path.join(www, 'app.js'), legalComments: 'none'
});
fs.rmSync(fonts, { recursive: true, force: true }); fs.mkdirSync(fonts);
let css = '';
for (const [family, pkg, weights] of [['Unbounded', 'unbounded', [500, 700, 800]], ['Space Grotesk', 'space-grotesk', [400, 500, 600]]])
  for (const w of weights) {
    const f = `${pkg}-latin-${w}-normal.woff2`;
    fs.copyFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', f), path.join(fonts, f));
    css += `@font-face{font-family:'${family}';font-weight:${w};font-display:swap;src:url(${f}) format('woff2')}\n`;
  }
fs.writeFileSync(path.join(fonts, 'fonts.css'), css);
console.log('built www/app.js (' + fs.statSync(path.join(www, 'app.js')).size + ' bytes) and fonts');
