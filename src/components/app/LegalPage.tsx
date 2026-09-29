import { BRAND } from "@/config/brand";
import { legal } from "@/config/legal";

/** Frame of a legal document: header, the text, the provider's details. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const l = legal();
  return (
    <div className="app-page">
      <header className="app-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <span className="app-top-right">
          <a className="link-btn" href="/terms">Условия</a>
          <a className="link-btn" href="/privacy">Конфиденциальность</a>
        </span>
      </header>
      <main className="legal">
        <h1>{title}</h1>
        <p className="legal-date">Редакция от {l.updated}</p>
        {children}
        <section>
          <h2>Исполнитель и контакты</h2>
          {l.name ? (
            <p>
              {l.name}{l.inn && <>, ИНН {l.inn}</>}, применяет налог на профессиональный доход.
              {l.email && <> Почта для обращений: <a href={`mailto:${l.email}`}>{l.email}</a>.</>}
            </p>
          ) : (
            <p>Реквизиты исполнителя публикуются до начала приёма платежей.</p>
          )}
        </section>
      </main>
    </div>
  );
}
