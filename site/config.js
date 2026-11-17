// PhotoShare site configuration — the only file you need to edit after deploying.
// See docs/SETUP.md.
export default {
  appName: 'PhotoShare',

  // One entry per Google Apps Script deployment ("studio"). Keys are short names that
  // appear in links as ?s=<key>. The FIRST entry is the default. Only URLs listed here
  // are ever contacted — links cannot point the app at any other server.
  backends: {
    main: 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec',
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
