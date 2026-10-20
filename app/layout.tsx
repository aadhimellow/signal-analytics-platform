import './globals.css';
import type { Metadata } from 'next';
import Nav from '@/components/Nav';
export const metadata: Metadata = { title: 'Mono Edge | Signal Analytics', description: 'Rolling-mill signal monitoring, history and anomaly alerts' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><Nav /><main>{children}</main></body></html>);
}
