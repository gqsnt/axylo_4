import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { axyloEntry } from './packed-axylo.mjs';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [{ find: /^axylo$/, replacement: axyloEntry }] },
  build: { target: 'es2022', chunkSizeWarningLimit: 20000 },
});
