/* plan-safe.js — защита плана (localStorage["monthPlan"]) от потери.
 * Подключение: в plan.html в <head>, сразу после <title>, одна строка:
 *     <script src="plan-safe.js"></script>
 * Что делает (всё ДО запуска кода страницы):
 *  1. Старый/неполный план приводит к текущему формату, ничего не выбрасывая (вместо «сбросить и начать заново»).
 *  2. Если план оказался пустым, а в резервных копиях данные есть — восстанавливает их.
 *  3. Перед каждой перезаписью плана сохраняет предыдущую версию (monthPlan_prev),
 *     а если плана стало заметно меньше — ещё и отдельную копию monthPlan_lost_* (последние 3).
 *  4. Просит у браузера «постоянное» хранилище, чтобы Safari не стирал данные.
 *  5. Добавляет кнопки «Копия», «Вставить», «Откат».
 */
(function () {
    const K = "monthPlan", PREV = "monthPlan_prev", LOST = "monthPlan_lost_", BROKEN = "monthPlan_broken";
    const ls = window.localStorage, rawSet = Storage.prototype.setItem;
    const parse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
    const isPlan = p => p && typeof p === "object" && Array.isArray(p.sections);
    const count = p => isPlan(p) ? p.sections.reduce((n, s) => n + (s && Array.isArray(s.tasks) ? s.tasks.length : 0), 0) : 0;
    const hasData = p => isPlan(p) && (count(p) > 0 || !!(p.goal || p.checkpoint));
    const monthNow = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
    const put = (k, v) => { try { rawSet.call(ls, k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} };

    function normalize(p) {
        p.sections = p.sections.filter(s => s && typeof s === "object").map((s, i) => ({
            ...s, key: s.key || ("s_" + i), title: s.title || "Блок",
            tasks: (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && typeof t === "object")
        }));
        if (!p.sections.length) p.sections.push({ key: "main", title: "📋 Мой план на месяц", tasks: [] });
        p.sections.forEach((s, si) => s.tasks.forEach((t, i) => {
            if (!t.id) t.id = "t_" + Date.now().toString(36) + si + i;
            t.title = t.title || "Без названия"; t.plan = +t.plan || 0; t.fact = +t.fact || 0;
        }));
        p.month = p.month || "Новый месяц"; p.goal = p.goal || ""; p.checkpoint = p.checkpoint || "";
        p.period = p.period || monthNow(); p.schema = 3;
        return p;
    }
    const backupKeys = () => { const out = [PREV]; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && (k.indexOf(LOST) === 0 || k.indexOf("monthPlan_backup_v") === 0)) out.push(k); } return out; };

    // --- 1–2. приведение к формату и восстановление ---
    let restored = false;
    try {
        const raw = ls.getItem(K);
        let cur = raw == null ? null : parse(raw);
        if (raw != null && cur === undefined) { put(BROKEN, raw); cur = null; }   // битый JSON — сохраняем как есть
        if (isPlan(cur)) { cur = normalize(cur); put(K, cur); }
        if (!hasData(cur)) {
            let best = null;
            backupKeys().forEach(k => { const p = parse(ls.getItem(k)); if (hasData(p) && (!best || count(p) > count(best))) best = p; });
            if (best) { put(K, normalize(best)); restored = true; }
        }
    } catch (e) { console.warn("plan-safe:", e); }

    // --- 3. снимки перед перезаписью ---
    Storage.prototype.setItem = function (k, v) {
        if (this === ls && k === K) {
            try {
                const old = ls.getItem(K);
                if (old && old !== v) {
                    const o = parse(old), n = parse(v);
                    if (hasData(o)) {
                        put(PREV, old);
                        if (!hasData(n) || count(n) < count(o) - 1) {
                            put(LOST + Date.now(), old);
                            const lost = []; for (let i = 0; i < ls.length; i++) { const kk = ls.key(i); if (kk && kk.indexOf(LOST) === 0) lost.push(kk); }
                            lost.sort().slice(0, Math.max(0, lost.length - 3)).forEach(kk => ls.removeItem(kk));
                        }
                    }
                }
            } catch (e) {}
        }
        return rawSet.call(this, k, v);
    };

    // --- 4. постоянное хранилище ---
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

    // --- 5. кнопки ---
    document.addEventListener("DOMContentLoaded", () => {
        const tb = document.querySelector(".toolbar"); if (!tb) return;
        const bar = document.createElement("div"); bar.className = "toolbar";
        bar.innerHTML = '<button id="psCopy">💾 Копия</button><button id="psPaste">📥 Вставить</button><button id="psUndo">↩ Откат</button>';
        tb.insertAdjacentElement("afterend", bar);
        const note = m => { const n = document.createElement("div"); n.className = "notification"; n.textContent = m; document.body.appendChild(n); setTimeout(() => n.remove(), 2400); };
        document.getElementById("psCopy").onclick = () => {
            const s = ls.getItem(K) || "";
            const fb = () => { const t = document.createElement("textarea"); t.value = s; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove(); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(fb); else fb();
            note("План скопирован в буфер");
        };
        document.getElementById("psPaste").onclick = () => {
            const s = prompt("Вставьте скопированный план:"); if (!s) return;
            const p = parse(s); const plan = isPlan(p) ? p : (p && isPlan(p.monthPlan) ? p.monthPlan : null);
            if (!plan) { alert("Не похоже на план."); return; }
            if (confirm("Заменить текущий план вставленным? Текущий сохранится в «Откат».")) { ls.setItem(K, JSON.stringify(normalize(plan))); location.reload(); }
        };
        document.getElementById("psUndo").onclick = () => {
            const p = parse(ls.getItem(PREV));
            if (!hasData(p)) { alert("Предыдущей версии нет."); return; }
            if (confirm("Вернуть предыдущую версию плана?")) { ls.setItem(K, JSON.stringify(normalize(p))); location.reload(); }
        };
        if (restored) note("План восстановлен из резервной копии");
    });
})();
