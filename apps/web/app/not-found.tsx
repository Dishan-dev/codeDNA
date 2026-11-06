import { ButtonLink, PageMessage } from '@/components/ui';

export default function NotFound() {
  return (
    <main id="main">
      <PageMessage title="This page doesn’t exist">
        <ButtonLink href="/" className="mt-6">
          Go to the start
        </ButtonLink>
      </PageMessage>
    </main>
  );
}
