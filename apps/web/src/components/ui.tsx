'use client';

import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export function Button({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ui-button ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label className="ui-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="ui-card">{children}</section>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Dialog({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button type="button" onClick={() => ref.current?.showModal()}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        className="ui-dialog"
        aria-label={title}
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close();
        }}
      >
        <h2>{title}</h2>
        {children}
        <form method="dialog">
          <Button type="submit">Fechar</Button>
        </form>
      </dialog>
    </>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="ui-toast" role="status" aria-live="polite">
      {children}
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th scope="col" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
