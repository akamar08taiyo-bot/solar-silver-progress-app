#!/bin/sh
# ブラウザのテスト（test/e2e-*.mjs）の準備：アプリが CDN から読む React・lucide-react・Babel を npm から入れて、
# ブラウザで読める形（ESM）にまとめ、index.html が使う Tailwind の CSS を作る。本番の Firebase は使わない（にせの Firestore＝fake-firebase-*.js）。
#   sh test/harness/setup.sh [準備のフォルダ（初めは /tmp/progress-harness）]
set -e
OUT=${1:-/tmp/progress-harness}
HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)
mkdir -p "$OUT/deps" "$OUT/lib"
cd "$OUT/deps"
[ -f package.json ] || npm init -y >/dev/null
# index.html の import map・script と同じ版
npm install --no-audit --no-fund @babel/standalone@7.29.9 react@18.2.0 react-dom@18.2.0 lucide-react@0.468.0 esbuild@0.24.0 tailwindcss@3.4.17 >/dev/null
node -e "
const R=require('react'),RD=require('react-dom/client'),J=require('react/jsx-runtime'),fs=require('fs');
const keys=(o)=>Object.keys(o).filter((k)=>/^[A-Za-z_\$][\w\$]*$/.test(k));
fs.writeFileSync('entry-all.js','import R from \"react\"; import RD from \"react-dom/client\"; import J from \"react/jsx-runtime\"; export {R, RD, J};\n');
const re=(name,v,ks)=>fs.writeFileSync('$OUT/lib/'+name,'import {'+v+'} from \"http://progress.test/lib/react-all.js\"; export default '+v+';\nexport const {'+ks.join(', ')+'} = '+v+';\n');
re('react.js','R',keys(R)); re('react-dom-client.js','RD',keys(RD)); re('jsx-runtime.js','J',keys(J));
"
npx esbuild entry-all.js --bundle --format=esm --outfile="$OUT/lib/react-all.js" --define:process.env.NODE_ENV='"production"' --log-level=warning
echo "export * from 'lucide-react';" > entry-lucide.js
npx esbuild entry-lucide.js --bundle --format=esm --external:react --outfile="$OUT/lib/lucide-react.js" --log-level=warning
cp node_modules/@babel/standalone/babel.min.js "$OUT/lib/"
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > tw-in.css
printf "module.exports = {content: ['%s/index.html'], theme: {extend: {fontFamily: {sans: ['system-ui', 'sans-serif']}}}};\n" "$APP" > tw.config.cjs
npx tailwindcss -c tw.config.cjs -i tw-in.css -o "$OUT/lib/tw.css" --minify 2>/dev/null
cp "$HERE"/fake-firebase-*.js "$OUT/lib/"
echo "ok: $OUT/lib"
