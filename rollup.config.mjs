import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const external = [
  'livekit-client',
  ...Object.keys(pkg.dependencies || {}),
];

// Shared plugins
const plugins = [
  resolve(),
  typescript({
    tsconfig: './tsconfig.json',
    declaration: false,      // We generate declarations separately (build:types)
    declarationMap: false,   // ...so the tsconfig setting must be off here too
  }),
];

export default [
  // ─── Main bundle (ESM + CJS) ────────────────────────────────────────────
  {
    input: 'src/index.ts',
    external,
    output: [
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
    ],
    plugins,
  },

  // ─── UMD bundle (for CDN / <script> tag usage) ──────────────────────────
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/xpectrum.umd.js',
        format: 'umd',
        name: 'Xpectrum',
        sourcemap: true,
        globals: {
          'livekit-client': 'LivekitClient',
        },
      },
      {
        file: 'dist/xpectrum.umd.min.js',
        format: 'umd',
        name: 'Xpectrum',
        sourcemap: true,
        globals: {
          'livekit-client': 'LivekitClient',
        },
        plugins: [terser()],
      },
    ],
    external: ['livekit-client'],
    plugins,
  },

  // ─── Chat sub-package ────────────────────────────────────────────────────
  {
    input: 'src/chat/chat-client.ts',
    external,
    output: [
      { file: 'dist/chat/index.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/chat/index.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    ],
    plugins,
  },

  // ─── Voice sub-package ───────────────────────────────────────────────────
  {
    input: 'src/voice/voice-client.ts',
    external,
    output: [
      { file: 'dist/voice/index.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/voice/index.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    ],
    plugins,
  },

  // ─── Widgets sub-package ─────────────────────────────────────────────────
  {
    input: 'src/widgets/chat-widget.ts',
    external,
    output: [
      { file: 'dist/widgets/index.esm.js', format: 'esm', sourcemap: true },
      { file: 'dist/widgets/index.cjs.js', format: 'cjs', sourcemap: true, exports: 'named' },
    ],
    plugins,
  },

  // ─── Embed scripts (standalone, no external deps) ───────────────────────
  {
    input: 'src/embed/chat-embed.js',
    output: [
      { file: 'dist/chat-embed.js', format: 'iife' },
      { file: 'dist/chat-embed.min.js', format: 'iife', plugins: [terser()] },
    ],
  },
  {
    input: 'src/embed/voice-embed.js',
    output: [
      { file: 'dist/voice-embed.js', format: 'iife' },
      { file: 'dist/voice-embed.min.js', format: 'iife', plugins: [terser()] },
    ],
  },
];
