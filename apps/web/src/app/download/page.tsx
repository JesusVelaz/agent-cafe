import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DownloadPage } from '@/components/landing/DownloadPage';
import { DEMO_SITE } from '@/lib/demo/flag';

export const metadata: Metadata = { title: 'Download · Agents Café' };

/** The online demo site's downloads (agentscafe.dev/download). */
export default function Download() {
  if (!DEMO_SITE) notFound();
  return <DownloadPage />;
}
