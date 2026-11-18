import { firebaseConfig } from './firebase-config.js';

// Demo mode (data saved in this browser only) runs when Firebase isn't configured,
// or when the address has ?demo in it, e.g. http://localhost:5173/?demo
export const DEMO = new URLSearchParams(location.search).has('demo')
  || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_');

export const backend = DEMO
  ? (await import('./backend-demo.js')).createDemoBackend()
  : (await import('./backend-firebase.js')).createFirebaseBackend(firebaseConfig);
