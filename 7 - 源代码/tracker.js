// ==========================================
// BLK 追踪系统核心逻辑 (V10.16 排名精准穿透版)
// ==========================================

// --- UI 与基础函数 ---
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
let trackerData = { rankTasks: [], detailTasks: {} };
let rankSearchText = "";
let detailSearchText = "";
let rankSort = { field: 'keyword', asc: true };
let detailSort = { field: 'asin', asc: true }; 
let currentImportMode = ''; 
// 新增：独立的站点和 ASIN 过滤状态
let rankFilterSite = "";
let rankFilterAsin = "";
let detailFilterSite = "";
let detailFilterAsin = "";

async function loadTrackerData() {
    let stored = await new Promise(resolve => chrome.storage.local.get(['blkTrackerData'], resolve));
    if(stored.blkTrackerData) {
        trackerData = stored.blkTrackerData;
        
        // 【热更新】兼容老数据，默认补充美国站参数
        trackerData.rankTasks.forEach(t => {
            if(!t.siteCode) { t.siteCode = 'US'; t.domain = 'amazon.com'; }
        });
        
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

    // 绑定按钮事件
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

    let htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>${clone.outerHTML}</body>
        </html>
    `;
    
    let uri = 'data:application/vnd.ms-excel;base64,';
    let base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));
    let link = document.createElement("a");
    link.href = uri + base64;
    link.download = `${filename}_${getTodayStr()}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
document.getElementById('exportRankExcelBtn').addEventListener('click', () => {
    if(trackerData.rankTasks.length === 0) return alert("⚠️ 当前没有排名数据可导出！");
    exportTableToExcel('rankTable', '自然排名追踪报表')
});
document.getElementById('exportDetailExcelBtn').addEventListener('click', () => {
    if(Object.keys(trackerData.detailTasks).length === 0) return alert("⚠️ 当前没有详情数据可导出！");
    exportTableToExcel('detailTable', '详情快照监控报表')
});

document.getElementById('exportJsonLnk').addEventListener('click', (e) => {
    e.preventDefault();
    let a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(trackerData, null, 2)], {type: "application/json"}));
    a.download = `BLK_底层数据库备份_${getTodayStr()}.json`;
    a.click();
});
document.getElementById('importJsonLnk').addEventListener('click', (e) => { e.preventDefault(); document.getElementById('importJsonInput').click(); });
document.getElementById('importJsonInput').addEventListener('change', (e) => {
    let file = e.target.files[0];
    if(!file) return;
    let reader = new FileReader();
    reader.onload = async (event) => {
        try {
            trackerData = JSON.parse(event.target.result);
            await saveTrackerData(); renderRankTable(); renderDetailTable();
            alert("✅ 底层数据库恢复成功！");
        } catch(err) { alert("JSON 文件格式错误！"); }
        e.target.value = ''; 
    };
    reader.readAsText(file);
});

document.getElementById('openRankImportModalBtn').addEventListener('click', () => {
    currentImportMode = 'rank';
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importPasteArea').value = '';
    document.getElementById('importHintText').innerHTML = '※ 系统会自动寻找【<strong>父ASIN</strong>】、【<strong>追踪关键词</strong>】以及【备注1/2/3】列进行精准匹配覆盖。';
});

document.getElementById('openImportModalBtn').addEventListener('click', () => {
    currentImportMode = 'detail';
    document.getElementById('importModal').style.display = 'flex';
    document.getElementById('importPasteArea').value = '';
    document.getElementById('importHintText').innerHTML = '※ 系统会自动寻找【<strong>监控 ASIN</strong>】、【<strong>快照时间</strong>】以及【备注1/2/3】列进行精准匹配覆盖。';
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

// ================= 全维度超级排序函数 =================
function smartSort(a, b, field, asc) {
    let valA = a[field] ?? ''; 
    let valB = b[field] ?? '';
    
    // 提取可能的数字
    let hasNumA = String(valA).match(/\d/);
    let hasNumB = String(valB).match(/\d/);
    let numA = hasNumA ? parseFloat(String(valA).replace(/[^0-9.-]/g, '')) : NaN;
    let numB = hasNumB ? parseFloat(String(valB).replace(/[^0-9.-]/g, '')) : NaN;
    
    let isNumA = !isNaN(numA) && hasNumA;
    let isNumB = !isNaN(numB) && hasNumB;

    // 1. 如果双方都包含有效数字，执行精确的数学升降序
    if (isNumA && isNumB) {
        if (numA !== numB) return asc ? numA - numB : numB - numA;
    }
    
    // 2. 核心优化：只要一方是数字，另一方是文本("-", "前三页无排名")，永远让数字排在上面！
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    // 3. 如果双方都是文本，按常规字典顺序升降序
    if(valA < valB) return asc ? -1 : 1;
    if(valA > valB) return asc ? 1 : -1;
    return 0;
}

// ================= 渲染：自然排名 =================
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

    let sortableTasks = trackerData.rankTasks.map(t => {
        let flat = { ...t }; 
        last5Days.forEach(d => flat[d] = t.history[d] || '-');
        return flat;
    });

    // 🌟 核心修改：支持站点、ASIN、搜索框三维交叉过滤
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

    // --- 新增：渲染多维度快捷过滤标签 ---
    let tagsContainer = document.getElementById('rankAsinTags');
    if(tagsContainer) {
        let uniqueSites = [...new Set(trackerData.rankTasks.map(t => t.siteCode || 'US'))];
        let uniqueAsins = [...new Set(trackerData.rankTasks.map(t => t.asin))];
        
        if(uniqueSites.length === 0 && uniqueAsins.length === 0) {
            tagsContainer.style.display = 'none';
        } else {
            tagsContainer.style.display = 'flex';
            tagsContainer.style.flexDirection = 'column';
            tagsContainer.style.alignItems = 'flex-start';
            tagsContainer.style.gap = '10px';
            
            let html = '';
            
            // 1. 站点过滤行
            if(uniqueSites.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <span class="asin-tags-label">🌍 站点过滤:</span>
                    <span class="asin-tag site-tag ${rankFilterSite === '' ? 'active' : ''}" data-site="">全部站点</span>`;
                uniqueSites.forEach(site => {
                    html += `<span class="asin-tag site-tag ${rankFilterSite === site ? 'active' : ''}" data-site="${site}">${site}</span>`;
                });
                html += `</div>`;
            }
            
            // 2. ASIN 过滤行
            if(uniqueAsins.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <span class="asin-tags-label">🎯 ASIN过滤:</span>
                    <span class="asin-tag asin-tag-btn ${rankFilterAsin === '' ? 'active' : ''}" data-asin="">全部 ASIN</span>`;
                uniqueAsins.forEach(asin => {
                    html += `<span class="asin-tag asin-tag-btn ${rankFilterAsin === asin ? 'active' : ''}" data-asin="${asin}">${asin}</span>`;
                });
                html += `</div>`;
            }
            
            tagsContainer.innerHTML = html;

            // 绑定点击事件
            tagsContainer.querySelectorAll('.site-tag').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    rankFilterSite = e.target.getAttribute('data-site');
                    renderRankTable();
                });
            });
            tagsContainer.querySelectorAll('.asin-tag-btn').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    rankFilterAsin = e.target.getAttribute('data-asin');
                    renderRankTable();
                });
            });
        }
    }
}



// ================= 渲染：详情变动快照 =================
document.getElementById('addDetailTaskBtn').addEventListener('click', async () => {
    let asins = tsvToArray(document.getElementById('detailAsins').value.toUpperCase());
    let siteVal = document.getElementById('detailSiteSelect').value.split('|');
    
    if(asins.length === 0) return alert("⚠️ 请先在输入框内填写需要监控的 ASIN！"); 
    asins.forEach(asin => { 
        let taskKey = `${asin}_${siteVal[0]}`;
        if(!trackerData.detailTasks[taskKey]) {
            trackerData.detailTasks[taskKey] = { asin: asin, siteCode: siteVal[0], domain: siteVal[1], history: {} }; 
        }
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
                // 🌟 将 salesTag 加入每日监控，一旦销量标签发生变化也会标红提示
                ['originalPrice', 'isDealStatus', 'dealDiscount', 'coupon', 'fbaFee', 'buybox', 'highReturn', 'salesTag', 'cat1_rank', 'cat2_rank', 'finalPrice'].forEach(key => {
                    let vCur = key === 'isDealStatus' ? isDealStatus : (key === 'dealDiscount' ? dealDiscount : cur[key]);
                    let vPrv = prv[key]; 
                    if(vCur && vPrv && vCur !== '-' && vPrv !== '-' && vCur !== vPrv) {
                        isChanged = true; changesText.push(`${key}: ${vPrv}→${vCur}`);
                    }
                });

                let r1 = cur.r1 || task.r1 || '';
                let r2 = cur.r2 || task.r2 || '';
                let r3 = cur.r3 || task.r3 || '';

                flatDataArray.push({ 
                    ...cur, taskKey: taskKey, asin: actualAsin, date, task, prv, r1, r2, r3,
                    isDealStatus, dealDiscount, 
                    isChanged: isChanged ? 'Y' : 'N', 
                    changesText: changesText.join(' | ') || '-'
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

    // --- 新增：渲染多维度快捷过滤标签 ---
    let tagsContainer = document.getElementById('detailAsinTags');
    if(tagsContainer) {
        let uniqueSites = [...new Set(Object.values(trackerData.detailTasks).map(t => t.siteCode || 'US'))];
        let uniqueAsins = [...new Set(Object.values(trackerData.detailTasks).map(t => t.asin))];
        
        if(uniqueSites.length === 0 && uniqueAsins.length === 0) {
            tagsContainer.style.display = 'none';
        } else {
            tagsContainer.style.display = 'flex';
            tagsContainer.style.flexDirection = 'column';
            tagsContainer.style.alignItems = 'flex-start';
            tagsContainer.style.gap = '10px';
            
            let html = '';
            
            // 1. 站点过滤行
            if(uniqueSites.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <span class="asin-tags-label">🌍 站点过滤:</span>
                    <span class="asin-tag site-tag ${detailFilterSite === '' ? 'active' : ''}" data-site="">全部站点</span>`;
                uniqueSites.forEach(site => {
                    html += `<span class="asin-tag site-tag ${detailFilterSite === site ? 'active' : ''}" data-site="${site}">${site}</span>`;
                });
                html += `</div>`;
            }
            
            // 2. ASIN 过滤行
            if(uniqueAsins.length > 0) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <span class="asin-tags-label">🎯 ASIN过滤:</span>
                    <span class="asin-tag asin-tag-btn ${detailFilterAsin === '' ? 'active' : ''}" data-asin="">全部 ASIN</span>`;
                uniqueAsins.forEach(asin => {
                    html += `<span class="asin-tag asin-tag-btn ${detailFilterAsin === asin ? 'active' : ''}" data-asin="${asin}">${asin}</span>`;
                });
                html += `</div>`;
            }
            
            tagsContainer.innerHTML = html;

            // 绑定点击事件
            tagsContainer.querySelectorAll('.site-tag').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    detailFilterSite = e.target.getAttribute('data-site');
                    renderDetailTable();
                });
            });
            tagsContainer.querySelectorAll('.asin-tag-btn').forEach(tag => {
                tag.addEventListener('click', (e) => {
                    detailFilterAsin = e.target.getAttribute('data-asin');
                    renderDetailTable();
                });
            });
        }
    }
}


// ================= 核心：多线程并发爬虫引擎 =================

// 🌟 优化：加入更真实的浏览器导航协议头，防止被亚马逊静默重定向
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

// 1. 🌟 自然排名引擎 (V10.18 终极翻页穿透与提速版)
async function runRankEngine(btnEl) {
    if(trackerData.rankTasks.length === 0) return alert("⚠️ 当前没有排名监控任务，请先在上方输入框添加任务！");

    let originalText = btnEl.innerText;
    btnEl.disabled = true;
    btnEl.innerText = "🔄 引擎初始化中..."; 
    await sleep(50); // 释放主线程动画防卡顿
    
    let today = getTodayStr();
    globalEmergencyStop = false;

    let taskQueue = [...trackerData.rankTasks];
    let totalTasks = taskQueue.length;
    let completedTasks = 0;

    async function rankWorker() {
        while (taskQueue.length > 0 && !globalEmergencyStop) {
            let task = taskQueue.shift();
            let foundRank = -1;
            let totalOrganicScanned = 0;
            let errorMsg = null;
            
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
                    
                    // 极简且精准的自然位提取
                    let allItems = Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"]'));
                    if(allItems.length === 0) {
                        allItems = Array.from(doc.querySelectorAll('div[data-asin]')).filter(el => el.getAttribute('data-asin') && el.getAttribute('data-asin').length === 10);
                    }

                    allItems.forEach(item => {
                        let isSponsored = item.querySelector('.puis-sponsored-label-text') || item.classList.contains('AdHolder') || item.innerHTML.includes('puis-sponsored-label');
                        if (!isSponsored) {
                            totalOrganicScanned++;
                            let displayedAsin = item.getAttribute('data-asin').toUpperCase();
                            if ((displayedAsin === task.asin || item.innerHTML.includes(task.asin)) && foundRank === -1) {
                                foundRank = totalOrganicScanned;
                            }
                        }
                    });
                    
                    if (foundRank !== -1) break; // 找到了立刻跳出，停止后续翻页
                    
                    // 🌟 核心优化：百分百提取带有安全令牌的真实下一页加密链接
                    if (page < 3) {
                        let nextUrl = null;
                        
                        // 方案 A: 优先从标准 DOM 提取真实的 href
                        let nextBtn = doc.querySelector('.s-pagination-next');
                        if (nextBtn && nextBtn.hasAttribute('href')) {
                            nextUrl = nextBtn.getAttribute('href');
                        }
                        
                        // 方案 B: 强力正则提取 (防 DOM 节点错乱)
                        if (!nextUrl) {
                            let match = htmlText.match(/href="([^"]+)"[^>]*class="[^"]*s-pagination-next/i) || 
                                        htmlText.match(/class="[^"]*s-pagination-next[^"]*"[^>]*href="([^"]+)"/i);
                            if (match && match[1]) nextUrl = match[1];
                        }

                        // 方案 C: 兜底匹配任何带有下一页页码的链接
                        if (!nextUrl) {
                            let pageReg = new RegExp(`href="(\\/s\\?[^"]*page=${page + 1}[^"]*)"`, 'i');
                            let match = htmlText.match(pageReg);
                            if (match && match[1]) nextUrl = match[1];
                        }

                        if (nextUrl) {
                            // 清洗 HTML 实体符号，拼装完美的跳转 URL
                            nextUrl = nextUrl.replace(/&amp;/g, '&');
                            currentUrl = 'https://www.' + currentDomain + nextUrl;
                            await sleep(randomDelay(1200, 2000)); // 翻页速度优化，稍微加快
                        } else {
                            // 没找到下一页按钮，说明已经到底了，强制跳出防止“鬼打墙”死循环第一页
                            break;
                        }
                    }
                    
                } catch(e) { 
                    errorMsg = e.message; 
                    globalEmergencyStop = true; 
                    break; 
                }
            }
            
            task.history[today] = errorMsg ? errorMsg : (foundRank !== -1 ? foundRank : '前三页无排名');
            completedTasks++;
            btnEl.innerText = `🔄 双线程抓取中 (${completedTasks}/${totalTasks})...`;
            renderRankTable();
            
            await sleep(randomDelay(1500, 2500)); // 优化任务间隙，提升约 30% 整体效率
        }
    }

    // 动态读取用户输入的线程数
    let threadCount = parseInt(document.getElementById('trackerThreadInput').value) || 2;
    if(threadCount > 10) threadCount = 10; // 安全上限

    let workers = [];
    for(let i=0; i<threadCount; i++) workers.push(rankWorker());
    await Promise.all(workers);

    btnEl.disabled = false;
    btnEl.innerText = originalText;
    if(globalEmergencyStop) alert("⚠️ 警告：检测到风控拦截或验证码！引擎已触发熔断急停，请稍后再试。");
}


// 2. 详情页监控引擎
async function runDetailEngine(btnEl) {
    let asinsToTrack = Object.keys(trackerData.detailTasks);
    if(asinsToTrack.length === 0) return alert("⚠️ 当前没有详情监控任务，请先在上方输入框添加 ASIN！");

    let originalText = btnEl.innerText;
    btnEl.disabled = true;
    btnEl.innerText = "🔄 引擎初始化中..."; 
    // 🌟 核心修复：释放主线程防卡顿
    await sleep(50);

    let today = getTodayStr();
    globalEmergencyStop = false;

    let taskQueue = [...asinsToTrack];
    let totalTasks = taskQueue.length;
    let completedTasks = 0;

    async function detailWorker() {
        while (taskQueue.length > 0 && !globalEmergencyStop) {
            let taskKey = taskQueue.shift();
            let taskInfo = trackerData.detailTasks[taskKey];
            let asin = taskInfo.asin;
            let domain = taskInfo.domain || 'amazon.com';
            
            try {
                let response = await fetch(`https://www.${domain}/dp/${asin}?th=1&psc=1`, fetchOptions);
                if(response.status === 503) throw new Error("被风控拦截(503)");
                let htmlText = await response.text();
                if(htmlText.includes('Type the characters you see')) throw new Error("触发验证码");

                const doc = new DOMParser().parseFromString(htmlText, "text/html");
                let extractText = (selector) => { let el = doc.querySelector(selector); return el ? el.innerText.trim() : '无'; };
                
                let centerCol = doc.querySelector('#centerCol') || doc.body;
                let rightCol = doc.querySelector('#rightCol') || doc.querySelector('#buybox') || doc.body;
                let centerText = centerCol.innerText;
                let rightText = rightCol.innerText;

                let mainPrice = extractText('.a-price .a-offscreen');
                if (mainPrice === '无') {
                    let pEl = doc.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen');
                    if(pEl) mainPrice = pEl.innerText.trim();
                }
                if (mainPrice === '无') {
                    let w = extractText('.a-price-whole'), f = extractText('.a-price-fraction');
                    if (w !== '无') mainPrice = '$' + w.replace('.', '') + (f !== '无' ? f : '00');
                }

                let basisPrice = extractText('.a-text-price .a-offscreen');
                if(basisPrice === '无') basisPrice = extractText('.a-text-strike');
                
                let isDealBadge = doc.querySelector('.dealBadgeSupported') || 
                                  centerText.includes('Limited time deal') || 
                                  centerText.includes('Deal of the Day') || 
                                  centerText.includes('Prime exclusive discount') ||
                                  centerText.includes('Prime savings');
                
                let savingsPct = extractText('.savingsPercentage');
                let dealDiscount = savingsPct !== '无' ? savingsPct.replace('-', '').trim() : '无';
                let originalPrice = basisPrice !== '无' ? basisPrice : (mainPrice !== '无' ? mainPrice : '-');
                let isDealStatus = isDealBadge ? '是' : '无';

                let coupon = '无';
                let couponSelectors = ['.promoPriceBadgeLabel', '.couponBadgeLine', 'label[id^="couponText"]', 'span.a-color-success.a-text-bold'];
                for(let sel of couponSelectors) {
                    let els = doc.querySelectorAll(sel);
                    for(let el of els) {
                        let text = el.innerText.trim();
                        let m = text.match(/(\$[\d\.]+|\d+%)/);
                        if(m) { coupon = m[1]; break; }
                    }
                    if(coupon !== '无') break;
                }
                
                if(coupon === '无') {
                    let combinedText = (centerText + " " + rightText).replace(/\s+/g, ' ');
                    let m = combinedText.match(/(?:Apply|Save)\s*(?:an extra\s*)?(\$[\d\.]+|\d+%)\s*(?:coupon|at checkout|with coupon)/i);
                    if (m) coupon = m[1];
                }

                let finalPrice = mainPrice !== '无' ? mainPrice : '-';
                if (coupon !== '无' && mainPrice !== '无') {
                    let pNum = parseFloat(mainPrice.replace(/[^0-9.]/g, ''));
                    if (!isNaN(pNum)) {
                        let pctMatch = coupon.match(/(\d+)%/); 
                        let amtMatch = coupon.match(/\$(\d+(\.\d+)?)/); 
                        if (pctMatch) finalPrice = '$' + (pNum * (1 - parseFloat(pctMatch[1])/100)).toFixed(2);
                        else if (amtMatch) finalPrice = '$' + Math.max(0, pNum - parseFloat(amtMatch[1])).toFixed(2);
                    }
                }

                let shippingFee = '无';
                let deliveryBlock = doc.querySelector('#mir-layout-DELIVERY_BLOCK-legacy-id') || doc.querySelector('#deliveryBlockMessage') || rightCol;
                let deliveryText = deliveryBlock.innerText.replace(/\s+/g, ' ');
                
                if (deliveryText.match(/FREE\s+(?:delivery|shipping|returns)/i)) {
                    shippingFee = '0.00';
                } else {
                    let shipMatch = deliveryText.match(/\$(\d+\.\d+)\s+(?:delivery|shipping)/i);
                    if (shipMatch) shippingFee = shipMatch[1];
                }

                let brand = '无';
                let brandRow = doc.querySelector('.po-brand .a-span9 span');
                if (brandRow) brand = brandRow.innerText.trim();
                if (brand === '无') {
                    let byline = extractText('#bylineInfo');
                    if (byline !== '无') {
                         let m = byline.match(/(?:Visit the|Brand:)\s*(.+)(?:\s*Store)?/i);
                         brand = m ? m[1].replace(/Store/i, '').trim() : byline;
                    }
                }

                let cat1 = '-', cat1_rank = '-', cat2 = '-', cat2_rank = '-';
                let rankMatchText = (doc.querySelector('#SalesRank') || {}).innerText || '';
                if (!rankMatchText) {
                    let ths = doc.querySelectorAll('th, span');
                    for(let el of ths) {
                        if(el.innerText.trim() === 'Best Sellers Rank') {
                            let parent = el.closest('tr') || el.closest('li') || el.parentElement;
                            if(parent) { rankMatchText = parent.innerText; break; }
                        }
                    }
                }
                if (rankMatchText) {
                    let matches = [...rankMatchText.replace(/,/g, '').matchAll(/#(\d+)\s+in\s+([^\(\n]+)/g)];
                    if(matches.length > 0) { cat1_rank = matches[0][1]; cat1 = matches[0][2].trim(); }
                    if(matches.length > 1) { cat2_rank = matches[1][1]; cat2 = matches[1][2].trim(); }
                }

                let img = (doc.querySelector('#landingImage') || doc.querySelector('#imgBlkFront') || {}).src || '';
                
                let buybox = '无';
                let sellerIdEl = doc.querySelector('#sellerProfileTriggerId');
                if (sellerIdEl) buybox = sellerIdEl.innerText.trim();
                else {
                    let merchInfo = extractText('#merchant-info');
                    if (merchInfo !== '无' && merchInfo.includes('Sold by')) {
                         let parts = merchInfo.split('Sold by');
                         if(parts.length > 1) buybox = parts[1].replace(/\n/g, '').trim();
                    } else if (rightText.includes('Amazon.com') || rightText.includes('Amazon US')) {
                        buybox = 'Amazon';
                    }
                }
                let highReturn = (centerText.includes('Frequently returned') || centerText.includes('高退货')) ? '是' : '无';

                // 🌟 新增：多重防御式提取销量标签 (Sales Tag)
                let salesTag = '无';
                let socialProofEl = doc.querySelector('#social-proofing-faceout-title-tk_bought') || doc.querySelector('.social-proofing-faceout-title-text') || doc.querySelector('#social-proofing-faceout-title-tk_purchased');
                if (socialProofEl) {
                    salesTag = socialProofEl.innerText.trim();
                } else {
                    // 如果亚马逊改了标签 ID，使用底层文本强力正则兜底提取
                    let m = centerText.match(/(\d+[KkM]?\+?\s*(?:bought|purchased)[^\n]*?(?:past month|month|week))/i);
                    if(m) salesTag = m[1].replace(/\n/g, '').trim();
                }

                let oldR1 = '', oldR2 = '', oldR3 = '';
                if(trackerData.detailTasks[taskKey].history[today]) {
                    oldR1 = trackerData.detailTasks[taskKey].history[today].r1 || '';
                    oldR2 = trackerData.detailTasks[taskKey].history[today].r2 || '';
                    oldR3 = trackerData.detailTasks[taskKey].history[today].r3 || '';
                }

                trackerData.detailTasks[taskKey].history[today] = {
                    originalPrice: originalPrice, 
                    isDealStatus: isDealStatus, 
                    dealDiscount: dealDiscount, 
                    coupon: coupon, 
                    fbaFee: shippingFee, 
                    finalPrice: finalPrice, 
                    brand: brand, 
                    buybox: buybox, 
                    highReturn: highReturn, 
                    salesTag: salesTag, // 🌟 写入刚才提取的销量标签
                    img: img, 
                    cat1: cat1, cat1_rank: cat1_rank, cat2: cat2, cat2_rank: cat2_rank, 
                    r1: oldR1, r2: oldR2, r3: oldR3,
                    status: '成功'
                };

            } catch(e) { 
                // 修复点3：用 taskKey 替换 asin
                trackerData.detailTasks[taskKey].history[today] = { status: e.message }; 
                if (e.message.includes('验证码') || e.message.includes('503')) {
                    globalEmergencyStop = true; 
                }
            }

            completedTasks++;
            btnEl.innerText = `🔄 并发拆解中 (${completedTasks}/${totalTasks})...`;
            renderDetailTable();
            
            await sleep(randomDelay(2500, 4500)); 
        }
    }

    // 动态读取用户输入的线程数
    let threadCount = parseInt(document.getElementById('trackerThreadInput').value) || 3;
    if(threadCount > 10) threadCount = 10;

    let workers = [];
    for(let i=0; i<threadCount; i++) workers.push(detailWorker());
    await Promise.all(workers);

    btnEl.disabled = false;
    btnEl.innerText = originalText;
    if(globalEmergencyStop) alert("⚠️ 警告：检测到风控拦截或验证码！引擎已触发熔断急停，请稍后再试。");
}

