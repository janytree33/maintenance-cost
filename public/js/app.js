const SUPABASE_URL = 'https://qapmjkowevzwjyiqsnuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhcG1qa293ZXZ6d2p5aXFzbnV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzY1MTcsImV4cCI6MjA5NDcxMjUxN30.WS6aSvUG1UYHQN0Z2erekIpv69ZPTuQ8RCcLs8lMlLc';

let supabaseClient;
if (SUPABASE_URL !== '여기에_SUPABASE_URL을_입력하세요') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// -----------------------------------------------------------------
// 1. 네비게이션(화면 전환) 로직
// -----------------------------------------------------------------
document.getElementById('menu-dashboard').addEventListener('click', (e) => { e.preventDefault(); switchView('view-dashboard'); });
document.getElementById('menu-history').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('view-history');
    loadHistory(); // 화면을 전환할 때 DB에서 데이터를 불러옵니다.
});

function switchView(viewId) {
    // 상단 네비게이션 활성화 변경
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const menuId = viewId === 'view-dashboard' ? 'menu-dashboard' : 'menu-history';
    document.getElementById(menuId)?.classList.add('active');

    // 뷰 숨기기 및 보이기
    document.getElementById('view-dashboard').classList.add('view-hidden');
    document.getElementById('view-history').classList.add('view-hidden');
    document.getElementById('view-settings').classList.add('view-hidden');
    
    document.getElementById(viewId).classList.remove('view-hidden');
}


// -----------------------------------------------------------------
// 2. 모달 제어 로직
// -----------------------------------------------------------------
function showResultModal(message) {
    document.getElementById('modalMessage').innerHTML = message.replace(/\n/g, '<br>');
    document.getElementById('resultModal').style.display = 'flex';
}

function closeResultModal() {
    document.getElementById('resultModal').style.display = 'none';
}

function closeDetailModal() {
    document.getElementById('detailModal').style.display = 'none';
}


// -----------------------------------------------------------------
// 3. 업로드 및 파싱 로직
// -----------------------------------------------------------------
document.getElementById('uploadBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('htmlFileInput');
    if (!fileInput.files || fileInput.files.length === 0) {
        showResultModal("HTML 명세서 파일을 선택해주세요.");
        return;
    }

    if (!supabaseClient) {
        showResultModal("데이터베이스 연결 설정이 완료되지 않았습니다.");
        return;
    }

    let newCount = 0;
    let updateCount = 0;
    let errorMessages = [];

    // 업로드 중 버튼 비활성화
    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<span class="material-symbols-rounded">hourglass_empty</span> 처리 중...';

    for (const file of fileInput.files) {
        try {
            const htmlContent = await readFileAsText(file);
            const result = await parseAndSaveHTML(htmlContent);
            
            if (result.isUpdate) updateCount++;
            else newCount++;
        } catch (error) {
            console.error(`[${file.name}] 처리 오류:`, error);
            errorMessages.push(`- ${file.name}: ${error.message}`);
        }
    }

    const totalCount = newCount + updateCount;
    let finalMessage = `<strong>총 ${totalCount}건 업로드 완료</strong>\n(신규 저장 ${newCount}건, 중복 업데이트 ${updateCount}건)\n`;
    
    if (errorMessages.length > 0) {
        finalMessage += `\n<span style="color:red; font-size: 13px;">에러 발생 (${errorMessages.length}건):\n${errorMessages.join('\n')}</span>`;
    }

    showResultModal(finalMessage);
    fileInput.value = '';
    
    // 버튼 복구
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<span class="material-symbols-rounded">upload</span> 명세서 파싱 및 저장';

    // 업로드 성공 시 즉시 통계와 내역 최신화
    if (newCount > 0 || updateCount > 0) {
        loadHistory();
    }
});

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error("파일 읽기 실패"));
        reader.readAsText(file);
    });
}

async function parseAndSaveHTML(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const topLeftEl = doc.querySelector('.top_left');
    const topRightEl = doc.querySelector('.top_right');

    if (!topLeftEl || !topRightEl) {
        throw new Error("명세서 양식이 아닙니다. (.top_left 또는 .top_right 없음)");
    }

    // 연월 추출
    const rawMonthText = topLeftEl.textContent;
    const monthMatch = rawMonthText.match(/(\d{4})년\s*(\d{1,2})월/);
    let billingMonth = null;
    if (monthMatch) {
        const year = monthMatch[1];
        const month = monthMatch[2].padStart(2, '0');
        billingMonth = `${year}${month}`;
    }

    // 호수 추출
    const roomText = topRightEl.textContent;
    const roomMatch = roomText.match(/(\d+)호/);
    let roomNumber = null;
    if (roomMatch) {
        roomNumber = roomMatch[1];
    }

    if (!billingMonth || !roomNumber) {
        throw new Error("연월 또는 호수 정보를 명확히 추출하지 못했습니다.");
    }

    const uniqueId = `${billingMonth}_${roomNumber}`;

    // 관리비 상세 항목 파싱
    const bottomRightEl = doc.querySelector('.bottom_right');
    const feeItems = [];
    const excludeWords = ['공급가액', '부 가 세', '과 세 합', '비과세합', '비 과 세', '기타항목'];

    if (bottomRightEl) {
        const rows = bottomRightEl.querySelectorAll('div[style*="clear:left"], div[style*="clear: left"]');
        
        rows.forEach(row => {
            const spans = row.querySelectorAll('span');
            if (spans.length >= 5) {
                const leftName = spans[0].textContent.trim();
                const leftAmountText = spans[1].textContent.trim();
                const rightName = spans[3].textContent.trim();
                const rightAmountText = spans[4].textContent.trim();

                const processItem = (name, amountText) => {
                    if (!name || name === '&nbsp;' || name === '') return;
                    if (excludeWords.some(word => name.includes(word))) return;

                    const amount = parseInt(amountText.replace(/[^0-9-]/g, ''), 10) || 0; // 마이너스(-) 기호 허용
                    if (amount !== 0) {
                        feeItems.push({ name, amount });
                    }
                };

                processItem(leftName, leftAmountText);
                processItem(rightName, rightAmountText);
            }
        });
    }

    renderUploadTable(billingMonth, roomNumber, feeItems);

    const record = {
        id: uniqueId,
        billing_month: billingMonth,
        room_number: roomNumber,
        fee_items: feeItems
    };

    const { data: existingData, error: searchError } = await supabaseClient
        .from('maintenance_fees')
        .select('id')
        .eq('id', uniqueId)
        .maybeSingle();

    if (searchError) throw searchError;
    const isUpdate = existingData !== null;

    const { error: upsertError } = await supabaseClient
        .from('maintenance_fees')
        .upsert(record);

    if (upsertError) throw upsertError;

    return { isUpdate, uniqueId };
}

function renderUploadTable(month, room, items) {
    const container = document.getElementById('resultContainer');
    const title = document.getElementById('resultTitle');
    const tbody = document.getElementById('resultTableBody');

    container.style.display = 'block';
    title.textContent = `${month.substring(0,4)}년 ${month.substring(4,6)}월 - ${room}호 상세 내역 (가장 최근 처리됨)`;
    tbody.innerHTML = '';

    items.forEach(item => {
        const tr = document.createElement('tr');
        
        const tdName = document.createElement('td');
        tdName.textContent = item.name;
        
        const tdAmount = document.createElement('td');
        tdAmount.className = 'jt-num';
        tdAmount.textContent = item.amount.toLocaleString();

        tr.appendChild(tdName);
        tr.appendChild(tdAmount);
        tbody.appendChild(tr);
    });
}


// -----------------------------------------------------------------
// 4. 명세서 내역 (조회 및 필터링) 로직 (카드 & 비교 차트)
// -----------------------------------------------------------------
let cachedHistoryData = [];
let selectedForCompare = [];
let compareChartInstance = null;

async function loadHistory() {
    if (!supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('maintenance_fees')
        .select('*')
        .order('billing_month', { ascending: false });

    if (error) {
        console.error("데이터 불러오기 실패:", error);
        return;
    }

    cachedHistoryData = data;
    populateFilters(data);
    renderHistoryCards();
    renderDashboardAnalytics();
}

// --- 전역 상태 추가 ---
let selectedFilterItems = []; // 비어있으면 전체 보기

function populateFilters(data) {
    const monthSelect = document.getElementById('filterMonth');
    const roomSelect = document.getElementById('filterRoom');
    const dropdown = document.getElementById('itemMultiSelectDropdown');
    
    // 월별/호수별 고유값
    const months = [...new Set(data.map(d => d.billing_month))].sort((a, b) => b.localeCompare(a));
    const rooms = [...new Set(data.map(d => d.room_number))].sort();
    
    // 세부 항목 고유값
    const items = new Set();
    data.forEach(d => d.fee_items.forEach(f => items.add(f.name)));
    const sortedItems = Array.from(items).sort();

    // 월 필터 갱신
    const currentMonth = monthSelect.value;
    monthSelect.innerHTML = '<option value="ALL">전체 월</option>';
    months.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = `${m.substring(0,4)}년 ${m.substring(4,6)}월`;
        monthSelect.appendChild(option);
    });
    if (months.includes(currentMonth)) monthSelect.value = currentMonth;

    // 호수 필터 갱신
    const currentRoom = roomSelect.value;
    roomSelect.innerHTML = '<option value="ALL">전체 호수</option>';
    rooms.forEach(r => {
        const option = document.createElement('option');
        option.value = r;
        option.textContent = `${r}호`;
        roomSelect.appendChild(option);
    });
    if (rooms.includes(currentRoom)) roomSelect.value = currentRoom;

    // 세부 항목 필터(다중 선택) 갱신
    dropdown.innerHTML = '';
    
    // '전체 보기' 옵션
    const allRow = document.createElement('div');
    allRow.style.padding = '8px 16px';
    allRow.style.cursor = 'pointer';
    allRow.innerHTML = `<label style="display:flex; align-items:center; cursor:pointer;"><input type="checkbox" id="chkAllItems" ${selectedFilterItems.length === 0 ? 'checked' : ''} style="margin-right:8px;"> <strong>모든 항목 보기</strong></label>`;
    dropdown.appendChild(allRow);

    sortedItems.forEach(i => {
        const row = document.createElement('div');
        row.style.padding = '6px 16px';
        row.style.cursor = 'pointer';
        row.style.fontSize = '13px';
        const isChecked = selectedFilterItems.includes(i) ? 'checked' : '';
        row.innerHTML = `<label style="display:flex; align-items:center; cursor:pointer;"><input type="checkbox" class="chk-filter-item" value="${i}" ${isChecked} style="margin-right:8px;"> ${i}</label>`;
        dropdown.appendChild(row);
    });

    bindMultiSelectEvents();
}

function bindMultiSelectEvents() {
    const btn = document.getElementById('itemMultiSelectBtn');
    const dropdown = document.getElementById('itemMultiSelectDropdown');
    const label = document.getElementById('itemMultiSelectLabel');
    const chkAll = document.getElementById('chkAllItems');
    const chkItems = document.querySelectorAll('.chk-filter-item');

    // 드롭다운 토글
    btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    };

    // 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    const updateLabel = () => {
        if (selectedFilterItems.length === 0) {
            label.textContent = '모든 항목 보기';
            chkAll.checked = true;
        } else if (selectedFilterItems.length === 1) {
            label.textContent = selectedFilterItems[0];
            chkAll.checked = false;
        } else {
            label.textContent = `${selectedFilterItems[0]} 외 ${selectedFilterItems.length - 1}건`;
            chkAll.checked = false;
        }
        renderHistoryCards();
    };

    chkAll.addEventListener('change', (e) => {
        if (e.target.checked) {
            selectedFilterItems = [];
            chkItems.forEach(chk => chk.checked = false);
            updateLabel();
        } else {
            e.target.checked = true; // 전체 보기는 끌 수 없음 (개별 항목을 선택하면 자동으로 꺼짐)
        }
    });

    chkItems.forEach(chk => {
        chk.addEventListener('change', () => {
            selectedFilterItems = Array.from(chkItems).filter(c => c.checked).map(c => c.value);
            updateLabel();
        });
    });
}

document.getElementById('filterMonth').addEventListener('change', renderHistoryCards);
document.getElementById('filterRoom').addEventListener('change', renderHistoryCards);

function renderHistoryCards() {
    const monthFilter = document.getElementById('filterMonth').value;
    const roomFilter = document.getElementById('filterRoom').value;
    const container = document.getElementById('historyCardsContainer');
    
    container.innerHTML = '';
    
    // 체크박스 초기화
    selectedForCompare = [];
    updateCompareBtn();

    let filteredData = cachedHistoryData;
    
    if (monthFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.billing_month === monthFilter);
    }
    
    if (roomFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.room_number === roomFilter);
    }

    if (filteredData.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 32px; color: #8A92A3; background: #fff; border: 1px solid #E4E5E8; border-radius: 8px;">조건에 맞는 내역이 없습니다.</div>`;
        return;
    }

    // 모든 카드의 항목을 동일한 위치에 그리기 위해 고유 항목 추출
    const allItemNames = new Set();
    filteredData.forEach(record => {
        record.fee_items.forEach(fee => {
            allItemNames.add(fee.name);
        });
    });
    
    // 선택된 항목만 렌더링하거나, 전체 렌더링
    const isFiltered = selectedFilterItems.length > 0;
    const fixedColumns = isFiltered ? [...selectedFilterItems].sort() : Array.from(allItemNames).sort();

    filteredData.forEach(item => {
        const totalAmount = item.fee_items.reduce((sum, fee) => sum + fee.amount, 0);
        const titleStr = `${item.billing_month.substring(0,4)}년 ${item.billing_month.substring(4,6)}월 - ${item.room_number}호`;
        
        // 빠른 검색을 위한 Map 생성
        const itemMap = {};
        item.fee_items.forEach(fee => {
            itemMap[fee.name] = fee.amount;
        });
        
        const card = document.createElement('div');
        card.style.border = '1px solid var(--jt-color-border, #E4E5E8)';
        card.style.borderRadius = 'var(--jt-r-md, 8px)';
        card.style.padding = 'var(--jt-space-4, 16px)';
        card.style.backgroundColor = '#FAFAFA';

        // 카드 상단 (체크박스, 제목, 총액)
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '12px';
        header.style.paddingBottom = '12px';
        header.style.borderBottom = '1px dashed #D1D5DB';

        const titleDiv = document.createElement('div');
        titleDiv.style.display = 'flex';
        titleDiv.style.alignItems = 'center';
        titleDiv.style.gap = '12px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.width = '18px';
        checkbox.style.height = '18px';
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                // 다중 비교 허용 (개수 제한 해제)
                selectedForCompare.push(item);
            } else {
                selectedForCompare = selectedForCompare.filter(i => i.id !== item.id);
            }
            updateCompareBtn();
        });

        const titleText = document.createElement('strong');
        titleText.style.fontSize = '15px';
        titleText.textContent = titleStr;

        titleDiv.appendChild(checkbox);
        titleDiv.appendChild(titleText);

        const totalText = document.createElement('div');
        totalText.innerHTML = `<span style="font-size: 12px; color: #5C6370; margin-right: 8px;">총 청구 금액</span><strong style="color: var(--jt-color-accent, #305CDE); font-size: 16px;" class="jt-num">${totalAmount.toLocaleString()}원</strong>`;

        header.appendChild(titleDiv);
        header.appendChild(totalText);

        // 카드 하단 (그리드 형태의 세부 항목)
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
        grid.style.gap = '8px 16px';
        grid.style.fontSize = '13px';

        fixedColumns.forEach(colName => {
            const amount = itemMap[colName] || 0;
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            
            if (amount === 0) {
                row.innerHTML = `<span style="color:#A0AABF;">${colName}</span> <span class="jt-num" style="color:#A0AABF;">-</span>`;
            } else {
                const colorStyle = amount < 0 ? 'color: var(--jt-color-accent, #305CDE); font-weight: 500;' : '';
                row.innerHTML = `<span style="color:#5C6370; font-weight: ${isFiltered ? '600' : 'normal'};">${colName}</span> 
                <span class="jt-num" style="${colorStyle}; font-size: ${isFiltered ? '15px' : '13px'}; font-weight: ${isFiltered ? '600' : 'normal'}; color: ${isFiltered ? '#1F2328' : 'inherit'};">${amount.toLocaleString()}</span>`;
            }
            
            grid.appendChild(row);
        });

        card.appendChild(header);
        card.appendChild(grid);
        container.appendChild(card);
    });
}

function updateCompareBtn() {
    const btn = document.getElementById('compareBtn');
    if (selectedForCompare.length >= 2) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-rounded">bar_chart</span> ${selectedForCompare.length}개 다중 비교 차트 보기`;
    } else {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-rounded">bar_chart</span> 비교할 2개 이상을 체크하세요 (${selectedForCompare.length})`;
    }
}

// -----------------------------------------------------------------
// 5. 차트 그리기 로직 (비교 모달)
// -----------------------------------------------------------------
document.getElementById('compareBtn').addEventListener('click', openCompareModal);

function openCompareModal() {
    if (selectedForCompare.length < 2) return;
    
    document.getElementById('compareModal').style.display = 'flex';
    
    // 모든 선택된 데이터의 고유 항목(Labels) 추출
    const allNames = new Set();
    selectedForCompare.forEach(item => {
        item.fee_items.forEach(f => allNames.add(f.name));
    });
    const baseLabels = Array.from(allNames).sort();

    // 콤보박스 세팅
    const select = document.getElementById('compareItemFilter');
    const prevValue = select.value;
    select.innerHTML = '<option value="ALL">전체 항목 보기</option>';
    baseLabels.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    // 이전 선택 유지 (있을 경우만)
    if (prevValue === 'ALL' || baseLabels.includes(prevValue)) {
        select.value = prevValue;
    }

    // 차트 그리기 함수 분리
    const drawCompareChart = () => {
        const filterVal = select.value;
        const labels = filterVal === 'ALL' ? baseLabels : [filterVal];

        const colors = [
            { bg: 'rgba(54, 162, 235, 0.7)', border: 'rgb(54, 162, 235)' },
            { bg: 'rgba(255, 99, 132, 0.7)', border: 'rgb(255, 99, 132)' },
            { bg: 'rgba(75, 192, 192, 0.7)', border: 'rgb(75, 192, 192)' },
            { bg: 'rgba(255, 159, 64, 0.7)', border: 'rgb(255, 159, 64)' },
            { bg: 'rgba(153, 102, 255, 0.7)', border: 'rgb(153, 102, 255)' },
            { bg: 'rgba(255, 205, 86, 0.7)', border: 'rgb(255, 205, 86)' },
            { bg: 'rgba(201, 203, 207, 0.7)', border: 'rgb(201, 203, 207)' }
        ];

        const datasets = selectedForCompare.map((item, index) => {
            const label = `${item.billing_month.substring(0,4)}.${item.billing_month.substring(4,6)} ${item.room_number}호`;
            const data = labels.map(name => {
                const found = item.fee_items.find(f => f.name === name);
                return found ? found.amount : 0;
            });
            const color = colors[index % colors.length];
            return {
                label: label,
                data: data,
                backgroundColor: color.bg,
                borderColor: color.border,
                borderWidth: 1
            };
        });

        const ctx = document.getElementById('compareChart').getContext('2d');
        if (compareChartInstance) compareChartInstance.destroy();
        
        compareChartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { callback: function(value) { return value.toLocaleString() + '원'; } }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.x !== null) label += context.parsed.x.toLocaleString() + '원';
                                return label;
                            }
                        }
                    }
                }
            }
        });
    };

    // 콤보박스 이벤트 바인딩
    select.removeEventListener('change', select._changeHandler);
    select._changeHandler = drawCompareChart;
    select.addEventListener('change', drawCompareChart);

    drawCompareChart();
}

function closeCompareModal() {
    document.getElementById('compareModal').style.display = 'none';
}

function closeDetailModal() {
    // 이제 안쓰지만 에러 방지용
}

// -----------------------------------------------------------------
// 6. 대시보드 통계 및 이상 급등 알림 로직
// -----------------------------------------------------------------
Chart.register(ChartDataLabels);
Chart.defaults.set('plugins.datalabels', {
    color: '#333',
    font: { weight: 'bold', size: 11 },
    formatter: function(value) {
        if (value === 0) return '';
        if (value >= 10000) return Math.round(value/10000).toLocaleString() + '만';
        return value.toLocaleString();
    }
});

let chartInstances = {};

function renderDashboardAnalytics() {
    if (!cachedHistoryData || cachedHistoryData.length === 0) return;

    // 데이터 복사 및 정렬 (월 오름차순)
    const sortedData = [...cachedHistoryData].sort((a, b) => a.billing_month.localeCompare(b.billing_month));
    const allMonths = [...new Set(sortedData.map(d => d.billing_month))];
    const allRooms = [...new Set(sortedData.map(d => d.room_number))].sort();

    // 1. 이상 급등 알림 (전월 대비 총액 20% 이상 증가 시)
    checkAnomalies(sortedData, allRooms);

    // 2. 월별 총 관리비 추이 (Grouped Bar)
    drawMonthlyTotalChart(sortedData, allMonths, allRooms);

    // 3. 호수별 누적 관리비 비중 (Doughnut)
    drawRoomShareChart(sortedData, allRooms);

    // 4. 세부 항목별 추이 콤보박스 업데이트 및 렌더링
    updateItemSelectAndDraw(sortedData, allMonths, allRooms);

    // 5. 전체 항목 비중 누적 (Doughnut)
    drawItemShareChart(sortedData);
}

function checkAnomalies(sortedData, allRooms) {
    const alertsContainer = document.getElementById('anomalyAlertsContainer');
    alertsContainer.innerHTML = '';
    let hasAlerts = false;

    allRooms.forEach(room => {
        const roomData = sortedData.filter(d => d.room_number === room);
        for (let i = 1; i < roomData.length; i++) {
            const prev = roomData[i-1];
            const curr = roomData[i];
            
            const prevTotal = prev.fee_items.reduce((sum, fee) => sum + fee.amount, 0);
            const currTotal = curr.fee_items.reduce((sum, fee) => sum + fee.amount, 0);

            if (prevTotal > 0) {
                const increaseRatio = (currTotal - prevTotal) / prevTotal;
                if (increaseRatio >= 0.20) {
                    hasAlerts = true;
                    const increaseAmt = currTotal - prevTotal;
                    const percent = Math.round(increaseRatio * 100);
                    const monthStr = `${curr.billing_month.substring(0,4)}년 ${curr.billing_month.substring(4,6)}월`;
                    
                    const alertEl = document.createElement('div');
                    alertEl.style.backgroundColor = '#FEF2F2';
                    alertEl.style.border = '1px solid #FCA5A5';
                    alertEl.style.color = '#991B1B';
                    alertEl.style.padding = '12px 16px';
                    alertEl.style.borderRadius = '8px';
                    alertEl.style.display = 'flex';
                    alertEl.style.alignItems = 'center';
                    alertEl.style.fontSize = '14px';
                    
                    alertEl.innerHTML = `<span class="material-symbols-rounded" style="margin-right: 8px; color: #DC2626;">warning</span>
                        <strong>[이상 급등 알림]</strong>&nbsp; ${room}호의 ${monthStr} 관리비 총액이 전월 대비 <strong>${percent}% (${increaseAmt.toLocaleString()}원)</strong> 급등했습니다.`;
                    
                    alertsContainer.appendChild(alertEl);
                }
            }
        }
    });

    alertsContainer.style.display = hasAlerts ? 'flex' : 'none';
}

function drawMonthlyTotalChart(sortedData, allMonths, allRooms) {
    const ctx = document.getElementById('chartMonthlyTotal').getContext('2d');
    if (chartInstances['monthlyTotal']) chartInstances['monthlyTotal'].destroy();

    const colors = ['rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(75, 192, 192, 0.7)'];

    const datasets = allRooms.map((room, idx) => {
        const data = allMonths.map(month => {
            const record = sortedData.find(d => d.room_number === room && d.billing_month === month);
            return record ? record.fee_items.reduce((sum, fee) => sum + fee.amount, 0) : 0;
        });
        return {
            label: `${room}호`,
            data: data,
            backgroundColor: colors[idx % colors.length]
        };
    });

    const labels = allMonths.map(m => `${m.substring(2,4)}년 ${m.substring(4,6)}월`);

    chartInstances['monthlyTotal'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });
}

function drawRoomShareChart(sortedData, allRooms) {
    const ctx = document.getElementById('chartRoomShare').getContext('2d');
    if (chartInstances['roomShare']) chartInstances['roomShare'].destroy();

    const data = allRooms.map(room => {
        const roomData = sortedData.filter(d => d.room_number === room);
        return roomData.reduce((sum, item) => sum + item.fee_items.reduce((s, f) => s + f.amount, 0), 0);
    });

    chartInstances['roomShare'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: allRooms.map(r => `${r}호`),
            datasets: [{
                data: data,
                backgroundColor: ['rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(255, 205, 86, 0.7)']
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function updateItemSelectAndDraw(sortedData, allMonths, allRooms) {
    const select = document.getElementById('analyticsItemSelect');
    
    // 항목 수집
    const allItemNames = new Set();
    sortedData.forEach(record => record.fee_items.forEach(fee => allItemNames.add(fee.name)));
    const items = Array.from(allItemNames).sort();

    // 기존 선택값 유지
    const currentVal = select.value;
    select.innerHTML = '';
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
    if (items.includes(currentVal)) select.value = currentVal;
    else if (items.length > 0) select.value = items[0];

    // 그리기 및 이벤트 바인딩
    const drawItemTrend = () => {
        const selectedItem = select.value;
        const ctx = document.getElementById('chartItemTrend').getContext('2d');
        if (chartInstances['itemTrend']) chartInstances['itemTrend'].destroy();

        const colors = ['rgba(54, 162, 235, 1)', 'rgba(255, 99, 132, 1)'];
        const datasets = allRooms.map((room, idx) => {
            const data = allMonths.map(month => {
                const record = sortedData.find(d => d.room_number === room && d.billing_month === month);
                if (!record) return 0;
                const fee = record.fee_items.find(f => f.name === selectedItem);
                return fee ? fee.amount : 0;
            });
            return {
                label: `${room}호`,
                data: data,
                borderColor: colors[idx % colors.length],
                backgroundColor: colors[idx % colors.length],
                tension: 0.1,
                fill: false
            };
        });

        const labels = allMonths.map(m => `${m.substring(4,6)}월`);

        chartInstances['itemTrend'] = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: { responsive: true, maintainAspectRatio: false }
        });
    };

    // 중복 바인딩 방지
    select.removeEventListener('change', select._changeHandler);
    select._changeHandler = drawItemTrend;
    select.addEventListener('change', drawItemTrend);
    
    drawItemTrend();
}

function drawItemShareChart(sortedData) {
    const ctx = document.getElementById('chartItemShare').getContext('2d');
    if (chartInstances['itemShare']) chartInstances['itemShare'].destroy();

    const itemTotals = {};
    sortedData.forEach(record => {
        record.fee_items.forEach(fee => {
            if (fee.amount > 0) { // 마이너스 항목은 원형 차트에서 제외하거나 별도 처리
                itemTotals[fee.name] = (itemTotals[fee.name] || 0) + fee.amount;
            }
        });
    });

    // 상위 5개 항목만 뽑고 나머지는 '기타'로 묶기
    const sortedItems = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]);
    const topItems = sortedItems.slice(0, 5);
    const otherSum = sortedItems.slice(5).reduce((sum, [, amt]) => sum + amt, 0);

    const labels = topItems.map(i => i[0]);
    const data = topItems.map(i => i[1]);
    
    if (otherSum > 0) {
        labels.push('기타');
        data.push(otherSum);
    }

    chartInstances['itemShare'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)',
                    'rgba(255, 205, 86, 0.7)', 'rgba(75, 192, 192, 0.7)',
                    'rgba(153, 102, 255, 0.7)', 'rgba(201, 203, 207, 0.7)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

// 앱 초기화
window.addEventListener('DOMContentLoaded', () => {
    loadHistory(); // 데이터를 먼저 불러오고 렌더링
});
