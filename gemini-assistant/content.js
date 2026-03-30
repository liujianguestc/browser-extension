// ================= 配置中心 =================
const SITE_CONFIGS = {
    'gemini.google.com': {
        query: ['.user-query', 'user-query', '[data-testid="user-query"]', 'h2'],
        message: ['user-query', 'model-response', '.message-content', '[data-testid="model-response"]', '.query-container']
    }
};

let currentConfig = null;
let lastUrl = location.href;
let debounceTimer = null;
let isProcessing = false;
let isHistoryFullyLoaded = false;

// ================= 主程序启动 =================
function initPlugin() {
    detectPlatform();
    createNavContainer();
    
    setTimeout(() => {
        generateNavList();
    }, 1500);

    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const listDiv = document.getElementById('gemini-nav-list');
            if(listDiv) listDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:12px">加载新对话...</div>';
            
            isProcessing = false;
            isHistoryFullyLoaded = false;
            
            setTimeout(() => {
                generateNavList();
            }, 1500);
        }
    }, 1000);

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
    if (host.includes('gemini') || host.includes('google')) {
        currentConfig = SITE_CONFIGS['gemini.google.com'];
    }
}

// ================= UI 创建 =================
function createNavContainer() {
    if (document.getElementById('gemini-nav-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-nav-container';
    
    const header = document.createElement('div');
    header.id = 'gemini-nav-header';
    header.innerHTML = '<span>🚀 导航+导出</span>';
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'header-actions';

    const loadAllBtn = document.createElement('button');
    loadAllBtn.className = 'nav-header-btn';
    loadAllBtn.innerHTML = '⚡';
    loadAllBtn.title = "加载全部历史";
    loadAllBtn.onclick = (e) => {
        e.stopPropagation();
        processHistoryAndRefresh();
    };
    actionsDiv.appendChild(loadAllBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'nav-header-btn';
    exportBtn.innerHTML = '📥';
    exportBtn.title = "导出 Markdown";
    exportBtn.onclick = (e) => {
        e.stopPropagation();
        processHistoryAndExport();
    };
    actionsDiv.appendChild(exportBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'nav-header-btn';
    toggleBtn.innerHTML = '➖';
    toggleBtn.title = "折叠/展开";
    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        toggleCollapse(container, toggleBtn);
    };
    actionsDiv.appendChild(toggleBtn);

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
async function processHistoryAndRefresh() {
    if (isProcessing) return;
    
    if (!isHistoryFullyLoaded) {
        await runBacktracking();
        isHistoryFullyLoaded = true;
    } else {
        updateStatus("历史已加载", 1000);
    }
    
    generateNavList();
    scrollToLatestMessage();
}

async function processHistoryAndExport() {
    if (isProcessing) return;

    if (!isHistoryFullyLoaded) {
        await runBacktracking();
        isHistoryFullyLoaded = true;
    } else {
        console.log("检测到历史已加载，跳过回溯，直接导出。");
    }
    
    updateStatus("正在提取数据...");
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

async function runBacktracking() {
    isProcessing = true;
    const listDiv = document.getElementById('gemini-nav-list');
    await scrollUntilTop((round) => {
        if (listDiv) listDiv.innerHTML = `<div style="padding:20px;text-align:center;color:#666;font-size:12px">正在回溯历史...<br>已加载 ${round} 页<br>⏳ 请勿操作</div>`;
    });
    isProcessing = false;
}

async function scrollUntilTop(statusCallback) {
    let round = 1;
    let maxRetries = 100;
    let noChangeCount = 0;

    while (round <= maxRetries) {
        const firstMsgElement = getFirstVisibleMessage();
        const firstMsgFingerprint = firstMsgElement ? firstMsgElement.innerText.slice(0, 50) : "NULL";

        if (statusCallback) statusCallback(round);

        triggerScrollTop();

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

function scrollToLatestMessage() {
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
