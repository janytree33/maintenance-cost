// Supabase 설정 (제니님의 실제 프로젝트 URL과 anon 키를 입력하셔야 합니다)
// 테스트 시에는 아래 값을 채운 후 진행해주세요.
const SUPABASE_URL = 'https://qapmjkowevzwjyiqsnuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhcG1qa293ZXZ6d2p5aXFzbnV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzY1MTcsImV4cCI6MjA5NDcxMjUxN30.WS6aSvUG1UYHQN0Z2erekIpv69ZPTuQ8RCcLs8lMlLc';

// CDN에서 불러온 전역 변수 'supabase'와 이름이 겹치지 않게 'supabaseClient'로 변경
let supabaseClient;

// Supabase가 설정되었는지 확인 후 초기화
if (SUPABASE_URL !== '여기에_SUPABASE_URL을_입력하세요') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// 모달 제어 함수
function showModal(message) {
    document.getElementById('modalMessage').innerHTML = message.replace(/\n/g, '<br>');
    document.getElementById('resultModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('resultModal').style.display = 'none';
}

// 업로드 버튼 클릭 이벤트
document.getElementById('uploadBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('htmlFileInput');
    if (!fileInput.files || fileInput.files.length === 0) {
        showModal("HTML 명세서 파일을 선택해주세요.");
        return;
    }

    if (!supabaseClient) {
        showModal("데이터베이스 연결 설정(Supabase URL 및 Key)이 완료되지 않았습니다.<br>js/app.js 파일을 확인해주세요.");
        return;
    }

    let newCount = 0;
    let updateCount = 0;
    let errorMessages = [];

    // 다중 파일 처리 루프
    for (const file of fileInput.files) {
        try {
            const htmlContent = await readFileAsText(file);
            const result = await parseAndSaveHTML(htmlContent);
            
            if (result.isUpdate) {
                updateCount++;
            } else {
                newCount++;
            }
        } catch (error) {
            console.error(`[${file.name}] 처리 오류:`, error);
            errorMessages.push(`- ${file.name}: ${error.message}`);
        }
    }

    // 결과 요약 메시지 작성
    const totalCount = newCount + updateCount;
    let finalMessage = `<strong>총 ${totalCount}건 업로드 완료</strong>\n(신규 저장 ${newCount}건, 중복 업데이트 ${updateCount}건)\n`;
    
    if (errorMessages.length > 0) {
        finalMessage += `\n<span style="color:red; font-size: 13px;">에러 발생 (${errorMessages.length}건):\n${errorMessages.join('\n')}</span>`;
    }

    showModal(finalMessage);
    
    // 파일 선택 초기화 (다시 올릴 수 있도록)
    fileInput.value = '';
});

// 파일을 텍스트로 읽는 프로미스 래퍼 함수
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error("파일 읽기 실패"));
        reader.readAsText(file);
    });
}

// 개별 HTML 파싱 및 DB 저장 (업서트) 로직
async function parseAndSaveHTML(htmlString) {
    // 1. 임시 DOM을 생성하여 HTML 문자열을 파싱
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // 2. 연월 및 호수 추출
    const topLeftEl = doc.querySelector('.top_left');
    const topRightEl = doc.querySelector('.top_right');

    if (!topLeftEl || !topRightEl) {
        throw new Error("명세서 양식이 아닙니다. (.top_left 또는 .top_right 없음)");
    }

    // 연월 추출 (전체 텍스트에서 'OOOO년 O월' 형태 찾기)
    const rawMonthText = topLeftEl.textContent;
    const monthMatch = rawMonthText.match(/(\d{4})년\s*(\d{1,2})월/);
    let billingMonth = null;
    if (monthMatch) {
        const year = monthMatch[1];
        const month = monthMatch[2].padStart(2, '0');
        billingMonth = `${year}${month}`; // 예: 202603
    }

    // 호수 추출 (전체 텍스트에서 'OOOO호' 형태 찾기)
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

    // 3. 관리비 상세 항목 파싱
    const bottomRightEl = doc.querySelector('.bottom_right');
    const feeItems = [];
    const excludeWords = ['공급가액', '부 가 세', '과 세 합', '비과세합', '비 과 세', '기타항목'];

    if (bottomRightEl) {
        // clear:left 스타일이 지정된 div들이 실제 상세 항목 행(Row)들입니다.
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
                    
                    const isExcluded = excludeWords.some(word => name.includes(word));
                    if (isExcluded) return;

                    const amount = parseInt(amountText.replace(/[^0-9]/g, ''), 10) || 0;
                    if (amount > 0) {
                        feeItems.push({ name, amount });
                    }
                };

                processItem(leftName, leftAmountText);
                processItem(rightName, rightAmountText);
            }
        });
    }

    // (다중 파일의 경우 마지막 파일 또는 에러 안난 파일만 테이블에 표시하게 됨)
    renderTable(billingMonth, roomNumber, feeItems);

    // 4. Supabase DB에 저장 (Upsert)
    const record = {
        id: uniqueId,
        billing_month: billingMonth,
        room_number: roomNumber,
        fee_items: feeItems
    };

    // 기존 데이터 존재 여부 확인
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

// 추출한 데이터를 화면의 표(Table)에 그리는 함수
function renderTable(month, room, items) {
    const container = document.getElementById('resultContainer');
    const title = document.getElementById('resultTitle');
    const tbody = document.getElementById('resultTableBody');

    container.style.display = 'block';
    title.textContent = `${month.substring(0,4)}년 ${month.substring(4,6)}월 - ${room}호 상세 내역 (가장 최근 처리됨)`;
    
    tbody.innerHTML = '';

    items.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--jt-color-border, #eee)';
        
        const tdName = document.createElement('td');
        tdName.style.padding = 'var(--jt-space-2, 8px)';
        tdName.textContent = item.name;
        
        const tdAmount = document.createElement('td');
        tdAmount.className = 'jt-num';
        tdAmount.style.padding = 'var(--jt-space-2, 8px)';
        tdAmount.textContent = item.amount.toLocaleString();

        tr.appendChild(tdName);
        tr.appendChild(tdAmount);
        tbody.appendChild(tr);
    });
}
