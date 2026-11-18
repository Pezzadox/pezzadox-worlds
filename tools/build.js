// Builds the parts of www/ that are generated: the bundled app script and the fonts.
// www/index.html, www/data and www/runners are source files and are edited directly.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www'), fonts = path.join(www, 'fonts');
// Video messages are only switched on in a build that knows where its backend is.
const url = (process.env.PW_SUPABASE_URL || '').trim().replace(/\/+$/, ''), anon = (process.env.PW_SUPABASE_ANON_KEY || '').trim();
if (!!url !== !!anon) throw new Error('Set both PW_SUPABASE_URL and PW_SUPABASE_ANON_KEY, or neither');
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !process.env.PW_TEST) throw new Error('PW_SUPABASE_URL does not look like a Supabase project address');
if (/service_role/.test(Buffer.from((anon.split('.')[1] || ''), 'base64').toString())) throw new Error('PW_SUPABASE_ANON_KEY is a service-role key. Never put that in the app: use the anon (public) key');
const video = url ? { url, anon } : {};
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'src/app.js')], bundle: true, format: 'iife', minify: true,
  target: ['safari15', 'chrome100'], outfile: path.join(www, 'app.js'), legalComments: 'none',
  define: { __PW_VIDEO__: JSON.stringify(video) }
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
console.log('built ' + (url ? 'with' : 'without') + ' video messages: www/app.js (' + fs.statSync(path.join(www, 'app.js')).size + ' bytes) and fonts');
