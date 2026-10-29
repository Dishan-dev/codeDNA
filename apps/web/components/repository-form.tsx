'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, GitBranch } from 'lucide-react';
import { Button, Input } from './ui';
import { validateRepositoryUrl } from '@/lib/repository-url';

export function RepositoryForm() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [valid, setValid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateRepositoryUrl(value);
    setValid(!error);
    setMessage(
      error ??
        'Repository import is coming soon. Explore the bundled example in the meantime.',
    );
  }
  return (
    <form className="repo-form-wrap" onSubmit={submit} noValidate>
      <label htmlFor="repository-url" className="sr-only">
        GitHub repository URL
      </label>
      <div className="repo-form">
        <GitBranch size={19} aria-hidden="true" />
        <Input
          id="repository-url"
          type="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage('');
            setValid(false);
          }}
          placeholder="github.com / owner / repository"
          aria-invalid={!!message && !valid}
          aria-describedby="repo-help"
        />
        <Button variant="primary" type="submit">
          Explore <ArrowRight size={16} />
        </Button>
      </div>
      <p
        id="repo-help"
        className={
          message && !valid ? 'form-message form-error' : 'form-message'
        }
        aria-live="polite"
      >
        {message || 'Public repositories, understood. Import is coming soon.'}
      </p>
    </form>
  );
}
