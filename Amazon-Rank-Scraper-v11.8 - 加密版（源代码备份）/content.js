// ==========================================
// 1. 新增：模拟真人平滑滚动到底部的函数
// ==========================================
async function autoScrollToBottom() {
    return new Promise((resolve) => {
        let distance = 300; // 每次滚动的像素跨度
        let delay = 200;    // 每次滚动的停顿时间 (毫秒)
        
        let timer = setInterval(() => {
            // 获取当前页面的总高度和已滚动的高度
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            
            // 如果滚到了底部（或者接近底部）
            if ((window.innerHeight + window.scrollY) >= scrollHeight - 100) {
                clearInterval(timer);
                // 到底后再稍微等个 1 秒，让最后的图片和底层代码完全加载出来
                setTimeout(resolve, 1000); 
            }
        }, delay);
    });
}

// ==========================================
// 2. 你原有的核心数据提取逻辑 (完全没动你的核心逻辑)
// ==========================================
function extractPageOrganicData() {
    // 1. 验证码检测
    const hasCaptcha = document.body.innerHTML.includes('puis-captcha-card') || 
                        document.title.includes('Captcha') || 
                        document.body.innerHTML.includes('Enter the characters you see below');
    if (hasCaptcha) return { error: "CAPTCHA_DETECTED" };

    // 2. 尝试获取商品列表
    let items = document.querySelectorAll('div[data-component-type="s-search-result"]');
    if (items.length === 0) {
        let allAsinDivs = document.querySelectorAll('div[data-asin]');
        items = Array.from(allAsinDivs).filter(div => div.getAttribute('data-asin').length > 5);
    }

    let purePageAsins = [];
    let acAsin = "";

    // 3. 遍历提取与过滤
    items.forEach(item => {
        let asin = item.getAttribute('data-asin');
        if (!asin || asin.trim() === '') return; 

        let isSponsored = false;

        // 【优化点】：精准定位广告标识
        let sponsoredLabel = item.querySelector('.puis-sponsored-label-text, .s-sponsored-label-info-icon, [aria-label="View Sponsored information"], .s-label-popover');
        let isAdHolder = item.classList.contains('AdHolder') || item.closest('.AdHolder');
        let topSection = item.querySelector('.puis-status-badge-container') || item;
        let visibleText = topSection.innerText || "";
        
        if (sponsoredLabel || isAdHolder || visibleText.includes('Sponsored') || visibleText.includes('广告')) {
            isSponsored = true;
        }

        // 如果不是广告，才算作自然位
        if (!isSponsored) {
            purePageAsins.push(asin);
            
            // 识别 Amazon's Choice
            let htmlContent = item.innerHTML; 
            if (htmlContent.includes("Amazon's Choice") || htmlContent.includes("ac-badge")) {
                if(!acAsin) acAsin = asin;
            }
        }
    });

    // 4. 提取搜索结果总数
    let totalResultsStr = "未知";
    let infoBar = document.querySelector('span[data-component-type="s-result-info-bar"]');
    if (infoBar) {
        let text = infoBar.innerText.replace(/,/g, ''); 
        let match = text.match(/over\s+(\d+)\s+results/i) || text.match(/of\s+(\d+)\s+results/i);
        if (match && match[1]) {
            totalResultsStr = match[1];
        }
    }

    return {
        error: null,
        organicAsins: purePageAsins,
        acAsin: acAsin,
        totalResults: totalResultsStr
    };
}

// ==========================================
// 3. 执行入口：先滚到底部，再提取数据
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SCRAPING") {
        startScraping().then(data => {
            sendResponse(data);
        });
        return true; // 保持消息通道开启，等待异步响应
    }
});