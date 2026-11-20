// Help: the common problems and how to fix them, for guests, hosts and partners.
// Each entry has an id so other pages can link straight to it (help.html#camera).
import { $, h, frameGuard, config } from './util.js';

frameGuard();
const cloud = !!config.cloud;
const support = cloud && config.cloud.support;
const app = config.appName || 'Rememberoll';

// cloud: only on the paid site; self: only on self-hosted sites
const GUESTS = [
  { id: 'camera', q: 'The camera won’t open, or the screen is black', steps: [
    'Make sure you opened the link in Safari (iPhone) or Chrome (Android), not inside Instagram, Facebook, TikTok or Snapchat. In those apps, tap ••• or the share button and choose “Open in browser”.',
    'iPhone: tap “aA” in the address bar → Website Settings → Camera → Allow. Or Settings → Apps → Safari → Camera → Allow.',
    'Android: tap the icon left of the address → Permissions → Camera → Allow.',
    'Reload the page and tap “Open the camera” again.',
    'Still stuck? Tap “Use phone camera”: it opens your normal camera, and the photo still goes to the album.'] },
  { id: 'waiting', q: 'My photos say “waiting to upload”', steps: [
    'They’re saved on your phone, so nothing is lost.',
    'They upload by themselves when you have signal or Wi-Fi. Keep the page open for a moment once you’re connected, or open the event link again later.',
    'Don’t clear your browser’s history or website data until they’ve uploaded.'] },
  { id: 'no-shots', q: 'I’m out of shots', steps: [
    'Each guest gets a set number of shots, like a roll of film. That’s part of the fun.',
    'Want more? Ask the host: they can raise the number for everyone.'] },
  { id: 'not-in-album', q: 'I can’t see my photos in the album', steps: [
    'The host may approve photos before they show, or the photos may “develop” after the event. The camera page tells you which.',
    'Your own photos are always under “My photos” on the camera page.'] },
  { id: 'code', q: 'The event code doesn’t work', steps: [
    'Check the sign: codes are letters and numbers, no spaces.',
    'Some events also have a short number code (PIN) printed on the sign. Ask the host if you can’t find it.'] },
  { id: 'remove-photo', q: 'I want a photo taken down', steps: [
    'Open the photo in the album and tap “Report”. It’s hidden right away until the host decides.',
    'Or ask the host directly: they can hide or delete any photo.'] },
  { id: 'home-screen', q: 'Put the camera on my phone’s home screen', steps: [
    'On the camera page, tap “Add to home screen” at the bottom and follow the steps.',
    'iPhone: it must be Safari. Tap the Share button (the square with an arrow) → “Add to Home Screen” → “Add”.',
    'Android: Chrome’s menu (⋮) → “Add to Home screen” or “Install app”.',
    'The icon opens the event you used last. Tap the logo at the top to see all your events.'] },
  { id: 'rsvp', q: 'RSVP to an invitation, or change my answer', steps: [
    'Open the invitation link from your host, type your name and choose Yes, Maybe or No.',
    'Add your party, meals and anything else the host asks, then tap “Send my RSVP”.',
    'To change it later, open the same link on the same phone and tap “Change my answer”.',
    'On another phone? Use the private link shown after you reply. Keep it to yourself: anyone with it can change your answer.',
    'Your reply and photo go only to the host.'] },
  { id: 'challenges', q: 'Do a photo challenge or add a caption', steps: [
    'If the hosts turned on challenges, a yellow card on the camera shows one, like “Selfie with the hosts”.',
    'Tap “Shoot it”, then take the photo. The next challenge appears. Tap “Skip” for a different one.',
    'To add a caption, tap “Aa Caption”, type it and tap Done. It goes with your next photo.',
    'Captions show under your photo in the album and on the TV.'] },
];

const HOSTS = [
  { id: 'prints', q: 'Order prints or a photo book', steps: [
    'Open your dashboard and go to the Photos tab.',
    'Tap photos to pick them. Tip: tap “Favorites”, then “Select all”.',
    'Under “Prints and photo books”, choose how many copies and tap “Order prints”, or tap “Make a photo book” (20 to 60 photos).',
    'Pay and enter the shipping address. Orders usually ship within about 2 weeks.',
    'The status shows under “Your orders” on the Photos tab.'] },
  { id: 'messages', q: 'Email your guests (reminders, camera link, thank-you)', steps: [
    'Guests can add their email when they RSVP. You can also paste emails under Invitations → Messages.',
    'Tap “Use your own email app” to send from your own email. Guests are in BCC, so nobody sees the others’ addresses.',
    'On Rememberoll Cloud you can also send from here, or turn on automatic messages: a reminder before the reply-by date, the camera link when the party starts, and the photos the day after.',
    'Write a thank-you note once. It goes out with the album link.',
    'Every email has an unsubscribe link. Guests who use it are never emailed again.'] },
  { id: 'lost-key', q: 'I lost my admin key', cloud: true, steps: [
    'Go to the sign-in page and choose “Lost your key?” → “Sign in with Google”.',
    'Use the same Google account you connected for photos. You’ll get a new key straight away (the old one stops working).'] },
  { id: 'drive-connect', q: 'Connecting Google Drive didn’t work', cloud: true, steps: [
    'Click “Connect Google Drive” again.',
    'On Google’s screen, tick the box that lets Rememberoll save files to your Drive. If you skip it, nothing can be saved.',
    'No Google account? Make a free one at accounts.google.com, then connect it.'] },
  { id: 'drive-full', q: 'My Google Drive is full', steps: [
    'Your admin page shows how much space is used.',
    'Download the albums you’re done with (open the event’s Drive folder → right-click the folder → Download), then delete them from Drive. Or buy more space from Google.',
    'While it’s full, guests’ photos wait on their phones and upload once there’s room.'] },
  { id: 'not-showing', q: 'Photos aren’t showing on the album or the TV', steps: [
    'Approval on? Open the dashboard → Photos and approve them (or turn off “Approve photos before anyone sees them” in Settings).',
    'Photo reveal set to after the event? They’ll appear at the time you set (Settings → Photo reveal).',
    'Uploads paused? Settings → untick “Pause uploads now”.',
    'TV not updating: reload the TV page, and check the TV has internet.'] },
  { id: 'missing', q: 'A guest says a photo is missing', steps: [
    'Ask them to open the event link again with signal: waiting photos upload then.',
    'On the dashboard, use “Find missing photos”. It adds any photos that reached your Drive but not the album.'] },
  { id: 'more-shots', q: 'Guests want more shots', steps: [
    'Dashboard → Settings → “Shots per guest” → Save settings. Everyone gets the new number straight away.'] },
  { id: 'bad-guest', q: 'Someone is posting things they shouldn’t', steps: [
    'Dashboard → Photos: select the photo → Hide or Delete.',
    'Dashboard → Guests → Block. They can’t upload any more.',
    'For a while, turn on “Approve photos before anyone sees them” so nothing shows without you.'] },
  { id: 'download', q: 'How do I download everything?', steps: [
    'Dashboard → Share → “Download all photos and videos”. Or open the event’s Drive folder and download it as a zip.'] },
  { id: 'plan-ended', q: 'My plan ended, or my 1 event is used', cloud: true, steps: [
    'Sign in and use the buttons at the top of your admin page to add 1 event, 1 month or 12 months. It’s added to the same key.',
    'Your photos are safe in your Drive the whole time, and guests’ waiting photos upload once you renew.',
    'Album links stay online for 12 months after a plan ends.'] },
  { id: 'problems', q: 'Something else went wrong', steps: [
    'If something failed, your admin page shows a “Recent problems” list with what went wrong and when. It often says exactly what to fix.',
    support ? `Still stuck? Email ${support} with your event name and what happened.` : 'Still stuck? Contact whoever set up your Rememberoll.'] },
  { id: 'home-screen-host', q: 'Open my dashboard from my phone’s home screen', steps: [
    'Hosts: open your host link, go to the Access tab, tick “Remember me on this device”, then tap “Add to home screen”. Only do this on your own phone.',
    'Studio admins: sign in, then tap “Add to home screen” next to Sign out. You’ll sign in each time you open it; your admin key is never saved on the phone.',
    'The icon opens whatever you used last on that phone. Tap the logo at the top to switch to another event.',
    'Lost your phone? Make a new host link (Access tab) so the old one stops working.'] },
  { id: 'invitations', q: 'Send an invitation and collect RSVPs', steps: [
    'Open your host dashboard and go to the Invitations tab, then tap “Turn on invitation”.',
    'Fill in the time, place, dress code and a note, and pick the questions to ask (plus-ones, meals, dietary needs, song requests).',
    'Share the invitation link by text or email, or print its QR code on paper invitations.',
    'Replies appear on the same tab with totals and meal counts. Tap “Download guest list (CSV)” for your caterer or seating chart.',
    'On the event day, the same link shows guests a big “Open the camera” button.'] },
];

const PARTNERS = [
  { id: 'partner-link', q: 'Where are my code and link?', steps: [
    'Sign in with your partner key. Your code, link and earnings are at the top of the page.',
    'When you share them, say you earn a commission (for example: “I get a small commission if you use my code”).'] },
  { id: 'partner-paid', q: 'When and how do I get paid?', steps: [
    'Each sale is added to your balance straight away and is “ready” after 14 days.',
    'Once $25 is ready, tap “Request payout”, choose Venmo, PayPal, Zelle, Cash App or check, and enter your username, email or phone.',
    'You’ll see “Paid” in your payout history once the money is sent.'] },
  { id: 'partner-team', q: 'How do I add someone to my team?', steps: [
    'Tap “Make an invite link” and send it to one person. Each link works once, for 14 days.',
    'You earn a share of the team bonus when your team sells. Inviting by itself earns nothing, and never promise anyone earnings.'] },
  { id: 'partner-key', q: 'I lost my partner key', steps: [
    support ? `Email ${support} from the email you joined with, and we’ll send you a new one.` : 'Contact the owner for a new one.'] },
];

const visible = (e) => (e.cloud ? cloud : true) && (e.self ? !cloud : true);
const block = (title, items) => [h('section', { class: 'faq-group' }, h('h2', null, title), ...items.filter(visible).map((e) =>
  h('details', { id: e.id, class: 'faq-item' }, h('summary', null, e.q), h('ol', null, e.steps.map((s) => h('li', null, s))))))];

const search = h('input', { type: 'search', placeholder: 'Search, e.g. camera, upload, key', 'aria-label': 'Search help' });
const list = h('div', { class: 'faq' }, ...block('For guests', GUESTS), ...block('For hosts', HOSTS), ...(cloud ? block('For partners', PARTNERS) : []));
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  for (const d of list.querySelectorAll('details')) {
    const hit = !q || d.textContent.toLowerCase().includes(q);
    d.hidden = !hit;
    d.open = !!q && hit;
  }
  for (const g of list.querySelectorAll('.faq-group')) g.hidden = !g.querySelector('details:not([hidden])');
  empty.hidden = !!list.querySelector('details:not([hidden])');
});
const empty = h('p', { class: 'muted', hidden: true }, support ? `Nothing matches. Email ${support} and we’ll help.` : 'Nothing matches. Try another word.');
$('#app').append(h('h1', null, `${app} help`), h('p', { class: 'lede' }, 'Quick fixes for the most common problems.'), search, empty, list);

// Opened from a link like help.html#camera: open that answer.
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id && /^[a-z-]+$/.test(id) ? document.getElementById(id) : null;
  if (target && target.tagName === 'DETAILS') { target.hidden = false; target.open = true; target.scrollIntoView(); }
}
openFromHash();
addEventListener('hashchange', openFromHash);
