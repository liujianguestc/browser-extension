// ================= 配置中心 =================
const SITE_CONFIGS = {
    'gemini.google.com': {
        // query: 左侧导航列表提取规则
        query: ['.user-query', 'user-query', '[data-testid="user-query"]', 'h2'],
        // message: 包含所有对话气泡（用于回溯判定、导出提取、以及寻找滚动容器）
        message: ['user-query', 'model-response', '.message-content', '[data-testid="model-response"]', '.query-container']
    },
    'yuanbao.tencent.com': {
        query: ['.agent-user-content', 'div[class*="UserMessage"]', '.user-message'],
        message: ['.agent-user-content', 'div[class*="UserMessage"]', 'div[class*="AgentMessage"]', '.agent-content']
    },
    'aistudio.baidu.com': {
        query: ['.conversation-item-user', '.studio-chat-user', 'div[data-role="user"]'],
        message: ['.conversation-item', '.message-item']
    }
};

let currentConfig = null;
let lastUrl = location.href;
let debounceTimer = null;
let isProcessing = false;
// [新增] 标记历史记录是否已经全量加载过
let isHistoryFullyLoaded = false; 

// ================= 主程序启动 =================
function initPlugin() {
    detectPlatform();
    createNavContainer();
    
    // 1. 首次加载
    setTimeout(() => {
        generateNavList();
    }, 1500);

    // 2. 监听 URL 变化
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const listDiv = document.getElementById('gemini-nav-list');
            if(listDiv) listDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:12px">加载新对话...</div>';
            
            // [重置状态] 切换对话了，新对话肯定没加载完
            isProcessing = false;
            isHistoryFullyLoaded = false; 
            
            setTimeout(() => {
                generateNavList();
            }, 1500);
        }
    }, 1000); 

    // 3. 监听 DOM 变化
    const observer = new MutationObserver((mutations) => {
        if (isProcessing) return;

        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                hasNewNodes = true;
                break;
            }
        }

        if (hasNewNodes) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                generateNavList();
            }, 2000);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function detectPlatform() {
    const host = location.hostname;
    if (host.includes('gemini')) currentConfig = SITE_CONFIGS['gemini.google.com'];
    else if (host.includes('yuanbao')) currentConfig = SITE_CONFIGS['yuanbao.tencent.com'];
    else if (host.includes('baidu')) currentConfig = SITE_CONFIGS['aistudio.baidu.com'];
    else if (host.includes('google')) currentConfig = SITE_CONFIGS['gemini.google.com'];
}

// ================= UI 创建 =================
function createNavContainer() {
    if (document.getElementById('gemini-nav-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-nav-container';
    
    // 头部
    const header = document.createElement('div');
    header.id = 'gemini-nav-header';
    header.innerHTML = '<span>🚀 导航+导出</span>';
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'header-actions';

    // 按钮 1：全量加载 (⚡)
    const loadAllBtn = document.createElement('button');
    loadAllBtn.className = 'nav-header-btn';
    loadAllBtn.innerHTML = '⚡'; 
    loadAllBtn.title = "加载全部历史";
    loadAllBtn.onclick = (e) => {
        e.stopPropagation();
        processHistoryAndRefresh();
    };
    actionsDiv.appendChild(loadAllBtn);

    // 按钮 2：导出 (📥)
    const exportBtn = document.createElement('button');
    exportBtn.className = 'nav-header-btn';
    exportBtn.innerHTML = '📥'; 
    exportBtn.title = "导出 Markdown";
    exportBtn.onclick = (e) => {
        e.stopPropagation();
        processHistoryAndExport();
    };
    actionsDiv.appendChild(exportBtn);

    // 按钮 3：折叠/展开
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'nav-header-btn';
    toggleBtn.innerHTML = '➖';
    toggleBtn.title = "折叠/展开";
    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleCollapse(container, toggleBtn);
    };
    actionsDiv.appendChild(toggleBtn);

    // 按钮 4：滚至最新
    const toBottomBtn = document.createElement('button');
    toBottomBtn.className = 'nav-header-btn';
    toBottomBtn.innerHTML = '⬇️'; 
    toBottomBtn.title = "滚至最新";
    toBottomBtn.onclick = (e) => {
        e.stopPropagation();
        scrollToLatestMessage();
    };
    actionsDiv.appendChild(toBottomBtn);

    header.appendChild(actionsDiv);
    container.appendChild(header);

    const listDiv = document.createElement('div');
    listDiv.id = 'gemini-nav-list';
    container.appendChild(listDiv);

    document.body.appendChild(container);

    enableDrag(container, header);
}

// ================= 核心：回溯历史与导出 =================

// 流程 A: 点击闪电 (只加载，不导出)
async function processHistoryAndRefresh() {
    if (isProcessing) return;
    
    // 如果已经加载过了，可以提示一下，或者选择重新检测（这里选择不再强制滚）
    if (!isHistoryFullyLoaded) {
        await runBacktracking();
        // 标记为已加载
        isHistoryFullyLoaded = true;
    } else {
        updateStatus("历史已加载", 1000);
    }
    
    generateNavList();
    scrollToLatestMessage();
}

// 流程 B: 点击导出 (如果没加载过就加载，加载过直接导)
async function processHistoryAndExport() {
    if (isProcessing) return;

    // [核心优化] 只有未加载时才去回溯
    if (!isHistoryFullyLoaded) {
        await runBacktracking();
        isHistoryFullyLoaded = true;
    } else {
        console.log("检测到历史已加载，跳过回溯，直接导出。");
    }
    
    updateStatus("正在提取数据...");
    // 稍微等一下让 DOM 稳定
    await new Promise(r => setTimeout(r, 500));

    const chatData = extractMessages();
    if (chatData.length === 0) {
        alert("未提取到数据，请重试");
        updateStatus("提取失败");
        return;
    }

    const mdContent = formatToMarkdown(chatData);
    const title = document.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_").slice(0, 30);
    downloadFile(mdContent, `Chat_${title}_${new Date().toISOString().slice(0,10)}.md`);
    
    updateStatus("导出成功!");
    setTimeout(() => generateNavList(), 1500);
}

// 执行回溯动画
async function runBacktracking() {
    isProcessing = true;
    const listDiv = document.getElementById('gemini-nav-list');
    await scrollUntilTop((round) => {
        if (listDiv) listDiv.innerHTML = `<div style="padding:20px;text-align:center;color:#666;font-size:12px">正在回溯历史...<br>已加载 ${round} 页<br>⏳ 请勿操作</div>`;
    });
    isProcessing = false;
}

// 循环滚动直到顶部
async function scrollUntilTop(statusCallback) {
    let round = 1;
    let maxRetries = 100;
    let noChangeCount = 0;

    while (round <= maxRetries) {
        const firstMsgElement = getFirstVisibleMessage();
        const firstMsgFingerprint = firstMsgElement ? firstMsgElement.innerText.slice(0, 50) : "NULL";

        if (statusCallback) statusCallback(round);

        triggerScrollTop(); // 触发页面加载

        await new Promise(r => setTimeout(r, 2000));

        const newFirstMsgElement = getFirstVisibleMessage();
        const newFirstMsgFingerprint = newFirstMsgElement ? newFirstMsgElement.innerText.slice(0, 50) : "NULL";

        if (newFirstMsgFingerprint !== firstMsgFingerprint) {
            noChangeCount = 0;
        } else {
            noChangeCount++;
        }

        if (noChangeCount >= 2) {
            console.log("到达顶端");
            break;
        }
        round++;
    }
}

function getFirstVisibleMessage() {
    if (!currentConfig) return null;
    let allMessages = [];
    currentConfig.message.forEach(selector => {
        const found = document.querySelectorAll(selector);
        allMessages = [...allMessages, ...Array.from(found)];
    });
    const visibleElements = allMessages.filter(el => el.offsetParent !== null);
    if (visibleElements.length > 0) {
        visibleElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        return visibleElements[0];
    }
    return null;
}

// 辅助：触发顶部加载（用于回溯）
function triggerScrollTop() {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;

    const scroller = document.querySelector('infinite-scroller');
    if (scroller) scroller.scrollTop = 0;

    window.scrollTo(0, 0);

    const firstMsg = getFirstVisibleMessage();
    if (firstMsg) {
        firstMsg.scrollIntoView({ behavior: 'auto', block: 'end' }); 
    }
}

// ================= 修复版：滚到底部逻辑 =================
function scrollToLatestMessage() {
    // 循藤摸瓜 + 暴力兜底逻辑
    if (!currentConfig) return;

    let allMessages = [];
    currentConfig.message.forEach(selector => {
        const found = document.querySelectorAll(selector);
        allMessages = [...allMessages, ...Array.from(found)];
    });

    const visibleMessages = allMessages.filter(el => el.offsetParent !== null);
    const lastMessage = visibleMessages[visibleMessages.length - 1];

    if (lastMessage) {
        let parent = lastMessage.parentElement;
        let foundScroller = false;
        for (let i = 0; i < 10; i++) {
            if (!parent || parent === document.body) break;
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
                foundScroller = true;
                break;
            }
            parent = parent.parentElement;
        }
        if (!foundScroller) {
            lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
}

// ================= 数据提取与导出 =================
function extractMessages() {
    if (!currentConfig) return [];
    
    let allMessages = [];
    currentConfig.message.forEach(selector => {
        const found = document.querySelectorAll(selector);
        allMessages = [...allMessages, ...Array.from(found)];
    });

    const uniqueElements = Array.from(new Set(allMessages));
    const visibleElements = uniqueElements.filter(el => el.offsetParent !== null);
    // 按页面位置排序
    visibleElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    const results = [];
    visibleElements.forEach(msg => {
        let role = "AI";
        let text = msg.innerText.trim();
        const html = msg.outerHTML.toLowerCase();
        const cls = msg.className.toLowerCase();
        
        if (currentConfig.query.some(q => html.includes(q.replace('.',''))) || cls.includes('user') || html.includes('data-is-user="true"')) {
            role = "User";
        }
        if (text.length > 0 && text !== "edit") {
            results.push({ role, content: text });
        }
    });
    return results;
}

function formatToMarkdown(data) {
    let md = `# Chat Export\n\n`;
    data.forEach(item => {
        md += `### ${item.role === 'User' ? '👤 Me' : '🤖 AI'}\n\n`;
        md += `${item.content}\n\n`;
        md += `---\n\n`;
    });
    return md;
}

function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ================= 导航列表生成 =================
function generateNavList() {
    const listDiv = document.getElementById('gemini-nav-list');
    if (!listDiv || !currentConfig) return;

    const previousScrollTop = listDiv.scrollTop;
    let messageBlocks = [];

    for (let selector of currentConfig.query) {
        const found = document.querySelectorAll(selector);
        const valid = Array.from(found).filter(el => el.innerText && el.innerText.trim().length > 1 && el.offsetParent !== null);
        if (valid.length > 0) {
            messageBlocks = valid;
            break; 
        }
    }
    
    messageBlocks.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    if (messageBlocks.length === 0) return;

    listDiv.innerHTML = ''; 

    messageBlocks.forEach((block, index) => {
        let rawText = block.innerText.trim();
        let cleanText = rawText.replace(/^(You said|You|你说|你)\s*/i, '');
        cleanText = cleanText.replace(/\n/g, ' ');

        let displayText = cleanText.substring(0, 50);
        if (cleanText.length > 50) displayText += '...';

        const item = document.createElement('div');
        item.className = 'nav-item';
        item.innerHTML = `<span class="nav-index">${index + 1}</span><span class="nav-text">${displayText}</span>`;
        
        item.onclick = () => {
            block.scrollIntoView({ behavior: 'smooth', block: 'center' });
            block.style.transition = "background-color 0.5s";
            block.style.backgroundColor = "#fff9c4"; 
            setTimeout(() => { block.style.backgroundColor = ""; }, 1000);
        };
        listDiv.appendChild(item);
    });

    listDiv.scrollTop = previousScrollTop;
}

// ================= 辅助工具 =================
function updateStatus(msg, timeout) {
    const listDiv = document.getElementById('gemini-nav-list');
    if(listDiv) listDiv.innerHTML = `<div style="padding:20px;text-align:center;color:#666;font-size:12px">${msg}</div>`;
    if (timeout) {
        setTimeout(() => generateNavList(), timeout);
    }
}

function enableDrag(element, handle) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.onmousedown = function(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = element.getBoundingClientRect();
        element.style.right = 'auto'; 
        initialLeft = rect.left;
        initialTop = rect.top;
        element.style.left = initialLeft + 'px';
        element.style.top = initialTop + 'px';
        handle.style.cursor = 'grabbing';
        e.preventDefault();
    };

    window.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        element.style.left = (initialLeft + dx) + 'px';
        element.style.top = (initialTop + dy) + 'px';
    });

    window.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            handle.style.cursor = 'grab';
        }
    });
}

function toggleCollapse(container, btn) {
    const listDiv = document.getElementById('gemini-nav-list');
    if (!listDiv) return;
    if (listDiv.style.display === 'none') {
        listDiv.style.display = 'block';
        btn.innerHTML = '➖';
    } else {
        listDiv.style.display = 'none';
        btn.innerHTML = '➕';
    }
}

initPlugin();