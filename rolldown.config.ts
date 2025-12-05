import { resolve } from 'node:path'
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

export default defineConfig([
    {
        input: 'src/index.ts',
        output: [
            {
                dir: 'dist/cjs',
                format: 'cjs',
                exports: 'named',
            },
        ],
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        external: ['three'],
        plugins: [],
    },
    {
        input: 'src/index.ts',
        output: [
            {
                dir: 'dist/esm',
                format: 'es',
            },
        ],
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        plugins: [dts({ tsconfig: './tsconfig.json' })],
    },
])
