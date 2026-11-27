import {defineConfig} from 'vite';

// The isolated preview uses the same-origin API without forwarding credentials
// or requests to an external host.
const local = {
  host: '127.0.0.1',
  strictPort: true,
  proxy: {
    '/api/v1/': {target: 'http://127.0.0.1:8080'},
  },
};

export default defineConfig({server: local, preview: local});
