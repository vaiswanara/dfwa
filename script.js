if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => console.log('Service Worker Registered'));
}

const HOME_MEMBER_NAME = 'SRIKANTH DHARMAVARAM';

let allData = [];
let rootNodes = [];
let dataMap = {};
let photoMap = {};
let activeFocusId = null;
const spouseParentsExpanded = new Set();
const profileCard = document.getElementById('profileCard');

async function loadPhotoMap() {
    try {
        const response = await fetch('photo.json');
        if (!response.ok) throw new Error(`photo.json ${response.status}`);
        const map = await response.json();
        photoMap = map && typeof map === 'object' ? map : {};
    } catch (error) {
        console.log('photo.json load failed. Using initials only.', error);
        photoMap = {};
    }
}

window.addEventListener('DOMContentLoaded', () => {
    Promise.all([
        fetch('family_data.csv').then(r => r.text()),
        loadPhotoMap(),
        fetchWelcomeMessage()
    ])
        .then(([text]) => {
            allData = parseCSV(text);
            rootNodes = buildHierarchy(allData);
            renderTree(rootNodes);

            const homeNode = Object.values(dataMap).find(n => n.name === HOME_MEMBER_NAME);
            if (homeNode) locateNode(homeNode.id);
        })
        .catch(e => console.log('Auto-load failed. Use manual upload.', e));
});

async function fetchWelcomeMessage() {
    try {
        const response = await fetch('welcome.json');
        if (!response.ok) return;
        const messages = await response.json();
        if (messages && messages.length > 0) {
            // Show the last message in the list
            const latest = messages[messages.length - 1];
            document.getElementById('welcomeBanner').textContent = latest.Message;
        }
    } catch (e) {
        console.log('Welcome message load failed', e);
        document.getElementById('welcomeBanner').style.display = 'none';
    }
}

document.getElementById('csvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const text = evt.target.result;
        allData = parseCSV(text);
        rootNodes = buildHierarchy(allData);
        activeFocusId = null;
        renderTree(rootNodes);
    };
    reader.readAsText(file);
});

document.getElementById('searchInput').addEventListener('keyup', function(e) {
    if (e.key === 'Enter') searchNode(this.value);
});

const searchInput = document.getElementById('searchInput');
const searchDropdown = document.getElementById('searchDropdown');

searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase();
    searchDropdown.innerHTML = '';
    if (query.length < 1) {
        searchDropdown.style.display = 'none';
        return;
    }

    const matches = Object.values(dataMap)
        .filter(p => p.name && p.name.toLowerCase().includes(query))
        .slice(0, 10);

    if (matches.length > 0) {
        matches.forEach(p => {
            const div = document.createElement('div');
            div.textContent = p.name;
            div.onclick = () => {
                searchInput.value = p.name;
                searchDropdown.style.display = 'none';
                locateNode(p.id);
            };
            searchDropdown.appendChild(div);
        });
        searchDropdown.style.display = 'block';
    } else {
        searchDropdown.style.display = 'none';
    }
});

document.addEventListener('click', function(e) {
    if (!document.querySelector('.search-box').contains(e.target) && !e.target.closest('.search-toggle-btn')) {
        searchDropdown.style.display = 'none';
    }

    if (!e.target.closest('.person-circle') && !e.target.closest('#profileCard')) {
        hideProfileCard();
    }
});

document.getElementById('mainWrapper').addEventListener('scroll', hideProfileCard);

function parseCSV(text) {
    const lines = text.trim().split('\n');
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = [];
        let current = '';
        let inQuote = false;

        for (const char of line) {
            if (char === '"') { inQuote = !inQuote; continue; }
            if (char === ',' && !inQuote) {
                parts.push(current.trim());
                current = '';
                continue;
            }
            current += char;
        }
        parts.push(current.trim());

        if (parts.length < 2) continue;

        result.push({
            id: parts[0],
            name: parts[1],
            fid: parts[2] || null,
            mid: parts[3] || null,
            pids: parts[4]
                ? [...new Set(parts[4].split(',').map(s => s.trim()).filter(Boolean))]
                : []
        });
    }
    return result;
}

function buildHierarchy(flatData) {
    dataMap = {};
    flatData.forEach(node => {
        dataMap[node.id] = {
            ...node,
            children: [],
            linkedChildren: [],
            collapsed: true,
            parent: null,
            parents: []
        };
    });

    const roots = [];
    flatData.forEach(node => {
        const parentIds = [...new Set([node.fid, node.mid].filter(pid => pid && dataMap[pid]))];
        const displayParentId = parentIds[0] || null;

        if (parentIds.length > 0) {
            dataMap[node.id].parents = parentIds.map(pid => dataMap[pid]);
        }

        if (displayParentId && dataMap[displayParentId]) {
            dataMap[displayParentId].children.push(dataMap[node.id]);
            dataMap[node.id].parent = dataMap[displayParentId];
        } else {
            roots.push(dataMap[node.id]);
        }
    });

    // Keep display tree stable (one primary parent), but also attach each child to the other parent
    // so spouse-side descendants are reachable from both husband and wife branches.
    flatData.forEach(node => {
        const childNode = dataMap[node.id];
        if (!childNode) return;

        const hasFather = !!(node.fid && dataMap[node.fid]);
        const hasMother = !!(node.mid && dataMap[node.mid]);
        if (!hasFather || !hasMother) return;

        const displayParentId = childNode.parent ? childNode.parent.id : null;
        const fatherNode = dataMap[node.fid];
        const motherNode = dataMap[node.mid];

        if (displayParentId === fatherNode.id) {
            motherNode.linkedChildren.push(childNode);
        } else if (displayParentId === motherNode.id) {
            fatherNode.linkedChildren.push(childNode);
        } else {
            fatherNode.linkedChildren.push(childNode);
            motherNode.linkedChildren.push(childNode);
        }
    });

    return roots;
}

function getRenderableChildren(node) {
    if (!node) return [];
    const direct = Array.isArray(node.children) ? node.children : [];
    const linked = Array.isArray(node.linkedChildren) ? node.linkedChildren : [];
    const unique = new Map();

    direct.forEach(child => {
        if (child && child.id) unique.set(child.id, child);
    });
    linked.forEach(child => {
        if (child && child.id) unique.set(child.id, child);
    });

    return [...unique.values()];
}

function toggleNode(id) {
    if (dataMap[id]) {
        dataMap[id].collapsed = !dataMap[id].collapsed;
        renderTree(rootNodes);
    }
}

function centerNodeFamily(id) {
    const wrapper = document.getElementById('mainWrapper');
    const nodeEl = document.getElementById(`node-${id}`);
    if (!wrapper || !nodeEl) return;

    // Target the specific content container (Person + Spouse), ignoring the children list (<ul>)
    const contentEl = nodeEl.querySelector('.node-container');
    if (!contentEl) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const contentRect = contentEl.getBoundingClientRect();

    // Calculate center based only on the person/couple block
    const targetCenterX = contentRect.left + contentRect.width / 2;
    const targetCenterY = contentRect.top + contentRect.height / 2;

    const nextLeft = wrapper.scrollLeft + (targetCenterX - wrapperRect.left) - (wrapper.clientWidth / 2);
    const nextTop = wrapper.scrollTop + (targetCenterY - wrapperRect.top) - (wrapper.clientHeight / 2);

    wrapper.scrollTo({
        left: Math.max(0, nextLeft),
        top: Math.max(0, nextTop),
        behavior: 'smooth'
    });
}

function formatName(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length > 1) {
        const firstPart = parts.slice(0, -1).join(' ');
        const lastPart = parts[parts.length - 1];
        return `${firstPart}.${lastPart.charAt(0)}`;
    }
    return name;
}

function getInitial(name) {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
}

function toggleSpouseParents(id) {
    if (!id) return;
    if (spouseParentsExpanded.has(id)) {
        spouseParentsExpanded.delete(id);
    } else {
        spouseParentsExpanded.add(id);
    }
    renderTree(rootNodes);
}

function getCircleContent(id, name) {
    const initial = name ? name.charAt(0).toUpperCase() : '?';
    const photoSrc = photoMap[id];
    const safeTitle = name || '';

    if (!photoSrc) {
        return `<span class="member-initial">${initial}</span>`;
    }

    return `<span class="member-initial">${initial}</span><img class="member-photo" src="${photoSrc}" alt="${safeTitle}" loading="lazy" onerror="this.remove()">`;
}

function createTreeHTML(node) {
    const renderableChildren = getRenderableChildren(node);
    const hasChildren = renderableChildren.length > 0;
    const collapsedClass = node.collapsed ? 'collapsed' : 'expanded';
    const childrenClass = hasChildren ? 'has-children' : '';

    let leftPartnerHtml = '';
    let rightPartnerHtml = '';
    if (node.pids && node.pids.length > 0) {
        const spouseItems = node.pids.map(pid => {
            const spouseNode = dataMap[pid];
            if (!spouseNode) return null;
            return {
                id: spouseNode.id,
                fullName: spouseNode.name || '',
                fid: spouseNode.fid || null,
                mid: spouseNode.mid || null
            };
        }).filter(Boolean);

        if (spouseItems.length > 0) {
            const renderPartner = (s, ownerId) => {
                const parentNodes = [dataMap[s.fid], dataMap[s.mid]].filter(Boolean);
                const hasParents = parentNodes.length > 0;
                const isExpanded = spouseParentsExpanded.has(s.id);

                const parentRow = isExpanded && hasParents
                    ? `<div class="mini-row">
                        ${parentNodes.map(p => `
                            <div class="mini-parent"
                                 onclick="event.stopPropagation(); locateNode('${p.id}')"
                                 onmousedown="event.stopPropagation()">
                                <div class="mini-circle">${getInitial(p.name)}</div>
                                <div class="mini-name">${formatName(p.name)}</div>
                            </div>
                        `).join('')}
                      </div>`
                    : '';

                const parentsToggle = hasParents
                    ? `<button class="mini-toggle"
                               onclick="event.stopPropagation(); toggleSpouseParents('${s.id}')"
                               onmousedown="event.stopPropagation()">
                           ${isExpanded ? 'Hide Parents' : 'Show Parents'}
                       </button>`
                    : '';

                return `
                    <div class="person-block">
                        <div class="member-circle person-circle spouse-circle"
                             onclick="event.stopPropagation(); toggleNode('${ownerId}'); centerNodeFamily('${ownerId}'); return false;"
                             onmousedown="event.stopPropagation()"
                             data-node-id="${s.id}"
                             title="${s.fullName}">
                            ${getCircleContent(s.id, s.fullName)}
                        </div>
                        <div class="member-name">${formatName(s.fullName)}</div>
                        ${parentsToggle}
                        ${parentRow}
                    </div>
                `;
            };

            if (spouseItems.length === 2) {
                leftPartnerHtml = renderPartner(spouseItems[0], node.id);
                rightPartnerHtml = renderPartner(spouseItems[1], node.id);
            } else if (spouseItems.length === 1) {
                rightPartnerHtml = renderPartner(spouseItems[0], node.id);
            } else {
                leftPartnerHtml = renderPartner(spouseItems[0], node.id);
                rightPartnerHtml = spouseItems.slice(1).map(s => renderPartner(s, node.id)).join('');
            }
        }
    }

    let html = `<li class="${collapsedClass} ${childrenClass}" id="node-${node.id}">
        <div class="node-container">
            <div class="couple-row ${(leftPartnerHtml || rightPartnerHtml) ? 'has-partner' : ''}">
                ${leftPartnerHtml}
                <div class="person-block">
                    <div class="circle-wrapper">
                        <div class="member-circle person-circle primary-person"
                             onclick="toggleNode('${node.id}'); centerNodeFamily('${node.id}')"
                             data-node-id="${node.id}"
                             title="${node.name || ''}">
                            ${getCircleContent(node.id, node.name)}
                        </div>
                        <div class="toggle-btn" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); toggleNode('${node.id}')"></div>
                    </div>
                    <div class="member-name">${formatName(node.name)}</div>
                </div>
                ${rightPartnerHtml}
            </div>
        </div>`;

    if (hasChildren) {
        html += '<ul>';
        renderableChildren.forEach(child => {
            html += createTreeHTML(child);
        });
        html += '</ul>';
    }

    html += '</li>';
    return html;
}

function renderTree(roots) {
    const container = document.getElementById('treeContainer');
    if (roots.length === 0) {
        container.innerHTML = '';
        return;
    }

    let htmlContent = '<ul>';
    roots.forEach(root => htmlContent += createTreeHTML(root));
    htmlContent += '</ul>';
    container.innerHTML = htmlContent;
    applyLineageFocus(activeFocusId);
}

let searchResults = [];
let searchIndex = 0;
let lastQuery = '';

function expandAncestors(node) {
    if (!node) return;
    const visited = new Set();
    const stack = [node];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current.id)) continue;
        visited.add(current.id);

        const parents = current.parents && current.parents.length > 0
            ? current.parents
            : (current.parent ? [current.parent] : []);

        parents.forEach(parentNode => {
            parentNode.collapsed = false;
            stack.push(parentNode);
        });
    }
}

function getLineageIds(node) {
    if (!node) return new Set();
    const lineage = new Set();
    const stack = [node];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || lineage.has(current.id)) continue;
        lineage.add(current.id);

        const parents = current.parents && current.parents.length > 0
            ? current.parents
            : (current.parent ? [current.parent] : []);

        parents.forEach(parentNode => stack.push(parentNode));
    }

    return lineage;
}

function getFocusPath(node) {
    const path = [];
    let current = node;
    while (current) {
        path.push(current);
        current = current.parent || null;
    }
    return path.reverse();
}

function getDisplayNames(ids) {
    if (!ids || ids.length === 0) return 'N/A';
    const names = ids.map(id => dataMap[id]?.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'N/A';
}

function getParentNames(node) {
    const parentIds = [node.fid, node.mid].filter(Boolean);
    return getDisplayNames(parentIds);
}

function showProfileCard(id, event) {
    const node = dataMap[id];
    if (!node) return;

    const spouseNames = getDisplayNames(node.pids || []);
    const parentNames = getParentNames(node);
    const childrenCount = getRenderableChildren(node).length;

    profileCard.innerHTML = `
        <div class="pc-title">${node.name || 'Unknown'}</div>
        <div class="pc-row"><strong>ID:</strong> ${node.id}</div>
        <div class="pc-row"><strong>Parents:</strong> ${parentNames}</div>
        <div class="pc-row"><strong>Spouse(s):</strong> ${spouseNames}</div>
        <div class="pc-row"><strong>Children:</strong> ${childrenCount}</div>
    `;

    const pointerX = event.clientX || (event.touches && event.touches[0]?.clientX) || 0;
    const pointerY = event.clientY || (event.touches && event.touches[0]?.clientY) || 0;
    const cardWidth = 280;
    const left = Math.min(window.innerWidth - cardWidth - 12, Math.max(12, pointerX + 14));
    const top = Math.min(window.innerHeight - 180, Math.max(12, pointerY + 14));

    profileCard.style.left = `${left}px`;
    profileCard.style.top = `${top}px`;
    profileCard.style.display = 'block';
    profileCard.setAttribute('aria-hidden', 'false');
}

function hideProfileCard() {
    profileCard.style.display = 'none';
    profileCard.setAttribute('aria-hidden', 'true');
}

function applyLineageFocus(focusId) {
    const container = document.getElementById('treeContainer');
    container.querySelectorAll('li.lineage').forEach(el => el.classList.remove('lineage'));
    container.querySelectorAll('li.selected').forEach(el => el.classList.remove('selected'));

    if (!focusId || !dataMap[focusId]) return;
    const lineageIds = getLineageIds(dataMap[focusId]);

    lineageIds.forEach(id => {
        const el = document.getElementById(`node-${id}`);
        if (el) el.classList.add('lineage');
    });

    const selected = document.getElementById(`node-${focusId}`);
    if (selected) selected.classList.add('selected');
}

function focusNode(foundId) {
    activeFocusId = foundId;
    expandAncestors(dataMap[foundId]);
    renderTree(rootNodes);

    // Use requestAnimationFrame to ensure DOM update is processed
    requestAnimationFrame(() => {
        setTimeout(() => {
            const element = document.getElementById(`node-${foundId}`);
            if (element) {
                document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
                element.classList.add('highlight');
                centerNodeFamily(foundId);
            }
        }, 200);
    });
}

function searchNode(name) {
    if (!name) return;
    const lowerName = name.toLowerCase();

    if (lowerName !== lastQuery) {
        searchResults = Object.keys(dataMap).filter(id =>
            dataMap[id].name && dataMap[id].name.toLowerCase().includes(lowerName)
        );
        searchIndex = 0;
        lastQuery = lowerName;
    } else {
        searchIndex++;
        if (searchIndex >= searchResults.length) searchIndex = 0;
    }

    if (searchResults.length > 0) {
        const foundId = searchResults[searchIndex];
        focusNode(foundId);
        document.getElementById('searchInput').title = `Result ${searchIndex + 1} of ${searchResults.length}`;
    } else {
        alert('Name not found');
    }
}

function locateNode(id) {
    if (!dataMap[id]) return;
    // If the target is not currently rendered (fully collapsed elsewhere),
    // open its own node as well to avoid centering into empty space.
    dataMap[id].collapsed = false;
    focusNode(id);
}

const slider = document.getElementById('mainWrapper');
let isDragging = false;
let dragPointerId = null;
let startX = 0;
let startY = 0;
let scrollLeft = 0;
let scrollTop = 0;
let suppressToggleOnce = false;
let hasMoved = false;
let longPressTimer = null;
let longPressActive = false;
const LONG_PRESS_MS = 550;

slider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.toggle-btn') || e.target.closest('.search-box') || e.target.closest('.mini-toggle') || e.target.closest('.mini-parent')) return;

    isDragging = true;
    dragPointerId = e.pointerId;
    slider.setPointerCapture(e.pointerId);
    slider.style.cursor = 'grabbing';
    slider.style.userSelect = 'none';
    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    scrollLeft = slider.scrollLeft;
    scrollTop = slider.scrollTop;
});

slider.addEventListener('pointermove', (e) => {
    if (!isDragging || dragPointerId !== e.pointerId) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    const walkX = e.clientX - startX;
    const walkY = e.clientY - startY;
    if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) hasMoved = true;
    slider.scrollLeft = scrollLeft - walkX;
    slider.scrollTop = scrollTop - walkY;
});

function endDrag(e) {
    if (!isDragging || dragPointerId !== e.pointerId) return;
    isDragging = false;
    dragPointerId = null;
    slider.style.cursor = 'grab';
    slider.style.userSelect = '';
    if (slider.hasPointerCapture(e.pointerId)) {
        slider.releasePointerCapture(e.pointerId);
    }
}

slider.addEventListener('pointerup', endDrag);
slider.addEventListener('pointercancel', endDrag);

function startLongPress(target, clientX, clientY) {
    clearTimeout(longPressTimer);
    longPressActive = false;
    longPressTimer = setTimeout(() => {
        const nodeId = target.dataset.nodeId;
        if (!nodeId) return;
        longPressActive = true;
        suppressToggleOnce = target.classList.contains('primary-person');
        showProfileCard(nodeId, { clientX, clientY });
    }, LONG_PRESS_MS);
}

function cancelLongPress() {
    clearTimeout(longPressTimer);
}

document.addEventListener('touchstart', (e) => {
    const circle = e.target.closest('.person-circle');
    if (!circle) return;
    if (!e.touches || e.touches.length !== 1) return;
    startLongPress(circle, e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

document.addEventListener('touchmove', cancelLongPress, { passive: true });
document.addEventListener('touchend', cancelLongPress);
document.addEventListener('touchcancel', cancelLongPress);

document.addEventListener('mousedown', (e) => {
    const circle = e.target.closest('.person-circle');
    if (!circle || e.button !== 0) return;
    startLongPress(circle, e.clientX, e.clientY);
});

document.addEventListener('mouseup', cancelLongPress);
document.addEventListener('mouseleave', cancelLongPress);

const originalToggleNode = toggleNode;
toggleNode = function(id) {
    if (suppressToggleOnce) {
        suppressToggleOnce = false;
        if (longPressActive) {
            longPressActive = false;
            return;
        }
    }
    if (hasMoved) {
        hasMoved = false;
        return;
    }
    originalToggleNode(id);
};

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('active');
}

function toggleSearch() {
    const container = document.getElementById('searchContainer');
    container.classList.toggle('active');
    if (container.classList.contains('active')) {
        document.getElementById('searchInput').focus();
    }
}
