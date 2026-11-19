import '@fontsource/press-start-2p/400.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // offline support is a bonus; the game works without it
    });
  });
}
