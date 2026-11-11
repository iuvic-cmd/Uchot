/* core.js — единый расчёт денег для всех страниц.
 *
 * Правила (одни на всё приложение):
 *  1. Источник денег — fin.istorija («Финансы»). Всё, что записано там, считается один раз.
 *  2. cashOperations (старая касса) учитывается ТОЛЬКО за даты раньше первой записи «Финансов».
 *     Всё, что старая страница пишет в кассу позже, игнорируется — дублей быть не может.
 *  3. fuelLog — только литры/цена (для расхода л/100км). Деньги за топливо берутся из журнала операций.
 *  4. Каждая операция получает kind: tips | income | fuel | scooter | expense | transfer | debt.
 *     Переводы, начальные остатки, сверки и долги — не доход и не расход.
 *  5. Категории можно исключить из расчёта (localStorage "statsCfg"), например бытовые траты.
 */
(function (g) {
    const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const pad = n => String(n).padStart(2, "0");
    const localDate = d => { const x = new Date(d); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); };
    const num = v => {
        if (typeof v === "number") return isFinite(v) ? v : 0;
        const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(/[−–—]/g, "-").replace(",", "."));
        return isFinite(n) ? n : 0;
    };
    const normDate = v => {
        if (v == null || v === "") return "";
        if (typeof v === "number") return localDate(v);
        const s = String(v).trim();
        let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
            if (s.length > 10 && /(Z|[+-]\d{2}:?\d{2})$/i.test(s)) { const d = new Date(s); if (!isNaN(d)) return localDate(d); }
            return m[0];
        }
        m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
        const d = new Date(s); return isNaN(d) ? "" : localDate(d);
    };
    const rawDate = o => normDate(o.date ?? o.timestamp ?? o.ts ?? o.createdAt ?? o.time);
    const arr = k => { const v = LS(k, []); return Array.isArray(v) ? v.filter(x => x && typeof x === "object") : []; };

    const SCOOTER_RE = /сервис|мойк|мото|мопед|скутер|масл|запчаст|ремонт|расходник/i;
    const FUEL_RE = /топлив/i;
    const TRANSFER_RE = /перевод|сверк|начальн/i;
    const DEBT = ["debt_taken", "debt_given", "debt_repaid", "debt_returned"];
    const SYS = { tips: "💵 Чаевые", debt_taken: "📥 Взял в долг", debt_given: "📤 Дал в долг", debt_repaid: "✅ Вернул долг", debt_returned: "✅ Мне вернули", fuel_quick: "⛽ Топливо" };

    const kindOf = (name, amount, type) => {
        if (amount > 0) return (type === "start" || TRANSFER_RE.test(name)) ? "transfer" : "income";
        if (FUEL_RE.test(name) || type === "fuel_quick") return "fuel";
        return SCOOTER_RE.test(name) ? "scooter" : "expense";
    };

    // операции из «Финансов»
    function finOps() {
        const f = LS("fin", null);
        if (!f || !Array.isArray(f.istorija)) return [];
        const out = [];
        f.istorija.forEach(z => {
            if (!z || typeof z !== "object") return;
            const date = normDate(z.data); if (!date) return;
            const s = Math.abs(num(z.summa)); if (!(s > 0)) return;
            const v = z.baz != null ? Math.abs(num(z.baz)) : s; // в леях
            const kat = String(z.kat || "Без категории");
            if (z.tip === "Трата" || (z.tip === "Кредитка" && z.napr === "покупка")) {
                out.push({ id: "fin" + z.id, date, type: "fin:" + kat, amount: -v, comment: z.zametka || "", cat: kat, kind: kindOf(kat, -v, ""), src: "fin" });
            } else if (z.tip === "Доход") {
                if (kat === "Чаевые") out.push({ id: "fin" + z.id, date, type: "tips", amount: v, comment: z.zametka || "", cat: kat, kind: "tips", src: "fin" });
                else if (!/зарплат|начальн/i.test(kat)) out.push({ id: "fin" + z.id, date, type: "fin:" + kat, amount: v, comment: z.zametka || "", cat: kat, kind: "income", src: "fin" });
            }
        });
        return out;
    }

    let _c = null;
    function ops() {
        if (_c) return _c;
        const fin = finOps();
        const start = fin.reduce((m, o) => o.date < m ? o.date : m, "9999-99-99");
        const names = Object.fromEntries(arr("cashCategories").map(c => [c.id, c.name]));
        const legacy = arr("cashOperations").map(o => {
            const type = String(o.type || ""), amount = num(o.amount), date = rawDate(o);
            const cat = names[type] || SYS[type] || "❔ Без категории";
            const kind = type === "tips" ? "tips" : DEBT.includes(type) ? "debt" : type === "start" ? "transfer" : kindOf(cat, amount, type);
            return { id: o.id, date, type, amount, comment: o.comment || "", cat, kind, src: "cash" };
        }).filter(o => o.date && o.date < start);
        return (_c = legacy.concat(fin));
    }

    // исключённые категории
    const cfg = () => { const c = LS("statsCfg", null); return { excl: Array.isArray(c && c.excl) ? c.excl : [] }; };
    const isExcluded = cat => cfg().excl.includes(cat);
    function toggleExcl(cat) {
        const c = cfg(), i = c.excl.indexOf(cat);
        if (i >= 0) c.excl.splice(i, 1); else c.excl.push(cat);
        try { localStorage.setItem("statsCfg", JSON.stringify(c)); } catch (e) {}
    }

    const isExpenseRaw = o => o.amount < 0 && (o.kind === "fuel" || o.kind === "scooter" || o.kind === "expense");
    const isExpense = o => isExpenseRaw(o) && !isExcluded(o.cat);

    // расходы на скутер: топливо + сервис/мойка/расходники (одинаково на всех страницах)
    const scooterList = () => ops().filter(o => o.amount < 0 && (o.kind === "fuel" || o.kind === "scooter"))
        .map(o => ({ date: o.date, cat: o.cat, amount: Math.abs(o.amount), fuel: o.kind === "fuel" }));
    const fuelTotal = () => ops().filter(o => o.kind === "fuel" && o.amount < 0).reduce((s, o) => s + Math.abs(o.amount), 0);

    // долги: из раздела «Долги» в «Финансах»; если его нет — из старой кассы
    function debts() {
        const f = LS("fin", null);
        if (f && Array.isArray(f.dolgi)) {
            const rate = c => !c || c === "MDL" ? 1 : (+((f.kursy || {})[c]) || 0);
            let me = 0, i = 0;
            f.dolgi.forEach(d => { const v = num(d.ostatok) * rate(d.val); if (d.napr === "Мне должны") me += v; else i += v; });
            return { owedToMe: me, iOwe: i };
        }
        const all = arr("cashOperations").map(o => ({ t: o.type, a: Math.abs(num(o.amount)) }));
        const s = t => all.filter(x => x.t === t).reduce((a, x) => a + x.a, 0);
        return { owedToMe: Math.max(s("debt_given") - s("debt_returned"), 0), iOwe: Math.max(s("debt_taken") - s("debt_repaid"), 0) };
    }

    g.Core = { LS, num, normDate, rawDate, arr, ops, reset() { _c = null; }, isExpense, isExpenseRaw, isExcluded, toggleExcl, scooterList, fuelTotal, debts };

    // cash.html: подключаем единый расчёт к его аналитике (достаточно добавить <script src="core.js"> в конец страницы)
    function patchCash() {
        if (typeof g.scooterExpenses !== "function" || !document.getElementById("expensesAnalyticsContent")) return;
        g.scooterExpenses = () => { _c = null; return scooterList(); };
        const rf = g.renderFuelStats;
        if (typeof rf === "function") g.renderFuelStats = function () {
            rf();
            const el = document.getElementById("fuelTotalCost");
            if (el) el.innerText = fuelTotal().toFixed(2) + " лей";
        };
        if (typeof g.refreshAll === "function") g.refreshAll();
    }
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", patchCash); else patchCash();
    }
})(window);
