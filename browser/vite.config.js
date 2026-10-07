import { defineConfig } from 'vite';
export default defineConfig({
  base:'./',
  worker:{format:'es',rollupOptions:{output:{entryFileNames:'assets/model.worker.js'}}},
  build:{target:'es2022',emptyOutDir:false}
});
