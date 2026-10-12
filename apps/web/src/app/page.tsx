import { CafeApp } from '@/components/CafeApp';
import { Landing } from '@/components/landing/Landing';
import { DEMO_SITE } from '@/lib/demo/flag';

// The online demo site opens on what Agents Café is; the café itself is at /demo.
export default function Home() {
  return DEMO_SITE ? <Landing /> : <CafeApp />;
}
