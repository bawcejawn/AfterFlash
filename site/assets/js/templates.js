// Event templates: a quick first step when creating an event. Each one is plain settings (the server
// cleans them like any other settings), so they work the same on Cloud and the free self-hosted version.
// The host can change every value later on the dashboard.

const thanks = (who) => `Thank you so much for celebrating with ${who}. We loved seeing the night through your eyes. Here are all the photos.`;

export const TEMPLATES = {
  wedding: {
    label: 'Wedding', blurb: 'Elegant look, 12 classic challenges, meal choices and song requests.',
    settings: {
      accent: '#7a4e6d', font: 'elegant', look: 'warm', shotsPerGuest: 25, maxGuests: 150,
      challenges: { on: true, list: ['Photo with someone you just met', 'The first dance', 'Something borrowed', 'Something blue',
        'Selfie with the couple', 'A toast in action', 'Two generations in one photo', 'Your whole table together',
        'The best dance move', 'A candid hug', 'The cake before it’s cut', 'The last dance'] },
      invite: { photo: true, plusOnes: true, askMeal: true, meals: ['Chicken', 'Fish', 'Vegetarian'], diet: true, song: true, message: true },
      messages: { autoReminder: true, autoCamera: true, autoPhotos: true, thanks: thanks('us on our wedding day') },
    },
  },
  birthday: {
    label: 'Birthday', blurb: 'Bright and fun, party challenges, a simple invitation.',
    settings: {
      accent: '#e0457b', font: 'modern', look: 'vivid', shotsPerGuest: 30, maxGuests: 60,
      challenges: { on: true, list: ['Selfie with the birthday star', 'Blowing out the candles', 'The best party face', 'Your best dance move',
        'Someone mid-laugh', 'A group photo with 5+ people', 'The present everyone wants', 'Your most dramatic pose'] },
      invite: { photo: true, plusOnes: true, song: true, message: true },
      messages: { autoReminder: true, autoCamera: true, autoPhotos: true, thanks: thanks('me on my birthday') },
    },
  },
  surprise: {
    label: 'Surprise party', blurb: 'Pass the link around in secret. Friends add old photos and video wishes; the album stays hidden from guests. Then reveal it all on the TV.',
    settings: {
      accent: '#ff7a1a', font: 'modern', look: 'vivid', shotsPerGuest: 40, maxGuests: 100,
      allowLibrary: true, allowVideo: true, maxVideoSec: 30, guestGallery: false, guestbook: true, captions: true,
      tagline: 'Happy birthday!',
      welcome: 'Shh, it’s a surprise! Add your favorite photos together and a quick video wish. Please don’t tell!',
      challenges: { on: true, list: ['Your favorite old photo together', 'A 15-second birthday wish (video)', 'A throwback from years ago',
        'Where you first met', 'A photo that always makes them laugh', 'Your best birthday selfie for them'] },
      invite: { photo: false, message: true },
      messages: {},
    },
  },
  baby: {
    label: 'Baby shower', blurb: 'Soft look, sweet challenges, a note about gifts on the invitation.',
    settings: {
      accent: '#5aa6a0', font: 'script', look: 'warm', shotsPerGuest: 20, maxGuests: 50,
      challenges: { on: true, list: ['Selfie with the parents-to-be', 'The cutest tiny outfit', 'Your best baby face', 'The gift table',
        'Someone guessing the due date', 'A game in action', 'Three generations in one photo', 'The sweetest detail'] },
      invite: { photo: true, plusOnes: false, kids: true, diet: true, message: true,
        note: 'Bringing a gift? Let us know in your message so we can say thank you.' },
      messages: { autoReminder: true, autoPhotos: true, thanks: thanks('us') },
    },
  },
  corporate: {
    label: 'Corporate', blurb: 'Clean look, a few challenges, photos checked before they show.',
    settings: {
      accent: '#2c45c9', font: 'modern', look: 'none', shotsPerGuest: 15, maxGuests: 300, approval: true, captions: false,
      challenges: { on: true, list: ['Your team together', 'The best idea of the day', 'Selfie with a speaker', 'The view from your seat'] },
      invite: { photo: false, plusOnes: false, diet: true, message: false },
      messages: { autoReminder: true, autoPhotos: true, thanks: 'Thank you for joining us. Here are the photos from the event.' },
    },
  },
  reunion: {
    label: 'Reunion', blurb: 'Classic look, “find someone from…” challenges, see who’s coming.',
    settings: {
      accent: '#c76b2a', font: 'modern', look: 'classic', shotsPerGuest: 30, maxGuests: 200,
      challenges: { on: true, list: ['Find someone from your first year', 'Recreate an old photo', 'Someone who hasn’t changed a bit',
        'The person who traveled farthest', 'Your old crew together', 'The best story of the night', 'A big group photo'] },
      invite: { photo: true, plusOnes: true, diet: true, message: true, whoComing: true },
      messages: { autoReminder: true, autoCamera: true, autoPhotos: true, thanks: thanks('us') },
    },
  },
  blank: { label: 'Blank', blurb: 'Just the basics. Set everything up yourself.', settings: {} },
};

/** Settings for a new event: the template, then the host's own answers on top. */
export function templateSettings(id, own) {
  const t = TEMPLATES[id] || TEMPLATES.blank;
  const s = JSON.parse(JSON.stringify(t.settings));
  return { ...s, ...own, invite: { ...(s.invite || {}) }, challenges: s.challenges, messages: s.messages };
}
