# Vendored viewer runtime

`three-lab.js` — three.js r170 (MIT) bundled as one ES module with
`GLTFLoader`, `OrbitControls` and `RoomEnvironment`, minified with esbuild.
It is loaded on demand by the Technical Lab screens only (`import()` from
`app/js/lab3d.js`), never by the app shell.

Rebuild (no repo dependency):

```
mkdir three-build && cd three-build && npm init -y
npm install three@0.170.0 esbuild@0.24.0
printf 'export * as THREE from "three";\nexport { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";\nexport { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";\nexport { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";\n' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=../app/vendor/three-lab.js
```
