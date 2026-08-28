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
    
    const thead = document.querySelector('#historyTableBody').previousElementSibling;
    const tbody = document.getElementById('historyTableBody');
    
    let filteredData = cachedHistoryData;

    if (roomFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.room_number === roomFilter);
    }
    if (monthFilter !== 'ALL') {
        filteredData = filteredData.filter(item => item.billing_month === monthFilter);
    }

    if (filteredData.length === 0) {
        thead.innerHTML = `<tr><th>청구 연월</th><th>호수</th><th>총 청구 금액(원)</th></tr>`;
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 32px; color: #8A92A3;">조건에 맞는 내역이 없습니다.</td></tr>`;
        return;
    }

    // 1. 현재 필터링된 데이터에 존재하는 모든 고유 '항목명' 추출
    const allItemNames = new Set();
    filteredData.forEach(record => {
        record.fee_items.forEach(fee => {
            allItemNames.add(fee.name);
        });
    });
    
    // 세부 항목명 배열 (정렬: 보기 좋게 가나다순, 단 주요 항목을 앞으로 뺄 수도 있지만 여기선 기본 정렬)
    const columns = Array.from(allItemNames).sort();

    // 2. 동적 테이블 헤더(Thead) 생성
    let theadHTML = `
        <tr>
            <th style="min-width: 100px; position: sticky; left: 0; background-color: var(--jt-color-bg, #F5F6F8); z-index: 2;">청구 연월</th>
            <th style="min-width: 80px; position: sticky; left: 100px; background-color: var(--jt-color-bg, #F5F6F8); z-index: 2;">호수</th>
            <th style="min-width: 120px; text-align: right; position: sticky; left: 180px; background-color: var(--jt-color-bg, #F5F6F8); z-index: 2; border-right: 2px solid var(--jt-color-border, #E4E5E8);">총액(원)</th>
    `;
    columns.forEach(col => {
        theadHTML += `<th style="text-align: right; white-space: nowrap; min-width: 130px;">${col}</th>`;
    });
    theadHTML += `</tr>`;
    thead.innerHTML = theadHTML;

    // 3. 동적 테이블 본문(Tbody) 생성
    tbody.innerHTML = '';
    filteredData.forEach(item => {
        const totalAmount = item.fee_items.reduce((sum, fee) => sum + fee.amount, 0);
        
        // 아이템 이름을 키로, 금액을 값으로 가지는 Map 생성 (빠른 검색용)
        const itemMap = {};
        item.fee_items.forEach(fee => {
            itemMap[fee.name] = fee.amount;
        });
        
        const tr = document.createElement('tr');
        
        // 고정 컬럼들 (연월, 호수, 총액) - 가로 스크롤 시 고정되도록 스타일 추가
        tr.innerHTML = `
            <td style="position: sticky; left: 0; background-color: var(--jt-color-surface, #fff); z-index: 1;">${item.billing_month.substring(0,4)}년 ${item.billing_month.substring(4,6)}월</td>
            <td style="position: sticky; left: 100px; background-color: var(--jt-color-surface, #fff); z-index: 1;">${item.room_number}호</td>
            <td class="jt-num" style="position: sticky; left: 180px; background-color: var(--jt-color-surface, #fff); z-index: 1; font-weight: bold; color: var(--jt-color-accent, #305CDE); border-right: 2px solid var(--jt-color-border, #E4E5E8);">
                ${totalAmount.toLocaleString()}
            </td>
        `;
        
        // 동적 컬럼들 (세부 항목 금액)
        columns.forEach(col => {
            const amount = itemMap[col] || 0;
            const td = document.createElement('td');
            td.className = 'jt-num';
            td.style.color = amount === 0 ? 'var(--jt-color-text-tertiary, #8A92A3)' : 'inherit';
            td.textContent = amount === 0 ? '-' : amount.toLocaleString();
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
    
    // 가로 스크롤을 위해 테이블 래퍼에 스타일 추가
    const tableWrap = document.querySelector('#view-history .jt-table-wrap');
    tableWrap.style.overflowX = 'auto';
    tableWrap.style.maxWidth = '100%';
}

// 상세 보기 모달 관련 함수는 이제 사용하지 않지만(에러 방지용 유지)
function openDetailModal(item) {
    // 사용 안함
}
