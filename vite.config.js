import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  build: {
    outDir: 'mgmt/dist',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/frontend/index.html'),
    },
  },
});
