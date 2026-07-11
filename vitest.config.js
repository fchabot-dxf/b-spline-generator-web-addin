import { defineConfig } from 'vitest/config';

// Minimal config for the JS editor-serialization suite (F11a). happy-dom
// supplies DOMParser / innerHTML / btoa so the real editor modules run
// headless. Tests live in tests/ and import the shipping source directly.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
  },
});
