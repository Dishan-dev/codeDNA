import { StoryPage } from '@/components/story-page';

export const metadata = { title: 'Feature story' };

export default async function Story({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  return <StoryPage slug={feature} />;
}
