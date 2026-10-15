/**
 * Accounts by invitation (SIGNUP_MODE=invite) and owner-granted balance.
 *
 *   npm run invite                         who has access, balance and spend
 *   npm run invite -- anna@mail.ru         let this address sign in
 *   npm run invite -- anna@mail.ru 500     ...and credit 500 ₽ (negative takes money back)
 *
 * The credit is an "adjust" ledger row: it shows in the person's history like a top-up,
 * and it is the hard limit of what they can spend of the owner's provider account.
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/kaskad", {
  max: 1, onnotice: () => {},
});

const rub = (kop: number) => `${(kop / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;

async function list() {
  const rows = await sql<{ email: string; balance: string; spent: string; created_at: Date }[]>`
    select u.email, u.created_at,
      coalesce(sum(l.amount_kop), 0) as balance,
      coalesce(sum(-l.amount_kop) filter (where l.kind = 'charge'), 0) as spent
    from users u left join ledger l on l.user_id = u.id
    group by u.id order by u.created_at`;
  if (!rows.length) return console.log("Аккаунтов пока нет. Добавить: npm run invite -- почта@пример.ру 500");
  console.table(rows.map((r) => ({
    почта: r.email, баланс: rub(Number(r.balance)), потрачено: rub(Number(r.spent)),
    создан: r.created_at.toLocaleDateString("ru-RU"),
  })));
}

async function invite(rawEmail: string, rawRub: string | undefined) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(`не похоже на почту: ${rawEmail}`);
  const amount = rawRub === undefined ? 0 : Number(rawRub.replace(",", "."));
  if (!Number.isFinite(amount) || Math.abs(amount) > 100_000) throw new Error(`сумма в рублях, до 100 000: ${rawRub}`);
  const kop = Math.round(amount * 100);

  await sql.begin(async (tx) => {
    const [created] = await tx`insert into users (email) values (${email}) on conflict (email) do nothing returning id`;
    const [user] = created ? [created] : await tx`select id from users where email = ${email}`;
    console.log(created ? `Добавлен: ${email}` : `Уже есть: ${email}`);
    if (kop !== 0) {
      await tx`insert into ledger (user_id, amount_kop, kind, note)
        values (${user.id}, ${kop}, 'adjust', ${kop > 0 ? "Начислено владельцем" : "Списано владельцем"})`;
      console.log(`${kop > 0 ? "Начислено" : "Списано"}: ${rub(Math.abs(kop))}`);
    }
  });
  if (process.env.SIGNUP_MODE?.trim().toLowerCase() !== "invite") {
    console.log("Внимание: SIGNUP_MODE не равен invite, войти сейчас может любой адрес.");
  }
}

const [email, amount] = process.argv.slice(2);
(email ? invite(email, amount).then(list) : list())
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(/ECONNREFUSED|connect/.test(msg) ? "База не запущена: сначала запустите сервис (start-prod.bat)." : `Ошибка: ${msg}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
