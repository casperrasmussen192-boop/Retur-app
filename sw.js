// Minimal service worker — findes kun for at opfylde browserens krav om
// installerbarhed som PWA. Ingen caching af data: appen skal altid hente
// friske sager/analyser, aldrig vise forældet indhold offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // Passthrough — lader browseren håndtere alle requests normalt
