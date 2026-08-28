const SUPABASE_URL = 'https://qapmjkowevzwjyiqsnuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhcG1qa293ZXZ6d2p5aXFzbnV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzY1MTcsImV4cCI6MjA5NDcxMjUxN30.WS6aSvUG1UYHQN0Z2erekIpv69ZPTuQ8RCcLs8lMlLc';

let supabaseClient;
if (SUPABASE_URL !== '여기에_SUPABASE_URL을_입력하세요') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// -----------------------------------------------------------------
// 1. 네비게이션(화면 전환) 로직
// -----------------------------------------------------------------
document.getElementById('menu-dashboard').addEventListener('click', (e) => switchView(e, 'view-dashboard'));
document.getElementById('menu-history').addEventListener('click', (e) => {
    switchView(e, 'view-history');
    loadHistory(); // 화면을 전환할 때 DB에서 데이터를 불러옵니다.
});
document.getElementById('menu-settings').addEventListener('click', (e) => switchView(e, 'view-settings'));

function switchView(event, viewId) {
    if (event) event.preventDefault();
    
    // 사이드바 메뉴 활성화 변경
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (event) event.currentTarget.classList.add('active');

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
    populateMonthFilter(data);
    renderHistoryCards();
}

function populateMonthFilter(data) {
    const monthSelect = document.getElementById('filterMonth');
    const currentVal = monthSelect.value;
    
    monthSelect.innerHTML = '<option value="ALL">전체 월</option>';
    
    const uniqueMonths = [...new Set(data.map(item => item.billing_month))];
    uniqueMonths.sort((a, b) => b.localeCompare(a));

    uniqueMonths.forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = `${month.substring(0,4)}년 ${month.substring(4,6)}월`;
        monthSelect.appendChild(option);
    });
    
    if (uniqueMonths.includes(currentVal)) {
        monthSelect.value = currentVal;
    }
}

document.getElementById('filterRoom').addEventListener('change', renderHistoryCards);
document.getElementById('filterMonth').addEventListener('change', renderHistoryCards);

function renderHistoryCards() {
    const roomFilter = document.getElementById('filterRoom').value;
    const monthFilter = document.getElementById('filterMonth').value;
    const container = document.getElementById('historyCardsContainer');
    
    container.innerHTML = '';
    selectedForCompare = [];
    updateCompareBtn();

    let filteredData = cachedHistoryData;
    if (roomFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.room_number === roomFilter);
    }
    if (monthFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.billing_month === monthFilter);
    }

    if (filteredData.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 32px; color: #8A92A3; background: #fff; border: 1px solid #E4E5E8; border-radius: 8px;">조건에 맞는 내역이 없습니다.</div>`;
        return;
    }

    filteredData.forEach(item => {
        const totalAmount = item.fee_items.reduce((sum, fee) => sum + fee.amount, 0);
        const titleStr = `${item.billing_month.substring(0,4)}년 ${item.billing_month.substring(4,6)}월 - ${item.room_number}호`;
        
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

        item.fee_items.forEach(fee => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.innerHTML = `<span style="color:#5C6370;">${fee.name}</span> <span class="jt-num">${fee.amount.toLocaleString()}</span>`;
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
// 5. 차트 그리기 로직
// -----------------------------------------------------------------
document.getElementById('compareBtn').addEventListener('click', openCompareModal);

function openCompareModal() {
    if (selectedForCompare.length < 2) return;
    
    document.getElementById('compareModal').style.display = 'flex';
    
    // 차트 색상 팔레트
    const colors = [
        { bg: 'rgba(54, 162, 235, 0.7)', border: 'rgb(54, 162, 235)' },
        { bg: 'rgba(255, 99, 132, 0.7)', border: 'rgb(255, 99, 132)' },
        { bg: 'rgba(75, 192, 192, 0.7)', border: 'rgb(75, 192, 192)' },
        { bg: 'rgba(255, 159, 64, 0.7)', border: 'rgb(255, 159, 64)' },
        { bg: 'rgba(153, 102, 255, 0.7)', border: 'rgb(153, 102, 255)' },
        { bg: 'rgba(255, 205, 86, 0.7)', border: 'rgb(255, 205, 86)' },
        { bg: 'rgba(201, 203, 207, 0.7)', border: 'rgb(201, 203, 207)' }
    ];

    // 모든 선택된 데이터의 고유 항목(Labels) 추출
    const allNames = new Set();
    selectedForCompare.forEach(item => {
        item.fee_items.forEach(f => allNames.add(f.name));
    });
    
    const labels = Array.from(allNames).sort();
    
    // 동적 데이터셋 생성
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
    
    if (compareChartInstance) {
        compareChartInstance.destroy();
    }
    
    compareChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // 항목이 많으므로 가로 막대 그래프 사용
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString() + '원';
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.x !== null) {
                                label += context.parsed.x.toLocaleString() + '원';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function closeCompareModal() {
    document.getElementById('compareModal').style.display = 'none';
}

function closeDetailModal() {
    // 이제 안쓰지만 에러 방지용
}
