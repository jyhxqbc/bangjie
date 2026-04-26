# Amazon-Rank-Scraper v11.0 源码详细分析

## 一、项目定位

这是一套基于 Chrome Extension Manifest V3 的亚马逊分析插件，定位不是单一抓取脚本，而是一个本地化运营分析工作台。它主要覆盖 4 类能力：

- 主控工作台：关键词排名占比、收录检测、选品大盘分析
- 跟踪系统：ASIN 排名跟踪、详情快照跟踪、小时级巡航
- 页面内抓取桥接：在 Amazon 搜索页、详情页执行 DOM 提取
- 本地授权系统：离线登录、管理员发卡、会话持久化

从源码结构看，这套插件核心是“本地前端 + Chrome Storage + fetch/DOMParser + 多任务调度”，没有真正的后端服务。

---

## 二、目录结构

源码目录包含以下文件：

- `manifest.json`
- `background.js`
- `content.js`
- `dashboard.html`
- `dashboard.js`
- `tracker.html`
- `tracker.js`
- `visualizer.html`
- `visualizer.js`
- `echarts.min.js`
- `遇到这个问题需要找作者更新插件.txt`

模块关系如下：

1. `background.js`
   监听扩展图标点击，打开 `dashboard.html`
2. `dashboard.html + dashboard.js`
   主工作台，负责登录、发卡、排名占比、收录诊断、选品大盘分析
3. `tracker.html + tracker.js`
   持久跟踪中心，负责三大跟踪功能
4. `visualizer.html + visualizer.js`
   选品可视化结果页
5. `content.js`
   注入 Amazon 页面，负责页面滚动和页面内抓取
6. `echarts.min.js`
   趋势图第三方依赖

---

## 三、Manifest 分析

`manifest.json` 关键点：

- `manifest_version: 3`
- `background.service_worker = background.js`
- `permissions`
  - `storage`
  - `tabs`
  - `unlimitedStorage`
  - `scripting`
- `host_permissions`
  - 多个 Amazon 站点域名
- `content_scripts`
  - 在 Amazon 页面自动注入 `content.js`

说明：

- 没有 `cookies` 权限
- 没有远程接口域名白名单
- 说明它不是直接读浏览器 Cookie 内容，而是依赖页面返回结果

---

## 四、整体架构与流程体系

### 1. 启动链

```text
点击扩展图标
-> background.js
-> 打开 dashboard.html
-> dashboard.js 启动
-> 检查登录态 blkSession
-> 进入主工作台
```

### 2. 主工作台流程

```text
用户输入 ASIN / 关键词 / Node
-> 选择站点、页码、延迟、线程数
-> dashboard.js 创建任务队列
-> fetch Amazon 搜索页
-> DOMParser 提取自然位 / AC / 收录结果
-> 输出表格
-> 可导出 Excel
-> 可保存断点并恢复
```

### 3. 选品大盘流程

```text
dashboard.js 生成 visualizerData
-> 打开 visualizer.html
-> visualizer.js 读取 visualizerData
-> 按价格/评分/评论数分桶
-> 卡片展示商品
-> 可选中商品并深度抓取详情
-> 导出深度 CSV
```

### 4. 跟踪系统流程

```text
打开 tracker.html
-> tracker.js 读取 blkTrackerData
-> 管理 rankTasks / detailTasks / hourlyTasks
-> 执行排名跟踪 / 详情快照 / 小时巡航
-> 更新表格、卡片、趋势图
-> 导出 Excel / JSON
```

### 5. 数据持久化体系

核心都存放在 `chrome.storage.local`：

- `blkSession`
- `blkAccountsRecord`
- `blkEngineState`
- `blkVizState`
- `visualizerData`
- `blkTrackerData`

这说明项目是“纯本地状态机”，浏览器本地存储就是数据库。

---

## 五、background.js 分析

文件职责：

- 扩展入口
- 打开主面板

源码：

```js
chrome.action.onClicked.addListener((tab) => {
    chrome.tabs.create({ 
        url: chrome.runtime.getURL("dashboard.html"),
        windowId: tab.windowId
    });
});
```

### 函数/逻辑说明

严格说这里没有命名函数，只有一个点击监听器。

#### `chrome.action.onClicked.addListener(...)`

作用：

- 用户点击扩展图标时触发
- 在当前窗口打开 `dashboard.html`

特点：

- 没有打开外部站点
- 没有复杂初始化逻辑
- 是整个扩展的入口壳

优化建议：

- 可以改成 `chrome.windows.create`，把工作台独立成固定窗口
- 可以增加“如果已打开则聚焦现有面板”的逻辑

---

## 六、content.js 分析

文件职责：

- 注入 Amazon 页面
- 执行页面内滚动
- 执行搜索结果页 DOM 提取
- 响应主控页消息

### 1. `autoScrollToBottom()`

作用：

- 模拟用户平滑滚动到页面底部
- 给懒加载图片、底部模块留出加载时间

流程：

1. 每次向下滚动固定距离
2. 间隔固定毫秒
3. 接近底部后停止
4. 再额外等待 1 秒

用途：

- 为页面内抓取创造更完整的 DOM

### 2. `extractPageOrganicData()`

作用：

- 从当前 Amazon 搜索页面提取自然位商品信息

主要步骤：

1. 检测验证码
2. 获取搜索结果项
3. 区分广告位与自然位
4. 提取自然位 ASIN 列表
5. 识别 Amazon's Choice ASIN
6. 解析总结果数

返回结构：

```js
{
  error,
  organicAsins,
  acAsin,
  totalResults
}
```

关键点：

- 广告识别依赖：
  - `.puis-sponsored-label-text`
  - `.s-sponsored-label-info-icon`
  - `AdHolder`
  - `Sponsored` 文本
- 自然位只记录非广告商品

### 3. `chrome.runtime.onMessage.addListener(...)`

作用：

- 等待来自主控页或后台页的命令
- 当收到 `START_SCRAPING` 时，启动抓取流程

说明：

- 源码片段里消息入口明显存在
- `startScraping()` 应该位于文件剩余部分或原始逻辑中作为封装入口
- 从当前代码结构看，它的职责就是：
  - 先滚动
  - 再提取
  - 最后回传

### content.js 总结

它是一个“被动执行器”，不管理业务状态，只做三件事：

- 滚动页面
- 提取 DOM
- 返回结果

优化建议：

- 广告识别器可以再抽象成单独函数，提升兼容性
- 总结果数解析可以兼容更多语言站点
- 验证码检测条件可以扩展到更多站点变体

---

## 七、dashboard.html / dashboard.js 分析

这是整个项目的核心模块。

职责包括：

- 登录与授权
- 管理员发卡
- 关键词排名占比
- 收录检测
- 可视化大盘分析
- 环境检测
- 断点恢复
- 导出 Excel

## 7.1 授权系统模块

### 常量

- `ADMIN_USER = "blake"`
- `ADMIN_PASS = "blake@123"`
- `SECRET_SALT = "BLK_SUPER_v11.0_KEY!@#*"`

说明：

- 管理员账号密码硬编码在前端
- 普通用户密码是通过到期时间和盐值签名生成的离线授权串

### `generateRandomStr(length)`

作用：

- 生成随机用户名后缀

用途：

- 管理员发卡时自动生成账号

### `hashString(str)`

作用：

- 生成简易签名

用途：

- 普通用户登录验证
- 管理员生成授权密码

### `checkLoginStatus()`

作用：

- 启动时读取 `blkSession`
- 决定是直接进入工作台还是显示登录弹窗

### `showAuthError(msg)`

作用：

- 在登录弹窗显示错误

### `unlockApp(username, expireDate)`

作用：

- 隐藏登录弹窗
- 显示主界面
- 初始化业务逻辑
- 检查是否有未完成任务

调用：

- `initUiLogic()`
- `checkSavedProgress()`

### 登录按钮点击事件

逻辑分两条：

1. 管理员登录
   - 直接比对 `ADMIN_USER/ADMIN_PASS`
2. 普通用户登录
   - Base64 解码
   - 解析 `expireDate|signature`
   - 重算 `hashString(username + expireDate + SECRET_SALT)`
   - 校验是否过期

### `initAdminPanel()`

作用：

- 初始化管理员日期字段

### `updateEndDate()`

作用：

- 根据开始日期和授权天数计算结束日期

### `updateDuration()`

作用：

- 根据开始日期和结束日期反算授权天数

### 创建账号按钮事件

逻辑：

1. 读取用户名
2. 读取到期日期
3. 生成签名
4. 拼接 `到期日|签名`
5. Base64 编码
6. 保存到 `blkAccountsRecord`

### `refreshAdminAccountList()`

作用：

- 刷新本地发卡记录展示框

### 导出发卡记录按钮事件

作用：

- 把 `blkAccountsRecord` 导出成 CSV

### 清空发卡记录按钮事件

作用：

- 清掉本地历史记录

注意：

- 只是删本地记录，不是真正吊销客户权限

### 站长免密进入按钮事件

作用：

- 直接写入管理员 `blkSession`
- 刷新后进入工作台

### 退出按钮事件

作用：

- 删除 `blkSession`
- 返回登录页

## 7.2 主抓取引擎状态变量

关键全局状态：

- `queueKeywords`
- `queueTargetAsins`
- `queueIndex`
- `isTaskRunning`
- `taskMode`
- `failedKeywords`
- `finalResultsTable`
- `maxConcurrent`
- `activeWorkers`
- `punishMode`

这说明主引擎是“任务队列 + 并发 worker + 风控降级”的模型。

### 工具函数

#### `sleep(ms)`

延迟等待

#### `tsvToArray(tsv)`

把多行输入转成数组

#### `getIntRandom(min, max)`

生成随机整数，用于错峰延时

#### `log(msg)`

往控制台日志区输出 HTML 格式日志

#### `updateUiStatus(text)`

更新状态文字

## 7.3 断点恢复模块

### `saveState(isFinished = false)`

作用：

- 保存当前任务快照到 `blkEngineState`

保存字段：

- 关键词队列
- ASIN 队列
- 当前索引
- 模式
- 当前结果表
- 失败词集合
- 页码范围
- `punishMode`
- 是否完成

### `checkSavedProgress()`

作用：

- 启动时检查是否有未完成任务
- 包括：
  - 普通任务 `blkEngineState`
  - 大盘任务 `blkVizState`

结果：

- 显示恢复按钮
- 提示用户可恢复

### `resumeTask()`

作用：

- 从 `blkEngineState` 恢复普通任务
- 重新设置页码、线程数、失败集合、模式
- 继续 `startEngineMaster()`

## 7.4 搜索页解析核心

### `extractDataFromVirtualDom(htmlString)`

作用：

- 把 `fetch` 返回的搜索页 HTML 转成可分析 DOM

职责：

- 检测验证码
- 识别自然位商品
- 识别 Amazon's Choice
- 提取总结果数

这是主工作台排名和占比能力的底层解析核心。

## 7.5 主调度器

### `startEngineMaster()`

作用：

- 主并发调度器

流程：

1. 打开任务运行状态
2. 根据输入框动态读取线程数
3. 从 `queueKeywords` 分发关键词任务
4. 调用 `processWorkerTask(kw, workerId)`
5. 每轮保存状态
6. 所有 worker 结束后收尾

关键特点：

- 动态并发
- 错峰启动
- 遇风控后可降级

## 7.6 单任务处理器

### `processWorkerTask(kw, workerId)`

这是 `dashboard.js` 的核心函数。

它按 `taskMode` 分成两条逻辑：

### A. `RANK` 模式

目标：

- 统计目标 ASIN 集合在关键词搜索结果中的占位情况

流程：

1. 读取起始页和结束页
2. 逐页请求搜索结果
3. 调用 `extractDataFromVirtualDom()`
4. 如果遇验证码：
   - 停止引擎
   - 开启 `punishMode`
   - 记录失败词
   - 回退 `queueIndex`
   - 显示恢复按钮
5. 统计自然位总量
6. 统计目标 ASIN 在前 3、前 8、前 16、总自然位中的占比
7. 记录首屏 AC 产品
8. 写入结果表

输出字段包括：

- 关键词
- 查询深度
- 搜索结果数
- 平均每页自然位商品数
- 前 3 占位
- 前 8 占位
- 前 16 占位
- 总占位
- 自然位 Top3 ASIN
- Amazon's Choice
- 时间戳

### B. `INDEX` 模式

目标：

- 判断目标 ASIN 是否被某关键词相关搜索命中

流程：

1. 把 `asin + keyword` 拼成搜索词
2. 搜索页面
3. 检查返回页面中是否出现 ASIN
4. 记录命中数量和命中比例

这是一个“收录/索引诊断”逻辑。

### 任务尾部延迟

无论哪种模式，任务尾部都会：

- 根据 `baseDelayInput` 做随机等待
- `punishMode` 下延迟加倍

## 7.7 错误重试与导出

### `retryErrorTasks()`

作用：

- 只重跑失败关键词

步骤：

1. 取出 `failedKeywords`
2. 重置队列
3. 清空失败集合
4. 关闭 `punishMode`
5. 恢复正常线程数
6. 重启调度器

### `exportResultsToExcel()`

作用：

- 导出普通工作台结果为 Excel

特点：

- 未完成队列也会标出
- 失败词也会标出

## 7.8 可视化大盘任务模块

### 状态变量

- `vizAllSearchTerms`
- `vizTermIndex`
- `vizExtractedProducts`
- `isVisRunning`
- `vizStartP`
- `vizEndP`

### `saveVizState(isFinished = false)`

作用：

- 保存大盘抓取进度到 `blkVizState`

### `visWorker(workerId, btn)`

作用：

- 可视化任务的 worker

支持 3 类输入：

- `ASIN:`
- 普通关键词
- `NODE:` 榜单类目节点

逻辑：

- 对于 `NODE:` 走榜单 URL
- 对于普通词走搜索页 URL
- 提取商品卡片信息

提取字段：

- ASIN
- 主图
- 标题
- 价格
- 评分
- 评论数
- 月销文本
- Best Seller 标记
- 榜单标签

### `executeVizRun()`

作用：

- 按线程数启动多个 `visWorker`
- 汇总全部结果
- 写入 `visualizerData`
- 打开 `visualizer.html`

### `startVisualizer()`

作用：

- 读取主控页输入
- 混合生成大盘查询目标
- 初始化状态
- 启动可视化抓取

### `resumeVisualizer()`

作用：

- 从 `blkVizState` 恢复大盘抓取

## 7.9 主任务入口

### `initTask(mode)`

作用：

- 初始化普通任务

流程：

1. 清空失败集合
2. 读取 ASIN 输入
3. 读取关键词输入
4. 检查页码区间
5. 初始化结果表头
6. 读取线程数
7. 输出初始化日志
8. 启动 `startEngineMaster()`

### `initUiLogic()`

作用：

- 绑定主工作台所有核心按钮

包括：

- 开始占比查询
- 开始收录诊断
- 启动可视化
- 恢复大盘任务
- 重跑失败任务
- 恢复普通任务
- 导出 Excel
- 打开跟踪系统
- 站点切换环境检测

## 7.10 环境检测模块

### `checkEnvironmentStatus()`

作用：

- 检测无痕模式
- 检测当前 Amazon 首页显示的前台邮编/地址状态

流程：

1. 检查 `chrome.extension.inIncognitoContext`
2. `fetch https://{domain}/`
3. 解析 `#glow-ingress-line2`
4. 判断是否仍是默认配送地址或中国地址

意义：

- 不是直接读 Cookie
- 而是通过页面显示状态来判断环境是否已切到目标市场

## 7.11 dashboard 模块总结

`dashboard.js` 可以拆成 5 层：

1. 授权与会话层
2. 管理员发卡层
3. 普通抓取引擎层
4. 可视化大盘抓取层
5. 状态恢复和导出层

如果后续要优化，优先应该看这几个点：

- `processWorkerTask()`
- `extractDataFromVirtualDom()`
- `visWorker()`
- `saveState()/resumeTask()`
- `checkEnvironmentStatus()`

---

## 八、tracker.html / tracker.js 分析

`tracker.js` 是长期跟踪中心，复杂度仅次于 `dashboard.js`。

核心能力有三类：

- 功能1：关键词自然排名跟踪
- 功能2：ASIN 详情快照监控
- 功能3：小时级分时巡航

## 8.1 初始化与基础工具

### 顶部 Tab 切换监听

作用：

- 切换三个功能面板显示

### `getTodayStr()`

作用：

- 返回 `MM-DD` 格式日期

### `getLast5Days()`

作用：

- 返回最近 5 天日期列表

### `tsvToArray(tsv)`

多行文本转数组

### `sleep(ms)`

延迟等待

### `randomDelay(min, max)`

随机延迟

## 8.2 数据结构

### 全局 `trackerData`

结构：

```js
{
  rankTasks: [],
  detailTasks: {},
  hourlyTasks: [],
  hourlySettings: {
    runHours: [0..23]
  }
}
```

说明：

- `rankTasks`
  关键词排名任务
- `detailTasks`
  ASIN 详情快照任务
- `hourlyTasks`
  小时巡航任务
- `hourlySettings`
  允许执行的小时配置

### `loadTrackerData()`

作用：

- 从 `blkTrackerData` 加载全部跟踪任务
- 兼容老数据结构
- 补全默认字段
- 最后刷新表格

### `saveTrackerData()`

作用：

- 把 `trackerData` 写回 `chrome.storage.local`

## 8.3 页面初始化与通用事件

### DOMContentLoaded 主初始化

负责：

- 加载数据
- 绑定表头排序
- 绑定全选框
- 绑定运行按钮

### `document.addEventListener('change', ...)`

作用：

- 监听备注输入框变更
- 实时写入 rank/detail 数据

### `exportTableToExcel(tableId, filename)`

作用：

- 把任意表格导出为 Excel

处理：

- 去掉复选框列
- 把 input 转纯文本
- 把图片转占位文字

## 8.4 JSON 备份与恢复

### 导出 JSON 链

相关监听：

- `exportJsonLnk`
- `closeExportModalBtn`
- `exportCbAll`
- `confirmExportBtn`

作用：

- 按需选择导出模块
- 支持：
  - 排名任务
  - 详情任务
  - 小时任务

### 导入 JSON 链

相关监听：

- `importJsonLnk`
- `importJsonInput`

作用：

- 增量恢复 JSON 数据
- 不必清空全部旧数据

## 8.5 备注导入系统

### 导入弹窗相关监听

- `openRankImportModalBtn`
- `openImportModalBtn`
- `closeImportModalBtn`
- `confirmImportBtn`

### 作用

- 从 Excel 粘贴数据回填备注字段
- 兼容 rank 和 detail 两种模式

### `confirmImportBtn` 核心逻辑

流程：

1. 读取粘贴文本
2. 拆分表头
3. 自动识别：
   - ASIN 列
   - 日期列
   - 关键词列
   - 备注1/2/3
4. 匹配已有任务
5. 覆盖备注字段

---

## 8.6 排名跟踪模块

### `smartSort(a, b, field, asc)`

作用：

- 通用排序函数

### 添加排名任务按钮事件

作用：

- 创建 `rankTasks`

字段通常包括：

- `asin`
- `keyword`
- `siteCode`
- `domain`
- `history`
- 备注字段

### 排名搜索框监听

作用：

- 模糊搜索 ASIN/关键词

### 删除排名任务按钮

作用：

- 批量删除任务

### `renderRankTable()`

作用：

- 渲染排名任务表格

职责：

- 生成表头
- 平铺最近 5 天历史
- 站点过滤
- ASIN 过滤
- 搜索过滤
- 排序
- 渲染 tags

### `runRankEngine(btnEl)`

这是 tracker 的功能1核心。

目标：

- 跟踪某个 ASIN 在某关键词下的自然排名

流程：

1. 构造任务队列
2. 启动多个 `rankWorker`
3. 每个 worker 最多扫前 3 页
4. 逐页提取自然位排名
5. 找到后提前停止
6. 写入 `task.history[today]`

风控机制：

- 503 熔断
- CAPTCHA 熔断
- 触发 `globalEmergencyStop`

## 8.7 详情快照模块

### 添加详情任务按钮事件

作用：

- 把 ASIN 加入 `detailTasks`

### 详情搜索框监听

作用：

- 搜索详情任务

### 删除详情任务按钮

作用：

- 批量删除详情任务

### `renderDetailTable()`

作用：

- 渲染详情快照历史表

功能：

- 展示历史快照
- 标记变化字段
- 支持站点/ASIN筛选

### `runDetailEngine(btnEl)`

这是 tracker 的功能2核心。

目标：

- 跟踪商品详情页关键经营信息变化

抓取字段包括：

- 当前价格 `mainPrice`
- 原价/划线价 `basisPrice`
- Deal 状态
- Deal 折扣
- Coupon
- 券后成交价 `finalPrice`
- 运费 `shippingFee`
- 品牌 `brand`
- BuyBox
- 高退货标识
- 销量文案 `salesTag`
- 主图 `img`
- 一级类目与排名
- 二级类目与排名
- 备注 `r1/r2/r3`
- 状态 `status`

流程：

1. 请求详情页
2. 拦截 503/404/验证码
3. 用 DOMParser 解析 HTML
4. 从多个候选选择器里提取价格和优惠
5. 估算 coupon 后成交价
6. 提取品牌、运费、BuyBox、销量标签、类目排名
7. 写入 `history[today]`

这是整个项目里业务字段提取最复杂的一块。

---

## 8.8 小时级巡航模块

这是 V11 的核心升级功能之一。

### 状态变量

- `hourlyCruiseTimer`
- `isHourlyCruising`
- `lastRunHourStr`

### 添加小时任务按钮

作用：

- 往 `hourlyTasks` 新增任务

限制：

- 最多 5 个任务

### `renderHourPicker()`

作用：

- 渲染 24 小时开关面板

支持：

- 单小时开关
- 全选
- 清空

### `renderHourlyCards()`

作用：

- 卡片式展示小时巡航任务

每张卡片展示：

- 站点
- ASIN
- 关键词
- 最新抓取时间
- 自然位
- 广告位
- 开关状态

### `executeHourlyFetch()`

这是功能3核心。

目标：

- 对激活的小时任务做定时搜索结果巡航

流程：

1. 过滤出 `isActive` 任务
2. 逐个搜索关键词
3. 解析自然位排名和广告位排名
4. 写入：

```js
task.history[currentHourKey] = {
  organic,
  ad
}
```

5. 历史最多保留 72 个时间点

特点：

- 每个任务之间有较长延迟
- 更偏保守模式

### 趋势图模块

相关：

- `viewTrendChartBtn`
- `closeChartModalBtn`
- `echarts.init(...)`

作用：

- 把 `hourlyTasks.history` 渲染成折线图

系列包括：

- 自然位折线
- SP 广告位折线

### 自动巡航开关按钮

相关：

- `toggleHourlyEngineBtn`
- `forceRunHourlyBtn`

作用：

- 启动/停止整点巡航
- 在允许小时内自动触发 `executeHourlyFetch()`
- 也支持手动强制执行一次

## 8.9 tracker 模块总结

`tracker.js` 是一个本地化监控后台，不是普通列表页面脚本。

它负责：

1. 任务管理
2. 数据持久化
3. 数据渲染
4. 跟踪抓取
5. 趋势可视化
6. 备份恢复

优化优先级建议：

- `runDetailEngine()`
- `runRankEngine()`
- `executeHourlyFetch()`
- `renderDetailTable()`
- `loadTrackerData()` 兼容层

---

## 九、visualizer.html / visualizer.js 分析

这是选品视图与深度分析模块。

职责：

- 读取主控页生成的 `visualizerData`
- 商品可视化网格展示
- 区间筛选
- 去重
- 多选
- 深度详情抓取
- 导出深度表格

## 9.1 初始化状态

全局变量：

- `allProducts`
- `activeFilters`
- `selectedAsinsSet`

### `chrome.storage.local.get(['visualizerData'], ...)`

作用：

- 读取主控页生成的大盘数据
- 更新页面标题、数量
- 调用：
  - `renderFilterPanel()`
  - `applyFilters()`

## 9.2 过滤面板

### `renderFilterPanel()`

作用：

- 渲染三个分桶面板

### `renderBucketGroup(containerId, buckets, valueExtractor, filterType)`

作用：

- 渲染某一组过滤桶

支持维度：

- 价格
- 评论数
- 评分

### `applyFilters()`

作用：

- 根据当前分桶状态过滤商品
- 同时处理去重逻辑

特点：

- 去重开关开启时，后出现的重复 ASIN 会被过滤

## 9.3 商品网格

### 去重开关监听

作用：

- 切换去重状态后重算结果

### `renderGrid(products)`

作用：

- 渲染商品卡片

每张卡片展示：

- ASIN
- 关键词来源
- 页码/真实排名
- 主图
- 标题
- 价格
- 评分
- 评论数
- 销量标签
- 深度抓取后的成交价与五点

同时支持：

- 单卡点击选中
- 选中状态保存在 `selectedAsinsSet`

## 9.4 底部操作区

### `resetBtn`

重置所有筛选条件

### `selectAllBtn`

全选当前视图商品

### `invertBtn`

反选当前视图商品

### `extractBtn`

把选中 ASIN 输出到文本框

## 9.5 深度抓取模块

### 状态与工具

- `fetchOptions`
- `sleep(ms)`
- `randomDelay(min, max)`
- `isDeepFetching`

### `deepFetchBtn` 监听器

这是 visualizer 的核心功能。

目标：

- 对选中的商品做详情页深度抓取

流程：

1. 检查是否已有任务运行
2. 检查是否有选中商品
3. 读取线程数
4. 给每张卡片显示“抓取中”
5. 启动多个 `detailWorker(queue)`
6. 更新卡片详情区域

### 内部 `detailWorker(queue)`

抓取字段：

- 主价格
- Coupon
- 券后成交价 `finalPrice`
- 五点描述 `bullets`

逻辑：

1. 请求详情页
2. 拦截 503 和验证码
3. 提取价格
4. 提取 coupon
5. 估算券后价
6. 提取 feature bullets
7. 回写到 `allProducts`
8. 更新卡片详情区域

说明：

它不是和 tracker 共用详情解析器，而是做了一个更轻量的深度抓取版本，专门服务选品导出。

## 9.6 导出模块

### `downloadCsvBtn` 监听器

作用：

- 把选中商品导出成 `.xls`

导出字段包括：

- 主图
- ASIN
- 来源关键词
- 页码
- 排名
- 面价
- 成交价
- 评分
- 评论数
- 销量标签
- 标题
- 五点描述

## 9.7 visualizer 模块总结

`visualizer.js` 不是单纯展示页，而是“选品筛选 + 补充抓取 + 导出”的闭环工具。

适合优化的重点：

- 深度抓取和 tracker 共用解析逻辑
- 去重逻辑抽象化
- 商品字段模型统一

---

## 十、HTML 页面职责总结

### `dashboard.html`

职责：

- 登录页
- 主工作台表单
- 日志区
- 环境状态栏

### `tracker.html`

职责：

- 长期跟踪后台
- 三大功能 tab
- 趋势图 modal
- 导入导出 modal

### `visualizer.html`

职责：

- 商品卡片展示
- 过滤面板
- 深度抓取操作区
- 导出区

---

## 十一、非业务文件

### `echarts.min.js`

职责：

- 用于 `tracker.js` 小时级趋势图

说明：

- 第三方压缩库
- 不建议手工改

### `遇到这个问题需要找作者更新插件.txt`

职责：

- 用户侧提示说明
- 通常用于 Amazon 页面结构变更后提醒升级

---

## 十二、项目核心存储键总结

### `blkSession`

当前登录会话

### `blkAccountsRecord`

管理员本地发卡记录

### `blkEngineState`

主工作台普通任务断点

### `blkVizState`

大盘任务断点

### `visualizerData`

传给 `visualizer.html` 的大盘商品数据

### `blkTrackerData`

跟踪系统全部数据

---

## 十三、风控与反爬策略总结

这套项目没有真正高强度反爬绕过能力，更接近“保守型规避”。

它的策略包括：

- 检测验证码页
- 检测 503
- 随机延迟
- 错峰多线程
- 小时巡航严格限量
- 触发后熔断暂停
- 提供恢复按钮
- 强调无痕模式
- 强调目标国前台邮编必须正确

因此它的核心不是“骗过 Amazon”，而是“尽量降低被封风险并在出问题时恢复”。

---

## 十四、后续优化建议

如果你后面要做 V11 的优化，建议按下面优先级来。

### 第一优先级：统一字段提取层

原因：

- `dashboard.js`
- `tracker.js`
- `visualizer.js`

都在各自做页面字段提取，存在重复逻辑和选择器漂移风险。

建议：

- 抽成统一 `extractors` 模块
- 统一价格、coupon、buybox、销量、类目解析

### 第二优先级：统一风控处理

建议：

- 抽一个统一的 `detectCaptcha / detectRiskBlock / detect404`
- 所有模块共用

### 第三优先级：统一任务调度器

当前问题：

- `dashboard.js` 有一套 worker 调度
- `tracker.js` 又有自己的 worker 调度
- `visualizer.js` 也有自己的 worker 调度

建议：

- 抽一个共享的任务执行器
- 支持：
  - 并发数
  - 随机延迟
  - 熔断
  - 进度回调

### 第四优先级：授权系统重构

当前问题：

- 管理员账号密码硬编码
- 盐值硬编码
- 离线校验易被复制

建议：

- 如果是自用，可以去掉授权层
- 如果要商用，应迁移到服务端签发和校验

### 第五优先级：站点兼容性

当前问题：

- 很多选择器仍偏美站
- 其他站点兼容主要靠兜底，而不是专门适配

建议：

- 为 US/CA/UK/DE/JP 建立 selector profile

---

## 十五、结论

这套 V11 源码本质上是一个本地化亚马逊运营分析平台，包含三大前台工作流：

1. `dashboard`
   负责即时任务和大盘分析
2. `tracker`
   负责长期跟踪和小时巡航
3. `visualizer`
   负责选品视图、深度详情抓取和导出

如果你后续是要“优化项目”，最关键的不是先改 UI，而是先处理 3 个底层问题：

1. 页面字段提取逻辑重复
2. 风控检测与恢复逻辑分散
3. 任务调度器重复实现

把这三层收敛以后，再做功能增强和性能优化，成本会低很多。
