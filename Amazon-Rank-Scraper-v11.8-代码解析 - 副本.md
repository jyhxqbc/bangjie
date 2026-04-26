# Amazon Rank Scraper v11.8 代码解析

## 1. 项目定位

这是一个基于 Chrome Extension Manifest V3 的亚马逊分析插件，核心用途不是“在商品详情页上做轻量增强”，而是提供一个独立的数据工作台，用于：

- 关键词自然位占比查询
- ASIN 收录/索引检查
- 榜单节点抓取与选品大盘分析
- ASIN 长期跟踪
- 小时级排名巡航监控
- Excel / JSON 导出

它的整体形态更像“浏览器内置的小型采集平台”。

## 2. 总体架构

插件由 5 类部分组成：

### 2.1 插件壳层

- `manifest.json`
- `background.js`
- `content.js`

职责：

- 声明权限
- 注入内容脚本
- 点击插件图标时打开主工作台
- 在亚马逊页面中执行轻量 DOM 抓取

### 2.2 主工作台

- `dashboard.html`
- `dashboard.js`

职责：

- 提供主控制台
- 做登录/授权校验
- 执行关键词占比、索引检查、榜单/选品抓取
- 管理断点续跑、失败重试、导出

### 2.3 跟踪系统

- `tracker.html`
- `tracker.js`

职责：

- 管理长期追踪任务
- 记录关键词自然排名变化
- 记录 ASIN 详情页快照变化
- 提供小时级巡航与趋势图

### 2.4 可视化大盘

- `visualizer.html`
- `visualizer.js`

职责：

- 对采集出的自然位商品做筛选、卡片展示、批量勾选
- 深度补抓商品详情
- 导出选中商品数据

### 2.5 第三方库

- `echarts.min.js`

职责：

- 在跟踪系统中绘制小时级趋势图

## 3. 代码特点

### 3.1 JS 已混淆

`background.js`、`content.js`、`dashboard.js`、`tracker.js`、`visualizer.js` 都做了混淆压缩。变量名基本不可读，但通过 DOM id、文本、接口路径、数据结构仍然可以还原主要功能。

### 3.2 数据主要存本地

大量状态使用 `chrome.storage.local` 保存，例如：

- `blkSession`
- `blkAccountsRecord`
- `blkEngineState`
- `blkVizState`
- `visualizerData`
- `blkTrackerData`

说明这个系统基本是“本地持久化 + 本地导出”，没有真正的服务端任务中心。

### 3.3 采集方式以 fetch + DOMParser 为主

主逻辑不是依赖后端接口，而是直接请求 Amazon 页面 HTML，然后：

- `fetch(...)`
- `DOMParser.parseFromString(...)`
- `querySelector / querySelectorAll`

再从页面结构里抽取：

- `data-asin`
- Sponsored 标记
- Amazon's Choice 标记
- 价格、评分、评论数
- 类目排名
- 品牌、BuyBox、Coupon、Deal 等信息

## 4. 文件逐项说明

## 4.1 `manifest.json`

作用：

- 定义 MV3 插件基本信息
- 注册 `background.js` 为 `service_worker`
- 声明 `storage`、`tabs`、`unlimitedStorage`、`scripting` 权限
- 对多个 Amazon 站点声明 `host_permissions`
- 在 Amazon 页面自动注入 `content.js`

说明：

- 插件覆盖 `amazon.com / ca / co.uk / de / fr / it / es / co.jp / com.au`
- `action` 被点击后并不是弹 popup，而是由后台脚本打开独立页面

## 4.2 `background.js`

作用：

- 监听插件图标点击事件
- 打开 `dashboard.html`

实际行为：

- 用户点击扩展图标后
- 在当前窗口中新建标签页
- URL 指向 `chrome.runtime.getURL('dashboard.html')`

这是整个插件的入口分发器。

## 4.3 `content.js`

作用：

- 在 Amazon 页面内执行页面内 DOM 抓取
- 提供轻量抓取能力给扩展消息调用

已识别功能：

- 自动滚动到底部 `autoScrollToBottom()`
- 提取自然位商品数据 `extractPageOrganicData()`
- 检测验证码/CAPTCHA
- 从搜索结果页提取：
  - 自然位 ASIN 列表
  - Amazon's Choice 对应 ASIN
  - 搜索总结果数
- 过滤 Sponsored 广告位
- 监听 `chrome.runtime.onMessage`
- 收到 `START_SCRAPING` 后执行抓取并返回结果

它本质上是“当前页面 DOM 采集器”，适合处理已打开的搜索结果页。

## 4.4 `dashboard.html`

作用：

- 主工作台 UI

主要区域：

- 登录弹层 `authModal`
- 管理员面板 `adminPanel`
- 主应用容器 `appContainer`
- 环境检测栏
- ASIN 输入区 `asinInput`
- 关键词输入区 `keywordInput`
- 榜单节点输入区 `nodeInput`
- 站点、页码、延迟、线程配置
- 操作按钮：
  - `startRankBtn`
  - `startIndexBtn`
  - `visualizerBtn`
  - `resumeVizBtn`
  - `openTrackerBtn`
  - `resumeProgressBtn`
  - `retryBtn`
  - `exportBtn`
- 进度和日志区：
  - `statusText`
  - `progressCount`
  - `progressBarInner`
  - `logArea`

这是所有主功能的统一操作面板。

## 4.5 `dashboard.js`

这是整个插件最核心、最重的业务脚本。

### A. 授权与登录模块

作用：

- 检查 `chrome.storage.local` 中的 `blkSession`
- 判断用户是否已登录
- 区分管理员与普通授权用户
- 通过到期日期 + 盐值哈希校验密码合法性

已识别逻辑：

- 内置管理员账号：`blake`
- 内置管理员密码：`blake@123`
- 使用 `SECRET_SALT` 做简单哈希签名
- 普通密码格式是 `base64(expireDate|hash)`
- 登录后把会话写入 `blkSession`

结论：

- 这是“离线授权校验”
- 不依赖正式后端
- 安全性较弱，因为管理员凭据和盐值都在前端脚本中

### B. 管理员发卡模块

作用：

- 管理员可生成新账号和授权码
- 根据开始日期、天数自动算到期日
- 把账号记录写入本地 `blkAccountsRecord`
- 支持导出本地账号记录 CSV

适用场景：

- 作者给客户离线发授权账号
- 在本机保存曾经生成过的账号清单

### C. 抓取引擎状态管理

作用：

- 保存抓取中间状态
- 支持断点恢复
- 支持失败关键词重试

主要状态：

- `queueKeywords`
- `queueTargetAsins`
- `queueIndex`
- `taskMode`
- `finalResultsTable`
- `failedKeywords`
- `punishMode`
- `blkEngineState`

### D. 排名占比查询模块

作用：

- 输入目标 ASIN + 多个关键词
- 抓取 Amazon 搜索结果页
- 统计目标 ASIN 在自然位中的覆盖情况

统计结果包含：

- 前 3 自然位占比
- 前 8 自然位占比
- 前 16 自然位占比
- 总自然位占比
- AC 商品是否为目标同款
- 自然位前 1/2/3 个 ASIN
- 总结果数

这个模块更像“关键词自然位份额分析器”。

### E. 收录/索引检查模块

作用：

- 逐个验证目标 ASIN 是否被某关键词检索到

表现形式：

- 任务模式有 `RANK` 和 `INDEX`
- `INDEX` 模式不是算占比，而是判断“检索是否命中”

### F. 榜单/选品大盘抓取模块

作用：

- 把输入的关键词、ASIN、榜单节点混合成搜索任务
- 抓取自然位商品集合
- 存到 `visualizerData`
- 自动打开 `visualizer.html`

抓取结果字段已识别：

- `asin`
- `img`
- `title`
- `price`
- `rating`
- `reviewCount`
- `page`
- `keyword`
- `_termIdx`
- `_rank`

### G. 并发调度模块

作用：

- 基于线程数做多 worker 抓取
- 控制延迟
- 在 CAPTCHA/503 出现时降速或暂停

已识别机制：

- 可设置线程数 `threadInput`
- `processWorkerTask()` 处理单任务
- `startEngineMaster()` 做总调度
- 检测风控后启用 `punishMode`
- `punishMode` 下退化为单线程

### H. 环境检测模块

作用：

- 检测是否为无痕环境
- 检测当前站点首页可否访问
- 判断是否设置了收货地/邮编

界面反馈：

- `zipcodeLight`
- `incognitoLight`
- `incognitoText`

### I. 导出模块

作用：

- 把 `finalResultsTable` 导出为 Excel 兼容 HTML

实现方式：

- 不是调用真实 `.xlsx` 库
- 而是拼 HTML table，再以 Excel MIME 下载

## 4.6 `tracker.html`

作用：

- 提供长期跟踪系统界面

3 个面板：

- `panel-rank` 自然排名跟踪
- `panel-detail` ASIN 详情快照监控
- `panel-hourly` 小时级分时巡航

关键 UI 元素：

- 备份/恢复 JSON
- 并发线程输入 `trackerThreadInput`
- 一键抓取全部任务 `syncAllBtn`
- 各模块的导出、导入、删除、单独运行按钮
- 小时巡航设置弹窗 `cruiseSettingModal`
- 趋势图弹窗 `chartModal`

## 4.7 `tracker.js`

这是第二个重量级业务脚本，重点在“持续跟踪”。

### A. 面板切换与基础状态

作用：

- 三个 tab 切换
- 初始化 `trackerData`
- 从本地存储恢复历史数据

主存储键：

- `blkTrackerData`

### B. 功能1：自然排名跟踪

作用：

- 为某个 ASIN 配置多个关键词
- 抓取自然位排名、广告位排名
- 存入每个任务的历史记录

可见能力：

- 添加任务
- 搜索任务
- 删除任务
- 导出表格
- 批量覆盖备注
- 单独运行

### C. 功能2：详情快照监控

作用：

- 跟踪指定 ASIN 的商品详情变化

抓取字段非常多，已识别包括：

- 原价
- Deal 状态
- Deal 折扣
- Coupon
- 运费/FBA Fee
- 成交价/券后价
- 品牌
- BuyBox 卖家
- 高退货标记
- 销量标签
- 主图
- 大类名称 / 大类排名
- 小类名称 / 小类排名
- 备注字段 r1/r2/r3

这部分本质上是“详情页快照审计器”。

### D. 功能3：小时级分时巡航

作用：

- 设置若干整点时段
- 到指定整点自动抓取核心竞品
- 记录自然位排名和广告位排名
- 用 ECharts 画时间趋势线

已识别能力：

- 最多 5 个小时级任务
- 可选运行小时列表 `runHours`
- 自动巡航开关 `toggleHourlyEngineBtn`
- 手动强制执行 `forceRunHourlyBtn`
- 趋势图查看 `viewTrendChartBtn`

这是整个插件里最接近“轻量监控系统”的部分。

### E. 导入导出与备注覆盖

作用：

- 全量 JSON 备份/恢复
- 导出 rank/detail/hourly 其中任意模块
- 从 Excel 粘贴结果中解析备注并回填

说明：

- 插件把备注字段设计成可离线编辑
- 再通过粘贴表格内容回灌到本地数据

### F. 排序、筛选、差异标记

作用：

- 表格支持排序
- 按 ASIN / 站点过滤
- 对变化字段高亮
- 对排名升降做标色

## 4.8 `visualizer.html`

作用：

- 选品大盘可视化页面

主要区域：

- 顶部动作栏
- 深度抓取线程配置 `deepFetchThreadInput`
- 深度抓取按钮 `deepFetchBtn`
- 提取 ASIN 文本 `extractBtn`
- 导出选中数据 `downloadCsvBtn`
- 价格 / 评论数 / 评分 三组过滤器
- 去重开关 `vizDedupToggle`
- 商品卡片网格 `productGrid`

## 4.9 `visualizer.js`

作用：

- 读取 `visualizerData`
- 渲染商品卡片
- 做过滤、去重、勾选
- 深度补抓详情页信息
- 导出选中商品

### A. 筛选模块

支持按以下维度分桶筛选：

- 价格
- 评论数
- 星级评分

同时支持：

- 同 ASIN 去重
- 当前视图全选
- 当前视图反选

### B. 商品卡片模块

每个卡片会显示：

- 图片
- 标题
- 价格
- 评论数
- 评分
- 销量标签
- ASIN
- 页面排名位置
- Best Seller 标记

### C. 深度抓取模块

作用：

- 对选中的 ASIN 再打开详情页抓取附加字段

已识别字段：

- 最终成交价
- Coupon 信息
- 五点描述 bullets

说明：

- 这里是二次补抓，不是首次搜索结果抓取
- 结果会回写到 `allProducts`

### D. 导出模块

支持：

- 把选中的 ASIN 文本提取到文本框
- 导出选中商品为 Excel 兼容文件

## 4.10 `echarts.min.js`

作用：

- 第三方图表库
- 主要被 `tracker.js` 用于小时级趋势图展示

不属于业务逻辑核心，属于依赖文件。

## 4.11 `遇到这个问题需要找作者更新插件.txt`

作用：

- 这是一个附带说明文件
- 通常表示某些页面结构变化或风控变化后，插件需要作者更新

因为这类插件高度依赖 Amazon 页面 DOM 结构，所以页面改版后失效是高概率事件。

## 5. 功能模块总结

## 5.1 登录授权模块

组成：

- `dashboard.html`
- `dashboard.js`

作用：

- 普通用户登录
- 管理员发卡
- 本地会话管理

特点：

- 完全前端离线授权
- 无服务端
- 安全性一般

## 5.2 Amazon 页面内容采集模块

组成：

- `content.js`

作用：

- 读取当前 Amazon 页面的自然位商品和 AC 信息
- 提供消息式抓取能力

特点：

- 适合直接操作当前标签页 DOM

## 5.3 主引擎抓取模块

组成：

- `dashboard.js`

作用：

- 多关键词批量抓取
- 多页面分页抓取
- 自然位占比统计
- 索引/收录验证
- 榜单节点抓取

特点：

- 并发执行
- 有断点续跑
- 有风控降级

## 5.4 选品大盘分析模块

组成：

- `dashboard.js`
- `visualizer.html`
- `visualizer.js`

作用：

- 展示抓到的自然位商品池
- 做价格、评论、评分筛选
- 批量选品
- 深度补抓详情

特点：

- 偏“选品运营工作台”

## 5.5 长期跟踪模块

组成：

- `tracker.html`
- `tracker.js`

作用：

- 跟踪自然排名
- 跟踪商品详情变化
- 做小时级自动巡航

特点：

- 偏“监控预警/竞品观察”

## 5.6 数据持久化与导出模块

组成：

- `dashboard.js`
- `tracker.js`
- `visualizer.js`

作用：

- 本地保存任务和结果
- 导出 Excel / CSV / JSON
- 导入 JSON
- Excel 粘贴回填备注

特点：

- 本地化很强
- 适合个人工作机使用

## 6. 关键实现结论

### 6.1 这是一个“前端本地采集器”，不是云端系统

所有核心能力都在浏览器端完成：

- 请求 Amazon 页面
- 解析 HTML
- 本地存储
- 本地导出

### 6.2 插件非常依赖 Amazon 页面结构

大量逻辑依赖：

- `div[data-component-type="s-search-result"]`
- `data-asin`
- `#feature-bullets`
- `#SalesRank`
- `#merchant-info`
- Sponsored/AC 等页面文本

所以只要 Amazon 改结构，就会局部失效。

### 6.3 内置了较明显的风控应对逻辑

包括：

- 验证码检测
- 503 检测
- 自动暂停
- 恢复按钮
- 降速/单线程惩罚模式
- 鼓励无痕模式运行

说明作者清楚这类采集行为会触发 Amazon 风控。

### 6.4 授权系统安全性偏低

原因：

- 管理员账号和密码硬编码在前端脚本
- 盐值硬编码
- 授权算法也在本地可见

这更像“使用门槛控制”，不是强安全授权。

## 7. 我对这个项目的简短评价

从代码结构看，这不是标准工程化插件，而是一个“功能堆叠型业务插件”：

- 优点是功能很多、实用导向强
- 缺点是单文件过大、混淆后维护难、测试性弱、扩展性差

如果后续要继续维护，建议优先拆分：

- 授权模块
- 抓取模块
- 导出模块
- 可视化模块
- 跟踪模块

并把页面解析规则独立成可维护的 selector 配置层。

## 8. 文件作用速查表

| 文件 | 作用 |
|---|---|
| `manifest.json` | 插件配置、权限、脚本注册 |
| `background.js` | 点击插件图标后打开主工作台 |
| `content.js` | 在 Amazon 页面中提取自然位、AC、总结果数 |
| `dashboard.html` | 主控制台页面 |
| `dashboard.js` | 登录授权、主抓取引擎、榜单/占比/索引/导出 |
| `tracker.html` | 跟踪系统页面 |
| `tracker.js` | 排名跟踪、详情快照、小时级巡航、趋势图 |
| `visualizer.html` | 选品大盘页面 |
| `visualizer.js` | 大盘筛选、卡片展示、深度抓取、导出 |
| `echarts.min.js` | 图表库 |
| `遇到这个问题需要找作者更新插件.txt` | 故障说明/维护提示 |

