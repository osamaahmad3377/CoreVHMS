import { Inter, Plus_Jakarta_Sans, Lato, Merriweather, Nunito, Open_Sans, Poppins, Roboto } from 'next/font/google';

/**
 * Fonts a clinic can choose in Settings → Branding. They are downloaded at build time and served from this
 * app (no requests to Google from the browser). Inter is the standard font and is preloaded; the others are only
 * fetched by a browser when the clinic's theme actually uses them (`--font-brand` points at its variable).
 */
// next/font needs literal options on each call (no shared object or spread).
const inter = Inter({ subsets: ['latin'], display: 'swap', preload: true, variable: '--font-inter' });
/** The standard interface font. */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', preload: true, variable: '--font-jakarta' });
const roboto = Roboto({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '500', '700'], variable: '--font-roboto' });
const openSans = Open_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-open-sans' });
const lato = Lato({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '700'], variable: '--font-lato' });
const poppins = Poppins({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '500', '600', '700'], variable: '--font-poppins' });
const nunito = Nunito({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-nunito' });
const merriweather = Merriweather({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '700'], variable: '--font-merriweather' });

/** Class names that define every brand font's CSS variable; put them on <html>. */
export const brandFontVariables = [jakarta, inter, roboto, openSans, lato, poppins, nunito, merriweather].map((f) => f.variable).join(' ');
