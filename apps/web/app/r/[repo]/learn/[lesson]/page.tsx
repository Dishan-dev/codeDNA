import { LessonFlow } from '@/components/lesson-flow';

export const metadata = { title: 'Lesson' };

export default async function Lesson({ params }: { params: Promise<{ lesson: string }> }) {
  const { lesson } = await params;
  return <LessonFlow lessonId={lesson} />;
}
