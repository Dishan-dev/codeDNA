import { Toolbar } from './toolbar';

export const metadata = { title: 'Admin' };

export default function AdminPage() {
  return <Toolbar endpoint="/api/import" />;
}
