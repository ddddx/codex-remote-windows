import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-markdown')
              || id.includes('remark-gfm')
              || id.includes('rehype-highlight')
              || id.includes('highlight.js')
              || id.includes('mdast-util')
              || id.includes('micromark')
              || id.includes('unified')
              || id.includes('unist-')
            ) {
              return 'markdown-vendor';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor';
            }
            return 'app-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
