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
// 4. 명세서 내역 (조회 및 필터링) 로직
// -----------------------------------------------------------------
let cachedHistoryData = [];

async function loadHistory() {
    if (!supabaseClient) return;

    // 데이터를 모두 가져옵니다 (최신 월 순 정렬)
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
    renderHistoryTable();
}

function populateMonthFilter(data) {
    const monthSelect = document.getElementById('filterMonth');
    const currentVal = monthSelect.value;
    
    // 기존 옵션 지우기 (전체 월 제외)
    monthSelect.innerHTML = '<option value="ALL">전체 월</option>';
    
    // 고유한 월 추출
    const uniqueMonths = [...new Set(data.map(item => item.billing_month))];
    uniqueMonths.sort((a, b) => b.localeCompare(a)); // 내림차순 정렬

    uniqueMonths.forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = `${month.substring(0,4)}년 ${month.substring(4,6)}월`;
        monthSelect.appendChild(option);
    });
    
    // 이전에 선택했던 값이 있다면 유지
    if (uniqueMonths.includes(currentVal)) {
        monthSelect.value = currentVal;
    }
}

// 필터가 바뀔 때마다 테이블 다시 그리기
document.getElementById('filterRoom').addEventListener('change', renderHistoryTable);
document.getElementById('filterMonth').addEventListener('change', renderHistoryTable);

function renderHistoryTable() {
    const roomFilter = document.getElementById('filterRoom').value;
    const monthFilter = document.getElementById('filterMonth').value;
    
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';

    let filteredData = cachedHistoryData;

    if (roomFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.room_number === roomFilter);
    }
    if (monthFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.billing_month === monthFilter);
    }

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 32px; color: #8A92A3;">조건에 맞는 내역이 없습니다.</td></tr>`;
        return;
    }

    filteredData.forEach(item => {
        // 총 금액 계산
        const totalAmount = item.fee_items.reduce((sum, fee) => sum + fee.amount, 0);
        
        const tr = document.createElement('tr');
        
        const tdMonth = document.createElement('td');
        tdMonth.textContent = `${item.billing_month.substring(0,4)}년 ${item.billing_month.substring(4,6)}월`;
        
        const tdRoom = document.createElement('td');
        tdRoom.textContent = `${item.room_number}호`;
        
        const tdTotal = document.createElement('td');
        tdTotal.className = 'jt-num';
        tdTotal.style.fontWeight = 'bold';
        tdTotal.style.color = 'var(--jt-color-accent, #305CDE)';
        tdTotal.textContent = totalAmount.toLocaleString();
        
        const tdAction = document.createElement('td');
        tdAction.style.textAlign = 'center';
        
        const btn = document.createElement('button');
        btn.className = 'btn-outline';
        btn.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">visibility</span> 상세 보기';
        btn.onclick = () => openDetailModal(item);
        
        tdAction.appendChild(btn);

        tr.appendChild(tdMonth);
        tr.appendChild(tdRoom);
        tr.appendChild(tdTotal);
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
    });
}

function openDetailModal(item) {
    document.getElementById('detailModalTitle').textContent = `${item.billing_month.substring(0,4)}년 ${item.billing_month.substring(4,6)}월 - ${item.room_number}호 상세 내역`;
    
    const tbody = document.getElementById('detailModalBody');
    const tfoot = document.getElementById('detailModalFoot');
    tbody.innerHTML = '';
    
    let total = 0;

    item.fee_items.forEach(fee => {
        total += fee.amount;
        
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = fee.name;
        
        const tdAmount = document.createElement('td');
        tdAmount.className = 'jt-num';
        tdAmount.textContent = fee.amount.toLocaleString();
        
        tr.appendChild(tdName);
        tr.appendChild(tdAmount);
        tbody.appendChild(tr);
    });

    tfoot.innerHTML = `
        <tr>
            <td style="padding: 12px 16px;"><strong>총 청구 금액</strong></td>
            <td class="jt-num" style="padding: 12px 16px; color: var(--jt-color-accent, #305CDE); font-size: 16px;">
                ${total.toLocaleString()}
            </td>
        </tr>
    `;

    document.getElementById('detailModal').style.display = 'flex';
}
