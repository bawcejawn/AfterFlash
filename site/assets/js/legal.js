// Terms of service and privacy policy, filled in with this site's business name and contact.
import { $, h, clear, frameGuard, config, setTitle } from './util.js';

frameGuard();
const root = $('#app');
const c = config.cloud || {};
const biz = c.business || config.appName || 'Rememberoll';
const app = config.appName || 'Rememberoll';
const contact = c.support ? h('a', { href: 'mailto:' + c.support }, c.support) : 'the contact address on our home page';
const updated = 'November 18, 2026';
const sec = (title, ...paras) => [h('h2', null, title), ...paras.map((p) => (typeof p === 'string' ? h('p', null, p) : p))];
const list = (...items) => h('ul', null, items.map((i) => h('li', null, i)));

const TERMS = [
  h('h1', null, `${app} terms of service`), h('p', { class: 'muted' }, `Last updated ${updated}. These terms are between you and ${biz}.`),
  ...sec('What you’re buying',
    `${app} lets you run shared photo albums for your events. Guests take photos in their phone’s browser and the photos are saved to your own Google Drive. A one-time payment gives you an admin key for a set time: one event within 30 days, unlimited events for 1 month (30 days), or unlimited events for 12 months (365 days), counted from the purchase. Nothing renews automatically and it isn’t a subscription. Buying again with the same key adds time, or another event, to it.`,
    'When your plan ends you can still sign in, see your events and back up your keys, but you can’t create events, open host dashboards or receive new guest photos until you buy more time.'),
  ...sec('How long albums stay online',
    `Album, guest and photo-wall links stay online while your plan is active and for 12 months after it ends. After that they close and we may delete the event records on our side. The photos themselves stay in your Google Drive, under your control, for as long as you keep them there. ${app} doesn’t sell storage: any extra space comes from Google at Google’s price.`),
  ...sec('Referral codes',
    'A referral code gives the discount shown before checkout. Codes can’t be combined, have no cash value, and may be turned off at any time. If you bought with a code, the person who shared it may earn a commission on that purchase and on later purchases with the same key. They see the date, plan and amount, never your name or email.'),
  ...sec('Your key',
    'Your key is for you or your business. You may run events for your own clients and charge them whatever you like. Don’t resell, share publicly or transfer the key itself.'),
  ...sec('Your Google Drive and your files',
    `Photos, videos and voice messages are stored in the Google account you connect. You’re responsible for that account, its storage space and any Google charges. ${app} can only access the files it creates there. If you disconnect Google or delete files, ${app} can’t restore them.`,
    'We don’t keep copies of your photos. Files pass through our servers only on their way to your Drive.'),
  ...sec('Your guests and their content',
    'You’re responsible for your events: telling guests that photos are collected, getting any consents your local law requires, and moderating what’s shared. Don’t use the service for anything illegal or for content that sexualizes minors, harasses people, invades privacy or infringes someone else’s rights. We may turn off accounts that do, and we report illegal content to the authorities where the law requires it.'),
  ...sec('All sales are final',
    `Every purchase is final and non-refundable, including unused time or events. Before you buy, you can try ${app} as a guest on any event. If something doesn’t work for your event because of a problem on our side, contact ${c.support || 'us'}: we’ll fix it, and where it’s fair we’ll add time to your key.`),
  ...sec('Partner program',
    'Referral partners are independent contractors. Joining is free and never requires a purchase. Partners earn only from real customers’ purchases, never for inviting other partners, and partners’ own purchases earn no one a commission. Commissions on sales reversed by a chargeback are cancelled. The partner agreement shown when joining also applies.'),
  ...sec('Availability and changes',
    'We work to keep the service running, but we can’t promise it will always be available or error-free. We may improve or change features. If we ever shut the service down, we’ll give at least 60 days’ notice so you can download your albums; your files stay in your own Google Drive regardless.'),
  ...sec('Disclaimer and liability',
    `The service is provided “as is”. To the extent the law allows, ${biz} isn’t liable for indirect or consequential losses, lost photos or lost profits, and our total liability is limited to the amount you paid us.`),
  ...sec('Contact', h('p', null, 'Questions or problems: ', contact, '.')),
];

const PRIVACY = [
  h('h1', null, `${app} privacy policy`), h('p', { class: 'muted' }, `Last updated ${updated}. This explains what ${biz} collects and why.`),
  ...sec('Hosts (people who buy a key)',
    list('Your email address and payment details are handled by Stripe. We receive your email and the fact that you paid; we never see your card number.',
      'When you connect Google, we receive your Google account’s email and a permission (encrypted on our servers) that lets us save and manage the files Rememberoll creates in your Drive. Nothing else in your Drive is visible to us.',
      'Event settings you choose (name, date, logo, options) and a list of the files in each event.')),
  ...sec('Guests',
    list('No account or email is needed. A guest may type a name, shown next to their photos.',
      'Photos, videos and voice messages go to the host’s Google Drive. Location data in photos is removed. With private storage, files are encrypted on the guest’s phone before upload.',
      'The guest’s browser stores a small sign-in token so they keep their shot count.')),
  ...sec('What we don’t do',
    list('No advertising, no tracking cookies, no selling or sharing data for marketing.', 'We don’t keep copies of event photos.')),
  ...sec('Service providers',
    'We use Cloudflare to run the website and its database, Google for sign-in and Drive storage, and Stripe for payments. Each handles data under its own privacy terms.'),
  ...sec('Keeping and deleting data',
    'If a host used a referral code, we record which code and the amount paid, so its owner can be paid a commission; the code owner never sees the buyer’s name or email. Event records stay until the host deletes the event or asks us to delete their account, or until 12 months after the host’s plan ends. Photos live in the host’s Google Drive and are under the host’s control. Hosts can disconnect Rememberoll any time in their Google account settings (Security → Third-party access).'),
  ...sec('Children', `${app} isn’t directed at children under 13. Hosts decide who attends their events and are responsible for appropriate consent.`),
  ...sec('Your rights and contact', h('p', null, 'To ask what we hold about you, or to delete it, contact ', contact, '.')),
];

const isTerms = /terms/.test(location.pathname);
setTitle(isTerms ? 'Terms of service' : 'Privacy policy');
clear(root).append(...(isTerms ? TERMS : PRIVACY));
