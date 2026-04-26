let allProducts = [];
let activeFilters = { price: null, review: null, score: null };
// 核心：用于存储被选中的 ASIN 集合
let selectedAsinsSet = new Set(); 

const priceBuckets = [
    { label: "(0,10]", min: 0, max: 10 },
    { label: "(10,30]", min: 10.01, max: 30 },
    { label: "(30,50]", min: 30.01, max: 50 },
    { label: "(50,100]", min: 50.01, max: 100 },
    { label: "100+", min: 100.01, max: 99999 }
];
const reviewBuckets = [
    { label: "[0,100]", min: 0, max: 100 },
    { label: "(100,500]", min: 101, max: 500 },
    { label: "(500,1000]", min: 501, max: 1000 },
    { label: "(1000,5000]", min: 1001, max: 5000 },
    { label: "5000+", min: 5001, max: 9999999 }
];
const scoreBuckets = [
    { label: "[0,3]", min: 0, max: 3 },
    { label: "(3,4]", min: 3.1, max: 4 },
    { label: "(4,4.3]", min: 4.1, max: 4.3 },
    { label: "(4.3,4.6]", min: 4.31, max: 4.6 },
    { label: "4.6+", min: 4.61, max: 5 }
];

chrome.storage.local.get(['visualizerData'], function(result) {
    if (result.visualizerData) {
        document.getElementById('kwDisplay').innerText = `[ ${result.visualizerData.keyword} ]`;
        allProducts = result.visualizerData.items;
        document.getElementById('totalCount').innerText = allProducts.length;
        
        renderFilterPanel();
        applyFilters(); // 初始化时调用一次以应用去重逻辑
    } else {
        document.getElementById('productGrid').innerHTML = '<div class="empty-state">没有找到缓存数据，请在主控制台重新抓取。</div>';
    }
});

function renderFilterPanel() {
    renderBucketGroup('priceFilters', priceBuckets, p => p.price, 'price');
    renderBucketGroup('reviewFilters', reviewBuckets, p => p.reviewCount, 'review');
    renderBucketGroup('scoreFilters', scoreBuckets, p => p.rating, 'score');
}

function renderBucketGroup(containerId, buckets, valueExtractor, filterType) {
    let container = document.getElementById(containerId);
    let html = '';
    
    let maxCount = 0;
    buckets.forEach(b => {
        b.count = allProducts.filter(p => {
            let val = valueExtractor(p);
            return val !== null && val >= b.min && val <= b.max;
        }).length;
        if (b.count > maxCount) maxCount = b.count;
    });

    buckets.forEach((b, index) => {
        let widthPct = maxCount === 0 ? 0 : (b.count / maxCount) * 100;
        html += `
            <div class="filter-row">
                <div class="filter-label">${b.label}</div>
                <div class="filter-bar-container">
                    <div class="filter-bar" style="width: ${widthPct}%;"></div>
                </div>
                <div class="filter-count">${b.count}</div>
                <button class="filter-btn" data-type="${filterType}" data-index="${index}">选择</button>
            </div>
        `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let type = e.target.getAttribute('data-type');
            let idx = parseInt(e.target.getAttribute('data-index'));
            container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            if (activeFilters[type] === idx) {
                activeFilters[type] = null;
            } else {
                e.target.classList.add('active');
                activeFilters[type] = idx;
            }
            applyFilters();
        });
    });
}

function applyFilters() {
    // 获取去重开关状态
    let isDedupEnabled = document.getElementById('vizDedupToggle') ? document.getElementById('vizDedupToggle').checked : false;
    let seenAsins = new Set();

    let filtered = allProducts.filter(p => {
        // --- 核心去重逻辑 ---
        if (isDedupEnabled) {
            if (seenAsins.has(p.asin)) {
                return false; // 如果已经存在，过滤掉
            }
            seenAsins.add(p.asin); // 记录第一次出现的 ASIN
        }

        // --- 原有的区间过滤逻辑 ---
        let passPrice = true, passReview = true, passScore = true;
        if (activeFilters.price !== null) {
            let b = priceBuckets[activeFilters.price];
            passPrice = p.price !== null && p.price >= b.min && p.price <= b.max;
        }
        if (activeFilters.review !== null) {
            let b = reviewBuckets[activeFilters.review];
            passReview = p.reviewCount !== null && p.reviewCount >= b.min && p.reviewCount <= b.max;
        }
        if (activeFilters.score !== null) {
            let b = scoreBuckets[activeFilters.score];
            passScore = p.rating !== null && p.rating >= b.min && p.rating <= b.max;
        }
        return passPrice && passReview && passScore;
    });
    
    // 更新展示数量
    document.getElementById('totalCount').innerText = filtered.length;
    renderGrid(filtered);
}

// 监听去重开关的变化
let dedupToggle = document.getElementById('vizDedupToggle');
if (dedupToggle) {
    dedupToggle.addEventListener('change', () => {
        applyFilters();
    });
}

function renderGrid(products) {
    let grid = document.getElementById('productGrid');
    if (products.length === 0) {
        grid.innerHTML = '<div class="empty-state">没有符合该过滤条件的商品。</div>';
        return;
    }

    let html = '';
    products.forEach((p, index) => {
        let sameKwProducts = allProducts.filter(ap => ap.keyword === p.keyword);
        let realRank = sameKwProducts.findIndex(ap => ap.asin === p.asin) + 1;
        let priceStr = p.price ? `$${p.price.toFixed(2)}` : '价格未知';
        let bsTag = p.isBestSeller ? `<div class="bs-badge">Best Seller</div>` : '';
        let isSelectedClass = selectedAsinsSet.has(p.asin) ? 'selected' : '';

        let extraInfoHtml = '';
        if (p.finalPrice || p.bullets) {
            let fpDisplay = p.finalPrice ? `<div class="final-price-tag">成交价: ${p.finalPrice}</div>` : '';
            let bulletsDisplay = p.bullets ? `<div class="bullet-points"><ul>${p.bullets.slice(0,3).map(b => `<li>${b}</li>`).join('')}</ul></div>` : '';
            extraInfoHtml = fpDisplay + bulletsDisplay;
        }

        html += `
            <div class="product-card ${isSelectedClass}" data-asin="${p.asin}" id="card-${p.asin}">
                <div class="checkbox-box"></div>
                <div class="rank-badge">P${p.page} - #${realRank}</div>
                ${bsTag}
                <img src="${p.img}" class="product-img" onerror="this.src='https://via.placeholder.com/200?text=No+Image'">
                <div class="product-info">
                    <div class="title" title="${p.title}">${p.title}</div>
                    <div class="ratings">Ratings: ${p.reviewCount} (${p.rating})</div>
                    <div class="price">${priceStr}</div>
                    <div class="sales">${p.sales}</div>
                    <div class="asin">${p.asin}</div>
                    <div class="extra-detail-container" id="detail-${p.asin}">${extraInfoHtml}</div>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;

    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', function() {
            let clickedAsin = this.getAttribute('data-asin');
            if (selectedAsinsSet.has(clickedAsin)) {
                selectedAsinsSet.delete(clickedAsin);
                this.classList.remove('selected');
            } else {
                selectedAsinsSet.add(clickedAsin);
                this.classList.add('selected');
            }
        });
    });
}

// ================= 全新：底部控制台交互逻辑 =================

// 1. 重置按钮
document.getElementById('resetBtn').addEventListener('click', () => {
    activeFilters = { price: null, review: null, score: null };
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    applyFilters(); // 调用 applyFilters 而不是 renderGrid，保证去重依然生效
});

// 2. 全选当前视图中的商品
document.getElementById('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.product-card').forEach(card => {
        let asin = card.getAttribute('data-asin');
        selectedAsinsSet.add(asin);
        card.classList.add('selected');
    });
});

// 3. 反选当前视图中的商品
document.getElementById('invertBtn').addEventListener('click', () => {
    document.querySelectorAll('.product-card').forEach(card => {
        let asin = card.getAttribute('data-asin');
        if (selectedAsinsSet.has(asin)) {
            selectedAsinsSet.delete(asin);
            card.classList.remove('selected');
        } else {
            selectedAsinsSet.add(asin);
            card.classList.add('selected');
        }
    });
});

// 4. 获取选中的 ASIN 放入输入框
document.getElementById('extractBtn').addEventListener('click', () => {
    if(selectedAsinsSet.size === 0) {
        return alert("请先在下方点击商品卡片进行勾选！");
    }
    let asinsArray = Array.from(selectedAsinsSet);
    document.getElementById('asinOutputBox').value = asinsArray.join('\n');
});

// 5. 导出已勾选商品的数据表格
// =========================================================
// 🚀 新增：深度抓取详情引擎 (真实成交价 + 五点描述)
// =========================================================
const fetchOptions = {
    headers: { 
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8', 
        'User-Agent': navigator.userAgent 
    }
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

let isDeepFetching = false;

document.getElementById('deepFetchBtn').addEventListener('click', async function() {
    if (isDeepFetching) return alert("抓取任务正在进行中，请耐心等待！");
    
    // 🌟 逻辑修改 1：只针对选中的 ASIN 进行抓取
    if (selectedAsinsSet.size === 0) {
        return alert("⚠️ 请先在下方视图中勾选需要深度抓取的商品！");
    }

    let asinsToFetch = Array.from(selectedAsinsSet);
    
    // 🌟 逻辑修改 2：动态读取用户设置的并发线程数
    let threadCount = parseInt(document.getElementById('deepFetchThreadInput').value);
    if (isNaN(threadCount) || threadCount < 1) threadCount = 1;
    if (threadCount > 10) threadCount = 10; // 安全上限保护
    
    if(!confirm(`⚠️ 即将开始深度抓取选中的 ${asinsToFetch.length} 个商品详情。\n\n当前设置并发线程：${threadCount}\n\n抓取期间请勿关闭页面。是否继续？`)) {
        return;
    }

    isDeepFetching = true;
    let btn = this;
    let originalText = btn.innerText;
    let completedCount = 0;
    
    btn.disabled = true; // 抓取时禁用按钮防误触
    
    // 标记所有被选中的卡片为加载中
    asinsToFetch.forEach(asin => {
        let container = document.getElementById(`detail-${asin}`);
        if(container) container.innerHTML = `<div class="loading-text">⏳ 正在嗅探详情页...</div>`;
    });

    // 独立 Worker 函数 (核心提取逻辑保持不变)
    async function detailWorker(queue) {
        while (queue.length > 0 && isDeepFetching) {
            let asin = queue.shift();
            try {
                let response = await fetch(`https://www.amazon.com/dp/${asin}?th=1&psc=1`, fetchOptions);
                if (response.status === 503) throw new Error("风控503");
                let htmlText = await response.text();
                if (htmlText.includes('Type the characters you see')) throw new Error("验证码");

                const doc = new DOMParser().parseFromString(htmlText, "text/html");
                let extractText = (selector) => { let el = doc.querySelector(selector); return el ? el.innerText.trim() : '无'; };
                let centerText = (doc.querySelector('#centerCol') || doc.body).innerText;

                let mainPrice = extractText('.a-price .a-offscreen');
                if (mainPrice === '无') {
                    let w = extractText('.a-price-whole'), f = extractText('.a-price-fraction');
                    if (w !== '无') mainPrice = '$' + w.replace('.', '') + (f !== '无' ? f : '00');
                }

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
                    let m = centerText.match(/(?:Apply|Save)\s*(?:an extra\s*)?(\$[\d\.]+|\d+%)\s*(?:coupon|at checkout|with coupon)/i);
                    if (m) coupon = m[1];
                }

                let finalPrice = mainPrice !== '无' ? mainPrice : '缺货/隐藏';
                if (coupon !== '无' && mainPrice !== '无') {
                    let pNum = parseFloat(mainPrice.replace(/[^0-9.]/g, ''));
                    if (!isNaN(pNum)) {
                        let pctMatch = coupon.match(/(\d+)%/); 
                        let amtMatch = coupon.match(/\$(\d+(\.\d+)?)/); 
                        if (pctMatch) finalPrice = '$' + (pNum * (1 - parseFloat(pctMatch[1])/100)).toFixed(2);
                        else if (amtMatch) finalPrice = '$' + Math.max(0, pNum - parseFloat(amtMatch[1])).toFixed(2);
                    }
                }

                let bullets = [];
                let bulletNodes = doc.querySelectorAll('#feature-bullets ul li span.a-list-item');
                bulletNodes.forEach(node => {
                    let text = node.innerText.trim();
                    if(text && text.length > 5 && !text.includes('Make sure this fits')) bullets.push(text);
                });
                if(bullets.length === 0) bullets.push("无五点描述或结构不兼容");

                let targetProduct = allProducts.find(p => p.asin === asin);
                if (targetProduct) {
                    targetProduct.finalPrice = finalPrice;
                    targetProduct.bullets = bullets;
                }

                let container = document.getElementById(`detail-${asin}`);
                if (container) {
                    container.innerHTML = `
                        <div class="final-price-tag">成交价: ${finalPrice} ${coupon !== '无' ? `(含${coupon})` : ''}</div>
                        <div class="bullet-points"><ul>${bullets.slice(0,3).map(b => `<li>${b}</li>`).join('')}${bullets.length>3 ? '<li>...</li>':''}</ul></div>
                    `;
                }

            } catch (err) {
                let container = document.getElementById(`detail-${asin}`);
                if(container) container.innerHTML = `<span style="color:red;font-size:12px;">❌ 抓取失败: ${err.message}</span>`;
            }

            completedCount++;
            btn.innerText = `⚡ 抓取中 (${completedCount}/${asinsToFetch.length}) ...`;
            await sleep(randomDelay(2000, 4000)); 
        }
    }

    let queue = [...asinsToFetch];
    let workers = [];
    // 根据用户设置的线程数启动对应数量的 Worker
    for(let i=0; i<threadCount; i++) workers.push(detailWorker(queue));
    
    await Promise.all(workers);
    
    isDeepFetching = false;
    btn.disabled = false;
    btn.innerText = originalText;
    alert(`🎉 深度抓取完成！共处理了 ${asinsToFetch.length} 个选中商品。导出 CSV 将包含这些最新数据。`);
});

// 覆盖导出 CSV 逻辑
document.getElementById('downloadCsvBtn').addEventListener('click', () => {
    if(selectedAsinsSet.size === 0) return alert("请先勾选商品！");
    let selectedProducts = allProducts.filter(p => selectedAsinsSet.has(p.asin));
    let htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr style="background-color: #f1f5f9; font-weight: bold;"><th>商品主图</th><th>ASIN</th><th>来源关键词</th><th>页码</th><th>排名</th><th>面价</th><th style="background-color: #d1fae5;">成交价</th><th>评分</th><th>Rating数</th><th>销量标识</th><th>商品标题</th><th style="background-color: #e0e7ff;">五点描述</th></tr></thead><tbody>`;
    selectedProducts.forEach(p => {
        let sameKwProducts = allProducts.filter(ap => ap.keyword === p.keyword);
        let realRank = sameKwProducts.findIndex(ap => ap.asin === p.asin) + 1;
        let bulletStr = p.bullets ? p.bullets.join(' \n\n ') : '未抓取';
        htmlContent += `<tr><td style="width:100px; height:100px; text-align:center;"><img src="${p.img}" width="80" height="80"></td><td style="mso-number-format:'\\@';">${p.asin}</td><td>${p.keyword || '未知'}</td><td style="text-align:center;">${p.page}</td><td style="text-align:center;">${realRank}</td><td>${p.price || 0}</td><td style="font-weight:bold; color:red;">${p.finalPrice || '未抓取'}</td><td>${p.rating}</td><td>${p.reviewCount}</td><td>${p.sales}</td><td>${p.title.replace(/"/g, "&quot;")}</td><td style="white-space: pre-wrap;">${bulletStr.replace(/"/g, "&quot;")}</td></tr>`;
    });
    htmlContent += `</tbody></table></body></html>`;
    let base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));
    let link = document.createElement("a");
    link.href = 'data:application/vnd.ms-excel;base64,' + base64;
    link.download = `BLK选品深度数据_${new Date().getTime()}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});