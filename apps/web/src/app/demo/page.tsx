import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CafeApp } from '@/components/CafeApp';
import { DEMO_SITE } from '@/lib/demo/flag';

export const metadata: Metadata = { title: 'Demo · Agents Café' };

/** The online demo site's café (agentscafe.dev/demo). The app itself runs the café at /. */
export default function Demo() {
  if (!DEMO_SITE) notFound();
  return <CafeApp />;
}
