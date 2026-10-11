import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Jersey_10, Silkscreen } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const jersey = Jersey_10({ weight: '400', subsets: ['latin'], variable: '--font-jersey' });
const silk = Silkscreen({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-silk' });
const plex = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-plex' });
// Use the variable face; static-weight URLs can contain queries Turbopack cannot resolve.
const plexSans = IBM_Plex_Sans({ weight: 'variable', subsets: ['latin'], variable: '--font-plex-sans' });

export const metadata: Metadata = {
  title: 'Agents Café',
  description: 'A pixel-art café where you can watch your AI agents work.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jersey.variable} ${silk.variable} ${plex.variable} ${plexSans.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
