import { ArrowRightIcon, FilmSlateIcon, FlowArrowIcon, ImagesIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { BRAND } from "@/config/brand";
import { formatKop } from "@/lib/money";
import type { ProjectSummary } from "@/lib/projects";

const ago = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/** The start screen: what do you want to make? Tasks first, the canvas is one of them. */
export function Home({ projects, balanceKop, email, cardsKop }: {
  projects: ProjectSummary[];
  /** null for operators */
  balanceKop: number | null;
  email: string;
  /** price of a 7-slide set */
  cardsKop: number;
}) {
  return (
    <div className="app-page">
      <header className="app-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <span className="app-top-right">
          <a className="link-btn" href="/showcase">Витрина работ</a>
          {balanceKop !== null && <a className="btn btn-ghost btn-sm" href="/studio?topup=1" title="Пополнить">Баланс {formatKop(Math.max(0, balanceKop))}</a>}
          <span className="home-email" title={email}>{email}</span>
        </span>
      </header>

      <main className="home">
        <h1 className="home-title">Что сделаем?</h1>

        <div className="home-tasks">
          <a className="home-task is-main" href="/make/cards">
            <span className="home-task-icon"><ImagesIcon size={22} aria-hidden /></span>
            <span className="home-task-name">Карточки для маркетплейса</span>
            <span className="home-task-desc">Фото товара и пара фраз о нём: комплект из 5–10 слайдов в одном стиле для Wildberries или Ozon. Тексты видно до оплаты.</span>
            <span className="home-task-meta">Около {Math.max(1, Math.round(cardsKop / 100))} ₽ за 7 слайдов<ArrowRightIcon size={14} aria-hidden /></span>
          </a>
          <form className="home-task-form" action="/api/start" method="post">
            <input type="hidden" name="task" value="director" />
            <button type="submit" className="home-task">
              <span className="home-task-icon"><FilmSlateIcon size={22} aria-hidden /></span>
              <span className="home-task-name">Ролик по идее</span>
              <span className="home-task-desc">Опиши идею: получишь сценарий по сценам, кадры, видео, голос и субтитры, собранные в ролик.</span>
              <span className="home-task-meta">Для Reels и Shorts<ArrowRightIcon size={14} aria-hidden /></span>
            </button>
          </form>
          <form className="home-task-form" action="/api/start" method="post">
            <input type="hidden" name="task" value="animate" />
            <button type="submit" className="home-task">
              <span className="home-task-icon"><SparkleIcon size={22} aria-hidden /></span>
              <span className="home-task-name">Оживить фото</span>
              <span className="home-task-desc">Загрузи снимок и опиши движение: получится короткое видео на 5 секунд.</span>
              <span className="home-task-meta">Одно фото, одно видео<ArrowRightIcon size={14} aria-hidden /></span>
            </button>
          </form>
          <form className="home-task-form" action="/api/start" method="post">
            <input type="hidden" name="task" value="empty" />
            <button type="submit" className="home-task">
              <span className="home-task-icon"><FlowArrowIcon size={22} aria-hidden /></span>
              <span className="home-task-name">Свой пайплайн</span>
              <span className="home-task-desc">Пустой холст: собери цепочку из десятков моделей для картинок, видео и звука сам.</span>
              <span className="home-task-meta">Для продвинутых<ArrowRightIcon size={14} aria-hidden /></span>
            </button>
          </form>
        </div>

        {projects.length > 0 && (
          <section className="home-recent" aria-label="Недавние проекты">
            <h2>Недавние проекты</h2>
            <ul>
              {projects.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <a href={`/studio/${p.id}`}>
                    <span className="home-recent-name">{p.name}</span>
                    <span className="home-recent-meta">{p.ownerEmail ? `от ${p.ownerEmail.split("@")[0]} · ` : ""}{ago(p.updatedAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="home-foot">
          <a href="/terms">Условия использования</a>
          <a href="/privacy">Конфиденциальность</a>
        </footer>
      </main>
    </div>
  );
}
