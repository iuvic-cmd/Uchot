/* scooter.js — дополнение к cash.html (страница «Скутер»).
 * Добавляет:
 *  1) раздел «Мойка / сервис / расходники»: трата списывается с кошелька «Финансов» и сразу попадает в статистику;
 *  2) «ТО / Расходники» → «Записать замену» и «История замен» по всем пунктам (масло, фильтр, ремень, колодки, свечи, другое).
 * Подключение: в cash.html перед </body> одна строка:  <script src="scooter.js"></script>
 * (core.js подтянется сам.)
 */
(function () {
    function boot() {
        const LOG = "maintLog";
        const $ = id => document.getElementById(id);
        const r2 = x => Math.round(x * 100) / 100;
        const pad = n => String(n).padStart(2, "0");
        const E = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        const dRu = d => d ? String(d).split("-").reverse().join(".") : "—";
        const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
        const alertErr = e => showAlertDialog(typeof e === "string" ? e : (e && e.message) || "Ошибка");
        const ITEMS = [["oil", "🛢 Масло"], ["filter", "💨 Воздушный фильтр"], ["belt", "⚙ Ремень"], ["pads", "🛑 Колодки"], ["candles", "🔌 Свечи"], ["other", "🔧 Другое"]];
        const itemName = k => (ITEMS.find(x => x[0] === k) || [0, k])[1];
        const SPEND = [["Мойка Мопед", "🧼 Мойка мопеда"], ["Сервис Мопед", "🔧 Сервис"], ["Расходники Мопед", "🛢 Расходники"], ["Ремонт Мопед", "🛠 Запчасти / ремонт"]];

        // ---------- «Финансы»: списание и возврат ----------
        function finSpend(wallet, amount, date, kat, note) {
            const fin = LS("fin", null);
            if (!fin || !fin.kohelki || !(wallet in fin.kohelki)) throw "Выберите кошелёк (нужны данные «Финансов»).";
            if (fin.kohelki[wallet] < amount) throw `Недостаточно средств на «${wallet}»: ${fin.kohelki[wallet].toFixed(2)} лей.`;
            fin.kohelki[wallet] = r2(fin.kohelki[wallet] - amount);
            fin.traty = fin.traty || {}; fin.traty[kat] = r2((fin.traty[kat] || 0) + amount);
            fin.kat_trat = fin.kat_trat || []; if (!fin.kat_trat.includes(kat)) fin.kat_trat.push(kat);
            fin.istorija = fin.istorija || [];
            const id = Math.max(0, ...fin.istorija.map(x => (x && x.id) || 0)) + 1, t = new Date();
            const rec = { id, data: date + " " + pad(t.getHours()) + ":" + pad(t.getMinutes()), tip: "Трата", summa: amount, koshel: wallet, kat };
            if (note) rec.zametka = note;
            fin.istorija.push(rec); fin._ts = Date.now();
            save("fin", fin);
            return id;
        }
        function finUnspend(id) {
            const fin = LS("fin", null); if (!fin || !Array.isArray(fin.istorija)) return;
            const i = fin.istorija.findIndex(x => x && x.id === id); if (i < 0) return;
            const z = fin.istorija[i]; if (z.tip !== "Трата") return;
            if (fin.kohelki && z.koshel in fin.kohelki) fin.kohelki[z.koshel] = r2(fin.kohelki[z.koshel] + z.summa);
            if (fin.traty) fin.traty[z.kat] = Math.max(0, r2((fin.traty[z.kat] || 0) - z.summa));
            fin.istorija.splice(i, 1); fin._ts = Date.now();
            save("fin", fin);
        }
        function fillWallets(id, allowNone) {
            const fin = LS("fin", null), sel = $(id); if (!sel) return;
            const keep = sel.value;
            if (!fin || !fin.kohelki) { sel.innerHTML = `<option value="">нет данных «Финансов»</option>`; return; }
            sel.innerHTML = (allowNone ? `<option value="">— не списывать —</option>` : "") +
                Object.keys(fin.kohelki).filter(w => !(fin.valyuty || {})[w]).map(w => `<option value="${E(w)}">${E(w)} (${(+fin.kohelki[w]).toFixed(2)})</option>`).join("");
            if (keep) sel.value = keep;
        }
        const wallets = () => { fillWallets("spWallet", false); fillWallets("mlWallet", true); };
        const refreshMoney = () => {
            Core.reset();
            if (typeof renderExpensesAnalytics === "function") renderExpensesAnalytics();
            if (typeof populateWallets === "function") populateWallets();
            wallets(); renderSpend();
        };

        // ---------- мойка / сервис ----------
        function addSpend() {
            try {
                const kat = $("spKat").value, date = $("spDate").value || today(), a = r2(parseFloat($("spSum").value) || 0), w = $("spWallet").value;
                if (!(a > 0)) throw "Введите сумму.";
                if (!w) throw "Выберите кошелёк.";
                finSpend(w, a, date, kat, $("spNote").value.trim());
                $("spSum").value = ""; $("spNote").value = "";
                refreshMoney(); showNotification(`✅ ${kat}: ${a.toFixed(2)} лей`);
            } catch (e) { alertErr(e); }
        }
        function delSpend(id) {
            showConfirmDialog("Удалить расход?\nДеньги вернутся на кошелёк в «Финансах».", () => { finUnspend(id); refreshMoney(); showNotification("🗑 Расход удалён"); });
        }
        function renderSpend() {
            const c = $("spList"); if (!c) return;
            Core.reset();
            const rows = Core.ops().filter(o => o.kind === "scooter" && o.amount < 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
            c.innerHTML = rows.length ? rows.map(o => {
                const fid = o.src === "fin" ? parseInt(String(o.id).slice(3)) : null;
                return `<div class="list-row" style="align-items:center"><span>${dRu(o.date)}</span><span style="flex:1;text-align:right">${E(o.cat)}${o.comment ? `<br><small style="color:var(--text-dim)">${E(o.comment)}</small>` : ""} · <b>${Math.abs(o.amount).toFixed(2)}</b></span>${fid ? `<button style="background:none;border:none;font-size:16px;padding:4px 8px;cursor:pointer" onclick="Scooter.delSpend(${fid})">🗑</button>` : ""}</div>`;
            }).join("") : `<p class="empty-note">Пока нет расходов</p>`;
        }

        // ---------- история замен ----------
        const getLog = () => { const v = LS(LOG, null); return Array.isArray(v) ? v : []; };
        const setLog = l => save(LOG, l);
        function seedLog() {
            if (LS(LOG, null) !== null) return;
            const l = [], id = () => newId();
            if (oilData && oilData.mileage != null) l.push({ id: id(), item: "oil", date: oilData.date || "", km: +oilData.mileage || 0, cost: 0, note: "из настроек ТО" });
            if (filterData && filterData.mileage != null) l.push({ id: id(), item: "filter", date: filterData.date || "", km: +filterData.mileage || 0, cost: 0, note: "из настроек ТО" });
            const p = otherParts || {};
            ["belt", "pads", "candles"].forEach(k => { if (+p[k + "At"] > 0) l.push({ id: id(), item: k, date: "", km: +p[k + "At"], cost: 0, note: "из настроек ТО" }); });
            setLog(l);
        }
        function applyReplacement(item, date, km) {
            if (item === "oil") setMaint("oil", { ...(oilData || {}), date, mileage: km, interval: (oilData && oilData.interval) || 0 });
            else if (item === "filter") setMaint("filter", { ...(filterData || {}), date, mileage: km, interval: (filterData && filterData.interval) || 0 });
            else if (["belt", "pads", "candles"].includes(item)) setMaint("other", { ...(otherParts || {}), [item + "At"]: km });
            buildMaintenance();
        }
        function addRepl() {
            try {
                const item = $("mlItem").value, date = $("mlDate").value || today();
                const km = parseFloat($("mlKm").value), kmv = isFinite(km) ? km : (mileageData.currentKm || 0);
                const cost = r2(parseFloat($("mlCost").value) || 0), w = $("mlWallet").value, note = $("mlNote").value.trim();
                if (cost > 0 && !w) throw "Для стоимости выберите кошелёк (или очистите сумму).";
                let spendId = null;
                if (cost > 0) spendId = finSpend(w, cost, date, item === "other" ? "Сервис Мопед" : "Расходники Мопед", "Замена: " + itemName(item).replace(/^\S+\s/, "") + (note ? " — " + note : ""));
                const l = getLog(); l.push({ id: newId(), item, date, km: kmv, cost, note, spendId }); setLog(l);
                applyReplacement(item, date, kmv);
                $("mlCost").value = ""; $("mlNote").value = ""; $("mlKm").value = "";
                refreshMoney(); renderLog(); showNotification("✅ Замена записана: " + itemName(item));
            } catch (e) { alertErr(e); }
        }
        function delLog(id) {
            const l = getLog(), e = l.find(x => x.id === id); if (!e) return;
            const rm = () => { setLog(l.filter(x => x.id !== id)); renderLog(); };
            if (e.spendId) showConfirmDialog("Удалить запись и связанный расход?\nДеньги вернутся на кошелёк.", () => { finUnspend(e.spendId); rm(); refreshMoney(); });
            else showConfirmDialog("Удалить запись из истории?\nТекущие счётчики ТО не изменятся.", rm);
        }
        function renderLog() {
            const c = $("mlList"); if (!c) return;
            const f = $("mlFilter") ? $("mlFilter").value : "all";
            const rows = getLog().filter(e => f === "all" || e.item === f)
                .sort((a, b) => (b.km - a.km) || String(b.date).localeCompare(String(a.date)));
            c.innerHTML = rows.length ? rows.map(e => `<div class="list-row" style="align-items:center"><span style="flex:1">${itemName(e.item)}<br><small style="color:var(--text-dim)">${dRu(e.date)}${e.note ? " · " + E(e.note) : ""}</small></span><span style="text-align:right"><b>${+(+e.km).toFixed(0)} км</b>${e.cost > 0 ? `<br><small>${(+e.cost).toFixed(2)} лей</small>` : ""}</span><button style="background:none;border:none;font-size:16px;padding:4px 8px;cursor:pointer" data-id="${E(e.id)}" onclick="Scooter.delLog(this.dataset.id)">🗑</button></div>`).join("") : `<p class="empty-note">Нет записей</p>`;
        }

        // запись в историю, если замену внесли старой формой «ТО / Расходники»
        const snap = () => ({ oil: oilData ? oilData.mileage + "|" + oilData.date : "", filter: filterData ? filterData.mileage + "|" + filterData.date : "", belt: +(otherParts || {}).beltAt || 0, pads: +(otherParts || {}).padsAt || 0, candles: +(otherParts || {}).candlesAt || 0 });
        const origSave = window.saveMaint;
        if (typeof origSave === "function") window.saveMaint = function (key) {
            const b = snap(); origSave(key); const a = snap(), l = getLog(); let n = 0;
            if (a.oil !== b.oil && oilData) { l.push({ id: newId(), item: "oil", date: oilData.date || today(), km: +oilData.mileage || 0, cost: 0, note: "форма ТО" }); n++; }
            if (a.filter !== b.filter && filterData) { l.push({ id: newId(), item: "filter", date: filterData.date || today(), km: +filterData.mileage || 0, cost: 0, note: "форма ТО" }); n++; }
            ["belt", "pads", "candles"].forEach(k => { if (a[k] !== b[k] && a[k] > 0) { l.push({ id: newId(), item: k, date: today(), km: a[k], cost: 0, note: "форма ТО" }); n++; } });
            if (n) { setLog(l); renderLog(); }
        };

        // ---------- интерфейс ----------
        function build() {
            const maintBtn = document.querySelector('button.menu-toggle[onclick*="maintBox"]');
            if (maintBtn && !$("washBox")) maintBtn.insertAdjacentHTML("beforebegin", `
<button class="menu-toggle" onclick="toggleMenu('washBox',this)"><span><span class="icon">🧼</span> Мойка / сервис / расходники</span><span class="arrow">▼</span></button>
<div id="washBox" class="menu-content">
  <div class="form-group"><label>Что оплатили</label><select id="spKat" class="form-control">${SPEND.map(s => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></div>
  <div class="two-col">
    <div class="form-group"><label>📅 Дата</label><input type="date" id="spDate" class="form-control"/></div>
    <div class="form-group"><label>Сумма (лей)</label><input type="number" inputmode="decimal" id="spSum" step="0.01" min="0" placeholder="0" class="form-control"/></div>
  </div>
  <div class="form-group"><label>💳 С какого кошелька списать?</label><select id="spWallet" class="form-control"></select></div>
  <div class="form-group"><label>Заметка</label><input type="text" id="spNote" class="form-control" placeholder="Необязательно"/></div>
  <button class="btn btn-start" onclick="Scooter.addSpend()">➕ Добавить расход</button>
  <div style="margin-top:12px"><div class="block-heading">📋 История: мойка, сервис, расходники</div><div class="scroll-list" id="spList"></div></div>
</div>`);
            const mb = $("maintBox");
            if (mb && !$("maintExtra")) mb.insertAdjacentHTML("beforeend", `
<div id="maintExtra">
  <div class="block-heading" style="margin-top:14px">➕ Записать замену</div>
  <div class="form-group"><label>Что заменили</label><select id="mlItem" class="form-control">${ITEMS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></div>
  <div class="two-col">
    <div class="form-group"><label>📅 Дата</label><input type="date" id="mlDate" class="form-control"/></div>
    <div class="form-group"><label>Пробег (км)</label><input type="number" inputmode="decimal" id="mlKm" min="0" placeholder="текущий" class="form-control"/></div>
  </div>
  <div class="two-col">
    <div class="form-group"><label>Стоимость (лей)</label><input type="number" inputmode="decimal" id="mlCost" step="0.01" min="0" placeholder="необязательно" class="form-control"/></div>
    <div class="form-group"><label>💳 Кошелёк</label><select id="mlWallet" class="form-control"></select></div>
  </div>
  <div class="form-group"><label>Заметка</label><input type="text" id="mlNote" class="form-control" placeholder="Что именно, где купили"/></div>
  <button class="btn btn-primary" onclick="Scooter.addRepl()">💾 Записать замену</button>
  <div class="block-heading" style="margin-top:16px">📜 История замен</div>
  <div class="form-group"><select id="mlFilter" class="form-control" onchange="Scooter.renderLog()"><option value="all">Все пункты</option>${ITEMS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join("")}</select></div>
  <div class="scroll-list" id="mlList" style="max-height:260px"></div>
</div>`);
            ["spDate", "mlDate"].forEach(id => { const el = $(id); if (el && !el.value) el.value = today(); });
        }

        window.Scooter = { addSpend, delSpend, addRepl, delLog, renderLog };
        seedLog(); build(); wallets(); renderSpend(); renderLog();
        window.addEventListener("storage", e => { if (e.key === "fin" || e.key === LOG) { wallets(); renderSpend(); renderLog(); } });
    }

    function start() {
        if (window.Core) { boot(); return; }
        const s = document.createElement("script"); s.src = "core.js"; s.onload = boot;
        s.onerror = () => alert("scooter.js: не найден core.js рядом со страницей.");
        document.body.appendChild(s);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
