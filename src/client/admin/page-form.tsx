import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LayoutTemplate } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createPage, type AdminSession, type AdminSource } from './api';
import { pageDraftSchema, type PageDraftInput } from './schemas';

export const PageForm = ({
  session,
  revision,
  sources,
  onCommitted,
}: {
  session: AdminSession;
  revision: number;
  sources: AdminSource[];
  onCommitted: () => Promise<void>;
}) => {
  const form = useForm<PageDraftInput>({
    resolver: zodResolver(pageDraftSchema),
    defaultValues: { id: '', slug: '', title: '', sourceRef: sources[0]?.id ?? '' },
  });
  const submit = form.handleSubmit(async input => {
    try {
      const result = await createPage(session, {
        expectedRevision: revision,
        page: {
          id: input.id.trim(),
          slug: input.slug.trim(),
          title: input.title.trim(),
          sourceRefs: [input.sourceRef],
        },
      });
      toast.success(`Public page activated in revision ${result.data.revision}`);
      form.reset({ id: '', slug: '', title: '', sourceRef: sources[0]?.id ?? '' });
      await onCommitted();
    } catch (error) {
      toast.error('Page was not committed', {
        description: error instanceof Error ? error.message : 'Review the page mapping.',
      });
    }
  });

  return (
    <section className="workbench-editor">
      <header className="editor-heading">
        <div>
          <p className="admin-eyebrow">Page composer</p>
          <h2>Publish a status surface</h2>
        </div>
        <LayoutTemplate size={22} />
      </header>
      {sources.length === 0 ? (
        <div className="editor-empty">
          <strong>A source comes first.</strong>
          <p>Verify and commit an Uptime Kuma source before composing its public page.</p>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
          <div className="admin-form-row">
            <label className="admin-field">
              <span>Internal page ID</span>
              <input placeholder="public" {...form.register('id')} />
              {form.formState.errors.id ? <small>{form.formState.errors.id.message}</small> : null}
            </label>
            <label className="admin-field">
              <span>Public slug</span>
              <input placeholder="main" {...form.register('slug')} />
              {form.formState.errors.slug ? (
                <small>{form.formState.errors.slug.message}</small>
              ) : null}
            </label>
          </div>
          <label className="admin-field">
            <span>Public title</span>
            <input placeholder="System status" {...form.register('title')} />
            {form.formState.errors.title ? (
              <small>{form.formState.errors.title.message}</small>
            ) : null}
          </label>
          <label className="admin-field">
            <span>Source</span>
            <select {...form.register('sourceRef')}>
              {sources.map(source => (
                <option key={source.id} value={source.id}>
                  {source.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="admin-primary-button"
            disabled={form.formState.isSubmitting}
            type="submit"
          >
            {form.formState.isSubmitting ? 'Publishing revision…' : 'Commit page'}
            <ArrowRight size={17} />
          </button>
        </form>
      )}
    </section>
  );
};
