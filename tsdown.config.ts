import { defineConfig } from 'tsdown'

const nodeExternal = [
  /^@deepseek-ai\//,
  /^@earendil-works\//,
  'undici',
  'react',
  'react/jsx-runtime',
]

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      invariant: 'src/invariant.ts',
    },
    platform: 'node',
    format: 'esm',
    dts: true,
    outDir: 'lib',
    fixedExtension: false,
    deps: { neverBundle: nodeExternal },
  },
  {
    entry: {
      bin: 'src/bin.ts',
    },
    platform: 'node',
    format: 'esm',
    dts: true,
    outDir: 'lib',
    fixedExtension: false,
    deps: { neverBundle: nodeExternal },
  },
  {
    entry: {
      client: 'src/client/index.tsx',
    },
    platform: 'browser',
    format: 'cjs',
    dts: false,
    outDir: 'lib',
    fixedExtension: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  },
])
