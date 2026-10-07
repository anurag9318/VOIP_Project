// import { defineConfig } from 'vite';
// import react from '@vitejs/plugin-react';
// import basicSsl from '@vitejs/plugin-basic-ssl';

// const httpsEnabled = process.env.VITE_HTTPS === 'true';

// export default defineConfig({
//   plugins: [react(), ...(httpsEnabled ? [basicSsl()] : [])],
//   server: {
//     host: '0.0.0.0',
//     port: 5173,
//     ...(httpsEnabled ? { https: true } : {}),
//     proxy: {
//       '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
//       '/socket.io': { target: 'http://127.0.0.1:5000', changeOrigin: true, ws: true }
//     }
//   }
// });

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],

  server: {
    host: '0.0.0.0',
    port: 5173,

    https: true,

    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },

      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
        secure: false
      }
    }
  }
});
