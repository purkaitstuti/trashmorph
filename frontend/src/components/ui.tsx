import { Loader2 } from "lucide-react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; trailing?: ReactNode };

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, trailing, id, ...rest }, ref) {
  const fid = id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <label htmlFor={fid} className="mb-1 block text-sm font-semibold">{label}</label>
      <div className="relative">
        <input ref={ref} id={fid} className="input pr-12" aria-invalid={!!error} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} {...rest} />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {hint && !error && <p id={`${fid}-hint`} className="mt-1 text-sm text-muted">{hint}</p>}
      {error && <p id={`${fid}-err`} role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
});

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span role="status" className="inline-flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{label}</span>;
}

export function FullPageSpinner() {
  return <div className="flex min-h-[50vh] items-center justify-center"><Spinner label="Loading…" /></div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 max-w-2xl">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      {children && <p className="mt-3 text-lg text-muted">{children}</p>}
    </header>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; options: readonly (readonly [string, string])[]; placeholder?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, options, placeholder, id, ...rest }, ref) {
  const sid = id ?? `s-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <label htmlFor={sid} className="mb-1 block text-sm font-semibold">{label}</label>
      <select ref={ref} id={sid} className="input" aria-invalid={!!error} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
});
