chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ 
        url: chrome.runtime.getURL("dashboard.html"),
        windowId: tab.windowId // 关键修改：锁定当前触发的窗口
    });
});