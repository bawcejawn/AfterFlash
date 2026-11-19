// Rememberoll site configuration — the only file you need to edit after deploying.
// See docs/SETUP.md.
export default {
  appName: 'Rememberoll',

  // One entry per Google Apps Script deployment ("studio"). Keys are short names that
  // appear in links as ?s=<key>. The FIRST entry is the default. Friends who set up their own
  // Rememberoll (setup.html) use links with ?b=<deployment id>, which can only ever mean a
  // https://script.google.com/macros/s/<id>/exec address. No other server is ever contacted.
  backends: {
    main: 'https://script.google.com/macros/s/AKfycbzuMjd4EGHezYGCs6Lc1v84fMs7xc-qm8Tg_2LPycnGZOCbUc88qZNzEyOlgPhbeQk_/exec',
  },

  // Koinos blockchain settings (optional). Leave contract empty to hide chain features.
  koinos: {
    rpc: 'https://api.koinos.io',
    contract: '',
    explorer: 'https://koinosblocks.com',
  },

  // Where photos are served from. Leave as-is unless you are running tests.
  driveBase: 'https://drive.google.com',
};
