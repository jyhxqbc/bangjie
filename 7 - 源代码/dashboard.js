// ==========================================
// 🛡️ BLK V10.0 离线算法授权系统 (Payload Password)
// ==========================================

// 【站长配置】在这里修改你的主人账号、密码和加密盐
const ADMIN_USER = "blake";
const ADMIN_PASS = "blake789";
const SECRET_SALT = "BLK_SUPER_V9_KEY!@#"; // 核心防伪盐，打死不要改也不要泄露

// 生成随机字符串
function generateRandomStr(length) {
    return Math.random().toString(36).substring(2, 2 + length);
}

// 简易哈希算法 (用于防篡改签名)
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        let char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

// ================= 检查登录状态 =================
async function checkLoginStatus() {
    let stored = await new Promise(resolve => {
        chrome.storage.local.get(['blkSession'], resolve);
    });

    if (stored.blkSession) {
        unlockApp(stored.blkSession.user, stored.blkSession.expire);
    } else {
        document.getElementById('authModal').style.display = 'flex';
    }
}

function showAuthError(msg) {
    let errEl = document.getElementById('authErrorMsg');
    errEl.innerText = msg;
    errEl.style.display = 'block';
}

function unlockApp(username, expireDate) {
    document.getElementById('authModal').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    
    if(username === ADMIN_USER) {
        document.getElementById('currentUserDisplay').innerText = `当前登录：超级站长 (无限权限) | `;
    } else {
        document.getElementById('currentUserDisplay').innerText = `当前登录：${username} (到期: ${expireDate}) | `;
    }
    
    initUiLogic(); 
    checkSavedProgress(); 
}

// ================= 客户登录验证逻辑 (核心算法验证) =================
document.getElementById('verifyLoginBtn').addEventListener('click', async () => {
    let u = document.getElementById('loginUsername').value.trim();
    let p = document.getElementById('loginPassword').value.trim();

    if (!u || !p) return showAuthError("账号和密码不能为空！");

    // 🌟 如果输入的是站长账号，瞬间进入管理面板
    if (u === ADMIN_USER && p === ADMIN_PASS) {
        document.getElementById('userPanel').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        initAdminPanel();
        refreshAdminAccountList(); 
        return;
    }

    // 🌟 普通客户登录：逆向解析算法密码
    try {
        let rawData = atob(p);
        let parts = rawData.split('|');
        if (parts.length !== 2) throw new Error();
        
        let expireDate = parts[0];
        let signature = parts[1];
        
        let expectedSignature = hashString(u + expireDate + SECRET_SALT);
        if (signature !== expectedSignature) {
            return showAuthError("❌ 密码无效或已被篡改！");
        }

        document.getElementById('verifyLoginBtn').innerText = "安全校验中...";
        let realTimeStr;
        try {
            let res = await fetch("http://worldtimeapi.org/api/timezone/Etc/UTC", { cache: "no-store" });
            let timeData = await res.json();
            realTimeStr = timeData.datetime.split('T')[0];
        } catch (e) {
            realTimeStr = new Date().toISOString().split('T')[0];
        }

        if (realTimeStr > expireDate) {
            return showAuthError(`⏳ 该账号已于 ${expireDate} 到期，请联系管理员续费！`);
        }

        await chrome.storage.local.set({ blkSession: { user: u, expire: expireDate } });
        location.reload(); 

    } catch (e) {
        showAuthError("❌ 密码格式不正确或无效！");
        document.getElementById('verifyLoginBtn').innerText = "登录系统";
    }
});

// ================= 站长管理后台：制卡机与联动 =================
const startDateEl = document.getElementById('accStartDate');
const durationEl = document.getElementById('accDuration');
const endDateEl = document.getElementById('accEndDate');

function initAdminPanel() {
    let today = new Date();
    startDateEl.value = today.toISOString().split('T')[0];
    updateEndDate();
}

function updateEndDate() {
    let start = new Date(startDateEl.value);
    let days = parseInt(durationEl.value) || 0;
    start.setDate(start.getDate() + days);
    endDateEl.value = start.toISOString().split('T')[0];
}

function updateDuration() {
    let start = new Date(startDateEl.value);
    let end = new Date(endDateEl.value);
    let diffTime = end - start;
    let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    durationEl.value = diffDays > 0 ? diffDays : 0;
}

startDateEl.addEventListener('change', updateEndDate);
durationEl.addEventListener('input', updateEndDate);
endDateEl.addEventListener('change', updateDuration);

document.getElementById('createAccBtn').addEventListener('click', async () => {
    let u = document.getElementById('newAccUser').value.trim();
    if (!u) u = "user_" + generateRandomStr(4);

    let endDate = endDateEl.value;
    let signature = hashString(u + endDate + SECRET_SALT);
    let rawPass = endDate + "|" + signature;
    let p = btoa(rawPass); 

    document.getElementById('newAccUser').value = u;
    document.getElementById('newAccPass').value = p;

    let stored = await new Promise(resolve => chrome.storage.local.get(['blkAccountsRecord'], resolve));
    let accounts = stored.blkAccountsRecord || {};
    
    accounts[u] = { password: p, expireDate: endDate, createdAt: new Date().toLocaleDateString() };
    await chrome.storage.local.set({ blkAccountsRecord: accounts });
    refreshAdminAccountList();
});

async function refreshAdminAccountList() {
    let stored = await new Promise(resolve => chrome.storage.local.get(['blkAccountsRecord'], resolve));
    let accounts = stored.blkAccountsRecord || {};
    let output = "";
    let keys = Object.keys(accounts);
    if (keys.length === 0) {
        output = "暂无生成记录。";
    } else {
        keys.forEach(user => {
            let acc = accounts[user];
            output += `👉账号: ${user}  |  🔑密码: ${acc.password}  |  ⏳到期: ${acc.expireDate}\n`;
        });
    }
    document.getElementById('accountListOutput').value = output;
}

document.getElementById('exportAccBtn').addEventListener('click', async () => {
    let stored = await new Promise(resolve => chrome.storage.local.get(['blkAccountsRecord'], resolve));
    let accounts = stored.blkAccountsRecord || {};
    let keys = Object.keys(accounts);

    if (keys.length === 0) return alert("⚠️ 暂无记录可导出！");

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "登录账号,系统密码,授权到期日,制卡日期\n";

    keys.forEach(user => {
        let acc = accounts[user];
        csvContent += `"${user}","${acc.password}","${acc.expireDate}","${acc.createdAt}"\n`;
    });

    let encodedUri = encodeURI(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `BLK_本地分发记录_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

document.getElementById('clearAllAccBtn').addEventListener('click', async () => {
    if(confirm("🚨 注意：因为没有云端服务器，这仅仅是清理你本机的【历史发卡记录表】。\n客户在他自己电脑上，只要没到期依然可以登录！\n\n确定要清空本地记录吗？")) {
        await chrome.storage.local.set({ blkAccountsRecord: {} });
        refreshAdminAccountList();
    }
});

document.getElementById('adminEnterBtn').addEventListener('click', async () => {
    await chrome.storage.local.set({ blkSession: { user: ADMIN_USER, expire: "永久" } });
    location.reload();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['blkSession']);
    location.reload();
});

// ==========================================
// 🚀 V10.0 核心引擎代码
// ==========================================

let queueKeywords = [];
let queueTargetAsins = [];
let queueIndex = 0;
let isTaskRunning = false;
let taskMode = 'RANK'; 
let failedKeywords = new Set(); 
let finalResultsTable = [];

// [已修复] 移除全局读取，初始化为默认值2，等待运行时动态读取
let maxConcurrent = 2;
let activeWorkers = 0;   
let punishMode = false;  

const rankHeaders = ["关键词", "查询深度", "类型", "搜索结果数", "每页产品数", "前3自然占坑数", "前3自然位占比", "前8自然占坑数", "前8自然位占比", "前16自然占坑数", "前16自然位占比", "自然产品总数", "总自然占坑数", "总自然位占比", "自然位ASIN1", "自然位ASIN2", "自然位ASIN3", "AC产品", "AC是否同款", "抓取时间"];
const indexHeaders = ["关键词", "类型", "显示类型", "总产品数", "收录产品数", "收录占比", "已收录ASIN1", "已收录ASIN2", "已收录ASIN3", "抓取时间"];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const tsvToArray = (tsv) => tsv.split('\n').map(r => r.trim()).filter(Boolean);
function getIntRandom(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// 👇 补充缺失的核心日志与状态更新函数
function log(msg) {
    let logArea = document.getElementById('logArea');
    if (logArea) {
        logArea.innerHTML += msg + "<br>";
        logArea.scrollTop = logArea.scrollHeight;
    }
}

function updateUiStatus(text = "系统待机中...") {
    let statusEl = document.getElementById('statusText');
    if (statusEl) statusEl.innerText = text;
}
// 👆 补充结束

function saveState(isFinished = false) {
    let state = {
        queueKeywords, queueTargetAsins, queueIndex, taskMode,
        finalResultsTable, failedKeywords: Array.from(failedKeywords),
        startPage: document.getElementById('startPageInput').value,
        endPage: document.getElementById('endPageInput').value,
        punishMode, isFinished
    };
    chrome.storage.local.set({ blkEngineState: state });
}

function checkSavedProgress() {
    chrome.storage.local.get(['blkEngineState', 'blkVizState'], (result) => {
        // 1. 恢复排名任务的检测
        if (result.blkEngineState) {
            let state = result.blkEngineState;
            if (state.queueIndex < state.queueKeywords.length && !state.isFinished) {
                let btn = document.getElementById('resumeProgressBtn');
                btn.style.display = 'inline-flex';
                btn.innerText = `↺ 恢复未完成任务 (${state.queueIndex}/${state.queueKeywords.length})`;
                log(`<span class="highlight">💡 系统检测到上次有未完成的排名/收录任务，你可以点击黄色按钮一键恢复。</span>`);
            }
        }
        // 2. 恢复大盘视图任务的检测 (需求2)
        if (result.blkVizState) {
            let vState = result.blkVizState;
            if (vState.index < vState.terms.length && !vState.isFinished) {
                let btn = document.getElementById('resumeVizBtn');
                btn.style.display = 'inline-flex';
                btn.innerText = `↺ 恢复未完成大盘 (${vState.index}/${vState.terms.length})`;
                log(`<span class="highlight">💡 系统检测到上次有未完成的大盘抓取进度，你可以点击大盘旁边的恢复按钮。</span>`);
            }
        }
    });
}

function resumeTask() {
    chrome.storage.local.get(['blkEngineState'], (result) => {
        if (result.blkEngineState) {
            let state = result.blkEngineState;
            queueKeywords = state.queueKeywords;
            queueTargetAsins = state.queueTargetAsins;
            queueIndex = state.queueIndex;
            taskMode = state.taskMode;
            finalResultsTable = state.finalResultsTable;
            failedKeywords = new Set(state.failedKeywords);
            punishMode = state.punishMode || false;
            
            document.getElementById('startPageInput').value = state.startPage;
            document.getElementById('endPageInput').value = state.endPage;
            document.getElementById('resumeProgressBtn').style.display = 'none';
            
            // 动态读取最新线程数
            let threadVal = parseInt(document.getElementById('threadInput').value);
            maxConcurrent = (threadVal >= 1 && threadVal <= 10) ? threadVal : 2; 

            log(`<span class="highlight">==== 🔌 本地断点数据已成功读取，准备从第 ${queueIndex+1} 个词继续抓取 ====</span>`);
            
            if (punishMode) {
                maxConcurrent = 1;
                log(`<span class="error">⚠️ 开启安全降速模式：检测到近期风控拦截，退化为单线程执行。</span>`);
            }
            startEngineMaster();
        }
    });
}

function extractDataFromVirtualDom(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    if (htmlString.includes('puis-captcha-card') || doc.title.includes('Captcha') || htmlString.includes('Enter the characters you see below')) {
        return { error: "CAPTCHA_DETECTED" };
    }

    let items = doc.querySelectorAll('div[data-component-type="s-search-result"]');
    if (items.length === 0) {
        let allAsinDivs = doc.querySelectorAll('div[data-asin]');
        items = Array.from(allAsinDivs).filter(div => div.getAttribute('data-asin').length > 5);
    }

    let purePageAsins = [];
    let acAsin = "";

    items.forEach(item => {
        let asin = item.getAttribute('data-asin');
        if (!asin || asin.trim() === '') return;
        let content = item.innerHTML;
        let isSponsored = content.includes('puis-sponsored-label') || content.includes('Sponsored') || content.includes('广告');

        if (!isSponsored) {
            purePageAsins.push(asin.toUpperCase());
            if (content.includes("Amazon's Choice") || content.includes("ac-badge")) {
                if(!acAsin) acAsin = asin.toUpperCase();
            }
        }
    });

    let totalResultsStr = "-";
    let infoBar = doc.querySelector('span[data-component-type="s-result-info-bar"]');
    if (infoBar) {
        let text = infoBar.innerText.replace(/,/g, ''); 
        let match = text.match(/over\s+(\d+)\s+results/i) || text.match(/of\s+(\d+)\s+results/i);
        if (match) totalResultsStr = match[1];
    }

    return { error: null, organicAsins: purePageAsins, acAsin: acAsin, totalResults: totalResultsStr };
}

async function startEngineMaster() {
    isTaskRunning = true;
    activeWorkers = 0;
    let threadIdCounter = 0; // 用于分配真实的、稳定的线程视觉 ID

    updateUiStatus(taskMode === 'RANK' ? "🚀 V10.0 并发引擎: 深度占比..." : "🚀 V10.0 并发引擎: 极速收录...");
    
    while (queueIndex < queueKeywords.length && isTaskRunning) {
        // 🌟 核心优化：每次派发新任务前，都重新读取一次输入框的值
        let currentInputVal = parseInt(document.getElementById('threadInput').value);
        if (!punishMode) {
            maxConcurrent = (currentInputVal >= 1 && currentInputVal <= 10) ? currentInputVal : 2;
        }

        if (activeWorkers < maxConcurrent) {
            let currentIndex = queueIndex++; 
            let kw = queueKeywords[currentIndex];
            activeWorkers++;
            
            // 轮流分配固定的线程编号 (例如 1, 2, 3, 4, 5 循环)，让日志看起来更清晰
            threadIdCounter = (threadIdCounter % maxConcurrent) + 1;
            let assignId = threadIdCounter;

            processWorkerTask(kw, assignId).then(() => {
                activeWorkers--;
                saveState(); 
                updateUiStatus();
            });
            // 错峰启动，防止同时发出多个请求被亚马逊瞬间风控
            await sleep(getIntRandom(800, 1500));
        } else {
            // 如果当前运行的线程已经达到上限，就稍微等一下
            await sleep(500); 
        }
    }
    
    // 等待所有仍在运行的尾盘任务结束
    while (activeWorkers > 0) {
        await sleep(500);
    }
    
    if (isTaskRunning) {
        isTaskRunning = false;
        saveState(true); 
        updateUiStatus("所有队列任务执行完毕！");
        log(`<span class="highlight">🎉 任务顺利完成，点击下方按钮导出 Excel 报表。</span>`);
    }
}

async function processWorkerTask(kw, workerId) {
    if (!isTaskRunning) return; 
    let targetSet = new Set(queueTargetAsins);
    
    if (taskMode === 'RANK') {
        let startPage = parseInt(document.getElementById('startPageInput').value);
        let endPage = parseInt(document.getElementById('endPageInput').value);
        
        let agg_c3 = 0, agg_c8 = 0, agg_c16 = 0, agg_cTotal = 0, agg_totalOrganic = 0;
        let firstPageTotalResults = "-", firstPageAcAsin = "无";
        let absoluteTop3Asins = [];
        let isKwFailed = false;

        log(`[线程${workerId}] ▶ 开始执行: [${kw}]`);

        for (let currentPage = startPage; currentPage <= endPage; currentPage++) {
            if (!isTaskRunning) break;
            
            try {
                let domain = document.getElementById('globalSiteSelect').value;
                let searchUrl = `https://${domain}/s?k=${encodeURIComponent(kw)}&page=${currentPage}`;
                let response = await fetch(searchUrl, { headers: { 'Accept': 'text/html', 'User-Agent': navigator.userAgent } });
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                let htmlText = await response.text();
                let pageData = extractDataFromVirtualDom(htmlText);

                if (pageData.error === "CAPTCHA_DETECTED") {
                    log(`<span class="error">⛔ [风控拦截] ${kw} 触发验证码！安全急停！请新开页面解除后点击恢复。</span>`);
                    isTaskRunning = false; punishMode = true; failedKeywords.add(kw); isKwFailed = true;
                    // 回退索引
                    queueIndex--; 
                    document.getElementById('resumeProgressBtn').style.display = 'inline-flex';
                    break; 
                }

                if (pageData.organicAsins && pageData.organicAsins.length > 0) {
                    if (currentPage === startPage) {
                        firstPageTotalResults = pageData.totalResults;
                        if(pageData.acAsin) firstPageAcAsin = pageData.acAsin;
                    }

                    let asins = pageData.organicAsins;
                    asins.forEach((asin) => {
                        agg_totalOrganic++; 
                        if (agg_totalOrganic <= 3) absoluteTop3Asins.push(asin);
                        if (targetSet.has(asin)) {
                            if (agg_totalOrganic <= 3) agg_c3++;
                            if (agg_totalOrganic <= 8) agg_c8++;
                            if (agg_totalOrganic <= 16) agg_c16++;
                            agg_cTotal++;
                        }
                    });
                    log(`  └─ <span class="success">[线程${workerId}] ✔ 第${currentPage}页提取成功</span>`);
                } else {
                     log(`  └─ <span class="error">[线程${workerId}] ⚠ 第${currentPage}页无数据</span>`);
                }
            } catch (err) {
                log(`  └─ <span class="error">[线程${workerId}] ❌ 网络异常: ${err.message}</span>`);
                failedKeywords.add(kw); isKwFailed = true;
                break; 
            }

            if (currentPage < endPage && isTaskRunning && !isKwFailed) {
                let base = parseInt(document.getElementById('baseDelayInput').value);
                await sleep(getIntRandom(base, base+3) * 1000);
            }
        }

        if (!isKwFailed && agg_totalOrganic > 0) {
            let p3 = ((agg_c3 / Math.min(3, agg_totalOrganic)) * 100).toFixed(2) + "%";
            let p8 = ((agg_c8 / Math.min(8, agg_totalOrganic)) * 100).toFixed(2) + "%";
            let p16 = ((agg_c16 / Math.min(16, agg_totalOrganic)) * 100).toFixed(2) + "%";
            let pTotal = ((agg_cTotal / agg_totalOrganic) * 100).toFixed(2) + "%";
            let acStatus = firstPageAcAsin !== "无" ? (targetSet.has(firstPageAcAsin) ? "AC同款" : "非同款") : "无AC";
            let depthStr = startPage === endPage ? `第${startPage}页` : `${startPage}-${endPage}页`;
            let avgProductsPerPage = Math.round(agg_totalOrganic / (endPage - startPage + 1));

            finalResultsTable.push([
                kw, depthStr, "正词", firstPageTotalResults, avgProductsPerPage,
                agg_c3, p3, agg_c8, p8, agg_c16, p16,
                agg_totalOrganic, agg_cTotal, pTotal,
                absoluteTop3Asins[0] || "-", absoluteTop3Asins[1] || "-", absoluteTop3Asins[2] || "-",
                firstPageAcAsin, acStatus, new Date().toLocaleString()
            ]);
        } else if (!isKwFailed && agg_totalOrganic === 0) {
            let depthStr = startPage === endPage ? `第${startPage}页` : `${startPage}-${endPage}页`;
            finalResultsTable.push([kw, depthStr, "异常无数据", "-", "0", 0, "0%", 0, "0%", 0, "0%", 0, 0, "0%", "-", "-", "-", "-", "-", new Date().toLocaleString()]);
        }

    } else if (taskMode === 'INDEX') {
        log(`[线程${workerId}] ▶ 开始嗅探: [${kw}]`);
        let totalTarget = queueTargetAsins.length;
        let indexedCount = 0;
        let asinsIndexed = [];
        let isKwFailed = false;

        for (let i = 0; i < totalTarget; i++) {
            if (!isTaskRunning) break;
            let asin = queueTargetAsins[i];
            let searchKw = `${asin} ${kw}`; 

            try {
                let domain = document.getElementById('globalSiteSelect').value;
                let searchUrl = `https://${domain}/s?k=${encodeURIComponent(searchKw)}`;
                let response = await fetch(searchUrl, { headers: { 'Accept': 'text/html', 'User-Agent': navigator.userAgent } });
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                let htmlText = await response.text();

                if (htmlText.includes('puis-captcha-card') || htmlText.includes('Enter the characters you see below')) {
                    log(`<span class="error">⛔ [风控拦截] 触发验证码！引擎急停，等待解除。</span>`);
                    isTaskRunning = false; punishMode = true; failedKeywords.add(kw); isKwFailed = true;
                    queueIndex--;
                    document.getElementById('resumeProgressBtn').style.display = 'inline-flex';
                    break;
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, "text/html");
                let allAsinsOnPage = Array.from(doc.querySelectorAll('[data-asin]')).map(el => el.getAttribute('data-asin').toUpperCase());
                let isIndexed = allAsinsOnPage.includes(asin);

                if (!isIndexed) {
                    let cleanBodyText = htmlText.replace(/value="[^"]*"/gi, ""); 
                    let isNoResults = cleanBodyText.includes("No results for") || cleanBodyText.includes("No exact matches found");
                    if (cleanBodyText.includes(asin) && !isNoResults) isIndexed = true;
                }

                if (isIndexed) {
                    indexedCount++;
                    asinsIndexed.push(asin);
                } 
            } catch (err) {
                failedKeywords.add(kw); isKwFailed = true;
                break;
            }

            if (i < totalTarget - 1 && isTaskRunning && !isKwFailed) {
                await sleep(getIntRandom(2, 4) * 1000);
            }
        }

        if (!isKwFailed && isTaskRunning) {
            log(`  └─ <span class="success">[线程${workerId}] ✔ [${kw}] 诊断完成: ${indexedCount}/${totalTarget}</span>`);
            let pct = totalTarget > 0 ? ((indexedCount / totalTarget) * 100).toFixed(2) + "%" : "0.00%";
            finalResultsTable.push([
                kw, "正词", "-", totalTarget, indexedCount, pct,
                asinsIndexed[0] || "-", asinsIndexed[1] || "-", asinsIndexed[2] || "-",
                new Date().toLocaleString()
            ]);
        }
    }

    if (isTaskRunning) {
        let base = parseInt(document.getElementById('baseDelayInput').value);
        let actualBase = punishMode ? base * 2.5 : base; 
        await sleep(getIntRandom(actualBase-1, actualBase+3) * 1000);
    }
}

function retryErrorTasks() {
    if (failedKeywords.size === 0) return alert("没有检测到错误数据！");
    
    queueKeywords = Array.from(failedKeywords);
    queueIndex = 0;
    failedKeywords.clear(); 
    
    // 【修改点】：解除惩罚模式，并动态读取面板上的并发线程数
    punishMode = false; 
    let threadVal = parseInt(document.getElementById('threadInput').value);
    maxConcurrent = (threadVal >= 1 && threadVal <= 10) ? threadVal : 2; 
    
    if (taskMode === 'RANK') {
        finalResultsTable = finalResultsTable.filter(row => row === rankHeaders || !queueKeywords.includes(row[0]));
    } else if (taskMode === 'INDEX') {
        finalResultsTable = finalResultsTable.filter(row => row === indexHeaders || !queueKeywords.includes(row[0]));
    }
    
    // 【修改点】：更新日志提示，显示实际运行的线程数
    log(`<span class="highlight">🔄 开始提取并重跑错误数据... (已恢复正常抓取，当前为 ${maxConcurrent} 线程并发)</span>`);
    startEngineMaster();
}

function exportResultsToExcel() {
    let tempExportTable = [...finalResultsTable];
    
    if (queueIndex < queueKeywords.length) {
        for (let i = queueIndex; i < queueKeywords.length; i++) {
            let pendingKw = queueKeywords[i];
            let startPage = document.getElementById('startPageInput').value;
            let endPage = document.getElementById('endPageInput').value;
            let depthStr = startPage === endPage ? `第${startPage}页` : `${startPage}-${endPage}页`;
            
            if (taskMode === 'RANK') {
                tempExportTable.push([pendingKw, depthStr, "待抓取", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "队列排队中..."]);
            } else {
                tempExportTable.push([pendingKw, "-", "-", "-", "-", "-", "-", "-", "-", "队列排队中..."]);
            }
        }
    }

    failedKeywords.forEach(failedKw => {
        if (!tempExportTable.some(row => row[0] === failedKw)) {
             if (taskMode === 'RANK') {
                let startPage = document.getElementById('startPageInput').value;
                let endPage = document.getElementById('endPageInput').value;
                let depthStr = startPage === endPage ? `第${startPage}页` : `${startPage}-${endPage}页`;
                tempExportTable.push([failedKw, depthStr, "失败", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "❌ 抓取失败/需重试"]);
            } else {
                tempExportTable.push([failedKw, "-", "-", "-", "-", "-", "-", "-", "-", "❌ 抓取失败/需重试"]);
            }
        }
    });

    let htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="UTF-8"></head>
        <body>
            <table border="1">
                <thead>
                    <tr style="background-color: #f1f5f9; font-weight: bold;">
                        ${tempExportTable[0].map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    for (let i = 1; i < tempExportTable.length; i++) {
        let row = tempExportTable[i];
        htmlContent += `<tr>${row.map(cell => `<td style="mso-number-format:'\\@';">${cell}</td>`).join('')}</tr>`;
    }

    htmlContent += `</tbody></table></body></html>`;

    let uri = 'data:application/vnd.ms-excel;base64,';
    let base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));
    
    let link = document.createElement("a");
    link.href = uri + base64;
    link.download = taskMode === 'RANK' ? `BLK_多页聚合引擎_${new Date().getTime()}.xls` : `BLK_收录体检数据_${new Date().getTime()}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ====================================================
// 🚀 选品大盘分析系统 (升级版：支持 BSR 榜单调研)
// ====================================================

let vizAllSearchTerms = [];
let vizTermIndex = 0;
let vizExtractedProducts = [];
let isVisRunning = false;
let vizStartP = 1;
let vizEndP = 1;

function saveVizState(isFinished = false) {
    chrome.storage.local.set({
        blkVizState: {
            terms: vizAllSearchTerms,
            index: vizTermIndex,
            products: vizExtractedProducts,
            startP: vizStartP,
            endP: vizEndP,
            isFinished: isFinished
        }
    });
}

// 大盘线程抓取逻辑
async function visWorker(workerId, btn) {
    while (vizTermIndex < vizAllSearchTerms.length && isVisRunning) {
        let currentIndex = vizTermIndex; 
        vizTermIndex++; 
        
        let targetTerm = vizAllSearchTerms[currentIndex];
        // 🌟 识别任务类型：榜单节点带有 NODE: 前缀
        let isNode = targetTerm.startsWith('NODE:');
        let queryVal = isNode ? targetTerm.replace('NODE:', '') : targetTerm;
        
        // 榜单最多抓 2 页（前100名）
        let maxPage = isNode ? Math.min(2, vizEndP) : vizEndP;

        for (let currentPage = vizStartP; currentPage <= maxPage; currentPage++) {
            if (!isVisRunning) break;
            btn.innerText = `🚀 视图并发中... (${currentIndex + 1}/${vizAllSearchTerms.length})`;
            
            try {
                let domain = document.getElementById('globalSiteSelect').value;
                // 🌟 根据类型选择 URL 引擎
                let searchUrl = isNode 
                    ? `https://${domain}/gp/bestsellers/generic/${queryVal}/?pg=${currentPage}` 
                    : `https://${domain}/s?k=${encodeURIComponent(queryVal)}&page=${currentPage}`;

                let response = await fetch(searchUrl, { headers: { 'Accept': 'text/html', 'User-Agent': navigator.userAgent } });
                if (!response.ok) throw new Error("HTTP Error");
                let htmlText = await response.text();

                if (htmlText.includes('puis-captcha-card') || htmlText.includes('Enter the characters you see below')) {
                    log(`<span class="error">⛔ [风控拦截] 大盘抓取 [${queryVal}] 遇到验证码！请解除后点击恢复。</span>`);
                    isVisRunning = false;
                    if (vizTermIndex > currentIndex) vizTermIndex = currentIndex;
                    saveVizState(false);
                    document.getElementById('resumeVizBtn').style.display = 'inline-flex';
                    break; 
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, "text/html");
                
                if (isNode) {
                    // 🌟 榜单页提取逻辑
                    let items = doc.querySelectorAll('#gridItemRoot, .zg-grid-general-faceout');
                    items.forEach(item => {
                        let m = item.innerHTML.match(/\/dp\/([A-Z0-9]{10})/i);
                        let asin = m ? m[1] : '';
                        if (!asin) return;

                        let imgEl = item.querySelector('img');
                        let img = imgEl ? imgEl.src : '';
                        let titleEl = item.querySelector('div[class*="line-clamp"]') || imgEl;
                        let title = titleEl ? (titleEl.innerText || titleEl.alt) : '未知标题';
                        
                        // 🌟 修复：针对亚马逊榜单页 (BSR) 的多维价格探测逻辑
                        let price = null;
                        
                        // 方案 A：寻找 BSR 榜单专属的价格 class
                        let priceEl = item.querySelector('.p13n-sc-price') || item.querySelector('.a-color-price') || item.querySelector('._cDEzb_p13n-sc-price_3mJ9Z');
                        if (priceEl) {
                            let match = priceEl.innerText.match(/[\d,]+\.\d{2}/);
                            if (match) price = parseFloat(match[0].replace(/,/g, ''));
                        } 
                        
                        // 方案 B：如果 A 失败，尝试普通的整数小数拼接模式
                        if (!price) { 
                            let w = item.querySelector('.a-price-whole');
                            if (w) {
                                let f = item.querySelector('.a-price-fraction');
                                price = parseFloat(w.innerText.replace(/[,.]/g, '') + '.' + (f ? f.innerText.replace(/[^0-9]/g,'') : '00'));
                            }
                        }
                        
                        // 方案 C：终极兜底，直接暴力匹配整个卡片文本里的金钱格式 (如 $24.99)
                        if (!price) { 
                            let match = item.innerText.match(/\$\s*([\d,]+\.\d{2})/);
                            if (match) price = parseFloat(match[1].replace(/,/g, ''));
                        }
                        
                        if (isNaN(price) || price === 0) price = null;

                        let rating = 0;
                        let ratingMatch = item.innerHTML.match(/(\d[\.\d]*)\s*out of 5 stars/i);
                        if (ratingMatch) rating = parseFloat(ratingMatch[1]);

                        let reviewCount = 0;
                        let reviewNode = item.querySelector('.a-size-small');
                        if (reviewNode) reviewCount = parseInt(reviewNode.innerText.replace(/,/g, '')) || 0;

                        let salesMatch = item.innerHTML.match(/(\d+[KkM]?\+?\s*(?:bought|purchased)[^\n]*?(?:past month|month|week))/i);
                        let sales = salesMatch ? salesMatch[1].trim() : '';
                        
                        let rankBadgeEl = item.querySelector('.zg-bdg-text');
                        let bsrRankStr = rankBadgeEl ? rankBadgeEl.innerText.trim() : '';

                        vizExtractedProducts.push({ asin, img, title, price, rating, reviewCount, sales, isBestSeller: true, page: currentPage, keyword: `榜单:${queryVal} ${bsrRankStr}` });
                    });
                } else {
                    // 🌟 搜索页提取逻辑 (保持不变)
                    let items = doc.querySelectorAll('div[data-component-type="s-search-result"]');
                    items.forEach(item => {
                        let asin = item.getAttribute('data-asin');
                        if (!asin) return;
                        let isSponsored = item.innerHTML.includes('Sponsored') || item.innerHTML.includes('广告');
                        if (isSponsored) return;
                        
                        let img = item.querySelector('.s-image') ? item.querySelector('.s-image').src : '';
                        let titleEl = item.querySelector('h2 a span') || item.querySelector('h2');
                        let title = titleEl ? titleEl.innerText.trim() : '未知';
                        let priceWhole = item.querySelector('.a-price-whole') ? item.querySelector('.a-price-whole').innerText.replace(/[,.]/g, '') : '0';
                        let priceFraction = item.querySelector('.a-price-fraction') ? item.querySelector('.a-price-fraction').innerText : '00';
                        let price = parseFloat(`${priceWhole}.${priceFraction}`) || null;

                        let ratingMatch = item.innerHTML.match(/(\d[\.\d]*)\s*out of 5 stars/i);
                        let rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
                        let reviewNode = item.querySelector('span.a-size-base.s-underline-text');
                        let reviewCount = reviewNode ? parseInt(reviewNode.innerText.replace(/,/g, '')) : 0;

                        let salesText = item.querySelector('.a-size-base.a-color-secondary') ? item.querySelector('.a-size-base.a-color-secondary').innerText : '';
                        let isBestSeller = item.innerHTML.includes('Best Seller');

                        vizExtractedProducts.push({ asin, img, title, price, rating, reviewCount, sales: salesText.includes('bought')?salesText:'', isBestSeller, page: currentPage, keyword: queryVal });
                    });
                }
            } catch (e) { console.error(e); }
            await sleep(getIntRandom(2, 4) * 1000);
        }
        await sleep(getIntRandom(1, 3) * 1000);
    }
}

async function executeVizRun() {
    let btn = document.getElementById('visualizerBtn');
    btn.disabled = true;
    let threadVal = parseInt(document.getElementById('threadInput').value);
    let maxVisConcurrent = (threadVal >= 1 && threadVal <= 10) ? threadVal : 2; 

    try {
        let workers = [];
        for (let i = 0; i < maxVisConcurrent; i++) {
            workers.push(visWorker(i, btn));
            await sleep(800); 
        }
        await Promise.all(workers);

        if (isVisRunning) { 
            saveVizState(true); 
            if (vizExtractedProducts.length > 0) {
                await chrome.storage.local.set({ visualizerData: { keyword: "混合并发大盘", items: vizExtractedProducts } });
                chrome.tabs.create({ url: chrome.runtime.getURL("visualizer.html") });
            }
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "👁️ 选品大盘分析";
    }
}

async function startVisualizer() {
    let asins = tsvToArray(document.getElementById('asinInput').value).map(a => a.toUpperCase());
    let kws = tsvToArray(document.getElementById('keywordInput').value);
    let nodes = tsvToArray(document.getElementById('nodeInput').value).map(n => 'NODE:' + n.trim());
    
    vizAllSearchTerms = [...asins, ...kws, ...nodes];
    if (vizAllSearchTerms.length === 0) return alert("请至少输入一个查询目标！");
    
    vizStartP = parseInt(document.getElementById('startPageInput').value);
    vizEndP = parseInt(document.getElementById('endPageInput').value);
    vizTermIndex = 0;
    vizExtractedProducts = [];
    isVisRunning = true;
    document.getElementById('resumeVizBtn').style.display = 'none';

    log(`<span class="highlight">==== 全新大盘视图分析开始 (包含榜单调研) ====</span>`);
    await executeVizRun();
}

async function resumeVisualizer() {
    chrome.storage.local.get(['blkVizState'], async (res) => {
        if (res.blkVizState) {
            vizAllSearchTerms = res.blkVizState.terms;
            vizTermIndex = res.blkVizState.index;
            vizExtractedProducts = res.blkVizState.products;
            vizStartP = res.blkVizState.startP;
            vizEndP = res.blkVizState.endP;
            isVisRunning = true;
            document.getElementById('resumeVizBtn').style.display = 'none';
            log(`<span class="highlight">==== 🔌 大盘进度已恢复，继续抓取 ====</span>`);
            await executeVizRun();
        }
    });
}

function initTask(mode) {
    failedKeywords.clear(); 
    document.getElementById('resumeProgressBtn').style.display = 'none';
    
    queueTargetAsins = tsvToArray(document.getElementById('asinInput').value).map(a => {
        let clean = a.toUpperCase();
        return clean.startsWith('BO') ? clean.replace(/^BO/, 'B0') : clean;
    });
    queueKeywords = tsvToArray(document.getElementById('keywordInput').value);
    queueIndex = 0;
    taskMode = mode;

    if (queueTargetAsins.length === 0 || queueKeywords.length === 0) return alert("请确保同时输入了 ASIN 和 关键词！");
    
    let startP = parseInt(document.getElementById('startPageInput').value);
    let endP = parseInt(document.getElementById('endPageInput').value);
    if(startP > endP) return alert("起始页不能大于结束页！");

    finalResultsTable = taskMode === 'RANK' ? [rankHeaders] : [indexHeaders]; 
    punishMode = false; 

    // 【修复1】动态读取页面上的线程数输入框
    let threadVal = parseInt(document.getElementById('threadInput').value);
    maxConcurrent = (threadVal >= 1 && threadVal <= 10) ? threadVal : 2; 
    
    document.getElementById('logArea').innerHTML = `<span class="highlight">==== 全新 ${taskMode} 任务初始化，启用 V10.0 并发引擎 (${maxConcurrent}线程) ====</span>\n<br>`;
    startEngineMaster();
}

function initUiLogic() {
    document.getElementById('startRankBtn').addEventListener('click', () => initTask('RANK'));
    document.getElementById('startIndexBtn').addEventListener('click', () => initTask('INDEX'));
    
    document.getElementById('visualizerBtn').addEventListener('click', startVisualizer);
    // 【新增绑定】绑定大盘恢复按钮事件
    document.getElementById('resumeVizBtn').addEventListener('click', resumeVisualizer);
    
    document.getElementById('retryBtn').addEventListener('click', retryErrorTasks);
    document.getElementById('resumeProgressBtn').addEventListener('click', resumeTask);
    document.getElementById('exportBtn').addEventListener('click', exportResultsToExcel);
    
    let trackerBtn = document.getElementById('openTrackerBtn');
    if(trackerBtn) {
        trackerBtn.addEventListener('click', () => {
            let trackerUrl = chrome.runtime.getURL("tracker.html");
            chrome.windows.create({ url: trackerUrl, incognito: true, type: "normal" }, (window) => {
                if (chrome.runtime.lastError) {
                    alert("⚠️ 无法开启无痕模式！\n\n为了保证数据不被污染，追踪系统必须在无痕模式下运行。\n请按以下步骤操作：\n1. 在浏览器右上角点击扩展图标，选择【管理扩展程序】\n2. 找到本插件，点击【详细信息】\n3. 打开【在无痕模式下启用】的开关！\n4. 回来重新点击按钮。");
                }
            });
        });
    }
}

// ==========================================
// 🚀 系统启动入口
// ==========================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLoginStatus);
} else {
    checkLoginStatus();
}