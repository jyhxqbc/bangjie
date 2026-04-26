// ==========================================
// BLK 追踪系统核心逻辑 (V11.0 版)
// ==========================================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.getAttribute('data-target')).classList.add('active');
    });
});

function getTodayStr() {
    let d = new Date();
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function getLast5Days() {
    let days = [];
    for(let i=4; i>=0; i--) {
        let d = new Date();
        d.setDate(d.getDate() - i);
        days.push(`${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`);
    }
    return days;
}

const tsvToArray = (tsv) => tsv.split('\n').map(r => r.trim()).filter(Boolean);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// --- 全局数据与排序状态 ---
let trackerData = { 
    rankTasks: [], detailTasks: {}, hourlyTasks: [], 
    hourlySettings: { runHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23] } 
};
let rankSearchText = "";
let detailSearchText = "";
let rankSort = { field: 'keyword', asc: true };
let detailSort = { field: 'asin', asc: true }; 
let currentImportMode = ''; 
let rankFilterSite = "";
let rankFilterAsin = "";
let detailFilterSite = "";
let detailFilterAsin = "";

async function loadTrackerData() {
    let stored = await new Promise(resolve => chrome.storage.local.get(['blkTrackerData'], resolve));
    if(stored.blkTrackerData) {
        trackerData = stored.blkTrackerData;
        
        trackerData.rankTasks.forEach(t => {
            if(!t.siteCode) { t.siteCode = 'US'; t.domain = 'amazon.com'; }
        });
        
        if(!trackerData.hourlySettings) trackerData.hourlySettings = { runHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23] };
        if(!trackerData.hourlyTasks) trackerData.hourlyTasks = [];
        trackerData.hourlyTasks.forEach(t => { if(t.isActive === undefined) t.isActive = true; });

        let newDetailTasks = {};
        for(let key in trackerData.detailTasks) {
            let t = trackerData.detailTasks[key];
            if(!t.siteCode) { t.siteCode = 'US'; t.domain = 'amazon.com'; t.asin = key; }
            let newKey = key.includes('_') ? key : `${t.asin}_${t.siteCode}`;
            newDetailTasks[newKey] = t;
        }
        trackerData.detailTasks = newDetailTasks;
    }
    renderRankTable();
    renderDetailTable();
}

async function saveTrackerData() {
    await chrome.storage.local.set({ blkTrackerData: trackerData });
}

document.addEventListener('DOMContentLoaded', () => {
    loadTrackerData();

    document.getElementById('rankTableHead').addEventListener('click', (e) => {
        if(e.target.tagName === 'INPUT') return; 
        let th = e.target.closest('th');
        if(th && th.dataset.sort) handleRankSort(th.dataset.sort);
    });
    document.getElementById('rankTableHead').addEventListener('change', (e) => {
        if(e.target.id === 'selectAllRankCb') {
            document.querySelectorAll('.rank-cb').forEach(cb => cb.checked = e.target.checked);
        }
    });

    document.getElementById('detailTableHead').addEventListener('click', (e) => {
        if(e.target.tagName === 'INPUT') return;
        let th = e.target.closest('th');
        if(th && th.dataset.sort) handleDetailSort(th.dataset.sort);
    });
    document.getElementById('detailTableHead').addEventListener('change', (e) => {
        if(e.target.id === 'selectAllDetailCb') {
            document.querySelectorAll('.detail-cb').forEach(cb => cb.checked = e.target.checked);
        }
    });

    document.getElementById('syncRankBtn').addEventListener('click', async (e) => { await runRankEngine(e.target); await saveTrackerData(); });
    document.getElementById('syncDetailBtn').addEventListener('click', async (e) => { await runDetailEngine(e.target); await saveTrackerData(); });
    document.getElementById('syncAllBtn').addEventListener('click', async (e) => {
        if(trackerData.rankTasks.length === 0 && Object.keys(trackerData.detailTasks).length === 0) {
            return alert("⚠️ 当前没有任何监控任务！请先在下方添加任务。");
        }
        e.target.disabled = true; 
        e.target.innerText = "🔄 正在调度全盘任务...";
        await sleep(50); 
        if(trackerData.rankTasks.length > 0) await runRankEngine(document.getElementById('syncRankBtn'));
        if(Object.keys(trackerData.detailTasks).length > 0) await runDetailEngine(document.getElementById('syncDetailBtn'));
        await saveTrackerData();
        e.target.disabled = false; 
        e.target.innerText = "▶ 一键抓取全部任务 (功能1+2)";
        if(!globalEmergencyStop) alert("🎉 所有追踪数据在并发模式下更新完毕！");
    });
});

document.addEventListener('change', async (e) => {
    if(e.target.classList.contains('remark-input')) {
        let val = e.target.value.trim();
        let type = e.target.dataset.type;
        let field = e.target.dataset.field;
        let asin = e.target.dataset.asin;

        if(type === 'rank') {
            let task = trackerData.rankTasks.find(t => t.asin === asin && t.keyword === e.target.dataset.kw);
            if(task) task[field] = val;
        } else if(type === 'detail') {
            let taskKey = Object.keys(trackerData.detailTasks).find(key => trackerData.detailTasks[key].asin === asin);
            let targetDate = e.target.dataset.date;
            if(taskKey && targetDate === '待运行') {
                trackerData.detailTasks[taskKey][field] = val;
            } else if(taskKey && trackerData.detailTasks[taskKey].history[targetDate]) {
                trackerData.detailTasks[taskKey].history[targetDate][field] = val;
            }
        }
        await saveTrackerData();
    }
});

function exportTableToExcel(tableId, filename) {
    let table = document.getElementById(tableId);
    let clone = table.cloneNode(true);
    let rows = clone.querySelectorAll('tr');
    rows.forEach(row => {
        if(row.children.length > 0) row.removeChild(row.children[0]); 
        let inputs = row.querySelectorAll('input[type="text"]');
        inputs.forEach(input => {
            let textNode = document.createTextNode(input.value || '');
            input.parentNode.replaceChild(textNode, input);
        });
        let imgs = row.querySelectorAll('img');
        imgs.forEach(img => img.parentNode.replaceChild(document.createTextNode('商品图'), img));
    });
    let htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>${clone.outerHTML}</body></html>`;
    let uri = 'data:application/vnd.ms-excel;base64,';
    let base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));
    let link = document.createElement("a");
    link.href = uri + base64;
    link.download = `${filename}_${getTodayStr()}.xls`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
document.getElementById('exportRankExcelBtn').addEventListener('click', () => {
    if(trackerData.rankTasks.length === 0) return alert("⚠️ 当前没有排名数据可导出！");
    exportTableToExcel('rankTable', '自然排名追踪报表');
});
document.getElementById('exportDetailExcelBtn').addEventListener('click', () => {
    if(Object.keys(trackerData.detailTasks).length === 0) return alert("⚠️ 当前没有详情数据可导出！");
    exportTableToExcel('detailTable', '详情快照监控报表');
});

// ==========================================
// 🌟 升级：按需导出与智能增量导入系统 V11.0
// ==========================================

// 1. 导出弹窗交互逻辑
document.getElementById('exportJsonLnk').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('exportModal').style.display = 'flex';
});
document.getElementById('closeExportModalBtn').addEventListener('click', () => {
    document.getElementById('exportModal').style.display = 'none';
});

// 全选复选框联动
document.getElementById('exportCbAll').addEventListener('change', (e) => {
    document.querySelectorAll('.export-cb').forEach(cb => cb.checked = e.target.checked);
});
document.querySelectorAll('.export-cb').forEach(cb => {
    cb.addEventListener('change', () => {
        let allChecked = Array.from(document.querySelectorAll('.export-cb')).every(c => c.checked);
        document.getElementById('exportCbAll').checked = allChecked;
    });
});

// 2. 确认按需导出
document.getElementById('confirmExportBtn').addEventListener('click', () => {
    let exportData = {};
    let isRankChecked = document.querySelector('.export-cb[value="rank"]').checked;
    let isDetailChecked = document.querySelector('.export-cb[value="detail"]').checked;
    let isHourlyChecked = document.querySelector('.export-cb[value="hourly"]').checked;

    if (!isRankChecked && !isDetailChecked && !isHourlyChecked) {
        return alert("⚠️ 请至少选择一项要备份的数据模块！");
    }

    if (isRankChecked) exportData.rankTasks = trackerData.rankTasks;
    if (isDetailChecked) exportData.detailTasks = trackerData.detailTasks;
    if (isHourlyChecked) {
        exportData.hourlyTasks = trackerData.hourlyTasks;
        exportData.hourlySettings = trackerData.hourlySettings;
    }

    let a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], {type: "application/json"}));
    
    // 动态生成文件名，告诉你这个备份文件里到底包含了啥
    let modules = [];
    if(isRankChecked) modules.push("排名");
    if(isDetailChecked) modules.push("详情");
    if(isHourlyChecked) modules.push("分时");
    a.download = `BLK_备份_[${modules.join("+")}]_${getTodayStr()}.json`;
    a.click();
    
    document.getElementById('exportModal').style.display = 'none';
});

// 3. 智能增量导入 (只会覆盖导入文件中包含的模块，保护其他未备份数据)
document.getElementById('importJsonLnk').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('importJsonInput').click(); });
document.getElementById('importJsonInput').addEventListener('change', (e) => {
    let file = e.target.files[0];
    if(!file) return;
    let reader = new FileReader();
    reader.onload = async (event) => {
        try {
            let importedData = JSON.parse(event.target.result);
            let restored = [];
            
            if (importedData.rankTasks) { trackerData.rankTasks = importedData.rankTasks; restored.push("功能1"); }
            if (importedData.detailTasks) { trackerData.detailTasks = importedData.detailTasks; restored.push("功能2"); }
            if (importedData.hourlyTasks) { trackerData.hourlyTasks = importedData.hourlyTasks; restored.push("功能3任务"); }
            if (importedData.hourlySettings) { trackerData.hourlySettings = importedData.hourlySettings; }

            await saveTrackerData(); 
            renderRankTable(); 
            renderDetailTable();
            if(typeof renderHourlyCards === 'function') renderHourlyCards(); // 刷新卡片与折线图
            
            if (restored.length > 0) {
                alert(`✅ 数据增量恢复成功！\\n系统为您还原了以下模块: [${restored.join(', ')}]`);
            } else {
                alert("⚠️ 文件格式正确，但没有检测到任何支持的任务数据！");
            }
        } catch(err) { 
            alert("❌ JSON 文件解析失败或格式已损坏！"); 
        }
        e.target.value = ''; 
    };
    reader.readAsText(file);
});

document.getElementById('openRankImportModalBtn').addEventListener('click', () => {
    currentImportMode = 'rank';
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importPasteArea').value = '';
    document.getElementById('importHintText').innerHTML = '※ 排名模式：必须包含【<strong>父ASIN</strong>】和【<strong>追踪关键词</strong>】列。';
});

document.getElementById('openImportModalBtn').addEventListener('click', () => {
    currentImportMode = 'detail';
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importPasteArea').value = '';
    document.getElementById('importHintText').innerHTML = '※ 详情模式：必须包含【<strong>监控 ASIN</strong>】和【<strong>快照时间</strong>】列。';
});

document.getElementById('closeImportModalBtn').addEventListener('click', () => {
    document.getElementById('importModal').style.display = 'none';
});

document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    let text = document.getElementById('importPasteArea').value.trim();
    if(!text) return alert("⚠️ 请先将 Excel 数据粘贴到框内！");
    let lines = text.split('\n').map(l => l.split('\t'));
    if(lines.length < 2) return alert("未检测到有效数据，请确保同时复制了【表头】和【数据行】。");

    let headers = lines[0].map(h => h.trim().toLowerCase());
    let idxAsin = headers.findIndex(h => h.includes('asin'));
    let idxR1 = headers.findIndex(h => h.includes('备注1') || h.includes('r1'));
    let idxR2 = headers.findIndex(h => h.includes('备注2') || h.includes('r2'));
    let idxR3 = headers.findIndex(h => h.includes('备注3') || h.includes('r3'));
    let updatedCount = 0;

    if (currentImportMode === 'detail') {
        let idxDate = headers.findIndex(h => h.includes('时间') || h.includes('日期') || h.includes('date'));
        if(idxAsin === -1 || idxDate === -1) return alert("❌ 解析失败：功能2详情模式下，表头必须包含【ASIN】和【快照时间】字样！");
        for(let i = 1; i < lines.length; i++) {
            let row = lines[i];
            if(row.length <= Math.max(idxAsin, idxDate)) continue; 
            let asin = row[idxAsin].trim().toUpperCase();
            let date = row[idxDate].trim();
            let taskKey = Object.keys(trackerData.detailTasks).find(key => trackerData.detailTasks[key].asin === asin);
            if(taskKey && trackerData.detailTasks[taskKey].history[date]) {
                let targetSnap = trackerData.detailTasks[taskKey].history[date];
                if(idxR1 !== -1 && row[idxR1] !== undefined) targetSnap.r1 = row[idxR1].trim();
                if(idxR2 !== -1 && row[idxR2] !== undefined) targetSnap.r2 = row[idxR2].trim();
                if(idxR3 !== -1 && row[idxR3] !== undefined) targetSnap.r3 = row[idxR3].trim();
                updatedCount++;
            }
        }
        renderDetailTable();
    } else if (currentImportMode === 'rank') {
        let idxKw = headers.findIndex(h => h.includes('关键词') || h.includes('keyword'));
        if(idxAsin === -1 || idxKw === -1) return alert("❌ 解析失败：功能1排名模式下，表头必须包含【ASIN】和【追踪关键词】字样！");
        for(let i = 1; i < lines.length; i++) {
            let row = lines[i];
            if(row.length <= Math.max(idxAsin, idxKw)) continue;
            let asin = row[idxAsin].trim().toUpperCase();
            let kw = row[idxKw].trim();
            let task = trackerData.rankTasks.find(t => t.asin === asin && t.keyword === kw);
            if(task) {
                if(idxR1 !== -1 && row[idxR1] !== undefined) task.r1 = row[idxR1].trim();
                if(idxR2 !== -1 && row[idxR2] !== undefined) task.r2 = row[idxR2].trim();
                if(idxR3 !== -1 && row[idxR3] !== undefined) task.r3 = row[idxR3].trim();
                updatedCount++;
            }
        }
        renderRankTable();
    }
    await saveTrackerData();
    document.getElementById('importModal').style.display = 'none';
    alert(`✅ 智能覆盖完成！成功匹配并更新了 ${updatedCount} 条备注数据。`);
});

function smartSort(a, b, field, asc) {
    let valA = a[field] ?? ''; let valB = b[field] ?? '';
    let hasNumA = String(valA).match(/\d/); let hasNumB = String(valB).match(/\d/);
    let numA = hasNumA ? parseFloat(String(valA).replace(/[^0-9.-]/g, '')) : NaN;
    let numB = hasNumB ? parseFloat(String(valB).replace(/[^0-9.-]/g, '')) : NaN;
    let isNumA = !isNaN(numA) && hasNumA; let isNumB = !isNaN(numB) && hasNumB;
    if (isNumA && isNumB) { if (numA !== numB) return asc ? numA - numB : numB - numA; }
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;
    if(valA < valB) return asc ? -1 : 1;
    if(valA > valB) return asc ? 1 : -1;
    return 0;
}

// ================= 功能1：排名渲染 =================
document.getElementById('addRankTaskBtn').addEventListener('click', async () => {
    let asin = document.getElementById('rankAsin').value.trim().toUpperCase();
    let kws = tsvToArray(document.getElementById('rankKws').value);
    let siteVal = document.getElementById('rankSiteSelect').value.split('|');
    if(!asin || kws.length === 0) return alert("⚠️ 请填写至少 1 个 ASIN 和 1 个关键词！"); 
    kws.forEach(kw => {
        if(!trackerData.rankTasks.find(t => t.asin === asin && t.keyword === kw && t.siteCode === siteVal[0])) {
            trackerData.rankTasks.push({ asin: asin, keyword: kw, siteCode: siteVal[0], domain: siteVal[1], r1:'', r2:'', r3:'', history: {} });
        }
    });
    document.getElementById('rankAsin').value = ''; document.getElementById('rankKws').value = '';
    await saveTrackerData(); renderRankTable();
});

document.getElementById('rankSearchInput').addEventListener('input', (e) => { rankSearchText = e.target.value.trim().toLowerCase(); renderRankTable(); });
document.getElementById('delRankBtn').addEventListener('click', async () => {
    let checkboxes = document.querySelectorAll('.rank-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ 请先勾选左侧需要删除的任务！");
    if(confirm(`确定要删除选中的 ${checkboxes.length} 个排名任务吗？`)) {
        checkboxes.forEach(cb => { trackerData.rankTasks = trackerData.rankTasks.filter(t => !(t.asin === cb.dataset.asin && t.keyword === cb.dataset.kw)); });
        await saveTrackerData(); renderRankTable();
    }
});
window.handleRankSort = function(field) {
    if(rankSort.field === field) rankSort.asc = !rankSort.asc;
    else { rankSort.field = field; rankSort.asc = true; }
    renderRankTable();
};

function renderRankTable() {
    let thead = document.getElementById('rankTableHead');
    let tbody = document.getElementById('rankTableBody');
    let last5Days = getLast5Days();
    let getSortIcon = (f) => rankSort.field === f ? (rankSort.asc ? '▲' : '▼') : '↕';

    thead.innerHTML = `
        <th class="fix-col fix-1-1"><input type="checkbox" id="selectAllRankCb"></th>
        <th class="fix-col fix-1-2">站点</th>
        <th class="fix-col fix-1-3" style="cursor:pointer;" data-sort="asin">父ASIN <span class="sort-icon">${getSortIcon('asin')}</span></th>
        <th class="fix-col fix-1-4 shadow-right" style="cursor:pointer;" data-sort="keyword">追踪关键词 <span class="sort-icon">${getSortIcon('keyword')}</span></th>
        <th style="cursor:pointer;" data-sort="r1">备注1 <span class="sort-icon">${getSortIcon('r1')}</span></th>
        <th style="cursor:pointer;" data-sort="r2">备注2 <span class="sort-icon">${getSortIcon('r2')}</span></th>
        <th style="cursor:pointer;" data-sort="r3">备注3 <span class="sort-icon">${getSortIcon('r3')}</span></th>
        ${last5Days.map(d => `<th style="cursor:pointer;" data-sort="${d}">${d} <span class="sort-icon">${getSortIcon(d)}</span></th>`).join('')}
    `;

    let sortableTasks = trackerData.rankTasks.map(t => { let flat = { ...t }; last5Days.forEach(d => flat[d] = t.history[d] || '-'); return flat; });
    let filteredTasks = sortableTasks.filter(t => {
        let textMatch = t.asin.toLowerCase().includes(rankSearchText) || t.keyword.toLowerCase().includes(rankSearchText);
        let siteMatch = rankFilterSite === "" || (t.siteCode || 'US') === rankFilterSite;
        let asinMatch = rankFilterAsin === "" || t.asin === rankFilterAsin;
        return textMatch && siteMatch && asinMatch;
    });

    filteredTasks.sort((a, b) => smartSort(a, b, rankSort.field, rankSort.asc));
    let bodyHtml = '';
    filteredTasks.forEach(task => {
        bodyHtml += `<tr>
            <td class="fix-col fix-1-1"><input type="checkbox" class="rank-cb" data-asin="${task.asin}" data-kw="${task.keyword}"></td>
            <td class="fix-col fix-1-2">${task.siteCode || 'US'}</td>
            <td class="fix-col fix-1-3"><a href="https://www.${task.domain || 'amazon.com'}/dp/${task.asin}" target="_blank">${task.asin}</a></td>
            <td class="fix-col fix-1-4 shadow-right">${task.keyword}</td>
            <td><input type="text" class="remark-input" data-type="rank" data-asin="${task.asin}" data-kw="${task.keyword}" data-field="r1" value="${task.r1||''}"></td>
            <td><input type="text" class="remark-input" data-type="rank" data-asin="${task.asin}" data-kw="${task.keyword}" data-field="r2" value="${task.r2||''}"></td>
            <td><input type="text" class="remark-input" data-type="rank" data-asin="${task.asin}" data-kw="${task.keyword}" data-field="r3" value="${task.r3||''}"></td>
        `;
        let prevRank = null; 
        last5Days.forEach(date => {
            let currentRank = task[date];
            let displayHtml = currentRank;
            if(currentRank !== '-' && prevRank !== null && prevRank !== '-' && !isNaN(currentRank) && !isNaN(prevRank)) {
                if(parseInt(currentRank) < parseInt(prevRank)) displayHtml = `<span class="rank-up">${currentRank} ⬆</span>`;
                else if(parseInt(currentRank) > parseInt(prevRank)) displayHtml = `<span class="rank-down">${currentRank} ⬇</span>`;
            }
            if(String(currentRank).includes('验证码') || String(currentRank).includes('拦截') || String(currentRank) === '前三页无排名') {
                displayHtml = `<span style="color:#ef4444; font-weight:bold;">${currentRank}</span>`;
            }
            bodyHtml += `<td style="mso-number-format:'\\@';">${displayHtml}</td>`;
            if(currentRank !== '-' && !isNaN(currentRank)) prevRank = currentRank;
        });
        bodyHtml += `</tr>`;
    });
    tbody.innerHTML = bodyHtml;

    let tagsContainer = document.getElementById('rankAsinTags');
    if(tagsContainer) {
        let uniqueSites = [...new Set(trackerData.rankTasks.map(t => t.siteCode || 'US'))];
        let uniqueAsins = [...new Set(trackerData.rankTasks.map(t => t.asin))];
        if(uniqueSites.length === 0 && uniqueAsins.length === 0) tagsContainer.style.display = 'none';
        else {
            tagsContainer.style.display = 'flex'; tagsContainer.style.flexDirection = 'column'; tagsContainer.style.alignItems = 'flex-start'; tagsContainer.style.gap = '10px';
            let html = '';
            if(uniqueSites.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;"><span class="asin-tags-label">🌍 站点过滤:</span><span class="asin-tag site-tag ${rankFilterSite === '' ? 'active' : ''}" data-site="">全部站点</span>`;
                uniqueSites.forEach(site => { html += `<span class="asin-tag site-tag ${rankFilterSite === site ? 'active' : ''}" data-site="${site}">${site}</span>`; });
                html += `</div>`;
            }
            if(uniqueAsins.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;"><span class="asin-tags-label">🎯 ASIN过滤:</span><span class="asin-tag asin-tag-btn ${rankFilterAsin === '' ? 'active' : ''}" data-asin="">全部 ASIN</span>`;
                uniqueAsins.forEach(asin => { html += `<span class="asin-tag asin-tag-btn ${rankFilterAsin === asin ? 'active' : ''}" data-asin="${asin}">${asin}</span>`; });
                html += `</div>`;
            }
            tagsContainer.innerHTML = html;
            tagsContainer.querySelectorAll('.site-tag').forEach(tag => { tag.addEventListener('click', (e) => { rankFilterSite = e.target.getAttribute('data-site'); renderRankTable(); }); });
            tagsContainer.querySelectorAll('.asin-tag-btn').forEach(tag => { tag.addEventListener('click', (e) => { rankFilterAsin = e.target.getAttribute('data-asin'); renderRankTable(); }); });
        }
    }
}

// ================= 功能2：详情渲染 =================
document.getElementById('addDetailTaskBtn').addEventListener('click', async () => {
    let asins = tsvToArray(document.getElementById('detailAsins').value.toUpperCase());
    let siteVal = document.getElementById('detailSiteSelect').value.split('|');
    if(asins.length === 0) return alert("⚠️ 请先在输入框内填写需要监控的 ASIN！"); 
    asins.forEach(asin => { 
        let taskKey = `${asin}_${siteVal[0]}`;
        if(!trackerData.detailTasks[taskKey]) trackerData.detailTasks[taskKey] = { asin: asin, siteCode: siteVal[0], domain: siteVal[1], history: {} }; 
    });
    document.getElementById('detailAsins').value = '';
    await saveTrackerData(); renderDetailTable();
});

document.getElementById('detailSearchInput').addEventListener('input', (e) => { detailSearchText = e.target.value.trim().toLowerCase(); renderDetailTable(); });
document.getElementById('delDetailBtn').addEventListener('click', async () => {
    let checkboxes = document.querySelectorAll('.detail-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ 请先勾选左侧需要删除的监控！");
    if(confirm(`确定要删除选中的 ${checkboxes.length} 个监控任务吗？`)) {
        checkboxes.forEach(cb => { delete trackerData.detailTasks[cb.dataset.taskkey]; });
        await saveTrackerData(); renderDetailTable();
    }
});
window.handleDetailSort = function(field) {
    if(detailSort.field === field) detailSort.asc = !detailSort.asc;
    else { detailSort.field = field; detailSort.asc = true; }
    renderDetailTable();
};

function renderDetailTable() {
    let thead = document.getElementById('detailTableHead');
    let tbody = document.getElementById('detailTableBody');
    let getSortIcon = (f) => detailSort.field === f ? (detailSort.asc ? '▲' : '▼') : '↕';

    thead.innerHTML = `
        <th class="fix-col fix-2-1"><input type="checkbox" id="selectAllDetailCb"></th>
        <th class="fix-col fix-2-2">站点</th>
        <th class="fix-col fix-2-3">图片</th>
        <th class="fix-col fix-2-4" style="cursor:pointer;" data-sort="asin">监控 ASIN <span class="sort-icon">${getSortIcon('asin')}</span></th>
        <th class="fix-col fix-2-5 shadow-right" style="cursor:pointer;" data-sort="date">快照时间 <span class="sort-icon">${getSortIcon('date')}</span></th>
        <th style="cursor:pointer;" data-sort="r1">备注1 <span class="sort-icon">${getSortIcon('r1')}</span></th>
        <th style="cursor:pointer;" data-sort="r2">备注2 <span class="sort-icon">${getSortIcon('r2')}</span></th>
        <th style="cursor:pointer;" data-sort="r3">备注3 <span class="sort-icon">${getSortIcon('r3')}</span></th>
        <th style="cursor:pointer;" data-sort="originalPrice">原价 <span class="sort-icon">${getSortIcon('originalPrice')}</span></th>
        <th style="cursor:pointer;" data-sort="isDealStatus">是否Deal <span class="sort-icon">${getSortIcon('isDealStatus')}</span></th>
        <th style="cursor:pointer;" data-sort="dealDiscount">促销折扣 <span class="sort-icon">${getSortIcon('dealDiscount')}</span></th>
        <th style="cursor:pointer;" data-sort="coupon">Coupon折扣 <span class="sort-icon">${getSortIcon('coupon')}</span></th>
        <th style="cursor:pointer;" data-sort="fbaFee">运费 <span class="sort-icon">${getSortIcon('fbaFee')}</span></th>
        <th style="cursor:pointer;" data-sort="finalPrice">折后最终价 <span class="sort-icon">${getSortIcon('finalPrice')}</span></th>
        <th style="cursor:pointer;" data-sort="brand">品牌 <span class="sort-icon">${getSortIcon('brand')}</span></th>
        <th style="cursor:pointer;" data-sort="buybox">Buybox卖家 <span class="sort-icon">${getSortIcon('buybox')}</span></th>
        <th style="cursor:pointer;" data-sort="highReturn">高退货 <span class="sort-icon">${getSortIcon('highReturn')}</span></th>
        <th style="cursor:pointer;" data-sort="salesTag">销量标签 <span class="sort-icon">${getSortIcon('salesTag')}</span></th>
        <th style="cursor:pointer;" data-sort="isChanged">是否变化 <span class="sort-icon">${getSortIcon('isChanged')}</span></th>
        <th style="cursor:pointer;" data-sort="changesText">变化内容 <span class="sort-icon">${getSortIcon('changesText')}</span></th>
        <th style="cursor:pointer;" data-sort="cat1">大类目 <span class="sort-icon">${getSortIcon('cat1')}</span></th>
        <th style="cursor:pointer;" data-sort="cat1_rank">大类排名 <span class="sort-icon">${getSortIcon('cat1_rank')}</span></th>
        <th style="cursor:pointer;" data-sort="cat2">小类目 <span class="sort-icon">${getSortIcon('cat2')}</span></th>
        <th style="cursor:pointer;" data-sort="cat2_rank">小类排名 <span class="sort-icon">${getSortIcon('cat2_rank')}</span></th>
        <th style="cursor:pointer;" data-sort="status">抓取状态 <span class="sort-icon">${getSortIcon('status')}</span></th>
    `;

    let flatDataArray = [];
    Object.keys(trackerData.detailTasks).forEach(taskKey => {
        let task = trackerData.detailTasks[taskKey];
        let actualAsin = task.asin;
        let dates = Object.keys(task.history).sort((a, b) => new Date(a) - new Date(b));
        
        if (dates.length === 0) {
            flatDataArray.push({ 
                taskKey: taskKey, asin: actualAsin, date: '待运行', task: task, prv: {}, 
                r1: task.r1 || '', r2: task.r2 || '', r3: task.r3 || '',
                isDealStatus: '-', dealDiscount: '-', coupon: '-', fbaFee: '-', originalPrice: '-', finalPrice: '-',
                brand: '-', buybox: '-', highReturn: '-', salesTag: '-', cat1: '-', cat1_rank: '-', cat2: '-', cat2_rank: '-',
                isChanged: '-', changesText: '-', status: '尚未抓取，请点击运行'
            });
        } else {
            dates.forEach((date, index) => {
                let cur = task.history[date];
                let prv = index > 0 ? task.history[dates[index-1]] : {}; 
                let isDealStatus = cur.isDealStatus || (cur.isDeal && cur.isDeal !== '无' ? '是' : '无');
                let dealDiscount = cur.dealDiscount || (cur.isDeal && cur.isDeal !== 'Deal' && cur.isDeal !== '无' ? cur.isDeal : '无');

                let isChanged = false, changesText = [];
                ['originalPrice', 'isDealStatus', 'dealDiscount', 'coupon', 'fbaFee', 'buybox', 'highReturn', 'salesTag', 'cat1_rank', 'cat2_rank', 'finalPrice'].forEach(key => {
                    let vCur = key === 'isDealStatus' ? isDealStatus : (key === 'dealDiscount' ? dealDiscount : cur[key]);
                    let vPrv = prv[key]; 
                    if(vCur && vPrv && vCur !== '-' && vPrv !== '-' && vCur !== vPrv) {
                        isChanged = true; changesText.push(`${key}: ${vPrv}→${vCur}`);
                    }
                });

                flatDataArray.push({ 
                    ...cur, taskKey: taskKey, asin: actualAsin, date, task, prv, 
                    r1: cur.r1 || task.r1 || '', r2: cur.r2 || task.r2 || '', r3: cur.r3 || task.r3 || '',
                    isDealStatus, dealDiscount, isChanged: isChanged ? 'Y' : 'N', changesText: changesText.join(' | ') || '-'
                });
            });
        }
    });

    let filtered = flatDataArray.filter(item => {
        let s = detailSearchText;
        let textMatch = item.asin.toLowerCase().includes(s) || (item.brand || '').toLowerCase().includes(s) || (item.buybox || '').toLowerCase().includes(s);
        let siteMatch = detailFilterSite === "" || (item.task.siteCode || 'US') === detailFilterSite;
        let asinMatch = detailFilterAsin === "" || item.asin === detailFilterAsin;
        return textMatch && siteMatch && asinMatch;
    });

    filtered.sort((a, b) => {
        let res = smartSort(a, b, detailSort.field, detailSort.asc);
        if (res === 0 && detailSort.field === 'asin') return a.date > b.date ? -1 : 1;
        return res;
    });

    let bodyHtml = '';
    filtered.forEach(item => {
        let { asin, date, prv } = item;
        let getCellClass = (key) => (item[key] && prv[key] && item[key] !== prv[key]) ? 'changed-cell' : '';

        bodyHtml += `<tr>
            <td class="fix-col fix-2-1"><input type="checkbox" class="detail-cb" data-taskkey="${item.taskKey}"></td>
            <td class="fix-col fix-2-2">${item.task.siteCode || 'US'}</td>
            <td class="fix-col fix-2-3"><img src="${item.img || 'https://via.placeholder.com/30'}" height="30" style="object-fit:contain;"></td>
            <td class="fix-col fix-2-4"><a href="https://www.${item.task.domain || 'amazon.com'}/dp/${item.asin}" target="_blank">${item.asin}</a></td>
            <td class="fix-col fix-2-5 shadow-right" style="font-weight:bold; color:#0f766e; mso-number-format:'\\@';">${date}</td>
            <td><input type="text" class="remark-input" data-type="detail" data-asin="${asin}" data-date="${date}" data-field="r1" value="${item.r1}"></td>
            <td><input type="text" class="remark-input" data-type="detail" data-asin="${asin}" data-date="${date}" data-field="r2" value="${item.r2}"></td>
            <td><input type="text" class="remark-input" data-type="detail" data-asin="${asin}" data-date="${date}" data-field="r3" value="${item.r3}"></td>
            <td class="${getCellClass('originalPrice')}">${item.originalPrice || '-'}</td>
            <td class="${getCellClass('isDealStatus')}">${item.isDealStatus}</td>
            <td class="${getCellClass('dealDiscount')}">${item.dealDiscount}</td>
            <td class="${getCellClass('coupon')}">${item.coupon || '无'}</td>
            <td class="${getCellClass('fbaFee')}">${item.fbaFee || '-'}</td>
            <td class="${getCellClass('finalPrice')}" style="font-weight:bold; color:#b12704; font-size:14px;">${item.finalPrice || '-'}</td>
            <td>${item.brand || '-'}</td>
            <td class="${getCellClass('buybox')}">${item.buybox || '-'}</td>
            <td style="color:${item.highReturn === '是' ? 'red' : 'inherit'}">${item.highReturn || '-'}</td>
            <td class="${getCellClass('salesTag')}">${item.salesTag || '-'}</td>
            <td style="color:${item.isChanged === 'Y' ? 'red' : (item.isChanged==='-'?'inherit':'green')}; font-weight:bold;">${item.isChanged}</td>
            <td style="font-size:10px; max-width:150px; overflow:hidden; text-overflow:ellipsis;" title="${item.changesText}">${item.changesText}</td>
            <td>${item.cat1 || '-'}</td>
            <td class="${getCellClass('cat1_rank')}">${item.cat1_rank || '-'}</td>
            <td>${item.cat2 || '-'}</td>
            <td class="${getCellClass('cat2_rank')}">${item.cat2_rank || '-'}</td>
            <td style="font-size:10px; color:${item.status === '成功' ? '#999' : 'red'};">${item.status || '未抓取'}</td>
        </tr>`;
    });
    tbody.innerHTML = bodyHtml;

    let tagsContainer = document.getElementById('detailAsinTags');
    if(tagsContainer) {
        let uniqueSites = [...new Set(Object.values(trackerData.detailTasks).map(t => t.siteCode || 'US'))];
        let uniqueAsins = [...new Set(Object.values(trackerData.detailTasks).map(t => t.asin))];
        if(uniqueSites.length === 0 && uniqueAsins.length === 0) tagsContainer.style.display = 'none';
        else {
            tagsContainer.style.display = 'flex'; tagsContainer.style.flexDirection = 'column'; tagsContainer.style.alignItems = 'flex-start'; tagsContainer.style.gap = '10px';
            let html = '';
            if(uniqueSites.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;"><span class="asin-tags-label">🌍 站点过滤:</span><span class="asin-tag site-tag ${detailFilterSite === '' ? 'active' : ''}" data-site="">全部站点</span>`;
                uniqueSites.forEach(site => { html += `<span class="asin-tag site-tag ${detailFilterSite === site ? 'active' : ''}" data-site="${site}">${site}</span>`; });
                html += `</div>`;
            }
            if(uniqueAsins.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;"><span class="asin-tags-label">🎯 ASIN过滤:</span><span class="asin-tag asin-tag-btn ${detailFilterAsin === '' ? 'active' : ''}" data-asin="">全部 ASIN</span>`;
                uniqueAsins.forEach(asin => { html += `<span class="asin-tag asin-tag-btn ${detailFilterAsin === asin ? 'active' : ''}" data-asin="${asin}">${asin}</span>`; });
                html += `</div>`;
            }
            tagsContainer.innerHTML = html;
            tagsContainer.querySelectorAll('.site-tag').forEach(tag => { tag.addEventListener('click', (e) => { detailFilterSite = e.target.getAttribute('data-site'); renderDetailTable(); }); });
            tagsContainer.querySelectorAll('.asin-tag-btn').forEach(tag => { tag.addEventListener('click', (e) => { detailFilterAsin = e.target.getAttribute('data-asin'); renderDetailTable(); }); });
        }
    }
}

// ================= 核心并发爬虫引擎 =================
const fetchOptions = {
    headers: { 
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': navigator.userAgent 
    },
    credentials: 'include' 
};
let globalEmergencyStop = false;

async function runRankEngine(btnEl) {
    if(trackerData.rankTasks.length === 0) return alert("⚠️ 当前没有排名监控任务，请先在上方输入框添加任务！");
    let originalText = btnEl.innerText; btnEl.disabled = true; btnEl.innerText = "🔄 引擎初始化中..."; await sleep(50); 
    let today = getTodayStr(); globalEmergencyStop = false;
    let taskQueue = [...trackerData.rankTasks]; let totalTasks = taskQueue.length; let completedTasks = 0;

    async function rankWorker() {
        while (taskQueue.length > 0 && !globalEmergencyStop) {
            let task = taskQueue.shift(); let foundRank = -1; let totalOrganicScanned = 0; let errorMsg = null;
            let currentDomain = task.domain || 'amazon.com';
            let currentUrl = `https://www.${currentDomain}/s?k=${encodeURIComponent(task.keyword)}`;

            for (let page = 1; page <= 3; page++) {
                if (globalEmergencyStop || !currentUrl) break; 
                try {
                    let response = await fetch(currentUrl, fetchOptions);
                    if(response.status === 503) throw new Error("被风控拦截(503)");
                    let htmlText = await response.text();
                    if(htmlText.includes('puis-captcha-card') || htmlText.includes('Type the characters you see')) throw new Error("触发验证码");
                    
                    const doc = new DOMParser().parseFromString(htmlText, "text/html");
                    let allItems = Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"]'));
                    if(allItems.length === 0) allItems = Array.from(doc.querySelectorAll('div[data-asin]')).filter(el => el.getAttribute('data-asin') && el.getAttribute('data-asin').length === 10);

                    allItems.forEach(item => {
                        let isSponsored = item.querySelector('.puis-sponsored-label-text') || item.classList.contains('AdHolder') || item.innerHTML.includes('puis-sponsored-label');
                        if (!isSponsored) {
                            totalOrganicScanned++;
                            let displayedAsin = item.getAttribute('data-asin').toUpperCase();
                            if ((displayedAsin === task.asin || item.innerHTML.includes(task.asin)) && foundRank === -1) foundRank = totalOrganicScanned;
                        }
                    });
                    if (foundRank !== -1) break; 
                    
                    if (page < 3) {
                        let nextUrl = null;
                        let nextBtn = doc.querySelector('.s-pagination-next');
                        if (nextBtn && nextBtn.hasAttribute('href')) nextUrl = nextBtn.getAttribute('href');
                        if (!nextUrl) {
                            let match = htmlText.match(/href="([^"]+)"[^>]*class="[^"]*s-pagination-next/i) || htmlText.match(/class="[^"]*s-pagination-next[^"]*"[^>]*href="([^"]+)"/i);
                            if (match && match[1]) nextUrl = match[1];
                        }
                        if (!nextUrl) {
                            let pageReg = new RegExp(`href="(\\/s\\?[^"]*page=${page + 1}[^"]*)"`, 'i');
                            let match = htmlText.match(pageReg);
                            if (match && match[1]) nextUrl = match[1];
                        }
                        if (nextUrl) {
                            nextUrl = nextUrl.replace(/&amp;/g, '&'); currentUrl = 'https://www.' + currentDomain + nextUrl;
                            await sleep(randomDelay(1200, 2000));
                        } else break;
                    }
                } catch(e) { errorMsg = e.message; globalEmergencyStop = true; break; }
            }
            task.history[today] = errorMsg ? errorMsg : (foundRank !== -1 ? foundRank : '前三页无排名');
            completedTasks++; btnEl.innerText = `🔄 双线程抓取中 (${completedTasks}/${totalTasks})...`; renderRankTable();
            await sleep(randomDelay(1500, 2500));
        }
    }

    let threadCount = parseInt(document.getElementById('trackerThreadInput').value) || 2;
    if(threadCount > 10) threadCount = 10;
    let workers = []; for(let i=0; i<threadCount; i++) workers.push(rankWorker());
    await Promise.all(workers);
    btnEl.disabled = false; btnEl.innerText = originalText;
    if(globalEmergencyStop) alert("⚠️ 警告：检测到风控拦截或验证码！引擎已触发熔断急停，请稍后再试。");
}

async function runDetailEngine(btnEl) {
    let asinsToTrack = Object.keys(trackerData.detailTasks);
    if(asinsToTrack.length === 0) return alert("⚠️ 当前没有详情监控任务！");

    let originalText = btnEl.innerText; btnEl.disabled = true; btnEl.innerText = "🔄 引擎初始化中..."; await sleep(50);
    let today = getTodayStr(); globalEmergencyStop = false;
    let taskQueue = [...asinsToTrack]; let totalTasks = taskQueue.length; let completedTasks = 0;

    async function detailWorker() {
        while (taskQueue.length > 0 && !globalEmergencyStop) {
            let taskKey = taskQueue.shift(); let taskInfo = trackerData.detailTasks[taskKey];
            let asin = taskInfo.asin; let domain = taskInfo.domain || 'amazon.com';
            try {
                let response = await fetch(`https://www.${domain}/dp/${asin}?th=1&psc=1`, fetchOptions);
                if(response.status === 503) throw new Error("被风控拦截(503)");
                if(response.status === 404) throw new Error("页面不存在(404)");
                
                let htmlText = await response.text();
                
                // 🚨 修复1：全站点通用的验证码拦截 (兼容 CA 站可能的双语或不同风控页面)
                if(htmlText.includes('puis-captcha-card') || htmlText.includes('Type the characters you see') || htmlText.includes('Enter the characters you see')) {
                    throw new Error("触发验证码");
                }
                // 拦截亚马逊狗页面 (404)
                if(htmlText.includes('Sorry! We couldn\'t find that page') || htmlText.includes('Sorry! We couldn&#')) {
                    throw new Error("页面不存在(404)");
                }

                const doc = new DOMParser().parseFromString(htmlText, "text/html");
                let extractText = (selector) => { let el = doc.querySelector(selector); return el ? el.innerText.trim() : '无'; };
                let centerCol = doc.querySelector('#centerCol') || doc.body; let rightCol = doc.querySelector('#rightCol') || doc.querySelector('#buybox') || doc.body;
                let centerText = centerCol.innerText; let rightText = rightCol.innerText;

                let mainPrice = extractText('.a-price .a-offscreen');
                if (mainPrice === '无') { let pEl = doc.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen'); if(pEl) mainPrice = pEl.innerText.trim(); }
                if (mainPrice === '无') { let w = extractText('.a-price-whole'), f = extractText('.a-price-fraction'); if (w !== '无') mainPrice = '$' + w.replace('.', '') + (f !== '无' ? f : '00'); }

                let basisPrice = extractText('.a-text-price .a-offscreen'); if(basisPrice === '无') basisPrice = extractText('.a-text-strike');
                let isDealBadge = doc.querySelector('.dealBadgeSupported') || centerText.includes('Limited time deal') || centerText.includes('Deal of the Day') || centerText.includes('Prime exclusive discount') || centerText.includes('Prime savings');
                let savingsPct = extractText('.savingsPercentage'); let dealDiscount = savingsPct !== '无' ? savingsPct.replace('-', '').trim() : '无';
                let originalPrice = basisPrice !== '无' ? basisPrice : (mainPrice !== '无' ? mainPrice : '-'); let isDealStatus = isDealBadge ? '是' : '无';

                let coupon = '无'; let couponSelectors = ['.promoPriceBadgeLabel', '.couponBadgeLine', 'label[id^="couponText"]', 'span.a-color-success.a-text-bold'];
                for(let sel of couponSelectors) { let els = doc.querySelectorAll(sel); for(let el of els) { let text = el.innerText.trim(); let m = text.match(/(\$[\d\.]+|\d+%)/); if(m) { coupon = m[1]; break; } } if(coupon !== '无') break; }
                if(coupon === '无') { let combinedText = (centerText + " " + rightText).replace(/\s+/g, ' '); let m = combinedText.match(/(?:Apply|Save)\s*(?:an extra\s*)?(\$[\d\.]+|\d+%)\s*(?:coupon|at checkout|with coupon)/i); if (m) coupon = m[1]; }

                let finalPrice = mainPrice !== '无' ? mainPrice : '-';
                if (coupon !== '无' && mainPrice !== '无') {
                    let pNum = parseFloat(mainPrice.replace(/[^0-9.]/g, ''));
                    if (!isNaN(pNum)) {
                        let pctMatch = coupon.match(/(\d+)%/); let amtMatch = coupon.match(/\$(\d+(\.\d+)?)/); 
                        if (pctMatch) finalPrice = '$' + (pNum * (1 - parseFloat(pctMatch[1])/100)).toFixed(2);
                        else if (amtMatch) finalPrice = '$' + Math.max(0, pNum - parseFloat(amtMatch[1])).toFixed(2);
                    }
                }

                let shippingFee = '无'; let deliveryBlock = doc.querySelector('#mir-layout-DELIVERY_BLOCK-legacy-id') || doc.querySelector('#deliveryBlockMessage') || rightCol;
                let deliveryText = deliveryBlock.innerText.replace(/\s+/g, ' ');
                if (deliveryText.match(/FREE\s+(?:delivery|shipping|returns)/i)) shippingFee = '0.00';
                else { let shipMatch = deliveryText.match(/\$(\d+\.\d+)\s+(?:delivery|shipping)/i); if (shipMatch) shippingFee = shipMatch[1]; }

                let brand = '无'; let brandRow = doc.querySelector('.po-brand .a-span9 span');
                if (brandRow) brand = brandRow.innerText.trim();
                if (brand === '无') { let byline = extractText('#bylineInfo'); if (byline !== '无') { let m = byline.match(/(?:Visit the|Brand:)\s*(.+)(?:\s*Store)?/i); brand = m ? m[1].replace(/Store/i, '').trim() : byline; } }

                let cat1 = '-', cat1_rank = '-', cat2 = '-', cat2_rank = '-';
                let rankMatchText = (doc.querySelector('#SalesRank') || {}).innerText || '';
                if (!rankMatchText) { let ths = doc.querySelectorAll('th, span'); for(let el of ths) { if(el.innerText.trim() === 'Best Sellers Rank') { let parent = el.closest('tr') || el.closest('li') || el.parentElement; if(parent) { rankMatchText = parent.innerText; break; } } } }
                if (rankMatchText) { let matches = [...rankMatchText.replace(/,/g, '').matchAll(/#(\d+)\s+in\s+([^\(\n]+)/g)]; if(matches.length > 0) { cat1_rank = matches[0][1]; cat1 = matches[0][2].trim(); } if(matches.length > 1) { cat2_rank = matches[1][1]; cat2 = matches[1][2].trim(); } }

                let img = (doc.querySelector('#landingImage') || doc.querySelector('#imgBlkFront') || {}).src || '';
                let buybox = '无'; let sellerIdEl = doc.querySelector('#sellerProfileTriggerId');
                if (sellerIdEl) buybox = sellerIdEl.innerText.trim();
                else { let merchInfo = extractText('#merchant-info'); if (merchInfo !== '无' && merchInfo.includes('Sold by')) { let parts = merchInfo.split('Sold by'); if(parts.length > 1) buybox = parts[1].replace(/\n/g, '').trim(); } else if (rightText.includes('Amazon.com') || rightText.includes('Amazon US')) buybox = 'Amazon'; }
                
                let highReturn = (centerText.includes('Frequently returned') || centerText.includes('高退货')) ? '是' : '无';
                let salesTag = '无'; let socialProofEl = doc.querySelector('#social-proofing-faceout-title-tk_bought') || doc.querySelector('.social-proofing-faceout-title-text') || doc.querySelector('#social-proofing-faceout-title-tk_purchased');
                if (socialProofEl) salesTag = socialProofEl.innerText.trim(); else { let m = centerText.match(/(\d+[KkM]?\+?\s*(?:bought|purchased)[^\n]*?(?:past month|month|week))/i); if(m) salesTag = m[1].replace(/\n/g, '').trim(); }

                // 🚨 修复2：如果核心数据（图片、价格、品牌）全部获取失败，抛出异常，不再标记为“成功”
                if (!img && mainPrice === '无' && brand === '无') {
                    throw new Error("解析失败(请确认该站邮编已设/ASIN未下架)");
                }

                let oldR1 = '', oldR2 = '', oldR3 = '';
                if(trackerData.detailTasks[taskKey].history[today]) { oldR1 = trackerData.detailTasks[taskKey].history[today].r1 || ''; oldR2 = trackerData.detailTasks[taskKey].history[today].r2 || ''; oldR3 = trackerData.detailTasks[taskKey].history[today].r3 || ''; }

                trackerData.detailTasks[taskKey].history[today] = { originalPrice, isDealStatus, dealDiscount, coupon, fbaFee: shippingFee, finalPrice, brand, buybox, highReturn, salesTag, img, cat1, cat1_rank, cat2, cat2_rank, r1: oldR1, r2: oldR2, r3: oldR3, status: '成功' };
            } catch(e) { 
                trackerData.detailTasks[taskKey].history[today] = { status: e.message }; 
                if (e.message.includes('验证码') || e.message.includes('503')) globalEmergencyStop = true; 
            }
            completedTasks++; btnEl.innerText = `🔄 并发拆解中 (${completedTasks}/${totalTasks})...`; renderDetailTable();
            await sleep(randomDelay(2500, 4500)); 
        }
    }

    let threadCount = parseInt(document.getElementById('trackerThreadInput').value) || 3;
    if(threadCount > 10) threadCount = 10;
    let workers = []; for(let i=0; i<threadCount; i++) workers.push(detailWorker());
    await Promise.all(workers);
    btnEl.disabled = false; btnEl.innerText = originalText;
    if(globalEmergencyStop) alert("⚠️ 警告：检测到风控拦截或验证码！引擎已触发熔断急停，请稍后再试。");
}

// =========================================================================
// 🚀 核心功能 3：小时级分时监控系统 (支持时间沙盘 + 单点开关)
// =========================================================================

let hourlyCruiseTimer = null;
let isHourlyCruising = false;
let lastRunHourStr = ""; 

document.getElementById('addHourlyTaskBtn').addEventListener('click', async () => {
    let asin = document.getElementById('hourlyAsin').value.trim().toUpperCase();
    let kw = document.getElementById('hourlyKw').value.trim();
    let siteVal = document.getElementById('hourlySiteSelect').value.split('|');
    if(!asin || !kw) return alert("⚠️ 请填写完整的 ASIN 和 搜索词！"); 
    if(trackerData.hourlyTasks.length >= 5) return alert("⚠️ 小时级监控严格限制最多 5 个任务！");

    let exists = trackerData.hourlyTasks.find(t => t.asin === asin && t.keyword === kw && t.siteCode === siteVal[0]);
    if(!exists) {
        trackerData.hourlyTasks.push({ asin: asin, keyword: kw, siteCode: siteVal[0], domain: siteVal[1], isActive: true, history: {} });
        await saveTrackerData(); renderHourPicker(); renderHourlyCards();
        document.getElementById('hourlyAsin').value = ''; document.getElementById('hourlyKw').value = '';
    } else alert("⚠️ 该竞品关键词组合已在监控列表中！");
});

function renderHourPicker() {
    let container = document.getElementById('hourPickerContainer');
    if(!container) return;
    let html = `<div style="width: 100%; font-size: 13px; font-weight: bold; color: #475569; margin-bottom: 8px;">⏰ 请选择允许自动巡航的时间点 (蓝色为开启)：</div>`;
    for(let i=0; i<24; i++) {
        let isActive = trackerData.hourlySettings.runHours.includes(i) ? 'active' : '';
        let displayHour = i.toString().padStart(2, '0');
        html += `<div class="hour-btn ${isActive}" data-hour="${i}">${displayHour}</div>`;
    }
    html += `<div style="width: 100%; margin-top: 15px; display: flex; gap: 10px;">
                <button id="selectAllHoursBtn" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;">全选时间</button> 
                <button id="clearAllHoursBtn" style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;">清空时间</button>
             </div>`;
    container.innerHTML = html;

    container.querySelectorAll('.hour-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            let h = parseInt(e.target.getAttribute('data-hour'));
            let idx = trackerData.hourlySettings.runHours.indexOf(h);
            if(idx > -1) trackerData.hourlySettings.runHours.splice(idx, 1); else trackerData.hourlySettings.runHours.push(h);
            await saveTrackerData(); renderHourPicker();
        });
    });
    document.getElementById('selectAllHoursBtn').addEventListener('click', async () => { trackerData.hourlySettings.runHours = Array.from({length:24}, (_,i)=>i); await saveTrackerData(); renderHourPicker(); });
    document.getElementById('clearAllHoursBtn').addEventListener('click', async () => { trackerData.hourlySettings.runHours = []; await saveTrackerData(); renderHourPicker(); });
}

document.getElementById('openCruiseSettingBtn').addEventListener('click', () => { document.getElementById('cruiseSettingModal').style.display = 'flex'; renderHourPicker(); });
document.getElementById('closeCruiseSettingBtn').addEventListener('click', () => { document.getElementById('cruiseSettingModal').style.display = 'none'; });

function renderHourlyCards() {
    let container = document.getElementById('hourlyCardsContainer');
    let html = '';
    if(trackerData.hourlyTasks.length === 0) { container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 40px;">暂无监控任务，请在上方添加您的核心追踪目标。</div>`; return; }

    trackerData.hourlyTasks.forEach((task, index) => {
        let dates = Object.keys(task.history).sort(); let latestData = dates.length > 0 ? task.history[dates[dates.length-1]] : null; let latestTime = dates.length > 0 ? dates[dates.length-1] : '尚未抓取';
        let orgRank = latestData ? (latestData.organic !== -1 ? `#${latestData.organic}` : '未找到') : '-'; let adRank = latestData ? (latestData.ad !== -1 ? `SP #${latestData.ad}` : '未打广告') : '-';
        let disabledClass = task.isActive ? '' : 'card-disabled'; let checkedHtml = task.isActive ? 'checked' : '';

        html += `
            <div class="hourly-card ${disabledClass}" style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); position: relative; transition: all 0.3s;">
                <input type="checkbox" class="task-toggle-cb" data-idx="${index}" ${checkedHtml} title="勾选参与巡航并加入趋势图">
                <button class="del-hourly-btn" data-idx="${index}" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #ef4444; font-size: 16px; cursor: pointer; z-index: 10;">✖</button>
                <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-left: 24px;">${task.siteCode} | ${task.asin}</div>
                <div style="font-size: 16px; color: #1e293b; font-weight: bold; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed #cbd5e1; margin-top: 2px;">${task.keyword}</div>
                <div style="display: flex; justify-content: space-between; align-items: flex-end;">
                    <div>
                        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 4px;">最新时间: ${latestTime}</div>
                        <div style="display: flex; gap: 15px;">
                            <div style="background: #eff6ff; color: #2563eb; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">自然位: ${orgRank}</div>
                            <div style="background: #fef2f2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">广告位: ${adRank}</div>
                        </div>
                    </div>
                </div>
            </div>`;
    });
    container.innerHTML = html;

    document.querySelectorAll('.task-toggle-cb').forEach(cb => { cb.addEventListener('change', async (e) => { let idx = e.target.dataset.idx; trackerData.hourlyTasks[idx].isActive = e.target.checked; await saveTrackerData(); renderHourlyCards(); }); });
    document.querySelectorAll('.del-hourly-btn').forEach(btn => { btn.addEventListener('click', async (e) => { if(confirm('确定删除该监控任务吗？历史数据将丢失。')) { trackerData.hourlyTasks.splice(e.target.dataset.idx, 1); await saveTrackerData(); renderHourlyCards(); } }); });
}

async function executeHourlyFetch() {
    let activeTasks = trackerData.hourlyTasks.filter(t => t.isActive);
    if(activeTasks.length === 0) { document.getElementById('hourlyStatusText').innerText = "💤 所有任务已暂停，本次跳过抓取。"; return; }
    
    let statusEl = document.getElementById('hourlyStatusText'); let forceBtn = document.getElementById('forceRunHourlyBtn');
    statusEl.innerText = `🔄 正在静默抓取活跃任务... (进度: 0/${activeTasks.length})`; statusEl.style.color = '#f59e0b';
    if(forceBtn) forceBtn.disabled = true;

    let now = new Date();
    let currentHourKey = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:00`;

    for(let i=0; i<activeTasks.length; i++) {
        let task = activeTasks[i];
        statusEl.innerText = `🔄 正在抓取: ${task.keyword} (${i+1}/${activeTasks.length})`;

        try {
            let searchUrl = `https://www.${task.domain}/s?k=${encodeURIComponent(task.keyword)}`;
            let response = await fetch(searchUrl, fetchOptions); let htmlText = await response.text();
            
            if(htmlText.includes('puis-captcha-card') || htmlText.includes('Type the characters you see')) {
                statusEl.innerText = `🚨 遭遇验证码拦截！本小时任务提前终止。`; statusEl.style.color = '#ef4444';
                try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU...').play(); } catch(e){}
                break; 
            }

            const doc = new DOMParser().parseFromString(htmlText, "text/html");
            let items = Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"]'));
            if(items.length === 0) items = Array.from(doc.querySelectorAll('div[data-asin]')).filter(el => el.getAttribute('data-asin') && el.getAttribute('data-asin').length === 10);

            let organicRank = -1, sponsoredRank = -1; let organicScanned = 0, sponsoredScanned = 0;
            items.forEach(item => {
                let isSponsored = item.querySelector('.puis-sponsored-label-text') || item.classList.contains('AdHolder') || item.innerHTML.includes('puis-sponsored-label');
                let displayedAsin = item.getAttribute('data-asin').toUpperCase();
                if (isSponsored) { sponsoredScanned++; if ((displayedAsin === task.asin || item.innerHTML.includes(task.asin)) && sponsoredRank === -1) sponsoredRank = sponsoredScanned; } 
                else { organicScanned++; if ((displayedAsin === task.asin || item.innerHTML.includes(task.asin)) && organicRank === -1) organicRank = organicScanned; }
            });

            task.history[currentHourKey] = { organic: organicRank, ad: sponsoredRank };
            let keys = Object.keys(task.history).sort(); if(keys.length > 72) delete task.history[keys[0]]; 
        } catch(e) { console.error("抓取网络错误", e); }
        
        await saveTrackerData(); renderHourlyCards();
        if(i < activeTasks.length - 1) await sleep(randomDelay(15000, 30000));
    }

    if(forceBtn) forceBtn.disabled = false;
    if(isHourlyCruising) { statusEl.innerText = `✅ 抓取完毕！将在下一个允许的整点继续...`; statusEl.style.color = '#10b981'; } 
    else { statusEl.innerText = `💤 抓取完毕。系统已休眠`; statusEl.style.color = '#64748b'; }
}

// 🌟 ECharts 折线图渲染逻辑
let myChart = null;
document.getElementById('viewTrendChartBtn').addEventListener('click', () => {
    let activeTasks = trackerData.hourlyTasks.filter(t => t.isActive);
    if(activeTasks.length === 0) return alert("⚠️ 请至少勾选激活一个 ASIN 卡片来查看趋势！");
    
    document.getElementById('chartModal').style.display = 'flex';
    if (!myChart) myChart = echarts.init(document.getElementById('echartsContainer'));
    
    let allTimes = new Set();
    activeTasks.forEach(task => { Object.keys(task.history).forEach(time => allTimes.add(time)); });
    let timeAxis = Array.from(allTimes).sort();

    let seriesData = []; let legendData = [];

    activeTasks.forEach((task, idx) => {
        let organicData = []; let adData = [];
        timeAxis.forEach(time => {
            if(task.history[time]) {
                organicData.push(task.history[time].organic !== -1 ? task.history[time].organic : null);
                adData.push(task.history[time].ad !== -1 ? task.history[time].ad : null);
            } else { organicData.push(null); adData.push(null); }
        });

        let shortName = task.asin.slice(-4);
        let orgName = `${shortName} 自然位`; let adName = `${shortName} SP广告`;
        legendData.push(orgName, adName);

        seriesData.push({ name: orgName, type: 'line', smooth: true, connectNulls: true, symbolSize: 6, lineStyle: { width: 3 }, data: organicData });
        seriesData.push({ name: adName, type: 'line', smooth: true, connectNulls: true, symbolSize: 6, lineStyle: { width: 2, type: 'dashed' }, data: adData });
    });

    let option = {
        tooltip: { 
            trigger: 'axis',
            formatter: function(params) {
                let relVal = params[0].name + '<br/>';
                for (let i = 0, l = params.length; i < l; i++) {
                    let val = (params[i].value == null || params[i].value === -1) ? '未找到' : '#' + params[i].value;
                    relVal += params[i].marker + params[i].seriesName + ' : ' + val + '<br/>';
                }
                return relVal;
            }
        },
        legend: { data: legendData, top: 0 },
        grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: timeAxis },
        yAxis: { type: 'value', inverse: true, min: 1, minInterval: 1, axisLabel: { formatter: '#{value}' } }, 
        dataZoom: [
            { type: 'slider', show: true, xAxisIndex: [0], start: 0, end: 100, bottom: 10 },
            { type: 'inside', xAxisIndex: [0], start: 0, end: 100 }
        ],
        series: seriesData
    };
    myChart.setOption(option, true);
});

document.getElementById('closeChartModalBtn').addEventListener('click', () => { document.getElementById('chartModal').style.display = 'none'; });
window.addEventListener('resize', function() { if(myChart) myChart.resize(); });

document.getElementById('toggleHourlyEngineBtn').addEventListener('click', (e) => {
    isHourlyCruising = !isHourlyCruising;
    let btn = e.target; let statusEl = document.getElementById('hourlyStatusText');

    if(isHourlyCruising) {
        btn.innerText = "⏹ 停止自动巡航"; btn.style.background = "#ef4444";
        statusEl.innerText = "⏳ 巡航已开启。等待到达设定的时间点触发..."; statusEl.style.color = "#3b82f6";
        
        hourlyCruiseTimer = setInterval(() => {
            let now = new Date();
            let currentHourStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
            if (now.getMinutes() <= 3 && lastRunHourStr !== currentHourStr) {
                lastRunHourStr = currentHourStr; 
                if (trackerData.hourlySettings.runHours.includes(now.getHours())) executeHourlyFetch();
            }
        }, 60000);
    } else {
        btn.innerText = "▶ 启动整点自动巡航"; btn.style.background = "#10b981";
        statusEl.innerText = "💤 当前状态：系统已休眠"; statusEl.style.color = "#64748b";
        if(hourlyCruiseTimer) clearInterval(hourlyCruiseTimer);
    }
});

document.getElementById('forceRunHourlyBtn').addEventListener('click', executeHourlyFetch);

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { renderHourPicker(); renderHourlyCards(); }, 1000);
});